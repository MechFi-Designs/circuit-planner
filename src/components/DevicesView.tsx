import type { Dispatch } from 'react';
import type { AppState, Device, Load } from '../types';
import { newDevice, type Action } from '../state';
import type { Derived } from '../lib/derive';
import { circuitAmps, deviceAmps } from '../lib/loadCalc';
import { BREAKER_SIZES, formatWire, KINDS } from '../lib/nec';
import { fmtA, fmtKw } from '../lib/sizing';
import { DEVICE_PRESETS, presetByName } from '../lib/devicePresets';
import { NumInput } from './NumInput';
import { PhaseChip } from './PhaseChip';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
  derived: Derived;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const level = (pct: number) => (pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok');

export function DevicesView({ state, dispatch, derived, selectedId, onSelect }: Props) {
  const circuits = state.loads.filter((l) => !l.feeds);
  const selected = circuits.find((l) => l.id === selectedId) ?? circuits[0];

  return (
    <main className="devices-layout">
      <section className="card circuit-list">
        <div className="card-head">
          <h2>Circuits</h2>
        </div>
        {state.panels.map((panel) => {
          const list = circuits.filter((l) => l.panelId === panel.id);
          if (!list.length) return null;
          return (
            <div key={panel.id}>
              {state.panels.length > 1 && <h3>{panel.name}</h3>}
              <ul>
                {list.map((l) => {
                  const s = derived.sizing.get(l.id)!;
                  const p = derived.layouts.get(panel.id)!.placements.get(l.id);
                  const pct = s.breaker ? (circuitAmps(l).max / s.breaker) * 100 : 0;
                  return (
                    <li key={l.id}>
                      <button
                        className={`circuit-item${selected?.id === l.id ? ' on' : ''}`}
                        onClick={() => onSelect(l.id)}
                      >
                        <span className="ci-slot">{p ? `${p.slot}${p.half ?? ''}` : '—'}</span>
                        <span className="ci-name">{l.name || 'Unnamed'}</span>
                        <span className="ci-meta muted">
                          {l.devices.length ? `${l.devices.length} dev` : ''}
                          {s.breaker ? ` · ${s.breaker} A` : ''}
                        </span>
                        <span className="ci-bar">
                          <span className={`fill ${level(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
        {!circuits.length && <p className="muted">No circuits yet. Add some in the Panels tab.</p>}
      </section>

      {selected ? (
        <CircuitDevices key={selected.id} load={selected} state={state} dispatch={dispatch} derived={derived} />
      ) : (
        <section className="card" />
      )}
    </main>
  );
}

interface CircuitProps {
  load: Load;
  state: AppState;
  dispatch: Dispatch<Action>;
  derived: Derived;
}

function CircuitDevices({ load, state, dispatch, derived }: CircuitProps) {
  const s = derived.sizing.get(load.id)!;
  const amps = circuitAmps(load);
  const panel = state.panels.find((p) => p.id === load.panelId)!;
  const placement = derived.layouts.get(panel.id)!.placements.get(load.id);
  const kind = KINDS[load.kind];
  const setDevices = (devices: Device[]) => dispatch({ type: 'updateLoad', id: load.id, patch: { devices } });
  const updateDevice = (id: string, patch: Partial<Device>) =>
    setDevices(load.devices.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const pct = s.breaker ? (amps.max / s.breaker) * 100 : 0;
  const sizingPct = s.breaker ? (s.required / s.breaker) * 100 : 0;
  const estPct = s.breaker ? (amps.est / s.breaker) * 100 : 0;

  const addPreset = (name: string) => {
    const p = presetByName(name);
    if (p)
      setDevices([...load.devices, newDevice({ name: p.name, max: p.maxW, est: p.estW, continuous: !!p.continuous })]);
  };

  return (
    <section className="card circuit-devices">
      <div className="card-head">
        <div>
          <input
            className="circuit-title"
            value={load.name}
            placeholder="Circuit name"
            aria-label="Circuit name"
            onChange={(e) => dispatch({ type: 'updateLoad', id: load.id, patch: { name: e.target.value } })}
          />
          <div className="muted">
            {panel.name} · {placement ? `space ${placement.slots.join(', ')}${placement.half ?? ''}` : 'not placed'} ·{' '}
            {kind.label}
            {placement && (
              <span className="chips inline">
                {placement.phases.map((ph, i) => (
                  <PhaseChip key={i} phase={ph} />
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="circuit-stats">
          <div>
            <span className="muted small-caps">Breaker</span>
            <strong>{s.breaker ? `${s.breaker} A ${kind.poles}P` : '—'}</strong>
          </div>
          <div>
            <span className="muted small-caps">Wire</span>
            <strong>
              {formatWire(s.cu)} Cu{s.egc ? ` · ${s.egc} G` : ''}
            </strong>
          </div>
        </div>
      </div>

      <div className="circuit-meter">
        <div
          className="bar"
          title={`${fmtA(amps.max)} A max · ${fmtA(amps.est)} A estimated · ${fmtA(s.required)} A sizing`}
        >
          <div className={`fill ${level(pct)}`} style={{ width: `${Math.min(100, pct)}%` }} />
          <div className="fill est" style={{ width: `${Math.min(100, estPct)}%` }} />
          {sizingPct > pct + 0.5 && <div className="sizing-tick" style={{ left: `${Math.min(100, sizingPct)}%` }} />}
        </div>
        <div className="meter-text">
          <span>
            Max <strong>{fmtA(amps.max)} A</strong>
            {s.breaker ? ` (${Math.round(pct)}% of breaker)` : ''} · {fmtKw(s.kw)} kW
          </span>
          <span className="muted">
            Est. {fmtA(amps.est)} A · {fmtKw(s.estKw)} kW
          </span>
          {s.required > amps.max + 0.05 && (
            <span
              className="muted"
              title="The current the wire must be rated for. It's a sizing figure, not extra current."
            >
              Sizing {fmtA(s.required)} A (
              {load.equip === 'motor'
                ? `125% of ${s.flcFromTable ? 'code FLC' : 'motor current'}`
                : load.equip === 'hvac'
                  ? 'nameplate MCA'
                  : 'continuous at 125%'}
              )
            </span>
          )}
        </div>
      </div>

      <EquipmentPanel load={load} dispatch={dispatch} derived={derived} />

      {load.equip !== 'general' ? (
        <p className="muted empty-note">
          Devices apply to general circuits. This one is sized as{' '}
          {load.equip === 'motor' ? 'a motor' : 'HVAC equipment'} from its nameplate.
        </p>
      ) : (
        <>
          {kind.poles === 1 && s.breaker != null && s.breaker > 20 && (
            <p className="warning">
              ⚠ This needs a {s.breaker} A breaker, more than a standard 15/20 A {kind.volts} V circuit. Consider
              splitting these devices across circuits.
            </p>
          )}

          {load.devices.length === 0 && (
            <p className="muted empty-note">
              No devices yet, so this circuit uses the {fmtA(load.amps)} A max{load.continuous ? ' (continuous)' : ''}{' '}
              set in the load table. Add devices to build it up from what's actually on it.
            </p>
          )}

          {load.devices.length > 0 && (
            <div className="table-scroll">
              <table className="devices">
                <thead>
                  <tr>
                    <th className="name-col">Device</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th title="Max / nameplate draw, each">Max</th>
                    <th title="Typical draw, each. Blank = same as max.">Est.</th>
                    <th title="Runs 3 h or more at a time: sized at 125%">Cont.</th>
                    <th title="Total max current for this line">Max A</th>
                    <th title="Total estimated current for this line">Est. A</th>
                    <th aria-label="Delete" />
                  </tr>
                </thead>
                <tbody>
                  {load.devices.map((d) => (
                    <tr key={d.id}>
                      <td className="name-col">
                        <input
                          value={d.name}
                          list="device-presets"
                          placeholder="Device"
                          aria-label="Device name"
                          onChange={(e) => {
                            const p = d.max ? undefined : presetByName(e.target.value);
                            updateDevice(
                              d.id,
                              p
                                ? {
                                    name: e.target.value,
                                    unit: 'W',
                                    max: p.maxW,
                                    est: p.estW,
                                    continuous: !!p.continuous,
                                  }
                                : { name: e.target.value },
                            );
                          }}
                        />
                      </td>
                      <td>
                        <NumInput
                          live
                          min={0}
                          className="qty"
                          value={d.qty}
                          aria-label="Quantity"
                          onCommit={(qty) => updateDevice(d.id, { qty: Math.max(0, Math.round(qty)) })}
                        />
                      </td>
                      <td>
                        <select
                          value={d.unit}
                          aria-label="Unit"
                          onChange={(e) => updateDevice(d.id, { unit: e.target.value as Device['unit'] })}
                        >
                          <option value="W">W</option>
                          <option value="A">A</option>
                        </select>
                      </td>
                      <td>
                        <NumInput
                          live
                          min={0}
                          step="any"
                          className="amps"
                          value={d.max}
                          aria-label="Max draw"
                          onCommit={(max) => updateDevice(d.id, { max: Math.max(0, max) })}
                        />
                      </td>
                      <td>
                        <NumInput
                          live
                          min={0}
                          step="any"
                          className="amps est"
                          value={d.est}
                          placeholder={d.max ? String(d.max) : ''}
                          aria-label="Estimated draw"
                          onCommit={(est) => updateDevice(d.id, { est: Math.max(0, est) })}
                          onClear={() => updateDevice(d.id, { est: null })}
                        />
                      </td>
                      <td className="center">
                        <input
                          type="checkbox"
                          checked={d.continuous}
                          aria-label="Continuous"
                          onChange={(e) => updateDevice(d.id, { continuous: e.target.checked })}
                        />
                      </td>
                      <td className="num">{fmtA(deviceAmps(load.kind, d.max, d.unit, d.qty))}</td>
                      <td className="num muted">{fmtA(deviceAmps(load.kind, d.est ?? d.max, d.unit, d.qty))}</td>
                      <td>
                        <button
                          className="icon-btn"
                          title="Remove device"
                          onClick={() => setDevices(load.devices.filter((x) => x.id !== d.id))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="device-actions">
            <button className="btn ghost small" onClick={() => setDevices([...load.devices, newDevice()])}>
              + Add device
            </button>
            <select
              className="preset-select"
              value=""
              aria-label="Add a common device"
              onChange={(e) => addPreset(e.target.value)}
            >
              <option value="">+ Common device…</option>
              {DEVICE_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.maxW} W)
                </option>
              ))}
            </select>
            {load.devices.length > 0 && (
              <button
                className="btn ghost small"
                onClick={() => {
                  if (confirm('Remove all devices from this circuit?')) setDevices([]);
                }}
              >
                Clear devices
              </button>
            )}
          </div>
          <datalist id="device-presets">
            {DEVICE_PRESETS.map((p) => (
              <option key={p.name} value={p.name} />
            ))}
          </datalist>
          <p className="legend muted">
            Watts convert to amps at {kind.volts} V{kind.poles === 3 ? ' 3-phase (÷ √3·V)' : ''}. The breaker is sized
            for 125% of continuous devices plus 100% of the rest; that's a sizing margin, not extra current.
            Common-device values are typical figures; use the nameplate when you have it.
          </p>
        </>
      )}
    </section>
  );
}

const BREAKER_HELP = 'Auto, or the breaker that is installed or specified';

/** Type, nameplate data and breaker for a circuit, with the NEC rule behind each number. */
function EquipmentPanel({ load, dispatch, derived }: Omit<CircuitProps, 'state'>) {
  const s = derived.sizing.get(load.id)!;
  const kind = KINDS[load.kind];
  const update = (patch: Partial<Load>) => dispatch({ type: 'updateLoad', id: load.id, patch });
  const volts = kind.poles === 3 ? '208 V 3-phase' : `${kind.volts} V`;
  const table = kind.poles === 3 ? '430.250' : '430.248';

  const notes: string[] = [];
  if (load.equip === 'motor' && load.motorStart === 'dol') {
    notes.push(
      s.flcFromTable
        ? `Code full-load current ${fmtA(s.flc!)} A (NEC Table ${table}, ${load.hp} hp at ${volts}). The ${fmtA(load.amps)} A nameplate is used for load totals and the overload setting.`
        : `Using the ${fmtA(load.amps)} A nameplate until horsepower is entered.`,
      `Wire: 125% of ${fmtA(s.flc!)} A = ${fmtA(s.required)} A → ${formatWire(s.cu)} Cu (NEC 430.22).`,
      `Breaker: up to ${s.maxAllowed} A allowed (250% of FLC, NEC 430.52). Auto picks ${s.auto} A (about 175%) to leave room for starting current.`,
      'Panels and the service add 25% of the largest motor (NEC 430.24).',
    );
  } else if (load.equip === 'motor') {
    notes.push(
      `Drive input current ${fmtA(load.amps)} A: wire at 125% = ${fmtA(s.required)} A → ${formatWire(s.cu)} Cu (NEC 430.122).`,
      'Use the breaker the drive or machine manual specifies; drives soft-start, so there is no inrush to allow for.',
    );
  } else if (load.equip === 'hvac') {
    notes.push(
      `Wire sized to the ${fmtA(s.required)} A MCA → ${formatWire(s.cu)} Cu (NEC 440.33).`,
      load.mocp
        ? `Breaker no larger than the ${load.mocp} A MOCP (NEC 440.22). Use a HACR-rated breaker if the nameplate calls for one.`
        : 'Enter the nameplate MOCP (maximum overcurrent protection) to cap the breaker.',
    );
  }

  return (
    <div className="equip">
      <div className="equip-fields">
        <label>
          <span>Type</span>
          <select value={load.equip} onChange={(e) => update({ equip: e.target.value as Load['equip'] })}>
            <option value="general">General circuit</option>
            <option value="motor">Motor (NEC 430)</option>
            <option value="hvac">HVAC equipment (NEC 440)</option>
          </select>
        </label>
        {load.equip !== 'general' && (
          <label>
            <span>
              {load.equip === 'motor' ? (load.motorStart === 'vfd' ? 'Drive input A' : 'Nameplate A') : 'Running A'}
            </span>
            <NumInput
              min={0}
              step="any"
              value={load.amps}
              title={
                load.equip === 'hvac'
                  ? 'Compressor RLA plus fan FLAs from the nameplate'
                  : 'Full-load amps from the nameplate'
              }
              onCommit={(amps) => update({ amps: Math.max(0, amps) })}
            />
          </label>
        )}
        {load.equip === 'motor' && (
          <>
            <label>
              <span>Horsepower</span>
              <NumInput
                min={0}
                step="any"
                value={load.hp}
                onCommit={(hp) => update({ hp: hp > 0 ? hp : null })}
                onClear={() => update({ hp: null })}
              />
            </label>
            <label>
              <span>Starts by</span>
              <select
                value={load.motorStart}
                onChange={(e) => update({ motorStart: e.target.value as Load['motorStart'] })}
              >
                <option value="dol">Magnetic starter (across the line)</option>
                <option value="vfd">Drive / soft starter</option>
              </select>
            </label>
          </>
        )}
        {load.equip === 'hvac' && (
          <>
            <label>
              <span>MCA</span>
              <NumInput
                min={0}
                step="any"
                value={load.mca}
                title="Minimum circuit ampacity from the nameplate"
                onCommit={(mca) => update({ mca: mca > 0 ? mca : null })}
                onClear={() => update({ mca: null })}
              />
            </label>
            <label>
              <span>MOCP</span>
              <NumInput
                min={0}
                step="any"
                value={load.mocp}
                title="Maximum overcurrent protection (max fuse / HACR breaker) from the nameplate"
                onCommit={(mocp) => update({ mocp: mocp > 0 ? mocp : null })}
                onClear={() => update({ mocp: null })}
              />
            </label>
          </>
        )}
        <label>
          <span>Breaker</span>
          <select
            className={`breaker-select${load.breakerA != null ? ' override' : ''}`}
            value={load.breakerA ?? ''}
            title={BREAKER_HELP}
            onChange={(e) => update({ breakerA: e.target.value === '' ? null : Number(e.target.value) })}
          >
            <option value="">{s.auto ? `Auto · ${s.auto} A` : 'Auto'}</option>
            {BREAKER_SIZES.map((b) => (
              <option key={b} value={b}>
                {b} A
              </option>
            ))}
          </select>
        </label>
      </div>
      {(notes.length > 0 || s.issues.length > 0) && (
        <ul className="equip-notes">
          {s.issues.map((t) => (
            <li key={t} className="warn-text">
              ⚠ {t}
            </li>
          ))}
          {notes.map((t) => (
            <li key={t} className="muted">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
