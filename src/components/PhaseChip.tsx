import type { Phase } from '../types';

export function PhaseChip({ phase }: { phase: Phase }) {
  return <span className={`phase-chip ph-${phase}`}>{phase}</span>;
}
