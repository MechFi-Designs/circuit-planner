import type { ReactNode } from 'react';
import type { AppState, Panel } from '../types';
import type { Derived } from '../lib/derive';
import { maxPhase } from '../lib/loadCalc';
import { MODE_PHASES, phaseOfSlot } from '../lib/nec';
import { fmtA, fmtKw } from '../lib/sizing';
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
            ? `Feeder to ${sub.name}: ${fmtA(s.required)} A worst-case phase`
            : `${name} — ${fmtA(l.amps)} A${l.continuous ? ' continuous' : ''}`
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
        cells.push(
          <div
            key={`b${space}`}
            className={`slot${occ.length > 1 ? ' tandem' : ''}`}
            style={{ gridRow: row, gridColumn: col }}
          >
            {occ.map((id) => breaker(id, occ.length > 1))}
          </div>,
        );
      }
    }
  }

  const worst = maxPhase(totals.worst, mode);
  const pct = panel.mainA ? (worst / panel.mainA) * 100 : 0;
  const estPct = panel.mainA ? (maxPhase(totals.est, mode) / panel.mainA) * 100 : 0;
  const kw = derived.kw.get(panel.id)!;

  return (
    <section className="card panel-card">
      <div className="card-head">
        <h2>{panel.name}</h2>
        <span className="muted">
          {parent ? `${panel.mainA} A feeder from ${parent.name}` : `${panel.mainA} A main`} · {layout.spacesUsed}/
          {panel.spaces} spaces · {layout.circuitsUsed}/{panel.maxCircuits} circuits
        </span>
      </div>
      <div className="phase-row">
        {MODE_PHASES[mode].map((p) => (
          <span key={p} className="phase-total">
            <PhaseChip phase={p} /> {fmtA(totals.worst[p])} A
          </span>
        ))}
        <span className="pct-group">
          <span className={`pct ${pct > 100 ? 'over' : pct > 80 ? 'warn' : 'ok'}`}>{Math.round(pct)}%</span>
          <span className="muted">
            {' '}
            · est {Math.round(estPct)}% of {parent ? 'feeder' : 'main'}
          </span>
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
