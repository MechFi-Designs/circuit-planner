import type { Load } from '../types';
import { circuitAmps } from './loadCalc';
import { KINDS, kwOf, sizeBreaker, sizeEgc, sizeWire, type WireResult } from './nec';

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
  const amps = circuitAmps(load);
  const required = amps.worst;
  const breaker = sizeBreaker(required);
  const cu = breaker ? sizeWire(breaker, 'cu') : null;
  return {
    required,
    breaker,
    poles: KINDS[load.kind].poles,
    cu,
    egc: breaker ? sizeEgc(breaker, cu) : null,
    kw: kwOf(load.kind, amps.max),
    estKw: kwOf(load.kind, amps.est),
  };
}

export const fmtA = (a: number) => `${Math.round(a * 10) / 10}`;

export const fmtKw = (kw: number) => (kw >= 10 ? kw.toFixed(1) : kw.toFixed(2));
