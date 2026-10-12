import type { Dispatch } from 'react';
import type { AppState } from '../types';
import type { Action } from '../state';
import { NumInput } from './NumInput';

interface Props {
  state: AppState;
  dispatch: Dispatch<Action>;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export function ServiceConfig({ state, dispatch }: Props) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Service &amp; panels</h2>
        <label className="field inline">
          <span>Service</span>
          <span className="input-unit">
            <NumInput
              min={0}
              value={state.serviceA}
              aria-label="Service rating amps"
              onCommit={(amps) => dispatch({ type: 'setServiceA', amps: Math.max(0, amps) })}
            />
            <em>A</em>
          </span>
        </label>
      </div>

      <div className="table-scroll">
        <table className="panel-config">
          <thead>
            <tr>
              <th>Panel</th>
              <th>Main (A)</th>
              <th>Spaces</th>
              <th title="More circuits than spaces allows tandem breakers">Circuits</th>
              <th aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {state.panels.map((p) => (
              <tr key={p.id}>
                <td>
                  <input
                    value={p.name}
                    aria-label="Panel name"
                    onChange={(e) => dispatch({ type: 'updatePanel', id: p.id, patch: { name: e.target.value } })}
                  />
                </td>
                <td>
                  <NumInput
                    min={0}
                    value={p.mainA}
                    aria-label="Main breaker amps"
                    onCommit={(v) => dispatch({ type: 'updatePanel', id: p.id, patch: { mainA: Math.max(0, v) } })}
                  />
                </td>
                <td>
                  <NumInput
                    min={2}
                    max={84}
                    step={2}
                    value={p.spaces}
                    aria-label="Spaces"
                    onCommit={(v) => {
                      const spaces = clamp(v, 2, 84);
                      const maxCircuits = clamp(p.maxCircuits, spaces, spaces * 2);
                      dispatch({ type: 'updatePanel', id: p.id, patch: { spaces, maxCircuits } });
                    }}
                  />
                </td>
                <td>
                  <NumInput
                    min={p.spaces}
                    max={p.spaces * 2}
                    value={p.maxCircuits}
                    aria-label="Max circuits"
                    onCommit={(v) =>
                      dispatch({
                        type: 'updatePanel',
                        id: p.id,
                        patch: { maxCircuits: clamp(v, p.spaces, p.spaces * 2) },
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    className="icon-btn"
                    title="Remove panel and its circuits"
                    disabled={state.panels.length <= 1}
                    onClick={() => {
                      const count = state.loads.filter((l) => l.panelId === p.id).length;
                      if (!count || confirm(`Remove ${p.name} and its ${count} circuit(s)?`)) {
                        dispatch({ type: 'removePanel', id: p.id });
                      }
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn ghost small" onClick={() => dispatch({ type: 'addPanel' })}>
        + Add panel
      </button>
    </section>
  );
}
