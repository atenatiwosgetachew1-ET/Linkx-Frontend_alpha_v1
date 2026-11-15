import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildChunkPollPath, buildRelationshipPayload, fetchGraphProgressive, graphWindowBackendId, sanitizeRelationship } from '../../../services/graphApi.js';
import {
  bindGraphStatusSocket,
  clearGraphStatus,
  describeGraphSession,
  getGraphSession,
  markGraphSessionTerminated,
  normalizeGraphRelationships,
  retainGraphStatus,
  setGraphStatusNotifier,
} from './graphStatus.js';
import { TASK_ORIGINS, createTask, markTaskRunning, resetTasks } from '../../tasks/lib/taskRegistry.js';
import { linkGraphToSession, linkableSources, resolveSourceWindow, unlinkGraph } from './graphLinkFlow.js';
import { clearGraphStores, getGraphStore } from './graphStore.js';

afterEach(() => {
  clearGraphStatus();
  clearGraphStores();
  resetTasks();
});

describe('progressive graph fetch (production pollGraphJob)', () => {
  it('polls chunks with the event cursor and hands over only new data', async () => {
    const polls = [
      { results: { status: 'running', chunks: [{ event_id: 3, nodes: [{ id: 1 }, { id: 2 }], edges: [{ from: 1, to: 2 }] }], result: { total_nodes: 3, total_edges: 2 } } },
      { results: { status: 'succeeded', chunks: [{ event_id: 7, nodes: [{ id: 3 }], edges: [{ from: 2, to: 3 }] }], next_chunk_after_event_id: 7 } },
    ];
    const apiFetch = vi.fn(async (path) => (path === '/get_graph' ? { results: { accepted: true, job_id: 'j1' } } : polls.shift()));
    const chunks = [];
    const progress = [];
    const result = await fetchGraphProgressive(apiFetch, { id: 'relationship' }, { intervalMs: 0, onChunk: (chunk) => chunks.push(chunk), onProgress: (p) => progress.push(p) });
    expect(apiFetch.mock.calls[1][0]).toBe('/jobs/j1?include_chunks=1&after_event_id=0');
    expect(apiFetch.mock.calls[2][0]).toBe('/jobs/j1?include_chunks=1&after_event_id=3');
    expect(chunks.map((chunk) => chunk.nodes.length)).toEqual([2, 1]);
    expect(progress[0]).toEqual({ current: 3, total: 5 });
    expect(result).toEqual({ nodes: 3, edges: 2, chunked: true });
  });

  it('uses a finished job without chunks as one chunk, and answers direct graphs at once', async () => {
    const queued = vi.fn(async (path) => (path === '/get_graph'
      ? { results: { accepted: true, job_id: 'j2' } }
      : { results: { status: 'completed', result: { nodes: [{ id: 1 }], edges: [] } } }));
    const chunks = [];
    await fetchGraphProgressive(queued, {}, { intervalMs: 0, onChunk: (chunk) => chunks.push(chunk) });
    expect(chunks[0].nodes).toHaveLength(1);

    const direct = vi.fn(async () => ({ results: { graph: { nodes: [{ id: 1 }, { id: 2 }], edges: [] } } }));
    const result = await fetchGraphProgressive(direct, {}, { onChunk: () => {} });
    expect(result).toMatchObject({ nodes: 2, chunked: false });
  });

  it('fails with the job message and stops when cancelled', async () => {
    const failing = vi.fn(async (path) => (path === '/get_graph' ? { results: { accepted: true, job_id: 'j3' } } : { results: { status: 'failed', error: 'Neo4j unavailable' } }));
    await expect(fetchGraphProgressive(failing, {}, { intervalMs: 0 })).rejects.toThrow();
    const controller = new AbortController();
    const slow = vi.fn(async (path) => (path === '/get_graph' ? { results: { accepted: true, job_id: 'j4' } } : { results: { status: 'running' } }));
    const pending = fetchGraphProgressive(slow, {}, { signal: controller.signal, intervalMs: 50 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('builds production payloads and ids', () => {
    expect(buildChunkPollPath('/jobs/a?x=1', 5)).toBe('/jobs/a?x=1&include_chunks=1&after_event_id=5');
    expect(buildRelationshipPayload('3_17', 'FUND FLOW!')).toEqual({ id: 'relationship', source_id: '3_17', relationship: 'FUNDFLOW' });
    expect(sanitizeRelationship(' * ')).toBe('*');
    expect(graphWindowBackendId('graph-12')).toBe('12');
  });
});

const fakeSocket = () => {
  const handlers = {};
  return {
    connected: true,
    emitted: [],
    on: (event, fn) => { handlers[event] = fn; },
    off: (event) => { delete handlers[event]; },
    emit(event, payload) { this.emitted.push([event, payload]); },
    receive: (event, payload) => handlers[event]?.(payload),
  };
};

describe('graph status service (production graph status socket)', () => {
  it('subscribes once per session, unsubscribes with the last holder', () => {
    const socket = fakeSocket();
    bindGraphStatusSocket(socket);
    const releaseA = retainGraphStatus('3_17');
    const releaseB = retainGraphStatus('3_17');
    expect(socket.emitted.filter(([event]) => event === 'graph_status_subscribe')).toHaveLength(1);
    releaseA();
    expect(socket.emitted.some(([event]) => event === 'graph_status_unsubscribe')).toBe(false);
    releaseB();
    expect(socket.emitted.at(-1)).toEqual(['graph_status_unsubscribe', { session_id: '3_17' }]);
  });

  it('keeps status, metadata and relationships per session', () => {
    const socket = fakeSocket();
    bindGraphStatusSocket(socket);
    retainGraphStatus('s1');
    socket.receive('status', { session_id: 's1', type: 'session_status', data: { status: 'running', run_id: 'r9' } });
    socket.receive('status', { session_id: 's1', type: 'metadata', data: { metadata: { total_nodes: 120 }, summary: { total_relationships: 40 } } });
    socket.receive('status', { session_id: 's1', type: 'relationships', data: [{ type: 'FUND_FLOW', bgcolor: '#ffffff' }, 'SMURFING'] });
    const info = describeGraphSession(getGraphSession('s1'));
    expect(info).toMatchObject({ totalNodes: 120, totalRelationships: 40, relationshipLabels: ['FUND_FLOW', 'SMURFING'] });
    expect(getGraphSession('s1').relationships[0].textcolor).toBe('#333333'); // contrast on a light chip
  });

  it('warns about status errors only for held sessions, once a minute', () => {
    const socket = fakeSocket();
    const notify = vi.fn();
    bindGraphStatusSocket(socket);
    setGraphStatusNotifier(notify);
    socket.receive('status', { session_id: 'free', error: 'down' });
    expect(notify).not.toHaveBeenCalled();
    retainGraphStatus('held');
    socket.receive('status', { session_id: 'held', error: 'down' });
    socket.receive('status', { session_id: 'held', error: 'down' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('re-subscribes on a new socket (token renewal) and clears on terminate', () => {
    bindGraphStatusSocket(fakeSocket());
    retainGraphStatus('s2');
    const renewed = fakeSocket();
    bindGraphStatusSocket(renewed);
    expect(renewed.emitted).toContainEqual(['graph_status_subscribe', { session_id: 's2' }]);
    renewed.receive('status', { session_id: 's2', type: 'relationships', data: ['A'] });
    markGraphSessionTerminated('s2');
    expect(getGraphSession('s2')).toMatchObject({ terminated: true, relationships: [] });
  });

  it('normalises relationship shapes like production', () => {
    expect(normalizeGraphRelationships({ results: { relationships: [{ name: 'X', color: '#000000' }] } })[0]).toMatchObject({ type: 'X', bgcolor: '#000000', textcolor: '#FFFFFF' });
  });
});

describe('graph link flow (production graph_link_form)', () => {
  const streamingTask = (sessionId) => {
    const id = createTask({ origin: TASK_ORIGINS.SOURCE, sourceSessionId: sessionId, windowId: 'source-1' });
    markTaskRunning(id);
    return id;
  };

  it('only links to a streaming source', async () => {
    const notify = vi.fn();
    const apiFetch = vi.fn();
    const ok = await linkGraphToSession({ apiFetch, updateWindowMetadata: vi.fn(), notify, graphWindowId: 'graph-4', sourceSessionId: '1_9' });
    expect(ok).toBe(false);
    expect(apiFetch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Graph link blocked' }));
  });

  it('links with production payload and records the session on the window', async () => {
    streamingTask('1_9');
    const apiFetch = vi.fn(async () => ({ message: 'success' }));
    const updateWindowMetadata = vi.fn();
    const ok = await linkGraphToSession({ apiFetch, updateWindowMetadata, notify: vi.fn(), graphWindowId: 'graph-4', sourceSessionId: '1_9', action: 'Link Analysis' });
    expect(ok).toBe(true);
    expect(apiFetch).toHaveBeenCalledWith('/graph_link', { method: 'POST', body: { id: 'link', source_id: '1_9', graph_window_id: '4' } });
    expect(updateWindowMetadata).toHaveBeenLastCalledWith('graph-4', { metadata: expect.objectContaining({ graphLinkSource: '1_9', graphLinkAction: 'Link Analysis', graphLinking: null }) });
  });

  it('lists only Source windows with a running stream', () => {
    streamingTask('1_9');
    const windows = [
      { id: 'source-1', type: 'source', title: 'Source 1', sourceSessionId: '1_9' },
      { id: 'source-2', type: 'source', title: 'Source 2', sourceSessionId: '2_9' },
    ];
    expect(linkableSources(windows).map((item) => item.windowId)).toEqual(['source-1']);
  });

  it('finds the Source window from a typed window ID (production graph_link_form)', () => {
    const windows = [
      { id: 'graph-1', type: 'graph', title: 'Graph 1' },
      { id: 'source-1', type: 'source', title: 'Source 1_9', sourceSessionId: '1_9', backendWindowId: 'w-77' },
    ];
    expect(resolveSourceWindow('1_9', windows)?.id).toBe('source-1');
    expect(resolveSourceWindow(' source-1 ', windows)?.id).toBe('source-1');
    expect(resolveSourceWindow('w-77', windows)?.id).toBe('source-1');
    expect(resolveSourceWindow('source 1_9', windows)?.id).toBe('source-1');
    expect(resolveSourceWindow('graph-1', windows)).toBeNull();
    expect(resolveSourceWindow('', windows)).toBeNull();
  });

  it('unlinks and resets the window whatever the backend answers', async () => {
    const store = getGraphStore('graph-4');
    store.replace({ nodes: [{ id: 1 }] });
    const updateWindowMetadata = vi.fn();
    await unlinkGraph({ apiFetch: vi.fn(async () => { throw new Error('down'); }), updateWindowMetadata, graphWindowId: 'graph-4', sourceSessionId: '1_9' });
    expect(store.getSnapshot().nodes).toBe(0);
    expect(updateWindowMetadata).toHaveBeenCalledWith('graph-4', { metadata: expect.objectContaining({ graphLinkSource: null }) });
  });
});
