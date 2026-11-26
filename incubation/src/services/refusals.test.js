import { describe, expect, it, vi } from 'vitest';

import { isSuccessResponse } from './apiClient.js';
import { getServiceRefusalMessage } from './apiErrors.js';
import { parseAuthResponse } from './authApi.js';
import { saveConfiguration, uploadRule } from './configurationApi.js';
import { buildRuleUploadFields } from '../features/libraries/lib/rulesLibrary.js';
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

describe('round 3 (2026-11-25)', () => {
  const refusal = (data) => getServiceRefusalMessage({ status: 400, data });
  it('words the new refusals', () => {
    expect(refusal({ code: 'rule_not_available', rule: 'R1' })).toContain('“R1”');
    expect(refusal({ code: 'no_data' })).toMatch(/no data/);
    expect(refusal({ message: 'domain_not_granted', domain: 'cdr' })).toBe('You don’t have access to the domain “cdr”.');
    expect(refusal({ code: 'required_field_removed', fields: [['AMOUNT', 'AMOUNTINBIRR']] })).toContain('AMOUNT, AMOUNTINBIRR');
    expect(refusal({ code: 'configuration_changed', changed: ['column_mapping'] })).toMatch(/column mapping has changed/);
    expect(refusal({ code: 'configuration_changed', dataframe_domain: 'bank' })).toMatch(/made under bank/);
  });

  it('a save says which saved passwords were dropped', async () => {
    const result = await saveConfiguration(async () => ({ message: 'success', credentials_cleared: ['domain_connections.bank.auth_token'] }), '1', {});
    expect(result.credentialsCleared).toEqual(['domain_connections.bank.auth_token']);
    expect((await saveConfiguration(async () => ({ message: 'success' }), '1', {})).credentialsCleared).toEqual([]);
  });

  it('a rule upload sends neither the column lists nor the column mapping', () => {
    const fields = buildRuleUploadFields({ domain: 'bank', fetch_columns: ['A'], search_columns_strict: ['B'], search_columns_fuzzy: [], column_mapping: { A: 'B' }, kafka_topics: ['t'] });
    ['fetch_columns', 'search_columns_strict', 'search_columns_fuzzy', 'column_mapping'].forEach((key) => expect(fields).not.toHaveProperty(key));
    expect(fields.domain).toBe('bank');
  });

  it('reads the granted domains beside the actor, null for all', () => {
    const me = (more) => parseAuthResponse({ actor: { username: 'a', permissions: [] }, ...more }, 't').user.allowed_domains;
    expect(me({ allowed_domains: ['Bank'], domain_access_enforced: true })).toEqual(['bank']);
    expect(me({ allowed_domains: ['bank'], domain_access_enforced: false })).toBeNull();
    expect(me({ allowed_domains: null })).toBeNull();
    expect(me({})).toBeNull();
  });
});
