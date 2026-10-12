import { describe, expect, it } from 'vitest';
import type { Load, LoadKind, Panel, ServiceMode } from '../types';
import { layoutPanel } from './placement';
import { optimizePanel } from './optimize';
import { phaseTotals } from './loadCalc';

const panel: Panel = { id: 'p', name: 'P', mainA: 200, fedFrom: null, spaces: 20, maxCircuits: 40 };
let n = 0;
const load = (kind: LoadKind, amps: number, extra: Partial<Load> = {}): Load => ({
  id: `l${n++}`,
  panelId: 'p',
  name: '',
  amps,
  kind,
  continuous: false,
  slot: null,
  locked: false,
  ...extra,
});

function run(loads: Load[], mode: ServiceMode) {
  const res = optimizePanel(panel, loads, mode, layoutPanel(panel, loads, mode));
  const applied = loads.map((l) => (res.slots.has(l.id) ? { ...l, slot: res.slots.get(l.id)! } : l));
  const after = phaseTotals(applied, layoutPanel(panel, applied, mode).placements).worst;
  return { res, after, applied };
}

describe('optimizePanel', () => {
  it('balances six 120 V loads across three phases', () => {
    const loads = [20, 20, 15, 15, 10, 10].map((a) => load('120-1p', a));
    // Auto layout puts them A,A,B,B,C,C → 40/30/20.
    const { res, after, applied } = run(loads, 'three');
    expect(res.improved).toBe(true);
    expect(after).toEqual({ A: 30, B: 30, C: 30 });
    // Compaction keeps them in the first three rows.
    expect(Math.max(...applied.map((l) => l.slot!))).toBeLessThanOrEqual(6);
  });

  it('balances 2-pole and 1-pole loads in split phase', () => {
    const loads = [load('240-2p', 30), load('120-1p', 12), load('120-1p', 12), load('120-1p', 8), load('120-1p', 8)];
    const { after } = run(loads, 'split');
    expect(after.A).toBe(after.B);
  });

  it('balances 208 V 1Φ loads across phase pairs', () => {
    const loads = [load('208-2p', 30), load('208-2p', 30), load('208-2p', 30)];
    const { after } = run(loads, 'three');
    expect(after).toEqual({ A: 60, B: 60, C: 60 });
  });

  it('leaves locked circuits in place', () => {
    const locked = load('120-1p', 50, { slot: 1, locked: true });
    const loads = [locked, load('120-1p', 20), load('120-1p', 20), load('120-1p', 10)];
    const { res, applied } = run(loads, 'three');
    expect(res.slots.has(locked.id)).toBe(false);
    expect(applied[0].slot).toBe(1);
  });

  it('never makes the worst phase worse', () => {
    const loads = [load('120-1p', 10, { slot: 1 }), load('120-1p', 10, { slot: 3 }), load('120-1p', 10, { slot: 5 })];
    const { res, after } = run(loads, 'three');
    expect(res.improved).toBe(false);
    expect(after).toEqual({ A: 10, B: 10, C: 10 });
  });

  it('weights continuous loads at 125%', () => {
    const loads = [load('120-1p', 16, { continuous: true }), load('120-1p', 20), load('120-1p', 20)];
    const { after } = run(loads, 'split');
    // 20 vs 20+20 or 20+20 vs 20 — the 20 A continuous load (16×1.25) sits alone.
    expect(Math.max(after.A, after.B)).toBe(40);
  });
});
