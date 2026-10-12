import type { AppState } from '../types';
import type { Derived } from '../lib/derive';
import { imbalance, maxPhase } from '../lib/loadCalc';
import { MODE_PHASES, polesOf } from '../lib/nec';
import { fmtA, fmtKw } from '../lib/sizing';
import { PhaseChip } from './PhaseChip';

interface Props {
  state: AppState;
  derived: Derived;
  /** Overload explanations (see lib/advice). */
  advice: string[];
}

const level = (pct: number) => (pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok');

export function SummaryBar({ state, derived, advice }: Props) {
  const { service, layouts } = derived;
  const { mode, serviceA } = state;
  const phases = MODE_PHASES[mode];
  const worstPct = serviceA ? (maxPhase(service.worst, mode) / serviceA) * 100 : 0;
  const estPct = serviceA ? (maxPhase(service.est, mode) / serviceA) * 100 : 0;
  const { serviceKw } = derived;

  const warnings: string[] = [...advice];
  if (worstPct > 80 && worstPct <= 100) warnings.push(`Worst-case load is above 80% of the ${serviceA} A service.`);
  for (const p of state.panels) {
    const lay = layouts.get(p.id)!;
    const own = state.loads.filter((l) => l.panelId === p.id && !l.feeds && polesOf(l.kind) === 1);
    const tandemOk = p.maxCircuits > p.spaces;
    if (lay.unplaced.length) {
      const hint = !tandemOk
        ? ' Add spaces, or if the panel takes tandem breakers, raise its Circuits above its Spaces.'
        : own.some((l) => !l.tandem)
          ? ` Mark some 1-pole circuits as Tandem to double them up (up to ${p.maxCircuits} circuits).`
          : '';
      warnings.push(`${p.name}: ${lay.unplaced.length} circuit(s) don't fit.${hint}`);
    }
    const flagged = own.filter((l) => l.tandem).length;
    if (flagged && !tandemOk) {
      warnings.push(
        `${p.name} doesn't take tandems (Circuits = Spaces), so its ${flagged} tandem circuit${flagged > 1 ? 's use' : ' uses'} full spaces.`,
      );
    }
    if (lay.conflicts.length) warnings.push(`${p.name}: ${lay.conflicts.length} locked slot conflict(s).`);
  }
  const imb = imbalance(service.worst, mode);
  const peak = maxPhase(service.worst, mode);
  if (peak > 0 && imb / peak > 0.2) warnings.push(`Phases are ${fmtA(imb)} A apart. Try ⚖ Optimize.`);

  return (
    <section className="summary card">
      <div className="summary-headline">
        <div className="stat">
          <div className="muted small-caps">Worst case</div>
          <div className={`big pct ${level(worstPct)}`}>{Math.round(worstPct)}%</div>
          <div className="muted">{fmtKw(serviceKw.max)} kW max</div>
        </div>
        <div className="stat">
          <div className="muted small-caps">Estimated</div>
          <div className="big est-pct">{Math.round(estPct)}%</div>
          <div className="muted">{fmtKw(serviceKw.est)} kW typical</div>
        </div>
        <div className="phase-bars">
          {phases.map((ph) => {
            const w = service.worst[ph];
            const e = service.est[ph];
            const pct = serviceA ? (w / serviceA) * 100 : 0;
            const ePct = serviceA ? (e / serviceA) * 100 : 0;
            return (
              <div key={ph} className="phase-bar">
                <PhaseChip phase={ph} />
                <div
                  className="bar"
                  title={`${fmtA(w)} A worst case · ${fmtA(service.connected[ph])} A connected · ${fmtA(e)} A estimated`}
                >
                  <div className={`fill ${level(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  <div className="fill est" style={{ width: `${Math.min(100, ePct)}%` }} />
                </div>
                <span className="num">
                  {fmtA(w)} A <span className="muted">· est {fmtA(e)}</span>
                </span>
              </div>
            );
          })}
          <div className="muted tiny">
            % of the {serviceA} A service, all panels combined. Worst case = max current with continuous loads at 125%;
            the darker inner bar is the estimate.
          </div>
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
