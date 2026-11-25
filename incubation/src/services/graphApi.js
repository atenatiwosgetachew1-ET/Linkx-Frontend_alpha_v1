// Graph fetching (POST /get_graph), ported from the production app
// (src/App.jsx: requestGraphFetch, getGraphPayloadCandidate, hasGraphPayload,
// extractNodesEdges, buildEvidencePayload). The Graph window port extends
// this module; the Reports window uses the evidence fetch today.

import { JOB_CANCEL_STATUSES, JOB_FAILURE_STATUSES, JOB_POLL_DEFAULT_INTERVAL_MS, JOB_SUCCESS_STATUSES, getJobErrorMessage, getJobResult, getJobStatus, getQueuedPollPath, isQueuedJobResponse } from './jobs.js';
import { parseJsonExact } from '../shared/numbers/values.js';

const GRAPH_POLL_TIMEOUT_MS = 120 * 1000;

const hasGraphArrays = (value) => Boolean(value) && (Array.isArray(value.nodes) || Array.isArray(value.edges));

// Workers sometimes answer with a JSON string or a Python dict repr.
// One pass over the text, so what is inside a string is never changed
// ("None Trading", "it's").
const PYTHON_TOKEN = /'((?:\\[\s\S]|[^'\\])*)'|"((?:\\[\s\S]|[^"\\])*)"|\b(?:neo4j\.time\.[A-Za-z_][\w.]*|(?:datetime\.)?(?:datetime|date|time|timedelta))\((?:[^()]|\([^()]*\))*\)|-?\s*\b(?:None|NaN|nan|Infinity|inf)\b|\b(?:True|False)\b/g;
const PYTHON_ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', a: '\u0007', 0: '\0', '\n': '' };
const pythonText = (inner) => inner.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[\s\S])/g, (_match, code) => (
  code.length > 1 ? String.fromCodePoint(parseInt(code.slice(1), 16)) : PYTHON_ESCAPES[code] ?? code
));
const pythonToJson = (text) => text.replace(PYTHON_TOKEN, (match, single, double) => {
  if (single !== undefined || double !== undefined) return JSON.stringify(pythonText(single ?? double));
  if (match === 'True') return 'true';
  if (match === 'False') return 'false';
  return match.includes('(') ? JSON.stringify(match) : 'null';
});

export const parseMaybeSerializedGraphPayload = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  try {
    return parseJsonExact(trimmed);
  } catch { /* try the Python repr below */ }
  try {
    return parseJsonExact(pythonToJson(trimmed));
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

// POST /get_graph, following a queued job and its chunks (as the Graph window
// reads them). -> { data, nodes, edges, partial, expected }; rejects with the
// Service's message. partial: the Service announced more than it delivered.
export const fetchGraph = async (apiFetch, payload, { signal, onQueued, intervalMs } = {}) => {
  const nodes = [];
  const edges = [];
  const result = await fetchGraphProgressive(apiFetch, payload, {
    signal,
    onQueued,
    ...(intervalMs === undefined ? {} : { intervalMs }),
    onChunk: (chunk) => {
      chunk.nodes.forEach((node) => nodes.push(node));
      chunk.edges.forEach((edge) => edges.push(edge));
    },
  });
  // Nothing that reads as a graph, not even an empty one.
  if (!nodes.length && !edges.length && !result.readable) throw new Error(getJobErrorMessage(result.data, 'Graph request failed'));
  return { data: result.data, nodes, edges, partial: result.partial, truncatedBy: result.truncatedBy, expected: result.expected };
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

// Whether the Service itself says the graph is not whole (R2-4): `complete`,
// `partial` or `truncated_by` in its answer.
const cutOf = (answer) => {
  const result = [getJobResult(answer), answer?.results, answer].find((item) => item && typeof item === 'object' && ('complete' in item || 'truncated_by' in item || 'partial' in item)) || {};
  const truncatedBy = typeof result.truncated_by === 'string' ? result.truncated_by.slice(0, 80) : result.truncated_by ? 'a limit' : '';
  const partial = result.complete === false || result.partial === true || Boolean(truncatedBy);
  const nodes = Number(result.total_nodes);
  const edges = Number(result.total_edges);
  const known = result.total_nodes != null && result.total_edges != null && Number.isFinite(nodes) && Number.isFinite(edges);
  return { partial, truncatedBy, expected: partial && known ? { nodes, edges } : null };
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
    const cut = cutOf(response);
    return { data: response, nodes: graph.nodes.length, edges: graph.edges.length, chunked: false, partial: cut.partial, truncatedBy: cut.truncatedBy, expected: cut.expected, readable: true };
  }

  const pollPath = getQueuedPollPath(response);
  onQueued?.({ pollPath, response });
  const startedAt = Date.now();
  let afterEventId = 0;
  let nodes = 0;
  let edges = 0;
  let chunks = 0;
  // Chunks already taken: one sent again is not counted or drawn twice.
  const seen = new Set();
  // The finished job while its last chunks are still being collected.
  let finished = null;
  let expected = null;
  const done = (job, { complete }) => {
    const cut = cutOf(job);
    const short = cut.partial || (expected ? nodes < expected.nodes || edges < expected.edges : !complete);
    const readable = chunks > 0 || Array.isArray(job?.results?.chunks) || [job, getJobResult(job)].some(hasGraphPayload);
    return { data: job, nodes, edges, chunked: chunks > 0, partial: short, truncatedBy: cut.truncatedBy, expected, readable };
  };
  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw abortError();
    let job;
    try {
      job = await apiFetch(buildChunkPollPath(pollPath, afterEventId), { method: 'GET', signal });
    } catch (error) {
      // The job was done; only the check for more chunks failed.
      if (finished && error?.name !== 'AbortError' && !signal?.aborted) return done(finished, { complete: false });
      throw error;
    }
    let fresh = 0;
    const results = job?.results && typeof job.results === 'object' ? job.results : {};
    (Array.isArray(results.chunks) ? results.chunks : []).forEach((chunk) => {
      const eventId = chunkEventId(chunk?.event_id ?? chunk?.eventId);
      if (eventId ? seen.has(eventId) : finished) return;
      if (eventId) seen.add(eventId);
      fresh += 1;
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
    if (Number.isFinite(totalNodes) && Number.isFinite(totalEdges) && summary.total_nodes != null && summary.total_edges != null) expected = { nodes: totalNodes, edges: totalEdges };
    onProgress?.({
      current: nodes + edges,
      total: expected ? Math.max(1, expected.nodes + expected.edges) : null,
    });

    if (finished) {
      // Until a check brings nothing new.
      if (!fresh) return done(finished, { complete: true });
      if (expected && nodes >= expected.nodes && edges >= expected.edges) return done(finished, { complete: true });
      continue;
    }
    const status = failIfJobFailed(job);
    if (JOB_SUCCESS_STATUSES.has(status)) {
      // A job that delivered nothing in chunks but carries the whole graph in its
      // result (non-chunked backend) is used as one final chunk.
      const whole = [job, getJobResult(job)].find(hasGraphPayload);
      if (!nodes && !edges && whole) {
        const graph = extractNodesEdges(whole);
        nodes = graph.nodes.length;
        edges = graph.edges.length;
        onChunk?.(graph);
      }
      // The last chunks may still be to come.
      if (fresh && !(expected && nodes >= expected.nodes && edges >= expected.edges)) {
        finished = job;
        continue;
      }
      return done(job, { complete: true });
    }
    await wait(intervalMs, signal);
  }
  if (finished) return done(finished, { complete: false });
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

// A finished run's kept graph (B-37): 24 hours, by the Service's task id.
export const buildTaskGraphPayload = (serverId) => ({ id: 'relationship', task_id: String(serverId).slice(0, 128) });
export const buildRelationshipPayload = (sourceSessionId, relationship) => ({
  id: 'relationship',
  source_id: sanitizeGraphEndpointId(sourceSessionId),
  relationship: sanitizeRelationship(relationship),
});
