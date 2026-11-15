// Graph payload rules ported from production's graph iframe, as pure
// functions (docs/graph-chart-plan.md §2.2). References: graphs_basic.html (GB)
// and graphs_adjuster.js (GA) under the production public/temp_placeholders.

// GA:2767 normalizeGraphId: numeric strings become numbers, so "12" and 12 are
// the same node. Kept as strings here (graph keys), canonicalised the same way.
export const normalizeGraphId = (rawId) => {
  if (rawId == null) return null;
  if (typeof rawId === 'number') return Number.isFinite(rawId) ? String(rawId) : null;
  const trimmed = String(rawId).trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && String(parsed) === trimmed ? String(parsed) : trimmed;
};

// Display-only keys hidden from a node's "Infos" (GA:6099 showNodeInfos).
export const INFO_HIDDEN_KEYS = new Set([
  'size', 'x', 'y', 'vx', 'vy', 'rel_type', 'session_id', 'index', 'edges', 'neighbors', 'colorBehavior', 'baseColor',
  'color', 'shape', 'borderWidth', 'borderWidthSelected', 'borderWidth1', 'image', 'imagePadding', 'iconPath', 'title',
]);

// Keys never offered for search / limit / label-by (GA:1706 getAllNodeKeys).
export const PROPERTY_KEY_HIDDEN = new Set([
  'size', 'x', 'y', 'vx', 'vy', 'index', 'edges', 'neighbors', 'color', 'shape', 'borderWidth', 'borderWidthSelected',
  'borderWidth1', 'image', 'imagePadding', 'iconPath', 'title', 'batch_id', 'input_file', 'label', 'nodes_label', 'colorBehavior',
]);

// GA:8301 getNodeValue: property lookup ignoring case.
export const getNodeValue = (node, key) => {
  if (typeof key !== 'string' || !key.trim() || !node) return null;
  const wanted = key.trim().toLowerCase();
  const actual = Object.keys(node).find((candidate) => candidate.toLowerCase() === wanted);
  return actual ? node[actual] : null;
};

// GA:5480 sort comparator: nulls last, numbers numerically, numeric strings
// numerically, otherwise natural (numeric-aware) string order.
export const compareNodeValues = (a, b, sort = 'asc') => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const sign = sort === 'desc' ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number') return sign * (a - b);
  const aNum = parseFloat(String(a));
  const bNum = parseFloat(String(b));
  if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return sign * (aNum - bNum);
  return sign * String(a).localeCompare(String(b), undefined, { numeric: true });
};

export const nodeInfoProperties = (node) => {
  const result = {};
  Object.entries(node || {}).forEach(([key, value]) => {
    if (INFO_HIDDEN_KEYS.has(key)) return;
    result[key] = key === 'label' && (value == null || String(value).trim() === '') ? '' : value;
  });
  return result;
};

/* ── Edge styling (GB:1726-1755 rule labels, GA:2899-2967 semantics) ─── */

const DIRECTIONLESS_RULES = new Set(['HUB_AND_SPOKE', 'SHARED_IDENTIFIER']);
const DIRECTED_RULES = new Set(['SMURFING', 'FUND_FLOW', 'RAPID_WITHDRAWAL']);
const FINANCIAL_FLOW_RULES = new Set(['CIRCULAR_FLOW']);

// Wording switches with the domain (CDR calls vs NBE transactions).
const SEMANTIC_TOOLTIPS = {
  node_flag: { cdr: 'Node flag — property of this call record', nbe: 'Node flag — property of this transaction' },
  observed_flow: { cdr: 'Observed call / communication session', nbe: 'Observed financial transfer' },
  temporal_sequence: { cdr: 'Time-ordered call sequence', nbe: 'Time-ordered sequence — arrow shows order, not money flow' },
  grouping: { cdr: 'Analytical grouping — shared tower / device', nbe: 'Analytical grouping — shared property (not a transfer)' },
};

// Returns renderer-neutral style for an edge payload:
// { arrow: bool, dashes: false | [dash, gap], width, color, semantic, tooltip }.
// Order as production: defaults, then rule-label styling, then semantic
// overrides (semantics win). `color` null means "theme default".
export const resolveEdgeStyle = (edge, { isCdr = false } = {}) => {
  const style = {
    arrow: true, // production network default: arrows "to"
    dashes: false,
    width: Number.isFinite(Number(edge?.weight)) && edge?.weight != null ? Number(edge.weight) : 1,
    color: typeof edge?.color === 'string' ? edge.color : (edge?.color?.color || null),
    semantic: null,
    tooltip: '',
  };
  const label = String(edge?.label || '');
  if (DIRECTIONLESS_RULES.has(label)) {
    style.dashes = [5, 5];
    style.arrow = false;
  } else if (DIRECTED_RULES.has(label)) {
    style.dashes = [5, 5];
  } else if (FINANCIAL_FLOW_RULES.has(label)) {
    style.dashes = false;
    style.width = 1.2;
    style.arrow = true;
  }

  const semantic = edge?.edge_semantic;
  const financialFlow = edge?.financial_flow;
  const directedDisplay = edge?.directed_display;
  if (semantic === undefined && financialFlow === undefined && directedDisplay === undefined) return style;
  const wording = isCdr ? 'cdr' : 'nbe';
  if (semantic === 'NODE_FLAG') {
    return { ...style, arrow: false, dashes: [2, 3], width: 0.5, color: '#f39c12', semantic: 'node_flag', tooltip: SEMANTIC_TOOLTIPS.node_flag[wording] };
  }
  if (financialFlow === true && directedDisplay === true) {
    return { ...style, arrow: true, dashes: false, width: 1.2, semantic: 'observed_flow', tooltip: SEMANTIC_TOOLTIPS.observed_flow[wording] };
  }
  if (financialFlow === false && directedDisplay === true) {
    return { ...style, arrow: true, dashes: [5, 5], width: 0.85, semantic: 'temporal_sequence', tooltip: SEMANTIC_TOOLTIPS.temporal_sequence[wording] };
  }
  if (financialFlow === false && directedDisplay === false) {
    return { ...style, arrow: false, dashes: [8, 4], width: 0.7, semantic: 'grouping', tooltip: SEMANTIC_TOOLTIPS.grouping[wording] };
  }
  return style;
};

/* ── Edge weights (GA:5977 weightEdges, ~1006 EdgeWeightToWidth) ───── */

const finiteNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value.trim().replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

// "Default": the edge's own width / weight / value, at least 1 (GA:1558).
export const defaultEdgeWidth = (edge) => Math.max(1, finiteNumber(edge?.width ?? edge?.weight ?? edge?.value) ?? 1);

// Weight from the endpoint nodes' integer values (GA:1578).
export const edgeWeightFromNodes = (edge, nodeValues) => {
  const source = nodeValues.get(edge.from);
  const target = nodeValues.get(edge.to);
  if (source != null && target != null) return Math.max(0, Math.round((source + target) / 2));
  if (source != null) return Math.max(0, source);
  if (target != null) return Math.max(0, target);
  return 1;
};

const percentile = (sorted, p) => {
  if (!sorted.length) return 1;
  const index = (sorted.length - 1) * Math.max(0, Math.min(1, p));
  const low = Math.floor(index);
  const high = Math.ceil(index);
  return low === high ? sorted[low] : sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};

// GA getAdaptiveWeightScale: 5th–95th percentile, log scale when the spread
// is more than 30×.
export const adaptiveWeightScale = (values) => {
  const sorted = (values || []).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!sorted.length) return { min: 1, max: 1, useLog: false };
  let min = percentile(sorted, 0.05);
  let max = percentile(sorted, 0.95);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    min = sorted[0];
    max = sorted[sorted.length - 1];
  }
  if (max <= min) return { min, max, useLog: false };
  return { min, max, useLog: (max + 1) / (Math.max(0, min) + 1) > 30 };
};

// Width 1–6 (GA:1006).
export const weightToWidth = (weight, scale) => {
  const min = Math.max(0, scale?.min ?? 0);
  const max = Math.max(min, scale?.max ?? min);
  if (max <= min) return 1;
  const clamped = Math.min(max, Math.max(min, weight));
  const normalized = scale.useLog
    ? (Math.log(clamped + 1) - Math.log(min + 1)) / (Math.log(max + 1) - Math.log(min + 1))
    : (clamped - min) / (max - min);
  return 1 + (Number.isFinite(normalized) ? normalized : 0) * 5;
};

// Widths for the visible edges in a weight mode: '' (as loaded: null, the
// edge style decides), 'default', or a node property key.
export const edgeWidthsFor = (edges, mode, getNode) => {
  if (!mode) return null;
  const widths = new Map();
  if (mode === 'default') {
    edges.forEach(([key, edge]) => widths.set(key, defaultEdgeWidth(edge)));
    return widths;
  }
  // Integer node values for the key (GA getNodeNumericValueMap), only for
  // the endpoints of the visible edges.
  const nodeValues = new Map();
  edges.forEach(([, edge]) => {
    [edge.from, edge.to].forEach((id) => {
      if (nodeValues.has(id)) return;
      const numeric = finiteNumber(getNodeValue(getNode(id) || {}, mode));
      if (numeric != null) nodeValues.set(id, Math.trunc(numeric));
      else nodeValues.set(id, undefined);
    });
  });
  nodeValues.forEach((value, id) => { if (value === undefined) nodeValues.delete(id); });
  const values = new Map(edges.map(([key, edge]) => [key, edgeWeightFromNodes(edge, nodeValues)]));
  const scale = adaptiveWeightScale([...values.values()]);
  values.forEach((weight, key) => widths.set(key, weightToWidth(weight, scale)));
  return widths;
};

/* ── Hover titles (GA applyTitleToggle ~5729, generateEdgeTitleSafely ~8682) */

const TITLE_KEEP = new Set(['node_identity', 'id', 'type', 'category', 'department', 'name', 'description']);
const TITLE_SKIP = new Set(['session_id', 'label', 'rel_type', 'x', 'y', 'vx', 'vy', 'index', 'edges', 'neighbors', 'color', 'shape', 'borderWidth', 'borderWidthSelected', 'image', 'iconPath', 'title', 'size', 'font', 'margin', 'shadow']);

export const nodeTitle = (node) => {
  if (!node) return '';
  const lines = [];
  if (node.label) lines.push(`Label: ${node.label}`);
  Object.entries(node)
    .filter(([key, value]) => value != null && (TITLE_KEEP.has(key) || !TITLE_SKIP.has(key)))
    .slice(0, 50)
    .forEach(([key, value]) => {
      if (key === 'node_identity') lines.push(`Identity: ${value}`);
      else if (typeof value === 'object') lines.push(`${key}: ${JSON.stringify(value).slice(0, 50)}...`);
      else lines.push(`${key}: ${value}`);
    });
  return lines.join('\n');
};

export const edgeTitle = (edge, fromNode, toNode, { isCdr = false, semanticTooltip = '' } = {}) => {
  if (!edge) return '';
  const weight = finiteNumber(edge.weight ?? edge.value ?? edge.width ?? 1);
  let text = `From: ${fromNode?.label ?? edge.from}\nTo: ${toNode?.label ?? edge.to}\nWeight: ${weight == null ? 1 : weight}`;
  if (semanticTooltip) text += `\n\n${semanticTooltip}`;
  if (edge.reason) text += `\nReason: ${edge.reason}`;
  if (edge.hub_account) text += `\n${isCdr ? 'Hub Contact / MSISDN' : 'Hub Account'}: ${edge.hub_account}`;
  return text;
};
