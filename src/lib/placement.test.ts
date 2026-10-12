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
  tandem: false,
  devices: [],
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

  it('pairs tandem circuits two to a space on the same phase', () => {
    const loads = Array.from({ length: 3 }, () => load('120-1p', 10, { tandem: true }));
    const lay = layoutPanel(panel(), loads, 'split');
    const [a, b, c] = loads.map((l) => lay.placements.get(l.id)!);
    expect([a.slot, a.half, b.slot, b.half]).toEqual([1, 'A', 1, 'B']);
    expect(a.phases).toEqual(b.phases);
    // The odd one out starts a new tandem with a spare half.
    expect([c.slot, c.half, c.tandem]).toEqual([2, 'A', true]);
    expect(lay.spacesUsed).toBe(2);
  });

  it('does not double up circuits that are not marked tandem', () => {
    const loads = Array.from({ length: 6 }, () => load('120-1p'));
    const lay = layoutPanel(panel(4, 8), loads, 'split');
    expect(lay.unplaced).toHaveLength(2);
    expect([...lay.placements.values()].some((p) => p.tandem)).toBe(false);
  });

  it('fits more circuits than spaces with tandems', () => {
    const loads = Array.from({ length: 8 }, () => load('120-1p', 10, { tandem: true }));
    const lay = layoutPanel(panel(4, 8), loads, 'split');
    expect(lay.unplaced).toEqual([]);
    expect(lay.circuitsUsed).toBe(8);
  });

  it('ignores the tandem flag in a panel that does not take tandems', () => {
    const loads = Array.from({ length: 5 }, () => load('120-1p', 10, { tandem: true }));
    const lay = layoutPanel(panel(4, 4), loads, 'split');
    expect(lay.unplaced).toHaveLength(1);
    expect([...lay.placements.values()].some((p) => p.tandem)).toBe(false);
  });

  it('pinning a regular circuit onto an occupied space is a conflict', () => {
    const a = load('120-1p', 10, { slot: 1, locked: true });
    const b = load('120-1p', 10, { slot: 1, locked: true });
    expect(layoutPanel(panel(), [a, b], 'split').conflicts).toEqual([b.id]);
  });

  it('pinning a tandem circuit onto an open tandem half pairs them', () => {
    const a = load('120-1p', 10, { slot: 5, locked: true, tandem: true });
    const b = load('120-1p', 10, { slot: 5, locked: true, tandem: true });
    const lay = layoutPanel(panel(), [a, b], 'split');
    expect(lay.placements.get(b.id)!.half).toBe('B');
  });

  it('flags locked slot conflicts', () => {
    const a = load('120-1p', 10, { slot: 3, locked: true });
    const b = load('240-2p', 10, { slot: 1, locked: true });
    const lay = layoutPanel(panel(20, 20), [a, b], 'split');
    expect(lay.conflicts).toEqual([b.id]);
  });
});
