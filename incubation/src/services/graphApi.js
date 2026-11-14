// Graph fetching (POST /get_graph), ported from the production app
// (src/App.jsx: requestGraphFetch, getGraphPayloadCandidate, hasGraphPayload,
// extractNodesEdges, buildEvidencePayload). The Graph window port extends
// this module; the Reports window uses the evidence fetch today.

import { JOB_CANCEL_STATUSES, JOB_FAILURE_STATUSES, getJobErrorMessage, getJobStatus, getQueuedPollPath, isQueuedJobResponse, pollJob } from './jobs.js';

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
