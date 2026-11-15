// Graph fetching (POST /get_graph), ported from the production app
// (src/App.jsx: requestGraphFetch, getGraphPayloadCandidate, hasGraphPayload,
// extractNodesEdges, buildEvidencePayload). The Graph window port extends
// this module; the Reports window uses the evidence fetch today.

import { JOB_CANCEL_STATUSES, JOB_FAILURE_STATUSES, JOB_POLL_DEFAULT_INTERVAL_MS, JOB_SUCCESS_STATUSES, getJobErrorMessage, getJobStatus, getQueuedPollPath, isQueuedJobResponse, pollJob } from './jobs.js';

const GRAPH_POLL_TIMEOUT_MS = 120 * 1000;

const hasGraphArrays = (value) => Boolean(value) && (Array.isArray(value.nodes) || Array.isArray(value.edges));

// Workers sometimes answer with a JSON string or a Python dict repr.
export const parseMaybeSerializedGraphPayload = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return JSON.parse(trimmed);
  } catch { /* try the Python repr below */ }
  try {
    const keepAsString = (match) => JSON.stringify(match);
    const jsonish = trimmed
      .replace(/\bNone\b/g, 'null')
      .replace(/\bTrue\b/g, 'true')
      .replace(/\bFalse\b/g, 'false')
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner) => JSON.stringify(inner.replace(/\\'/g, "'").replace(/\\\\/g, '\\')))
      .replace(/\bneo4j\.time\.[A-Za-z_][\w.]*\((?:[^()]|\([^()]*\))*\)/g, keepAsString)
      .replace(/\b(?:datetime\.)?(?:datetime|date|time|timedelta)\((?:[^()]|\([^()]*\))*\)/g, keepAsString)
      .replace(/\bNaN\b/g, 'null')
      .replace(/\bInfinity\b/g, 'null')
      .replace(/-\s*null\b/g, 'null');
    return JSON.parse(jsonish);
  } catch {
    return value;
  }
};

// The object holding nodes/edges, wherever the backend put it.
export const getGraphPayloadCandidate = (data) => {
  const source = parseMaybeSerializedGraphPayload(data);
  if (!source || typeof source !== 'object') return {};
  const candidates = [
    source.results, source, source.data,
    source.graph, source.graph_entities,
    source.results?.graph, source.results?.graph_entities,
    source.data?.graph, source.data?.graph_entities,
    source.findings?.graph, source.findings?.graph_entities,
  ];
  const found = candidates.find(hasGraphArrays);
  if (found) return found;
  const parsedResult = parseMaybeSerializedGraphPayload(source.results?.result);
  if (parsedResult && typeof parsedResult === 'object') return parsedResult;
  return source.results ?? source.data ?? source;
};

export const extractNodesEdges = (data) => {
  const candidate = getGraphPayloadCandidate(data);
  const graph = candidate?.graph || candidate?.graph_entities
    || data?.results?.graph || data?.results?.graph_entities || data?.data?.graph || data?.data?.graph_entities;
  const pick = (key) => [candidate?.[key], graph?.[key], data?.results?.[key], data?.data?.[key], data?.[key]].find(Array.isArray) || [];
  return { nodes: pick('nodes'), edges: pick('edges') };
};

export const hasGraphPayload = (data) => {
  const candidate = getGraphPayloadCandidate(data);
  const graph = (candidate?.graph && typeof candidate.graph === 'object') ? candidate.graph
    : (candidate?.graph_entities && typeof candidate.graph_entities === 'object') ? candidate.graph_entities
      : (data?.graph || data?.graph_entities || data?.data?.graph || data?.data?.graph_entities || data?.findings?.graph || data?.findings?.graph_entities);
  return hasGraphArrays(candidate) || hasGraphArrays(graph) || Array.isArray(data?.results?.nodes) || Array.isArray(data?.data?.nodes) || Array.isArray(data?.nodes);
};

// Whitelisted payload for an evidence report's graph.
export const buildEvidencePayload = (traceId, report) => ({
  id: 'evidence',
  trace_id: traceId,
  source_id: traceId,
  ...(report?.id ? { report_id: String(report.id) } : {}),
  ...(report?.externalReferenceId || report?.external_reference_id
    ? { external_reference_id: String(report.externalReferenceId || report.external_reference_id) }
    : {}),
});

// POST /get_graph, following a queued job. Resolves with the raw response
// plus its nodes and edges; rejects with the backend's message.
export const fetchGraph = async (apiFetch, payload, { signal, onQueued } = {}) => {
  const response = await apiFetch('/get_graph', { method: 'POST', body: payload, signal });
  let data = response;
  if (isQueuedJobResponse(response)) {
    const pollPath = getQueuedPollPath(response);
    onQueued?.({ pollPath, response });
    data = await pollJob(apiFetch, pollPath, {
      signal,
      label: 'graph',
      timeoutMs: GRAPH_POLL_TIMEOUT_MS,
      timeoutMessage: 'Graph request timed out. Retry graph load.',
      cancelledMessage: 'Graph request cancelled.',
    });
  }
  const status = getJobStatus(data);
  if (JOB_FAILURE_STATUSES.has(status) || data?.error || data?.results?.error || data?.result?.error) {
    throw new Error(JOB_CANCEL_STATUSES.has(status) ? 'Graph request cancelled.' : getJobErrorMessage(data, 'Graph request failed'));
  }
  if (!hasGraphPayload(data)) throw new Error(getJobErrorMessage(data, 'Graph request failed'));
  return { data, ...extractNodesEdges(data) };
};


/* ── Progressive fetch (production pollGraphJob, src/App.jsx ~3213) ────
   Queued graph jobs are polled with `include_chunks=1&after_event_id=N`
   every second (120 s budget). Each poll's new chunks are handed to
   `onChunk({ nodes, edges })` as they arrive, instead of re-sending the
   whole graph each time (production). `onProgress({ current, total })`
   uses the job's total_nodes + total_edges when the backend reports them. */

const chunkEventId = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

export const buildChunkPollPath = (pollPath, afterEventId) => {
  const separator = String(pollPath).includes('?') ? '&' : '?';
  return `${pollPath}${separator}include_chunks=1&after_event_id=${encodeURIComponent(String(afterEventId || 0))}`;
};

const abortError = () => {
  const error = new Error('Graph request cancelled.');
  error.name = 'AbortError';
  return error;
};

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(abortError());
  }, { once: true });
});

const failIfJobFailed = (data) => {
  const status = getJobStatus(data);
  if (JOB_FAILURE_STATUSES.has(status) || data?.error || data?.results?.error || data?.result?.error) {
    throw new Error(JOB_CANCEL_STATUSES.has(status) ? 'Graph request cancelled.' : getJobErrorMessage(data, 'Graph request failed'));
  }
  return status;
};

export const fetchGraphProgressive = async (apiFetch, payload, {
  signal,
  onQueued,
  onChunk,
  onProgress,
  intervalMs = JOB_POLL_DEFAULT_INTERVAL_MS,
  timeoutMs = GRAPH_POLL_TIMEOUT_MS,
} = {}) => {
  const response = await apiFetch('/get_graph', { method: 'POST', body: payload, signal });

  if (!isQueuedJobResponse(response)) {
    failIfJobFailed(response);
    if (!hasGraphPayload(response)) throw new Error(getJobErrorMessage(response, 'Graph request failed'));
    const graph = extractNodesEdges(response);
    onChunk?.(graph);
    return { nodes: graph.nodes.length, edges: graph.edges.length, chunked: false };
  }

  const pollPath = getQueuedPollPath(response);
  onQueued?.({ pollPath, response });
  const startedAt = Date.now();
  let afterEventId = 0;
  let nodes = 0;
  let edges = 0;
  let chunks = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw abortError();
    const job = await apiFetch(buildChunkPollPath(pollPath, afterEventId), { method: 'GET', signal });
    const results = job?.results && typeof job.results === 'object' ? job.results : {};
    (Array.isArray(results.chunks) ? results.chunks : []).forEach((chunk) => {
      const eventId = chunkEventId(chunk?.event_id ?? chunk?.eventId);
      if (eventId > afterEventId) afterEventId = eventId;
      const chunkNodes = Array.isArray(chunk?.nodes) ? chunk.nodes.filter((node) => node && typeof node === 'object') : [];
      const chunkEdges = Array.isArray(chunk?.edges) ? chunk.edges.filter((edge) => edge && typeof edge === 'object') : [];
      chunks += 1;
      nodes += chunkNodes.length;
      edges += chunkEdges.length;
      if (chunkNodes.length || chunkEdges.length) onChunk?.({ nodes: chunkNodes, edges: chunkEdges });
    });
    const cursor = chunkEventId(results.next_chunk_after_event_id ?? results.nextChunkAfterEventId);
    if (cursor > afterEventId) afterEventId = cursor;
    const summary = results.result && typeof results.result === 'object' ? results.result : {};
    const totalNodes = Number(summary.total_nodes);
    const totalEdges = Number(summary.total_edges);
    onProgress?.({
      current: nodes + edges,
      total: Number.isFinite(totalNodes) && Number.isFinite(totalEdges) ? Math.max(1, totalNodes + totalEdges) : null,
    });

    const status = failIfJobFailed(job);
    if (JOB_SUCCESS_STATUSES.has(status)) {
      // A job that finished without chunks but carries the whole graph in its
      // result (non-chunked backend) is used as one final chunk.
      if (chunks === 0 && hasGraphPayload(job)) {
        const graph = extractNodesEdges(job);
        nodes = graph.nodes.length;
        edges = graph.edges.length;
        onChunk?.(graph);
      }
      return { nodes, edges, chunked: chunks > 0 };
    }
    await wait(intervalMs, signal);
  }
  throw new Error('Graph request timed out. Retry graph load.');
};

// POST /graph_link (production App.jsx ~16655 / ~16815). `graph_window_id`
// is the Graph window's number, as production sends it.
export const graphWindowBackendId = (windowId) => String(windowId || '').replace(/^graph-/, '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128);
export const sanitizeGraphEndpointId = (value) => String(value || '').replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128);

export const linkGraphWindow = (apiFetch, { sourceSessionId, graphWindowId, action = 'link' }) => apiFetch('/graph_link', {
  method: 'POST',
  body: { id: action, source_id: sanitizeGraphEndpointId(sourceSessionId), graph_window_id: graphWindowBackendId(graphWindowId) },
});

// Production sanitizeGraphRelationshipValue (A:407): "*" or [a-zA-Z0-9_.:-].
export const sanitizeRelationship = (value) => {
  const cleaned = String(value ?? '').trim();
  if (cleaned === '*') return '*';
  return cleaned.replace(/[^a-zA-Z0-9_.:-]/g, '').slice(0, 128);
};

export const buildRelationshipPayload = (sourceSessionId, relationship) => ({
  id: 'relationship',
  source_id: sanitizeGraphEndpointId(sourceSessionId),
  relationship: sanitizeRelationship(relationship),
});
