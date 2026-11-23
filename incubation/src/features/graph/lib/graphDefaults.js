import { DEFAULT_GRAPH_SETTINGS, GRAPH_LIMITS, normalizeGraphSettings } from './graphSettings.js';

// How a Graph window starts (Libraries ▸ Graph defaults; analyst request
// 2026-11-23): how many nodes it shows first, its layout, what it draws
// (labels, titles, link weights), and which of its helpers are on. Kept in
// this browser (localStorage). A Graph window reads them until it has
// settings of its own (its first change); from then on it keeps what it has.
//
// Only what makes sense before a graph is loaded can be set here. What
// depends on the data (the property a limit sorts by, a label's property,
// link aggregation, formatting rules) stays with each graph.

export const GRAPH_DEFAULTS_KEY = 'linkx.graph.defaults.v1';
// The most nodes a new graph may show first: the standard renderer's cap.
export const GRAPH_DEFAULT_LIMIT_MAX = GRAPH_LIMITS.CANVAS_HARD_CAP;

const clamp = (value, min, max, fallback) => {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

// Complete, valid settings from what was saved: the tunable ones kept, the
// rest as built in.
export const normalizeGraphDefaults = (input) => {
  const d = DEFAULT_GRAPH_SETTINGS;
  const source = input && typeof input === 'object' ? input : {};
  const base = normalizeGraphSettings({
    limit: { sort: source.limit?.sort, min: 0, max: clamp(source.limit?.max, 1, GRAPH_DEFAULT_LIMIT_MAX, d.limit.max) },
    layout: {
      type: source.layout?.type,
      direction: source.layout?.direction,
      sortMethod: source.layout?.sortMethod,
      // Layers by a property need the data: by hop distance, or by node type.
      layerMode: source.layout?.layerMode === 'node_identity' ? 'node_identity' : d.layout.layerMode,
    },
    edgeWeight: source.edgeWeight === 'default' ? 'default' : '',
    showTitles: source.showTitles,
    showLabels: source.showLabels,
    physics: source.physics,
    performance: source.performance,
    alertRules: source.alertRules,
    edgeBundling: source.edgeBundling,
    edgeBundleMin: source.edgeBundleMin,
    actorProfile: source.actorProfile,
    useDomainRules: source.useDomainRules,
  });
  return base;
};

const BUILTIN = normalizeGraphDefaults(null);
const signature = (settings) => JSON.stringify(settings);
export const isBuiltinGraphDefaults = (settings) => signature(settings) === signature(BUILTIN);

const read = () => {
  try {
    const raw = localStorage.getItem(GRAPH_DEFAULTS_KEY);
    return normalizeGraphDefaults(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeGraphDefaults(null);
  }
};

// One snapshot object until something changes (useSyncExternalStore).
let snapshot = null;
const listeners = new Set();
const publish = (next) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

export const getGraphDefaults = () => {
  if (!snapshot) snapshot = read();
  return snapshot;
};

// patch: top-level keys; `limit` and `layout` are merged into what is there.
export const setGraphDefaults = (patch = {}) => {
  const current = getGraphDefaults();
  const next = normalizeGraphDefaults({
    ...current,
    ...patch,
    limit: { ...current.limit, ...(patch.limit || {}) },
    layout: { ...current.layout, ...(patch.layout || {}) },
  });
  if (signature(next) === signature(current)) return;
  try {
    localStorage.setItem(GRAPH_DEFAULTS_KEY, JSON.stringify(next));
  } catch { /* storage full or blocked: kept for this visit only */ }
  publish(next);
};

export const resetGraphDefaults = () => {
  try {
    localStorage.removeItem(GRAPH_DEFAULTS_KEY);
  } catch { /* nothing to remove */ }
  publish(normalizeGraphDefaults(null));
};

export const subscribeGraphDefaults = (listener) => {
  listeners.add(listener);
  // Another tab changed them.
  const onStorage = (event) => {
    if (event.key === GRAPH_DEFAULTS_KEY) publish(read());
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

// For tests: forget what was read.
export const forgetGraphDefaults = () => { snapshot = null; };
