// Graph window settings (docs/graph-chart-plan.md §3.1, §5.3).
//
// Production keeps them as a positional 15-element array
// (DEFAULT_GRAPH_IFRAME_SETTINGS, src/App.jsx:39; index map ~14366):
//   [0] limit key  [1] sort  [2] range {min,max}  [3] label group
//   [4] label-by key  [5] edge weight  [6] titles  [7] labels  [8] edit infos
//   [9] physics  [10] layout type  [11] direction  [12] sort method
//   [13] layer mode  [14] layer key
// Here they are a typed object. fromProductionSettings / toProductionSettings
// convert both ways so production exports and saved views keep loading.

import { DEFAULT_LINK_AGGREGATION, normalizeLinkAggregation } from './linkAggregation.js';
import { DEFAULT_FORMATTING, normalizeFormatting } from './conditionalFormatting.js';

// Production limits (A:37-38) plus the G0 benchmark limits (plan §5.3).
export const GRAPH_LIMITS = Object.freeze({
  DEFAULT_VISIBLE: 25, // production default range {0, 25}
  WARNING: 300, // production GRAPH_LIMIT_WARNING_THRESHOLD; confirmed by G0 for canvas
  ABSOLUTE_MAX: 100000, // production GRAPH_LIMIT_HARD_MAX
  CANVAS_HARD_CAP: 2000,
  WEBGL_WARNING: 5000,
  WEBGL_HARD_CAP: 20000,
  CANVAS_FAST_ABOVE: 300, // pixel ratio 1 above this (canvas)
  CANVAS_HIDE_EDGES_ABOVE: 1000, // edges hidden while panning / zooming above this
  PHYSICS_AUTO_OFF_AT: 300, // production AUTO_PHYSICS_NODE_THRESHOLD
  ELK_INTERACTIVE_MAX: 500,
  ELK_MAX: 1000, // above: production's fast layered layout
});

// peacock / grouped: G3.5 i2 #6 (not in production; analyst decision 2026-11-17).
// Grouped reuses layerMode / layerKey: 'by_key' groups by that property, any
// other mode by node type.
export const LAYOUT_TYPES = Object.freeze(['concentric', 'hierarchical', 'layered', 'circle', 'star', 'radial', 'grid', 'spiral', 'peacock', 'grouped']);
export const LABEL_GROUPS = Object.freeze(['Entity Node', 'Source Node', 'Target Node']);
export const LAYER_MODES = Object.freeze(['hop_distance', 'node_identity', 'by_key']);

export const DEFAULT_GRAPH_SETTINGS = Object.freeze({
  limit: Object.freeze({ key: '', sort: 'asc', min: 0, max: GRAPH_LIMITS.DEFAULT_VISIBLE }),
  labels: Object.freeze({ group: '', byKey: '' }),
  edgeWeight: '', // '' (off) | 'default' | property key
  showTitles: false,
  showLabels: false,
  editInfos: false, // always disabled in production (A:8521); kept for parity
  physics: false,
  layout: Object.freeze({ type: 'concentric', direction: 'UD', sortMethod: 'directed', layerMode: 'hop_distance', layerKey: '' }),
  // Production creates every Graph window with performance mood ON
  // (setIframePerformanceMood(... [id]: true), src/App.jsx ~13240).
  performance: true,
  // Alert rules on / off (production currentSettings.alertRules, on unless
  // turned off; toggled from the right-click menu).
  alertRules: true,
  // Edge bundling (production currentSettings.edgeBundling, off by default)
  // and its minimum group (production EDGE_BUNDLING_STATE.minGroupSize, 2).
  edgeBundling: false,
  edgeBundleMin: 2,
  // Actor profile card on node click, for this graph (analyst decision
  // 2026-11-16; what it shows is the domain's, Configuration ▸ Rules).
  actorProfile: true,
  // Link aggregation (G3.5 i2 #2, not in production): lib/linkAggregation.js.
  linkAggregation: DEFAULT_LINK_AGGREGATION,
  // Conditional formatting rules (G3.5 i2 #4, not in production):
  // lib/conditionalFormatting.js.
  formatting: DEFAULT_FORMATTING,
  // The domain's formatting rules (Configuration ▸ Rules) apply below this
  // graph's own, unless turned off here.
  useDomainRules: true,
});

const clampInt = (value, min, max) => Math.max(min, Math.min(max, Math.floor(Number(value) || 0)));

// Production normalizeGraphLimitRange (A:515): object, [min, max] or a count.
export const normalizeLimitRange = (value, fallbackMax = GRAPH_LIMITS.DEFAULT_VISIBLE) => {
  const top = GRAPH_LIMITS.ABSOLUTE_MAX;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const min = clampInt(value.min ?? 0, 0, top - 1);
    const max = clampInt(value.max ?? fallbackMax, 1, top);
    return { min, max: Math.max(min + 1, max) };
  }
  if (Array.isArray(value) && value.length >= 2) {
    const min = clampInt(value[0], 0, top - 1);
    const max = clampInt(value[1], 1, top);
    return { min, max: Math.max(min + 1, max) };
  }
  const count = clampInt(value, 1, top) || clampInt(fallbackMax, 1, top);
  return { min: 0, max: count };
};

const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
const text = (value, maxLength = 120) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : '');
const bool = (value) => value === true || value === 'true';

// Any partial / untrusted object -> complete, valid settings.
export const normalizeGraphSettings = (input = {}) => {
  const d = DEFAULT_GRAPH_SETTINGS;
  const range = normalizeLimitRange({ min: input.limit?.min ?? d.limit.min, max: input.limit?.max ?? d.limit.max });
  const layoutType = input.layout?.type === 'default' ? 'concentric' : input.layout?.type;
  return {
    limit: { key: text(input.limit?.key), sort: input.limit?.sort === 'desc' ? 'desc' : 'asc', min: range.min, max: range.max },
    labels: { group: oneOf(input.labels?.group, LABEL_GROUPS, ''), byKey: text(input.labels?.byKey) },
    edgeWeight: text(input.edgeWeight),
    showTitles: bool(input.showTitles),
    showLabels: bool(input.showLabels),
    editInfos: false,
    physics: bool(input.physics),
    layout: {
      type: oneOf(layoutType, LAYOUT_TYPES, d.layout.type),
      direction: input.layout?.direction === 'LR' ? 'LR' : 'UD',
      sortMethod: input.layout?.sortMethod === 'hubsize' ? 'hubsize' : 'directed',
      layerMode: oneOf(input.layout?.layerMode, LAYER_MODES, d.layout.layerMode),
      layerKey: text(input.layout?.layerKey),
    },
    performance: input.performance === undefined ? d.performance : bool(input.performance),
    alertRules: input.alertRules === undefined ? d.alertRules : bool(input.alertRules),
    edgeBundling: input.edgeBundling === undefined ? d.edgeBundling : bool(input.edgeBundling),
    edgeBundleMin: Math.max(2, parseInt(input.edgeBundleMin, 10) || d.edgeBundleMin),
    actorProfile: input.actorProfile === undefined ? d.actorProfile : bool(input.actorProfile),
    linkAggregation: normalizeLinkAggregation(input.linkAggregation),
    formatting: normalizeFormatting(input.formatting),
    useDomainRules: input.useDomainRules === undefined ? d.useDomainRules : bool(input.useDomainRules),
  };
};

// Production array (or index-keyed object) -> typed settings.
export const fromProductionSettings = (value) => {
  const source = Array.isArray(value)
    ? value
    : (value && typeof value === 'object' ? Array.from({ length: 15 }, (_, i) => value[i]) : []);
  const at = (i) => source[i];
  return normalizeGraphSettings({
    limit: { key: at(0), sort: at(1), ...normalizeLimitRange(at(2) ?? { min: 0, max: GRAPH_LIMITS.DEFAULT_VISIBLE }) },
    labels: { group: at(3), byKey: at(4) },
    edgeWeight: at(5),
    showTitles: at(6),
    showLabels: at(7),
    physics: at(9),
    layout: { type: at(10), direction: at(11), sortMethod: at(12), layerMode: at(13), layerKey: at(14) },
  });
};

// Typed settings -> production array (for JSON exports production can read).
export const toProductionSettings = (settings) => {
  const s = normalizeGraphSettings(settings);
  return [
    s.limit.key,
    s.limit.sort,
    { min: s.limit.min, max: s.limit.max },
    s.labels.group,
    s.labels.byKey,
    s.edgeWeight,
    s.showTitles,
    s.showLabels,
    false,
    s.physics,
    s.layout.type,
    s.layout.direction,
    s.layout.sortMethod,
    s.layout.layerMode,
    s.layout.layerKey,
  ];
};

// Production performance mood (A:12959-12993, GA:8476-8485): turning it on
// forces edge weight, titles, labels and physics off; physics also goes off and
// hierarchical becomes layered once PHYSICS_AUTO_OFF_AT nodes are visible.
export const applyPerformancePolicy = (settings, visibleCount = 0) => {
  const s = normalizeGraphSettings(settings);
  const large = visibleCount >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT;
  const forced = s.performance;
  return {
    ...s,
    edgeWeight: forced ? '' : s.edgeWeight,
    showTitles: forced ? false : s.showTitles,
    showLabels: forced ? false : s.showLabels,
    physics: forced || large ? false : s.physics,
    layout: { ...s.layout, type: large && s.layout.type === 'hierarchical' ? 'layered' : s.layout.type },
  };
};

// Positions are reused while the layout settings stay the same (GraphCanvas).
export const layoutSignatureOf = (layout = DEFAULT_GRAPH_SETTINGS.layout) => {
  const { type, direction, sortMethod, layerMode, layerKey } = layout;
  return JSON.stringify([type, direction, sortMethod, layerMode, layerKey]);
};

// Which plain view expand / collapse edits belong to: the limit, the
// renderer's cap and the search (GraphWindowBody).
export const viewKeyOf = (limit, cap, search) => JSON.stringify([limit, cap, search || null]);

// Visible-node cap for a renderer (plan §5.3).
export const visibleCapFor = (renderer) => (renderer === 'webgl' ? GRAPH_LIMITS.WEBGL_HARD_CAP : GRAPH_LIMITS.CANVAS_HARD_CAP);
