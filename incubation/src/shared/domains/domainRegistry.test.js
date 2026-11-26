import { afterEach, describe, expect, it, vi } from 'vitest';

import { getDomainRegistry, loadDomainRegistry, putDomain, resetDomainRegistry } from './domainRegistry.js';
import { formatDomainPillarLabel, getRegisteredDomains } from '../../features/configuration/lib/configModel.js';

afterEach(() => resetDomainRegistry());

describe('the Service’s list of domains', () => {
  it('changes nothing while the Service does not offer it', async () => {
    await loadDomainRegistry(vi.fn(async () => { throw Object.assign(new Error('nf'), { status: 404, data: {} }); }));
    expect(getDomainRegistry().status).toBe('missing');
    expect(getRegisteredDomains({ registered_domains: ['bank', 'cdr'], active_domain: 'bank' })).toEqual(['bank', 'cdr']);
    expect(formatDomainPillarLabel('bank')).toBe('Banking');
  });

  it('hides inactive domains (not the one in use) and uses display names', async () => {
    await loadDomainRegistry(vi.fn(async () => ({ results: [
      { domain_id: 'bank', display_name: 'Retail banking', active: true },
      { domain_id: 'cdr', active: false },
      { domain_id: 'insurance', active: false },
    ] })));
    expect(getRegisteredDomains({ registered_domains: ['bank', 'cdr', 'insurance'], active_domain: 'insurance' })).toEqual(['bank', 'insurance']);
    expect(formatDomainPillarLabel('bank')).toBe('Retail banking');
    putDomain({ id: 'cdr', displayName: 'Calls', active: true });
    expect(getRegisteredDomains({ registered_domains: ['bank', 'cdr'], active_domain: 'bank' })).toEqual(['bank', 'cdr']);
    expect(formatDomainPillarLabel('cdr')).toBe('Calls');
  });
});
