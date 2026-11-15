import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent } from 'react';
import type { AppState, EquipType, Load, LoadKind, Panel } from '../types';
import type { Action } from '../state';
import type { Derived } from '../lib/derive';
import { circuitAmps, maxPhase } from '../lib/loadCalc';
import { BREAKER_SIZES, formatWire, KINDS, KINDS_BY_MODE, type WireResult } from '../lib/nec';
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
  onOpenDevices: (id: string) => void;
}

function wireTitle(w: WireResult | null, breaker: number | null): string | undefined {
  if (!w || !breaker) return undefined;
  const per = w.sets > 1 ? ' per set' : '';
  if (w.nextSizeUp) {
    return `75 °C: ${w.a75} A${per}. Carries the load; the ${breaker} A breaker is the next standard size up, which NEC 240.4(B) allows\n90 °C: ${w.a90} A${per}, the derating basis`;
  }
  return `75 °C: ${w.a75} A${per} — termination limit, governs (≥ ${breaker} A breaker)\n90 °C: ${w.a90} A${per} — THHN rating, use as the derating basis`;
}

const NAME_W_KEY = 'circuit-planner:name-col-w';
const NAME_MIN = 120;
const NAME_MAX = 900;
const clampName = (w: number) => Math.round(Math.min(NAME_MAX, Math.max(NAME_MIN, w)));

function readNameW(): number | null {
  try {
    const v = Number(localStorage.getItem(NAME_W_KEY));
    return v > 0 ? clampName(v) : null;
  } catch {
    return null;
  }
}

function saveNameW(w: number | null) {
  try {
    if (w == null) localStorage.removeItem(NAME_W_KEY);
    else localStorage.setItem(NAME_W_KEY, String(w));
  } catch {
    /* storage unavailable */
  }
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width in px of `text` in the load table's input font. */
function textWidth(text: string): number {
  if (measureCtx === undefined) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7.5;
  const sample = document.querySelector('.loads .name-col input') ?? document.body;
  measureCtx.font = getComputedStyle(sample).font || '13px system-ui, sans-serif';
  return measureCtx.measureText(text).width;
}

/** Name column width that shows the longest name in full (input padding + 🔌 button included). */
function fitNameWidth(names: string[]): number {
  const longest = Math.max(0, ...names.map(textWidth));
  return clampName(longest + 28 + 44 + 12);
}

export function LoadTable({ state, dispatch, derived, selectedId, onSelect, onOptimize, onOpenDevices }: Props) {
  const multiPanel = state.panels.length > 1;
  // Name column: fits the longest name until the user drags it to a width of their own.
  const [userNameW, setUserNameW] = useState<number | null>(readNameW);
  const setNameW = (w: number | null) => {
    setUserNameW(w);
    saveNameW(w);
  };

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
          <label
            className="check"
            title="Which current Optimize evens out across phases. Estimated uses each circuit's Est. A (blank = max). Rating checks always use the sizing load."
          >
            Balance on
            <select
              value={state.balanceOn}
              aria-label="Balance on"
              onChange={(e) => dispatch({ type: 'setBalanceOn', basis: e.target.value as AppState['balanceOn'] })}
            >
              <option value="max">Max load</option>
              <option value="est">Estimated load</option>
            </select>
          </label>
          <button
            className="btn primary"
            onClick={onOptimize}
            title={`Re-slot unlocked circuits so ${state.balanceOn === 'est' ? 'estimated' : 'max'} current is spread evenly across phases`}
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
          userNameW={userNameW}
          onNameW={setNameW}
          selectedId={selectedId}
          onSelect={onSelect}
          onOpenDevices={onOpenDevices}
        />
      ))}

      <p className="legend muted">
        Breaker = next standard size ≥ max load (× 1.25 if continuous). Wire = smallest copper THHN whose 75 °C ampacity
        carries the sizing load and is protected by the breaker: the breaker is at or below the wire's ampacity, or the
        next standard size up (240.4(B)), with the 240.4(D) small-conductor limits (hover to see both ratings). EGC =
        copper equipment ground per Table 250.122. kW = V × I (√3 for 3-phase). Est. A is your guess at typical running
        current (blank = max). It only feeds the estimated load figures, never the sizing.
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
  /** Name column width the user dragged to (all panels), or null to fit this panel's names. */
  userNameW: number | null;
  /** Set a user width, or null to go back to fitting the names. */
  onNameW: (w: number | null) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenDevices: (id: string) => void;
}

/** Drag handle on the Name header; double-click fits the column to the names again. */
function NameResizer({ onNameW }: { onNameW: (w: number | null) => void }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const down = (e: PointerEvent<HTMLSpanElement>) => {
    const th = e.currentTarget.parentElement;
    if (!th) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: th.getBoundingClientRect().width };
  };
  const move = (e: PointerEvent<HTMLSpanElement>) => {
    if (drag.current) onNameW(clampName(drag.current.w + e.clientX - drag.current.x));
  };
  const up = () => {
    drag.current = null;
  };
  return (
    <span
      className="col-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize name column"
      title="Drag to resize · double-click to fit names"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onDoubleClick={() => onNameW(null)}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function PanelLoads({
  panel,
  state,
  dispatch,
  derived,
  multiPanel,
  userNameW,
  onNameW,
  selectedId,
  onSelect,
  onOpenDevices,
}: PanelLoadsProps) {
  const layout = derived.layouts.get(panel.id)!;
  const loads = state.loads.filter((l) => l.panelId === panel.id);
  const update = (id: string, patch: Partial<Load>) => dispatch({ type: 'updateLoad', id, patch });
  const tandemOk = panel.maxCircuits > panel.spaces;
  const namesKey = loads
    .map((l) => {
      const sub = derived.feederOf.get(l.id);
      return sub ? `→ ${sub.name} feeder` : l.name;
    })
    .join('\u0000');
  const fitW = useMemo(() => fitNameWidth(namesKey.split('\u0000')), [namesKey]);
  const nameW = userNameW ?? fitW;

  return (
    <div className="panel-loads">
      {multiPanel && <h3>{panel.name}</h3>}
      <div className="table-scroll">
        <table className="loads">
          <thead>
            <tr>
              <th>Slot</th>
              <th className="name-col" style={{ minWidth: nameW }}>
                Name
                <NameResizer onNameW={onNameW} />
              </th>
              <th>Max A</th>
              <th title="Power at max current">kW</th>
              <th>Circuit</th>
              <th title="General circuit, motor (NEC 430) or HVAC equipment (NEC 440). Set horsepower or MCA/MOCP in Circuit details.">
                Type
              </th>
              <th title="Continuous load (3 h or more): sized at 125%">Cont.</th>
              <th title="Tandem (twin) breaker: two 1-pole circuits share one space">Tandem</th>
              <th title="Estimated typical running current. Blank = same as max.">Est. A</th>
              <th title="Sizing current: 125% of continuous + 100% of other load. It isn't extra current; the breaker and wire must be rated for at least this.">
                Sizing
              </th>
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
              const amps = circuitAmps(l);
              const nDev = l.equip === 'general' ? l.devices.length : 0;
              const equipped = l.equip !== 'general';
              const devTitle = `Sum of ${nDev} device${nDev > 1 ? 's' : ''}; edit in the Devices tab`;
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
                      <option value="">
                        {p && !(l.locked && l.slot != null) ? `Auto · ${p.slot}${p.half ?? ''}` : 'Auto'}
                      </option>
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
                      <span className="name-wrap">
                        <input
                          value={l.name}
                          title={l.name || undefined}
                          placeholder="Circuit name"
                          aria-label="Circuit name"
                          onChange={(e) => update(l.id, { name: e.target.value })}
                        />
                        <button
                          className={`dev-btn${nDev ? ' has' : ''}`}
                          title={nDev ? `${nDev} device${nDev > 1 ? 's' : ''}; open in Devices` : 'Add devices'}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenDevices(l.id);
                          }}
                        >
                          🔌{nDev ? ` ${nDev}` : ''}
                        </button>
                      </span>
                    )}
                  </td>
                  <td>
                    {sub ? (
                      <span className="num pad" title={`${sub.name} max phase load`}>
                        {fmtA(maxPhase(derived.totals.get(sub.id)!.max, state.mode))}
                      </span>
                    ) : nDev ? (
                      <span className="num pad derived" title={devTitle}>
                        {fmtA(amps.max)}
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
                  <td>
                    {!sub && (
                      <span className="name-wrap">
                        <select
                          value={l.equip}
                          aria-label="Equipment type"
                          onChange={(e) => update(l.id, { equip: e.target.value as EquipType })}
                        >
                          <option value="general">General</option>
                          <option value="motor">Motor</option>
                          <option value="hvac">HVAC</option>
                        </select>
                        {equipped && (
                          <button
                            className="dev-btn has"
                            title={
                              l.equip === 'motor'
                                ? `${l.hp ? `${l.hp} hp` : 'Set hp'} · ${l.motorStart === 'dol' ? 'magnetic start' : 'drive'}; edit in Circuit details`
                                : `MCA ${l.mca ?? '?'} A · MOCP ${l.mocp ?? '?'} A; edit in Circuit details`
                            }
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenDevices(l.id);
                            }}
                          >
                            {l.equip === 'motor' ? (l.hp ? `${l.hp} hp` : 'hp?') : l.mca ? `${l.mca} MCA` : 'MCA?'}
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="center">
                    {!sub && (
                      <input
                        type="checkbox"
                        checked={amps.continuous}
                        disabled={nDev > 0 || equipped}
                        title={
                          equipped
                            ? 'Motor and HVAC rules already include their own 125% factor'
                            : nDev
                              ? 'Set per device in Circuit details'
                              : undefined
                        }
                        aria-label="Continuous"
                        onChange={(e) => update(l.id, { continuous: e.target.checked })}
                      />
                    )}
                  </td>
                  <td className="center">
                    {!sub && (
                      <input
                        type="checkbox"
                        checked={l.tandem && poles === 1}
                        disabled={poles > 1 || !tandemOk}
                        aria-label="Tandem breaker"
                        title={
                          poles > 1
                            ? 'Only 1-pole circuits go on tandem breakers'
                            : !tandemOk
                              ? `${panel.name} doesn't take tandems: raise its Circuits above its Spaces`
                              : 'Share a space with another tandem circuit'
                        }
                        onChange={(e) => update(l.id, { tandem: e.target.checked })}
                      />
                    )}
                  </td>
                  <td>
                    {sub ? (
                      <span className="num pad" title={`${sub.name} estimated phase load`}>
                        {fmtA(subEst)}
                      </span>
                    ) : nDev ? (
                      <span className="num pad derived" title={devTitle}>
                        {fmtA(amps.est)}
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
                  <td
                    className="num"
                    title={
                      l.equip === 'motor'
                        ? `125% of ${fmtA(s.flc ?? 0)} A ${s.flcFromTable ? 'code full-load current (NEC 430.22)' : 'motor current'}`
                        : l.equip === 'hvac'
                          ? 'Nameplate minimum circuit ampacity (NEC 440.33)'
                          : undefined
                    }
                  >
                    {s.required > 0 ? fmtA(s.required) : '—'}
                  </td>
                  {sub ? (
                    <td
                      className={`num strong${feederOver ? ' over' : ''}`}
                      title={feederOver ? `${sub.name} load exceeds its feeder breaker` : undefined}
                    >
                      {s.breaker ? `${s.breaker} A ${poles}P` : '—'}
                    </td>
                  ) : (
                    <td className="num strong">
                      <span className="name-wrap">
                        <select
                          className={`breaker-select${l.breakerA != null ? ' override' : ''}`}
                          value={l.breakerA ?? ''}
                          aria-label="Breaker"
                          title={
                            s.maxAllowed
                              ? `Auto picks ${s.auto ?? '—'} A; allowed up to ${s.maxAllowed} A`
                              : 'Auto picks the smallest standard breaker that fits; choose a size to match what is installed'
                          }
                          onChange={(e) =>
                            update(l.id, { breakerA: e.target.value === '' ? null : Number(e.target.value) })
                          }
                        >
                          <option value="">{s.auto ? `Auto · ${s.auto}` : 'Auto'}</option>
                          {BREAKER_SIZES.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                        <span className="muted">A {poles}P</span>
                        {s.issues.length > 0 && (
                          <span className="issue" title={s.issues.join('\n')}>
                            ⚠
                          </span>
                        )}
                      </span>
                    </td>
                  )}
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
                          <span className="tag" title={`Tandem breaker, half ${p.half}`}>
                            T{p.half}
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
