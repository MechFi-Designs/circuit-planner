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
  tandem: false,
  devices: [],
  slot: null,
  estAmps: null,
  locked: false,
  ...extra,
});

function run(loads: Load[], mode: ServiceMode) {
  const res = optimizePanel(panel, loads, mode, layoutPanel(panel, loads, mode));
  const applied = loads.map((l) => (res.slots.has(l.id) ? { ...l, slot: res.slots.get(l.id)! } : l));
  const after = phaseTotals(applied, layoutPanel(panel, applied, mode).placements).max;
  return { res, after, applied };
}

describe('optimizePanel', () => {
  it('balances six 120 V loads across three phases', () => {
    const loads = [20, 20, 15, 15, 10, 10].map((a) => load('120-1p', a));
    // Auto layout puts them A,A,B,B,C,C → 40/30/20.
    const { res, after, applied } = run(loads, 'three');
    expect(res.changed).toBe(true);
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

  it('never makes the design phase worse', () => {
    const loads = [load('120-1p', 10, { slot: 1 }), load('120-1p', 10, { slot: 3 }), load('120-1p', 10, { slot: 5 })];
    const { res, after } = run(loads, 'three');
    expect(res.changed).toBe(false);
    expect(after).toEqual({ A: 10, B: 10, C: 10 });
  });

  it('moves a circuit that was pinned and then unlocked, even when phases are already balanced', () => {
    // Pinned out at slot 19 (phase A), then unlocked. Balance is equal either way.
    const loads = [load('120-1p', 10, { slot: 19, locked: false }), load('120-1p', 10), load('120-1p', 10)];
    const { res, applied } = run(loads, 'three');
    expect(res.changed).toBe(true);
    expect(Math.max(...applied.map((l) => l.slot!))).toBeLessThanOrEqual(6);
  });

  it('is stable: a second Optimize changes nothing', () => {
    const loads = [20, 20, 15, 15, 10, 10].map((a) => load('120-1p', a));
    const { applied } = run(loads, 'three');
    expect(run(applied, 'three').res.changed).toBe(false);
  });

  it('keeps tandem circuits paired and balances the pairs', () => {
    const twins = [20, 20, 12, 12, 8, 8].map((a) => load('120-1p', a, { tandem: true }));
    const regular = [load('120-1p', 16), load('120-1p', 16)];
    const { applied, after } = run([...twins, ...regular], 'split');
    const lay = layoutPanel(panel, applied, 'split');
    const spaceOf = (l: Load) => lay.placements.get(l.id)!.slot;
    // 6 tandem circuits share 3 spaces; regular circuits never share.
    expect(new Set(twins.map(spaceOf)).size).toBe(3);
    for (const r of regular) expect(lay.spaceMap.get(spaceOf(r))).toHaveLength(1);
    expect(after.A).toBe(after.B);
  });

  it('can balance on estimated load instead of max load', () => {
    // A CNC-style load: big nameplate, small typical draw.
    const mill = load('120-1p', 20, { estAmps: 2 });
    const loads = [mill, load('120-1p', 10), load('120-1p', 10)];
    const lay = layoutPanel(panel, loads, 'split');
    const settle = (basis: 'max' | 'est') => {
      const res = optimizePanel(panel, loads, 'split', lay, new Map(), basis);
      const applied = loads.map((l) => (res.slots.has(l.id) ? { ...l, slot: res.slots.get(l.id)! } : l));
      return phaseTotals(applied, layoutPanel(panel, applied, 'split').placements);
    };
    // Max: mill alone vs the two 10 A loads → 20 / 20 max, but 2 / 20 estimated.
    const byMax = settle('max');
    expect(Math.max(byMax.max.A, byMax.max.B)).toBe(20);
    expect(Math.max(byMax.est.A, byMax.est.B)).toBe(20);
    // Estimated: mill shares a leg with one 10 A load → 12 / 10 estimated.
    const byEst = settle('est');
    expect(Math.max(byEst.est.A, byEst.est.B)).toBe(12);
  });

  it('balances real current, not the 125% sizing figure', () => {
    // Real: {16, 15} | {17} → 31 A peak. Balancing the sizing figure (16 → 20)
    // would pick {17, 15} | {16} → 32 A real peak.
    const loads = [load('120-1p', 16, { continuous: true }), load('120-1p', 17), load('120-1p', 15)];
    const { after } = run(loads, 'split');
    expect(Math.max(after.A, after.B)).toBe(31);
  });
});
