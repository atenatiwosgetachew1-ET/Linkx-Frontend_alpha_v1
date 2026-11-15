// Pinned evidence (graph-chart-plan G2.4b), ported from production
// graphs_adjuster.js (GA:5017-5195): one list for the whole device, kept
// under production's storage key, newest first, at most 300 items, each a
// copy of the pinned node's or edge's data at the time it was pinned.
//
// Production read the list when a Graph window opened; here every open
// window follows changes at once (and other browser tabs, via "storage").
//
// item: { type: 'node' | 'edge', id, data, pinnedAt }
// Node ids are the node's id. Edge ids are the backend edge id when there is
// one (production's id); otherwise the window's own edge key (production
// gave such edges a random id per load, so they never matched again).

export const PINNED_EVIDENCE_KEY = 'linkx_pinned_evidence_v1';
export const MAX_PINNED_EVIDENCE = 300;

const itemKey = (item) => `${item.type}:${item.id}`;

const normalizeList = (value, limit = MAX_PINNED_EVIDENCE) => {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .filter((item) => item && (item.type === 'node' || item.type === 'edge') && item.id != null && item.id !== '')
    .map((item) => ({ ...item, id: String(item.id) }))
    .filter((item) => {
      const key = itemKey(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
};

const readStorage = () => {
  try {
    return normalizeList(JSON.parse(localStorage.getItem(PINNED_EVIDENCE_KEY) || '[]'));
  } catch {
    return [];
  }
};

let list = null; // read lazily, so tests and storage changes start clean
const listeners = new Set();

const current = () => {
  if (list === null) list = readStorage();
  return list;
};

const commit = (next) => {
  list = next;
  try {
    localStorage.setItem(PINNED_EVIDENCE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: kept for this session only.
  }
  listeners.forEach((listener) => listener());
};

const onStorage = (event) => {
  if (event.key !== PINNED_EVIDENCE_KEY && event.key !== null) return;
  list = readStorage();
  listeners.forEach((listener) => listener());
};

export const getPinnedEvidence = () => current();

export const subscribePinnedEvidence = (listener) => {
  if (!listeners.size && typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

// GA:5017 pushPinnedEvidenceItem, for several items: new ones go first,
// already pinned ones are left where they are. -> number added
export const pinEvidence = (items) => {
  const existing = new Set(current().map(itemKey));
  const pinnedAt = new Date().toISOString();
  const added = normalizeList(items, Infinity).filter((item) => !existing.has(itemKey(item))).map((item) => ({ ...item, pinnedAt }));
  if (!added.length) return 0;
  // Production unshifted one at a time, so the last one pinned is first.
  commit([...added.reverse(), ...current()].slice(0, MAX_PINNED_EVIDENCE));
  return added.length;
};

// GA:5106 / 5127 unpin. -> number removed
export const unpinEvidence = (items) => {
  const removing = new Set(normalizeList(items, Infinity).map(itemKey));
  const next = current().filter((item) => !removing.has(itemKey(item)));
  const removed = current().length - next.length;
  if (removed) commit(next);
  return removed;
};

// GA:5060 clearPinnedEvidence. -> number removed
export const clearPinnedEvidence = () => {
  const removed = current().length;
  if (removed) commit([]);
  return removed;
};

// For tests: forget the in-memory copy (the next read uses storage).
export const resetPinnedEvidenceCache = () => {
  list = null;
};

/* ── Mapping to one window's graph ──────────────────────────────────── */

// The stored id of an edge key ("id:<backend id>" -> backend id).
export const pinnedEdgeId = (edgeKey) => (String(edgeKey).startsWith('id:') ? String(edgeKey).slice(3) : String(edgeKey));

// The graph's edge key for a stored edge id, or null.
export const edgeKeyForPinned = (graph, id) => {
  if (graph.hasEdge(`id:${id}`)) return `id:${id}`;
  return graph.hasEdge(id) ? id : null;
};

// Items for nodes / edge keys of a graph (data copied, as production did).
export const evidenceItems = (graph, { nodeIds = [], edgeKeys = [] } = {}) => [
  ...nodeIds.filter((id) => graph.hasNode(String(id))).map((id) => ({
    type: 'node', id: String(id), data: { ...graph.getNodeAttributes(String(id)) },
  })),
  ...edgeKeys.filter((key) => graph.hasEdge(key)).map((key) => ({
    type: 'edge', id: pinnedEdgeId(key), data: { ...graph.getEdgeAttributes(key) },
  })),
];

// GA:3943 getPinnedEvidenceSets, for the items present in this graph:
// -> { nodes: [ids], edges: [edge keys] }
export const pinnedInGraph = (graph, items = current()) => {
  const nodes = [];
  const edges = [];
  items.forEach((item) => {
    if (item.type === 'node' && graph.hasNode(item.id)) nodes.push(item.id);
    if (item.type === 'edge') {
      const key = edgeKeyForPinned(graph, item.id);
      if (key) edges.push(key);
    }
  });
  return { nodes, edges };
};

// GA:5153 showPinnedEvidenceSummary fit targets: pinned nodes and both ends
// of pinned edges that are in the graph.
export const pinnedFitNodes = (graph, items = current()) => {
  const ids = new Set();
  const { nodes, edges } = pinnedInGraph(graph, items);
  nodes.forEach((id) => ids.add(id));
  edges.forEach((key) => {
    ids.add(graph.source(key));
    ids.add(graph.target(key));
  });
  return [...ids];
};
