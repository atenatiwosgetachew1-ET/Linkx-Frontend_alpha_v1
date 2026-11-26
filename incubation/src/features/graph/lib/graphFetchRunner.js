// Runs a graph request for one Graph window into its store (production
// requestEvidenceGraph / requestRelationshipGraph, src/App.jsx ~13641-14112).
//
// - A new request cancels the previous one of that window.
// - The first chunk replaces the graph (production "new_graph"); later
//   chunks merge into it ("graph_chunk_update").
// - Progress is reported in the store status; the window shows it.
// - The request is not tied to the window being mounted.

import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { cancelJob } from '../../../services/jobs.js';
import { fetchGraphProgressive } from '../../../services/graphApi.js';
import { resolveGraphRuns } from '../../../services/runSettingsApi.js';
import { UNKNOWN_RUN } from '../../../shared/runSettings.js';

const isAbort = (error) => error?.name === 'AbortError';

export const runGraphFetch = async ({ store, apiFetch, payload, source, label = 'graph', onFirstChunk, onEmpty, onLoaded, onFailed, extra = {} }) => {
  const controller = store.beginFetch();
  const current = () => store.isCurrentFetch(controller);
  // As the Service sent it (for a cache: edits made meanwhile are not in it).
  const chunks = [];
  let received = false;
  let pollPath = '';
  const before = store.getStatus();
  store.setStatus({ state: 'loading', message: `Fetching ${label}…`, source, request: payload });
  try {
    const result = await fetchGraphProgressive(apiFetch, payload, {
      signal: controller.signal,
      onQueued: (queued) => {
        pollPath = queued?.pollPath || '';
        if (current() && !received) store.setStatus({ state: 'queued', message: `The ${label} request is queued on the Service…`, source, request: payload });
      },
      onChunk: (chunk) => {
        if (!current()) return;
        chunks.push(chunk);
        if (!received) {
          received = true;
          store.replace(chunk);
          store.setRunSettings(UNKNOWN_RUN); // until the answer is whole
          onFirstChunk?.();
        } else {
          store.mergeChunk(chunk);
        }
      },
      onProgress: ({ current: done, total }) => {
        if (!current() || !received) return;
        store.setStatus({
          state: 'loading',
          message: total ? `Fetching ${label}… ${Math.min(100, Math.round((done / total) * 100))}%` : `Fetching ${label}… ${done.toLocaleString()} items`,
          source,
          request: payload,
          progressive: true,
        });
      },
    });
    if (!current()) return null;
    if (!result.nodes && !result.edges) {
      if (!received) store.clear();
      store.setStatus({ state: 'idle', source });
      onEmpty?.();
      return result;
    }
    // What its runs were made with: before it is ready, so nothing leaves the
    // window without the remark.
    const runSettings = await resolveGraphRuns(apiFetch, result.runs, { signal: controller.signal, id: payload?.task_id || payload?.trace_id || '' });
    if (!current()) return null;
    store.setRunSettings(runSettings);
    store.setStatus({ state: 'ready', source, request: payload, ...extra, ...(result.partial ? { partial: true, truncatedBy: result.truncatedBy || '', expected: result.expected, received: { nodes: result.nodes, edges: result.edges } } : {}) });
    onLoaded?.({ ...result, runSettings, raw: () => ({ nodes: chunks.flatMap((chunk) => chunk.nodes), edges: chunks.flatMap((chunk) => chunk.edges) }) });
    return result;
  } catch (error) {
    if (isAbort(error) || !current()) {
      // Not wanted any more: its job is stopped (B-7).
      if (pollPath) cancelJob(apiFetch, pollPath);
      return null;
    }
    // Nothing of it came, and a graph was there: the caller may keep that one.
    if (!received && before.state === 'ready' && store.getSnapshot().nodes > 0 && onFailed?.(error)) {
      store.setStatus(before);
      return null;
    }
    store.setStatus({ state: 'error', message: getServiceRefusalMessage(error) || error?.message || 'Failed to fetch graph data.', source, request: payload, ...(received ? { partial: true } : {}) });
    return null;
  }
};
