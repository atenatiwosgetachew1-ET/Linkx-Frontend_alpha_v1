import { createGraph, releaseGraph } from './cytoscapeInstance.js';

import { buildElements, buildStylesheet, edgeCurveFor } from './graphElements.js';
import { compareNodeValues, getNodeValue } from './graphModel.js';
import { nodeTypeOf } from './graphAnalysis.js';
import { GRAPH_LIMITS } from './graphSettings.js';
import { requestLayout } from './layoutClient.js';
import { readCanvasBackground, readGraphTheme } from './graphTheme.js';

// A graph snapshot drawn without a window (graph-chart-plan §3.6): an
// offscreen Cytoscape instance in a container out of sight, laid out by the
// Graph window's own layouts, captured and destroyed. Used by Reports ▸
// Download report.
//
// What is drawn (analyst decisions 2026-11-18, the report form's Graph
// options): the first `amount` entities by an order (most connected by
// default; arrival order; or a property, entities without it left out, as
// the Graph window's limit), laid out by one of the Graph window's layouts
// with its options, with the links among them; each entity labelled with
// the report's name for it.

export const ORDER_BY_DEGREE = '__degree';
// The layout options are the Graph window's (Settings ▸ Layout): layout,
// flow (hierarchical / layered), level order (hierarchical), layers by
// (layered) and group by (grouped), with their property.
export const SNAPSHOT_DEFAULTS = Object.freeze({
  order: ORDER_BY_DEGREE,
  direction: 'desc',
  layout: 'concentric',
  flow: 'UD',
  sortMethod: 'directed',
  layerMode: 'hop_distance',
  layerKey: '',
  amount: 250,
});
export const SNAPSHOT_MAX_NODES = GRAPH_LIMITS.CANVAS_HARD_CAP;
export const SNAPSHOT_LAYOUTS = Object.freeze([
  { id: 'concentric', label: 'Concentric' },
  { id: 'hierarchical', label: 'Hierarchical' },
  { id: 'layered', label: 'Layered' },
  { id: 'circle', label: 'Circle' },
  { id: 'star', label: 'Star' },
  { id: 'radial', label: 'Radial' },
  { id: 'grid', label: 'Grid' },
  { id: 'spiral', label: 'Spiral' },
  { id: 'peacock', label: 'Peacock (hubs and their leaves)' },
  { id: 'grouped', label: 'Grouped (clusters by type or property)' },
]);
const LAYER_MODES = ['hop_distance', 'node_identity', 'by_key'];

const SNAPSHOT_VIEW_KEY = 'offscreen-snapshot';
const LAYOUT_OWNER = 'offscreen-snapshot';
const IMAGE_WAIT_MS = 3000;
// Links at least this wide in the image (px), so they print.
const EDGE_PRINT_PX = 2;

export const normalizeSnapshotOptions = (options = {}) => {
  const amount = Math.round(Number(options.amount));
  const layout = SNAPSHOT_LAYOUTS.some((entry) => entry.id === options.layout) ? options.layout : SNAPSHOT_DEFAULTS.layout;
  let layerMode = LAYER_MODES.includes(options.layerMode) ? options.layerMode : SNAPSHOT_DEFAULTS.layerMode;
  // Grouped groups by node type or a property (no distance).
  if (layout === 'grouped' && layerMode === 'hop_distance') layerMode = 'node_identity';
  return {
    order: typeof options.order === 'string' ? options.order : SNAPSHOT_DEFAULTS.order,
    direction: options.direction === 'asc' ? 'asc' : 'desc',
    layout,
    flow: options.flow === 'LR' ? 'LR' : 'UD',
    sortMethod: options.sortMethod === 'hubsize' ? 'hubsize' : 'directed',
    layerMode,
    layerKey: typeof options.layerKey === 'string' ? options.layerKey : '',
    amount: Number.isFinite(amount) && amount > 0 ? Math.min(amount, SNAPSHOT_MAX_NODES) : SNAPSHOT_DEFAULTS.amount,
  };
};

// The entities drawn and the links among them.
export const snapshotView = (graph, options = {}) => {
  const { order, direction, amount } = normalizeSnapshotOptions(options);
  let entries = graph.nodes().map((id, index) => ({ id, index }));
  if (order === ORDER_BY_DEGREE) {
    entries.forEach((entry) => { entry.value = graph.degree(entry.id); });
    entries.sort((a, b) => (direction === 'asc' ? a.value - b.value : b.value - a.value) || a.index - b.index);
  } else if (order) {
    entries = entries
      .map((entry) => ({ ...entry, value: getNodeValue(graph.getNodeAttributes(entry.id), order) }))
      .filter((entry) => entry.value != null && entry.value !== '');
    entries.sort((a, b) => compareNodeValues(a.value, b.value, direction) || a.index - b.index);
  }
  const nodeIds = entries.slice(0, amount).map((entry) => entry.id);
  const shown = new Set(nodeIds);
  const edgeIds = graph.edges().filter((key) => shown.has(graph.source(key)) && shown.has(graph.target(key)));
  return { nodeIds, edgeIds, searched: false, viewKey: SNAPSHOT_VIEW_KEY };
};

// The most connected nodes (kept for callers that want only that).
export const topNodesView = (graph, max = SNAPSHOT_DEFAULTS.amount) => snapshotView(graph, { order: ORDER_BY_DEGREE, direction: 'desc', amount: max });

// Positions from the Graph window's layouts (worker, or ELK for
// hierarchical; hierarchical needs fewer than 300 nodes, as on screen,
// else layered is used), with the same per-node information.
export const layoutRequestOf = (store, view, options) => {
  const graph = store.graph();
  let type = options.layout;
  if (type === 'hierarchical' && view.nodeIds.length >= GRAPH_LIMITS.PHYSICS_AUTO_OFF_AT) type = 'layered';
  const byKey = options.layerMode === 'by_key' && options.layerKey ? options.layerKey : '';
  const info = {};
  if (type === 'layered') {
    view.nodeIds.forEach((id) => {
      const node = store.getNode(id) || {};
      info[id] = { identity: node.node_identity, layerValue: byKey ? getNodeValue(node, byKey) : undefined };
    });
  } else if (type === 'grouped') {
    view.nodeIds.forEach((id) => {
      const node = store.getNode(id) || {};
      info[id] = { group: byKey ? getNodeValue(node, byKey) : nodeTypeOf(node) };
    });
  }
  return {
    type,
    edgePairs: view.edgeIds.map((key) => [graph.source(key), graph.target(key)]),
    options: { direction: options.flow, sortMethod: options.sortMethod, layerMode: options.layerMode, info },
  };
};
const layoutPositions = (store, view, options) => {
  const request = layoutRequestOf(store, view, options);
  return requestLayout(LAYOUT_OWNER, request.type, view.nodeIds, request.edgePairs, request.options);
};

// Waits for the node icons so the capture shows them (an icon that does
// not load in time is drawn without).
const preloadImages = (urls, timeout = IMAGE_WAIT_MS) => Promise.all(urls.map((url) => new Promise((resolve) => {
  const image = new Image();
  const done = () => resolve();
  const timer = setTimeout(done, timeout);
  image.onload = () => { clearTimeout(timer); done(); };
  image.onerror = () => { clearTimeout(timer); done(); };
  image.src = url;
})));

const nextFrames = () => new Promise((resolve) => {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(resolve, 50);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

// store: a graph store (lib/graphStore.js); options: SNAPSHOT_DEFAULTS'
// fields; nameOf(id): the label each entity is drawn with. Resolves to a JPEG data URL, or null when there is
// nothing to draw or drawing fails.
export const renderOffscreenSnapshot = async (store, { isCdr = false, host = document.body, maxSide = 2400, nameOf = null, ...options } = {}) => {
  const graph = store.graph();
  if (!graph.order || !host) return null;
  const normalized = normalizeSnapshotOptions(options);
  const view = snapshotView(graph, normalized);
  if (!view.nodeIds.length) return null;
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, { position: 'fixed', left: '-20000px', top: '0', width: '1600px', height: '1200px', pointerEvents: 'none' });
  host.appendChild(container);
  let cy = null;
  try {
    const theme = readGraphTheme(container);
    const positions = (await layoutPositions(store, view, normalized)) || {};
    const { nodes, edges } = buildElements(store, view, { showLabels: true, isCdr, iconMode: theme.mode });
    nodes.forEach((node) => {
      // Named as the report names entities (Identify entities by).
      if (nameOf) node.data.label = nameOf(node.data.id);
      const position = positions[node.data.id];
      if (position) node.position = { x: position.x, y: position.y };
    });
    await preloadImages([...new Set(nodes.map((node) => node.data.image).filter((url) => typeof url === 'string' && url))]);
    cy = createGraph({
      container,
      style: buildStylesheet(theme, { curve: edgeCurveFor(view.nodeIds.length), zoom: 1 }),
      elements: { nodes, edges },
      layout: { name: 'preset', fit: true, padding: 30 },
      motionBlur: false,
    });
    // The capture's scale: the whole drawing fitted into maxSide (at most
    // 2x). Node borders and links are widened for it, so they print.
    const box = cy.elements().boundingBox();
    const scale = Math.min(2, maxSide / Math.max(box.w || 1, box.h || 1, 1));
    cy.style(buildStylesheet(theme, { curve: edgeCurveFor(view.nodeIds.length), zoom: scale }));
    cy.style().selector('edge').style('width', (edge) => Math.max(edge.data('width') || 1, EDGE_PRINT_PX / scale)).update();
    await nextFrames();
    return cy.jpg({ output: 'base64uri', bg: readCanvasBackground(container), full: true, scale: 2, maxWidth: maxSide, maxHeight: maxSide, quality: 0.9 }) || null;
  } catch {
    return null;
  } finally {
    releaseGraph(cy);
    container.remove();
  }
};
