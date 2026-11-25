// The graph is whole, and says so when it is not
// (docs/integrity-audit-2026-11-24.md D1, D2, D3, D6, D7, D9, D10).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../../../services/apiClient.js';
import { fetchGraph, fetchGraphProgressive, parseMaybeSerializedGraphPayload } from '../../../services/graphApi.js';
import { runGraphFetch } from './graphFetchRunner.js';
import { graphDataNotice } from './graphDataNotice.js';
import { linkGraphToSession } from './graphLinkFlow.js';
import { clearGraphStores, createGraphStore, getGraphStore } from './graphStore.js';

afterEach(() => {
  clearGraphStores();
  vi.unstubAllGlobals();
});

// A queued graph job answering these polls in turn (the last one again).
const job = (...polls) => {
  const calls = [];
  const apiFetch = async (path) => {
    calls.push(path);
    if (path === '/get_graph') return { results: { accepted: true, job_id: 'j' } };
    const poll = polls.length > 1 ? polls.shift() : polls[0];
    if (poll instanceof Error) throw poll;
    return { results: poll };
  };
  return { apiFetch, calls };
};
const nodes = (...ids) => ids.map((id) => ({ id }));
const chunk = (event_id, ids, edges = []) => ({ event_id, nodes: nodes(...ids), edges });
const fast = { intervalMs: 0 };

describe('a chunked job (D1, D3, D7)', () => {
  it('that delivered less than it announced is partial', async () => {
    const { apiFetch } = job({ status: 'succeeded', chunks: [chunk(1, ['a', 'b'])], result: { total_nodes: 500, total_edges: 0 } }, { status: 'succeeded', chunks: [] });
    expect(await fetchGraphProgressive(apiFetch, {}, fast)).toMatchObject({ nodes: 2, partial: true, expected: { nodes: 500, edges: 0 } });
  });

  it('is read until it brings nothing new', async () => {
    const { apiFetch, calls } = job(
      { status: 'succeeded', chunks: [chunk(1, ['a'])] },
      { status: 'succeeded', chunks: [chunk(2, ['b'])] },
      { status: 'succeeded', chunks: [] },
    );
    expect(await fetchGraph(apiFetch, {}, fast)).toMatchObject({ nodes: nodes('a', 'b'), partial: false });
    expect(calls).toHaveLength(4);
  });

  it('whose last check fails is partial unless its totals were met', async () => {
    const lost = new Error('network');
    expect((await fetchGraph(job({ status: 'succeeded', chunks: [chunk(1, ['a'])] }, lost).apiFetch, {}, fast)).partial).toBe(true);
    expect((await fetchGraph(job({ status: 'succeeded', chunks: [chunk(1, ['a'])], result: { total_nodes: 1, total_edges: 0 } }, lost).apiFetch, {}, fast)).partial).toBe(false);
  });

  it('that sends a chunk again does not double it', async () => {
    const again = chunk(1, ['a', 'b'], [{ from: 'a', to: 'b' }]);
    const { apiFetch } = job({ status: 'running', chunks: [again] }, { status: 'succeeded', chunks: [again] });
    expect((await fetchGraph(apiFetch, {}, fast)).edges).toHaveLength(1);
  });

  it('with only empty chunks and the graph in its result is read from there', async () => {
    const { apiFetch } = job({ status: 'succeeded', chunks: [chunk(1, [])], result: { nodes: nodes('a'), edges: [] } }, { status: 'succeeded', chunks: [], result: { nodes: nodes('a'), edges: [] } });
    expect((await fetchGraph(apiFetch, {}, fast)).nodes).toHaveLength(1);
  });

  it('answering nothing readable fails for a report', async () => {
    await expect(fetchGraph(job({ status: 'succeeded', error_message: 'x' }).apiFetch, {}, fast)).rejects.toThrow();
  });
});

describe('loading into a window (D1, D6)', () => {
  it('a partial graph is marked', async () => {
    const store = createGraphStore();
    const { apiFetch } = job({ status: 'succeeded', chunks: [chunk(1, ['a', 'b'])], result: { total_nodes: 9, total_edges: 1 } }, { status: 'succeeded', chunks: [] });
    await runGraphFetch({ store, apiFetch, payload: {}, source: 'relationship' });
    expect(store.getStatus()).toMatchObject({ state: 'ready', partial: true, expected: { nodes: 9, edges: 1 }, received: { nodes: 2, edges: 0 } });
    expect(graphDataNotice(store.getSnapshot(), {}, 'all').label).toBe('Incomplete');
  });

  it('a load that brought nothing keeps the graph before it, when the caller says so', async () => {
    const store = createGraphStore();
    const good = async () => ({ results: { graph: { nodes: nodes('a'), edges: [] } } });
    const bad = async () => { throw new Error('down'); };
    await runGraphFetch({ store, apiFetch: good, payload: {}, source: 'relationship' });
    await runGraphFetch({ store, apiFetch: bad, payload: {}, source: 'relationship', onFailed: () => true });
    expect(store.getStatus().state).toBe('ready');
    await runGraphFetch({ store, apiFetch: bad, payload: {}, source: 'relationship' });
    expect(store.getStatus().state).toBe('error');
  });

  it('hands over what the Service sent, not what was edited since', async () => {
    const store = createGraphStore();
    let raw;
    const { apiFetch } = job({ status: 'succeeded', chunks: [chunk(1, ['a'])], result: { total_nodes: 1, total_edges: 0 } });
    await runGraphFetch({ store, apiFetch, payload: {}, source: 'evidence', onFirstChunk: () => store.patchNodes([['a', { label: 'mine' }]]), onLoaded: (result) => { raw = result.raw(); } });
    expect(raw.nodes).toEqual([{ id: 'a' }]);
  });

  it('undo cannot drop a chunk that came after', () => {
    const store = createGraphStore();
    store.replace({ nodes: nodes('a') });
    store.recordHistory({});
    store.mergeChunk({ nodes: nodes('b') });
    expect(store.getSnapshot().history.canUndo).toBe(false);
    store.undo({});
    expect(store.graph().hasNode('b')).toBe(true);
  });
});

describe('the store', () => {
  it('draws a link whose end comes later, and counts those that never do (D2)', () => {
    const store = createGraphStore();
    store.replace({ nodes: nodes('a'), edges: [{ id: 1, from: 'a', to: 'b' }, { id: 2, from: 'a', to: 'z' }] });
    expect(store.getSnapshot()).toMatchObject({ edges: 0, danglingEdges: 2 });
    store.mergeChunk({ nodes: nodes('b') });
    expect(store.getSnapshot()).toMatchObject({ edges: 1, danglingEdges: 1 });
    store.replace({ nodes: nodes('a') });
    expect(store.getSnapshot().danglingEdges).toBe(0);
  });

  it('keeps two links with one id and other ends (D7)', () => {
    const store = createGraphStore();
    store.replace({ nodes: nodes('a', 'b', 'c'), edges: [{ id: 7, from: 'a', to: 'b', amount: 1 }, { id: 7, from: 'b', to: 'c', amount: 2 }, { id: 7, from: 'a', to: 'b', amount: 3 }] });
    expect(store.graph().mapEdges((key, attributes) => attributes.amount).sort()).toEqual([2, 3]);
  });

  it('orders at any size, and counts every match (D9)', () => {
    const store = createGraphStore();
    store.replace({ nodes: Array.from({ length: 10500 }, (_, i) => ({ id: `n${i}`, amount: i, kind: i % 2 ? 'odd' : 'even' })) });
    expect(store.visibleView({ key: 'amount', sort: 'desc', min: 0, max: 2 }).nodeIds).toEqual(['n10499', 'n10498']);
    const found = store.searchView({ keyword: 'odd', min: 0, max: 25 });
    expect(found.nodeIds).toHaveLength(25);
    expect(found.matches).toBe(5250);
  });
});

describe('ids (D7)', () => {
  it('the client keeps long whole numbers exactly', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"nodes":[{"id":9007199254740993},{"id":9007199254740992}]}', { status: 200 }));
    const data = await createApiClient({ baseUrl: '', getToken: () => '' })('/x');
    const store = createGraphStore();
    store.replace(data);
    expect(store.graph().nodes()).toEqual(['9007199254740993', '9007199254740992']);
  });
});

describe('Python-style answers (D10)', () => {
  it('never change what is inside a text', () => {
    const answer = `{'nodes': [{'id': 1, 'label': "Abebe's None Trading", 'note': 'True "x" \\'y\\' \\xe9', 'at': datetime.datetime(2026, 1, 2, 3, 4), 'v': None, 'n': nan, 'i': -inf, 'ok': True}], 'edges': []}`;
    expect(parseMaybeSerializedGraphPayload(answer).nodes[0]).toEqual({
      id: 1, label: "Abebe's None Trading", note: 'True "x" \'y\' é', at: 'datetime.datetime(2026, 1, 2, 3, 4)', v: null, n: null, i: null, ok: true,
    });
  });
});

describe('linking (D5)', () => {
  it('drops a graph loaded for something else, keeps one started here', async () => {
    const link = () => linkGraphToSession({ apiFetch: async () => ({ message: 'success' }), updateWindowMetadata: () => {}, graphWindowId: 'graph-1', sourceSessionId: '1_9', finishedRun: true });
    const store = getGraphStore('graph-1');
    store.replace({ nodes: nodes('old') });
    store.setStatus({ state: 'ready', source: 'relationship' });
    await link();
    expect(store.getSnapshot().nodes).toBe(0);
    store.replace({ nodes: nodes('mine') });
    await link();
    expect(store.getSnapshot().nodes).toBe(1);
  });
});

it('a companion says when what is drawn is older than the data (E11)', () => {
  const store = createGraphStore();
  store.replace({ nodes: nodes('a') });
  store.setStatus({ state: 'ready' });
  const link = { dataVersion: store.getSnapshot().dataVersion };
  expect(graphDataNotice(store.getSnapshot(), link, 'drawn')).toBeNull();
  store.mergeChunk({ nodes: nodes('b') });
  expect(graphDataNotice(store.getSnapshot(), link, 'drawn').label).toBe('Out of date');
  expect(graphDataNotice(store.getSnapshot(), link, 'all')).toBeNull();
});

it('a graph no longer wanted has its job cancelled (B-7)', async () => {
  const store = createGraphStore();
  const { apiFetch, calls } = job({ status: 'running', chunks: [] });
  const pending = runGraphFetch({ store, apiFetch, payload: {}, source: 'relationship' });
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  store.abortFetch();
  await pending;
  expect(calls).toContain('/jobs/j/cancel');
});
