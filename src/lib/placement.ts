import type { Load, Panel, Phase, ServiceMode } from '../types';
import { phaseOfSlot, polesOf } from './nec';

export interface Placement {
  loadId: string;
  /** Starting space. */
  slot: number;
  /** All spaces the breaker occupies (same side, consecutive rows). */
  slots: number[];
  phases: Phase[];
  /** On a tandem breaker (half of a space). */
  tandem: boolean;
  /** Which half of the tandem space: A (first) or B. */
  half?: 'A' | 'B';
}

export interface PanelLayout {
  panelId: string;
  placements: Map<string, Placement>;
  /** Space number → ids of loads occupying it (2 ids = tandem). */
  spaceMap: Map<number, string[]>;
  unplaced: string[];
  /** Locked loads whose requested slot was unavailable. */
  conflicts: string[];
  spacesUsed: number;
  circuitsUsed: number;
}

export function spanOf(start: number, poles: number): number[] {
  return Array.from({ length: poles }, (_, i) => start + 2 * i);
}

/** Ids of 1-pole loads marked as tandem. */
export function tandemIds(loads: Load[]): Set<string> {
  return new Set(loads.filter((l) => l.tandem && polesOf(l.kind) === 1).map((l) => l.id));
}

/** Mutable occupancy grid for one panel, shared by placement and the optimizer. */
export class Board {
  /** Per space: a multi-pole/full-size owner, or up to two 1-pole occupants. */
  private multi = new Map<number, string>();
  private singles = new Map<number, string[]>();
  circuits = 0;

  constructor(
    readonly spaces: number,
    readonly maxCircuits: number,
    /** Loads marked tandem; only these may share a space. */
    private readonly tandems: Set<string> = new Set(),
  ) {}

  isEmpty(space: number): boolean {
    return !this.multi.has(space) && !this.singles.get(space)?.length;
  }

  /** Panels with more circuits than spaces accept tandem breakers. */
  get tandemAllowed(): boolean {
    return this.maxCircuits > this.spaces;
  }

  /** Is this load placed as a tandem half (marked tandem, in a panel that takes them)? */
  wantsTandem(id: string): boolean {
    return this.tandemAllowed && this.tandems.has(id);
  }

  /**
   * Can a breaker with `poles` start at `start`? With `tandem`, a 1-pole
   * tandem circuit may join a space holding exactly one other tandem circuit.
   */
  canPlace(start: number, poles: number, tandem = false): boolean {
    if (start < 1 || this.circuits + poles > this.maxCircuits) return false;
    const span = spanOf(start, poles);
    if (span[span.length - 1] > this.spaces) return false;
    if (poles === 1 && tandem) {
      const occ = this.singles.get(start) ?? [];
      return this.tandemAllowed && !this.multi.has(start) && occ.length === 1 && this.tandems.has(occ[0]);
    }
    return span.every((s) => this.isEmpty(s));
  }

  place(id: string, start: number, poles: number): void {
    if (poles === 1) {
      this.singles.set(start, [...(this.singles.get(start) ?? []), id]);
    } else {
      for (const s of spanOf(start, poles)) this.multi.set(s, id);
    }
    this.circuits += poles;
  }

  remove(id: string, start: number, poles: number): void {
    if (poles === 1) {
      const rest = (this.singles.get(start) ?? []).filter((x) => x !== id);
      if (rest.length) this.singles.set(start, rest);
      else this.singles.delete(start);
    } else {
      for (const s of spanOf(start, poles)) this.multi.delete(s);
    }
    this.circuits -= poles;
  }

  occupants(space: number): string[] {
    const m = this.multi.get(space);
    return m ? [m] : (this.singles.get(space) ?? []);
  }

  /** First fit: tandem circuits complete an open tandem before taking an empty space. */
  firstFit(id: string, poles: number): number | null {
    if (poles === 1 && this.wantsTandem(id)) {
      for (let s = 1; s <= this.spaces; s++) if (this.canPlace(s, 1, true)) return s;
    }
    for (let s = 1; s <= this.spaces; s++) if (this.canPlace(s, poles)) return s;
    return null;
  }

  /** Place at a requested start: an empty space, or the open half of a tandem. */
  tryPlaceAt(id: string, start: number, poles: number): boolean {
    if (this.canPlace(start, poles) || (poles === 1 && this.wantsTandem(id) && this.canPlace(start, 1, true))) {
      this.place(id, start, poles);
      return true;
    }
    return false;
  }
}

/**
 * Lay out one panel's loads. Order: locked loads at their slot, then loads
 * with a remembered slot (falling back to auto on conflict), then auto loads
 * in table order taking the first space that fits.
 */
export function layoutPanel(panel: Panel, loads: Load[], mode: ServiceMode): PanelLayout {
  const board = new Board(panel.spaces, panel.maxCircuits, tandemIds(loads));
  const starts = new Map<string, number>();
  const unplaced: string[] = [];
  const conflicts: string[] = [];

  const locked = loads.filter((l) => l.locked && l.slot != null);
  const remembered = loads.filter((l) => !l.locked && l.slot != null);
  const auto = loads.filter((l) => l.slot == null);

  for (const l of locked) {
    if (board.tryPlaceAt(l.id, l.slot!, polesOf(l.kind))) starts.set(l.id, l.slot!);
    else conflicts.push(l.id);
  }
  const fallback: Load[] = [];
  for (const l of remembered) {
    if (board.tryPlaceAt(l.id, l.slot!, polesOf(l.kind))) starts.set(l.id, l.slot!);
    else fallback.push(l);
  }
  // Keep table order among loads that need auto placement.
  const autoSet = new Set([...auto, ...fallback].map((l) => l.id));
  for (const l of loads) {
    if (!autoSet.has(l.id)) continue;
    const poles = polesOf(l.kind);
    const s = board.firstFit(l.id, poles);
    if (s == null) unplaced.push(l.id);
    else {
      board.place(l.id, s, poles);
      starts.set(l.id, s);
    }
  }
  for (const id of conflicts) unplaced.push(id);

  return buildLayout(panel, loads, mode, board, starts, unplaced, conflicts);
}

export function buildLayout(
  panel: Panel,
  loads: Load[],
  mode: ServiceMode,
  board: Board,
  starts: Map<string, number>,
  unplaced: string[] = [],
  conflicts: string[] = [],
): PanelLayout {
  const placements = new Map<string, Placement>();
  for (const l of loads) {
    const start = starts.get(l.id);
    if (start == null) continue;
    const slots = spanOf(start, polesOf(l.kind));
    placements.set(l.id, {
      loadId: l.id,
      slot: start,
      slots,
      phases: slots.map((s) => phaseOfSlot(s, mode)).sort(),
      tandem: polesOf(l.kind) === 1 && board.wantsTandem(l.id),
      half:
        polesOf(l.kind) === 1 && board.wantsTandem(l.id)
          ? board.occupants(start).indexOf(l.id)
            ? 'B'
            : 'A'
          : undefined,
    });
  }
  const spaceMap = new Map<number, string[]>();
  let spacesUsed = 0;
  for (let s = 1; s <= panel.spaces; s++) {
    const occ = board.occupants(s);
    if (occ.length) {
      spaceMap.set(s, occ);
      spacesUsed++;
    }
  }
  return {
    panelId: panel.id,
    placements,
    spaceMap,
    unplaced,
    conflicts,
    spacesUsed,
    circuitsUsed: board.circuits,
  };
}
