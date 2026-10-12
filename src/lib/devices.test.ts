import { describe, expect, it } from 'vitest';
import type { Device, Load, LoadKind } from '../types';
import { newDevice, sanitize, defaultState } from '../state';
import { circuitAmps } from './loadCalc';
import { sizeLoad } from './sizing';

const circuit = (kind: LoadKind, devices: Partial<Device>[], extra: Partial<Load> = {}): Load => ({
  id: 'c',
  panelId: 'p',
  name: '',
  amps: 99,
  estAmps: 50,
  kind,
  continuous: true,
  tandem: false,
  slot: null,
  locked: false,
  devices: devices.map((d) => newDevice(d)),
  ...extra,
});

describe('devices', () => {
  it('without devices, the circuit uses its own fields', () => {
    expect(circuitAmps(circuit('120-1p', []))).toEqual({ max: 99, design: 123.75, est: 50, continuous: true });
  });

  it('sums devices, converting watts at the circuit voltage, and ignores the circuit fields', () => {
    const c = circuit('120-1p', [
      { name: 'Microwave', max: 1200, est: 120 },
      { name: 'Toaster', max: 1100 }, // est blank → max
      { name: 'Clock', unit: 'A', max: 0.5, qty: 2 },
    ]);
    const a = circuitAmps(c);
    expect(a.max).toBeCloseTo(10 + 1100 / 120 + 1);
    expect(a.est).toBeCloseTo(1 + 1100 / 120 + 1);
    expect(a.continuous).toBe(false);
    expect(a.design).toBeCloseTo(a.max);
  });

  it('sizes the breaker at 125% of continuous devices plus 100% of the rest', () => {
    // 12 A continuous + 5 A non-continuous → 15 + 5 = 20 A → 20 A breaker.
    const c = circuit('120-1p', [
      { unit: 'A', max: 12, continuous: true },
      { unit: 'A', max: 5 },
    ]);
    expect(circuitAmps(c).design).toBeCloseTo(20);
    expect(sizeLoad(c).breaker).toBe(20);
    // Flagging the whole 17 A circuit continuous would have needed 25 A.
    expect(sizeLoad({ ...c, devices: [], amps: 17, continuous: true }).breaker).toBe(25);
  });

  it('converts watts with √3·V on 3-phase circuits', () => {
    const c = circuit('208-3p', [{ max: 10000 }]);
    expect(circuitAmps(c).max).toBeCloseTo(10000 / (208 * Math.sqrt(3)));
  });

  it('kW comes from the device totals', () => {
    const c = circuit('240-2p', [{ max: 4800, est: 2400 }]);
    expect(sizeLoad(c).kw).toBeCloseTo(4.8);
    expect(sizeLoad(c).estKw).toBeCloseTo(2.4);
  });

  it('round-trips devices through saved state', () => {
    const s = defaultState();
    s.loads[0] = { ...s.loads[0], devices: [newDevice({ name: 'Fridge', max: 700, est: 150, qty: 1 })] };
    const back = sanitize(JSON.parse(JSON.stringify(s)))!;
    expect(back.loads[0].devices).toEqual(s.loads[0].devices);
    // Older saves without devices still load.
    const old = JSON.parse(JSON.stringify(s));
    delete old.loads[1].devices;
    expect(sanitize(old)!.loads[1].devices).toEqual([]);
  });
});
