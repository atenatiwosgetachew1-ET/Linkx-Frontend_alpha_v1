// Runs a graph request for one Graph window into its store (production
// requestEvidenceGraph / requestRelationshipGraph, src/App.jsx ~13641-14112).
//
// - A new request cancels the previous one of that window.
// - The first chunk replaces the graph (production "new_graph"); later
//   chunks merge into it ("graph_chunk_update").
// - Progress is reported in the store status; the window shows it.
// - The request is not tied to the window being mounted.

import { fetchGraphProgressive } from '../../../services/graphApi.js';

const isAbort = (error) => error?.name === 'AbortError';

export const runGraphFetch = async ({ store, apiFetch, payload, source, label = 'graph', onFirstChunk, onEmpty, onLoaded }) => {
  const controller = store.beginFetch();
  const current = () => store.isCurrentFetch(controller);
  let received = false;
  store.setStatus({ state: 'loading', message: `Fetching ${label}…`, source, request: payload });
  try {
    const result = await fetchGraphProgressive(apiFetch, payload, {
      signal: controller.signal,
      onQueued: () => {
        if (current() && !received) store.setStatus({ state: 'queued', message: `The ${label} request is queued on the Service…`, source, request: payload });
      },
      onChunk: (chunk) => {
        if (!current()) return;
        if (!received) {
          received = true;
          store.replace(chunk);
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
    store.setStatus({ state: 'ready', source, request: payload });
    onLoaded?.(result);
    return result;
  } catch (error) {
    if (isAbort(error) || !current()) return null;
    store.setStatus({ state: 'error', message: error?.message || 'Failed to fetch graph data.', source, request: payload });
    return null;
  }
};
