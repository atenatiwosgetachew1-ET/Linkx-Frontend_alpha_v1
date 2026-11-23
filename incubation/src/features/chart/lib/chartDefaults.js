import { DEFAULT_SCHEMA, SCHEMA_NAMES } from './chartColors.js';
import { CHART_METRICS, isMetricAvailable } from './chartMetrics.js';

// How a Chart window starts (Libraries ▸ Charts; analyst request
// 2026-11-23): its scope, how its charts come up, which ones come up by
// themselves, their colours, and whether they follow the graph's selection.
// Kept in this browser (localStorage). A Chart window reads them until it
// has a state of its own (its first change, or the first charts coming up);
// from then on it keeps what it has.

export const CHART_DEFAULTS_KEY = 'linkx.chart.defaults.v1';
const SCOPES = ['drawn', 'selected', 'all'];
const MODES = ['auto', 'manual'];

// The charts Automatic brought up before this could be chosen: the
// Global-level ones.
export const builtinAutoMetrics = () => CHART_METRICS.filter((metric) => metric.group === 'global' && isMetricAvailable(metric)).map((metric) => metric.id);

export const BUILTIN_CHART_DEFAULTS = Object.freeze({
  scope: 'drawn',
  mode: 'auto',
  colorful: true,
  schema: DEFAULT_SCHEMA,
  follow: true,
  autoMetrics: Object.freeze(builtinAutoMetrics()),
});

// Cleaned on read: known values only; the charts in the menu's order, each
// once, available ones only.
export const normalizeChartDefaults = (input) => {
  const chosen = Array.isArray(input?.autoMetrics) ? new Set(input.autoMetrics) : null;
  return {
    scope: SCOPES.includes(input?.scope) ? input.scope : BUILTIN_CHART_DEFAULTS.scope,
    mode: MODES.includes(input?.mode) ? input.mode : BUILTIN_CHART_DEFAULTS.mode,
    colorful: input?.colorful === undefined ? BUILTIN_CHART_DEFAULTS.colorful : input.colorful !== false,
    schema: SCHEMA_NAMES.includes(input?.schema) ? input.schema : BUILTIN_CHART_DEFAULTS.schema,
    follow: input?.follow === undefined ? BUILTIN_CHART_DEFAULTS.follow : input.follow !== false,
    autoMetrics: chosen
      ? CHART_METRICS.filter((metric) => chosen.has(metric.id) && isMetricAvailable(metric)).map((metric) => metric.id)
      : [...BUILTIN_CHART_DEFAULTS.autoMetrics],
  };
};

const sameDefaults = (a, b) => a.scope === b.scope && a.mode === b.mode && a.colorful === b.colorful && a.schema === b.schema && a.follow === b.follow
  && a.autoMetrics.length === b.autoMetrics.length && a.autoMetrics.every((id, index) => id === b.autoMetrics[index]);
export const isBuiltinChartDefaults = (defaults) => sameDefaults(defaults, BUILTIN_CHART_DEFAULTS);

const read = () => {
  try {
    const raw = localStorage.getItem(CHART_DEFAULTS_KEY);
    return normalizeChartDefaults(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeChartDefaults(null);
  }
};

// One snapshot object until something changes (useSyncExternalStore).
let snapshot = null;
const listeners = new Set();
const publish = (next) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

export const getChartDefaults = () => {
  if (!snapshot) snapshot = read();
  return snapshot;
};

export const setChartDefaults = (patch) => {
  const next = normalizeChartDefaults({ ...getChartDefaults(), ...patch });
  if (sameDefaults(next, getChartDefaults())) return;
  try {
    localStorage.setItem(CHART_DEFAULTS_KEY, JSON.stringify(next));
  } catch { /* storage full or blocked: kept for this visit only */ }
  publish(next);
};

export const resetChartDefaults = () => {
  try {
    localStorage.removeItem(CHART_DEFAULTS_KEY);
  } catch { /* nothing to remove */ }
  publish(normalizeChartDefaults(null));
};

export const subscribeChartDefaults = (listener) => {
  listeners.add(listener);
  // Another tab changed them.
  const onStorage = (event) => {
    if (event.key === CHART_DEFAULTS_KEY) publish(read());
  };
  if (listeners.size === 1 && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

// For tests: forget what was read.
export const forgetChartDefaults = () => { snapshot = null; };
