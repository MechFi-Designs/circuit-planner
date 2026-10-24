import type { jsPDF } from 'jspdf';
import type { AppState, Load, Panel } from '../types';
import type { Derived } from './derive';
import { maxPhase } from './loadCalc';
import { formatWire, MODE_LABEL, MODE_PHASES, phaseOfSlot } from './nec';
import { fmtA, fmtKw } from './sizing';

// US Letter in points.
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;
const CONTENT_W = PAGE_W - 2 * MARGIN;

// Directory columns, mirrored around the phase column so circuit numbers sit
// next to the bus like the breakers themselves.
const COL = { ckt: 24, brkr: 48, wire: 44, ph: 22 };
const DESC_W = (CONTENT_W - COL.ph - 2 * (COL.ckt + COL.brkr + COL.wire)) / 2;

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
  wire: number;
  brkr: number;
  ckt: number;
}

const LEFT: Side = {
  desc: MARGIN,
  wire: MARGIN + DESC_W,
  brkr: MARGIN + DESC_W + COL.wire,
  ckt: MARGIN + DESC_W + COL.wire + COL.brkr,
};
const PH_X = LEFT.ckt + COL.ckt;
const RIGHT: Side = {
  ckt: PH_X + COL.ph,
  brkr: PH_X + COL.ph + COL.ckt,
  wire: PH_X + COL.ph + COL.ckt + COL.brkr,
  desc: PH_X + COL.ph + COL.ckt + COL.brkr + COL.wire,
};
const SIDE_X0 = (side: Side) => Math.min(side.desc, side.ckt);
const SIDE_W = DESC_W + COL.wire + COL.brkr + COL.ckt;

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
    fitText(doc, 'WIRE (CU)', side.wire, tableTop, COL.wire, TABLE_HEAD_H, { size: 6.5, bold: true });
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
  const wireText = (l: Load) => {
    const s = d.sizing.get(l.id)!;
    return s.cu ? formatWire(s.cu).replace(' kcmil', 'k') : '';
  };

  doc.setLineWidth(0.5);
  for (let r = 0; r < rows; r++) {
    const y = rowY(r);
    // Phase column.
    doc.setDrawColor(GRID).rect(PH_X, y, COL.ph, rowH);
    fitText(doc, phaseOfSlot(2 * r + 1, mode), PH_X, y, COL.ph, rowH, { size: font, bold: true });

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
      doc.rect(side.wire, y, COL.wire, h);
      doc.rect(side.brkr, y, COL.brkr, h);
      if (!occ.length) continue;

      if (!tandem) {
        const l = loads.get(occ[0])!;
        const isFeeder = d.feederOf.has(l.id);
        fitText(doc, describe(l), side.desc, y, DESC_W, h, { size: font + 0.5, bold: isFeeder, align: 'left' });
        fitText(doc, breakerText(l, span), side.brkr, y, COL.brkr, h, { size: font, bold: true });
        fitText(doc, wireText(l), side.wire, y, COL.wire, h, { size: font });
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
        // Breaker and wire columns sit in mirrored order on each side.
        const x0 = Math.min(side.wire, side.brkr);
        doc.line(x0, y + rowH / 2, x0 + COL.wire + COL.brkr, y + rowH / 2);
        occ.forEach((id) => {
          const l = loads.get(id)!;
          const hh = rowH / 2;
          const hy = layout.placements.get(id)!.half === 'B' ? y + hh : y;
          fitText(doc, describe(l), side.desc, hy, DESC_W, hh, { size: font - 0.5, align: 'left' });
          fitText(doc, breakerText(l, 1), side.brkr, hy, COL.brkr, hh, { size: font - 0.5, bold: true });
          fitText(doc, wireText(l), side.wire, hy, COL.wire, hh, { size: font - 0.5 });
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
  const perPhase = (amps: Record<string, number>) => phases.map((p) => `${p} ${fmtA(amps[p])} A`).join('   ');
  let fy = tableBottom + 18;
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(9);
  const sizing = maxPhase(totals.design, mode);
  const rowsOut: [string, string][] = [
    ['Max load', `${perPhase(totals.max)}${pct(maxPhase(totals.max, mode))}  ·  ${fmtKw(kw.max)} kW`],
    ['Estimated load', `${perPhase(totals.est)}${pct(maxPhase(totals.est, mode))}  ·  ${fmtKw(kw.est)} kW`],
  ];
  if (sizing > maxPhase(totals.max, mode) + 0.05) {
    rowsOut.push(['Sizing load', `${fmtA(sizing)} A${pct(sizing)}  ·  continuous loads at 125%`]);
  }
  rowsOut.forEach(([label, text], i) => {
    doc.setFont('helvetica', 'bold').text(label, MARGIN, fy + i * 13);
    doc.setFont('helvetica', 'normal').text(latin1(text), MARGIN + 80, fy + i * 13);
  });

  fy += rowsOut.length * 13 + 4;
  doc.setFontSize(7).setTextColor(FAINT);
  const notes = doc.splitTextToSize(
    'Breakers and wire are sized for 125% of continuous load plus 100% of the rest (a sizing margin, not extra current). ' +
      'Wire is copper THHN sized to the breaker at the 75 °C terminal rating (NEC 110.14(C), 240.4(D)); derate for ' +
      'ambient temperature, conduit fill, and voltage drop as needed. Max load counts every circuit at its max current; ' +
      'downstream subpanels are included. ' +
      'Planning aid only: verify with your AHJ and a licensed electrician.',
    CONTENT_W,
  ) as string[];
  doc.text(notes, MARGIN, fy);
  doc.text('Made with Circuit Planner  ·  mechfi-designs.github.io/circuit-planner', MARGIN, PAGE_H - MARGIN + 10);
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
