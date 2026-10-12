import { describe, expect, it } from 'vitest';
import { formatWire, kwOf, requiredAmpacity, sizeBreaker, sizeEgc, sizeWire } from './nec';

function size(amps: number, continuous = false) {
  const breaker = sizeBreaker(requiredAmpacity(amps, continuous))!;
  return { breaker, cu: formatWire(sizeWire(breaker, 'cu')), al: formatWire(sizeWire(breaker, 'al')) };
}

describe('breaker and wire sizing', () => {
  it('16 A non-continuous → 20 A, #12 Cu, #10 Al', () => {
    expect(size(16)).toEqual({ breaker: 20, cu: '#12', al: '#10' });
  });
  it('16 A continuous → 20 A (16 × 1.25 = 20)', () => {
    expect(size(16, true)).toEqual({ breaker: 20, cu: '#12', al: '#10' });
  });
  it('17 A continuous → 25 A, #10 Cu', () => {
    expect(size(17, true)).toEqual({ breaker: 25, cu: '#10', al: '#10' });
  });
  it('40 A continuous → 50 A, #8 Cu, #6 Al', () => {
    expect(size(40, true)).toEqual({ breaker: 50, cu: '#8', al: '#6' });
  });
  it('30 A → #10 Cu, #8 Al (240.4(D) limits #10 Al to 25 A)', () => {
    expect(size(30)).toEqual({ breaker: 30, cu: '#10', al: '#8' });
  });
  it('100 A → #3 Cu, #1 Al', () => {
    expect(size(100)).toEqual({ breaker: 100, cu: '#3', al: '#1' });
  });
  it('200 A → 3/0 Cu, 250 kcmil Al', () => {
    expect(size(200)).toEqual({ breaker: 200, cu: '3/0', al: '250 kcmil' });
  });
  it('large loads go to parallel sets', () => {
    expect(size(1200).cu).toBe('3× 600 kcmil');
  });
  it('no load → no breaker', () => {
    expect(sizeBreaker(0)).toBeNull();
  });
});

describe('equipment grounding conductor (Table 250.122, Cu)', () => {
  const egc = (amps: number) => {
    const breaker = sizeBreaker(amps)!;
    return sizeEgc(breaker, sizeWire(breaker, 'cu'));
  };
  it('15 A → #14, 20 A → #12, 30 A → #10', () => {
    expect([egc(15), egc(20), egc(30)]).toEqual(['#14', '#12', '#10']);
  });
  it('60 A → #10, 100 A → #8, 200 A → #6', () => {
    expect([egc(60), egc(100), egc(200)]).toEqual(['#10', '#8', '#6']);
  });
  it('never larger than the circuit conductors (250.122(A))', () => {
    // 25 A breaker uses the 60 A row (#10) and #10 conductors → #10.
    expect(egc(25)).toBe('#10');
  });
});

describe('kW', () => {
  it('uses V·I for single phase and √3·V·I for three phase', () => {
    expect(kwOf('120-1p', 10)).toBeCloseTo(1.2);
    expect(kwOf('240-2p', 10)).toBeCloseTo(2.4);
    expect(kwOf('208-2p', 10)).toBeCloseTo(2.08);
    expect(kwOf('208-3p', 10)).toBeCloseTo(3.603, 3);
  });
});
