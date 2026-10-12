import type { AppState } from '../types';
import { derive, type Derived } from './derive';
import { maxPhase } from './loadCalc';
import { optimizeAll } from './optimize';
import { fmtA } from './sizing';

const list = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export function isOverloaded(state: AppState, d: Derived): boolean {
  const peak = (amps: Parameters<typeof maxPhase>[0]) => maxPhase(amps, state.mode);
  return (
    (state.serviceA > 0 && peak(d.service.worst) > state.serviceA) ||
    state.panels.some((p) => p.mainA > 0 && peak(d.totals.get(p.id)!.worst) > p.mainA)
  );
}

/** What Optimize would produce, only computed when something is over its rating. */
export function optimizePreview(state: AppState, d: Derived): Derived | null {
  if (!isOverloaded(state, d)) return null;
  const res = optimizeAll(state);
  return res.loads ? derive({ ...state, loads: res.loads }) : null;
}

/**
 * One message per overloaded panel (and the service) saying by how much and
 * what would fix it: Optimize (with its predicted result), re-feeding
 * subpanels from the service, unlocking circuits, or a bigger rating.
 */
export function overloadAdvice(state: AppState, d: Derived, preview: Derived | null): string[] {
  const { mode } = state;
  const peak = (dd: Derived, id: string) => maxPhase(dd.totals.get(id)!.worst, mode);
  const out: string[] = [];

  const svc = maxPhase(d.service.worst, mode);
  if (state.serviceA > 0 && svc > state.serviceA) {
    out.push(
      `Total worst-case load is ${fmtA(svc - state.serviceA)} A over the ${state.serviceA} A service. Moving circuits around can't fix that: the service has to be bigger or the load smaller.`,
    );
  }

  for (const p of state.panels) {
    const load = peak(d, p.id);
    if (!(p.mainA > 0) || load <= p.mainA) continue;
    const what = p.fedFrom ? 'feeder' : 'main';
    const parts = [
      `${p.name} is ${fmtA(load - p.mainA)} A over its ${p.mainA} A ${what} (${fmtA(load)} A worst case).`,
    ];

    const after = preview ? peak(preview, p.id) : load;
    if (after < load - 0.05) {
      parts.push(`⚖ Optimize can bring it to ${Math.round((after / p.mainA) * 100)}%.`);
    }
    if (after > p.mainA) {
      const children = state.panels.filter((c) => c.fedFrom === p.id);
      const childAmps = children.reduce((s, c) => s + peak(d, c.id), 0);
      const names = list(children.map((c) => c.name));
      const them = children.length > 1 ? 'them' : 'it';
      if (children.length && childAmps > 0) {
        parts.push(
          `${names} ${children.length > 1 ? 'are' : 'is'} fed through it (${fmtA(childAmps)} A). Feeding ${them} from the service instead would take that load off ${p.name}.`,
        );
      } else if (children.length) {
        parts.push(
          `Moving circuits into ${names} wouldn't help since ${children.length > 1 ? 'they are' : 'it is'} fed through ${p.name}. Feed ${them} from the service and ⚖ Optimize can move circuits there.`,
        );
      }
      const own = state.loads.filter((l) => l.panelId === p.id && !l.feeds);
      const locked = own.filter((l) => l.locked).length;
      if (locked && state.panels.length > 1) {
        parts.push(
          `${locked} locked circuit${locked > 1 ? 's stay' : ' stays'} put; unlock some so Optimize can move them.`,
        );
      }
      if (state.panels.length > 1 && !state.optimizeAcrossPanels && own.some((l) => !l.locked)) {
        parts.push('Turn on "Move circuits between panels" so Optimize can shift load elsewhere.');
      }
      if (state.panels.length === 1) {
        parts.push('Raise the rating, or add a panel fed from the service and run ⚖ Optimize.');
      } else if (!children.length && !locked && state.optimizeAcrossPanels) {
        parts.push('The other panels don’t have room for its circuits. Raise a rating or add a panel.');
      }
    }
    out.push(parts.join(' '));
  }
  return out;
}
