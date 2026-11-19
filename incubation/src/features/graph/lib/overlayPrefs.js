// Which on-graph components the Graph windows show (not in production;
// analyst decision 2026-11-15): the minimap, the relationship legend and the
// Graph Alerts / Pinned Evidence cards. Kept on the device and shared by
// every Graph window, which follow changes at once.

export const OVERLAY_PREFS_KEY = 'linkx_graph_overlays_v1';

export const OVERLAY_COMPONENTS = Object.freeze([
  { key: 'minimap', label: 'Minimap', hint: 'Shown while part of the graph is outside the view' },
  { key: 'legend', label: 'Relationship legend', hint: 'Line types, bottom-left' },
  { key: 'glyphs', label: 'Node badges', hint: 'Alert, pinned, flag, note, group and merged badges on nodes' },
  { key: 'alerts', label: 'Graph Alerts', hint: 'Alert card, bottom-right' },
  { key: 'pinned', label: 'Pinned Evidence', hint: 'Pinned items card, top-right' },
  { key: 'combined', label: 'Merged & Grouped', hint: 'Merged and grouped nodes card, top-left' },
]);

export const DEFAULT_OVERLAY_PREFS = Object.freeze({ minimap: true, legend: true, glyphs: true, alerts: true, pinned: true, combined: true });

export const normalizeOverlayPrefs = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(Object.keys(DEFAULT_OVERLAY_PREFS).map((key) => [key, source[key] !== false]));
};

let cache = null;
const listeners = new Set();

const read = () => {
  try {
    return normalizeOverlayPrefs(JSON.parse(localStorage.getItem(OVERLAY_PREFS_KEY) || 'null'));
  } catch {
    return normalizeOverlayPrefs(null);
  }
};

export const getOverlayPrefs = () => {
  if (!cache) cache = read();
  return cache;
};

const publish = (next) => {
  cache = next;
  try {
    localStorage.setItem(OVERLAY_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the choice applies to this session only.
  }
  listeners.forEach((listener) => listener());
};

export const setOverlayPref = (key, on) => {
  const current = getOverlayPrefs();
  if (!(key in current) || current[key] === Boolean(on)) return;
  publish({ ...current, [key]: Boolean(on) });
};

export const subscribeOverlayPrefs = (listener) => {
  listeners.add(listener);
  // Other browser tabs.
  const onStorage = (event) => {
    if (event.key !== OVERLAY_PREFS_KEY) return;
    cache = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

// Tests.
export const resetOverlayPrefsCache = () => {
  cache = null;
};
