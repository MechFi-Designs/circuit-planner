import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultState, reducer } from '../state';
import { derive } from './derive';
import { buildPdf, buildPlanPdf, planRows } from './pdf';

const pdfText = async (state: ReturnType<typeof defaultState>, panelIds?: string[]) => {
  const doc = await buildPdf(state, derive(state), panelIds);
  const bytes = doc.output('arraybuffer');
  if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, Buffer.from(bytes));
  return { text: Buffer.from(bytes).toString('latin1'), pages: doc.getNumberOfPages() };
};

describe('PDF circuit directory', () => {
  it('renders one letter page per panel with every circuit on it', async () => {
    let s = reducer(defaultState(), { type: 'addPanel' });
    const sub = s.panels[1].id;
    s = reducer(s, { type: 'addLoad', panelId: sub });
    const added = s.loads[s.loads.length - 1];
    s = reducer(s, { type: 'updateLoad', id: added.id, patch: { name: 'Garage – shop 🔧', amps: 16 } });
    const { text, pages } = await pdfText(s);
    expect(text.startsWith('%PDF')).toBe(true);
    expect(pages).toBe(2);
    expect(text).toContain('/MediaBox [0 0 612. 792.]');
    for (const name of ['Kitchen counter 1', 'Range', 'EV charger', 'Panel B \\(subpanel feeder\\)']) {
      expect(text).toContain(name);
    }
    // Non-Latin-1 characters are replaced rather than garbling the font.
    expect(text).toContain('Garage ? shop ??');
    expect(text).toContain('Fed from: Panel A, 100 A breaker in spaces');
    // Wire sizes live in the circuit plan, not on the panel door.
    expect(text).not.toContain('WIRE');
  });

  it('can export a single panel', async () => {
    const s = reducer(defaultState(), { type: 'addPanel' });
    const { pages } = await pdfText(s, [s.panels[1].id]);
    expect(pages).toBe(1);
  });

  it('fits a 42-space panel and tandems on one page', async () => {
    let s = defaultState();
    const p = s.panels[0];
    s = reducer(s, { type: 'updatePanel', id: p.id, patch: { spaces: 42, maxCircuits: 84 } });
    for (let i = 0; i < 60; i++) s = reducer(s, { type: 'addLoad', panelId: p.id });
    s = { ...s, loads: s.loads.map((l, i) => (l.amps ? l : { ...l, name: `Circuit ${i}`, amps: 10 })) };
    const { pages } = await pdfText(s);
    expect(pages).toBe(1);
  });
});

describe('PDF circuit plan', () => {
  it('lists every circuit with breaker, wire and ground sizes', async () => {
    const s = reducer(defaultState(), { type: 'addPanel' });
    const d = derive(s);
    const doc = await buildPlanPdf(s, d);
    const text = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    if (process.env.PLAN_OUT) writeFileSync(process.env.PLAN_OUT, Buffer.from(doc.output('arraybuffer')));
    for (const h of ['Circuit Plan', 'BREAKER', 'WIRE \\(CU THHN\\)', 'GROUND', 'Panel A', 'Panel B']) {
      expect(text).toContain(h);
    }
    const rows = s.panels.flatMap((p) => planRows(s, d, p));
    expect(rows).toHaveLength(s.loads.length);
    for (const r of rows) {
      if (r.load) {
        expect(r.brkr).toMatch(/^\d+ A$/);
        expect(r.wire).toMatch(/^#|kcmil/);
        expect(r.egc).toMatch(/^#/);
      }
    }
    expect(rows.find((r) => r.desc === 'Panel B (subpanel feeder)')).toBeTruthy();
  });

  it('orders rows by slot and runs onto more pages when needed', async () => {
    let s = defaultState();
    const p = s.panels[0];
    s = reducer(s, { type: 'updatePanel', id: p.id, patch: { spaces: 42, maxCircuits: 84 } });
    for (let i = 0; i < 60; i++) s = reducer(s, { type: 'addLoad', panelId: p.id });
    s = { ...s, loads: s.loads.map((l, i) => (l.amps ? l : { ...l, name: `Circuit ${i}`, amps: 10 })) };
    const d = derive(s);
    const rows = planRows(s, d, p);
    const firsts = rows.filter((r) => r.ckt !== 'none').map((r) => parseInt(r.ckt, 10));
    expect(firsts).toEqual([...firsts].sort((a, b) => a - b));
    const doc = await buildPlanPdf(s, d);
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});
