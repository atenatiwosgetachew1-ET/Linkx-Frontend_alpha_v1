import { afterEach, expect, it } from 'vitest';

import { asOwnChange, getDomainChangeSeq, noteDomainChange, resetDomainChanges } from './domainChanges.js';

afterEach(resetDomainChanges);

it('a change by someone else is new to that part only; a preset is one to the thresholds', () => {
  expect(noteDomainChange({ domain: 'Bank', section: 'mapping', version_id: 2 })).toEqual({ domain: 'bank', section: 'mapping', own: false });
  expect(getDomainChangeSeq('bank', 'mapping')).toBe(1);
  expect(getDomainChangeSeq('bank', 'columns')).toBe(0);
  noteDomainChange({ domain: 'bank', section: 'sensitivity', version_id: 3 });
  expect(getDomainChangeSeq('bank', 'thresholds')).toBe(1);
  expect(noteDomainChange({ domain: 'bank', section: 'something' })).toBeNull();
  expect(noteDomainChange(undefined)).toBeNull();
});

it('one’s own save is not announced back: during it, nor after by its version', async () => {
  await asOwnChange('bank', 'columns', async () => {
    expect(noteDomainChange({ domain: 'bank', section: 'columns', version_id: 5 }).own).toBe(true);
    return { ok: true, state: { versionId: 5 } };
  }, (result) => result.state.versionId);
  expect(noteDomainChange({ domain: 'bank', section: 'columns', version_id: 5 }).own).toBe(true);
  expect(noteDomainChange({ domain: 'bank', section: 'columns', version_id: 6 }).own).toBe(false);
  await expect(asOwnChange('bank', 'columns', async () => { throw new Error('x'); })).rejects.toThrow('x');
  expect(noteDomainChange({ domain: 'bank', section: 'columns', version_id: 7 }).own).toBe(false);
});
