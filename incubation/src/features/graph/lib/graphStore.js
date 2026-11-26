// One store per Graph window (docs/graph-chart-plan.md §3.1): the FULL graph
// in a graphology multigraph (production FULL_GRAPH), and the visible view
// computed from the limit settings (production VISIBLE_STATE / applyLimit).
// Lives outside React and workspace state, like the stream logs: switching
// docked tabs or remounting the window never refetches or re-lays out.
//
// Windows read it with useSyncExternalStore(store.subscribe, store.getSnapshot).

import { MultiDirectedGraph } from 'graphology';

import { getNodeValue, normalizeGraphId, PROPERTY_KEY_HIDDEN } from './graphModel.js';
import { normalizeLimitRange } from './graphSettings.js';
import { searchNodes } from './graphSearch.js';
import { sortByValue } from '../../../shared/numbers/values.js';
import { exportRunSettings, importRunSettings, mergeRunSettings } from '../../../shared/runSettings.js';

export const MARKER_KINDS = ['path', 'traversal', 'alert', 'pinned'];
export const HIGHLIGHT_FLASH_MS = 1000;
// Production GRAPH_HISTORY_MAX / GRAPH_HISTORY_SNAPSHOT_LIMIT (GA:1336).
export const HISTORY_MAX = 50;
export const HISTORY_ELEMENT_LIMIT = 4500;

const cloneDeep = (value) => {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
};

// Incident-edge path while the view is under 65 % of the graph (GA:5536).
const INDEXED_VIEW_SHARE = 0.65;

const endpointOf = (edge, ...keys) => {
  for (const key of keys) {
    if (edge?.[key] != null) return normalizeGraphId(edge[key]);
  }
  return null;
};

// What the window draws now, for the right panel: the nodes and edges shown,
// the search (matches: all of them, shown or not; viewKey: the limit and
// search these figures are for), and what else narrows the view.
export const EMPTY_VIEW_STATS = Object.freeze({ nodes: 0, edges: 0, searched: false, matches: 0, viewKey: '', hiddenTypes: '', hiddenNodes: 0, timeFiltered: false });

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
  let viewStats = { ...EMPTY_VIEW_STATS };
  let alertReport = null;
  // What the runs behind the data were made with (shared/runSettings.js).
  let runSettings = [];
  // dataVersion: bumped only when the graph's data changes, not for a
  // highlight (markers, the expand flash) nor for showing / hiding nodes
  // (reveal, expand, collapse, hide): what the Chart window measures (analyst
  // report 2026-11-18: a chart click revealing its entity recomputed every
  // chart).
  let dataVersion = 0;
  let snapshot = { version: 0, dataVersion: 0, nodes: 0, edges: 0, danglingEdges: 0, selection: [], status, viewStats, alertReport, runSettings, history: { canUndo: false, canRedo: false } };
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
  let pendingEdges = [];
  // The whole order of the last property sorted by (view changes re-slice it).
  let sorted = { key: '', sort: '', dataVersion: -1, ids: [] };
  let propertyKeysCache = null;
  // Production edits VISIBLE_STATE in place (expand / collapse neighbourhood,
  // double-click expand) and applyLimit rebuilds it from scratch. Here the
  // edits are kept against the view they were made on (`viewKey`: limit +
  // search) and dropped once that view changes, the same outcome.
  // `cap`: how many nodes the plain view could show when the edits began. The
  // plain view stays there while they stand, so a new drawing limit (GPU
  // turned on or off, a new benchmark) never loses or changes them.
  let drawingCap = Infinity;
  let visibility = { viewKey: '', added: [], removed: new Set(), cap: drawingCap };
  // Production highlight overlays (GA:2711 getMarkerSets), by priority:
  // path > traversal > alert > pinned.
  const emptyMarkers = () => Object.fromEntries(MARKER_KINDS.map((kind) => [kind, { nodes: new Set(), edges: new Set() }]));
  let markers = emptyMarkers();
  // Original values of patched node attributes: id -> { key: value | undefined }.
  let originals = new Map();
  // Undo / redo (production GRAPH_HISTORY, GA:1336-1556): whole-state
  // snapshots taken before each recorded action, 50 each way, off above
  // 4 500 nodes + edges. `context` is what the window keeps outside the
  // store (its settings), handed back on undo / redo.
  let history = { undo: [], redo: [] };
  // Window UI that must survive the body remounting (docked <-> floating,
  // docked tab switches): the overlay cards' state. Not data: no version
  // bump, kept across new data, gone with the store.
  const ui = new Map();
  const historyState = () => ({ canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
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
      emit({ dataChanged: false });
    }, HIGHLIGHT_FLASH_MS);
  };
  const listeners = new Set();

  // dataChanged: false for what changes only how the graph is shown (the
  // highlights, which nodes are visible), not its data.
  const emit = ({ dataChanged = true } = {}) => {
    version += 1;
    if (dataChanged) {
      dataVersion += 1;
      propertyKeysCache = null;
    }
    snapshot = { version, dataVersion, nodes: graph.order, edges: graph.size, danglingEdges, selection, status, viewStats, alertReport, runSettings, history: historyState() };
    listeners.forEach((listener) => listener());
  };

  const edgeKeyFor = (edge, from, to) => {
    const backendId = normalizeGraphId(edge?.id);
    if (backendId != null) {
      // The same id between other ends is another link.
      const key = `id:${backendId}`;
      if (!graph.hasEdge(key) || (graph.source(key) === from && graph.target(key) === to)) return key;
      return `${key}@${from}|${to}`;
    }
    const base = `${from}|${to}|${String(edge?.label ?? '')}`;
    const count = (anonymousEdgeCounts.get(base) || 0) + 1;
    anonymousEdgeCounts.set(base, count);
    return `${base}#${count}`;
  };

  // Adds one chunk (or a whole graph). Nodes merge by id (later attributes
  // win, as production's chunk update); edges whose ends are unknown wait for
  // them (a later chunk may bring them) and are counted meanwhile.
  const mergeChunk = ({ nodes = [], edges = [] } = {}) => {
    let added = 0;
    // Undoing to before this chunk would drop it.
    history = { undo: [], redo: [] };
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
    const waiting = added ? pendingEdges : [];
    if (added) pendingEdges = [];
    [...waiting, ...edges].forEach((raw) => {
      const from = endpointOf(raw, 'from', 'source');
      const to = endpointOf(raw, 'to', 'target');
      if (from == null || to == null || !graph.hasNode(from) || !graph.hasNode(to)) {
        pendingEdges.push(raw);
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
    danglingEdges = pendingEdges.length;
    emit();
    return added;
  };

  const reset = () => {
    // New data starts a new history (production resetGraphHistoryBuffer).
    history = { undo: [], redo: [] };
    runSettings = [];
    graph = new MultiDirectedGraph({ allowSelfLoops: true });
    anonymousEdgeCounts = new Map();
    danglingEdges = 0;
    pendingEdges = [];
    positions = new Map();
    selection = [];
    viewport = null;
    layoutSignature = '';
    visibility = { viewKey: '', added: [], removed: new Set(), cap: drawingCap };
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
    const stats = { ...EMPTY_VIEW_STATS, ...next, searched: Boolean(next.searched) };
    if (Object.keys(stats).every((key) => stats[key] === viewStats[key])) return;
    viewStats = stats;
    snapshot = { ...snapshot, viewStats };
    listeners.forEach((listener) => listener());
  };

  // The window's graph alerts in its own words (null: not scanned yet), for
  // the right panel: { summary, total, high }.
  const setAlertReport = (next) => {
    if (JSON.stringify(next) === JSON.stringify(alertReport)) return;
    alertReport = next;
    snapshot = { ...snapshot, alertReport };
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
  // Without a key nodes are taken in arrival order; with a key they are sorted
  // by it and nodes lacking it are left out, as in production (which ignored
  // the order above 10 000 nodes). Edges are visible when both ends are.
  const visibleView = ({ key = '', sort = 'asc', min = 0, max = 25 } = {}) => {
    const range = normalizeLimitRange({ min, max });
    const nodeIds = [];
    if (!key) {
      let index = 0;
      for (const id of graph.nodes()) {
        if (index >= range.max) break;
        if (index >= range.min) nodeIds.push(id);
        index += 1;
      }
    } else {
      if (sorted.key !== key || sorted.sort !== sort || sorted.dataVersion !== dataVersion || sorted.graph !== graph) {
        const keyed = [];
        graph.forEachNode((id, attributes) => {
          const value = getNodeValue(attributes, key);
          if (value != null) keyed.push({ id, value });
        });
        sorted = { key, sort, dataVersion, graph, ids: sortByValue(keyed, (entry) => entry.value, sort).map((entry) => entry.id) };
      }
      const end = Math.min(range.max, sorted.ids.length);
      for (let i = range.min; i < end; i += 1) nodeIds.push(sorted.ids[i]);
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
    const { ids: nodeIds, matches } = searchNodes({
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
    return { nodeIds, ...edgesAmong(nodeIds), searched: true, matches };
  };

  /* ── Expand / collapse (GA:3410, GA:3456, GA:5601) ─────────────────── */

  // The view with this window's expand / collapse edits applied.
  // `cap` below the one the edits were made under: plain nodes give way first.
  const applyVisibility = (base, viewKey, cap = Infinity) => {
    if (visibility.viewKey !== viewKey || (!visibility.added.length && !visibility.removed.size)) return { ...base, viewKey };
    const shown = new Set();
    const nodeIds = [];
    const show = (id) => {
      if (shown.has(id) || visibility.removed.has(id) || !graph.hasNode(id)) return;
      shown.add(id);
      nodeIds.push(id);
    };
    base.nodeIds.forEach(show);
    const plainCount = nodeIds.length;
    visibility.added.forEach(show);
    if (cap < visibility.cap && nodeIds.length > cap) {
      nodeIds.splice(Math.max(0, cap - (nodeIds.length - plainCount)), Math.min(plainCount, nodeIds.length - cap));
      nodeIds.length = Math.min(nodeIds.length, cap);
    }
    return { ...base, nodeIds, ...edgesAmong(nodeIds), viewKey, edited: true };
  };

  // Starts editing the given view; edits made on another view are dropped.
  const editVisibility = (viewKey) => {
    if (visibility.viewKey !== viewKey || (!visibility.added.length && !visibility.removed.size)) {
      visibility = { viewKey, added: [], removed: new Set(), cap: drawingCap };
    }
    return visibility;
  };
  // The cap the view's edits were made under; null without edits.
  const editedCap = (viewKey) => (
    visibility.viewKey === viewKey && (visibility.added.length || visibility.removed.size) ? visibility.cap : null
  );
  const setDrawingCap = (cap) => {
    drawingCap = cap;
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
    emit({ dataChanged: false });
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
    emit({ dataChanged: false });
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
    emit({ dataChanged: false });
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
    if (visible.size !== before) emit({ dataChanged: false });
    return { added: visible.size - before, skipped };
  };

  // Production loadSavedView: the view shows exactly `targetIds` (those in
  // the graph), recorded as edits of the plain view `baseIds` of `viewKey`.
  const restoreVisibility = (viewKey, baseIds = [], targetIds = [], { cap = drawingCap } = {}) => {
    const target = [...new Set(targetIds.map(String))].filter((id) => graph.hasNode(id));
    const wanted = new Set(target);
    const base = new Set(baseIds.map(String));
    visibility = {
      viewKey,
      added: target.filter((id) => !base.has(id)),
      removed: new Set([...base].filter((id) => !wanted.has(id))),
      cap,
    };
    emit({ dataChanged: false });
    return target.length;
  };

  /* ── Authoring (G3.1; production GA:2777-3310, GA:5859-5975) ───────── */

  // Production createUniqueNodeId / createUniqueEdgeId: `${prefix}_${now}`,
  // a random suffix while taken. Edge ids are backend-style ids (key `id:…`).
  const uniqueNodeId = (prefix = 'node') => {
    let candidate = `${prefix}_${Date.now()}`;
    while (graph.hasNode(candidate)) candidate = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return candidate;
  };
  const uniqueEdgeId = (prefix = 'edge') => {
    let candidate = `${prefix}_${Date.now()}`;
    while (graph.hasEdge(`id:${candidate}`)) candidate = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return candidate;
  };

  // Shown in the current view even past the limit (production added them to
  // VISIBLE_STATE and set limitOverridden; a new limit drops them from view
  // again, as production's applyLimit did).
  const showAuthored = (ids, viewKey, visibleIds) => {
    if (viewKey === undefined) return;
    const edit = editVisibility(viewKey);
    const visible = new Set((visibleIds || []).map(String));
    ids.forEach((id) => makeVisible(edit, id, visible));
  };

  // Production handleAddNode / createAnnotationNode. `node` holds the
  // attributes (id made here unless given); `position` is in graph
  // coordinates. -> the new id
  const addNode = (node, { position, viewKey, visibleIds, prefix = 'node' } = {}) => {
    const id = node?.id != null && !graph.hasNode(String(node.id)) ? String(node.id) : uniqueNodeId(prefix);
    const attributes = typeof node === 'function' ? node(id) : { ...node };
    graph.addNode(id, { ...attributes, id });
    if (position) positions.set(id, { x: position.x, y: position.y });
    showAuthored([id], viewKey, visibleIds);
    emit();
    return id;
  };

  // Production createGraphEdge (GA:2969): none between a node and itself.
  // -> the edge key, or null
  const addEdgeInternal = (from, to, patch = {}) => {
    const a = String(from);
    const b = String(to);
    if (a === b || !graph.hasNode(a) || !graph.hasNode(b)) return null;
    const id = patch.id != null ? String(patch.id) : uniqueEdgeId('edge');
    const key = `id:${id}`;
    if (graph.hasEdge(key)) return null;
    graph.addEdgeWithKey(key, a, b, { ...patch, id, from: a, to: b });
    return key;
  };
  const addEdge = (from, to, patch) => {
    const key = addEdgeInternal(from, to, patch);
    if (key) emit();
    return key;
  };

  // Drops removed ids from what the store keeps about them.
  const forgetNodes = (ids) => {
    ids.forEach((id) => {
      positions.delete(id);
      originals.delete(id);
      visibility.removed.delete(id);
    });
    const gone = new Set(ids);
    visibility.added = visibility.added.filter((id) => !gone.has(id));
    selection = selection.filter((id) => !gone.has(id));
    MARKER_KINDS.forEach((kind) => ids.forEach((id) => markers[kind].nodes.delete(id)));
  };
  const forgetEdges = (keys) => {
    MARKER_KINDS.forEach((kind) => keys.forEach((key) => markers[kind].edges.delete(key)));
  };

  // Production removeFullGraphNode: the node and its links. -> nodes removed
  const removeNodes = (ids) => {
    const present = [...new Set(ids.map(String))].filter((id) => graph.hasNode(id));
    if (!present.length) return 0;
    const edges = new Set();
    present.forEach((id) => graph.forEachEdge(id, (key) => edges.add(key)));
    forgetEdges([...edges]);
    present.forEach((id) => graph.dropNode(id));
    forgetNodes(present);
    emit();
    return present.length;
  };

  // -> edges removed
  const removeEdges = (keys) => {
    const present = [...new Set(keys.map(String))].filter((key) => graph.hasEdge(key));
    if (!present.length) return 0;
    present.forEach((key) => graph.dropEdge(key));
    forgetEdges(present);
    emit();
    return present.length;
  };

  // Production handleLinkNodes: an edge for each pair of the nodes not yet
  // linked either way. -> edges made
  const linkNodes = (ids) => {
    const nodes = [...new Set(ids.map(String))].filter((id) => graph.hasNode(id));
    let made = 0;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        if (!graph.areNeighbors(nodes[i], nodes[j]) && addEdgeInternal(nodes[i], nodes[j], { label: '', width: 1, arrows: 'to', dashes: false })) made += 1;
      }
    }
    if (made) emit();
    return made;
  };

  // Production handleUnlinkNode: every link of the node. -> edges removed
  const unlinkNode = (id) => {
    const key = String(id);
    if (!graph.hasNode(key)) return 0;
    return removeEdges(graph.edges(key));
  };

  // Production handleUnlinkNodes: links between two of the nodes. -> removed
  const unlinkNodes = (ids) => {
    const set = new Set(ids.map(String));
    if (set.size < 2) return 0;
    const keys = [];
    graph.forEachEdge((key, attributes, source, target) => {
      if (set.has(source) && set.has(target)) keys.push(key);
    });
    return removeEdges(keys);
  };

  // Production copyNodes: the nodes (with where they are) and the links
  // among them, in production's clipboard shape { nodes, edges }.
  const copyNodes = (ids) => {
    const wanted = [...new Set(ids.map(String))].filter((id) => graph.hasNode(id));
    const set = new Set(wanted);
    const nodes = wanted.map((id) => {
      const at = positions.get(id);
      return { ...cloneDeep(graph.getNodeAttributes(id)), id, ...(at ? { x: at.x, y: at.y } : {}) };
    });
    const edges = [];
    graph.forEachEdge((key, attributes, source, target) => {
      if (set.has(source) && set.has(target)) edges.push({ ...cloneDeep(attributes), from: source, to: target });
    });
    return { nodes, edges, runSettings: exportRunSettings(runSettings) };
  };

  // Production pasteNodes: new ids ("Group…" nodes stay groups), placed from
  // `position` 20 apart, links among them remapped. -> the new node ids
  const pasteNodes = (clip, { position = { x: 0, y: 0 }, viewKey, visibleIds } = {}) => {
    const nodes = Array.isArray(clip?.nodes) ? clip.nodes : [];
    if (!nodes.length) return [];
    const idMap = new Map();
    const pasted = [];
    nodes.forEach((raw, i) => {
      const group = String(raw?.id ?? '').startsWith('Group');
      const id = uniqueNodeId(group ? 'Group' : 'node');
      idMap.set(String(raw?.id), id);
      const { x: _x, y: _y, ...attributes } = raw || {};
      graph.addNode(id, { ...cloneDeep(attributes), id });
      positions.set(id, { x: position.x + i * 20, y: position.y + i * 20 });
      pasted.push(id);
    });
    (Array.isArray(clip?.edges) ? clip.edges : []).forEach((edge, index) => {
      const from = idMap.get(String(edge?.from ?? edge?.source));
      const to = idMap.get(String(edge?.to ?? edge?.target));
      if (!from || !to) return;
      addEdgeInternal(from, to, { ...cloneDeep(edge), id: uniqueEdgeId(`paste_edge_${index}`) });
    });
    // Both remarks stand; taking the paste back keeps them, to be safe.
    runSettings = mergeRunSettings(runSettings, importRunSettings(clip.runSettings));
    showAuthored(pasted, viewKey, visibleIds);
    emit();
    return pasted;
  };

  /* ── Group / ungroup / merge (G3.4; GA:3311, GA:3356, GA:3559) ─────── */

  const centreOf = (ids) => {
    const placed = ids.map((id) => positions.get(id)).filter(Boolean);
    if (!placed.length) return null;
    return {
      x: placed.reduce((sum, at) => sum + at.x, 0) / placed.length,
      y: placed.reduce((sum, at) => sum + at.y, 0) / placed.length,
    };
  };

  // Production handleGroupNodes: the nodes become one "Group" node (size 40,
  // at their centre) holding them (`members`) and the links among them
  // (`edges`). Production also dropped their links to the rest of the graph;
  // here those move to the group node and are kept (`externalEdges`), so
  // ungrouping brings them back. -> the group id, or null
  const groupNodes = (ids, { color, viewKey, visibleIds } = {}) => {
    const members = [...new Set(ids.map(String))].filter((id) => graph.hasNode(id));
    if (members.length < 2) return null;
    const set = new Set(members);
    let groupId = `Group ${Date.now()}`;
    while (graph.hasNode(groupId)) groupId = `Group ${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const centre = centreOf(members) || { x: 0, y: 0 };
    const memberNodes = members.map((id) => {
      const at = positions.get(id);
      return { ...cloneDeep(graph.getNodeAttributes(id)), id, ...(at ? { x: at.x, y: at.y } : {}) };
    });
    const memberEdges = [];
    const externalEdges = [];
    graph.forEachEdge((key, attributes, source, target) => {
      const inside = set.has(source) && set.has(target);
      if (inside) memberEdges.push({ ...cloneDeep(attributes), from: source, to: target });
      else if (set.has(source) || set.has(target)) externalEdges.push({ key, attributes: cloneDeep(attributes), from: source, to: target });
    });
    graph.addNode(groupId, {
      id: groupId, label: 'Group', size: 40, color, isGroup: true, members: memberNodes, edges: memberEdges, externalEdges, groupedAt: centre,
    });
    positions.set(groupId, centre);
    externalEdges.forEach((edge, index) => {
      const from = set.has(edge.from) ? groupId : edge.from;
      const to = set.has(edge.to) ? groupId : edge.to;
      if (from === to) return;
      addEdgeInternal(from, to, { ...cloneDeep(edge.attributes), id: uniqueEdgeId(`group_edge_${index}`), groupedEdge: edge.key });
    });
    forgetEdges([...memberEdges, ...externalEdges].map((edge) => edge.key).filter(Boolean));
    members.forEach((id) => graph.dropNode(id));
    forgetNodes(members);
    showAuthored([groupId], viewKey, visibleIds);
    emit();
    return groupId;
  };

  // Production handleUngroupNode: the members come back (a new id if theirs
  // is taken), with the links among them (skipping pairs already linked),
  // and here also their links to the rest. Members keep their place,
  // moved along with the group. -> the restored ids
  const ungroupNode = (groupId, { viewKey, visibleIds } = {}) => {
    const id = String(groupId);
    if (!graph.hasNode(id)) return [];
    const group = graph.getNodeAttributes(id);
    if (!group.isGroup) return [];
    const now = positions.get(id);
    const then = group.groupedAt;
    const shift = now && then ? { x: now.x - then.x, y: now.y - then.y } : { x: 0, y: 0 };
    graph.dropNode(id);
    forgetNodes([id]);
    const idMap = new Map();
    const restored = [];
    (group.members || []).forEach((member) => {
      const original = String(member.id);
      const newId = graph.hasNode(original) ? uniqueNodeId('restored') : original;
      idMap.set(original, newId);
      const { x, y, ...attributes } = member;
      graph.addNode(newId, { ...cloneDeep(attributes), id: newId });
      if (Number.isFinite(x) && Number.isFinite(y)) positions.set(newId, { x: x + shift.x, y: y + shift.y });
      else if (now) positions.set(newId, { ...now });
      restored.push(newId);
    });
    const linked = new Set();
    graph.forEachEdge((key, attributes, source, target) => linked.add([source, target].sort().join('--')));
    (group.edges || []).forEach((edge) => {
      const from = idMap.get(String(edge.from)) || String(edge.from);
      const to = idMap.get(String(edge.to)) || String(edge.to);
      if (from === to) return;
      const pair = [from, to].sort().join('--');
      if (linked.has(pair)) return;
      linked.add(pair);
      addEdgeInternal(from, to, { ...cloneDeep(edge), id: uniqueEdgeId('restored_edge') });
    });
    (group.externalEdges || []).forEach((edge) => {
      const from = idMap.get(edge.from) || edge.from;
      const to = idMap.get(edge.to) || edge.to;
      if (!graph.hasNode(from) || !graph.hasNode(to) || graph.hasEdge(edge.key)) return;
      graph.addEdgeWithKey(edge.key, from, to, { ...cloneDeep(edge.attributes), from, to });
    });
    showAuthored(restored, viewKey, visibleIds);
    emit();
    return restored;
  };

  // Production mergeSelectedNodes: the first node stays (at the centre of
  // all), records merged_from / merge_count, takes the others' properties
  // as `<prefix>_<key>` (`keys`: which, null for all), and their links.
  // -> the kept id, or null
  const MERGE_SKIP_KEYS = new Set([
    'id', 'label', 'title', 'x', 'y', 'vx', 'vy', 'fx', 'fy', 'size', 'shape', 'image', 'icon', 'iconPath',
    'color', 'font', 'borderWidth', 'borderWidthSelected', 'shadow', 'hidden', 'physics', 'fixed', 'chosen', 'group', 'level', 'mass',
  ]);
  const mergeKeys = (ids) => {
    const keys = new Set();
    ids.forEach((id) => {
      if (!graph.hasNode(id)) return;
      Object.entries(graph.getNodeAttributes(id)).forEach(([key, value]) => {
        if (MERGE_SKIP_KEYS.has(key) || value === undefined || value === null || value === '') return;
        keys.add(key);
      });
    });
    return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  };
  const mergeNodes = (ids, { keys = null, prefix = 'merged', viewKey, visibleIds } = {}) => {
    const nodes = [...new Set(ids.map(String))].filter((id) => graph.hasNode(id));
    if (nodes.length < 2) return null;
    const [kept, ...others] = nodes;
    const allowed = keys ? new Set(keys) : null;
    const node = { ...graph.getNodeAttributes(kept) };
    node.merged_from = [...new Set([...(node.merged_from || []), ...others])];
    node.merge_count = (node.merge_count || 1) + others.length;
    others.forEach((id) => {
      Object.entries(graph.getNodeAttributes(id)).forEach(([key, value]) => {
        if (MERGE_SKIP_KEYS.has(key) || (allowed && !allowed.has(key)) || value === undefined) return;
        const base = `${prefix}_${key}`;
        let derived = base;
        let counter = 2;
        while (Object.prototype.hasOwnProperty.call(node, derived)) {
          derived = `${base}_${counter}`;
          counter += 1;
        }
        node[derived] = cloneDeep(value);
      });
    });
    const centre = centreOf(nodes);
    const set = new Set(nodes);
    // Links of the merged nodes move to the kept one; links among them go.
    const moved = [];
    graph.forEachEdge((key, attributes, source, target) => {
      if (!set.has(source) && !set.has(target)) return;
      if (source === kept && target === kept) return;
      if ((source === kept || !set.has(source)) && (target === kept || !set.has(target))) return;
      moved.push({ key, attributes: { ...attributes }, from: set.has(source) ? kept : source, to: set.has(target) ? kept : target });
    });
    graph.replaceNodeAttributes(kept, node);
    if (centre) positions.set(kept, centre);
    others.forEach((id) => graph.dropNode(id));
    forgetNodes(others);
    moved.forEach(({ key, attributes, from, to }) => {
      if (from === to) return;
      graph.addEdgeWithKey(key, from, to, { ...attributes, from, to });
    });
    showAuthored([kept], viewKey, visibleIds);
    emit();
    return kept;
  };

  // Adjust-box edits (G3.2; production persistNodeChange /
  // persistEdgeChange): merged into the attributes, not kept as originals
  // (Reset Node Styles is for the visual tools; edits are undone instead).
  // entries: [[id | key, patch]]. -> how many changed
  const updateNodes = (entries) => {
    let changed = 0;
    entries.forEach(([rawId, patch]) => {
      const id = String(rawId);
      if (!graph.hasNode(id) || !patch) return;
      graph.mergeNodeAttributes(id, patch);
      changed += 1;
    });
    if (changed) emit();
    return changed;
  };
  const updateEdges = (entries) => {
    let changed = 0;
    entries.forEach(([key, patch]) => {
      if (!graph.hasEdge(key) || !patch) return;
      graph.mergeEdgeAttributes(key, patch);
      changed += 1;
    });
    if (changed) emit();
    return changed;
  };

  /* ── Hide / show (G3.6 selection tools, after i2) ──────────────────── */

  // Hides drawn nodes in this view (a visibility edit, like collapse).
  // -> how many were hidden
  const hideNodes = (ids, { viewKey, visibleIds = [] } = {}) => {
    const visible = new Set(visibleIds.map(String));
    const targets = [...new Set(ids.map(String))].filter((id) => visible.has(id));
    if (!targets.length) return 0;
    const edit = editVisibility(viewKey);
    targets.forEach((id) => {
      const index = edit.added.indexOf(id);
      if (index >= 0) edit.added.splice(index, 1);
      else edit.removed.add(id);
    });
    emit({ dataChanged: false });
    return targets.length;
  };
  // Nodes hidden in this view (by Hide or Collapse Neighbourhood).
  const hiddenCount = (viewKey) => (visibility.viewKey === viewKey ? [...visibility.removed].filter((id) => graph.hasNode(id)).length : 0);
  // Brings them back. -> how many
  const showHidden = (viewKey) => {
    const count = hiddenCount(viewKey);
    if (!count) return 0;
    visibility.removed = new Set();
    emit({ dataChanged: false });
    return count;
  };

  /* ── History (production captureGraphHistorySnapshot / apply…) ──────── */
  const historyAllowed = () => graph.order + graph.size <= HISTORY_ELEMENT_LIMIT;
  const copyMarker = (marker) => ({ nodes: [...marker.nodes], edges: [...marker.edges], viewKey: marker.viewKey });
  const takeSnapshot = (context) => ({
    graph: cloneDeep(graph.export()),
    positions: [...positions].map(([id, position]) => [id, { ...position }]),
    layoutSignature,
    originals: cloneDeep([...originals]),
    visibility: { viewKey: visibility.viewKey, added: [...visibility.added], removed: [...visibility.removed], cap: visibility.cap },
    // Path and traversal highlights; alerts and pinned items are worked out
    // again from the rules and the pinned list.
    path: copyMarker(markers.path),
    traversal: copyMarker(markers.traversal),
    selection: [...selection],
    context: cloneDeep(context ?? null),
  });
  const restoreSnapshot = (taken) => {
    clearTimeout(flashTimer);
    flashTimer = null;
    graph.clear();
    graph.import(cloneDeep(taken.graph));
    positions = new Map(taken.positions.map(([id, position]) => [id, { ...position }]));
    layoutSignature = taken.layoutSignature;
    originals = new Map(cloneDeep(taken.originals));
    visibility = { viewKey: taken.visibility.viewKey, added: [...taken.visibility.added], removed: new Set(taken.visibility.removed), cap: taken.visibility.cap ?? drawingCap };
    const marker = (saved) => ({ nodes: new Set(saved.nodes), edges: new Set(saved.edges), ...(saved.viewKey !== undefined ? { viewKey: saved.viewKey } : {}) });
    markers.path = marker(taken.path);
    markers.traversal = marker(taken.traversal);
    selection = [...taken.selection];
  };
  const pushLimited = (stack, entry) => {
    stack.push(entry);
    if (stack.length > HISTORY_MAX) stack.splice(0, stack.length - HISTORY_MAX);
  };
  // Before a recorded action. -> false when the graph is too large
  const recordHistory = (context) => {
    if (!historyAllowed()) return false;
    pushLimited(history.undo, takeSnapshot(context));
    history.redo = [];
    // Only the undo state changed (the action itself changes the data).
    emit({ dataChanged: false });
    return true;
  };
  // -> { context, selection } of the restored state, or null if none
  const stepHistory = (from, to, context) => {
    if (!history[from].length) return null;
    const target = history[from].pop();
    if (historyAllowed()) pushLimited(history[to], takeSnapshot(context));
    restoreSnapshot(target);
    emit();
    return { context: target.context, selection: target.selection };
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
    emit({ dataChanged: false });
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
    restoreVisibility,
    addNode,
    addEdge,
    removeNodes,
    removeEdges,
    linkNodes,
    unlinkNode,
    unlinkNodes,
    copyNodes,
    pasteNodes,
    updateNodes,
    updateEdges,
    hideNodes,
    hiddenCount,
    showHidden,
    groupNodes,
    ungroupNode,
    mergeNodes,
    mergeKeys,
    getUi: (key, fallback) => (ui.has(key) ? ui.get(key) : fallback),
    setUi: (key, value) => { ui.set(key, value); },
    recordHistory,
    undo: (context) => stepHistory('undo', 'redo', context),
    redo: (context) => stepHistory('redo', 'undo', context),
    historyAllowed,
    patchNodes,
    restoreNodePatches,
    hasNodePatches: () => originals.size > 0,
    editedCap,
    setDrawingCap,
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
      emit({ dataChanged: false });
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
    setAlertReport,
    setRunSettings: (entries) => {
      runSettings = mergeRunSettings([], entries || []);
      emit({ dataChanged: false });
    },
    getRunSettings: () => runSettings,
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
