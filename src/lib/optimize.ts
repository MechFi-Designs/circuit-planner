import type { AppState, Load, Panel, ServiceMode } from '../types';
import { derive, feederTotals, postOrder } from './derive';
import { MODE_PHASES, phaseOfSlot, polesOf } from './nec';
import { Board, spanOf, type PanelLayout } from './placement';
import { phaseTotals, worstAmps, zeroPhases, type PhaseAmps, type PhaseTotals } from './loadCalc';

export interface OptimizeResult {
  /** New starting slot for each movable load. Empty when nothing changed. */
  slots: Map<string, number>;
  before: PhaseAmps;
  after: PhaseAmps;
  improved: boolean;
  /** True when the movable loads could not all be fit around the locked ones. */
  failed: boolean;
}

const EPS = 1e-9;
const MAX_PASSES = 500;

type Score = [number, number, number];

function score(amps: PhaseAmps, mode: ServiceMode): Score {
  const vals = MODE_PHASES[mode].map((p) => amps[p]);
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  return [max, max - min, vals.reduce((s, v) => s + v * v, 0)];
}

/** Lexicographic: lower highest phase, then lower spread, then lower sum of squares. */
function better(a: Score, b: Score): boolean {
  for (let i = 0; i < a.length; i++) {
    if (a[i] < b[i] - EPS) return true;
    if (a[i] > b[i] + EPS) return false;
  }
  return false;
}

/**
 * Re-slot unlocked circuits in a panel to balance worst-case phase current.
 * Greedy seed (largest first, best phase position) followed by local search
 * of single moves and same-pole-count swaps.
 *
 * `feeders` holds subpanel totals for feeder breakers. A feeder's poles always
 * cover every phase (2-pole split / 3-pole 3-phase), so its contribution is
 * fixed and it only competes for space.
 */
export function optimizePanel(
  panel: Panel,
  loads: Load[],
  mode: ServiceMode,
  current: PanelLayout,
  feeders: Map<string, PhaseTotals> = new Map(),
): OptimizeResult {
  const before = phaseTotals(loads, current.placements, feeders).worst;
  const noChange = (failed: boolean): OptimizeResult => ({
    slots: new Map(),
    before,
    after: before,
    improved: false,
    failed,
  });

  const board = new Board(panel.spaces, panel.maxCircuits);
  const starts = new Map<string, number>();
  const amps = zeroPhases();

  const add = (l: Load, start: number, sign: 1 | -1, target: PhaseAmps = amps) => {
    const fed = feeders.get(l.id);
    if (fed) {
      for (const ph of MODE_PHASES[mode]) target[ph] += sign * fed.worst[ph];
      return;
    }
    const w = worstAmps(l);
    for (const s of spanOf(start, polesOf(l.kind))) target[phaseOfSlot(s, mode)] += sign * w;
  };

  for (const l of loads) {
    const p = current.placements.get(l.id);
    if (l.locked && p) {
      board.place(l.id, p.slot, polesOf(l.kind));
      starts.set(l.id, p.slot);
      add(l, p.slot, 1);
    } else if (l.locked && feeders.has(l.id)) {
      add(l, 0, 1); // unplaced locked feeder: its load still counts
    }
  }

  const movable = loads
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => !l.locked)
    .sort((a, b) => polesOf(b.l.kind) - polesOf(a.l.kind) || worstAmps(b.l) - worstAmps(a.l) || a.i - b.i)
    .map(({ l }) => l);
  if (!movable.length) return noChange(false);

  // Greedy seed.
  for (const l of movable) {
    const poles = polesOf(l.kind);
    let cands: number[] = [];
    for (let s = 1; s <= panel.spaces; s++) if (board.canPlace(s, poles)) cands.push(s);
    if (!cands.length && poles === 1) {
      for (let s = 1; s <= panel.spaces; s++) if (board.canPlace(s, 1, true)) cands.push(s);
    }
    if (!cands.length) return noChange(true);
    let best = cands[0];
    let bestScore: Score | null = null;
    for (const s of cands) {
      const trial = { ...amps };
      add(l, s, 1, trial);
      const sc = score(trial, mode);
      if (!bestScore || better(sc, bestScore)) {
        best = s;
        bestScore = sc;
      }
    }
    board.place(l.id, best, poles);
    starts.set(l.id, best);
    add(l, best, 1);
  }

  // Local search: first-improvement moves and swaps until nothing helps.
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const cur = score(amps, mode);
    let moved = false;

    for (const l of movable) {
      const poles = polesOf(l.kind);
      const s0 = starts.get(l.id)!;
      board.remove(l.id, s0, poles);
      add(l, s0, -1);
      let target: number | null = null;
      for (let s = 1; s <= panel.spaces && target == null; s++) {
        if (s === s0 || !board.canPlace(s, poles)) continue;
        const trial = { ...amps };
        add(l, s, 1, trial);
        if (better(score(trial, mode), cur)) target = s;
      }
      const dest = target ?? s0;
      board.place(l.id, dest, poles);
      starts.set(l.id, dest);
      add(l, dest, 1);
      if (target != null) {
        moved = true;
        break;
      }
    }
    if (moved) continue;

    outer: for (let i = 0; i < movable.length; i++) {
      for (let j = i + 1; j < movable.length; j++) {
        const a = movable[i];
        const b = movable[j];
        const poles = polesOf(a.kind);
        if (poles !== polesOf(b.kind)) continue;
        const sa = starts.get(a.id)!;
        const sb = starts.get(b.id)!;
        const trial = { ...amps };
        add(a, sa, -1, trial);
        add(b, sb, -1, trial);
        add(a, sb, 1, trial);
        add(b, sa, 1, trial);
        if (!better(score(trial, mode), cur)) continue;
        board.remove(a.id, sa, poles);
        board.remove(b.id, sb, poles);
        board.place(a.id, sb, poles);
        board.place(b.id, sa, poles);
        starts.set(a.id, sb);
        starts.set(b.id, sa);
        Object.assign(amps, trial);
        moved = true;
        break outer;
      }
    }
    if (!moved) break;
  }

  // Compact: slide each circuit to the lowest free start on the same phases.
  const signature = (start: number, poles: number) =>
    spanOf(start, poles)
      .map((s) => phaseOfSlot(s, mode))
      .sort()
      .join('');
  for (let changed = true; changed;) {
    changed = false;
    for (const l of [...movable].sort((a, b) => starts.get(a.id)! - starts.get(b.id)!)) {
      const poles = polesOf(l.kind);
      const s0 = starts.get(l.id)!;
      const sig = signature(s0, poles);
      board.remove(l.id, s0, poles);
      let dest = s0;
      for (let s = 1; s < s0; s++) {
        if (board.canPlace(s, poles) && signature(s, poles) === sig) {
          dest = s;
          break;
        }
      }
      board.place(l.id, dest, poles);
      starts.set(l.id, dest);
      if (dest !== s0) changed = true;
    }
  }

  const placedMore = current.unplaced.length > current.conflicts.length;
  if (!placedMore && !better(score(amps, mode), score(before, mode))) return noChange(false);

  const slots = new Map<string, number>();
  for (const l of movable) slots.set(l.id, starts.get(l.id)!);
  return { slots, before, after: { ...amps }, improved: true, failed: false };
}

export interface OptimizeAllResult {
  slots: Map<string, number>;
  before: PhaseAmps;
  after: PhaseAmps;
  /** Names of panels whose circuits couldn't all be fit around locked ones. */
  failed: string[];
}

/**
 * Optimize every panel, subpanels first, so each parent sees its subpanels'
 * rebalanced totals through their feeders.
 */
export function optimizeAll(state: AppState): OptimizeAllResult {
  let working = state;
  const slots = new Map<string, number>();
  const failed: string[] = [];
  for (const p of postOrder(state.panels)) {
    const d = derive(working);
    const loads = working.loads.filter((l) => l.panelId === p.id);
    const res = optimizePanel(p, loads, state.mode, d.layouts.get(p.id)!, feederTotals(d, loads));
    if (res.failed) failed.push(p.name);
    if (!res.improved) continue;
    res.slots.forEach((s, id) => slots.set(id, s));
    working = {
      ...working,
      loads: working.loads.map((l) => (res.slots.has(l.id) ? { ...l, slot: res.slots.get(l.id)! } : l)),
    };
  }
  return { slots, before: derive(state).service.worst, after: derive(working).service.worst, failed };
}
