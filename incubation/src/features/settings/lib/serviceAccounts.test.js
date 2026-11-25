import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildServiceConfigPayload,
  generateClientSecret,
  normalizeServiceAccountList,
  parseCatalogDomains,
  tryGenerateClientSecret,
} from './serviceAccounts.js';

describe('normalizeServiceAccountList', () => {
  it('never keeps token values, only whether one is saved', () => {
    const [account] = normalizeServiceAccountList({ results: [{ id: 1, client_id: 'svc', config: { domains: { bank: { auth_token: 'abc' } } } }] });
    expect(account.config.domains.bank.auth_token).toBe('');
    expect(account.config.domains.bank.auth_token_set).toBe(true);
    expect(account.config.registered_domains).toEqual(['bank']);
  });
});

describe('buildServiceConfigPayload', () => {
  const config = (domain) => ({ registered_domains: ['bank'], domains: { bank: { storage_host: 'h', ...domain } } });

  it('omits an untouched token so the backend keeps it', () => {
    expect(buildServiceConfigPayload(config({ auth_token: '' })).domains.bank).not.toHaveProperty('auth_token');
    expect(buildServiceConfigPayload(config({ auth_token: '***' })).domains.bank).not.toHaveProperty('auth_token');
  });

  it('sends a typed token, and null for an explicit clear', () => {
    expect(buildServiceConfigPayload(config({ auth_token: 'tok' })).domains.bank.auth_token).toBe('tok');
    expect(buildServiceConfigPayload(config({ auth_token_clear: true })).domains.bank.auth_token).toBeNull();
  });

  it('keeps unregistered domain configs (non-destructive)', () => {
    const payload = buildServiceConfigPayload(config({}), { cdr: { storage_port: '5009' } });
    expect(Object.keys(payload.domains)).toEqual(['bank', 'cdr']);
    expect(payload.domains.bank.storage_port).toBe('5000');
  });
});

describe('parseCatalogDomains', () => {
  it('accepts the catalog shapes production handles', () => {
    expect(parseCatalogDomains({ domains: [{ domain: 'Bank' }, 'cdr'] })).toEqual(['bank', 'cdr']);
    expect(parseCatalogDomains({ domains: { insurance: {} } })).toEqual(['insurance']);
  });
});

describe('client secret generation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('produces 48 hex characters', () => {
    vi.stubGlobal('window', { crypto: globalThis.crypto });
    expect(generateClientSecret()).toMatch(/^[0-9a-f]{48}$/);
  });

  it('fails closed without secure randomness', () => {
    vi.stubGlobal('window', {});
    expect(() => generateClientSecret()).toThrow();
    expect(tryGenerateClientSecret()).toBe('');
  });
});

it('aliases are read, and only the Service’s own names are sent (R2-22)', () => {
  const [account] = normalizeServiceAccountList([{ id: 1, client_id: 'x', config: { registered_domains: ['banking', 'telecom', 'bank'], domains: { banking: { storage_host: 'old' }, bank: { storage_host: 'own' }, mfi: { storage_host: 'm' } } } }]);
  expect(account.config.registered_domains).toEqual(['bank', 'cdr']);
  expect(Object.fromEntries(Object.entries(account.config.domains).map(([key, value]) => [key, value.storage_host]))).toEqual({ bank: 'own', microfinance: 'm' });
  expect(Object.keys(buildServiceConfigPayload({ registered_domains: ['banking'], domains: {} }, {}).domains)).toEqual(['bank']);
});
