// Evidence graphs fetched by the Reports window, cached per trace id so the
// availability check, "Open graph" and (later) the report PDF reuse one
// fetch. The Graph window reads the cache by trace id (window metadata only
// carries ids, never the graph itself).

const cache = new Map(); // traceId -> { data, nodes, edges }

export const getCachedEvidenceGraph = (traceId) => (traceId ? cache.get(String(traceId)) || null : null);

export const cacheEvidenceGraph = (traceId, graph) => {
  if (!traceId || !graph) return;
  cache.set(String(traceId), graph);
};

export const clearEvidenceGraphs = () => cache.clear();
