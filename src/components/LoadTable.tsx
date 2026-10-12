import { useEffect, type Dispatch } from 'react';
import type { AppState, Load, LoadKind, Panel } from '../types';
import type { Action } from '../state';
import type { Derived } from '../lib/derive';
import { maxPhase } from '../lib/loadCalc';
import { formatWire, KINDS, KINDS_BY_MODE, type WireResult } from '../lib/nec';
import { fmtA, fmtKw } from '../lib/sizing';
import { NumInput } from './NumInput';
import { PhaseChip } from './PhaseChip';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  derived: Derived;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOptimize: () => void;
}

function wireTitle(w: WireResult | null, breaker: number | null): string | undefined {
  if (!w || !breaker) return undefined;
  const per = w.sets > 1 ? ' per set' : '';
  return `75 °C: ${w.a75} A${per} — termination limit, governs (≥ ${breaker} A breaker)\n90 °C: ${w.a90} A${per} — THHN rating, use as the derating basis`;
}

export function LoadTable({ state, dispatch, derived, selectedId, onSelect, onOptimize }: Props) {
  const multiPanel = state.panels.length > 1;

  useEffect(() => {
    if (selectedId) document.getElementById(`row-${selectedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  return (
    <section className="card load-card">
      <div className="card-head">
        <h2>Load table</h2>
        <div className="actions">
          {multiPanel && (
            <label
              className="check"
              title="Let Optimize move unlocked circuits to another panel when that lowers a panel's or the service's load"
            >
              <input
                type="checkbox"
                checked={state.optimizeAcrossPanels}
                onChange={(e) => dispatch({ type: 'setOptimizeAcrossPanels', on: e.target.checked })}
              />
              Move circuits between panels
            </label>
          )}
          <button
            className="btn primary"
            onClick={onOptimize}
            title="Re-slot unlocked circuits so worst-case current is spread evenly across phases"
          >
            ⚖ Optimize
          </button>
        </div>
      </div>

      {state.panels.map((panel) => (
        <PanelLoads
          key={panel.id}
          panel={panel}
          state={state}
          dispatch={dispatch}
          derived={derived}
          multiPanel={multiPanel}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ))}

      <p className="legend muted">
        Breaker = next standard size ≥ max load (× 1.25 if continuous). Wire = smallest copper THHN whose 75 °C ampacity
        is ≥ the breaker, with the 240.4(D) small-conductor limits applied (hover to see both ratings). EGC = copper
        equipment ground per Table 250.122. kW = V × I (√3 for 3-phase). Est. A is your guess at typical running current
        (blank = max). It only feeds the estimated load figures, never the sizing.
      </p>
    </section>
  );
}

interface PanelLoadsProps {
  panel: Panel;
  state: AppState;
  dispatch: Dispatch<Action>;
  derived: Derived;
  multiPanel: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

function PanelLoads({ panel, state, dispatch, derived, multiPanel, selectedId, onSelect }: PanelLoadsProps) {
  const layout = derived.layouts.get(panel.id)!;
  const loads = state.loads.filter((l) => l.panelId === panel.id);
  const update = (id: string, patch: Partial<Load>) => dispatch({ type: 'updateLoad', id, patch });

  return (
    <div className="panel-loads">
      {multiPanel && <h3>{panel.name}</h3>}
      <div className="table-scroll">
        <table className="loads">
          <thead>
            <tr>
              <th>Slot</th>
              <th className="name-col">Name</th>
              <th>Max A</th>
              <th title="Power at max current">kW</th>
              <th>Circuit</th>
              <th title="Continuous load (3 h or more): sized at 125%">Cont.</th>
              <th title="Estimated typical running current. Blank = same as max.">Est. A</th>
              <th title="Required ampacity">Req’d</th>
              <th>Breaker</th>
              <th>Cu THHN</th>
              <th title="Copper equipment grounding conductor (Table 250.122)">EGC</th>
              <th>Phase</th>
              <th title="Locked circuits keep their slot and panel when optimizing">Lock</th>
              {multiPanel && <th>Panel</th>}
              <th aria-label="Delete" />
            </tr>
          </thead>
          <tbody>
            {loads.map((l) => {
              const s = derived.sizing.get(l.id)!;
              const sub = derived.feederOf.get(l.id);
              const subEst = sub ? maxPhase(derived.totals.get(sub.id)!.est, state.mode) : 0;
              const p = layout.placements.get(l.id);
              const poles = KINDS[l.kind].poles;
              const lastStart = panel.spaces - 2 * (poles - 1);
              const conflict = layout.conflicts.includes(l.id);
              const feederOver = sub && s.breaker != null && s.required > s.breaker;
              return (
                <tr
                  key={l.id}
                  id={`row-${l.id}`}
                  className={`${selectedId === l.id ? 'selected' : ''}${!p ? ' unplaced' : ''}`}
                  onClick={() => onSelect(l.id)}
                >
                  <td>
                    <select
                      className="slot-select"
                      value={l.locked && l.slot != null ? l.slot : ''}
                      aria-label="Slot"
                      title={l.locked ? 'Pinned to this slot' : 'Placed automatically; Optimize may move it'}
                      onChange={(e) =>
                        update(
                          l.id,
                          e.target.value === ''
                            ? { slot: null, locked: false }
                            : { slot: Number(e.target.value), locked: true },
                        )
                      }
                    >
                      <option value="">{p && !(l.locked && l.slot != null) ? `Auto · ${p.slot}` : 'Auto'}</option>
                      {Array.from({ length: Math.max(0, lastStart) }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="name-col">
                    {sub ? (
                      <span className="feeder-name" title="Change in Service & panels → Fed from">
                        → {sub.name} feeder
                      </span>
                    ) : (
                      <input
                        value={l.name}
                        placeholder="Circuit name"
                        aria-label="Circuit name"
                        onChange={(e) => update(l.id, { name: e.target.value })}
                      />
                    )}
                  </td>
                  <td>
                    {sub ? (
                      <span className="num pad" title={`${sub.name} worst-case phase load`}>
                        {fmtA(s.required)}
                      </span>
                    ) : (
                      <NumInput
                        live
                        min={0}
                        step="any"
                        className="amps"
                        value={l.amps}
                        aria-label="Max current"
                        onCommit={(amps) => update(l.id, { amps: Math.max(0, amps) })}
                      />
                    )}
                  </td>
                  <td className="num" title={`Estimated ${fmtKw(s.estKw)} kW`}>
                    {s.kw > 0 ? fmtKw(s.kw) : '—'}
                  </td>
                  <td>
                    {sub ? (
                      <span className="muted nowrap">{poles}-pole feeder</span>
                    ) : (
                      <select
                        value={l.kind}
                        aria-label="Circuit type"
                        onChange={(e) => update(l.id, { kind: e.target.value as LoadKind })}
                      >
                        {KINDS_BY_MODE[state.mode].map((k) => (
                          <option key={k} value={k}>
                            {KINDS[k].label}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="center">
                    {!sub && (
                      <input
                        type="checkbox"
                        checked={l.continuous}
                        aria-label="Continuous"
                        onChange={(e) => update(l.id, { continuous: e.target.checked })}
                      />
                    )}
                  </td>
                  <td>
                    {sub ? (
                      <span className="num pad" title={`${sub.name} estimated phase load`}>
                        {fmtA(subEst)}
                      </span>
                    ) : (
                      <NumInput
                        live
                        min={0}
                        step="any"
                        className="amps est"
                        value={l.estAmps}
                        placeholder={l.amps ? fmtA(l.amps) : ''}
                        aria-label="Estimated running current"
                        onCommit={(amps) => update(l.id, { estAmps: Math.max(0, amps) })}
                        onClear={() => update(l.id, { estAmps: null })}
                      />
                    )}
                  </td>
                  <td className="num">{s.breaker ? fmtA(s.required) : '—'}</td>
                  <td
                    className={`num strong${feederOver ? ' over' : ''}`}
                    title={feederOver ? `${sub!.name} load exceeds its feeder breaker` : undefined}
                  >
                    {s.breaker ? `${s.breaker} A ${poles}P` : '—'}
                  </td>
                  <td className="num" title={wireTitle(s.cu, s.breaker)}>
                    {formatWire(s.cu)}
                  </td>
                  <td
                    className="num"
                    title={s.cu && s.cu.sets > 1 ? 'Full-size EGC in each parallel raceway' : undefined}
                  >
                    {s.egc ?? '—'}
                  </td>
                  <td>
                    {p ? (
                      <span className="chips">
                        {p.phases.map((ph, i) => (
                          <PhaseChip key={i} phase={ph} />
                        ))}
                        {p.tandem && (
                          <span className="tag" title="Tandem breaker">
                            T
                          </span>
                        )}
                      </span>
                    ) : (
                      <span
                        className="tag bad"
                        title={conflict ? 'Locked slot is taken or out of range' : 'Panel is full'}
                      >
                        {conflict ? 'conflict' : 'no room'}
                      </span>
                    )}
                  </td>
                  <td className="center">
                    <button
                      className={`icon-btn lock${l.locked ? ' on' : ''}`}
                      title={
                        l.locked
                          ? 'Locked: optimize won’t move this circuit'
                          : 'Unlocked: optimize may move this circuit'
                      }
                      aria-pressed={l.locked}
                      onClick={(e) => {
                        e.stopPropagation();
                        update(l.id, l.locked ? { locked: false } : { locked: true, slot: p?.slot ?? l.slot });
                      }}
                    >
                      {l.locked ? '🔒' : '🔓'}
                    </button>
                  </td>
                  {multiPanel && (
                    <td>
                      {!sub && (
                        <select
                          value={l.panelId}
                          aria-label="Panel"
                          onChange={(e) => update(l.id, { panelId: e.target.value, slot: null, locked: false })}
                        >
                          {state.panels.map((pp) => (
                            <option key={pp.id} value={pp.id}>
                              {pp.name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                  )}
                  <td>
                    {!sub && (
                      <button
                        className="icon-btn"
                        title="Delete circuit"
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: 'removeLoad', id: l.id });
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <button className="btn ghost small" onClick={() => dispatch({ type: 'addLoad', panelId: panel.id })}>
        + Add circuit{multiPanel ? ` to ${panel.name}` : ''}
      </button>
    </div>
  );
}
