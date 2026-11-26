import { describe, expect, it } from 'vitest';

import { changedFields, copyCandidates, domainIdProblem, fieldProblem, parseFieldInput } from './domainProfile.js';

describe('domain profiles · what may be typed', () => {
  it('checks a new domain id: form, existing ids and aliases', () => {
    expect(domainIdProblem('', [])).toMatch(/Give/);
    expect(domainIdProblem('B', [])).toMatch(/2 to 40/);
    expect(domainIdProblem('Retail', [])).toMatch(/lower case/);
    expect(domainIdProblem('bank', ['bank'])).toMatch(/exists/);
    expect(domainIdProblem('telecom', ['cdr'])).toMatch(/another name/);
    expect(domainIdProblem('retail_bank', ['bank'])).toBe('');
  });

  it('allows only plain names where they go into graph queries', () => {
    expect(fieldProblem('default_relationship', {}, 'SENT TO')).toMatch(/letters, digits and _/);
    expect(fieldProblem('default_relationship', { type: 'name' }, 'SENT_TO')).toBe('');
    expect(fieldProblem('storage_tables', { type: 'names' }, ['tx', 'tx;drop'])).toMatch(/letters/);
    expect(fieldProblem('storage_tables', { type: 'names', maxItems: 1 }, ['a', 'b'])).toMatch(/at most 1/);
    expect(fieldProblem('date_column', { required: true }, '')).toMatch(/cannot be empty/);
    expect(fieldProblem('display_name', {}, null)).toBe(''); // back to the built-in value
    expect(fieldProblem('display_name', {}, 'x'.repeat(121))).toMatch(/120/);
    expect(fieldProblem('display_name', {}, '  ')).toMatch(/empty/);
    expect(fieldProblem('rule_set', { allowed: ['bank_rules'] }, 'other')).toMatch(/choose/);
    expect(fieldProblem('limit', { type: 'integer', min: 1, max: 9 }, 12)).toMatch(/at most 9/);
  });

  it('sends only editable fields that changed, never the id or the patterns', () => {
    const profile = { fields: { display_name: 'Bank', default_relationship: 'SENT', relationships: ['A'] }, editable: { display_name: {}, default_relationship: {}, domain_id: {}, relationships: {} } };
    expect(changedFields({ display_name: 'Bank', default_relationship: 'PAID', domain_id: 'x', relationships: ['B'], other: 1 }, profile)).toEqual({ default_relationship: 'PAID' });
  });

  it('reads lists one per line or by comma', () => {
    expect(parseFieldInput('storage_tables', { type: 'list' }, 'a\nb, c\n', [])).toEqual(['a', 'b', 'c']);
  });

  it('offers copies from domains on the chosen rule set, or all while none is known', () => {
    const domains = [{ id: 'bank', ruleSet: 'bank_rules' }, { id: 'cdr', ruleSet: 'cdr_rules' }];
    expect(copyCandidates(domains, 'cdr_rules').map((d) => d.id)).toEqual(['cdr']);
    expect(copyCandidates([{ id: 'bank', ruleSet: '' }], 'cdr_rules').map((d) => d.id)).toEqual(['bank']);
  });
});
