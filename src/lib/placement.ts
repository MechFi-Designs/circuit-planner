import type { Load, Panel, Phase, ServiceMode } from '../types';
import { phaseOfSlot, polesOf } from './nec';

export interface Placement {
  loadId: string;
  /** Starting space. */
  slot: number;
  /** All spaces the breaker occupies (same side, consecutive rows). */
  slots: number[];
  phases: Phase[];
  /** True when sharing a space with another 1-pole circuit. */
  tandem: boolean;
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

/** Mutable occupancy grid for one panel, shared by placement and the optimizer. */
export class Board {
  /** Per space: a multi-pole/full-size owner, or up to two 1-pole occupants. */
  private multi = new Map<number, string>();
  private singles = new Map<number, string[]>();
  circuits = 0;

  constructor(
    readonly spaces: number,
    readonly maxCircuits: number,
  ) {}

  isEmpty(space: number): boolean {
    return !this.multi.has(space) && !this.singles.get(space)?.length;
  }

  get tandemAllowed(): boolean {
    return this.maxCircuits > this.spaces;
  }

  /** Can a breaker with `poles` start at `start`? `tandem` allows doubling up a 1-pole space. */
  canPlace(start: number, poles: number, tandem = false): boolean {
    if (start < 1 || this.circuits + poles > this.maxCircuits) return false;
    const span = spanOf(start, poles);
    if (span[span.length - 1] > this.spaces) return false;
    if (poles === 1 && tandem) {
      return this.tandemAllowed && !this.multi.has(start) && (this.singles.get(start)?.length ?? 0) === 1;
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

  isTandem(space: number): boolean {
    return (this.singles.get(space)?.length ?? 0) > 1;
  }

  /** First start position that fits full-size, then (for 1-pole) as a tandem. */
  firstFit(poles: number): number | null {
    for (let s = 1; s <= this.spaces; s++) if (this.canPlace(s, poles)) return s;
    if (poles === 1) for (let s = 1; s <= this.spaces; s++) if (this.canPlace(s, 1, true)) return s;
    return null;
  }

  /** Place at a requested start: full-size if empty, tandem if half-occupied. */
  tryPlaceAt(id: string, start: number, poles: number): boolean {
    if (this.canPlace(start, poles) || (poles === 1 && this.canPlace(start, 1, true))) {
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
  const board = new Board(panel.spaces, panel.maxCircuits);
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
    const s = board.firstFit(poles);
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
      tandem: polesOf(l.kind) === 1 && board.isTandem(start),
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
