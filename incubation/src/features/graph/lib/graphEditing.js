// Node and edge adjust boxes (G3.2), ported from production:
// graphs_basic.html GB:1010-1105 (the boxes), GB:2548-2905 (their
// listeners) and graphs_adjuster.js GA:1807-2140, GA:2474-2495 (the
// update functions). Pure: each returns attribute patches for the store.

/* ── Colours (GA:1807 brightenColor, GA:1828 darkenColor) ───────────── */

const channels = (hex) => {
  const value = String(hex || '').replace(/^#/, '');
  return [0, 2, 4].map((at) => parseInt(value.substring(at, at + 2), 16));
};
const toHex = (values) => `#${values.map((v) => (`0${Math.round(v).toString(16)}`).slice(-2)).join('')}`;

export const brightenColor = (hex, percent) => toHex(channels(hex).map((v) => Math.max(0, Math.min(255, v + (255 - v) * (percent / 100)))));
export const darkenColor = (hex, percent) => toHex(channels(hex).map((v) => Math.max(0, Math.min(255, (v * (100 - percent)) / 100))));

const normalizeHex = (hex) => (String(hex).startsWith('#') ? String(hex) : `#${hex}`);

// GA:2043 buildNodeColor
export const buildNodeColor = (baseColor, { borderShift = 20, hoverShift = 12, highlightShift = 18, focusShift = 25 } = {}) => {
  const base = normalizeHex(baseColor);
  return {
    background: base,
    border: darkenColor(base, borderShift),
    hover: { background: brightenColor(base, hoverShift), border: darkenColor(base, borderShift) },
    highlight: { background: brightenColor(base, highlightShift), border: darkenColor(base, borderShift) },
    focus: { background: brightenColor(base, focusShift), border: darkenColor(base, borderShift + 5) },
  };
};

// The box's swatches and sizes (GB:1033-1048).
export const COLOR_SWATCHES = ['#DC143C', '#00BFFF', '#32CD32', '#DAA520', '#7851A9', '#FF4500', '#40E0D0'];
export const NODE_SIZES = [5, 10, 15, 20, 25, 30];
export const NODE_SHAPES = [
  { value: 'dot', label: 'Circle' },
  { value: 'box', label: 'Rectangle' },
  { value: 'diamond', label: 'Diamond' },
];
export const COLOR_BEHAVIORS = [
  { value: 'individual', label: 'Individual' },
  { value: 'link', label: 'Link' },
];
export const EDGE_STYLES = [
  { value: 'solid', label: '—— Solid ——', dashes: false },
  { value: 'dashed', label: '- - - Dashed - - -', dashes: [10, 6] },
  { value: 'dotted', label: '····· Dotted ·····', dashes: [2, 6] },
  { value: 'dashdot', label: '-·-·- Dashdot -·-·-', dashes: [10, 4, 2, 4] },
];
export const EDGE_WIDTH_RANGE = { min: 1, max: 6 };

// Production's icon album (GB:2830 svgFiles); "Upload" opens a file picker.
export const ICON_ALBUM = ['Agent', 'Airplane', 'Alarm', 'Bank Account', 'Bank', 'Bell', 'Bicycle', 'Bluetooth', 'Boat', 'Boat 1', 'Bulb', 'Calendar', 'Camera', 'Car', 'Car 1', 'Cart', 'Clock', 'Cloud lightning', 'Cloud lightning 1', 'Comment', 'Compass', 'Computer', 'Cross', 'Database', 'David star', 'Document', 'Document 1', 'Documents', 'Documents 1', 'Drone', 'Equalizer', 'Flag', 'Flag 1', 'Flag 2', 'Flag 3', 'Flag 4', 'Flag 5', 'Flight', 'Flight 1', 'Follower', 'Forward', 'Gas', 'Gear', 'Globe', 'Heart', 'Heart 1', 'Help', 'Help 1', 'Home', 'Hospital', 'Lamp', 'Lamp 1', 'Lightning', 'Lightning 1', 'Location', 'Lock', 'Mail', 'Map', 'Map 1', 'Mask', 'Message', 'Mic', 'Mobile', 'Money', 'Moon and Star', 'Motel', 'Motorcycle', 'Music', 'Office', 'Park', 'Person', 'Person Male', 'Person Male 1', 'Person Female', 'Person Female 1', 'Phone', 'Position Pin', 'Post', 'Power', 'Printer', 'Restaurant', 'Satellite', 'Server', 'Share', 'Shopping', 'Signal', 'Signal 1', 'Star', 'Star 1', 'Star 2', 'Sun', 'Sun 1', 'Support agent', 'Tag', 'Target', 'Target 1', 'Target 2', 'Thumbs up', 'Thumbs down', 'Traffic', 'Volume', 'Warning', 'Warning 1'];
// Production's stored path for an album icon.
export const albumIconPath = (name) => `../graph_icons/${name}.svg`;

/* ── Node patches ───────────────────────────────────────────────────── */

// The box's fields for a node (GB:2450-2470).
export const nodeBoxValues = (node = {}) => ({
  label: node.label == null ? '' : String(node.label),
  note: node.note == null ? '' : String(node.note),
  color: node.color?.background && /^#[0-9a-f]{6}$/i.test(node.color.background) ? node.color.background : '#000000',
  shape: { dot: 'dot', circularImage: 'dot', box: 'box', diamond: 'diamond' }[node.shape] || 'dot',
  colorBehavior: node.colorBehavior || 'individual',
  icon: String(node.iconPath || '').trim() || String(node.image || '').trim(),
});

// GA:2076 updateNodeColor: the nodes, plus the neighbours of those whose
// colour behaviour is "link"; the edges among the affected nodes take the
// colour too. `neighbours(id)` / `edges` cover the drawn view (production
// read edgesData, the drawn edges).
// -> { nodes: [[id, patch]], edges: [[key, patch]] }
export const nodeColorPatches = (ids, baseColor, { behaviorOf, neighbours, edges }) => {
  const color = buildNodeColor(baseColor);
  const affected = new Set();
  ids.forEach((id) => {
    affected.add(id);
    if (String(behaviorOf(id) || 'individual').toLowerCase() === 'link') neighbours(id).forEach((other) => affected.add(other));
  });
  const edgeColor = { color: color.background, hover: brightenColor(color.background, 15), highlight: brightenColor(color.background, 25) };
  return {
    nodes: [...affected].map((id) => [id, { color, baseColor }]),
    edges: edges.filter(([, from, to]) => affected.has(from) && affected.has(to))
      .map(([key]) => [key, { color: edgeColor, __edits: { color: color.background } }]),
  };
};

// GA:1873 UpdateNodeShape: a circle keeps a node's icon (circularImage).
export const nodeShapePatch = (node = {}, shape) => {
  const iconPath = node.iconPath || null;
  const next = shape === 'dot' && iconPath ? 'circularImage' : shape;
  return {
    shape: next,
    size: node.size ?? 15,
    ...(next === 'circularImage' && iconPath ? { image: iconPath, imagePadding: 10 } : {}),
    iconPath,
  };
};

// GA:2474 applyNodeIcon (album path or uploaded data URL).
export const nodeIconPatch = (iconPath) => ({ shape: 'circularImage', image: iconPath, imagePadding: 10, iconPath });

/* ── Edge patches (GA:1854, 1918, 1968, 2012) ────────────────────────── */

// The box's fields for an edge (GB:2508-2515).
export const edgeBoxValues = (edge = {}) => {
  const color = edge.color?.color || (typeof edge.color === 'string' ? edge.color : '');
  return {
    label: edge.label == null ? '' : String(edge.label),
    color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#000000',
    style: edge.edgeStyle || 'solid',
    width: Number(edge.width) || 1,
  };
};

// Edits are kept twice: under production's keys (exports read them) and in
// `__edits`, which the renderer applies over the semantic styling, as
// production's MODIFIED_EDGES layer won over the loaded edge.
const withEdits = (edge, patch, edits) => ({ ...patch, __edits: { ...(edge?.__edits || {}), ...edits } });

export const edgeColorPatch = (edge, baseColor) => withEdits(edge, {
  color: { color: baseColor, highlight: baseColor, hover: baseColor, inherit: false },
  baseColor,
}, { color: baseColor });

export const edgeStylePatch = (edge, style) => {
  const found = EDGE_STYLES.find((entry) => entry.value === style);
  if (!found) return null;
  return withEdits(edge, { dashes: found.dashes, edgeStyle: style }, { dashes: found.dashes });
};

export const clampEdgeWidth = (width) => Math.max(EDGE_WIDTH_RANGE.min, Math.min(Number(width) || 1, EDGE_WIDTH_RANGE.max));
export const edgeWidthPatch = (edge, width) => {
  const safe = clampEdgeWidth(width);
  return withEdits(edge, { width: safe }, { width: safe });
};
