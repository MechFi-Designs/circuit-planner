import { describe, expect, it } from 'vitest';
import type { AppState, Load, LoadKind } from '../types';
import { motorFlc, formatWire } from './nec';
import { sizeLoad } from './sizing';
import { derive } from './derive';

let n = 0;
const circuit = (kind: LoadKind, amps: number, extra: Partial<Load> = {}): Load => ({
  id: `e${n++}`,
  panelId: 'p',
  name: '',
  amps,
  estAmps: null,
  kind,
  continuous: false,
  tandem: false,
  slot: null,
  locked: false,
  devices: [],
  equip: 'general',
  hp: null,
  motorStart: 'dol',
  mca: null,
  mocp: null,
  breakerA: null,
  ...extra,
});

describe('NEC motor full-load current tables', () => {
  it('single-phase (430.248) and three-phase (430.250)', () => {
    expect(motorFlc('208-2p', 10)).toBe(55);
    expect(motorFlc('240-2p', 10)).toBe(50);
    expect(motorFlc('120-1p', 1)).toBe(16);
    expect(motorFlc('208-3p', 10)).toBe(30.8);
    expect(motorFlc('208-3p', 12)).toBe(46.2); // between rows → next size up (15 hp)
    expect(motorFlc('208-2p', 15)).toBeNull(); // off the single-phase table
  });
});

describe('motor circuits (NEC 430)', () => {
  it('10 hp single-phase magnetic-start compressor at 208 V', () => {
    // Nameplate 40 A, but sizing uses the table FLC of 55 A.
    const s = sizeLoad(circuit('208-2p', 40, { equip: 'motor', hp: 10, motorStart: 'dol' }));
    expect(s.flc).toBe(55);
    expect(s.flcFromTable).toBe(true);
    expect(s.required).toBeCloseTo(68.75); // 125% of FLC
    expect(formatWire(s.cu)).toBe('#4'); // #6 is only 65 A
    expect(s.maxAllowed).toBe(150); // 250% = 137.5 → next size up
    expect(s.breaker).toBe(100); // default 175% = 96.25 → 100 A
    expect(s.issues).toEqual([]);
  });

  it('10 hp three-phase motor at 208 V', () => {
    const s = sizeLoad(circuit('208-3p', 28, { equip: 'motor', hp: 10 }));
    expect(formatWire(s.cu)).toBe('#8'); // 38.5 A
    expect([s.breaker, s.maxAllowed]).toEqual([60, 80]);
  });

  it('drive-fed motor sizes from its input current with no 430.52 table limit', () => {
    const s = sizeLoad(circuit('208-3p', 40, { equip: 'motor', hp: 15, motorStart: 'vfd' }));
    expect(s.flc).toBe(40);
    expect(s.required).toBe(50);
    expect([s.breaker, s.maxAllowed, formatWire(s.cu)]).toEqual([50, null, '#8']);
  });

  it('asks for horsepower when it is missing', () => {
    expect(sizeLoad(circuit('208-2p', 40, { equip: 'motor' })).issues[0]).toMatch(/horsepower/);
  });

  it('flags a breaker above the 430.52 maximum or too small to start', () => {
    const big = sizeLoad(circuit('208-2p', 40, { equip: 'motor', hp: 10, breakerA: 175 }));
    expect(big.issues.join(' ')).toMatch(/above the 150 A maximum/);
    const small = sizeLoad(circuit('208-2p', 40, { equip: 'motor', hp: 10, breakerA: 60 }));
    expect(small.issues.join(' ')).toMatch(/may trip on start/);
  });
});

describe('HVAC circuits (NEC 440)', () => {
  const ac = (extra: Partial<Load> = {}) =>
    sizeLoad(circuit('208-2p', 36.05, { equip: 'hvac', mca: 42, mocp: 60, ...extra }));

  it('wire to the MCA and breaker defaulting to the MOCP', () => {
    const s = ac();
    expect(formatWire(s.cu)).toBe('#8');
    expect([s.breaker, s.maxAllowed]).toEqual([60, 60]);
  });

  it('an existing 40 A breaker is below the MCA and gets a warning', () => {
    const s = ac({ breakerA: 40 });
    expect(s.breaker).toBe(40);
    expect(formatWire(s.cu)).toBe('#8'); // wire still follows the MCA
    expect(s.issues.join(' ')).toMatch(/below the 42 A MCA/);
  });

  it('flags a breaker above the MOCP', () => {
    expect(ac({ breakerA: 70 }).issues.join(' ')).toMatch(/above the 60 A nameplate MOCP/);
  });
});

describe('breaker override on general circuits', () => {
  it('upsizes the wire with the breaker and flags a breaker that is too small', () => {
    expect(formatWire(sizeLoad(circuit('120-1p', 16, { breakerA: 30 })).cu)).toBe('#10');
    expect(sizeLoad(circuit('120-1p', 16, { continuous: true, breakerA: 15 })).issues[0]).toMatch(/below the 20 A/);
  });
});

describe('NEC 430.24 largest motor at 125% on feeders and the service', () => {
  it('adds 25% of the largest motor FLC to its phases', () => {
    const state: AppState = {
      mode: 'split',
      serviceA: 200,
      optimizeAcrossPanels: false,
      balanceOn: 'max',
      panels: [{ id: 'p', name: 'P', mainA: 200, fedFrom: null, spaces: 20, maxCircuits: 40 }],
      loads: [
        circuit('240-2p', 40, { equip: 'motor', hp: 10 }), // FLC 50
        circuit('240-2p', 20, { equip: 'motor', hp: 3 }), // FLC 17
        circuit('120-1p', 10),
      ],
    };
    const d = derive(state);
    // Max load is real current: 40 + 20 + 10 on one leg.
    expect(d.service.max.A).toBe(70);
    // Sizing: FLCs 50 + 17 + 10, plus 25% of 50.
    expect(d.service.design.A).toBeCloseTo(50 + 17 + 10 + 12.5);
    expect(d.service.design.B).toBeCloseTo(50 + 17 + 12.5);
  });
});
