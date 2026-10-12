import type { Load, Phase, ServiceMode } from '../types';
import { CONTINUOUS_FACTOR, MODE_PHASES } from './nec';
import type { Placement } from './placement';

export type PhaseAmps = Record<Phase, number>;

export interface PhaseTotals {
  /** Sum of entered max currents per phase. */
  connected: PhaseAmps;
  /** Same, with continuous loads at 125%. */
  worst: PhaseAmps;
}

export const zeroPhases = (): PhaseAmps => ({ A: 0, B: 0, C: 0 });

export function worstAmps(load: Load): number {
  return load.amps * (load.continuous ? CONTINUOUS_FACTOR : 1);
}

/**
 * Per-phase current. Each circuit's line current is added to every phase its
 * poles land on (conservative: ignores the vector sum of line-to-line loads).
 */
export function phaseTotals(loads: Load[], placements: Map<string, Placement>): PhaseTotals {
  const connected = zeroPhases();
  const worst = zeroPhases();
  for (const l of loads) {
    const p = placements.get(l.id);
    if (!p || !(l.amps > 0)) continue;
    for (const ph of p.phases) {
      connected[ph] += l.amps;
      worst[ph] += worstAmps(l);
    }
  }
  return { connected, worst };
}

export function addTotals(a: PhaseTotals, b: PhaseTotals): PhaseTotals {
  const sum = (x: PhaseAmps, y: PhaseAmps): PhaseAmps => ({ A: x.A + y.A, B: x.B + y.B, C: x.C + y.C });
  return { connected: sum(a.connected, b.connected), worst: sum(a.worst, b.worst) };
}

export function maxPhase(amps: PhaseAmps, mode: ServiceMode): number {
  return Math.max(...MODE_PHASES[mode].map((p) => amps[p]));
}

export function imbalance(amps: PhaseAmps, mode: ServiceMode): number {
  const vals = MODE_PHASES[mode].map((p) => amps[p]);
  return Math.max(...vals) - Math.min(...vals);
}
