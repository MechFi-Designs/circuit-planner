import type { Load } from '../types';
import { circuitAmps, hvacMcaOf, motorFlcOf } from './loadCalc';
import {
  KINDS,
  kwOf,
  motorFlc,
  MOTOR_BREAKER_MAX_PCT,
  sizeBranchWire,
  sizeBreaker,
  sizeEgc,
  sizeWire,
  type WireResult,
} from './nec';

/** Default breaker for an across-the-line motor, % of FLC: leaves room to start, well under the 250% max. */
const MOTOR_BREAKER_DEFAULT_PCT = 1.75;

export interface LoadSizing {
  /** Ampacity the circuit's wire must carry (sizing current). */
  required: number;
  /** Breaker in use: the override, or the automatic choice. */
  breaker: number | null;
  /** What the app would pick on its own. */
  auto: number | null;
  /** Largest breaker the code (or nameplate) allows, when there is a limit. */
  maxAllowed: number | null;
  poles: number;
  cu: WireResult | null;
  /** Copper equipment grounding conductor. */
  egc: string | null;
  /** Power at max current (kW). */
  kw: number;
  /** Power at the estimated running current (kW). */
  estKw: number;
  /** Motor current used for sizing, and whether it came from the NEC table. */
  flc: number | null;
  flcFromTable: boolean;
  /** Problems with this circuit's sizing or breaker override. */
  issues: string[];
}

export function sizeLoad(load: Load): LoadSizing {
  const amps = circuitAmps(load);
  const issues: string[] = [];
  let required: number;
  let auto: number | null;
  let maxAllowed: number | null = null;
  let exemptSmallConductor = false;
  let flc: number | null = null;
  let flcFromTable = false;

  if (load.equip === 'motor') {
    // NEC 430: conductors at 125% of FLC (430.22); inverse-time breaker up to 250% (430.52).
    flc = motorFlcOf(load)!;
    flcFromTable = load.motorStart === 'dol' && motorFlc(load.kind, load.hp) != null;
    required = flc * 1.25;
    exemptSmallConductor = true;
    if (load.motorStart === 'dol') {
      // When 250% isn't a standard size, the next size up is allowed (430.52(C)(1) Exception No. 1).
      maxAllowed = sizeBreaker(flc * MOTOR_BREAKER_MAX_PCT);
      auto = sizeBreaker(flc * MOTOR_BREAKER_DEFAULT_PCT);
      if (auto && maxAllowed && auto > maxAllowed) auto = maxAllowed;
      if (!flcFromTable && flc > 0) {
        issues.push('Enter the horsepower so the breaker and wire use the NEC full-load current table (430.6).');
      }
    } else {
      // Drive / soft starter: conductors at 125% of rated input current (430.122); breaker per the drive's manual.
      auto = sizeBreaker(required);
    }
  } else if (load.equip === 'hvac') {
    // NEC 440: conductors sized to the nameplate MCA; breaker no larger than the nameplate MOCP.
    required = hvacMcaOf(load)!;
    exemptSmallConductor = true;
    maxAllowed = load.mocp;
    auto = load.mocp ?? sizeBreaker(required);
    if (load.mca == null && required > 0) issues.push('Enter the nameplate MCA (minimum circuit ampacity).');
  } else {
    required = amps.design;
    auto = sizeBreaker(required);
  }

  const breaker = load.breakerA ?? auto;
  if (load.breakerA != null && required > 0) {
    const b = load.breakerA;
    if (load.equip === 'general' && b < required - 1e-9) {
      issues.push(`The ${b} A breaker is below the ${fmtA(required)} A sizing load (NEC 210.20(A)).`);
    }
    if (maxAllowed != null && b > maxAllowed) {
      issues.push(
        load.equip === 'hvac'
          ? `The ${b} A breaker is above the ${maxAllowed} A nameplate MOCP.`
          : `The ${b} A breaker is above the ${maxAllowed} A maximum for this motor (NEC 430.52, 250% of ${fmtA(flc!)} A).`,
      );
    }
    if (load.equip === 'hvac' && b < required - 1e-9) {
      issues.push(`The ${b} A breaker is below the ${fmtA(required)} A MCA and may trip under full load.`);
    }
    if (load.equip === 'motor' && load.motorStart === 'dol' && flc && b < flc * 1.25) {
      issues.push(`The ${b} A breaker is close to the motor's ${fmtA(flc)} A full-load current and may trip on start.`);
    }
  }

  // General circuits: wire carries the sizing load and is protected by its breaker,
  // using the next-size-up rule where it applies (240.4(B), with 240.4(D) limits).
  // Motor/HVAC: wire sized to its own ampacity; the overloads protect it (240.4(G)).
  const cu = exemptSmallConductor
    ? required > 0
      ? sizeWire(required, 'cu', false)
      : null
    : breaker
      ? sizeBranchWire(required, breaker, 'cu')
      : null;

  return {
    required,
    breaker,
    auto,
    maxAllowed,
    poles: KINDS[load.kind].poles,
    cu,
    egc: breaker ? sizeEgc(breaker, cu) : null,
    kw: kwOf(load.kind, amps.max),
    estKw: kwOf(load.kind, amps.est),
    flc,
    flcFromTable,
    issues,
  };
}

export const fmtA = (a: number) => `${Math.round(a * 10) / 10}`;

export const fmtKw = (kw: number) => (kw >= 10 ? kw.toFixed(1) : kw.toFixed(2));
