import type { AppState, Device, Load, LoadKind, Panel, ServiceMode } from './types';
import { feederKind, KINDS, KINDS_BY_MODE, remapKind } from './lib/nec';
import { isWithin } from './lib/derive';

const STORAGE_KEY = 'circuit-planner:v1';
const SHARE_PARAM = 's';

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newPanel(index: number, fedFrom: string | null = null): Panel {
  return {
    id: uid(),
    name: `Panel ${String.fromCharCode(65 + (index % 26))}`,
    mainA: fedFrom ? 100 : 200,
    fedFrom,
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
    estAmps: null,
    kind: '120-1p',
    continuous: false,
    tandem: false,
    devices: [],
    slot: null,
    locked: false,
    ...patch,
    ...(patch.kind ? { kind: remapKind(patch.kind, mode) } : {}),
  };
}

export function defaultState(): AppState {
  const panel = newPanel(0);
  const mk = (name: string, amps: number, kind: LoadKind, estAmps: number | null, continuous = false) =>
    newLoad(panel.id, 'split', { name, amps, kind, estAmps, continuous });
  return {
    mode: 'split',
    serviceA: 200,
    optimizeAcrossPanels: true,
    panels: [panel],
    loads: [
      mk('Kitchen counter 1', 16, '120-1p', 4),
      mk('Kitchen counter 2', 16, '120-1p', 4),
      mk('Range', 40, '240-2p', 12),
      mk('Dryer', 24, '240-2p', 10),
      mk('EV charger', 40, '240-2p', null, true),
      mk('Water heater', 18.75, '240-2p', 9, true),
      mk('Bedroom lights', 8, '120-1p', 2),
      mk('Bathroom', 16, '120-1p', 3),
    ],
  };
}

export type Action =
  | { type: 'setMode'; mode: ServiceMode }
  | { type: 'setServiceA'; amps: number }
  | { type: 'addPanel' }
  | { type: 'updatePanel'; id: string; patch: Partial<Omit<Panel, 'fedFrom'>> }
  | { type: 'setFedFrom'; id: string; fedFrom: string | null }
  | { type: 'removePanel'; id: string }
  | { type: 'addLoad'; panelId: string }
  | { type: 'updateLoad'; id: string; patch: Partial<Load> }
  | { type: 'removeLoad'; id: string }
  | { type: 'setLoads'; loads: Load[] }
  | { type: 'setOptimizeAcrossPanels'; on: boolean }
  | { type: 'clearLoads' }
  | { type: 'replace'; state: AppState };

export function reducer(state: AppState, action: Action): AppState {
  return syncFeeders(apply(state, action));
}

/**
 * Keep feeder breakers consistent with the feed tree: exactly one feeder load
 * in each subpanel's parent (keeping its slot/lock when it already exists),
 * none for panels fed from the service, and the right pole count for the mode.
 */
export function syncFeeders(state: AppState): AppState {
  const panelIds = new Set(state.panels.map((p) => p.id));
  const panels = state.panels.map((p) =>
    p.fedFrom && (!panelIds.has(p.fedFrom) || isWithin(state.panels, p.id, p.fedFrom)) ? { ...p, fedFrom: null } : p,
  );
  const want = new Map(panels.filter((p) => p.fedFrom).map((p) => [p.id, p.fedFrom!]));
  const kind = feederKind(state.mode);
  const have = new Set<string>();
  const loads: Load[] = [];
  for (const l of state.loads) {
    if (!l.feeds) {
      loads.push(l);
      continue;
    }
    if (want.get(l.feeds) !== l.panelId || have.has(l.feeds)) continue;
    have.add(l.feeds);
    loads.push(l.kind === kind ? l : { ...l, kind });
  }
  for (const [sub, parent] of want) {
    if (!have.has(sub)) loads.push(newLoad(parent, state.mode, { feeds: sub, kind }));
  }
  const changed =
    loads.length !== state.loads.length ||
    loads.some((l, i) => l !== state.loads[i]) ||
    panels.some((p, i) => p !== state.panels[i]);
  return changed ? { ...state, panels, loads } : state;
}

function apply(state: AppState, action: Action): AppState {
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
      // New panels default to a subpanel of the first panel.
      return { ...state, panels: [...state.panels, newPanel(state.panels.length, state.panels[0]?.id ?? null)] };
    case 'setFedFrom':
      if (action.fedFrom && isWithin(state.panels, action.id, action.fedFrom)) return state;
      return {
        ...state,
        panels: state.panels.map((p) => (p.id === action.id ? { ...p, fedFrom: action.fedFrom } : p)),
      };
    case 'updatePanel':
      return {
        ...state,
        panels: state.panels.map((p) => (p.id === action.id ? { ...p, ...action.patch } : p)),
      };
    case 'removePanel': {
      if (state.panels.length <= 1) return state;
      const gone = state.panels.find((p) => p.id === action.id);
      return {
        ...state,
        // Subpanels of the removed panel are re-fed from its parent.
        panels: state.panels
          .filter((p) => p.id !== action.id)
          .map((p) => (p.fedFrom === action.id ? { ...p, fedFrom: gone?.fedFrom ?? null } : p)),
        loads: state.loads.filter((l) => l.panelId !== action.id && l.feeds !== action.id),
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
    case 'setLoads':
      return { ...state, loads: action.loads };
    case 'setOptimizeAcrossPanels':
      return { ...state, optimizeAcrossPanels: action.on };
    case 'clearLoads':
      return { ...state, loads: state.loads.filter((l) => l.feeds) };
    case 'replace':
      return action.state;
  }
}

export function newDevice(patch: Partial<Device> = {}): Device {
  return { id: uid(), name: '', qty: 1, unit: 'W', max: 0, est: null, continuous: false, ...patch };
}

function sanitizeDevices(raw: unknown): Device[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d) => d && typeof d === 'object')
    .map((d: Record<string, unknown>) => ({
      id: typeof d.id === 'string' ? d.id : uid(),
      name: typeof d.name === 'string' ? d.name : '',
      qty: Math.max(0, Math.round(num(d.qty, 1))),
      unit: d.unit === 'A' ? 'A' : 'W',
      max: Math.max(0, num(d.max, 0)),
      est: typeof d.est === 'number' && Number.isFinite(d.est) ? Math.max(0, d.est) : null,
      continuous: d.continuous === true,
    }));
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
    fedFrom: typeof p.fedFrom === 'string' ? p.fedFrom : null,
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
        estAmps: typeof l.estAmps === 'number' && Number.isFinite(l.estAmps) ? Math.max(0, l.estAmps) : null,
        kind: KINDS_BY_MODE[mode].includes(kind) ? kind : remapKind(kind, mode),
        continuous: l.continuous === true,
        tandem: l.tandem === true,
        devices: sanitizeDevices(l.devices),
        slot: typeof l.slot === 'number' && l.slot >= 1 ? Math.round(l.slot) : null,
        locked: l.locked === true,
        ...(typeof l.feeds === 'string' ? { feeds: l.feeds } : {}),
      };
    });
  return syncFeeders({
    mode,
    serviceA: num(r.serviceA, 200),
    optimizeAcrossPanels: r.optimizeAcrossPanels !== false,
    panels,
    loads,
  });
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

const FILE_TAG = 'circuit-planner';

export function exportFile(state: AppState): void {
  const body = JSON.stringify({ app: FILE_TAG, version: 1, savedAt: new Date().toISOString(), state }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = document.createElement('a');
  const name = state.panels[0]?.name.trim().replace(/[^\w-]+/g, '-') || 'panel';
  a.href = url;
  a.download = `circuit-plan-${name}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Parse a saved file (or a bare state object). Returns null if it isn't one. */
export function parseFile(text: string): AppState | null {
  try {
    const raw = JSON.parse(text);
    return sanitize(raw && raw.app === FILE_TAG ? raw.state : raw);
  } catch {
    return null;
  }
}

export function persist(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
}
