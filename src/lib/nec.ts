import type { LoadKind, Phase, ServiceMode } from '../types';

/** NEC 240.6(A) standard overcurrent device ratings (common range). */
export const BREAKER_SIZES = [
  15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500, 600,
  700, 800, 1000, 1200,
];

export const CONTINUOUS_FACTOR = 1.25;

export type Material = 'cu' | 'al';

export interface WireRow {
  /** Display label, e.g. "#12", "1/0", "250 kcmil". */
  size: string;
  a60: number;
  a75: number;
  a90: number;
}

/** NEC 2023 Table 310.16, copper (THHN/THWN-2 use the 75 °C / 90 °C columns). */
export const CU_TABLE: WireRow[] = [
  { size: '#14', a60: 15, a75: 20, a90: 25 },
  { size: '#12', a60: 20, a75: 25, a90: 30 },
  { size: '#10', a60: 30, a75: 35, a90: 40 },
  { size: '#8', a60: 40, a75: 50, a90: 55 },
  { size: '#6', a60: 55, a75: 65, a90: 75 },
  { size: '#4', a60: 70, a75: 85, a90: 95 },
  { size: '#3', a60: 85, a75: 100, a90: 115 },
  { size: '#2', a60: 95, a75: 115, a90: 130 },
  { size: '#1', a60: 110, a75: 130, a90: 145 },
  { size: '1/0', a60: 125, a75: 150, a90: 170 },
  { size: '2/0', a60: 145, a75: 175, a90: 195 },
  { size: '3/0', a60: 165, a75: 200, a90: 225 },
  { size: '4/0', a60: 195, a75: 230, a90: 260 },
  { size: '250 kcmil', a60: 215, a75: 255, a90: 290 },
  { size: '300 kcmil', a60: 240, a75: 285, a90: 320 },
  { size: '350 kcmil', a60: 260, a75: 310, a90: 350 },
  { size: '400 kcmil', a60: 280, a75: 335, a90: 380 },
  { size: '500 kcmil', a60: 320, a75: 380, a90: 430 },
  { size: '600 kcmil', a60: 350, a75: 420, a90: 475 },
  { size: '700 kcmil', a60: 385, a75: 460, a90: 520 },
  { size: '750 kcmil', a60: 400, a75: 475, a90: 535 },
  { size: '800 kcmil', a60: 410, a75: 490, a90: 555 },
  { size: '900 kcmil', a60: 435, a75: 520, a90: 585 },
  { size: '1000 kcmil', a60: 455, a75: 545, a90: 615 },
];

/** NEC 2023 Table 310.16, aluminum. Smallest Al branch conductor is #12. */
export const AL_TABLE: WireRow[] = [
  { size: '#12', a60: 15, a75: 20, a90: 25 },
  { size: '#10', a60: 25, a75: 30, a90: 35 },
  { size: '#8', a60: 35, a75: 40, a90: 45 },
  { size: '#6', a60: 40, a75: 50, a90: 55 },
  { size: '#4', a60: 55, a75: 65, a90: 75 },
  { size: '#3', a60: 65, a75: 75, a90: 85 },
  { size: '#2', a60: 75, a75: 90, a90: 100 },
  { size: '#1', a60: 85, a75: 100, a90: 115 },
  { size: '1/0', a60: 100, a75: 120, a90: 135 },
  { size: '2/0', a60: 115, a75: 135, a90: 150 },
  { size: '3/0', a60: 130, a75: 155, a90: 175 },
  { size: '4/0', a60: 150, a75: 180, a90: 205 },
  { size: '250 kcmil', a60: 170, a75: 205, a90: 230 },
  { size: '300 kcmil', a60: 195, a75: 230, a90: 260 },
  { size: '350 kcmil', a60: 210, a75: 250, a90: 280 },
  { size: '400 kcmil', a60: 225, a75: 270, a90: 305 },
  { size: '500 kcmil', a60: 260, a75: 310, a90: 350 },
  { size: '600 kcmil', a60: 285, a75: 340, a90: 385 },
  { size: '700 kcmil', a60: 315, a75: 375, a90: 425 },
  { size: '750 kcmil', a60: 320, a75: 385, a90: 435 },
  { size: '800 kcmil', a60: 330, a75: 395, a90: 445 },
  { size: '900 kcmil', a60: 355, a75: 425, a90: 480 },
  { size: '1000 kcmil', a60: 375, a75: 445, a90: 500 },
];

/** NEC 240.4(D) small-conductor overcurrent limits. */
const SMALL_CONDUCTOR_LIMIT: Record<Material, Record<string, number>> = {
  cu: { '#14': 15, '#12': 20, '#10': 30 },
  al: { '#12': 15, '#10': 25 },
};

/** Smallest conductor permitted in parallel (NEC 310.10(G)). */
const MIN_PARALLEL_INDEX: Record<Material, number> = {
  cu: CU_TABLE.findIndex((r) => r.size === '1/0'),
  al: AL_TABLE.findIndex((r) => r.size === '1/0'),
};

/** NEC 2023 Table 250.122, copper equipment grounding conductor by OCPD rating. */
const EGC_CU: [number, string][] = [
  [15, '#14'],
  [20, '#12'],
  [60, '#10'],
  [100, '#8'],
  [200, '#6'],
  [300, '#4'],
  [400, '#3'],
  [500, '#2'],
  [600, '#1'],
  [800, '1/0'],
  [1000, '2/0'],
  [1200, '3/0'],
];

const CU_ORDER = CU_TABLE.map((r) => r.size);

/**
 * Copper EGC for a breaker. Per 250.122(A) it never needs to be larger than the
 * circuit conductors; with parallel sets, each raceway gets a full-size EGC (250.122(F)).
 */
export function sizeEgc(breakerA: number, phase: WireResult | null): string | null {
  const row = EGC_CU.find(([a]) => a >= breakerA);
  if (!row) return null;
  if (phase && phase.sets === 1 && CU_ORDER.indexOf(phase.size) < CU_ORDER.indexOf(row[1])) return phase.size;
  return row[1];
}

/** Power at a given current for a circuit type (kW). 3-phase uses √3·V·I. */
export function kwOf(kind: LoadKind, amps: number): number {
  const k = KINDS[kind];
  return (amps * k.volts * (k.poles === 3 ? Math.sqrt(3) : 1)) / 1000;
}

export function requiredAmpacity(amps: number, continuous: boolean): number {
  return amps * (continuous ? CONTINUOUS_FACTOR : 1);
}

/** Smallest standard breaker ≥ required ampacity, or null if none / no load. */
export function sizeBreaker(required: number): number | null {
  if (!(required > 0)) return null;
  return BREAKER_SIZES.find((b) => b >= required) ?? null;
}

export interface WireResult {
  size: string;
  /** Parallel sets (1 = single conductor per phase). */
  sets: number;
  a75: number;
  a90: number;
}

/**
 * Smallest THHN conductor protected by the breaker: the 75 °C termination
 * ampacity (NEC 110.14(C)) must be ≥ the breaker rating and the 240.4(D)
 * small-conductor limits must be met. Falls back to parallel sets.
 */
export function sizeWire(breakerA: number, material: Material): WireResult | null {
  const table = material === 'cu' ? CU_TABLE : AL_TABLE;
  const limits = SMALL_CONDUCTOR_LIMIT[material];
  for (const row of table) {
    const limit = limits[row.size];
    if (row.a75 >= breakerA && (limit === undefined || limit >= breakerA)) {
      return { size: row.size, sets: 1, a75: row.a75, a90: row.a90 };
    }
  }
  for (let sets = 2; sets <= 8; sets++) {
    for (let i = MIN_PARALLEL_INDEX[material]; i < table.length; i++) {
      const row = table[i];
      if (row.a75 * sets >= breakerA) return { size: row.size, sets, a75: row.a75, a90: row.a90 };
    }
  }
  return null;
}

export function formatWire(w: WireResult | null): string {
  if (!w) return '—';
  return w.sets > 1 ? `${w.sets}× ${w.size}` : w.size;
}

export interface KindInfo {
  kind: LoadKind;
  label: string;
  poles: 1 | 2 | 3;
  volts: number;
}

export const KINDS: Record<LoadKind, KindInfo> = {
  '120-1p': { kind: '120-1p', label: '120 V 1Φ', poles: 1, volts: 120 },
  '240-2p': { kind: '240-2p', label: '240 V 1Φ', poles: 2, volts: 240 },
  '208-2p': { kind: '208-2p', label: '208 V 1Φ', poles: 2, volts: 208 },
  '208-3p': { kind: '208-3p', label: '208 V 3Φ', poles: 3, volts: 208 },
};

export const KINDS_BY_MODE: Record<ServiceMode, LoadKind[]> = {
  split: ['120-1p', '240-2p'],
  three: ['120-1p', '208-2p', '208-3p'],
};

export const MODE_LABEL: Record<ServiceMode, string> = {
  split: 'Split phase 120/240 V',
  three: '3-phase 208Y/120 V',
};

export const MODE_PHASES: Record<ServiceMode, Phase[]> = {
  split: ['A', 'B'],
  three: ['A', 'B', 'C'],
};

/** Closest equivalent circuit type when switching service modes. */
export function remapKind(kind: LoadKind, mode: ServiceMode): LoadKind {
  if (mode === 'split') return kind === '120-1p' ? '120-1p' : '240-2p';
  return kind === '240-2p' ? '208-2p' : kind;
}

/** Feeder breaker type for a subpanel: 2-pole split phase, 3-pole 3-phase. */
export function feederKind(mode: ServiceMode): LoadKind {
  return mode === 'split' ? '240-2p' : '208-3p';
}

export function polesOf(kind: LoadKind): number {
  return KINDS[kind].poles;
}

/** Bus phase for a breaker space. Spaces 1 & 2 share row 0, 3 & 4 row 1, … */
export function phaseOfSlot(slot: number, mode: ServiceMode): Phase {
  const row = Math.floor((slot - 1) / 2);
  const phases = MODE_PHASES[mode];
  return phases[row % phases.length];
}
