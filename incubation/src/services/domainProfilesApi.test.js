import { describe, expect, it, vi } from 'vitest';

import { createDomain, fetchDomains, patchDomainProfile, readProfile, readRuleSet } from './domainProfilesApi.js';

describe('domain profiles · routes (round 4, proposed)', () => {
  it('reads the list of domains; a Service without the route is "not available"', async () => {
    const apiFetch = vi.fn(async () => ({ results: [{ domain_id: 'Bank', display_name: 'Banking', active: true, origin: 'builtin', rule_set: 'bank_rules', profile_version_id: 3 }, { nope: 1 }] }));
    expect(await fetchDomains(apiFetch)).toEqual({ available: true, domains: [{ id: 'bank', displayName: 'Banking', description: '', active: true, origin: 'builtin', ruleSet: 'bank_rules', profileVersionId: 3 }] });
    const missing = vi.fn(async () => { throw Object.assign(new Error('Not found'), { status: 404, data: {} }); });
    expect(await fetchDomains(missing)).toEqual({ available: false });
    const down = vi.fn(async () => { throw Object.assign(new Error('x'), { status: 500 }); });
    await expect(fetchDomains(down)).rejects.toThrow();
  });

  it('reads a rule set and a profile with its editable fields and origins', () => {
    expect(readRuleSet({ name: 'bank_rules', required_fields: [['ACCOUNTNO'], ['AMOUNTINBIRR', 'AMOUNT']], relationships: ['SMURFING', { name: 'LAYERING' }] })).toMatchObject({ requiredFields: [['ACCOUNTNO'], ['AMOUNTINBIRR', 'AMOUNT']], relationships: ['SMURFING', 'LAYERING'] });
    const profile = readProfile({ results: { domain_id: 'bank', version_id: 4, profile: { display_name: 'Banking' }, editable: { display_name: { type: 'text', max_length: 120 }, rule_set: { allowed_values: ['a', 'b'] } }, origins: { display_name: 'superuser' } } });
    expect(profile).toMatchObject({ domainId: 'bank', versionId: 4, versioned: true, fields: { display_name: 'Banking' }, origins: { display_name: 'superuser' } });
    expect(profile.editable.display_name.maxLength).toBe(120);
    expect(profile.editable.rule_set.allowed).toEqual(['a', 'b']);
  });

  it('sends version_id and dry_run, and reads a conflict', async () => {
    const apiFetch = vi.fn(async () => ({ changed: { node_label: ['Account', 'Acct'] } }));
    expect(await patchDomainProfile(apiFetch, 'bank', { node_label: 'Acct' }, 4, { dryRun: true })).toEqual({ ok: true, profile: null, preview: [{ key: 'node_label', from: 'Account', to: 'Acct' }], warnings: [] });
    expect(apiFetch).toHaveBeenCalledWith('/domains/bank/profile', { method: 'PATCH', body: { node_label: 'Acct', version_id: 4, dry_run: true } });
    const conflict = vi.fn(async () => { throw Object.assign(new Error('c'), { status: 409, data: { code: 'version_conflict', current: { version_id: 5, profile: {}, editable: {}, updated_by: 'su' } } }); });
    expect(await patchDomainProfile(conflict, 'bank', {}, 4)).toMatchObject({ ok: false, conflict: { versionId: 5, updatedBy: 'su' } });
    const noVersion = vi.fn(async () => ({}));
    await patchDomainProfile(noVersion, 'bank', { a: 1 }, undefined);
    expect(noVersion.mock.calls[0][1].body).toEqual({ a: 1 });
  });

  it('creates a domain', async () => {
    const apiFetch = vi.fn(async () => ({ results: { domain: { domain_id: 'retail', display_name: 'Retail', origin: 'created' }, state: { domain_id: 'retail', version_id: 1, profile: { display_name: 'Retail' }, editable: {} }, copied_from: 'bank', copied: ['thresholds', 'mapping'] } }));
    const result = await createDomain(apiFetch, { domain_id: 'retail', display_name: 'Retail', rule_set: 'bank_rules', copy_from: 'bank' });
    expect(result.domain).toMatchObject({ id: 'retail', origin: 'created', active: true });
    expect(result).toMatchObject({ copied: ['thresholds', 'mapping'], copiedFrom: 'bank', profile: { fields: { display_name: 'Retail' } } });
    expect(apiFetch.mock.calls[0][1].body).not.toHaveProperty('dry_run');
  });
});
