import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ServiceMode } from './types';
import { defaultState, exportFile, initialState, parseFile, persist, reducer, shareUrl } from './state';
import { derive } from './lib/derive';
import { isOverloaded, optimizePreview, overloadAdvice } from './lib/advice';
import { optimizeAll } from './lib/optimize';
import { exportPdf } from './lib/pdf';
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

  const derived = useMemo(() => derive(state), [state]);
  const advice = useMemo(() => overloadAdvice(state, derived, optimizePreview(state, derived)), [state, derived]);
  const fileInput = useRef<HTMLInputElement>(null);

  const setMode = (mode: ServiceMode) => {
    if (mode !== state.mode) {
      dispatch({ type: 'setMode', mode });
      setNotice(null);
    }
  };

  const optimize = () => {
    const res = optimizeAll(state);
    const parts = MODE_PHASES[state.mode].map((ph) => `${ph} ${fmtA(res.before[ph])}→${fmtA(res.after[ph])}`);
    const lines: string[] = [];
    if (res.moved.length) {
      const list = res.moved.map((m) => `${m.name} (${m.from} → ${m.to})`).join(', ');
      lines.push(`Moved ${res.moved.length} circuit${res.moved.length > 1 ? 's' : ''} between panels: ${list}.`);
    }
    const phasesChanged = MODE_PHASES[state.mode].some((ph) => Math.abs(res.before[ph] - res.after[ph]) > 0.05);
    if (res.loads && phasesChanged) lines.push(`Service phases (worst-case A): ${parts.join(' · ')}.`);
    else if (res.loads && !res.moved.length) {
      lines.push('Re-slotted unlocked circuits into a tidier layout; phase balance was already as good as it gets.');
    }
    if (res.crossPanelNoGain) {
      lines.push(
        'No circuits needed to move between panels. A subpanel’s load still flows through the panel feeding it, so moving circuits there doesn’t lower that panel’s or the service’s load.',
      );
    }
    if (res.failed.length) lines.push(`Couldn't fit all circuits around locked ones in ${res.failed.join(', ')}.`);
    const result = res.loads ? { ...state, loads: res.loads } : state;
    if (isOverloaded(result, derive(result))) {
      lines.push('Some panels are still over their rating; the warnings above say what would fix it.');
    }
    if (res.loads) dispatch({ type: 'setLoads', loads: res.loads });
    else if (!res.failed.length) lines.unshift('Already as balanced as it gets with the current locks.');
    setNotice({ kind: res.failed.length ? 'bad' : res.loads ? 'ok' : 'info', text: lines.join(' ') });
  };

  const openFile = async (file: File) => {
    const next = parseFile(await file.text());
    if (next) {
      dispatch({ type: 'replace', state: next });
      setNotice({ kind: 'ok', text: `Opened ${file.name}.` });
    } else {
      setNotice({ kind: 'bad', text: `${file.name} isn't a Circuit Planner file.` });
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
            <button
              key={m}
              role="radio"
              aria-checked={state.mode === m}
              className={state.mode === m ? 'on' : ''}
              onClick={() => setMode(m)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <div className="actions">
          <button className="btn" onClick={share} title="Copy a link containing this whole design">
            Share link
          </button>
          <button
            className="btn"
            onClick={() => exportPdf(state, derived)}
            title="Download a printable circuit directory (one letter page per panel)"
          >
            Export PDF
          </button>
          <button className="btn" onClick={() => exportFile(state)} title="Download this design as a .json file">
            Save file
          </button>
          <button className="btn" onClick={() => fileInput.current?.click()} title="Open a saved .json design">
            Open file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) openFile(f);
              e.target.value = '';
            }}
          />
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
              if (confirm('Replace everything with the example design?'))
                dispatch({ type: 'replace', state: defaultState() });
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

      <SummaryBar state={state} derived={derived} advice={advice} />

      <main className="layout">
        <div className="col-left">
          <ServiceConfig state={state} dispatch={dispatch} />
          {state.panels.map((p) => (
            <PanelDiagram
              key={p.id}
              panel={p}
              state={state}
              derived={derived}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ))}
        </div>
        <div className="col-right">
          <LoadTable
            state={state}
            dispatch={dispatch}
            derived={derived}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOptimize={optimize}
          />
        </div>
      </main>

      <footer className="footer muted">
        Planning aid only, based on NEC 2023 Table 310.16 (THHN, 75 °C terminations), 240.4(D) and 240.6(A). It doesn't
        account for ambient or conduit-fill derating, voltage drop, or local amendments. Verify with your AHJ and a
        licensed electrician.
      </footer>
    </div>
  );
}
