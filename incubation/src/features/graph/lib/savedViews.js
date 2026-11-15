// Saved views (graph-chart-plan G2.4c), ported from production
// graphs_adjuster.js (GA:1205-1300 storage and scope, GA:3812 saveCurrentView,
// GA:3839 applySavedViewSettings, GA:3880 loadSavedView).
//
// Views are kept on the device under production's key, scoped to a graph by
// production's fingerprint (node / edge counts and the first 24 node ids),
// at most 30 per graph, newest first; a view saved under an existing name
// replaces it. Records keep production's shape, so views saved by either
// version load in the other. Two fields are added:
//   graphSettings  this build's typed settings (production's keys are kept too)
//   positions      { id: [x, y] } of the visible nodes, so the saved camera
//                  shows the same picture (production re-ran its layout and
//                  saved no positions)

import { normalizeElementFilters } from './graphAnalysis.js';
import { DEFAULT_GRAPH_SETTINGS, normalizeGraphSettings } from './graphSettings.js';

export const SAVED_VIEWS_KEY = 'linkx_saved_views_v1';
export const MAX_SAVED_VIEWS = 30;
const MAX_STORED_VIEWS = Math.max(MAX_SAVED_VIEWS * 20, 600);

// GA:1205 sanitizeScopeToken
export const sanitizeScopeToken = (value) => {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  return raw.toLowerCase().replace(/[^a-z0-9_\-.]+/g, '_').slice(0, 120);
};

// GA:1211 computeGraphScopeFingerprint, then sanitised (GA:1272).
export const graphScope = (graph) => {
  const nodeCount = graph.order;
  const edgeCount = graph.size;
  const sample = graph.nodes()
    .map(String)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .slice(0, 24)
    .join('|');
  const raw = `${nodeCount}:${edgeCount}:${sample}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return sanitizeScopeToken(`graph_${nodeCount}_${edgeCount}_${Math.abs(hash)}`) || 'graph_default';
};

const readAll = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVED_VIEWS_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') : [];
  } catch {
    return [];
  }
};

// -> true when stored (false: browser storage full or unavailable)
const writeAll = (views) => {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
    return true;
  } catch {
    return false;
  }
};

const sameScope = (item, scopeId) => sanitizeScopeToken(item?.scopeId) === scopeId;

// GA:1240 getSavedViewsForScope (newest first, 30 at most).
export const savedViewsFor = (scopeId) => readAll().filter((item) => sameScope(item, scopeId)).slice(0, MAX_SAVED_VIEWS);

// GA:1254 persistSavedViewsForScope after GA:3812's unshift. -> stored?
export const storeSavedView = (scopeId, view) => {
  const name = String(view.name || '').trim();
  const scoped = [{ ...view, name, scopeId }, ...savedViewsFor(scopeId).filter((item) => String(item.name || '') !== name)]
    .slice(0, MAX_SAVED_VIEWS);
  const others = readAll().filter((item) => !sameScope(item, scopeId));
  return writeAll([...scoped, ...others].slice(0, MAX_STORED_VIEWS));
};

// GA:1280 removeSavedViewsByNames. -> number removed
export const removeSavedViews = (scopeId, names) => {
  const wanted = new Set((names || []).map((name) => String(name).trim()).filter(Boolean));
  if (!wanted.size) return 0;
  const all = readAll();
  const kept = all.filter((item) => !(sameScope(item, scopeId) && wanted.has(String(item.name || '').trim())));
  if (kept.length !== all.length) writeAll(kept);
  return all.length - kept.length;
};

// GA:2306 default name: "View 2026-11-15 14:32:05" (UTC, as production).
export const defaultViewName = (date = new Date()) => `View ${date.toISOString().slice(0, 19).replace('T', ' ')}`;

/* ── Settings in production's currentSettings keys ──────────────────── */

export const toSavedSettings = (settings, elementFilters) => {
  const s = normalizeGraphSettings(settings);
  return {
    sortKey: s.limit.key,
    sortOrder: s.limit.sort,
    limitMin: s.limit.min,
    limitMax: s.limit.max,
    lableGroup: s.labels.group, // production's spelling
    labelKey: s.labels.byKey,
    weightEdges: s.edgeWeight,
    showTitles: s.showTitles,
    showLabels: s.showLabels,
    physics: s.physics,
    layoutType: s.layout.type,
    layoutDirection: s.layout.direction,
    sortMethod: s.layout.sortMethod,
    layerMode: s.layout.layerMode,
    layerKey: s.layout.layerKey,
    alertRules: s.alertRules,
    edgeBundling: s.edgeBundling,
    elementFilters: normalizeElementFilters(elementFilters),
  };
};

// A view's settings as typed settings: this build's own copy when present,
// else production's keys (GA:3839), over the current settings.
export const fromSavedView = (view, current = DEFAULT_GRAPH_SETTINGS) => {
  if (view?.graphSettings) return normalizeGraphSettings({ ...current, ...view.graphSettings });
  const saved = view?.settings && typeof view.settings === 'object' ? view.settings : {};
  const base = normalizeGraphSettings(current);
  return normalizeGraphSettings({
    ...base,
    limit: {
      key: saved.sortKey ?? base.limit.key,
      sort: saved.sortOrder ?? base.limit.sort,
      min: saved.limitMin ?? saved.limitRangeMin ?? 0,
      max: saved.limitMax ?? saved.limitRangeMax ?? saved.limit ?? 25,
    },
    labels: { group: saved.lableGroup ?? base.labels.group, byKey: saved.labelKey ?? base.labels.byKey },
    edgeWeight: saved.weightEdges ?? '',
    showTitles: saved.showTitles,
    showLabels: saved.showLabels,
    physics: saved.physics,
    layout: {
      type: saved.layoutType || 'concentric',
      direction: saved.layoutDirection || 'UD',
      sortMethod: saved.sortMethod || 'directed',
      layerMode: saved.layerMode || 'hop_distance',
      layerKey: saved.layerKey ?? '',
    },
    alertRules: saved.alertRules !== false,
    edgeBundling: Boolean(saved.edgeBundling),
  });
};

// Element filters saved with a view (production settings.elementFilters), or null.
export const savedElementFilters = (view) => (
  view?.settings?.elementFilters ? normalizeElementFilters(view.settings.elementFilters) : null
);
