export type ServiceMode = 'split' | 'three';

export type Phase = 'A' | 'B' | 'C';

/** Circuit voltage / pole configuration. */
export type LoadKind = '120-1p' | '240-2p' | '208-2p' | '208-3p';

export interface Panel {
  id: string;
  name: string;
  /** Main breaker rating (A), or the feeder breaker rating when fed from another panel. */
  mainA: number;
  /** Parent panel id, or null when fed directly from the service. */
  fedFrom: string | null;
  /** Physical breaker spaces. */
  spaces: number;
  /** Max circuits (spaces × 2 when tandems are allowed everywhere). */
  maxCircuits: number;
}

/** Something plugged into or wired to a circuit. */
export interface Device {
  id: string;
  name: string;
  qty: number;
  /** Units for max/est: watts or amps. */
  unit: 'W' | 'A';
  /** Nameplate / max draw per unit. */
  max: number;
  /** Typical draw per unit; null = same as max. */
  est: number | null;
  /** Runs 3 h or more at a time (sized at 125%). */
  continuous: boolean;
}

export interface Load {
  id: string;
  panelId: string;
  name: string;
  /** Max (nameplate / calculated) current in amps. */
  amps: number;
  /** Estimated typical running current; null = same as max. */
  estAmps: number | null;
  kind: LoadKind;
  continuous: boolean;
  /** On a tandem (twin) breaker sharing one space with another 1-pole circuit. */
  tandem: boolean;
  /** Starting breaker space, or null for auto placement. */
  slot: number | null;
  /** Locked circuits keep their slot when optimizing. */
  locked: boolean;
  /** Devices on this circuit. When present they replace amps/estAmps/continuous. */
  devices: Device[];
  /** Set on the feeder breaker that supplies a subpanel (its id). */
  feeds?: string;
}

export interface AppState {
  mode: ServiceMode;
  /** Service rating (A). */
  serviceA: number;
  panels: Panel[];
  loads: Load[];
  /** Let Optimize move unlocked circuits between panels. */
  optimizeAcrossPanels: boolean;
}
