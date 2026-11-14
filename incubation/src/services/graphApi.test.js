import { describe, expect, it, vi } from 'vitest';

import { buildEvidencePayload, fetchGraph, parseMaybeSerializedGraphPayload } from './graphApi.js';

describe('graphApi', () => {
  it('builds the whitelisted evidence payload', () => {
    expect(buildEvidencePayload('t1', { id: 5, externalReferenceId: 'R9' }))
      .toEqual({ id: 'evidence', trace_id: 't1', source_id: 't1', report_id: '5', external_reference_id: 'R9' });
  });

  it('returns nodes and edges from a direct answer', async () => {
    const apiFetch = vi.fn(async () => ({ results: { graph: { nodes: [{ id: 1 }], edges: [] } } }));
    const graph = await fetchGraph(apiFetch, { id: 'evidence' });
    expect(apiFetch).toHaveBeenCalledWith('/get_graph', expect.objectContaining({ method: 'POST', body: { id: 'evidence' } }));
    expect(graph.nodes).toHaveLength(1);
  });

  it('follows a queued job', async () => {
    const onQueued = vi.fn();
    const apiFetch = vi.fn(async (path) => (path === '/get_graph'
      ? { results: { accepted: true, job_id: 'j1' } }
      : { status: 'completed', result: { nodes: [{ id: 1 }, { id: 2 }], edges: [{ from: 1, to: 2 }] } }));
    const graph = await fetchGraph(apiFetch, {}, { onQueued });
    expect(onQueued).toHaveBeenCalled();
    expect(apiFetch).toHaveBeenLastCalledWith('/jobs/j1', expect.anything());
    expect(graph.edges).toHaveLength(1);
  });

  it('rejects with the backend message when there is no graph', async () => {
    const apiFetch = vi.fn(async () => ({ message: 'Evidence not found' }));
    await expect(fetchGraph(apiFetch, {})).rejects.toThrow('Evidence not found');
  });

  it('reads Python dict reprs from workers', () => {
    expect(parseMaybeSerializedGraphPayload("{'nodes': [], 'ok': True, 'x': None}")).toEqual({ nodes: [], ok: true, x: null });
  });
});
