import { describe, expect, it } from 'vitest';

import {
  buildArrayDataframePayload,
  buildToolConnectPayload,
  normalizeSearchResponse,
  searchSourceFiles,
  storageFileKey,
  toHybridResultItem,
} from './sourceApi.js';

describe('buildToolConnectPayload', () => {
  const base = { sourceSessionId: '1_42', url: 'bolt://h:7687', username: 'neo4j', database: 'neo4j' };

  it('sends a typed password as-is', () => {
    const built = buildToolConnectPayload({ ...base, password: 'secret' });
    expect(built.ok).toBe(true);
    expect(built.payload).toMatchObject({ password: 'secret', session_id: '1_42', source_id: '1_42' });
    expect(built.payload).not.toHaveProperty('password_ref');
  });

  it('resolves a masked password through password_ref', () => {
    const built = buildToolConnectPayload({ ...base, password: '***', passwordRef: 'ref-1' });
    expect(built.ok).toBe(true);
    expect(built.payload.password_ref).toBe('ref-1');
  });

  it('sends a masked password without a ref as empty: the Service uses the saved one (H-10)', () => {
    const built = buildToolConnectPayload({ ...base, password: '***' });
    expect(built.ok).toBe(true);
    expect(built.payload.password).toBe('');
    expect(built.payload.password_ref).toBeUndefined();
  });
});

describe('normalizeSearchResponse', () => {
  it('unwraps the queued-job envelope and reads paging', () => {
    const normalized = normalizeSearchResponse({ results: { result: { results: [{ name: 'a' }], has_more: 1, next_offset: 50 } } });
    expect(normalized.results).toHaveLength(1);
    expect(normalized.hasMore).toBe(true);
    expect(normalized.nextOffset).toBe(50);
  });

  it('reports no cursor when the backend sends none', () => {
    expect(normalizeSearchResponse({ results: [] }).nextOffset).toBeNull();
  });

  it('keeps raw-search diagnostics', () => {
    const normalized = normalizeSearchResponse({ data: { results: [], base_path: '/user/bank', errors: ['404'] } });
    expect(normalized.diagnostics).toMatchObject({ basePath: '/user/bank', errors: ['404'] });
  });
});

describe('create_DF payloads', () => {
  it('builds the production array shape', () => {
    expect(buildArrayDataframePayload({ sourceSessionId: '1_42', kind: 'hybrid', items: [{ name: 'x' }] }))
      .toEqual({ id: 'create_DF', type: 'array', kind: 'hybrid', session_id: '1_42', value: [{ name: 'x' }] });
  });

  it('maps hybrid results with fallbacks for strict/column', () => {
    expect(toHybridResultItem({ name: 'n', size: 3 }, { strict: true, column: 'ACCOUNTNO' }))
      .toEqual({ name: 'n', keyword: '', size: 3, strict: true, type: '', column: 'ACCOUNTNO' });
  });

  it('keys storage files by name and size', () => {
    expect(storageFileKey({ name: 'a.parquet', size: 10 })).toBe('a.parquet__10');
  });
});

describe('streaming payloads', async () => {
  const { buildStreamPayload, resolveStreamLogFile, startStreamRequest, endStreamRequest } = await import('./sourceApi.js');

  it('builds the production stream body; source/target only for that action', () => {
    const linkAnalysis = buildStreamPayload({ sourceSessionId: '1_42', mode: 'batch', tool: 'neo4j', action: 'Link Analysis', rule: 'R1' });
    expect(linkAnalysis).toMatchObject({ id: 'stream', session_id: '1_42', mode: 'batch', value: { window_id: '1_42', action: 'Link Analysis', rule: 'R1', tool: 'neo4j' } });
    expect(linkAnalysis.value).not.toHaveProperty('source');
    const mapping = buildStreamPayload({ sourceSessionId: '1_42', mode: 'realtime', tool: 'neo4j', action: 'Source / Target Relationship', source: 'A', target: 'B' });
    expect(mapping.value).toMatchObject({ source: 'A', target: 'B', relationship: 'HAS_RELATIONSHIP', source_mode: 'realtime' });
  });

  it('finds the log file in the response shapes production handles', () => {
    expect(resolveStreamLogFile({ results: 'a.log' })).toBe('a.log');
    expect(resolveStreamLogFile({ results: { log_file: 'b.log' } })).toBe('b.log');
    expect(resolveStreamLogFile({ job: { payload: { logFile: 'c.log' } } })).toBe('c.log');
  });

  it('treats a queued job as accepted and reports rejections', async () => {
    const queued = await startStreamRequest(async () => ({ results: { accepted: true, job_id: 'j1' } }), {});
    expect(queued).toMatchObject({ accepted: true, queued: true, pollPath: '/jobs/j1', jobId: 'j1' });
    const rejected = await startStreamRequest(async () => ({ message: 'Invalid stream value' }), {});
    expect(rejected).toMatchObject({ accepted: false, message: 'Streaming settings were incomplete.' });
  });

  it('sends end_session with the log file', async () => {
    let body;
    const result = await endStreamRequest(async (_path, options) => { body = options.body; return { message: 'success' }; }, { sourceSessionId: '1_42', logFile: 'run.log' });
    expect(result.ok).toBe(true);
    expect(body).toEqual({ id: 'end_session', session_id: '1_42', value: { window_id: '1_42', session_id: '1_42', log_file: 'run.log' } });
  });
});

describe('search date range', () => {
  const capture = () => {
    const calls = [];
    const apiFetch = async (path, options) => { calls.push(options.body); return { message: 'success', results: [] }; };
    return { calls, apiFetch };
  };

  it('sends start/end dates and fills date for a one-day range', async () => {
    const { calls, apiFetch } = capture();
    await searchSourceFiles(apiFetch, { sourceSessionId: 's1', keyword: 'k', hybrid: true, dateFrom: '2026-01-05', dateTo: '2026-01-05' });
    expect(calls[0].value).toMatchObject({ date: '2026-01-05', start_date: '2026-01-05', end_date: '2026-01-05' });
  });

  it('does not narrow open or multi-day ranges to one day', async () => {
    const { calls, apiFetch } = capture();
    await searchSourceFiles(apiFetch, { sourceSessionId: 's1', keyword: 'k', hybrid: true, dateFrom: '2026-01-05' });
    await searchSourceFiles(apiFetch, { sourceSessionId: 's1', keyword: 'k', hybrid: true, dateFrom: '2026-01-01', dateTo: '2026-01-31' });
    expect(calls[0].value).toMatchObject({ date: null, start_date: '2026-01-05', end_date: null });
    expect(calls[1].value).toMatchObject({ date: null, start_date: '2026-01-01', end_date: '2026-01-31' });
  });

  it('keeps the single-date payload unchanged when no range is given', async () => {
    const { calls, apiFetch } = capture();
    await searchSourceFiles(apiFetch, { sourceSessionId: 's1', keyword: 'k', date: '2026-02-02' });
    expect(calls[0].value.date).toBe('2026-02-02');
    expect(calls[0].value).not.toHaveProperty('start_date');
  });
});
