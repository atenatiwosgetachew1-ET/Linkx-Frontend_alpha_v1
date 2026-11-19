// The Table window's print (Export ▸ Print table…; analyst decision
// 2026-11-18): a PDF in the NBE frame instead of the browser printing the
// page. Every page: a navy header (the NBE logo; LINK ANALYSIS · TABLE, the
// source and the details), the table (its column header on every page,
// alternate rows a touch of navy as in the window, numbers to the right,
// long values wrapped in their cells), a navy footer (the distribution
// marking, the page number) and the CONFIDENTIAL watermark the service's
// exports carry. Built with jsPDF + jspdf-autotable, as the graph report.

import { drawWatermark, installEthiopic, pdfText, ETHIOPIC_RE } from '../../graph/report/graphReportPdf.js';

export const TABLE_PDF_MARKING = 'CONFIDENTIAL · For authorised investigation use only';
// A column is never narrower than this (mm): enough for a name, an account
// number or a date on a line or two (analyst report 2026-11-18: many columns
// were squeezed to a word each). Columns that do not fit continue on the
// next pages, in sets, the identifying column (Label) repeated in each.
export const MIN_COLUMN_MM = 28;
const PAPER_MM = Object.freeze({ portrait: 210, landscape: 297 });
const MARGIN_MM = 10;
// How many columns a page set holds at most (the repeated one included).
export const columnsPerSet = (orientation) => Math.max(1, Math.floor((PAPER_MM[orientation] - MARGIN_MM * 2) / MIN_COLUMN_MM));
// About how many page sets the columns take (wider contents can take more):
// the first set holds columnsPerSet, each next one that less the repeated
// column. repeat: a column is repeated in every set.
export const columnSets = (columnCount, orientation, { repeat = true } = {}) => {
  const per = columnsPerSet(orientation);
  if (columnCount <= per) return 1;
  const next = Math.max(1, per - (repeat ? 1 : 0));
  return 1 + Math.ceil((columnCount - per) / next);
};
// Landscape past this many columns (Page: Auto): when portrait would need a
// second set of pages.
export const AUTO_LANDSCAPE_COLUMNS = columnsPerSet('portrait');
// Rows printed at most (a longer table is cut, and says so).
export const TABLE_PDF_MAX_ROWS = 5000;

const NAVY = [19, 29, 41];
const NAVY_SOFT = [31, 43, 58];
const HEAD_TITLE = [159, 181, 214];
const HEAD_TEXT = [215, 222, 232];
const GRID = [213, 222, 234];
const STRIPE = [243, 246, 250];
const TEXT = [31, 41, 51];
const FRAME = Object.freeze({ header: 24, footer: 11, margin: MARGIN_MM });

export const pageOrientation = (orientation, columnCount) => (orientation === 'auto'
  ? (columnCount > AUTO_LANDSCAPE_COLUMNS ? 'landscape' : 'portrait')
  : orientation === 'landscape' ? 'landscape' : 'portrait');

// rows: [{ values: { [key]: text } }]; columns: [{ key, label, numeric? }];
// title / source / details: the header's lines; orientation: 'auto' |
// 'portrait' | 'landscape'; logo: { dataUrl, ratio } (height / width) or
// null; fonts: Noto Sans Ethiopic ({ regular, bold }) or null.
// -> the jsPDF document.
export async function renderTablePdf({
  rows, columns, title = 'LINK ANALYSIS · TABLE', source = '', details = '', orientation = 'auto', logo = null, fonts = null,
}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const landscape = pageOrientation(orientation, columns.length) === 'landscape';
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true });
  const page = { width: doc.internal.pageSize.getWidth(), height: doc.internal.pageSize.getHeight() };
  const shown = rows.slice(0, TABLE_PDF_MAX_ROWS);
  const body = shown.map((row) => columns.map((column) => pdfText(row.values[column.key] ?? '')));
  const head = [columns.map((column) => pdfText(column.label))];
  installEthiopic(doc, ETHIOPIC_RE.test(JSON.stringify([head, body])) ? fonts : null);
  doc.setProperties({ title: pdfText(source || 'Table'), subject: 'LinkX table', creator: 'LinkX · NBE LinkX Table' });

  // Header and footer bands (page numbers once the pages are known).
  const drawFrame = () => {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, page.width, FRAME.header, 'F');
    if (logo?.dataUrl) {
      const height = FRAME.header - 8;
      doc.addImage(logo.dataUrl, 'PNG', FRAME.margin, 4, height / (logo.ratio || 0.39), height);
    } else {
      doc.setTextColor(212, 168, 90);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('NBE', FRAME.margin, FRAME.header / 2 + 2);
    }
    const right = page.width - FRAME.margin;
    doc.setTextColor(...HEAD_TITLE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(pdfText(title), right, 9, { align: 'right' });
    doc.setTextColor(...HEAD_TEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    if (source) doc.text(pdfText(source), right, 14, { align: 'right' });
    doc.setTextColor(...HEAD_TITLE);
    doc.setFontSize(7);
    if (details) doc.text(pdfText(details), right, 18.5, { align: 'right' });
    doc.setFillColor(...NAVY);
    doc.rect(0, page.height - FRAME.footer, page.width, FRAME.footer, 'F');
    doc.setTextColor(...HEAD_TEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(pdfText(TABLE_PDF_MARKING), FRAME.margin, page.height - FRAME.footer / 2 + 1.2);
  };

  // The widths, planned here (the table library sizes by content only): the
  // identifying column (Label, else the first) repeated in every page set;
  // fixed widths, so the library breaks the pages at the planned sets.
  const fontSize = landscape ? 7.5 : 7;
  const labelIndex = Math.max(0, columns.findIndex((column) => column.key === '@label'));
  const widths = planColumnWidths(doc, head[0], body, { fontSize, available: page.width - FRAME.margin * 2, repeat: labelIndex });
  const columnStyles = Object.fromEntries(columns.map((column, index) => [index, { cellWidth: widths[index], ...(column.numeric ? { halign: 'right' } : {}) }]));
  autoTable(doc, {
    head,
    body: body.length ? body : [[{ content: 'No rows', colSpan: Math.max(1, columns.length), styles: { halign: 'center', textColor: [120, 130, 140] } }]],
    startY: FRAME.header + 6,
    margin: { top: FRAME.header + 6, bottom: FRAME.footer + 6, left: FRAME.margin, right: FRAME.margin },
    showHead: 'everyPage',
    theme: 'grid',
    styles: { font: 'helvetica', fontSize, cellPadding: 1.4, textColor: TEXT, lineColor: GRID, lineWidth: 0.1, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: NAVY_SOFT, textColor: [255, 255, 255], fontStyle: 'bold', lineColor: NAVY_SOFT },
    alternateRowStyles: { fillColor: STRIPE },
    columnStyles,
    // Columns that do not fit: on the next pages, after all the rows of the
    // columns before (as a spreadsheet prints), Label repeated.
    horizontalPageBreak: true,
    horizontalPageBreakRepeat: labelIndex,
    horizontalPageBreakBehaviour: 'afterAllRows',
    didDrawPage: drawFrame,
  });

  // Page numbers and the watermark on every page.
  const pages = doc.getNumberOfPages();
  for (let number = 1; number <= pages; number += 1) {
    doc.setPage(number);
    doc.setTextColor(...HEAD_TITLE);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(`Page ${number} / ${pages}`, page.width - FRAME.margin, page.height - FRAME.footer / 2 + 1.2, { align: 'right' });
    drawWatermark(doc, { page });
  }
  return doc;
}

// A column at most this wide (mm): longer values wrap.
export const MAX_COLUMN_MM = 60;
const PADDING_MM = 1.4 * 2 + 0.6;

// Each column's width (mm): its header and its values (the 90th
// percentile of their lengths, so one long value does not widen it),
// between MIN_COLUMN_MM and MAX_COLUMN_MM; then the columns packed into page
// sets (the repeated column in each), and each set's other columns
// stretched to fill the page width. -> [width] by column.
export const planColumnWidths = (doc, labels, body, { fontSize = 7, available, repeat = 0 }) => {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  const headWidths = labels.map((label) => doc.getTextWidth(String(label)));
  doc.setFont('helvetica', 'normal');
  const sample = body.slice(0, 300);
  const natural = labels.map((_, index) => {
    const lengths = sample.map((row) => doc.getTextWidth(String(row[index] ?? ''))).sort((a, b) => a - b);
    const typical = lengths.length ? lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.9))] : 0;
    return Math.min(MAX_COLUMN_MM, Math.max(MIN_COLUMN_MM, Math.max(headWidths[index], typical) + PADDING_MM));
  });
  const widths = [...natural];
  const repeated = labels.length > 1 ? repeat : -1;
  // Greedy sets, as the table library breaks them: in order, the repeated
  // column first in every set after the first.
  const sets = [];
  let current = [];
  let used = 0;
  natural.forEach((width, index) => {
    if (current.length && used + width > available) {
      sets.push(current);
      current = [];
      used = repeated >= 0 ? natural[repeated] : 0;
    }
    current.push(index);
    used += width;
  });
  if (current.length) sets.push(current);
  // Stretch each set's own columns to the page (a hair under, so the
  // library's packing keeps the same sets).
  sets.forEach((set, number) => {
    const own = set.filter((index) => index !== repeated);
    const fixed = set.includes(repeated) || number > 0 ? (repeated >= 0 ? natural[repeated] : 0) : 0;
    const total = own.reduce((sum, index) => sum + natural[index], 0);
    if (!total) return;
    const factor = Math.max(1, ((available - fixed) * 0.995) / total);
    own.forEach((index) => { widths[index] = natural[index] * factor; });
  });
  return widths;
};

// "LinkxTable_<title>_<nodes|links>_<yyyymmdd-hhmm>.pdf"
export const tablePdfFileName = (title, tab, now = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const name = String(title || 'Table').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Table';
  return `LinkxTable_${name}_${tab}_${stamp}.pdf`;
};
