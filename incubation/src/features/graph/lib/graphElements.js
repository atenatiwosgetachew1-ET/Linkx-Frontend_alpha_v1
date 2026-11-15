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

// vis-network shapes -> Cytoscape shapes.
const SHAPES = {
  dot: 'ellipse', circle: 'ellipse', ellipse: 'ellipse', text: 'ellipse', icon: 'ellipse',
  image: 'ellipse', circularImage: 'ellipse',
  box: 'round-rectangle', square: 'rectangle', database: 'barrel',
  diamond: 'diamond', triangle: 'triangle', triangleDown: 'vee', star: 'star', hexagon: 'hexagon',
};
const DEFAULT_SIZE = 15; // vis radius

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
  return { fill: color.background || null, border: color.border || color.background || null };
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
  const diameter = (Number.isFinite(size) && size > 0 ? size : DEFAULT_SIZE) * 2;
  const padding = Number.isFinite(Number(node?.imagePadding)) ? Number(node.imagePadding) : DEFAULT_IMAGE_PADDING;
  const imageOnly = node?.shape === 'image';
  const label = labelFor(node, labels);
  return {
    group: 'nodes',
    data: {
      id,
      label: showLabels ? label : '',
      shape: SHAPES[node?.shape] || 'ellipse',
      diameter,
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
  const color = style.semantic === 'node_flag' ? style.color : (isDefaultEdgeColor(edge?.color) ? null : style.color);
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
export const buildElements = (store, view, { showLabels = false, labels = {}, isCdr = false, iconMode = 'light', edgeWeight = '', showTitles = false } = {}) => {
  const markers = store.getMarkers?.(view.viewKey);
  const nodes = view.nodeIds.map((id) => {
    const node = store.getNode(id);
    const element = toCyNode(id, node, { showLabels, labels, iconMode });
    if (showTitles) element.data.title = nodeTitle(node);
    const marker = markerFor(markers, 'nodes', id);
    if (marker) element.data.marker = marker;
    const position = store.getPosition(id);
    return position ? { ...element, position } : element;
  });
  const edgeEntries = view.edgeIds.map((key) => [key, store.getEdge(key)]);
  const widths = edgeWidthsFor(edgeEntries, edgeWeight, (id) => store.getNode(id));
  const edges = edgeEntries.map(([key, edge]) => {
    const element = toCyEdge(key, edge, {
      isCdr,
      width: widths ? widths.get(key) : null,
      title: showTitles
        ? edgeTitle(edge, store.getNode(edge.from), store.getNode(edge.to), { isCdr, semanticTooltip: resolveEdgeStyle(edge, { isCdr }).tooltip })
        : '',
    });
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
  { selector: 'edge:selected', style: { 'line-color': theme.selected, 'target-arrow-color': theme.selected } },
  ];
};
