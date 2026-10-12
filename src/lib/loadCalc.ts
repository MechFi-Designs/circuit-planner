import type { Load, LoadKind, Phase, ServiceMode } from '../types';
import { CONTINUOUS_FACTOR, KINDS, MODE_PHASES } from './nec';
import type { Placement } from './placement';

export type PhaseAmps = Record<Phase, number>;

export interface PhaseTotals {
  /** Real max current per phase. */
  max: PhaseAmps;
  /** Sizing current per phase (continuous loads at 125%); for rating checks only. */
  design: PhaseAmps;
  /** Estimated typical running current. */
  est: PhaseAmps;
}

export const zeroPhases = (): PhaseAmps => ({ A: 0, B: 0, C: 0 });

export const zeroTotals = (): PhaseTotals => ({ max: zeroPhases(), design: zeroPhases(), est: zeroPhases() });

export interface CircuitAmps {
  /** Max current (sum of device max when the circuit has devices). */
  max: number;
  /**
   * Sizing current: 125% of continuous + 100% of non-continuous load. Not a
   * real current; it's what breakers, wire, mains and feeders must be rated for.
   */
  design: number;
  /** Estimated typical running current. */
  est: number;
  /** Any of the load is continuous. */
  continuous: boolean;
}

/** Current of one device line (qty × per-unit value) on a circuit of this type. */
export function deviceAmps(kind: LoadKind, value: number, unit: 'W' | 'A', qty: number): number {
  const v = Math.max(0, value) * Math.max(0, qty);
  return unit === 'A' ? v : v / volts(kind);
}

/** Effective volts for converting watts to line current (√3·V for 3-phase). */
const volts = (kind: LoadKind) => KINDS[kind].volts * (KINDS[kind].poles === 3 ? Math.sqrt(3) : 1);

/** A circuit's currents, from its devices if it has any, otherwise from its own fields. */
export function circuitAmps(load: Load): CircuitAmps {
  if (!load.devices?.length) {
    return {
      max: load.amps,
      design: load.amps * (load.continuous ? CONTINUOUS_FACTOR : 1),
      est: load.estAmps ?? load.amps,
      continuous: load.continuous,
    };
  }
  const out: CircuitAmps = { max: 0, design: 0, est: 0, continuous: false };
  for (const dv of load.devices) {
    const max = deviceAmps(load.kind, dv.max, dv.unit, dv.qty);
    out.max += max;
    out.design += max * (dv.continuous ? CONTINUOUS_FACTOR : 1);
    out.est += deviceAmps(load.kind, dv.est ?? dv.max, dv.unit, dv.qty);
    out.continuous ||= dv.continuous;
  }
  return out;
}

export const designAmps = (load: Load) => circuitAmps(load).design;

/** Estimated running current, defaulting to the max. */
export const estOf = (load: Load) => circuitAmps(load).est;

/**
 * Per-phase current. Each circuit's line current is added to every phase its
 * poles land on (conservative: ignores the vector sum of line-to-line loads).
 * Feeder breakers add their subpanel's per-phase totals instead, placed or not,
 * since the downstream load is real either way.
 */
export function phaseTotals(
  loads: Load[],
  placements: Map<string, Placement>,
  feeders: Map<string, PhaseTotals> = new Map(),
): PhaseTotals {
  const { max, design, est } = zeroTotals();
  for (const l of loads) {
    const fed = feeders.get(l.id);
    if (fed) {
      for (const ph of ['A', 'B', 'C'] as const) {
        max[ph] += fed.max[ph];
        design[ph] += fed.design[ph];
        est[ph] += fed.est[ph];
      }
      continue;
    }
    const p = placements.get(l.id);
    if (!p) continue;
    for (const ph of p.phases) {
      const c = circuitAmps(l);
      max[ph] += c.max;
      design[ph] += c.design;
      est[ph] += c.est;
    }
  }
  return { max, design, est };
}

export function addTotals(a: PhaseTotals, b: PhaseTotals): PhaseTotals {
  const sum = (x: PhaseAmps, y: PhaseAmps): PhaseAmps => ({ A: x.A + y.A, B: x.B + y.B, C: x.C + y.C });
  return { max: sum(a.max, b.max), design: sum(a.design, b.design), est: sum(a.est, b.est) };
}

export function maxPhase(amps: PhaseAmps, mode: ServiceMode): number {
  return Math.max(...MODE_PHASES[mode].map((p) => amps[p]));
}

export function imbalance(amps: PhaseAmps, mode: ServiceMode): number {
  const vals = MODE_PHASES[mode].map((p) => amps[p]);
  return Math.max(...vals) - Math.min(...vals);
}
