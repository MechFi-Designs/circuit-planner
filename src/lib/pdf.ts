import type { jsPDF } from 'jspdf';
import type { AppState, Load, Panel, Phase } from '../types';
import type { Derived } from './derive';
import { circuitAmps, maxPhase } from './loadCalc';
import { formatWire, KINDS, MODE_LABEL, MODE_PHASES, phaseOfSlot } from './nec';
import { fmtA, fmtKw } from './sizing';

// US Letter in points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// Directory columns, mirrored around the phase column so circuit numbers sit
// next to the bus like the breakers themselves. Wire sizes live in the full
// circuit plan, so the description gets the room.
const COL = { ckt: 24, brkr: 48, ph: 22 };
const DESC_W = (CONTENT_W - COL.ph - 2 * (COL.ckt + COL.brkr)) / 2;

const HEADER_H = 74;
const TABLE_HEAD_H = 16;
const FOOTER_H = 92;
const MAX_ROW_H = 44;

const INK = 20;
const GRID = 150;
const FAINT = 120;

/** The standard PDF fonts only cover Latin-1; swap anything else for '?'. */
const latin1 = (s: string) => s.replace(/[^\x20-\xff]/g, '?');

interface Side {
  /** x of each column's left edge, in reading order. */
  desc: number;
  brkr: number;
  ckt: number;
}

const LEFT: Side = {
  desc: MARGIN,
  brkr: MARGIN + DESC_W,
  ckt: MARGIN + DESC_W + COL.brkr,
};
const PH_X = LEFT.ckt + COL.ckt;
const RIGHT: Side = {
  ckt: PH_X + COL.ph,
  brkr: PH_X + COL.ph + COL.ckt,
  desc: PH_X + COL.ph + COL.ckt + COL.brkr,
};
const SIDE_X0 = (side: Side) => Math.min(side.desc, side.ckt);
const SIDE_W = DESC_W + COL.brkr + COL.ckt;

/** Draw text centered in a box, shrinking then wrapping (then truncating) to fit. */
function fitText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: { size: number; bold?: boolean; align?: 'left' | 'center'; color?: number },
) {
  const str = latin1(text);
  if (!str) return;
  const pad = 3;
  const maxW = w - 2 * pad;
  doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
  doc.setTextColor(opts.color ?? INK);
  let size = opts.size;
  let lines: string[] = [str];
  for (; size >= 5.5; size -= 0.5) {
    doc.setFontSize(size);
    const lineH = size * 1.15;
    const maxLines = Math.max(1, Math.floor((h - 2) / lineH));
    lines = doc.splitTextToSize(str, maxW) as string[];
    if (lines.length <= maxLines) break;
    if (size - 0.5 < 5.5) {
      lines = lines.slice(0, maxLines);
      let last = lines[maxLines - 1];
      while (last.length > 1 && doc.getTextWidth(`${last}...`) > maxW) last = last.slice(0, -1);
      lines[maxLines - 1] = `${last}...`;
    }
  }
  const lineH = size * 1.15;
  const top = y + (h - lines.length * lineH) / 2 + size * 0.85;
  lines.forEach((line, i) => {
    const ly = top + i * lineH;
    if (opts.align === 'left') doc.text(line, x + pad, ly);
    else doc.text(line, x + w / 2, ly, { align: 'center' });
  });
}

/** Phase colors, matching the app's light theme (A black, B red, C blue). */
const PHASE_RGB: Record<Phase, [number, number, number]> = {
  A: [31, 35, 40],
  B: [217, 58, 58],
  C: [47, 111, 223],
};

/** A rounded, colored phase chip like the app's, centered on (cx, cy). */
function phaseChip(doc: jsPDF, phase: Phase, cx: number, cy: number, h: number) {
  const w = h + 2;
  doc.setFillColor(...PHASE_RGB[phase]);
  doc.roundedRect(cx - w / 2, cy - h / 2, w, h, h * 0.25, h * 0.25, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(h * 0.68).setTextColor(255);
  doc.text(phase, cx, cy + h * 0.24, { align: 'center' });
}

/** Chips for several phases (e.g. a 3-pole breaker's ABC), centered in a box. */
function phaseChips(doc: jsPDF, phases: Phase[], x: number, y: number, w: number, h: number, size: number) {
  const chipW = size + 2;
  const gap = 2;
  const total = phases.length * chipW + (phases.length - 1) * gap;
  let cx = x + (w - total) / 2 + chipW / 2;
  for (const p of phases) {
    phaseChip(doc, p, cx, y + h / 2, size);
    cx += chipW + gap;
  }
}

/** Write "[A] 12 A  [B] 10 A ..." with colored chips at baseline y, then `rest`. */
function phaseLoads(
  doc: jsPDF,
  phases: Phase[],
  amps: Record<string, number>,
  rest: string,
  x: number,
  y: number,
  size: number,
) {
  const h = size + 1.5;
  let cx = x;
  for (const p of phases) {
    phaseChip(doc, p, cx + (h + 2) / 2, y - size * 0.34, h);
    cx += h + 2 + 3;
    const t = `${fmtA(amps[p])} A`;
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(INK);
    doc.text(t, cx, y);
    cx += doc.getTextWidth(t) + 8;
  }
  if (rest) doc.text(latin1(rest), cx - 6, y);
}

function drawPanelPage(doc: jsPDF, state: AppState, d: Derived, panel: Panel) {
  const { mode } = state;
  const layout = d.layouts.get(panel.id)!;
  const loads = new Map(state.loads.filter((l) => l.panelId === panel.id).map((l) => [l.id, l]));
  const parent = state.panels.find((p) => p.id === panel.fedFrom);

  // ---------- header ----------
  doc.setTextColor(INK);
  doc.setFont('helvetica', 'bold').setFontSize(22);
  doc.text(latin1(panel.name || 'Panel'), MARGIN, MARGIN + 18);
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(FAINT);
  doc.text('CIRCUIT DIRECTORY', PAGE_W - MARGIN, MARGIN + 8, { align: 'right' });
  doc.setFont('helvetica', 'normal').setFontSize(9);
  doc.text(`Updated ${new Date().toISOString().slice(0, 10)}`, PAGE_W - MARGIN, MARGIN + 20, { align: 'right' });

  let feedLine = state.serviceA ? `Fed from: Service (${state.serviceA} A)` : 'Fed from: Service';
  if (parent) {
    const feeder = state.loads.find((l) => l.feeds === panel.id);
    const fp = feeder ? d.layouts.get(parent.id)?.placements.get(feeder.id) : undefined;
    feedLine = `Fed from: ${parent.name}, ${panel.mainA} A breaker${fp ? ` in space${fp.slots.length > 1 ? 's' : ''} ${fp.slots.join(', ')}` : ''}`;
  }
  const rating = parent ? `${panel.mainA} A feeder` : `${panel.mainA} A main`;
  doc.setTextColor(INK).setFontSize(10.5);
  doc.text(latin1(`${rating}  ·  ${MODE_LABEL[mode]}  ·  ${panel.spaces} spaces`), MARGIN, MARGIN + 38);
  doc.text(latin1(feedLine), MARGIN, MARGIN + 53);

  // ---------- table ----------
  const rows = Math.ceil(panel.spaces / 2);
  const tableTop = MARGIN + HEADER_H;
  const bodyTop = tableTop + TABLE_HEAD_H;
  const rowH = Math.min(MAX_ROW_H, (PAGE_H - MARGIN - FOOTER_H - bodyTop) / rows);
  const font = Math.max(6, Math.min(9.5, rowH * 0.42));
  const rowY = (r: number) => bodyTop + r * rowH;

  // Column headings.
  doc.setFillColor(235, 235, 235).rect(MARGIN, tableTop, CONTENT_W, TABLE_HEAD_H, 'F');
  const head = (side: Side) => {
    fitText(doc, 'DESCRIPTION', side.desc, tableTop, DESC_W, TABLE_HEAD_H, { size: 7, bold: true });
    fitText(doc, 'BRKR', side.brkr, tableTop, COL.brkr, TABLE_HEAD_H, { size: 7, bold: true });
    fitText(doc, 'CKT', side.ckt, tableTop, COL.ckt, TABLE_HEAD_H, { size: 7, bold: true });
  };
  head(LEFT);
  head(RIGHT);
  fitText(doc, 'PH', PH_X, tableTop, COL.ph, TABLE_HEAD_H, { size: 7, bold: true });

  const describe = (l: Load) => {
    const sub = d.feederOf.get(l.id);
    return sub ? `${sub.name} (subpanel feeder)` : l.name || 'Unnamed';
  };
  const breakerText = (l: Load, poles: number) => {
    const s = d.sizing.get(l.id)!;
    return s.breaker ? `${s.breaker}A${poles > 1 ? ` ${poles}P` : ''}` : '';
  };

  doc.setLineWidth(0.5);
  for (let r = 0; r < rows; r++) {
    const y = rowY(r);
    // Phase column.
    doc.setDrawColor(GRID).rect(PH_X, y, COL.ph, rowH);
    phaseChip(doc, phaseOfSlot(2 * r + 1, mode), PH_X + COL.ph / 2, y + rowH / 2, Math.min(14, rowH - 4));

    for (const [side, space] of [
      [LEFT, 2 * r + 1],
      [RIGHT, 2 * r + 2],
    ] as const) {
      if (space > panel.spaces) continue;
      const occ = layout.spaceMap.get(space) ?? [];
      const first = occ.length ? layout.placements.get(occ[0]) : undefined;
      const multi = first && first.slots.length > 1;
      if (multi && first.slot !== space) continue; // drawn with its first pole

      const span = multi ? first.slots.length : 1;
      // Tandem spaces always show both halves, leaving a spare one blank.
      const tandem = !multi && !!first?.tandem;
      const h = rowH * span;
      doc.setDrawColor(GRID);
      // Circuit numbers: one cell per pole so every space is labeled.
      if (tandem) {
        // Tandem: number each half (e.g. 11A / 11B) next to its description.
        for (const [i, tag] of ['A', 'B'].entries()) {
          doc.rect(side.ckt, y + (i * rowH) / 2, COL.ckt, rowH / 2);
          fitText(doc, `${space}${tag}`, side.ckt, y + (i * rowH) / 2, COL.ckt, rowH / 2, {
            size: font - 0.5,
            bold: true,
          });
        }
      } else {
        for (let i = 0; i < span; i++) {
          doc.rect(side.ckt, y + i * rowH, COL.ckt, rowH);
          fitText(doc, `${space + 2 * i}`, side.ckt, y + i * rowH, COL.ckt, rowH, { size: font, bold: true });
        }
      }
      doc.rect(side.desc, y, DESC_W, h);
      doc.rect(side.brkr, y, COL.brkr, h);
      if (!occ.length) continue;

      if (!tandem) {
        const l = loads.get(occ[0])!;
        const isFeeder = d.feederOf.has(l.id);
        fitText(doc, describe(l), side.desc, y, DESC_W, h, { size: font + 0.5, bold: isFeeder, align: 'left' });
        fitText(doc, breakerText(l, span), side.brkr, y, COL.brkr, h, { size: font, bold: true });
        if (multi) {
          // Handle tie between poles.
          doc.setDrawColor(INK).setLineWidth(1.2);
          const tx = side === LEFT ? side.ckt + COL.ckt - 3 : side.ckt + 3;
          doc.line(tx, y + rowH / 2, tx, y + h - rowH / 2);
          doc.setLineWidth(0.5);
        }
      } else {
        // Tandem: two half-height circuits in one space.
        doc.setDrawColor(200);
        doc.line(side.desc, y + rowH / 2, side.desc + DESC_W, y + rowH / 2);
        doc.line(side.brkr, y + rowH / 2, side.brkr + COL.brkr, y + rowH / 2);
        occ.forEach((id) => {
          const l = loads.get(id)!;
          const hh = rowH / 2;
          const hy = layout.placements.get(id)!.half === 'B' ? y + hh : y;
          fitText(doc, describe(l), side.desc, hy, DESC_W, hh, { size: font - 0.5, align: 'left' });
          fitText(doc, breakerText(l, 1), side.brkr, hy, COL.brkr, hh, { size: font - 0.5, bold: true });
        });
      }
    }
  }
  // Heavier outline around each half and the bus.
  const tableBottom = rowY(rows);
  doc.setDrawColor(INK).setLineWidth(1);
  doc.rect(SIDE_X0(LEFT), tableTop, SIDE_W, tableBottom - tableTop);
  doc.rect(SIDE_X0(RIGHT), tableTop, SIDE_W, tableBottom - tableTop);
  doc.rect(PH_X, tableTop, COL.ph, tableBottom - tableTop);
  doc.setLineWidth(0.5);

  // ---------- footer ----------
  const totals = d.totals.get(panel.id)!;
  const kw = d.kw.get(panel.id)!;
  const phases = MODE_PHASES[mode];
  const pct = (a: number) => (panel.mainA ? ` (${Math.round((a / panel.mainA) * 100)}% of ${rating})` : '');
  let fy = tableBottom + 18;
  const sizing = maxPhase(totals.design, mode);
  const rowsOut: [string, Record<string, number> | null, string][] = [
    ['Max load', totals.max, `${pct(maxPhase(totals.max, mode))}  ·  ${fmtKw(kw.max)} kW`],
    ['Estimated load', totals.est, `${pct(maxPhase(totals.est, mode))}  ·  ${fmtKw(kw.est)} kW`],
  ];
  if (sizing > maxPhase(totals.max, mode) + 0.05) {
    rowsOut.push(['Sizing load', null, `${fmtA(sizing)} A${pct(sizing)}  ·  continuous loads at 125%`]);
  }
  rowsOut.forEach(([label, amps, text], i) => {
    const ly = fy + i * 14;
    doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(9).text(label, MARGIN, ly);
    if (amps) phaseLoads(doc, phases, amps, text, MARGIN + 80, ly, 9);
    else doc.setFont('helvetica', 'normal').text(latin1(text), MARGIN + 80, ly);
  });

  fy += rowsOut.length * 14 + 4;
  doc.setFontSize(7).setTextColor(FAINT);
  const notes = doc.splitTextToSize(
    'Breakers are sized for 125% of continuous load plus 100% of the rest (a sizing margin, not extra current). ' +
      'Wire and ground sizes are in the full circuit plan. Max load counts every circuit at its max current; ' +
      'downstream subpanels are included. ' +
      'Planning aid only: verify with your AHJ and a licensed electrician.',
    CONTENT_W,
  ) as string[];
  doc.text(notes, MARGIN, fy);
  doc.text('Made with Circuit Planner  ·  mechfi-designs.github.io/circuit-planner', MARGIN, PAGE_H - MARGIN + 10);
}

// ---------- full circuit plan ----------

interface PlanCol {
  key: 'ckt' | 'desc' | 'circuit' | 'ph' | 'load' | 'sizing' | 'brkr' | 'wire' | 'egc';
  head: string;
  w: number;
  align?: 'left' | 'center';
}

const PLAN_FIXED: PlanCol[] = [
  { key: 'ckt', head: 'CKT', w: 40 },
  { key: 'desc', head: 'DESCRIPTION', w: 0, align: 'left' },
  { key: 'circuit', head: 'CIRCUIT', w: 50 },
  { key: 'ph', head: 'PHASE', w: 38 },
  { key: 'load', head: 'LOAD A', w: 40 },
  { key: 'sizing', head: 'SIZING A', w: 44 },
  { key: 'brkr', head: 'BREAKER', w: 50 },
  { key: 'wire', head: 'WIRE (CU THHN)', w: 64 },
  { key: 'egc', head: 'GROUND (CU)', w: 50 },
];
PLAN_FIXED[1].w = CONTENT_W - PLAN_FIXED.reduce((a, c) => a + c.w, 0);
const PLAN_COLS = PLAN_FIXED.map((c, i) => ({
  ...c,
  x: MARGIN + PLAN_FIXED.slice(0, i).reduce((a, cc) => a + cc.w, 0),
}));
const PLAN_FONT = 8;
const PLAN_LINE = PLAN_FONT * 1.2;
const PLAN_HEAD_H = 18;
const PLAN_BOTTOM = PAGE_H - MARGIN - 14;

export type PlanRow = Record<PlanCol['key'], string> & { bold: boolean; unplaced: boolean };

/** One row per circuit in a panel, in slot order, with breaker, wire and ground sizes. */
export function planRows(state: AppState, d: Derived, panel: Panel): PlanRow[] {
  const layout = d.layouts.get(panel.id)!;
  const loads = state.loads.filter((l) => l.panelId === panel.id);
  const order = (l: Load) => {
    const p = layout.placements.get(l.id);
    return p ? p.slot * 2 + (p.half === 'B' ? 1 : 0) : Infinity;
  };
  return [...loads]
    .sort((a, b) => order(a) - order(b))
    .map((l) => {
      const s = d.sizing.get(l.id)!;
      const p = layout.placements.get(l.id);
      const sub = d.feederOf.get(l.id);
      const kind = KINDS[l.kind];
      const load = sub ? maxPhase(d.totals.get(sub.id)!.max, state.mode) : circuitAmps(l).max;
      const extra =
        l.equip === 'motor' && l.hp
          ? ` (${l.hp} hp motor)`
          : l.equip === 'hvac' && l.mca
            ? ` (HVAC, ${l.mca} A MCA)`
            : '';
      return {
        ckt: p ? (p.tandem ? `${p.slot}${p.half}` : p.slots.join(',')) : 'none',
        desc: sub ? `${sub.name} (subpanel feeder)` : `${l.name || 'Unnamed'}${extra}`,
        circuit: `${kind.volts} V ${kind.poles}P`,
        ph: p ? p.phases.join('') : '',
        load: load > 0 ? fmtA(load) : '',
        sizing: s.required > 0 ? fmtA(s.required) : '',
        brkr: s.breaker ? `${s.breaker} A` : '',
        wire: s.cu ? formatWire(s.cu) : '',
        egc: s.egc ?? '',
        bold: !!sub,
        unplaced: !p,
      };
    });
}

function drawPlanHead(doc: jsPDF, y: number) {
  doc.setFillColor(235, 235, 235).rect(MARGIN, y, CONTENT_W, PLAN_HEAD_H, 'F');
  for (const c of PLAN_COLS) fitText(doc, c.head, c.x, y, c.w, PLAN_HEAD_H, { size: 6.5, bold: true, align: c.align });
  return y + PLAN_HEAD_H;
}

function drawPlan(doc: jsPDF, state: AppState, d: Derived) {
  const { mode } = state;
  const phases = MODE_PHASES[mode];
  const nPanels = state.panels.length;

  // ---------- title ----------
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(22);
  doc.text('Circuit Plan', MARGIN, MARGIN + 18);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(FAINT);
  doc.text(`Updated ${new Date().toISOString().slice(0, 10)}`, PAGE_W - MARGIN, MARGIN + 8, { align: 'right' });
  doc.setTextColor(INK).setFontSize(10.5);
  const svcMax = maxPhase(d.service.max, mode);
  const svcPct = state.serviceA ? ` (${Math.round((svcMax / state.serviceA) * 100)}% of service)` : '';
  const svc = state.serviceA ? `${state.serviceA} A service` : 'Service';
  doc.text(latin1(`${MODE_LABEL[mode]}  ·  ${svc}  ·  ${nPanels} panel${nPanels > 1 ? 's' : ''}`), MARGIN, MARGIN + 38);
  const svcLabel = 'Service max load:';
  doc.text(svcLabel, MARGIN, MARGIN + 53);
  const svcX = MARGIN + doc.getTextWidth(svcLabel) + 6;
  phaseLoads(doc, phases, d.service.max, `${svcPct}  ·  ${fmtKw(d.serviceKw.max)} kW`, svcX, MARGIN + 53, 10.5);
  let y = MARGIN + 66;

  const newPage = () => {
    doc.addPage('letter', 'portrait');
    return MARGIN;
  };

  for (const panel of state.panels) {
    const rows = planRows(state, d, panel);
    const parent = state.panels.find((p) => p.id === panel.fedFrom);
    const totals = d.totals.get(panel.id)!;
    const pmax = maxPhase(totals.max, mode);
    const pct = panel.mainA ? ` (${Math.round((pmax / panel.mainA) * 100)}% of rating)` : '';
    const fed = parent ? `${panel.mainA} A feeder from ${parent.name}` : `${panel.mainA} A main, fed from service`;
    const line1 = `${fed}  ·  ${panel.spaces} spaces  ·  ${rows.length} circuit${rows.length === 1 ? '' : 's'}`;
    const line2 = `${pct}  ·  ${fmtKw(d.kw.get(panel.id)!.max)} kW`;

    // Keep the panel heading with its column heads and at least two rows.
    if (y + 48 + PLAN_HEAD_H + 32 > PLAN_BOTTOM) y = newPage();
    y += 8;
    doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(13);
    doc.text(latin1(panel.name || 'Panel'), MARGIN, y + 10);
    doc.setFont('helvetica', 'normal').setFontSize(8.5);
    doc.text(latin1(line1), MARGIN, y + 23);
    doc.text('Max load', MARGIN, y + 35);
    phaseLoads(doc, phases, totals.max, line2, MARGIN + doc.getTextWidth('Max load') + 5, y + 35, 8.5);
    doc.setTextColor(INK);
    y = drawPlanHead(doc, y + 40);

    if (!rows.length) {
      fitText(doc, 'No circuits', MARGIN, y, CONTENT_W, 16, { size: PLAN_FONT, color: FAINT, align: 'left' });
      y += 16;
    }
    rows.forEach((r, i) => {
      doc.setFont('helvetica', r.bold ? 'bold' : 'normal').setFontSize(PLAN_FONT);
      const lines = Math.min(4, (doc.splitTextToSize(latin1(r.desc), PLAN_COLS[1].w - 6) as string[]).length);
      const h = Math.max(16, lines * PLAN_LINE + 5);
      if (y + h > PLAN_BOTTOM) y = drawPlanHead(doc, newPage());
      if (i % 2) doc.setFillColor(246, 246, 246).rect(MARGIN, y, CONTENT_W, h, 'F');
      doc.setDrawColor(GRID).setLineWidth(0.4).line(MARGIN, y + h, MARGIN + CONTENT_W, y + h);
      for (const c of PLAN_COLS) {
        if (c.key === 'ph') {
          phaseChips(doc, r.ph.split('') as Phase[], c.x, y, c.w, h, 10);
          continue;
        }
        fitText(doc, r[c.key], c.x, y, c.w, h, {
          size: PLAN_FONT,
          bold: c.key === 'brkr' || c.key === 'ckt' || r.bold,
          align: c.align,
          color: r.unplaced && c.key === 'ckt' ? 170 : INK,
        });
      }
      y += h;
    });
    y += 12;
  }

  // ---------- notes ----------
  doc.setFont('helvetica', 'normal').setFontSize(7);
  const notes = doc.splitTextToSize(
    "Load A is max current (for a subpanel feeder, the subpanel's max phase load). Sizing A is 125% of continuous load " +
      'plus 100% of the rest (motors: 125% of full-load current; HVAC: nameplate MCA); it is a sizing margin, not extra ' +
      'current. Breakers are the smallest NEC 240.6(A) standard size that fits unless overridden. Wire is copper THHN at ' +
      'the 75 °C terminal rating (NEC 110.14(C), 240.4(B), 240.4(D)); ground is copper per Table 250.122. Does not ' +
      'include ambient or conduit-fill derating, voltage drop, or demand factors. CKT "none" means the circuit does not ' +
      'fit in its panel. Planning aid only: verify with your AHJ and a licensed electrician.',
    CONTENT_W,
  ) as string[];
  if (y + notes.length * 9 > PLAN_BOTTOM) y = newPage();
  doc.setTextColor(FAINT).text(notes, MARGIN, y + 4);

  // ---------- page footers ----------
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(FAINT);
    doc.text('Made with Circuit Planner  ·  mechfi-designs.github.io/circuit-planner', MARGIN, PAGE_H - MARGIN + 10);
    doc.text(`Page ${i} of ${n}`, PAGE_W - MARGIN, PAGE_H - MARGIN + 10, { align: 'right' });
  }
}

/** Build the full circuit plan: every circuit with its breaker, wire and ground sizes. */
export async function buildPlanPdf(state: AppState, derived: Derived): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  drawPlan(doc, state, derived);
  doc.setProperties({ title: 'Circuit plan', creator: 'Circuit Planner' });
  return doc;
}

export async function exportPlanPdf(state: AppState, derived: Derived): Promise<void> {
  const doc = await buildPlanPdf(state, derived);
  doc.save(`circuit-plan-${new Date().toISOString().slice(0, 10)}.pdf`);
}

/** Build a letter-size PDF with one circuit directory page per panel. */
export async function buildPdf(state: AppState, derived: Derived, panelIds?: string[]): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });
  const panels = state.panels.filter((p) => !panelIds || panelIds.includes(p.id));
  panels.forEach((p, i) => {
    if (i) doc.addPage('letter', 'portrait');
    drawPanelPage(doc, state, derived, p);
  });
  doc.setProperties({
    title: `Circuit directory - ${panels.map((p) => p.name).join(', ')}`,
    creator: 'Circuit Planner',
  });
  return doc;
}

export async function exportPdf(state: AppState, derived: Derived, panelIds?: string[]): Promise<void> {
  const doc = await buildPdf(state, derived, panelIds);
  const panels = state.panels.filter((p) => !panelIds || panelIds.includes(p.id));
  const name = (panels.length === 1 ? panels[0].name : 'panels').trim().replace(/[^\w-]+/g, '-') || 'panel';
  doc.save(`circuit-map-${name}-${new Date().toISOString().slice(0, 10)}.pdf`);
}
