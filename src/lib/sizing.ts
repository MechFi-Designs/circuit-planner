import type { Load } from '../types';
import { estOf } from './loadCalc';
import { KINDS, kwOf, requiredAmpacity, sizeBreaker, sizeEgc, sizeWire, type WireResult } from './nec';

export interface LoadSizing {
  required: number;
  breaker: number | null;
  poles: number;
  cu: WireResult | null;
  /** Copper equipment grounding conductor. */
  egc: string | null;
  /** Power at max current (kW). */
  kw: number;
  /** Power at the estimated running current (kW). */
  estKw: number;
}

export function sizeLoad(load: Load): LoadSizing {
  const required = requiredAmpacity(load.amps, load.continuous);
  const breaker = sizeBreaker(required);
  const cu = breaker ? sizeWire(breaker, 'cu') : null;
  return {
    required,
    breaker,
    poles: KINDS[load.kind].poles,
    cu,
    egc: breaker ? sizeEgc(breaker, cu) : null,
    kw: kwOf(load.kind, load.amps),
    estKw: kwOf(load.kind, estOf(load)),
  };
}

export const fmtA = (a: number) => `${Math.round(a * 10) / 10}`;

export const fmtKw = (kw: number) => (kw >= 10 ? kw.toFixed(1) : kw.toFixed(2));
