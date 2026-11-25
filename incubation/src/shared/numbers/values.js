// How values from the data are read as numbers, compared and ordered: one set
// of rules for the Graph, Table and Chart windows and the reports
// (docs/integrity-audit-2026-11-24.md E1, E2, E3).
//
// A number is read only when the whole text is one, written plainly:
// "2500", "-2,500.75", "2 500", "(500)" (negative). Anything that could be
// read two ways or is more than a number ("1.234,56", "2500,00", "ETB 500",
// "0x10", "1e3") is not a number, so it is left out and counted as left out,
// never guessed.

const PLAIN = /^([-+]?)(\d+|\d{1,3}(?:,\d{3})+|\d{1,3}(?:[ \u00A0\u202F]\d{3})+)(\.\d+)?$/;

// -> a finite number, or null.
export const parseAmount = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const bracketed = /^\((.+)\)$/.exec(text);
  const match = PLAIN.exec(bracketed ? bracketed[1].trim() : text);
  if (!match || (bracketed && match[1])) return null;
  const number = Number(`${match[1]}${match[2].replace(/[^\d]/g, '')}${match[3] || ''}`);
  if (!Number.isFinite(number)) return null;
  return bracketed ? -number : number;
};

// Text that names something rather than counting it: a leading zero
// ("0012345"), or more digits than a number keeps exactly.
export const looksLikeId = (value) => {
  const text = String(value ?? '').trim();
  return /^[-+]?0\d/.test(text) || /^[-+]?\d{16,}$/.test(text) || (typeof value === 'number' && !Number.isSafeInteger(value) && Number.isInteger(value));
};

// Whether two values are the same: as text, or as numbers when both are
// written as numbers and neither is an id ("2,500" is 2500; "0012" is not 12).
export const sameValue = (a, b) => {
  const textA = String(a ?? '').trim().toLowerCase();
  const textB = String(b ?? '').trim().toLowerCase();
  if (textA === textB) return true;
  if (looksLikeId(a) || looksLikeId(b)) return false;
  const numberA = parseAmount(a);
  return numberA !== null && numberA === parseAmount(b);
};

/* ── Ordering ────────────────────────────────────────────────────────── */

const ISO = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const DAY_FIRST = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const dateAt = (text) => {
  if (ISO.test(text)) {
    const at = Date.parse(text.length > 10 ? text.replace(' ', 'T') : `${text}T00:00:00`);
    return Number.isFinite(at) ? at : null;
  }
  const match = DAY_FIRST.exec(text);
  if (!match) return null;
  const [day, month, year, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
  const at = new Date(year, month - 1, day, hour, minute, second);
  return at.getMonth() === month - 1 && at.getDate() === day ? at.getTime() : null;
};
// An amount with its unit, before or after ("ETB 2,500.00", "900 ETB", "$5").
const UNIT = /^([A-Za-z]{1,4}|[$€£¥])?\s*([-+(]?[\d, \u00A0\u202F]*\d(?:\.\d+)?\)?)\s*([A-Za-z]{1,4}|[$€£¥%])?$/;

// -> [rank, value, unit]: numbers, then amounts with a unit, then dates, then text.
const orderOf = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return [0, value, ''];
  const text = (value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)).trim();
  if (!looksLikeId(text)) {
    const number = parseAmount(text);
    if (number !== null) return [0, number, ''];
    const unit = UNIT.exec(text);
    if (unit && (unit[1] || unit[3])) {
      const amount = parseAmount(unit[2].trim());
      if (amount !== null) return [1, amount, `${unit[1] || ''}${unit[3] || ''}`.toUpperCase()];
    }
  }
  const at = dateAt(text);
  if (at !== null) return [2, at, ''];
  return [3, text, ''];
};
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const isBlank = (value) => value == null || value === '';
const compareOrders = (a, b, sort) => {
  if (a === null || b === null) return Number(a === null) - Number(b === null);
  const sign = sort === 'desc' ? -1 : 1;
  const [rankA, valueA, unitA] = a;
  const [rankB, valueB, unitB] = b;
  if (rankA !== rankB) return sign * (rankA - rankB);
  if (rankA === 3) return sign * (collator.compare(valueA, valueB) || (valueA < valueB ? -1 : Number(valueA > valueB)));
  if (unitA !== unitB) return sign * (unitA < unitB ? -1 : 1);
  return sign * (valueA - valueB);
};

// Orders values of one column, blanks last in both directions.
export const compareValues = (a, b, sort = 'asc') => compareOrders(isBlank(a) ? null : orderOf(a), isBlank(b) ? null : orderOf(b), sort);

// The items in order of their value (each value is read once), equals as found.
export const sortByValue = (items, valueOf, sort = 'asc') => items
  .map((item, index) => {
    const value = valueOf(item);
    return { item, index, order: isBlank(value) ? null : orderOf(value) };
  })
  .sort((a, b) => compareOrders(a.order, b.order, sort) || a.index - b.index)
  .map((entry) => entry.item);

/* ── Showing ─────────────────────────────────────────────────────────── */

// A figure as text: every whole digit, two decimals from 1,000 up, four
// below, and four significant digits under 1. "—" when there is none.
export const formatFigure = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const size = Math.abs(value);
  if (size !== 0 && size < 1) return Number(value.toPrecision(4)).toLocaleString('en-GB', { maximumFractionDigits: 8 });
  return value.toLocaleString('en-GB', { maximumFractionDigits: size >= 1000 ? 2 : 4 });
};

/* ── JSON ────────────────────────────────────────────────────────────── */

// Whole numbers JavaScript cannot hold exactly (long account numbers, ids) are
// kept as text: JSON.parse would round them, and merge different accounts.
const LONG_DIGITS = /\d{16}/;
export const parseJsonExact = (text) => {
  if (!LONG_DIGITS.test(text)) return JSON.parse(text);
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|(?<![\d.eE+-])-?\d{16,}(?![\d.eE])/g, (match) => (
    match[0] === '"' || Number.isSafeInteger(Number(match)) ? match : `"${match}"`
  )));
};
