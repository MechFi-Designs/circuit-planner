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
  const ofService = (amps: number) => (serviceA ? (amps / serviceA) * 100 : 0);
  const maxPct = ofService(maxPhase(service.max, mode));
  const estPct = ofService(maxPhase(service.est, mode));
  const sizingPct = ofService(maxPhase(service.design, mode));
  const showSizing = sizingPct > maxPct + 0.5;
  const { serviceKw } = derived;

  // Over-rating problems (judged on sizing load) come from the advice.
  const warnings: string[] = [...advice];
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
  const basis = state.balanceOn;
  const imb = imbalance(service[basis], mode);
  const peak = maxPhase(service[basis], mode);
  if (peak > 0 && imb / peak > 0.2) {
    warnings.push(`Phases are ${fmtA(imb)} A apart (${basis === 'est' ? 'estimated' : 'max'} load). Try ⚖ Optimize.`);
  }

  return (
    <section className="summary card">
      <div className="summary-headline">
        <div className="stat">
          <div className="muted small-caps">Max load</div>
          <div className={`big pct ${level(maxPct)}`}>{Math.round(maxPct)}%</div>
          <div className="muted">{fmtKw(serviceKw.max)} kW max</div>
        </div>
        <div className="stat">
          <div className="muted small-caps">Estimated</div>
          <div className="big est-pct">{Math.round(estPct)}%</div>
          <div className="muted">{fmtKw(serviceKw.est)} kW typical</div>
        </div>
        {showSizing && (
          <div
            className="stat sizing"
            title="Breakers, wire and the service must be rated for continuous loads at 125%. That's a sizing margin, not extra current."
          >
            <div className="muted small-caps">Sizing</div>
            <div className={`mid pct ${sizingPct > 100 ? 'over' : 'muted'}`}>{Math.round(sizingPct)}%</div>
            <div className="muted">continuous at 125%</div>
          </div>
        )}
        <div className="phase-bars">
          {phases.map((ph) => {
            const m = service.max[ph];
            const e = service.est[ph];
            const d = service.design[ph];
            return (
              <div key={ph} className="phase-bar">
                <PhaseChip phase={ph} />
                <div
                  className="bar"
                  title={`${fmtA(m)} A max · ${fmtA(e)} A estimated · ${fmtA(d)} A sizing (continuous at 125%)`}
                >
                  <div className={`fill ${level(ofService(m))}`} style={{ width: `${Math.min(100, ofService(m))}%` }} />
                  <div className="fill est" style={{ width: `${Math.min(100, ofService(e))}%` }} />
                  {d > m + 0.05 && <div className="sizing-tick" style={{ left: `${Math.min(100, ofService(d))}%` }} />}
                </div>
                <span className="num">
                  {fmtA(m)} A <span className="muted">· est {fmtA(e)}</span>
                </span>
              </div>
            );
          })}
          <div className="muted tiny">
            % of the {serviceA} A service, all panels combined. Bars show max current; the darker inner bar is the
            estimate{showSizing ? ', and the tick marks the sizing load (continuous loads at 125%)' : ''}.
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
