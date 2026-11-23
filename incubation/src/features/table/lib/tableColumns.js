// Column widths for a PDF table (the Table window's print and the graph
// report's table appendix; analyst decision 2026-11-18). No imports: both
// the table and the report PDFs use it.

// A column is never narrower than this (mm): enough for a name, an account
// number or a date on a line or two (analyst report 2026-11-18: many columns
// were squeezed to a word each). Columns that do not fit continue on the
// next pages, in sets, the identifying column (Label) repeated in each.
export const MIN_COLUMN_MM = 28;

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
