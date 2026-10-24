import { describe, expect, it } from 'vitest';
import type { AppState, Load, LoadKind, Panel } from '../types';
import { derive } from './derive';
import { optimizeAll } from './optimize';
import { optimizePreview, overloadAdvice } from './advice';
import { maxPhase } from './loadCalc';
import { syncFeeders } from '../state';

let n = 0;
const load = (panelId: string, kind: LoadKind, amps: number, extra: Partial<Load> = {}): Load => ({
  id: `a${n++}`,
  panelId,
  name: `c${n}`,
  amps,
  estAmps: null,
  kind,
  continuous: false,
  tandem: false,
  devices: [],
  equip: 'general',
  hp: null,
  motorStart: 'dol',
  mca: null,
  mocp: null,
  breakerA: null,
  slot: null,
  locked: false,
  ...extra,
});
const panel = (id: string, name: string, extra: Partial<Panel> = {}): Panel => ({
  id,
  name,
  mainA: 200,
  fedFrom: null,
  spaces: 30,
  maxCircuits: 60,
  ...extra,
});

// ~326 A per leg, all in panel A: 163% of a 200 A panel.
const heavy = () => [
  ...[40, 40, 50, 30, 30, 24, 20, 20].map((a) => load('a', '240-2p', a)),
  ...[16, 16, 16, 16, 12, 12, 20, 20].map((a) => load('a', '120-1p', a)),
];

const design = (panels: Panel[], loads: Load[]): AppState =>
  syncFeeders({ mode: 'split', serviceA: 400, optimizeAcrossPanels: true, balanceOn: 'max', panels, loads });

const util = (s: AppState, id: string) => {
  const d = derive(s);
  return maxPhase(d.totals.get(id)!.design, s.mode) / s.panels.find((p) => p.id === id)!.mainA;
};

function adviceFor(s: AppState) {
  const d = derive(s);
  return overloadAdvice(s, d, optimizePreview(s, d)).join(' ');
}

describe('keeping panels under their rating', () => {
  it('Optimize brings two service-fed panels under their ratings', () => {
    const s = design([panel('a', 'A'), panel('b', 'B')], heavy());
    expect(util(s, 'a')).toBeGreaterThan(1);
    const after = { ...s, loads: optimizeAll(s).loads! };
    expect(util(after, 'a')).toBeLessThanOrEqual(1);
    expect(util(after, 'b')).toBeLessThanOrEqual(1);
  });

  it('relieves every overloaded panel, not just the design one', () => {
    const loads = [...heavy(), ...[60, 60, 50].map((a) => load('b', '240-2p', a))];
    const s = design([panel('a', 'A'), panel('b', 'B'), panel('c', 'C', { mainA: 400 })], loads);
    const after = { ...s, serviceA: 800, loads: optimizeAll({ ...s, serviceA: 800 }).loads! };
    for (const id of ['a', 'b', 'c']) expect(util(after, id)).toBeLessThanOrEqual(1);
  });

  it('advice previews what Optimize can do', () => {
    const s = design([panel('a', 'A'), panel('b', 'B')], heavy());
    expect(adviceFor(s)).toMatch(
      /A has a [\d.]+ A max load, [\d.]+ A more than its 200 A main.*⚖ Optimize can bring it to \d+% of its rating/,
    );
  });

  it('advice points at subpanels fed through an overloaded panel', () => {
    const s = design(
      [panel('a', 'A'), panel('b', 'B', { fedFrom: 'a', mainA: 100 })],
      [...heavy(), load('b', '240-2p', 60)],
    );
    expect(adviceFor(s)).toMatch(/B is fed through it \(60 A\)\. Feeding it from the service/);
  });

  it("doesn't suggest re-feeding from the service when the service is the limit", () => {
    // 200 A service = 200 A main, with a 70 A subpanel fed from it; total load is over 200 A.
    const s = {
      ...design([panel('a', 'A'), panel('b', 'B', { fedFrom: 'a', mainA: 70 })], [...heavy(), load('b', '240-2p', 30)]),
      serviceA: 200,
    };
    const text = adviceFor(s);
    expect(text).toMatch(/The service has a [\d.]+ A max load/);
    expect(text).not.toMatch(/from the service instead/);
  });

  it('advice suggests re-feeding an empty subpanel from the service', () => {
    const s = design([panel('a', 'A'), panel('b', 'B', { fedFrom: 'a', mainA: 100 })], heavy());
    expect(adviceFor(s)).toMatch(/Moving circuits into B wouldn't help.*Feed it from the service/);
  });

  it('advice mentions locked circuits', () => {
    const locked = heavy().map((l, i) => (i < 8 ? { ...l, locked: true } : l));
    const s = design([panel('a', 'A'), panel('b', 'B')], locked);
    expect(adviceFor(s)).toMatch(/8 locked circuits stay put/);
  });

  it('advice for a single panel suggests a bigger rating or another panel', () => {
    const s = design([panel('a', 'A')], heavy());
    expect(adviceFor(s)).toMatch(/Raise the rating, or add a panel/);
  });

  it('service overload says rearranging cannot help', () => {
    const s = { ...design([panel('a', 'A')], heavy()), serviceA: 200 };
    expect(adviceFor(s)).toMatch(
      /The service has a [\d.]+ A max load, [\d.]+ A more than its 200 A rating. Moving circuits around can't fix that/,
    );
  });

  it('explains when only the 125% sizing margin puts a panel over', () => {
    // 180 A of real load, all continuous: 225 A for sizing on a 200 A main.
    const loads = [load('a', '240-2p', 100, { continuous: true }), load('a', '240-2p', 80, { continuous: true })];
    expect(adviceFor(design([panel('a', 'A')], loads))).toMatch(
      /A has a 180 A max load, but sizing counts continuous loads at 125% \(225 A\), 25 A more than its 200 A main/,
    );
  });

  it('no advice when nothing is overloaded', () => {
    expect(adviceFor(design([panel('a', 'A')], [load('a', '120-1p', 20)]))).toBe('');
  });
});
