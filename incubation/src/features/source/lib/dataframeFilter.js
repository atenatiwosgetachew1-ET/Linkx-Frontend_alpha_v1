// Filtering a Source window's dataframe before ingestion and analysis
// (analyst decision 2026-11-19): columns stripped, rows kept or removed by
// conditions, and simple clean-up. The browser only knows the dataframe's
// column names (create_DF answers no values), so the filter is a
// specification the Service applies before it ingests the data (B-27); a
// preview of its effect is asked of the Service when it offers one (B-28).
// Pure: tests run these directly.

// list: the whole text of an "is one of" list (its values: `values`, each `value`).
export const FILTER_LIMITS = Object.freeze({ conditions: 20, value: 200, values: 50, list: 12000 });

// Operators, with what they need: none, one value, two (between) or a list.
export const FILTER_OPERATORS = Object.freeze([
  { id: 'equals', label: 'is', needs: 'one' },
  { id: 'not_equals', label: 'is not', needs: 'one' },
  { id: 'contains', label: 'contains', needs: 'one' },
  { id: 'not_contains', label: 'does not contain', needs: 'one' },
  { id: 'starts_with', label: 'starts with', needs: 'one' },
  { id: 'ends_with', label: 'ends with', needs: 'one' },
  { id: 'in', label: 'is one of', needs: 'list' },
  { id: 'not_in', label: 'is none of', needs: 'list' },
  { id: 'gt', label: '>', needs: 'one', ordered: true },
  { id: 'gte', label: '≥', needs: 'one', ordered: true },
  { id: 'lt', label: '<', needs: 'one', ordered: true },
  { id: 'lte', label: '≤', needs: 'one', ordered: true },
  { id: 'between', label: 'is between', needs: 'two', ordered: true },
  { id: 'is_empty', label: 'is empty', needs: 'none' },
  { id: 'not_empty', label: 'is not empty', needs: 'none' },
]);
export const operatorById = (id) => FILTER_OPERATORS.find((entry) => entry.id === id) || null;

export const EMPTY_FILTER = Object.freeze({
  dropColumns: Object.freeze([]),
  rows: Object.freeze({ match: 'all', action: 'remove', conditions: Object.freeze([]) }),
  trimWhitespace: false,
  dropEmptyIn: Object.freeze([]),
  dropDuplicates: false,
});

export const newCondition = (column = '') => ({ column, operator: 'equals', value: '', value2: '' });

// eslint-disable-next-line no-control-regex
const text = (value, max = FILTER_LIMITS.value) => String(value ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max);
// "a, b, c" -> ['a', 'b', 'c'] (trimmed, no blanks, no repeats). A value that
// holds a comma is written in quotes: "5,000". Too many, or one too long, is a
// problem (filterProblems), never cut.
export const listValues = (value) => {
  const entries = String(value ?? '').match(/"[^"]*"|[^,]+/g) || [];
  return [...new Set(entries.map((entry) => entry.trim().replace(/^"(.*)"$/, '$1').trim()).filter(Boolean))];
};
// A number, or an ISO date (both compare in order on the Service), as
// { kind: 'number' | 'date', at } to compare two of them; null for neither.
const orderedValue = (value) => {
  const raw = String(value ?? '').trim();
  const digits = raw.replace(/,/g, '');
  if (/\d/.test(digits) && Number.isFinite(Number(digits))) return { kind: 'number', at: Number(digits) };
  const date = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw);
  if (!date) return null;
  const [year, month, day, hour, minute, second] = date.slice(1).map((part) => Number(part || 0));
  const at = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  // "2026-13-45" rolls over to another day: not a date.
  if (at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return { kind: 'date', at: at.getTime() };
};

// Any input -> the filter's shape, bounded; columns the dataframe does not
// have are dropped (a filter kept from an earlier dataframe).
export const normalizeFilter = (input, columns = null) => {
  const known = columns ? new Set(columns) : null;
  const keep = (column) => typeof column === 'string' && column && (!known || known.has(column));
  const unique = (list) => [...new Set((Array.isArray(list) ? list : []).filter(keep))];
  const conditions = (Array.isArray(input?.rows?.conditions) ? input.rows.conditions : [])
    .slice(0, FILTER_LIMITS.conditions)
    .map((entry) => ({
      column: keep(entry?.column) ? entry.column : '',
      operator: operatorById(entry?.operator) ? entry.operator : 'equals',
      value: text(entry?.value, operatorById(entry?.operator)?.needs === 'list' ? FILTER_LIMITS.list : FILTER_LIMITS.value),
      value2: text(entry?.value2),
    }));
  return {
    dropColumns: unique(input?.dropColumns),
    rows: {
      match: input?.rows?.match === 'any' ? 'any' : 'all',
      action: input?.rows?.action === 'keep' ? 'keep' : 'remove',
      conditions,
    },
    trimWhitespace: Boolean(input?.trimWhitespace),
    dropEmptyIn: unique(input?.dropEmptyIn),
    dropDuplicates: Boolean(input?.dropDuplicates),
  };
};

// Whether the filter changes anything.
export const filterIsActive = (filter) => {
  const f = normalizeFilter(filter);
  return Boolean(f.dropColumns.length || f.rows.conditions.length || f.trimWhitespace || f.dropEmptyIn.length || f.dropDuplicates);
};

// Problems that keep the filter from being applied, in plain words.
// columns: the dataframe's; used: columns the chosen action needs (source /
// target of a mapping), which cannot be stripped.
export const filterProblems = (filter, { columns = [], used = [] } = {}) => {
  const f = normalizeFilter(filter);
  const problems = [];
  if (columns.length && f.dropColumns.length >= columns.length) problems.push('At least one column must be kept.');
  used.filter(Boolean).forEach((column) => {
    if (f.dropColumns.includes(column)) problems.push(`"${column}" is used by the chosen action and cannot be stripped.`);
  });
  f.rows.conditions.forEach((condition, index) => {
    const n = `Condition ${index + 1}`;
    const operator = operatorById(condition.operator);
    if (!condition.column) {
      problems.push(`${n}: choose a column.`);
      return;
    }
    if (f.dropColumns.includes(condition.column)) problems.push(`${n}: "${condition.column}" is stripped; keep it or remove the condition.`);
    if (operator.needs === 'one' && !condition.value.trim()) problems.push(`${n}: enter a value.`);
    if (operator.needs === 'two' && (!condition.value.trim() || !condition.value2.trim())) problems.push(`${n}: enter both values.`);
    if (operator.needs === 'list') {
      const values = listValues(condition.value);
      if (!values.length) problems.push(`${n}: enter one or more values, separated by commas.`);
      if (values.length > FILTER_LIMITS.values) problems.push(`${n}: ${values.length} values; at most ${FILTER_LIMITS.values} can be sent. Split them over several conditions (match any).`);
      if (values.some((value) => value.length > FILTER_LIMITS.value)) problems.push(`${n}: a value is longer than ${FILTER_LIMITS.value} characters.`);
    }
    if (operator.ordered && condition.value.trim() && !orderedValue(condition.value)) problems.push(`${n}: "${condition.value.trim()}" is not a number or a date (YYYY-MM-DD).`);
    if (operator.needs === 'two' && condition.value2.trim() && !orderedValue(condition.value2)) problems.push(`${n}: "${condition.value2.trim()}" is not a number or a date (YYYY-MM-DD).`);
    if (operator.needs === 'two') {
      const low = orderedValue(condition.value);
      const high = orderedValue(condition.value2);
      if (low && high && low.kind !== high.kind) problems.push(`${n}: both values must be numbers, or both dates.`);
      else if (low && high && low.at > high.at) problems.push(`${n}: the first value is larger than the second, so no row can match.`);
    }
  });
  f.dropEmptyIn.forEach((column) => {
    if (f.dropColumns.includes(column)) problems.push(`"${column}" is stripped; it cannot also be checked for empty values.`);
  });
  return problems;
};

const quote = (value) => `"${String(value).trim()}"`;
// One condition in words: 'amount ≥ "5000"'.
export const describeCondition = (condition) => {
  const operator = operatorById(condition.operator) || FILTER_OPERATORS[0];
  if (operator.needs === 'none') return `${condition.column} ${operator.label}`;
  if (operator.needs === 'two') return `${condition.column} ${operator.label} ${quote(condition.value)} and ${quote(condition.value2)}`;
  if (operator.needs === 'list') return `${condition.column} ${operator.label} ${listValues(condition.value).map(quote).join(', ')}`;
  return `${condition.column} ${operator.label} ${quote(condition.value)}`;
};

// The filter in plain lines (the popup's preview and the Dataframe page's
// summary). -> [text]
export const describeFilter = (filter) => {
  const f = normalizeFilter(filter);
  const lines = [];
  if (f.dropColumns.length) lines.push(`Strip ${f.dropColumns.length} ${f.dropColumns.length === 1 ? 'column' : 'columns'}: ${f.dropColumns.join(', ')}.`);
  const conditions = f.rows.conditions.filter((condition) => condition.column);
  if (conditions.length) {
    const joined = conditions.map(describeCondition).join(f.rows.match === 'any' ? ' OR ' : ' AND ');
    lines.push(`${f.rows.action === 'keep' ? 'Keep only' : 'Remove'} the rows where ${joined}.`);
  }
  if (f.dropEmptyIn.length) lines.push(`Remove the rows with an empty ${f.dropEmptyIn.join(', ')}.`);
  if (f.trimWhitespace) lines.push('Trim spaces around every value.');
  if (f.dropDuplicates) lines.push('Remove duplicate rows (all kept columns alike).');
  return lines;
};

// The filter as it was sent (filterPayload's shape, or the Service's record of
// it), in plain lines. [] for none.
export const describeFilterPayload = (payload) => {
  if (!payload || typeof payload !== 'object') return [];
  return describeFilter({
    dropColumns: payload.drop_columns,
    rows: {
      match: payload.row_filter?.match,
      action: payload.row_filter?.action,
      conditions: (Array.isArray(payload.row_filter?.conditions) ? payload.row_filter.conditions : []).map((condition) => {
        const list = (Array.isArray(condition?.values) ? condition.values : []).map(String);
        const operator = operatorById(condition?.operator);
        return {
          column: condition?.column,
          operator: condition?.operator,
          value: operator?.needs === 'list' ? list.map((value) => (value.includes(',') ? `"${value}"` : value)).join(', ') : String(condition?.value ?? list[0] ?? ''),
          value2: String(list[1] ?? ''),
        };
      }),
    },
    trimWhitespace: payload.trim_whitespace,
    dropEmptyIn: payload.drop_empty,
    dropDuplicates: payload.drop_duplicates,
  });
};

// How many filters are applied (the Dataframe page's button counts them):
// each stripped column, each row condition and each clean-up choice.
export const countFilters = (filter) => {
  const f = normalizeFilter(filter);
  return f.dropColumns.length + f.rows.conditions.length + f.dropEmptyIn.length + Number(f.trimWhitespace) + Number(f.dropDuplicates);
};

// A short summary for the Dataframe page: "3 columns stripped · 2 row
// conditions · clean-up". '' when nothing is filtered.
export const summarizeFilter = (filter) => {
  const f = normalizeFilter(filter);
  const parts = [];
  if (f.dropColumns.length) parts.push(`${f.dropColumns.length} ${f.dropColumns.length === 1 ? 'column' : 'columns'} stripped`);
  if (f.rows.conditions.length) parts.push(`${f.rows.conditions.length} row ${f.rows.conditions.length === 1 ? 'condition' : 'conditions'} (${f.rows.action === 'keep' ? 'keep matching' : 'remove matching'})`);
  if (f.trimWhitespace || f.dropEmptyIn.length || f.dropDuplicates) parts.push('clean-up');
  return parts.join(' · ');
};

// The request field the Service reads (B-27), or null when nothing is
// filtered. Applied in this order: trim, strip columns, drop empty, row
// conditions, duplicates.
export const filterPayload = (filter) => {
  if (!filterIsActive(filter)) return null;
  const f = normalizeFilter(filter);
  return {
    version: 1,
    drop_columns: f.dropColumns,
    row_filter: f.rows.conditions.length ? {
      match: f.rows.match,
      action: f.rows.action,
      conditions: f.rows.conditions.map((condition) => {
        const operator = operatorById(condition.operator);
        if (operator.needs === 'none') return { column: condition.column, operator: condition.operator };
        if (operator.needs === 'two') return { column: condition.column, operator: condition.operator, values: [condition.value.trim(), condition.value2.trim()] };
        if (operator.needs === 'list') return { column: condition.column, operator: condition.operator, values: listValues(condition.value) };
        return { column: condition.column, operator: condition.operator, value: condition.value.trim() };
      }),
    } : null,
    trim_whitespace: f.trimWhitespace,
    drop_empty: f.dropEmptyIn,
    drop_duplicates: f.dropDuplicates,
  };
};
