import { describe, expect, it, vi } from 'vitest';

import { isSuccessResponse } from './apiClient.js';
import { uploadRule } from './configurationApi.js';
import { createDataframe, startStreamRequest } from './sourceApi.js';

describe('a refusal answered as HTTP 200 (audit B4)', () => {
  it.each([
    { message: 'failed!', results: 'Action failed: no dataframe' },
    { status: 'error', results: {} },
    { success: false, results: {} },
  ])('%j is not a success', (data) => {
    expect(isSuccessResponse(data)).toBe(false);
  });
  it('still reads the Service’s successes', () => {
    expect(isSuccessResponse({ message: 'success' })).toBe(true);
    expect(isSuccessResponse({ results: { a: 1 } })).toBe(true);
    expect(isSuccessResponse({ message: 'Connection established!', results: {} })).toBe(true);
  });
  it('a refused stream is not accepted, a refused dataframe not ready', async () => {
    expect((await startStreamRequest(async () => ({ message: 'failed!', results: 'Action failed: no dataframe' }), {})).accepted).toBe(false);
    expect((await createDataframe(async () => ({ message: 'failed!', results: { failed_sources: ['a.csv'] } }), {})).ok).toBe(false);
  });
  it('a dataframe made without some sources says which', async () => {
    const result = await createDataframe(async () => ({ message: 'success', results: { columns: ['A'], total_rows: 1, failed_sources: ['b.csv'] } }), {});
    expect(result).toMatchObject({ ok: true, failedSources: ['b.csv'] });
  });
});

it('a rule upload never posts lists of objects as text (audit C1)', async () => {
  const apiFetch = vi.fn(async () => ({ message: 'success' }));
  await uploadRule(apiFetch, '9', { file: new Blob(['x']), ruleName: 'r', fields: { trusted_entities: [{ value: '1' }], risk_entities: [], column_mapping: { A: 'B' }, kafka_topics: ['a', 'b'], domain: 'bank' } });
  const sent = Object.fromEntries([...apiFetch.mock.calls[0][1].body.entries()].filter(([, value]) => typeof value === 'string'));
  expect(JSON.stringify(sent)).not.toContain('[object');
  expect(sent).toMatchObject({ kafka_topics: 'a, b', domain: 'bank' });
  expect(sent).not.toHaveProperty('trusted_entities');
  expect(sent).not.toHaveProperty('column_mapping');
});
