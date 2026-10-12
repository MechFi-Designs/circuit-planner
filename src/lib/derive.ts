import type { AppState, Load, Panel } from '../types';
import { layoutPanel, type PanelLayout } from './placement';
import { addTotals, maxPhase, phaseTotals, zeroTotals, type PhaseTotals } from './loadCalc';
import { polesOf, sizeEgc, sizeWire } from './nec';
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

export interface Kw {
  /** At max current. */
  max: number;
  /** At estimated running current. */
  est: number;
}

export interface Derived {
  layouts: Map<string, PanelLayout>;
  /** Per-panel phase totals including everything downstream of it. */
  totals: Map<string, PhaseTotals>;
  service: PhaseTotals;
  /** Per-panel power including everything downstream of it. */
  kw: Map<string, Kw>;
  serviceKw: Kw;
  /** Feeder load id → the subpanel it supplies. */
  feederOf: Map<string, Panel>;
  sizing: Map<string, LoadSizing>;
}

export function derive(state: AppState): Derived {
  const layouts = new Map<string, PanelLayout>();
  const totals = new Map<string, PhaseTotals>();
  const kw = new Map<string, Kw>();
  const feederOf = new Map<string, Panel>();
  const sizing = new Map<string, LoadSizing>();
  const panelById = new Map(state.panels.map((p) => [p.id, p]));
  for (const l of state.loads) {
    const sub = l.feeds ? panelById.get(l.feeds) : undefined;
    if (sub) feederOf.set(l.id, sub);
    else sizing.set(l.id, sizeLoad(l));
  }

  for (const p of postOrder(state.panels)) {
    const loads = state.loads.filter((l) => l.panelId === p.id);
    const layout = layoutPanel(p, loads, state.mode);
    const feeders = new Map<string, PhaseTotals>();
    const pk: Kw = { max: 0, est: 0 };
    for (const l of loads) {
      const sub = feederOf.get(l.id);
      if (sub) {
        const subTotals = totals.get(sub.id) ?? zeroTotals();
        const subKw = kw.get(sub.id) ?? { max: 0, est: 0 };
        feeders.set(l.id, subTotals);
        sizing.set(l.id, sizeFeeder(l, sub, subTotals, subKw, state.mode));
        pk.max += subKw.max;
        pk.est += subKw.est;
      } else {
        const s = sizing.get(l.id)!;
        pk.max += s.kw;
        pk.est += s.estKw;
      }
    }
    layouts.set(p.id, layout);
    totals.set(p.id, phaseTotals(loads, layout.placements, feeders));
    kw.set(p.id, pk);
  }

  let service = zeroTotals();
  const serviceKw: Kw = { max: 0, est: 0 };
  for (const p of state.panels) {
    if (p.fedFrom) continue;
    service = addTotals(service, totals.get(p.id)!);
    serviceKw.max += kw.get(p.id)!.max;
    serviceKw.est += kw.get(p.id)!.est;
  }
  return { layouts, totals, service, kw, serviceKw, feederOf, sizing };
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
function sizeFeeder(load: Load, sub: Panel, subTotals: PhaseTotals, subKw: Kw, mode: AppState['mode']): LoadSizing {
  const breaker = sub.mainA > 0 ? sub.mainA : null;
  const cu = breaker ? sizeWire(breaker, 'cu') : null;
  return {
    required: maxPhase(subTotals.worst, mode),
    breaker,
    poles: polesOf(load.kind),
    cu,
    egc: breaker ? sizeEgc(breaker, cu) : null,
    kw: subKw.max,
    estKw: subKw.est,
  };
}
