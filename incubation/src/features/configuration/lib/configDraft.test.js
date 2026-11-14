import { afterEach, describe, expect, it } from 'vitest';

import {
  clearConfigurationDrafts,
  getConfigurationDraft,
  keepConfigurationDraft,
  rebaseConfigurationDraft,
} from './configDraft.js';

afterEach(() => clearConfigurationDrafts());

describe('rebaseConfigurationDraft', () => {
  const base = { domain: 'bank', active_domain: 'bank', active_tool_url: 'bolt://a', storage_path: '/bank', active_kafka_topic: 't1' };

  it('keeps edited keys, follows the session for untouched keys and the domain', () => {
    const draft = { ...base, active_tool_url: 'bolt://edited' };
    const next = { domain: 'cdr', active_domain: 'cdr', active_tool_url: 'bolt://cdr', storage_path: '/cdr', active_kafka_topic: 't1' };
    expect(rebaseConfigurationDraft(draft, base, next)).toEqual({
      domain: 'cdr', active_domain: 'cdr', active_tool_url: 'bolt://edited', storage_path: '/cdr', active_kafka_topic: 't1',
    });
  });

  it('always takes the session domain, even if the draft had a different one', () => {
    const draft = { ...base, domain: 'telco', active_domain: 'telco' };
    expect(rebaseConfigurationDraft(draft, base, { ...base, domain: 'cdr', active_domain: 'cdr' })).toMatchObject({ domain: 'cdr', active_domain: 'cdr' });
  });

  it('compares lists and objects by value', () => {
    const withList = { ...base, tables: ['a', 'b'] };
    expect(rebaseConfigurationDraft({ ...withList, tables: ['a', 'b'] }, withList, { ...withList, tables: ['c'] }).tables).toEqual(['c']);
  });
});

describe('configuration draft store', () => {
  it('keeps one draft per window and forgets all on sign-out', () => {
    keepConfigurationDraft('configuration-3', { draft: { active_tool_password: 'typed' }, base: {}, sessionId: 's1' });
    expect(getConfigurationDraft('configuration-3').draft.active_tool_password).toBe('typed');
    keepConfigurationDraft('configuration-3', null);
    expect(getConfigurationDraft('configuration-3')).toBeNull();
    keepConfigurationDraft('configuration-4', { draft: {}, base: {}, sessionId: 's1' });
    clearConfigurationDrafts();
    expect(getConfigurationDraft('configuration-4')).toBeNull();
  });
});
