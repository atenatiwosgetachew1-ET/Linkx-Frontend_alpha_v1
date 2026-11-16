// Production graph payload (vis-network shaped) -> Cytoscape elements and
// stylesheet. Pure, so it is unit-tested without a browser.
//
// Production defaults (graphs_basic.html ~1433-1650): nodes are "dot" radius
// 15 with a transparent fill and a #555 border (dark #3e5775), labels #111
// (dark #8fa4bd); edges black (dark #485360) with an arrow at the target.
// "Default-looking" colours from the backend (white / transparent / the
// default greys) follow the theme, as production rewrites them in dark mode;
// real colours are kept. Theme colours come from --graph-* tokens.

import { edgeTitle, edgeWidthsFor, nodeTitle, resolveEdgeStyle } from './graphModel.js';
import { GRAPH_LIMITS } from './graphSettings.js';
import { iconForTheme, resolveIconUrl } from './graphIcons.js';
import { keepsLabel } from './graphAnnotations.js';
import { glyphImage, glyphLayout, nodeGlyphs } from './graphGlyphs.js';

// vis-network shapes -> Cytoscape shapes.
const SHAPES = {
  dot: 'ellipse', circle: 'ellipse', ellipse: 'ellipse', text: 'ellipse', icon: 'ellipse',
  image: 'ellipse', circularImage: 'ellipse',
  box: 'round-rectangle', square: 'rectangle', database: 'barrel',
  diamond: 'diamond', triangle: 'triangle', triangleDown: 'vee', star: 'star', hexagon: 'hexagon',
};
const DEFAULT_SIZE = 15; // vis radius
const DEFAULT_IMAGE_SIZE = 25; // vis image nodes
const DEFAULT_FONT_SIZE = 16;

// vis "box" nodes hold their label, sized to it with `margin` around; the
// text is measured approximately (no canvas here).
const boxSizeFor = (label, fontSize, margin) => {
  const lines = String(label).split('\n');
  const longest = Math.max(...lines.map((line) => line.length), 1);
  return {
    width: Math.round(longest * fontSize * 0.56 + 2 * margin),
    height: Math.round(lines.length * fontSize * 1.25 + 2 * margin),
  };
};

const token = (value) => String(value || '').replace(/\s+/g, '').toLowerCase();
const WHITE_LIKE = new Set(['#fff', '#ffffff', 'rgb(255,255,255)', 'rgba(255,255,255,1)', 'white']);
const BLACK_LIKE = new Set(['#000', '#000000', 'rgb(0,0,0)', 'rgba(0,0,0,1)', 'black']);
const TRANSPARENT = new Set(['transparent', 'rgba(0,0,0,0)', 'rgba(0,0,0,0.0)']);
const DEFAULT_BORDERS = new Set(['', '#555', '#333', '#111', '#777', '#777777']);

// Production isLightDefaultNodeColor (GB ~1490).
export const isDefaultNodeColor = (color) => {
  if (!color) return true;
  if (typeof color === 'string') return WHITE_LIKE.has(token(color)) || TRANSPARENT.has(token(color));
  const background = token(color.background);
  const defaultBackground = !background || WHITE_LIKE.has(background) || TRANSPARENT.has(background);
  return defaultBackground && DEFAULT_BORDERS.has(token(color.border));
};

// Production isLightDefaultEdgeColor: unset or black-like.
export const isDefaultEdgeColor = (color) => {
  if (!color) return true;
  const value = typeof color === 'string' ? color : (color.color || '');
  return !value || BLACK_LIKE.has(token(value));
};

const nodeColors = (color) => {
  if (isDefaultNodeColor(color)) return { fill: null, border: null };
  if (typeof color === 'string') return { fill: color, border: color };
  // A clear fill with a border of its own (Customize ▸ border alone) keeps
  // the theme's fill.
  const clear = TRANSPARENT.has(token(color.background));
  return { fill: clear ? null : color.background || null, border: color.border || (clear ? null : color.background) || null };
};

// Production labelNodesWith (GA:8311): nodes whose node_identity is the chosen
// group ("Entity Node" when none) take their label from `byKey` (exact key).
const LABEL_IDENTITIES = ['Entity Node', 'Source Node', 'Target Node'];
export const labelFor = (node, { byKey = '', group = '' } = {}) => {
  if (byKey) {
    const identity = LABEL_IDENTITIES.includes(group) ? group : 'Entity Node';
    if (node?.node_identity === identity && node[byKey] != null) return String(node[byKey]);
  }
  return node?.label == null ? '' : String(node.label);
};

// vis-network draws a circularImage's icon inside the circle with
// `imagePadding` (production 10 px) on each side.
const DEFAULT_IMAGE_PADDING = 10;

// `showLabels` follows production's "Show labels" setting (off by default).
// `iconMode` 'dark' swaps built-in icons for their white version.
export const toCyNode = (id, node, { showLabels = false, labels = {}, iconMode = 'light' } = {}) => {
  const colors = nodeColors(node?.color);
  const iconUrl = resolveIconUrl(node?.image || node?.iconPath);
  const image = iconUrl ? iconForTheme(iconUrl, iconMode) : '';
  const size = Number(node?.size);
  const imageOnly = node?.shape === 'image';
  const diameter = (Number.isFinite(size) && size > 0 ? size : (imageOnly ? DEFAULT_IMAGE_SIZE : DEFAULT_SIZE)) * 2;
  const padding = Number.isFinite(Number(node?.imagePadding)) ? Number(node.imagePadding) : DEFAULT_IMAGE_PADDING;
  const label = labelFor(node, labels);
  // Production getNodeRenderLabel: annotations and text nodes keep theirs.
  const shownLabel = showLabels || keepsLabel(node) ? label : '';
  const font = node?.font && typeof node.font === 'object' ? node.font : {};
  const fontSize = Number(font.size) > 0 ? Number(font.size) : DEFAULT_FONT_SIZE;
  const textOnly = node?.shape === 'text';
  const boxed = node?.shape === 'box' && shownLabel !== '';
  const box = boxed ? boxSizeFor(shownLabel, fontSize, Number.isFinite(Number(node?.margin)) ? Number(node.margin) : 5) : null;
  const borderPx = Number(node?.borderWidth);
  return {
    group: 'nodes',
    data: {
      id,
      label: shownLabel,
      shape: SHAPES[node?.shape] || 'ellipse',
      diameter,
      ...(font.size ? { fontSize } : {}),
      ...(font.face ? { fontFamily: String(font.face) } : {}),
      ...(font.color ? { fontColor: String(font.color) } : {}),
      ...(textOnly ? { textOnly: 1 } : {}),
      ...(box ? { boxed: 1, boxWidth: box.width, boxHeight: box.height } : {}),
      ...(Number.isFinite(borderPx) && borderPx >= 0 && node?.annotationType ? { borderPx } : {}),
      ...(colors.fill ? { fill: colors.fill } : {}),
      ...(colors.border ? { border: colors.border } : {}),
      ...(image ? {
        image,
        // Icon size inside the node: production padding, never below 30 %.
        imageSize: imageOnly ? '100%' : `${Math.round(Math.max(0.3, (diameter - 2 * padding) / diameter) * 100)}%`,
        ...(imageOnly ? { imageOnly: 1 } : {}),
      } : {}),
    },
  };
};

const DASH_STYLE = (dashes) => {
  if (!dashes) return 'solid';
  return dashes[0] <= 2 ? 'dotted' : 'dashed';
};

export const toCyEdge = (key, edge, { isCdr = false, width = null, title = '' } = {}) => {
  const style = resolveEdgeStyle(edge, { isCdr });
  if (width != null) style.width = width;
  let color = style.semantic === 'node_flag' ? style.color : (isDefaultEdgeColor(edge?.color) ? null : style.color);
  // Edits from the edge adjust box win (production MODIFIED_EDGES).
  const edits = edge?.__edits;
  if (edits) {
    if (edits.width != null) style.width = Number(edits.width);
    if (edits.dashes !== undefined) style.dashes = edits.dashes;
    if (edits.color) color = edits.color;
    if (edits.arrow === false) style.arrow = false;
  }
  // Production drew edge labels (vis font size 10).
  const label = edge?.label == null ? '' : String(edge.label);
  return {
    group: 'edges',
    data: {
      id: key,
      source: edge.from,
      target: edge.to,
      width: Math.max(0.5, Math.min(12, style.width)),
      lineStyle: DASH_STYLE(style.dashes),
      dashPattern: style.dashes || [6, 3],
      arrow: style.arrow ? 'triangle' : 'none',
      ...(color ? { color } : {}),
      ...(title ? { title } : {}),
      ...(label ? { label } : {}),
      ...(edits?.curve ? { curve: Number(edits.curve) } : {}),
      ...(style.semantic ? { semantic: style.semantic } : {}),
    },
  };
};

// Production marker overlays (GA:2642 applyNodeStateDecorations, GA:2682
// applyEdgeStateDecorations), first match wins. Node border widths are
// on-screen pixels (see zoomedWidths); `glow` is vis's coloured shadow.
export const MARKER_STYLES = {
  path: { border: '#f97316', borderPx: 3.5, glow: 'rgb(249,115,22)', edge: '#f97316', edgeWidth: 3.4 },
  traversal: { fill: '#dc2626', border: '#7e22ce', borderPx: 3.6, glow: 'rgb(126,34,206)', edge: '#dc2626', edgeWidth: 3.6 },
  alert: { border: '#dc2626', borderPx: 3.2, glow: 'rgb(220,38,38)', edge: '#dc2626', edgeWidth: 3.1 },
  pinned: { border: '#f59e0b', borderPx: 3.2, glow: 'rgb(245,158,11)', edge: '#f59e0b', edgeWidth: 3.1 },
};
const MARKER_ORDER = ['path', 'traversal', 'alert', 'pinned'];
export const markerFor = (markers, group, id) => {
  if (!markers) return null;
  return MARKER_ORDER.find((kind) => markers[kind]?.[group]?.has(id)) || null;
};

// The visible view -> Cytoscape elements (positions from the store).
// `edgeWeight`: production weight mode ('' as loaded, 'default', key).
// `showTitles`: hover titles (production "Show titles").
// Production applyEdgeBundlingLite (GA:4461): parallel edges between the
// same two nodes (either direction; theme lines apart) are drawn as one,
// once there are `min` or more: the first by id, labelled "<label> xN",
// width 1 + log2(N + 1) within 1.5-6, grey #4b5563; the others are hidden.
// -> Map(primary key -> { label, width, color }) and the hidden keys
export const bundleEdges = (entries, min = 2) => {
  const groups = new Map();
  entries.forEach(([key, edge]) => {
    const [a, b] = [String(edge.from), String(edge.to)];
    const pair = a <= b ? `${a}<->${b}` : `${b}<->${a}`;
    const group = `${String(edge?.edge_kind || '').toLowerCase() === 'theme_line' ? 'theme' : 'pair'}::${pair}`;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push([key, edge]);
  });
  const primary = new Map();
  const hidden = new Set();
  const threshold = Math.max(2, parseInt(min, 10) || 2);
  groups.forEach((members) => {
    if (members.length < threshold) return;
    members.sort(([ka, a], [kb, b]) => String(a.id ?? ka).localeCompare(String(b.id ?? kb), undefined, { numeric: true }));
    const [[firstKey, first], ...rest] = members;
    primary.set(firstKey, {
      label: `${first.label || 'link'} x${members.length}`,
      width: Math.max(1.5, Math.min(6, 1 + Math.log2(members.length + 1))),
      color: '#4b5563',
    });
    rest.forEach(([key]) => hidden.add(key));
  });
  return { primary, hidden };
};

export const buildElements = (store, view, {
  showLabels = false, labels = {}, isCdr = false, iconMode = 'light', edgeWeight = '', showTitles = false, edgeBundling = false, edgeBundleMin = 2,
  glyphColors = null,
} = {}) => {
  const markers = store.getMarkers?.(view.viewKey);
  // Node badges (G3.6): `glyphColors` { alert, pinned, flag, note, group,
  // merged } turns them on. Flagged: an end of a production NODE_FLAG edge.
  const flagged = new Set();
  if (glyphColors) {
    view.edgeIds.forEach((key) => {
      const edge = store.getEdge(key);
      if (edge?.edge_semantic === 'NODE_FLAG') {
        flagged.add(String(edge.from));
        flagged.add(String(edge.to));
      }
    });
  }
  const nodes = view.nodeIds.map((id) => {
    const node = store.getNode(id);
    const element = toCyNode(id, node, { showLabels, labels, iconMode });
    if (showTitles) element.data.title = nodeTitle(node);
    const marker = markerFor(markers, 'nodes', id);
    if (marker) element.data.marker = marker;
    if (glyphColors) {
      const kinds = nodeGlyphs(node, { alert: Boolean(markers?.alert?.nodes?.has(id)), pinned: Boolean(markers?.pinned?.nodes?.has(id)), flagged: flagged.has(id) });
      if (kinds.length) {
        element.data.glyphs = kinds.map((kind) => glyphImage(kind, glyphColors[kind] || '#64748b'));
        element.data.glyphKinds = kinds;
      }
    }
    const position = store.getPosition(id);
    return position ? { ...element, position } : element;
  });
  const edgeEntries = view.edgeIds.map((key) => [key, store.getEdge(key)]);
  const widths = edgeWidthsFor(edgeEntries, edgeWeight, (id) => store.getNode(id));
  const bundles = edgeBundling ? bundleEdges(edgeEntries, edgeBundleMin) : null;
  const edges = edgeEntries.filter(([key]) => !bundles?.hidden.has(key)).map(([key, edge]) => {
    const element = toCyEdge(key, edge, {
      isCdr,
      width: widths ? widths.get(key) : null,
      title: showTitles
        ? edgeTitle(edge, store.getNode(edge.from), store.getNode(edge.to), { isCdr, semanticTooltip: resolveEdgeStyle(edge, { isCdr }).tooltip })
        : '',
    });
    // Bundled after the weights and edits, before the markers (production
    // order in renderVisibleGraphBatch).
    const bundle = bundles?.primary.get(key);
    if (bundle) Object.assign(element.data, bundle, { bundled: 1 });
    // vis curvedCW: bowed by `roundness` of its length, clockwise.
    if (element.data.curve) {
      const a = store.getPosition(edge.from);
      const b = store.getPosition(edge.to);
      const length = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
      element.data.curveDistance = Math.round(element.data.curve * length) || 20;
    }
    const marker = markerFor(markers, 'edges', key);
    if (marker) {
      element.data.marker = marker;
      element.data.color = MARKER_STYLES[marker].edge;
      element.data.width = Math.max(element.data.width, MARKER_STYLES[marker].edgeWidth);
    }
    return element;
  });
  return { nodes, edges };
};

// Bezier edges keep parallel edges apart and draw arrows correctly; above
// the canvas comfort limit straight edges are used for speed (parallel edges
// then overlap, which only matters when zoomed in on large views).
export const edgeCurveFor = (visibleCount) => (visibleCount > GRAPH_LIMITS.CANVAS_FAST_ABOVE ? 'straight' : 'bezier');

// vis-network keeps node borders at a constant on-screen width
// (borderWidth / view.scale: 1.3 px, 2 px selected, never wider than the
// node) and edges at least 0.3 px on screen (max(width, 0.3 / scale)). That
// is why production nodes stay crisp black rings when zoomed out; widths
// here follow the current zoom the same way.
export const NODE_BORDER_PX = 1.3;
export const NODE_BORDER_SELECTED_PX = 2;
export const EDGE_MIN_PX = 0.3;
export const zoomedWidths = (zoom = 1) => {
  const scale = zoom > 0 ? zoom : 1;
  return {
    border: (ele) => Math.min(ele.data('diameter') || 30, NODE_BORDER_PX / scale),
    borderSelected: (ele) => Math.min(ele.data('diameter') || 30, NODE_BORDER_SELECTED_PX / scale),
    edge: (ele) => Math.max(ele.data('width') || 1, EDGE_MIN_PX / scale),
    marker: (ele) => Math.min(ele.data('diameter') || 30, (MARKER_STYLES[ele.data('marker')]?.borderPx || NODE_BORDER_PX) / scale),
  };
};

// `theme` holds resolved colours (see readGraphTheme in GraphCanvas).
export const buildStylesheet = (theme, { curve = 'bezier', zoom = 1 } = {}) => {
  const widths = zoomedWidths(zoom);
  // Node badge layers for the current zoom (the icon, if any, comes first).
  const badgeLayers = (ele, iconValue, badgeValue) => {
    const boxes = glyphLayout(ele.data('diameter') || 30, ele.data('glyphs').length, zoom);
    return [...(ele.data('image') ? [iconValue] : []), ...boxes.map(badgeValue)];
  };
  return [
  {
    // Core: no grey fills from Cytoscape's defaults (texture background,
    // press highlight, selection box) — theme colours instead.
    selector: 'core',
    style: {
      'outside-texture-bg-opacity': 0,
      'active-bg-color': theme.selected,
      'active-bg-opacity': 0.12,
      'active-bg-size': 24,
      'selection-box-color': theme.selected,
      'selection-box-opacity': 0.12,
      'selection-box-border-color': theme.selected,
      'selection-box-border-width': 1,
    },
  },
  {
    selector: 'node',
    style: {
      shape: 'data(shape)',
      width: 'data(diameter)',
      height: 'data(diameter)',
      'background-color': theme.nodeFill,
      'background-opacity': theme.nodeFillOpacity,
      'border-width': widths.border,
      'border-color': theme.nodeBorder,
      label: 'data(label)',
      color: theme.label,
      'font-size': 16,
      'text-valign': 'bottom',
      'text-margin-y': 5,
      'min-zoomed-font-size': 7,
    },
  },
  { selector: 'node[fill]', style: { 'background-color': 'data(fill)', 'background-opacity': 1 } },
  { selector: 'node[border]', style: { 'border-color': 'data(border)' } },
  {
    selector: 'node[image]',
    style: {
      'background-image': 'data(image)',
      'background-fit': 'none',
      'background-width': 'data(imageSize)',
      'background-height': 'data(imageSize)',
      'background-clip': 'node',
      'background-image-containment': 'inside',
    },
  },
  // vis "image" shape: the icon alone, no circle.
  { selector: 'node[imageOnly]', style: { 'background-opacity': 0, 'border-width': 0 } },
  // Node badges (G3.6): the icon (if any) as the first layer, then one
  // layer per badge, placed in the top-right corner, drawn over the edge.
  {
    selector: 'node[glyphs]',
    style: {
      'background-image': (ele) => [...(ele.data('image') ? [ele.data('image')] : []), ...ele.data('glyphs')],
      'background-fit': (ele) => badgeLayers(ele, 'none', () => 'none'),
      'background-width': (ele) => badgeLayers(ele, ele.data('imageSize'), (box) => `${box.size}px`),
      'background-height': (ele) => badgeLayers(ele, ele.data('imageSize'), (box) => `${box.size}px`),
      'background-position-x': (ele) => badgeLayers(ele, '50%', (box) => `${box.x}px`),
      'background-position-y': (ele) => badgeLayers(ele, '50%', (box) => `${box.y}px`),
      'background-clip': (ele) => badgeLayers(ele, 'node', () => 'none'),
      'background-image-containment': (ele) => badgeLayers(ele, 'inside', () => 'over'),
      'background-image-opacity': (ele) => badgeLayers(ele, 1, (box) => (box.visible ? 1 : 0)),
      'background-image-smoothing': (ele) => badgeLayers(ele, 'yes', () => 'yes'),
    },
  },
  // Node fonts (annotations: production font size / face / colour).
  { selector: 'node[fontSize]', style: { 'font-size': 'data(fontSize)' } },
  { selector: 'node[fontFamily]', style: { 'font-family': 'data(fontFamily)' } },
  { selector: 'node[fontColor]', style: { color: 'data(fontColor)' } },
  { selector: 'node[borderPx]', style: { 'border-width': (ele) => ele.data('borderPx') / (zoom > 0 ? zoom : 1) } },
  // vis "text": the label alone, at the node's place.
  {
    selector: 'node[textOnly]',
    style: { 'background-opacity': 0, 'border-width': 0, 'text-valign': 'center', 'text-margin-y': 0, width: 'data(fontSize)', height: 'data(fontSize)' },
  },
  // vis "box": the label inside, the box sized to it.
  {
    selector: 'node[boxed]',
    style: { width: 'data(boxWidth)', height: 'data(boxHeight)', 'text-valign': 'center', 'text-halign': 'center', 'text-margin-y': 0, 'text-wrap': 'wrap' },
  },
  {
    selector: 'edge',
    style: {
      'curve-style': curve,
      width: widths.edge,
      'line-color': theme.edge,
      'line-style': 'data(lineStyle)',
      'line-dash-pattern': 'data(dashPattern)',
      'target-arrow-shape': 'data(arrow)',
      'target-arrow-color': theme.edge,
      'arrow-scale': 0.8,
    },
  },
  { selector: 'edge[color]', style: { 'line-color': 'data(color)', 'target-arrow-color': 'data(color)' } },
  // Theme lines (vis smooth curvedCW).
  {
    selector: 'edge[curveDistance]',
    style: { 'curve-style': 'unbundled-bezier', 'control-point-distances': 'data(curveDistance)', 'control-point-weights': 0.5 },
  },
  // Edge labels: vis font size 10 along the edge's middle, not drawn below
  // 5 px on screen (vis drawThreshold). Thin and slightly faded, without
  // production's stroke, which drew heavy here (analyst decision 2026-11-15).
  {
    selector: 'edge[label]',
    style: {
      label: 'data(label)',
      'font-size': 10,
      'font-weight': 300,
      color: theme.label,
      'text-opacity': 0.8,
      'min-zoomed-font-size': 5,
    },
  },
  // Marker overlays (MARKER_STYLES); the glow stands in for vis's shadow.
  {
    selector: 'node[marker]',
    style: { 'border-width': widths.marker, 'underlay-opacity': 0.3, 'underlay-padding': 5, 'underlay-shape': 'ellipse' },
  },
  ...Object.entries(MARKER_STYLES).map(([kind, marker]) => ({
    selector: `node[marker = "${kind}"]`,
    style: {
      'border-color': marker.border,
      'underlay-color': marker.glow,
      ...(marker.fill ? { 'background-color': marker.fill, 'background-opacity': 1 } : {}),
    },
  })),
  { selector: 'node[marker][imageOnly]', style: { 'background-opacity': 0, 'border-width': 0 } },
  { selector: 'node:selected', style: { 'border-width': widths.borderSelected, 'border-color': theme.selected } },
  // A selected text label shows in the selection colour (it has no border).
  { selector: 'node[textOnly]:selected', style: { 'border-width': 0, color: theme.selected } },
  { selector: 'edge:selected', style: { 'line-color': theme.selected, 'target-arrow-color': theme.selected } },
  ];
};
