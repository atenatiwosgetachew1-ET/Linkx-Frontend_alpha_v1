// Graph alert rules (graph-chart-plan G2.4), ported from production
// graphs_adjuster.js: the high-degree and heavy-edge rules, their
// configuration (GA:1100 DEFAULT_ALERT_RULES_CONFIG, GA:1126 normalize) and
// the Graph Alerts panel wording (GA:4689 describeGraphAlert).
//
// Works on the window's graphology graph and the visible view, as production
// worked on FULL_GRAPH and VISIBLE_STATE.

import { isThemeLineEdge } from './graphAnalysis.js';
import { toFiniteNumber } from './graphSearch.js';

export const ALERT_RULES_KEY = 'linkx_alert_rules_v1';

// Production skips the automatic scan above these visible counts (GA:4962).
export const ALERT_AUTO_SCAN_LIMITS = Object.freeze({ nodes: 5000, edges: 25000 });
export const ALERT_SCAN_DELAY_MS = 180;

export const DEFAULT_ALERT_RULES = Object.freeze({
  enableHighDegree: true,
  highDegreeMin: 3,
  highSeverityDegree: 8,
  maxHighDegreeAlerts: 5,
  enableHeavyEdge: true,
  heavyEdgePercentile: 95,
  heavyEdgeMinSamples: 4,
  maxHeavyEdgeAlerts: 5,
  heavyEdgeMinValue: 0,
});

// Allowed ranges (production normalizeAlertRulesConfig).
export const ALERT_RULE_FIELDS = Object.freeze([
  { name: 'enableHighDegree', label: 'High-degree rule', type: 'checkbox' },
  { name: 'highDegreeMin', label: 'Minimum degree to alert', type: 'number', integer: true, min: 1, max: 100000 },
  { name: 'highSeverityDegree', label: 'Degree for HIGH severity', type: 'number', integer: true, min: 1, max: 100000 },
  { name: 'maxHighDegreeAlerts', label: 'Most-connected nodes checked', type: 'number', integer: true, min: 1, max: 1000 },
  { name: 'enableHeavyEdge', label: 'Heavy-edge rule', type: 'checkbox' },
  { name: 'heavyEdgePercentile', label: 'Weight percentile', type: 'number', min: 50, max: 99.99, step: 0.01 },
  { name: 'heavyEdgeMinSamples', label: 'Minimum weighted edges', type: 'number', integer: true, min: 2, max: 100000 },
  { name: 'maxHeavyEdgeAlerts', label: 'Heaviest edges reported', type: 'number', integer: true, min: 1, max: 1000 },
  { name: 'heavyEdgeMinValue', label: 'Minimum edge weight', type: 'number', min: 0, max: Number.MAX_SAFE_INTEGER },
]);

// GA:1126 normalizeAlertRulesConfig: out-of-range values are clamped, values
// that are not numbers fall back to the default.
export const normalizeAlertRules = (config) => {
  const source = config && typeof config === 'object' ? config : {};
  const result = {};
  ALERT_RULE_FIELDS.forEach((field) => {
    const value = source[field.name];
    const fallback = DEFAULT_ALERT_RULES[field.name];
    if (field.type === 'checkbox') {
      if (value === true || value === false) result[field.name] = value;
      else if (value === 'true') result[field.name] = true;
      else if (value === 'false') result[field.name] = false;
      else result[field.name] = fallback;
      return;
    }
    const numeric = field.integer ? parseInt(value, 10) : Number(value);
    result[field.name] = Number.isFinite(numeric) ? Math.max(field.min, Math.min(field.max, numeric)) : fallback;
  });
  return result;
};

// GA:1590 getPercentile (linear interpolation over sorted values).
export const getPercentile = (sortedValues, percentile) => {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 1;
  const bounded = Math.max(0, Math.min(1, percentile));
  const index = (sortedValues.length - 1) * bounded;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
};

// GA:6221 getVisibleNeighborCount over production's adjacency (distinct
// neighbours across all edges, either direction; a self-loop counts itself).
const visibleNeighbourCount = (graph, id, visible) => {
  const neighbours = new Set();
  graph.forEachEdge(id, (key, attributes, source, target) => {
    neighbours.add(source === id ? target : source);
  });
  let count = 0;
  neighbours.forEach((neighbour) => {
    if (visible.has(neighbour)) count += 1;
  });
  return count;
};

// GA:4776 generateGraphAlerts.
// -> [{ type: 'high_degree', severity, nodeId, degree, message }
//     | { type: 'heavy_edge', severity, edgeId, value, message }]
export const generateGraphAlerts = (graph, { nodeIds = [], edgeIds = [] } = {}, config = DEFAULT_ALERT_RULES) => {
  const rules = normalizeAlertRules(config);
  const alerts = [];
  if (!nodeIds.length) return alerts;

  if (rules.enableHighDegree) {
    const visible = new Set(nodeIds);
    nodeIds
      .filter((id) => graph.hasNode(id))
      .map((nodeId) => ({ nodeId, degree: visibleNeighbourCount(graph, nodeId, visible) }))
      .sort((a, b) => b.degree - a.degree)
      .slice(0, rules.maxHighDegreeAlerts)
      .forEach(({ nodeId, degree }) => {
        if (degree < rules.highDegreeMin) return;
        alerts.push({
          type: 'high_degree',
          severity: degree >= rules.highSeverityDegree ? 'high' : 'medium',
          nodeId,
          degree,
          message: `Node ${nodeId} has degree ${degree}`,
        });
      });
  }

  if (rules.enableHeavyEdge) {
    const weighted = [];
    edgeIds.forEach((edgeId) => {
      if (!graph.hasEdge(edgeId)) return;
      const edge = graph.getEdgeAttributes(edgeId);
      if (isThemeLineEdge(edge)) return;
      const value = toFiniteNumber(edge.weight ?? edge.value ?? edge.width);
      if (value != null) weighted.push({ edgeId, value });
    });
    if (weighted.length >= rules.heavyEdgeMinSamples) {
      const sorted = weighted.slice().sort((a, b) => a.value - b.value);
      const threshold = getPercentile(sorted.map((item) => item.value), rules.heavyEdgePercentile / 100);
      sorted
        .filter((item) => item.value >= threshold && item.value >= rules.heavyEdgeMinValue)
        .slice(-rules.maxHeavyEdgeAlerts)
        .forEach(({ edgeId, value }) => {
          alerts.push({ type: 'heavy_edge', severity: 'medium', edgeId, value, message: `Edge ${edgeId} has high weight ${value}` });
        });
    }
  }
  return alerts;
};

/* ── Panel wording (GA:4595-4728) ───────────────────────────────────── */

// Visual / structural keys never used as a node's name in the panel.
const ALERT_NAME_EXCLUDE_KEYS = new Set([
  'size', 'x', 'y', 'vx', 'vy', 'rel_type', 'session_id', 'index', 'edges',
  'neighbors', 'colorBehavior', 'baseColor', 'borderColor', '__customized', 'color', 'shape', 'borderWidth',
  'borderWidthSelected', 'borderWidth1', 'image', 'imagePadding', 'iconPath',
  'title', 'font', 'group', 'level', 'mass', 'hidden', 'fixed', 'physics',
  'shapeProperties', 'widthConstraint', 'heightConstraint', 'margin', 'icon',
  'annotationType', 'note',
]);

const nodePropertyKeys = (node) => (
  node && typeof node === 'object' ? Object.keys(node).filter((key) => !ALERT_NAME_EXCLUDE_KEYS.has(key) && key !== 'id') : []
);
const cleanName = (value) => (value == null ? '' : String(value).split('\n')[0].trim());
const nodeOf = (graph, id) => (id != null && graph.hasNode(String(id)) ? graph.getNodeAttributes(String(id)) : null);

// GA:4631 resolveAlertNodeName: "<key> : <value>" from the chosen key, else
// the node's first property with a value.
export const alertNodeName = (graph, nodeId, nameKey = '') => {
  const node = nodeOf(graph, nodeId);
  if (!node) return String(nodeId);
  if (nameKey) {
    const picked = cleanName(node[nameKey]);
    if (picked) return `${nameKey} : ${picked}`;
  }
  return autoNodeName(node, nodeId);
};

const autoNodeName = (node, nodeId) => {
  for (const key of nodePropertyKeys(node)) {
    const candidate = cleanName(node[key]);
    if (candidate) return `${key} : ${candidate}`;
  }
  return cleanName(node.label) || String(nodeId);
};

const edgeEnds = (graph, edgeId) => (graph.hasEdge(edgeId) ? [graph.source(edgeId), graph.target(edgeId)] : []);

// The node an alert points at: the node itself, or a heavy edge's source.
export const alertFocusNode = (graph, alert) => {
  if (alert.nodeId != null) return String(alert.nodeId);
  return edgeEnds(graph, alert.edgeId)[0] ?? null;
};

// GA:4653 collectAlertPropertyKeys: every key seen on the alerted nodes.
export const alertPropertyKeys = (graph, alerts = []) => {
  const ordered = [];
  const seen = new Set();
  const add = (id) => nodePropertyKeys(nodeOf(graph, id)).forEach((key) => {
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(key);
    }
  });
  alerts.forEach((alert) => {
    if (alert.nodeId != null) add(alert.nodeId);
    else edgeEnds(graph, alert.edgeId).forEach(add);
  });
  return ordered;
};

// True when a chosen "Name by" key has no value on the alert's node, so its
// name fell back to Auto (production did this silently; the card says so).
export const alertNameMissing = (graph, alert, nameKey = '') => {
  if (!nameKey) return false;
  const node = nodeOf(graph, alertFocusNode(graph, alert));
  return Boolean(node) && !cleanName(node[nameKey]);
};

// GA:4689 describeGraphAlert -> { name, category, severity, detail, short }.
// `detail` is production's text; `short` is the one-line card text.
export const describeGraphAlert = (graph, alert, nameKey = '') => {
  const severity = alert.severity === 'high' ? 'high' : 'medium';
  if (alert.type === 'high_degree') {
    return {
      name: alertNodeName(graph, alert.nodeId, nameKey),
      category: 'Highly connected',
      severity,
      detail: alert.degree
        ? `Connected to ${alert.degree} other nodes — a hub that can signal structuring, layering, or a shared intermediary. Review its neighbours.`
        : 'An unusually well-connected hub worth reviewing.',
      short: alert.degree ? `Hub linked to ${alert.degree} nodes.` : 'Unusually well-connected hub.',
    };
  }
  if (alert.type === 'heavy_edge') {
    const from = edgeEnds(graph, alert.edgeId)[0];
    return {
      name: from != null ? alertNodeName(graph, from, nameKey) : 'High-value relationship',
      category: 'High-value link',
      severity,
      detail: alert.value != null
        ? `Carries an unusually high value (${alert.value}) versus the rest of the graph — a candidate for a significant or anomalous transfer.`
        : 'Carries an unusually high value versus the rest of the graph.',
      short: alert.value != null ? `Unusually high value: ${alert.value}.` : 'Unusually high value.',
    };
  }
  return { name: alert.message || 'Alert', category: 'Alert', severity, detail: '', short: '' };
};

// GA:4884 summary line.
export const alertSummary = (alerts = []) => {
  if (!alerts.length) return 'No alerts — graph looks clean.';
  const high = alerts.filter((alert) => alert.severity === 'high').length;
  const medium = alerts.length - high;
  const parts = [`${alerts.length} alert${alerts.length === 1 ? '' : 's'}`];
  if (high) parts.push(`${high} high`);
  if (medium) parts.push(`${medium} medium`);
  return parts.join(' · ');
};

// The window's graph alert configuration in words, for the report cover
// ("Graph alert"; analyst decision 2026-11-17).
export const describeAlertRules = (rules, enabled = true, raised = null) => {
  if (!enabled) return 'Graph alerts off';
  const config = normalizeAlertRules(rules);
  const parts = [];
  if (config.enableHighDegree) parts.push(`High-degree: ${config.highDegreeMin}+ links (high from ${config.highSeverityDegree})`);
  if (config.enableHeavyEdge) {
    const top = Math.round((100 - config.heavyEdgePercentile) * 100) / 100;
    parts.push(`Heavy-edge: top ${top}% of link weights${config.heavyEdgeMinValue > 0 ? `, at least ${config.heavyEdgeMinValue.toLocaleString('en-GB')}` : ''}`);
  }
  if (!parts.length) return 'No graph alert rule enabled';
  const count = raised == null ? '' : ` · ${raised} ${raised === 1 ? 'alert' : 'alerts'} raised`;
  return `${parts.join('; ')}${count}`;
};
