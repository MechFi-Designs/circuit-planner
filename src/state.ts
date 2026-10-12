import type { AppState, Load, LoadKind, Panel, ServiceMode } from './types';
import { KINDS, KINDS_BY_MODE, remapKind } from './lib/nec';

const STORAGE_KEY = 'circuit-planner:v1';
const SHARE_PARAM = 's';

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newPanel(index: number): Panel {
  return {
    id: uid(),
    name: `Panel ${String.fromCharCode(65 + (index % 26))}`,
    mainA: 200,
    spaces: 20,
    maxCircuits: 40,
  };
}

export function newLoad(panelId: string, mode: ServiceMode, patch: Partial<Load> = {}): Load {
  return {
    id: uid(),
    panelId,
    name: '',
    amps: 0,
    kind: '120-1p',
    continuous: false,
    slot: null,
    locked: false,
    ...patch,
    ...(patch.kind ? { kind: remapKind(patch.kind, mode) } : {}),
  };
}

export function defaultState(): AppState {
  const panel = newPanel(0);
  const mk = (name: string, amps: number, kind: LoadKind, continuous = false) =>
    newLoad(panel.id, 'split', { name, amps, kind, continuous });
  return {
    mode: 'split',
    serviceA: 200,
    panels: [panel],
    loads: [
      mk('Kitchen counter 1', 16, '120-1p'),
      mk('Kitchen counter 2', 16, '120-1p'),
      mk('Range', 40, '240-2p'),
      mk('Dryer', 24, '240-2p'),
      mk('EV charger', 40, '240-2p', true),
      mk('Water heater', 18.75, '240-2p', true),
      mk('Bedroom lights', 8, '120-1p'),
      mk('Bathroom', 16, '120-1p'),
    ],
  };
}

export type Action =
  | { type: 'setMode'; mode: ServiceMode }
  | { type: 'setServiceA'; amps: number }
  | { type: 'addPanel' }
  | { type: 'updatePanel'; id: string; patch: Partial<Panel> }
  | { type: 'removePanel'; id: string }
  | { type: 'addLoad'; panelId: string }
  | { type: 'updateLoad'; id: string; patch: Partial<Load> }
  | { type: 'removeLoad'; id: string }
  | { type: 'applySlots'; slots: Map<string, number> }
  | { type: 'clearLoads' }
  | { type: 'replace'; state: AppState };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setMode':
      return {
        ...state,
        mode: action.mode,
        loads: state.loads.map((l) => ({ ...l, kind: remapKind(l.kind, action.mode) })),
      };
    case 'setServiceA':
      return { ...state, serviceA: action.amps };
    case 'addPanel':
      return { ...state, panels: [...state.panels, newPanel(state.panels.length)] };
    case 'updatePanel':
      return {
        ...state,
        panels: state.panels.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
      };
    case 'removePanel': {
      if (state.panels.length <= 1) return state;
      return {
        ...state,
        panels: state.panels.filter((p) => p.id !== action.id),
        loads: state.loads.filter((l) => l.panelId !== action.id),
      };
    }
    case 'addLoad':
      return { ...state, loads: [...state.loads, newLoad(action.panelId, state.mode)] };
    case 'updateLoad':
      return {
        ...state,
        loads: state.loads.map((l) => (l.id === action.id ? { ...l, ...action.patch } : l)),
      };
    case 'removeLoad':
      return { ...state, loads: state.loads.filter((l) => l.id !== action.id) };
    case 'applySlots':
      return {
        ...state,
        loads: state.loads.map((l) =>
          action.slots.has(l.id) ? { ...l, slot: action.slots.get(l.id)! } : l,
        ),
      };
    case 'clearLoads':
      return { ...state, loads: [] };
    case 'replace':
      return action.state;
  }
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Validate untrusted JSON (storage or share link) into a well-formed state. */
export function sanitize(raw: unknown): AppState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const mode: ServiceMode = r.mode === 'three' ? 'three' : 'split';
  if (!Array.isArray(r.panels) || !r.panels.length || !Array.isArray(r.loads)) return null;
  const panels: Panel[] = r.panels.map((p: Record<string, unknown>, i: number) => ({
    id: typeof p.id === 'string' ? p.id : uid(),
    name: typeof p.name === 'string' ? p.name : `Panel ${i + 1}`,
    mainA: num(p.mainA, 200),
    spaces: Math.max(1, Math.min(84, Math.round(num(p.spaces, 20)))),
    maxCircuits: Math.max(1, Math.min(168, Math.round(num(p.maxCircuits, 40)))),
  }));
  const panelIds = new Set(panels.map((p) => p.id));
  const loads: Load[] = r.loads
    .filter((l: Record<string, unknown>) => l && panelIds.has(l.panelId as string))
    .map((l: Record<string, unknown>) => {
      const kind = (typeof l.kind === 'string' && l.kind in KINDS ? l.kind : '120-1p') as LoadKind;
      return {
        id: typeof l.id === 'string' ? l.id : uid(),
        panelId: l.panelId as string,
        name: typeof l.name === 'string' ? l.name : '',
        amps: Math.max(0, num(l.amps, 0)),
        kind: KINDS_BY_MODE[mode].includes(kind) ? kind : remapKind(kind, mode),
        continuous: l.continuous === true,
        slot: typeof l.slot === 'number' && l.slot >= 1 ? Math.round(l.slot) : null,
        locked: l.locked === true,
      };
    });
  return { mode, serviceA: num(r.serviceA, 200), panels, loads };
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64: string): string {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function shareUrl(state: AppState): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#${SHARE_PARAM}=${toBase64Url(JSON.stringify(state))}`;
}

function readShared(): AppState | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const encoded = params.get(SHARE_PARAM);
  if (!encoded) return null;
  try {
    return sanitize(JSON.parse(fromBase64Url(encoded)));
  } catch {
    return null;
  }
}

/** Shared link wins, then the last saved design, then the example. */
export function initialState(): AppState {
  const shared = readShared();
  if (shared) {
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return shared;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const parsed = saved ? sanitize(JSON.parse(saved)) : null;
    if (parsed) return parsed;
  } catch {
    /* storage unavailable or corrupt */
  }
  return defaultState();
}

export function persist(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}
