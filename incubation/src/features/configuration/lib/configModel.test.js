import { describe, expect, it } from 'vitest';

import {
  getRegisteredDomains,
  applyConfigurationChange,
  buildConfigurationSavePayload,
  checkIsBuiltinRule,
  normalizeLoadedConfiguration,
  preserveDomainRegistry,
} from './configModel.js';

describe('normalizeLoadedConfiguration', () => {
  it('folds a pending custom value into the option list and masks secrets', () => {
    const normalized = normalizeLoadedConfiguration({
      kafka_addresses: ['10.0.0.1:9092'],
      active_kafka_adress: '10.0.0.1:9092',
      kafka_custom_address: '10.0.0.2:9092',
      active_tool_password: { masked: '****', password_ref: 'ref123' },
      domain: 'bank',
    });
    expect(normalized.active_kafka_adress).toBe('10.0.0.2:9092');
    expect(normalized.kafka_addresses).toEqual(['10.0.0.2:9092', '10.0.0.1:9092']);
    expect(normalized.kafka_custom_address).toBe('');
    expect(normalized.active_tool_password).toBe('****');
    expect(normalized.active_tool_password_ref).toBe('ref123');
    expect(normalized.active_domain).toBe('bank');
  });
});

describe('buildConfigurationSavePayload', () => {
  const base = normalizeLoadedConfiguration({
    active_tool_password: '***',
    active_tool_password_ref: 'ref',
    domain_connections: { bank: {} },
    registered_domains: ['bank'],
    trusted_entities: [{ key: 'ACC', value: '1' }],
    storage_tables: ['a', ' b ', ''],
    column_mapping: [{ key: 'K', value: 'V' }, { key: '', value: '' }],
  });

  it('never sends masked secrets, refs or the backend-owned registry', () => {
    const payload = buildConfigurationSavePayload(base);
    expect(payload).not.toHaveProperty('active_tool_password');
    expect(payload).not.toHaveProperty('active_tool_password_ref');
    expect(payload).not.toHaveProperty('domain_connections');
    expect(payload).not.toHaveProperty('registered_domains');
  });

  it('cleans lists and mappings', () => {
    const payload = buildConfigurationSavePayload(base);
    expect(payload.storage_tables).toEqual(['a', 'b']);
    // The domain's own: never sent with the configuration (round 3, C1).
    expect(payload).not.toHaveProperty('column_mapping');
    expect(payload.trusted_entities[0]).toMatchObject({ key: 'ACC', value: '1', category: 'Trusted' });
  });

  it('sends a typed password and an explicit clear as null', () => {
    expect(buildConfigurationSavePayload({ ...base, active_tool_password: 'new-pass' }).active_tool_password).toBe('new-pass');
    expect(buildConfigurationSavePayload({ ...base, active_tool_password_clear: true }).active_tool_password).toBeNull();
  });
});

describe('applyConfigurationChange', () => {
  it('keeps linked fields in step', () => {
    expect(applyConfigurationChange({}, 'active_domain', 'cdr').domain).toBe('cdr');
    expect(applyConfigurationChange({}, 'large_search_backend', 'elastic_scroll').elastic_scroll_enabled).toBe(true);
    expect(applyConfigurationChange({}, 'storage_tables', 'a, b').storage_tables).toEqual(['a', 'b']);
  });
});

describe('preserveDomainRegistry', () => {
  it('re-attaches the registry when a save response omits it', () => {
    const merged = preserveDomainRegistry({ domain_connections: { bank: {}, cdr: {} } }, { active_domain: 'cdr' });
    expect(Object.keys(merged.domain_connections)).toEqual(['bank', 'cdr']);
  });
});

describe('checkIsBuiltinRule', () => {
  it('detects built-in rules from flags, lists and known names', () => {
    expect(checkIsBuiltinRule({ name: 'x', is_builtin: true }, {}, new Set())).toBe(true);
    expect(checkIsBuiltinRule('R1', { builtin_rules: ['r1'] }, new Set())).toBe(true);
    expect(checkIsBuiltinRule('custom', { custom_rules: ['custom'] }, new Set())).toBe(false);
    expect(checkIsBuiltinRule('known', {}, new Set(['known']))).toBe(true);
  });
});

describe('getRegisteredDomains', () => {
  it('lists every domain the Service names, once', () => {
    expect(getRegisteredDomains({ active_domain: 'bank', registered_domains: ['bank'], domain_connections: { bank: {}, cdr: {} } })).toEqual(['bank', 'cdr']);
    expect(getRegisteredDomains({ active_domain: 'bank', registered_domains: ['banking', 'cdr'] })).toEqual(['bank', 'cdr']);
    expect(getRegisteredDomains({ active_domain: 'insurance', domain_connections: { cdr: {} } })).toEqual(['cdr', 'insurance']);
  });

  it('falls back to the known domains when the Service names none', () => {
    expect(getRegisteredDomains({})).toEqual(['bank', 'microfinance', 'cdr', 'insurance', 'social_media']);
  });
});
