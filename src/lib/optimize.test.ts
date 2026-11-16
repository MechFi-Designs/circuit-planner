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
  equip: 'general',
  hp: null,
  motorStart: 'dol',
  motorBasis: 'table',
  mca: null,
  mocp: null,
  breakerA: null,
  slot: null,
  estAmps: null,
  locked: false,
  ...extra,
});

function run(loads: Load[], mode: ServiceMode, p: Panel = panel) {
  const res = optimizePanel(p, loads, mode, layoutPanel(p, loads, mode));
  const applied = loads.map((l) => (res.slots.has(l.id) ? { ...l, slot: res.slots.get(l.id)! } : l));
  const after = phaseTotals(applied, layoutPanel(p, applied, mode).placements).max;
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

  it('pairs tandem circuits when the panel is tight, and still balances', () => {
    // 5 spaces for 6 tandem + 2 regular circuits: every tandem must pair up.
    const tight: Panel = { ...panel, spaces: 5, maxCircuits: 10 };
    const twins = [20, 20, 12, 12, 8, 8].map((a) => load('120-1p', a, { tandem: true }));
    const regular = [load('120-1p', 16), load('120-1p', 16)];
    const loads = [...twins, ...regular];
    const res = optimizePanel(tight, loads, 'split', layoutPanel(tight, loads, 'split'));
    const applied = loads.map((l) => (res.slots.has(l.id) ? { ...l, slot: res.slots.get(l.id)! } : l));
    const lay = layoutPanel(tight, applied, 'split');
    expect(lay.unplaced).toEqual([]);
    expect(new Set(twins.map((l) => lay.placements.get(l.id)!.slot)).size).toBe(3);
    const after = phaseTotals(applied, lay.placements).max;
    expect(Math.max(after.A, after.B)).toBeLessThanOrEqual(64);
  });

  it('with spare spaces, tandem circuits can start a new tandem to balance; regular circuits never share', () => {
    const twins = [20, 20, 12, 12, 8, 8].map((a) => load('120-1p', a, { tandem: true }));
    const regular = [load('120-1p', 16), load('120-1p', 16)];
    const { applied, after } = run([...twins, ...regular], 'split');
    const lay = layoutPanel(panel, applied, 'split');
    for (const r of regular) expect(lay.spaceMap.get(lay.placements.get(r.id)!.slot)).toHaveLength(1);
    expect(after.A).toBe(after.B);
  });

  it('uses empty spaces on the light phase instead of only swapping within full tandems', () => {
    // Like the user's Panel B: every tandem space full, heavy on B, empty spaces on C.
    const three: Panel = { ...panel, spaces: 18, maxCircuits: 36 };
    const mk = (amps: number, slot: number) => load('120-1p', amps, { tandem: true, slot });
    const loads = [
      mk(20, 3),
      mk(20, 3), // B
      mk(20, 4),
      mk(4, 4), // B
      mk(20, 5),
      mk(20, 5), // C
      mk(20, 1),
      mk(4, 1), // A
      mk(20, 7),
      mk(8, 7), // A
    ];
    const before = phaseTotals(loads, layoutPanel(three, loads, 'three').placements).max;
    expect(before).toEqual({ A: 52, B: 64, C: 40 });
    const { after } = run(loads, 'three', three);
    // Seven 20 A circuits on three phases: one phase must carry three, so 60 A is the best possible.
    expect(Math.max(after.A, after.B, after.C)).toBe(60);
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
