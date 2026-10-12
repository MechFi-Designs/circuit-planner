import type { Load } from '../types';
import { KINDS, requiredAmpacity, sizeBreaker, sizeWire, type WireResult } from './nec';

export interface LoadSizing {
  required: number;
  breaker: number | null;
  poles: number;
  cu: WireResult | null;
  al: WireResult | null;
}

export function sizeLoad(load: Load): LoadSizing {
  const required = requiredAmpacity(load.amps, load.continuous);
  const breaker = sizeBreaker(required);
  return {
    required,
    breaker,
    poles: KINDS[load.kind].poles,
    cu: breaker ? sizeWire(breaker, 'cu') : null,
    al: breaker ? sizeWire(breaker, 'al') : null,
  };
}

export const fmtA = (a: number) => `${Math.round(a * 10) / 10}`;
