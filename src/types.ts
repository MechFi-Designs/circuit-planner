export type ServiceMode = 'split' | 'three';

export type Phase = 'A' | 'B' | 'C';

/** Circuit voltage / pole configuration. */
export type LoadKind = '120-1p' | '240-2p' | '208-2p' | '208-3p';

export interface Panel {
  id: string;
  name: string;
  /** Main breaker rating (A). */
  mainA: number;
  /** Physical breaker spaces. */
  spaces: number;
  /** Max circuits (spaces × 2 when tandems are allowed everywhere). */
  maxCircuits: number;
}

export interface Load {
  id: string;
  panelId: string;
  name: string;
  /** Max (nameplate / calculated) current in amps. */
  amps: number;
  kind: LoadKind;
  continuous: boolean;
  /** Starting breaker space, or null for auto placement. */
  slot: number | null;
  /** Locked circuits keep their slot when optimizing. */
  locked: boolean;
}

export interface AppState {
  mode: ServiceMode;
  /** Service rating (A). */
  serviceA: number;
  panels: Panel[];
  loads: Load[];
}
