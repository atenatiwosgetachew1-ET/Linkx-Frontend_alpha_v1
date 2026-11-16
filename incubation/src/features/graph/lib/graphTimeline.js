// Timeline filter (G3.5 i2 benchmark #1, after i2 Analyst's Notebook's time
// bar; not in production, analyst decision 2026-11-15). A histogram of the
// dated nodes and links of the view over time; a chosen range hides what is
// dated outside it (view only: the graph data is unchanged). Undated items
// stay shown unless asked otherwise.

// Production's canonical transaction date (src/App.jsx LINKX_CANONICAL_COLUMNS:
// TRANSACTIONDATE, CDR "START_TIME (Call Start Time)") is preferred.
const PREFERRED_KEYS = ['TRANSACTIONDATE', 'TX_DATE', 'CALL_DATE', 'START_TIME', 'TIMESTAMP'];
const DATE_NAME = /(date|time|timestamp|datetime|_at$|^at_|created|updated|day)/i;
// Keys that are never dates (layout and drawing).
const SKIP_KEYS = new Set(['id', 'from', 'to', 'x', 'y', 'size', 'width', 'label', 'title', 'color', 'shape', 'image', 'iconPath', 'eventTypes', 'members', 'edges', 'externalEdges', '__edits']);
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
const SAMPLE_LIMIT = 3000;
const MIN_YEAR = 1900;
const MAX_YEAR = 2200;

const inRange = (ms) => {
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getFullYear();
  return year >= MIN_YEAR && year <= MAX_YEAR ? ms : null;
};

// A value as epoch milliseconds, or null. Numbers (and digit strings) count
// only for keys named like dates: amounts are numbers too.
export const parseTimelineDate = (value, { numeric = false } = {}) => {
  if (value == null || value === '') return null;
  if (value instanceof Date) return inRange(value.getTime());
  if (typeof value === 'number') {
    if (!numeric) return null;
    return inRange(value > 1e11 ? value : value * 1000);
  }
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{10}(\d{3})?$/.test(text)) return numeric ? inRange(text.length === 13 ? Number(text) : Number(text) * 1000) : null;
  if (ISO_LIKE.test(text)) return inRange(Date.parse(text.length > 10 ? text.replace(' ', 'T') : `${text}T00:00:00`));
  return null;
};

const itemValue = (attributes, key) => attributes?.[key];

// Keys holding dates on the view's nodes and links: [{ key, count }], the
// preferred ones first, then the most used.
export const timelineKeys = (graph, view) => {
  const counts = new Map();
  const seen = new Map();
  const visit = (attributes) => {
    Object.entries(attributes || {}).forEach(([key, value]) => {
      if (SKIP_KEYS.has(key) || value == null || value === '' || typeof value === 'object') return;
      seen.set(key, (seen.get(key) || 0) + 1);
      if (parseTimelineDate(value, { numeric: DATE_NAME.test(key) }) != null) counts.set(key, (counts.get(key) || 0) + 1);
    });
  };
  view.nodeIds.slice(0, SAMPLE_LIMIT).forEach((id) => visit(graph.getNodeAttributes(id)));
  view.edgeIds.slice(0, SAMPLE_LIMIT).forEach((key) => visit(graph.getEdgeAttributes(key)));
  const rank = (key) => {
    const preferred = PREFERRED_KEYS.indexOf(key.toUpperCase());
    return preferred >= 0 ? preferred : PREFERRED_KEYS.length;
  };
  return [...counts]
    // Mostly dates where present (a stray date-looking value is not enough).
    .filter(([key, count]) => count >= Math.max(1, (seen.get(key) || 0) * 0.6))
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => rank(a.key) - rank(b.key) || b.count - a.count || a.key.localeCompare(b.key));
};

// Every dated item of the view: { nodes: Map(id -> ms), edges: Map(key -> ms) }.
export const timelineItems = (graph, view, key) => {
  const numeric = DATE_NAME.test(key);
  const nodes = new Map();
  const edges = new Map();
  if (!key) return { nodes, edges };
  view.nodeIds.forEach((id) => {
    const ms = parseTimelineDate(itemValue(graph.getNodeAttributes(id), key), { numeric });
    if (ms != null) nodes.set(id, ms);
  });
  view.edgeIds.forEach((edgeKey) => {
    const ms = parseTimelineDate(itemValue(graph.getEdgeAttributes(edgeKey), key), { numeric });
    if (ms != null) edges.set(edgeKey, ms);
  });
  return { nodes, edges };
};

/* ── Buckets ────────────────────────────────────────────────────────── */

const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const TIME_UNITS = ['hour', 'day', 'week', 'month', 'quarter', 'year'];
// The slicing choices of the strip ('auto' picks from the span).
export const SLICE_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'hour', label: 'Hourly' },
  { value: 'day', label: 'Daily' },
  { value: 'week', label: 'Weekly' },
  { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' },
  { value: 'year', label: 'Yearly' },
];
export const MAX_BUCKETS = 2000;
// About how long a bar of a unit is (to tell whether a span fits).
const UNIT_MS = { hour: HOUR, day: DAY, week: 7 * DAY, month: 30.44 * DAY, quarter: 91.3 * DAY, year: 365.25 * DAY };
// Whether slicing [min, max] by `unit` stays within MAX_BUCKETS bars.
export const unitFits = (min, max, unit) => Math.max(0, max - min) / UNIT_MS[unit] < MAX_BUCKETS - 1;

// The bucket size for a span: about 12 to 120 bars.
export const chooseUnit = (min, max) => {
  const span = Math.max(0, max - min);
  if (span <= 3 * DAY) return 'hour';
  if (span <= 120 * DAY) return 'day';
  if (span <= 2 * 365 * DAY) return 'week';
  if (span <= 12 * 365 * DAY) return 'month';
  return 'year';
};

// The start of the bucket holding `ms` (local time; weeks start on Monday).
export const bucketStart = (ms, unit) => {
  const date = new Date(ms);
  if (unit === 'hour') date.setMinutes(0, 0, 0);
  else {
    date.setHours(0, 0, 0, 0);
    if (unit === 'week') date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
    else if (unit === 'month') date.setDate(1);
    else if (unit === 'quarter') date.setMonth(date.getMonth() - (date.getMonth() % 3), 1);
    else if (unit === 'year') date.setMonth(0, 1);
  }
  return date.getTime();
};

export const nextBucket = (ms, unit) => {
  const date = new Date(ms);
  if (unit === 'hour') date.setHours(date.getHours() + 1);
  else if (unit === 'day') date.setDate(date.getDate() + 1);
  else if (unit === 'week') date.setDate(date.getDate() + 7);
  else if (unit === 'month') date.setMonth(date.getMonth() + 1);
  else if (unit === 'quarter') date.setMonth(date.getMonth() + 3);
  else date.setFullYear(date.getFullYear() + 1);
  return date.getTime();
};

// The histogram: [{ start, end, count }] covering every dated item.
export const timelineBuckets = (times, unit = null) => {
  const values = [...times];
  if (!values.length) return { unit: unit || 'day', buckets: [] };
  let min = Infinity;
  let max = -Infinity;
  values.forEach((ms) => {
    if (ms < min) min = ms;
    if (ms > max) max = ms;
  });
  const chosen = unit || chooseUnit(min, max);
  const buckets = [];
  const index = new Map();
  for (let start = bucketStart(min, chosen); start <= max; start = nextBucket(start, chosen)) {
    index.set(start, buckets.length);
    buckets.push({ start, end: nextBucket(start, chosen), count: 0 });
    if (buckets.length > MAX_BUCKETS) break;
  }
  values.forEach((ms) => {
    const at = index.get(bucketStart(ms, chosen));
    if (at !== undefined) buckets[at].count += 1;
  });
  return { unit: chosen, buckets };
};

/* ── The filter ─────────────────────────────────────────────────────── */

// The view without what is dated outside [from, to) (and, with
// hideUndated, what has no date). A link goes with either end.
export const applyTimeFilter = (graph, view, { key, from = null, to = null, hideUndated = false } = {}) => {
  if (!key || (from == null && to == null && !hideUndated)) return view;
  const { nodes, edges } = timelineItems(graph, view, key);
  const inside = (ms) => (from == null || ms >= from) && (to == null || ms < to);
  const keepNode = (id) => (nodes.has(id) ? inside(nodes.get(id)) : !hideUndated);
  const nodeIds = view.nodeIds.filter(keepNode);
  const kept = new Set(nodeIds);
  const edgeIds = view.edgeIds.filter((edgeKey) => {
    if (!kept.has(graph.source(edgeKey)) || !kept.has(graph.target(edgeKey))) return false;
    return edges.has(edgeKey) ? inside(edges.get(edgeKey)) : !hideUndated;
  });
  return { ...view, nodeIds, edgeIds, timeFiltered: true };
};

// "12 Mar 2026", "Mar 2026", "Q1 2026", "2026", "12 Mar 14:00" for a unit.
export const formatBucket = (ms, unit) => {
  const date = new Date(ms);
  if (unit === 'year') return String(date.getFullYear());
  if (unit === 'quarter') return `Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
  if (unit === 'month') return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  if (unit === 'hour') return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};
