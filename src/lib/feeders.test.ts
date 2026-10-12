import { describe, expect, it } from 'vitest';
import type { AppState, Load, LoadKind } from '../types';
import { parseFile, reducer, sanitize } from '../state';
import { derive } from './derive';
import { optimizeAll } from './optimize';

let n = 0;
const load = (panelId: string, kind: LoadKind, amps: number, extra: Partial<Load> = {}): Load => ({
  id: `l${n++}`,
  panelId,
  name: '',
  amps,
  kind,
  continuous: false,
  slot: null,
  locked: false,
  ...extra,
});

function twoPanels(mode: AppState['mode'] = 'split'): AppState {
  const base: AppState = {
    mode,
    serviceA: 200,
    panels: [{ id: 'main', name: 'Main', mainA: 200, fedFrom: null, spaces: 20, maxCircuits: 40 }],
    loads: [load('main', '120-1p', 20)],
  };
  let s = reducer(base, { type: 'addPanel' });
  const sub = s.panels[1].id;
  s = { ...s, loads: [...s.loads, load(sub, mode === 'split' ? '240-2p' : '208-3p', 30)] };
  return s;
}

describe('subpanel feeders', () => {
  it('a new panel is a subpanel of the first, with a feeder breaker in it', () => {
    const s = twoPanels();
    const sub = s.panels[1];
    expect(sub.fedFrom).toBe('main');
    expect(sub.mainA).toBe(100);
    const feeders = s.loads.filter((l) => l.feeds === sub.id);
    expect(feeders).toHaveLength(1);
    expect(feeders[0].panelId).toBe('main');
    expect(feeders[0].kind).toBe('240-2p');
  });

  it('subpanel load rolls up into the parent and is counted once at the service', () => {
    const s = twoPanels();
    const d = derive(s);
    expect(d.totals.get(s.panels[1].id)!.worst).toMatchObject({ A: 30, B: 30 });
    // Parent: its own 20 A on A + the subpanel's 30/30 through the feeder.
    expect(d.totals.get('main')!.worst).toMatchObject({ A: 50, B: 30 });
    expect(d.service.worst).toMatchObject({ A: 50, B: 30 });
  });

  it('the feeder breaker takes 2 spaces in the parent and is sized at the feeder rating', () => {
    const s = twoPanels();
    const d = derive(s);
    const feeder = s.loads.find((l) => l.feeds)!;
    expect(d.layouts.get('main')!.placements.get(feeder.id)!.slots).toHaveLength(2);
    expect(d.sizing.get(feeder.id)).toMatchObject({ breaker: 100, required: 30 });
  });

  it('panels fed from the service add up at the service', () => {
    let s = twoPanels();
    s = reducer(s, { type: 'setFedFrom', id: s.panels[1].id, fedFrom: null });
    expect(s.loads.some((l) => l.feeds)).toBe(false);
    const d = derive(s);
    expect(d.totals.get('main')!.worst).toMatchObject({ A: 20, B: 0 });
    expect(d.service.worst).toMatchObject({ A: 50, B: 30 });
  });

  it('switching to 3-phase makes the feeder 3-pole', () => {
    const s = reducer(twoPanels(), { type: 'setMode', mode: 'three' });
    expect(s.loads.find((l) => l.feeds)!.kind).toBe('208-3p');
  });

  it('refuses feed loops', () => {
    const s = twoPanels();
    const looped = reducer(s, { type: 'setFedFrom', id: 'main', fedFrom: s.panels[1].id });
    expect(looped.panels[0].fedFrom).toBeNull();
  });

  it('removing a parent re-feeds its subpanels from the grandparent', () => {
    let s = twoPanels();
    s = reducer(s, { type: 'addPanel' }); // Panel C fed from main
    const [, b, c] = s.panels;
    s = reducer(s, { type: 'setFedFrom', id: c.id, fedFrom: b.id });
    s = reducer(s, { type: 'removePanel', id: b.id });
    expect(s.panels.find((p) => p.id === c.id)!.fedFrom).toBe('main');
    expect(s.loads.filter((l) => l.feeds === c.id).map((l) => l.panelId)).toEqual(['main']);
  });

  it('optimizeAll balances across a subpanel feeder', () => {
    const s = twoPanels();
    const sub = s.panels[1].id;
    // Subpanel can't balance alone (30/30 + one 20 A), so the parent's
    // three 20 A loads must make up for it through the feeder.
    const extra = [load(sub, '120-1p', 20), load('main', '120-1p', 20), load('main', '120-1p', 20)];
    const res = optimizeAll({ ...s, loads: [...s.loads, ...extra] });
    expect(res.after).toMatchObject({ A: 70, B: 70 });
  });

  it('saved files round-trip', () => {
    const s = twoPanels();
    const text = JSON.stringify({ app: 'circuit-planner', version: 1, state: s });
    expect(parseFile(text)).toEqual(sanitize(s));
    expect(parseFile('{"nope":1}')).toBeNull();
    expect(parseFile('not json')).toBeNull();
  });
});
