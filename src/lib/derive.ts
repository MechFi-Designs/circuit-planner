import type { AppState, Load, Panel } from '../types';
import { layoutPanel, type PanelLayout } from './placement';
import { addTotals, maxPhase, phaseTotals, zeroPhases, type PhaseTotals } from './loadCalc';
import { polesOf, sizeWire } from './nec';
import { sizeLoad, type LoadSizing } from './sizing';

/** True if `id` is `ancestorId` or sits anywhere below it in the feed tree. */
export function isWithin(panels: Panel[], ancestorId: string, id: string): boolean {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const seen = new Set<string>();
  for (let cur: string | null = id; cur && !seen.has(cur); cur = byId.get(cur)?.fedFrom ?? null) {
    if (cur === ancestorId) return true;
    seen.add(cur);
  }
  return false;
}

/** Panels ordered so every subpanel comes before the panel feeding it. */
export function postOrder(panels: Panel[]): Panel[] {
  const out: Panel[] = [];
  const seen = new Set<string>();
  const visit = (p: Panel) => {
    if (seen.has(p.id)) return;
    seen.add(p.id);
    for (const c of panels) if (c.fedFrom === p.id) visit(c);
    out.push(p);
  };
  for (const p of panels) if (!p.fedFrom) visit(p);
  for (const p of panels) visit(p); // anything orphaned by a bad link
  return out;
}

export interface Derived {
  layouts: Map<string, PanelLayout>;
  /** Per-panel phase totals including everything downstream of it. */
  totals: Map<string, PhaseTotals>;
  service: PhaseTotals;
  /** Feeder load id → the subpanel it supplies. */
  feederOf: Map<string, Panel>;
  sizing: Map<string, LoadSizing>;
}

export function derive(state: AppState): Derived {
  const layouts = new Map<string, PanelLayout>();
  const totals = new Map<string, PhaseTotals>();
  const feederOf = new Map<string, Panel>();
  const panelById = new Map(state.panels.map((p) => [p.id, p]));
  for (const l of state.loads) {
    const sub = l.feeds ? panelById.get(l.feeds) : undefined;
    if (sub) feederOf.set(l.id, sub);
  }

  for (const p of postOrder(state.panels)) {
    const loads = state.loads.filter((l) => l.panelId === p.id);
    const layout = layoutPanel(p, loads, state.mode);
    const feeders = new Map<string, PhaseTotals>();
    for (const l of loads) {
      const sub = feederOf.get(l.id);
      if (sub) feeders.set(l.id, totals.get(sub.id) ?? { connected: zeroPhases(), worst: zeroPhases() });
    }
    layouts.set(p.id, layout);
    totals.set(p.id, phaseTotals(loads, layout.placements, feeders));
  }

  let service: PhaseTotals = { connected: zeroPhases(), worst: zeroPhases() };
  for (const p of state.panels) if (!p.fedFrom) service = addTotals(service, totals.get(p.id)!);

  const sizing = new Map<string, LoadSizing>();
  for (const l of state.loads) {
    const sub = feederOf.get(l.id);
    sizing.set(l.id, sub ? sizeFeeder(l, sub, totals.get(sub.id)!, state.mode) : sizeLoad(l));
  }
  return { layouts, totals, service, feederOf, sizing };
}

/** Feeder phase contributions for one panel's loads, keyed by feeder load id. */
export function feederTotals(d: Derived, loads: Load[]): Map<string, PhaseTotals> {
  const m = new Map<string, PhaseTotals>();
  for (const l of loads) {
    const sub = d.feederOf.get(l.id);
    if (sub) m.set(l.id, d.totals.get(sub.id)!);
  }
  return m;
}

/** Feeder breaker sizing: rated at the subpanel's feeder setting, wire sized to that breaker. */
function sizeFeeder(load: Load, sub: Panel, subTotals: PhaseTotals, mode: AppState['mode']): LoadSizing {
  const breaker = sub.mainA > 0 ? sub.mainA : null;
  return {
    required: maxPhase(subTotals.worst, mode),
    breaker,
    poles: polesOf(load.kind),
    cu: breaker ? sizeWire(breaker, 'cu') : null,
    al: breaker ? sizeWire(breaker, 'al') : null,
  };
}
