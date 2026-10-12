import { describe, expect, it } from 'vitest';
import type { Load, LoadKind, Panel } from '../types';
import { layoutPanel } from './placement';

const panel = (spaces = 20, maxCircuits = 40): Panel => ({
  id: 'p',
  name: 'P',
  mainA: 200,
  fedFrom: null,
  spaces,
  maxCircuits,
});
let n = 0;
const load = (kind: LoadKind, amps = 10, extra: Partial<Load> = {}): Load => ({
  id: `l${n++}`,
  panelId: 'p',
  name: '',
  amps,
  kind,
  continuous: false,
  slot: null,
  estAmps: null,
  locked: false,
  ...extra,
});

describe('layoutPanel', () => {
  it('2-pole in split phase lands on A+B', () => {
    const l = load('240-2p');
    const p = layoutPanel(panel(), [l], 'split').placements.get(l.id)!;
    expect(p.slots).toEqual([1, 3]);
    expect(p.phases).toEqual(['A', 'B']);
  });

  it('3-pole in 3-phase lands on A+B+C', () => {
    const l = load('208-3p');
    const p = layoutPanel(panel(), [l], 'three').placements.get(l.id)!;
    expect(p.phases).toEqual(['A', 'B', 'C']);
  });

  it('fills in table order and skips occupied spaces', () => {
    const a = load('120-1p', 10, { slot: 1, locked: true });
    const b = load('240-2p');
    const lay = layoutPanel(panel(), [a, b], 'split');
    expect(lay.placements.get(b.id)!.slots).toEqual([2, 4]);
  });

  it('uses tandems once full-size spaces run out', () => {
    const loads = Array.from({ length: 6 }, () => load('120-1p'));
    const lay = layoutPanel(panel(4, 8), loads, 'split');
    expect(lay.unplaced).toEqual([]);
    expect([...lay.placements.values()].filter((p) => p.tandem)).toHaveLength(4);
  });

  it('no tandems when max circuits equals spaces', () => {
    const loads = Array.from({ length: 5 }, () => load('120-1p'));
    const lay = layoutPanel(panel(4, 4), loads, 'split');
    expect(lay.unplaced).toHaveLength(1);
  });

  it('flags locked slot conflicts', () => {
    const a = load('120-1p', 10, { slot: 3, locked: true });
    const b = load('240-2p', 10, { slot: 1, locked: true });
    const lay = layoutPanel(panel(20, 20), [a, b], 'split');
    expect(lay.conflicts).toEqual([b.id]);
  });
});
