import { useEffect, useMemo, useReducer, useState } from 'react';
import type { ServiceMode } from './types';
import { defaultState, initialState, persist, reducer, shareUrl } from './state';
import { layoutPanel, type PanelLayout } from './lib/placement';
import { addTotals, phaseTotals, zeroPhases, type PhaseAmps, type PhaseTotals } from './lib/loadCalc';
import { optimizePanel } from './lib/optimize';
import { MODE_LABEL, MODE_PHASES } from './lib/nec';
import { fmtA } from './lib/sizing';
import { ServiceConfig } from './components/ServiceConfig';
import { PanelDiagram } from './components/PanelDiagram';
import { LoadTable } from './components/LoadTable';
import { SummaryBar } from './components/SummaryBar';

interface Notice {
  kind: 'ok' | 'info' | 'bad';
  text: string;
}

// Read once: initialState() consumes the share-link hash, and StrictMode calls reducer initializers twice.
const bootState = initialState();

export default function App() {
  const [state, dispatch] = useReducer(reducer, bootState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => persist(state), [state]);

  const { layouts, panelTotals, service } = useMemo(() => {
    const layouts = new Map<string, PanelLayout>();
    const panelTotals = new Map<string, PhaseTotals>();
    let service: PhaseTotals = { connected: zeroPhases(), worst: zeroPhases() };
    for (const p of state.panels) {
      const loads = state.loads.filter((l) => l.panelId === p.id);
      const lay = layoutPanel(p, loads, state.mode);
      const t = phaseTotals(loads, lay.placements);
      layouts.set(p.id, lay);
      panelTotals.set(p.id, t);
      service = addTotals(service, t);
    }
    return { layouts, panelTotals, service };
  }, [state]);

  const setMode = (mode: ServiceMode) => {
    if (mode !== state.mode) {
      dispatch({ type: 'setMode', mode });
      setNotice(null);
    }
  };

  const optimize = () => {
    const slots = new Map<string, number>();
    const after: PhaseAmps = { ...service.worst };
    const failed: string[] = [];
    for (const p of state.panels) {
      const loads = state.loads.filter((l) => l.panelId === p.id);
      const res = optimizePanel(p, loads, state.mode, layouts.get(p.id)!);
      if (res.failed) failed.push(p.name);
      if (!res.improved) continue;
      res.slots.forEach((s, id) => slots.set(id, s));
      for (const ph of MODE_PHASES[state.mode]) after[ph] += res.after[ph] - res.before[ph];
    }
    if (slots.size) {
      dispatch({ type: 'applySlots', slots });
      const parts = MODE_PHASES[state.mode].map(
        (ph) => `${ph} ${fmtA(service.worst[ph])}→${fmtA(after[ph])}`,
      );
      setNotice({ kind: 'ok', text: `Rebalanced (worst-case A): ${parts.join(' · ')}` });
    } else if (failed.length) {
      setNotice({ kind: 'bad', text: `Couldn't fit all circuits around locked ones in ${failed.join(', ')}.` });
    } else {
      setNotice({ kind: 'info', text: 'Already as balanced as it gets with the current locks.' });
    }
  };

  const share = async () => {
    const url = shareUrl(state);
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ kind: 'ok', text: 'Share link copied to clipboard.' });
    } catch {
      prompt('Copy this share link:', url);
    }
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ⚡
          </span>
          <h1>Circuit Planner</h1>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Service type">
          {(['split', 'three'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={state.mode === m} className={state.mode === m ? 'on' : ''} onClick={() => setMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="actions">
          <button className="btn" onClick={share}>
            Share link
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              if (confirm('Clear all circuits?')) dispatch({ type: 'clearLoads' });
            }}
          >
            Clear
          </button>
          <button
            className="btn ghost"
            title="Load the example design"
            onClick={() => {
              if (confirm('Replace everything with the example design?')) dispatch({ type: 'replace', state: defaultState() });
            }}
          >
            Example
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role="status">
          <span>{notice.text}</span>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
            ✕
          </button>
        </div>
      )}

      <SummaryBar state={state} service={service} panelTotals={panelTotals} layouts={layouts} />

      <main className="layout">
        <div className="col-left">
          <ServiceConfig state={state} dispatch={dispatch} />
          {state.panels.map((p) => (
            <PanelDiagram
              key={p.id}
              panel={p}
              layout={layouts.get(p.id)!}
              loads={state.loads.filter((l) => l.panelId === p.id)}
              mode={state.mode}
              totals={panelTotals.get(p.id)!}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </div>
        <div className="col-right">
          <LoadTable
            state={state}
            dispatch={dispatch}
            layouts={layouts}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOptimize={optimize}
          />
        </div>
      </main>

      <footer className="footer muted">
        Planning aid only, based on NEC 2023 Table 310.16 (THHN, 75 °C terminations), 240.4(D) and 240.6(A). It
        doesn't account for ambient or conduit-fill derating, voltage drop, or local amendments. Verify with your
        AHJ and a licensed electrician.
      </footer>
    </div>
  );
}
