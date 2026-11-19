// The Table window's Export (analyst decision 2026-11-18): the rows as they
// are shown (filtered, sorted, the columns in sight, in their order) as CSV,
// or copied as tab-separated text (pastes into a spreadsheet). Printing is a
// PDF in the NBE frame (tablePdf.js).
//
// rows: [{ id, values: { [columnKey]: text } }]; columns: [{ key, label }].

// A cell a spreadsheet would read as a formula is kept as text (a leading
// apostrophe), so an exported value is never run.
const FORMULA_START = /^[=+\-@\t\r]/;
const safeCell = (value) => {
  const text = value == null ? '' : String(value);
  return FORMULA_START.test(text) ? `'${text}` : text;
};

const csvCell = (value) => {
  const text = safeCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const rowsToCsv = (rows, columns) => {
  const lines = [columns.map((column) => csvCell(column.label)).join(',')];
  rows.forEach((row) => lines.push(columns.map((column) => csvCell(row.values[column.key])).join(',')));
  // A BOM, so a spreadsheet reads it as UTF-8 (Amharic names included).
  return `\ufeff${lines.join('\r\n')}\r\n`;
};

const tsvCell = (value) => safeCell(value).replace(/[\t\r\n]+/g, ' ');

export const rowsToTsv = (rows, columns) => [
  columns.map((column) => tsvCell(column.label)).join('\t'),
  ...rows.map((row) => columns.map((column) => tsvCell(row.values[column.key])).join('\t')),
].join('\n');

// "LinkxTable_<title>_<nodes|links>_<yyyymmdd-hhmm>.csv"
export const tableFileName = (title, tab, extension = 'csv', now = new Date()) => {
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  const name = String(title || 'Table').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'Table';
  return `LinkxTable_${name}_${tab}_${stamp}.${extension}`;
};
