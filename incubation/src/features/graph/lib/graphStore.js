// One store per Graph window (docs/graph-chart-plan.md §3.1): the FULL graph
// in a graphology multigraph (production FULL_GRAPH), and the visible view
// computed from the limit settings (production VISIBLE_STATE / applyLimit).
// Lives outside React and workspace state, like the stream logs: switching
// docked tabs or remounting the window never refetches or re-lays out.
//
// Windows read it with useSyncExternalStore(store.subscribe, store.getSnapshot).

import { MultiDirectedGraph } from 'graphology';

import { compareNodeValues, getNodeValue, normalizeGraphId, PROPERTY_KEY_HIDDEN } from './graphModel.js';
import { normalizeLimitRange } from './graphSettings.js';
import { searchNodeIds } from './graphSearch.js';

export const MARKER_KINDS = ['path', 'traversal', 'alert', 'pinned'];
export const HIGHLIGHT_FLASH_MS = 1000;

// Production skips sorting above this many nodes (GA:5466).
const SORT_SKIP_ABOVE = 10000;
// Incident-edge path while the view is under 65 % of the graph (GA:5536).
const INDEXED_VIEW_SHARE = 0.65;

const endpointOf = (edge, ...keys) => {
  for (const key of keys) {
    if (edge?.[key] != null) return normalizeGraphId(edge[key]);
  }
  return null;
};

export const createGraphStore = () => {
  let graph = new MultiDirectedGraph({ allowSelfLoops: true });
  // Edges without a backend id get `${from}|${to}|${label}#n`, so parallel
  // edges stay distinct (production's `${from}_${to}` collapsed them) while a
  // chunk re-sending the same edge with an id is not duplicated.
  let anonymousEdgeCounts = new Map();
  let version = 0;
  // Loading status: { state: 'idle'|'loading'|'queued'|'ready'|'empty'|'error', message, source }
  let status = { state: 'idle', message: '', source: '' };
  // What the window currently shows (for the right panel's counts).
  let viewStats = { nodes: 0, edges: 0, searched: false };
  let snapshot = { version: 0, nodes: 0, edges: 0, danglingEdges: 0, selection: [], status, viewStats };
  // Laid-out positions (kept across remounts; a docked tab switch must not
  // re-run the layout) and the selected node ids (read by the right panel).
  let positions = new Map();
  let selection = [];
  let viewport = null; // { zoom, pan } of the last drawn view
  let layoutSignature = ''; // layout settings the stored positions came from
  // The running graph request: not tied to the window being mounted (a
  // docked tab switch must not cancel it); a new request or closing the
  // window aborts it.
  let fetchController = null;
  let danglingEdges = 0;
  let propertyKeysCache = null;
  // Production edits VISIBLE_STATE in place (expand / collapse neighbourhood,
  // double-click expand) and applyLimit rebuilds it from scratch. Here the
  // edits are kept against the view they were made on (`viewKey`: limit +
  // search) and dropped once that view changes, the same outcome.
  let visibility = { viewKey: '', added: [], removed: new Set() };
  // Production highlight overlays (GA:2711 getMarkerSets), by priority:
  // path > traversal > alert > pinned.
  const emptyMarkers = () => Object.fromEntries(MARKER_KINDS.map((kind) => [kind, { nodes: new Set(), edges: new Set() }]));
  let markers = emptyMarkers();
  // Original values of patched node attributes: id -> { key: value | undefined }.
  let originals = new Map();
  // The expand / collapse highlight is a flash: shown, then the elements go
  // back to their own style (analyst decision; production kept it).
  let flashTimer = null;
  // `persist` (Link Traversal) keeps it until Clear Path Highlight.
  const flashTraversal = (nodes, edges, viewKey, { persist = false } = {}) => {
    clearTimeout(flashTimer);
    flashTimer = null;
    markers.traversal = { nodes, edges, viewKey };
    if (persist) return;
    flashTimer = setTimeout(() => {
      flashTimer = null;
      markers.traversal = { nodes: new Set(), edges: new Set() };
      emit();
    }, HIGHLIGHT_FLASH_MS);
  };
  const listeners = new Set();

  const emit = () => {
    version += 1;
    propertyKeysCache = null;
    snapshot = { version, nodes: graph.order, edges: graph.size, danglingEdges, selection, status, viewStats };
    listeners.forEach((listener) => listener());
  };

  const edgeKeyFor = (edge, from, to) => {
    const backendId = normalizeGraphId(edge?.id);
    if (backendId != null) return `id:${backendId}`;
    const base = `${from}|${to}|${String(edge?.label ?? '')}`;
    const count = (anonymousEdgeCounts.get(base) || 0) + 1;
    anonymousEdgeCounts.set(base, count);
    return `${base}#${count}`;
  };

  // Adds one chunk (or a whole graph). Nodes merge by id (later attributes
  // win, as production's chunk update); edges whose ends are unknown are
  // counted, not drawn (vis-network ignored them too).
  const mergeChunk = ({ nodes = [], edges = [] } = {}) => {
    let added = 0;
    nodes.forEach((raw) => {
      const id = normalizeGraphId(raw?.id);
      if (id == null) return;
      const attributes = { ...raw, id };
      if (graph.hasNode(id)) graph.mergeNodeAttributes(id, attributes);
      else {
        graph.addNode(id, attributes);
        added += 1;
      }
    });
    edges.forEach((raw) => {
      const from = endpointOf(raw, 'from', 'source');
      const to = endpointOf(raw, 'to', 'target');
      if (from == null || to == null || !graph.hasNode(from) || !graph.hasNode(to)) {
        danglingEdges += 1;
        return;
      }
      const key = edgeKeyFor(raw, from, to);
      if (graph.hasEdge(key)) {
        graph.mergeEdgeAttributes(key, { ...raw, from, to });
        return;
      }
      graph.addEdgeWithKey(key, from, to, { ...raw, from, to });
      added += 1;
    });
    emit();
    return added;
  };

  const reset = () => {
    graph = new MultiDirectedGraph({ allowSelfLoops: true });
    anonymousEdgeCounts = new Map();
    danglingEdges = 0;
    positions = new Map();
    selection = [];
    viewport = null;
    layoutSignature = '';
    visibility = { viewKey: '', added: [], removed: new Set() };
    originals = new Map();
    clearTimeout(flashTimer);
    flashTimer = null;
    markers = emptyMarkers();
  };

  const clear = () => {
    reset();
    emit();
  };

  const replace = (payload) => {
    reset();
    return mergeChunk(payload);
  };

  // Positions only change the drawing, not the data: no version bump.
  const setPositions = (entries) => {
    entries.forEach(([id, position]) => positions.set(id, position));
  };

  const setViewStats = (next) => {
    if (next.nodes === viewStats.nodes && next.edges === viewStats.edges && next.searched === viewStats.searched) return;
    viewStats = { nodes: next.nodes, edges: next.edges, searched: Boolean(next.searched) };
    snapshot = { ...snapshot, viewStats };
    listeners.forEach((listener) => listener());
  };

  const setStatus = (next) => {
    status = { state: 'idle', message: '', source: '', ...next };
    snapshot = { ...snapshot, status };
    listeners.forEach((listener) => listener());
  };

  const setSelection = (ids) => {
    const next = [...new Set(ids)].filter((id) => graph.hasNode(id));
    if (next.length === selection.length && next.every((id, i) => id === selection[i])) return;
    selection = next;
    snapshot = { ...snapshot, selection };
    listeners.forEach((listener) => listener());
  };

  // Production applyLimit (GA:5435) + recomputeVisibleEdges (GA:5528).
  // Without a key (or above 10 000 nodes) nodes are taken in arrival order;
  // with a key they are sorted by it and nodes lacking it are left out, as in
  // production. Edges are visible when both ends are.
  const visibleView = ({ key = '', sort = 'asc', min = 0, max = 25 } = {}) => {
    const range = normalizeLimitRange({ min, max });
    const nodeIds = [];
    if (!key || graph.order > SORT_SKIP_ABOVE) {
      let index = 0;
      for (const id of graph.nodes()) {
        if (index >= range.max) break;
        if (index >= range.min) nodeIds.push(id);
        index += 1;
      }
    } else {
      const keyed = [];
      graph.forEachNode((id, attributes) => {
        const value = getNodeValue(attributes, key);
        if (value != null) keyed.push({ id, value });
      });
      keyed.sort((a, b) => compareNodeValues(a.value, b.value, sort));
      const end = Math.min(range.max, keyed.length);
      for (let i = range.min; i < end; i += 1) nodeIds.push(keyed[i].id);
    }

    return { nodeIds, ...edgesAmong(nodeIds) };
  };

  // Edges whose two ends are both visible (GA:5528 recomputeVisibleEdges).
  const edgesAmong = (nodeIds) => {
    const visible = new Set(nodeIds);
    const edgeIds = [];
    if (visible.size < graph.order * INDEXED_VIEW_SHARE) {
      const seen = new Set();
      visible.forEach((id) => {
        graph.forEachEdge(id, (edgeKey, attributes, source, target) => {
          if (seen.has(edgeKey)) return;
          seen.add(edgeKey);
          if (visible.has(source) && visible.has(target)) edgeIds.push(edgeKey);
        });
      });
    } else {
      graph.forEachEdge((edgeKey, attributes, source, target) => {
        if (visible.has(source) && visible.has(target)) edgeIds.push(edgeKey);
      });
    }
    return { edgeIds, totalNodes: graph.order, totalEdges: graph.size };
  };

  // Production graphSearch (graphSearch.js): the results replace the view.
  // An empty keyword is the normal limit view.
  const searchView = ({ keyword = '', includeLinked = false, keys = [], key = '', sort = 'asc', min = 0, max = 25 } = {}) => {
    if (!String(keyword || '').trim()) return { ...visibleView({ key, sort, min, max }), searched: false };
    const range = normalizeLimitRange({ min, max });
    const nodeIds = searchNodeIds({
      nodes: (function* iterate() {
        for (const id of graph.nodes()) yield [id, graph.getNodeAttributes(id)];
      }()),
      neighbours: (id) => graph.neighbors(id),
      keyword,
      includeLinked,
      keys,
      min: range.min,
      max: range.max,
    });
    return { nodeIds, ...edgesAmong(nodeIds), searched: true };
  };

  /* ── Expand / collapse (GA:3410, GA:3456, GA:5601) ─────────────────── */

  // The view with this window's expand / collapse edits applied.
  const applyVisibility = (base, viewKey) => {
    if (visibility.viewKey !== viewKey || (!visibility.added.length && !visibility.removed.size)) return { ...base, viewKey };
    const shown = new Set();
    const nodeIds = [];
    const show = (id) => {
      if (shown.has(id) || visibility.removed.has(id) || !graph.hasNode(id)) return;
      shown.add(id);
      nodeIds.push(id);
    };
    base.nodeIds.forEach(show);
    visibility.added.forEach(show);
    return { ...base, nodeIds, ...edgesAmong(nodeIds), viewKey, edited: true };
  };

  // Starts editing the given view; edits made on another view are dropped.
  const editVisibility = (viewKey) => {
    if (visibility.viewKey !== viewKey) visibility = { viewKey, added: [], removed: new Set() };
    return visibility;
  };
  const makeVisible = (edit, id, visible) => {
    edit.removed.delete(id);
    if (!visible.has(id)) {
      edit.added.push(id);
      visible.add(id);
    }
  };

  // Ids are graphology keys (strings), as in views and Cytoscape.
  // Production expandNeighborhoodFromSelection: the seeds and every node
  // within `depth` hops (both directions) become visible, and what was
  // traversed is highlighted. `cap` is the renderer's drawing limit
  // (production had none); returns { added, skipped }.
  const expandNeighbourhood = (seedIds, { viewKey, visibleIds = [], depth = 1, cap = Infinity, persist = false } = {}) => {
    const seeds = [...new Set(seedIds.map(String))].filter((id) => graph.hasNode(id));
    if (!seeds.length) return { added: 0, skipped: 0 };
    const edit = editVisibility(viewKey);
    const visible = new Set(visibleIds.map(String));
    const before = visible.size;
    let skipped = 0;
    const room = () => visible.size < cap;
    const traversedNodes = new Set();
    const traversedEdges = new Set();
    const visited = new Set(seeds);
    const queue = seeds.map((id) => ({ id, hops: 0 }));
    seeds.forEach((id) => {
      if (visible.has(id) || room()) {
        makeVisible(edit, id, visible);
        traversedNodes.add(id);
      } else skipped += 1;
    });
    while (queue.length) {
      const { id, hops } = queue.shift();
      if (hops >= depth) continue;
      graph.forEachEdge(id, (key, attributes, source, target) => {
        const other = source === id ? target : source;
        if (!visible.has(other)) {
          if (!room()) {
            skipped += 1;
            return;
          }
          makeVisible(edit, other, visible);
        }
        traversedNodes.add(other);
        traversedEdges.add(key);
        if (visited.has(other)) return;
        visited.add(other);
        queue.push({ id: other, hops: hops + 1 });
      });
    }
    flashTraversal(traversedNodes, traversedEdges, viewKey, { persist });
    emit();
    return { added: visible.size - before, skipped };
  };

  // Production collapseNeighborhoodFromSelection: hides the visible nodes
  // within `depth` hops of the anchors (never the anchors). Returns the count.
  const collapseNeighbourhood = (anchorIds, { viewKey, visibleIds = [], depth = 1 } = {}) => {
    const visible = new Set(visibleIds.map(String));
    const anchors = new Set(anchorIds.map(String).filter((id) => visible.has(id)));
    if (!anchors.size) return 0;
    const toHide = new Set();
    const visited = new Set(anchors);
    const queue = [...anchors].map((id) => ({ id, hops: 0 }));
    while (queue.length) {
      const { id, hops } = queue.shift();
      if (hops >= depth || !graph.hasNode(id)) continue;
      graph.forEachNeighbor(id, (other) => {
        if (!visible.has(other)) return;
        if (!visited.has(other)) {
          visited.add(other);
          queue.push({ id: other, hops: hops + 1 });
        }
        if (!anchors.has(other)) toHide.add(other);
      });
    }
    if (!toHide.size) return 0;
    const edit = editVisibility(viewKey);
    toHide.forEach((id) => {
      const index = edit.added.indexOf(id);
      if (index >= 0) edit.added.splice(index, 1);
      else edit.removed.add(id);
    });
    flashTraversal(new Set(anchors), new Set(), viewKey);
    emit();
    return toHide.size;
  };

  // Production expandNode (double-click): shows the first hidden neighbour,
  // even past the limit. Returns its id, or null when all are shown.
  const expandNode = (nodeId, { viewKey, visibleIds = [] } = {}) => {
    const id = String(nodeId);
    if (!graph.hasNode(id)) return null;
    const visible = new Set(visibleIds.map(String));
    const hidden = graph.neighbors(id).find((other) => !visible.has(other));
    if (hidden === undefined) return null;
    makeVisible(editVisibility(viewKey), hidden, visible);
    const edges = new Set();
    graph.forEachEdge(id, hidden, (key) => edges.add(key));
    graph.forEachEdge(hidden, id, (key) => edges.add(key));
    flashTraversal(new Set([hidden]), edges, viewKey);
    emit();
    return hidden;
  };

  // Makes nodes visible (a found path), up to `cap`. -> { added, skipped }
  const revealNodes = (ids, { viewKey, visibleIds = [], cap = Infinity } = {}) => {
    const visible = new Set(visibleIds.map(String));
    const before = visible.size;
    let skipped = 0;
    const edit = editVisibility(viewKey);
    [...new Set(ids.map(String))].forEach((id) => {
      if (!graph.hasNode(id) || visible.has(id)) return;
      if (visible.size >= cap) skipped += 1;
      else makeVisible(edit, id, visible);
    });
    if (visible.size !== before) emit();
    return { added: visible.size - before, skipped };
  };

  /* ── Node style patches (production MODIFIED_NODES / persistNodeChange) ─ */

  // Visualize by degree / property and communities change node attributes
  // (size, color, community_id) as production did. The original values are
  // kept so "Reset Node Styles" can restore them (until undo arrives, G2.4).
  const patchNodes = (entries) => {
    let changed = false;
    entries.forEach(([rawId, patch]) => {
      const id = String(rawId);
      if (!graph.hasNode(id)) return;
      const current = graph.getNodeAttributes(id);
      const saved = originals.get(id) || {};
      Object.keys(patch).forEach((key) => {
        if (!(key in saved)) saved[key] = key in current ? current[key] : undefined;
      });
      originals.set(id, saved);
      graph.mergeNodeAttributes(id, patch);
      changed = true;
    });
    if (changed) emit();
  };
  const restoreNodePatches = () => {
    if (!originals.size) return;
    originals.forEach((saved, id) => {
      if (!graph.hasNode(id)) return;
      Object.entries(saved).forEach(([key, value]) => {
        if (value === undefined) graph.removeNodeAttribute(id, key);
        else graph.setNodeAttribute(id, key, value);
      });
    });
    originals = new Map();
    emit();
  };

  // Highlight overlays: { nodes: Set, edges: Set } per kind.
  const setMarkers = (kind, next) => {
    if (!MARKER_KINDS.includes(kind)) return;
    markers[kind] = { nodes: new Set(next?.nodes || []), edges: new Set(next?.edges || []) };
    emit();
  };

  // Keys offered for search / limit / label-by (GA:1706 getAllNodeKeys).
  const propertyKeys = () => {
    if (propertyKeysCache) return propertyKeysCache;
    const keys = new Set();
    graph.forEachNode((id, attributes) => {
      Object.keys(attributes).forEach((key) => {
        if (!PROPERTY_KEY_HIDDEN.has(key)) keys.add(key);
      });
    });
    propertyKeysCache = [...keys];
    return propertyKeysCache;
  };

  return {
    mergeChunk,
    replace,
    clear,
    visibleView,
    searchView,
    applyVisibility,
    expandNeighbourhood,
    collapseNeighbourhood,
    expandNode,
    // With a view key, the traversal highlight only belongs to the view its
    // expansion was made on: it goes when the view resets (a deliberate
    // change from production, where it stayed until the next expand).
    revealNodes,
    patchNodes,
    restoreNodePatches,
    hasNodePatches: () => originals.size > 0,
    getMarkers: (viewKey) => (
      viewKey !== undefined && markers.traversal.viewKey !== undefined && markers.traversal.viewKey !== viewKey
        ? { ...markers, traversal: { nodes: new Set(), edges: new Set() } }
        : markers
    ),
    hasMarkers: (kind, viewKey) => {
      const current = (viewKey !== undefined && kind === 'traversal' && markers.traversal.viewKey !== viewKey) ? null : markers[kind];
      return Boolean(current && (current.nodes.size || current.edges.size));
    },
    stopTimers: () => {
      clearTimeout(flashTimer);
      flashTimer = null;
    },
    clearMarkers: (...kinds) => {
      const clearing = kinds.filter((kind) => markers[kind] && (markers[kind].nodes.size || markers[kind].edges.size));
      if (kinds.includes('traversal')) {
        clearTimeout(flashTimer);
        flashTimer = null;
      }
      if (!clearing.length) return;
      clearing.forEach((kind) => {
        markers[kind] = { nodes: new Set(), edges: new Set() };
      });
      emit();
    },
    setMarkers,
    propertyKeys,
    getPosition: (id) => positions.get(id) || null,
    getViewport: () => viewport,
    getLayoutSignature: () => layoutSignature,
    setLayoutSignature: (next) => { layoutSignature = next; },
    setViewport: (next) => { viewport = next; },
    setPositions,
    setSelection,
    setStatus,
    setViewStats,
    beginFetch: () => {
      fetchController?.abort();
      fetchController = new AbortController();
      return fetchController;
    },
    isCurrentFetch: (controller) => controller === fetchController,
    abortFetch: () => {
      fetchController?.abort();
      fetchController = null;
    },
    getStatus: () => status,
    // Plain { nodes, edges } (the backend shape), e.g. for the evidence cache.
    toPayload: () => ({
      nodes: graph.mapNodes((id, attributes) => ({ ...attributes })),
      edges: graph.mapEdges((key, attributes) => ({ ...attributes })),
    }),
    getNode: (id) => (graph.hasNode(id) ? graph.getNodeAttributes(id) : null),
    getEdge: (key) => (graph.hasEdge(key) ? graph.getEdgeAttributes(key) : null),
    // Read-only access for renderers, analytics and export.
    graph: () => graph,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
  };
};

/* ── One store per Graph window ─────────────────────────────────────── */

const stores = new Map();

export const getGraphStore = (windowId) => {
  const key = String(windowId);
  if (!stores.has(key)) stores.set(key, createGraphStore());
  return stores.get(key);
};

export const hasGraphStore = (windowId) => stores.has(String(windowId));

// Window closed.
export const disposeGraphStore = (windowId) => {
  stores.get(String(windowId))?.abortFetch();
  stores.get(String(windowId))?.stopTimers();
  stores.delete(String(windowId));
};

// Signed out: window ids are reused by the next workspace.
export const clearGraphStores = () => {
  stores.forEach((store) => {
    store.abortFetch();
    store.stopTimers();
  });
  stores.clear();
};
