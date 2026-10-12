import type { ReactNode } from 'react';
import type { AppState, Panel } from '../types';
import type { Derived } from '../lib/derive';
import { circuitAmps, maxPhase } from '../lib/loadCalc';
import { MODE_PHASES, phaseOfSlot } from '../lib/nec';
import { fmtA, fmtKw } from '../lib/sizing';
import { exportPdf } from '../lib/pdf';
import { PhaseChip } from './PhaseChip';

interface Props {
  panel: Panel;
  state: AppState;
  derived: Derived;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

const ROW_PX = 34;

export function PanelDiagram({ panel, state, derived, selectedId, onSelect }: Props) {
  const { mode } = state;
  const layout = derived.layouts.get(panel.id)!;
  const totals = derived.totals.get(panel.id)!;
  const parent = state.panels.find((p) => p.id === panel.fedFrom);
  const byId = new Map(state.loads.filter((l) => l.panelId === panel.id).map((l) => [l.id, l]));
  const rows = Math.ceil(panel.spaces / 2);
  const cells: ReactNode[] = [];

  const breaker = (id: string, compact: boolean) => {
    const l = byId.get(id)!;
    const s = derived.sizing.get(id)!;
    const sub = derived.feederOf.get(id);
    const name = sub ? `→ ${sub.name}` : l.name || 'Unnamed';
    return (
      <button
        key={id}
        className={`breaker${selectedId === id ? ' selected' : ''}${compact ? ' half' : ''}${sub ? ' feeder' : ''}`}
        onClick={() => onSelect(selectedId === id ? null : id)}
        title={
          sub
            ? `Feeder to ${sub.name}: ${fmtA(maxPhase(derived.totals.get(sub.id)!.max, mode))} A max phase, ${fmtA(s.required)} A sizing`
            : `${name} — ${fmtA(circuitAmps(l).max)} A${circuitAmps(l).continuous ? ' continuous' : ''}${l.devices.length ? ` · ${l.devices.length} device${l.devices.length > 1 ? 's' : ''}` : ''}`
        }
      >
        <span className="breaker-name">{name}</span>
        <span className="breaker-rating">{s.breaker ? `${s.breaker}` : '—'}</span>
      </button>
    );
  };

  for (let r = 0; r < rows; r++) {
    const row = r + 1;
    const phase = phaseOfSlot(2 * r + 1, mode);
    cells.push(
      <div key={`bus${r}`} className="bus" style={{ gridRow: row, gridColumn: 3 }}>
        <PhaseChip phase={phase} />
      </div>,
    );
    for (const side of [0, 1] as const) {
      const space = 2 * r + 1 + side;
      if (space > panel.spaces) continue;
      const numCol = side === 0 ? 1 : 5;
      const col = side === 0 ? 2 : 4;
      cells.push(
        <div
          key={`n${space}`}
          className={`space-num ${side ? 'right' : 'left'}`}
          style={{ gridRow: row, gridColumn: numCol }}
        >
          {space}
        </div>,
      );
      const occ = layout.spaceMap.get(space) ?? [];
      if (!occ.length) {
        cells.push(<div key={`e${space}`} className="space-empty" style={{ gridRow: row, gridColumn: col }} />);
        continue;
      }
      const placement = layout.placements.get(occ[0])!;
      if (placement.slots.length > 1) {
        if (placement.slot !== space) continue; // covered by the multi-pole span
        cells.push(
          <div
            key={`b${space}`}
            className={`slot multi poles-${placement.slots.length}`}
            style={{ gridRow: `${row} / span ${placement.slots.length}`, gridColumn: col }}
          >
            {breaker(occ[0], false)}
          </div>,
        );
      } else {
        const tandem = placement.tandem;
        cells.push(
          <div key={`b${space}`} className={`slot${tandem ? ' tandem' : ''}`} style={{ gridRow: row, gridColumn: col }}>
            {occ.map((id) => breaker(id, tandem))}
            {tandem && occ.length === 1 && <div className="half-empty" title="Spare half of a tandem breaker" />}
          </div>,
        );
      }
    }
  }

  const ofRating = (amps: number) => (panel.mainA ? (amps / panel.mainA) * 100 : 0);
  const pct = ofRating(maxPhase(totals.max, mode));
  const estPct = ofRating(maxPhase(totals.est, mode));
  const sizingPct = ofRating(maxPhase(totals.design, mode));
  const kw = derived.kw.get(panel.id)!;

  return (
    <section className="card panel-card">
      <div className="card-head">
        <h2>
          {panel.name}
          <button
            className="btn ghost tiny-btn"
            onClick={() => exportPdf(state, derived, [panel.id])}
            title={`Download a printable circuit directory for ${panel.name}`}
          >
            PDF
          </button>
        </h2>
        <span className="muted">
          {parent ? `${panel.mainA} A feeder from ${parent.name}` : `${panel.mainA} A main`} · {layout.spacesUsed}/
          {panel.spaces} spaces · {layout.circuitsUsed}/{panel.maxCircuits} circuits
        </span>
      </div>
      <div className="phase-row">
        {MODE_PHASES[mode].map((p) => (
          <span key={p} className="phase-total">
            <PhaseChip phase={p} /> {fmtA(totals.max[p])} A
          </span>
        ))}
        <span className="pct-group">
          <span className={`pct ${pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok'}`}>{Math.round(pct)}%</span>
          <span className="muted"> · est {Math.round(estPct)}%</span>
          {sizingPct > pct + 0.5 && (
            <span
              className={sizingPct > 100 ? 'pct over' : 'muted'}
              title="Sizing load: continuous loads counted at 125%. This is what the rating must cover."
            >
              {' '}
              · sizing {Math.round(sizingPct)}%
            </span>
          )}
          <span className="muted"> of {parent ? 'feeder' : 'main'}</span>
        </span>
      </div>
      <div className="muted panel-kw">
        {fmtKw(kw.max)} kW max · {fmtKw(kw.est)} kW typical
      </div>
      <div className="panel-frame">
        <div className="panel-main">
          {parent ? `FED FROM ${parent.name.toUpperCase()} · ${panel.mainA} A` : `MAIN ${panel.mainA} A`}
        </div>
        <div className="panel-grid" style={{ gridTemplateRows: `repeat(${rows}, ${ROW_PX}px)` }}>
          {cells}
        </div>
      </div>
      {layout.unplaced.length > 0 && (
        <p className="warning">
          ⚠ {layout.unplaced.length} circuit(s) don't fit
          {layout.conflicts.length ? ` (${layout.conflicts.length} locked slot conflict)` : ''}.
        </p>
      )}
    </section>
  );
}
