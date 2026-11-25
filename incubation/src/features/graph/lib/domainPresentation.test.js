// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { PRESENTATION_MAX_BYTES, fetchPresentation, savePresentation } from '../../../services/domainConfigApi.js';
import { getDomainFormatting, resetDomainFormattingCache, setDomainFormatting } from './conditionalFormatting.js';
import { getPresentationVersion, isPresentationLoaded, loadPresentation, resetPresentation, withoutPresentation } from './domainPresentation.js';
import { PROFILE_PREFS_KEY, getProfileSettings, profileToConfiguration, resetProfileSettingsCache, setProfileSettings } from './nodeProfile.js';

const reset = () => {
  localStorage.clear();
  resetPresentation();
  resetProfileSettingsCache();
  resetDomainFormattingCache();
};
beforeEach(reset);
afterEach(reset);

const rule = (name) => ({ id: name, name, target: 'node', match: 'all', conditions: [{ key: 'A', op: 'eq', value: '1' }], style: { fill: '#e74c3c' } });

it('the Service’s settings win, and the browser’s copy of that domain is dropped', async () => {
  setProfileSettings('bank', { ...getProfileSettings('bank'), portraitKey: 'OLD' });
  setProfileSettings('cdr', { ...getProfileSettings('cdr'), portraitKey: 'CDR' });
  setDomainFormatting('bank', [rule('mine')]);
  const answer = { domain: 'bank', section: 'presentation', version_id: 4, actor_profile: { ...profileToConfiguration(getProfileSettings('bank')), portrait_property: 'NEW' }, formatting_rules: [rule('theirs')], updated_by: 'sam' };
  expect(await loadPresentation(vi.fn(async () => answer), 'bank')).toBe(true);
  expect(getProfileSettings('bank').portraitKey).toBe('NEW');
  expect(getDomainFormatting('bank').map((item) => item.name)).toEqual(['theirs']);
  expect(getPresentationVersion('bank')).toBe(4);
  expect(JSON.parse(localStorage.getItem(PROFILE_PREFS_KEY))).toEqual({ cdr: expect.objectContaining({ portraitKey: 'CDR' }) });
  expect(withoutPresentation({ a: 1, actor_profile: {}, formatting_rules: [] }, 'bank')).toEqual({ a: 1 });
});

it('what the Service has no value for stays the browser’s until it is saved', async () => {
  setDomainFormatting('bank', [rule('mine')]);
  await loadPresentation(vi.fn(async () => ({ version_id: null, actor_profile: null, formatting_rules: null })), 'bank');
  expect(isPresentationLoaded('bank')).toBe(true);
  expect(getDomainFormatting('bank').map((item) => item.name)).toEqual(['mine']);
});

it('a Service without it: the browser’s copy goes on', async () => {
  expect(await loadPresentation(vi.fn(async () => { throw Object.assign(new Error('x'), { status: 404 }); }), 'bank')).toBe(false);
  expect(isPresentationLoaded('bank')).toBe(false);
  expect(await fetchPresentation(vi.fn(async () => '<html>'), 'bank')).toBeNull();
});

it('saves with the version, says a conflict, and never sends over 1 MB', async () => {
  const apiFetch = vi.fn(async () => ({ state: { version_id: 5, actor_profile: null, formatting_rules: [] } }));
  expect(await savePresentation(apiFetch, 'bank', { formatting_rules: [] }, 4)).toMatchObject({ ok: true, presentation: { versionId: 5 } });
  expect(apiFetch).toHaveBeenCalledWith('/domain-config', { method: 'POST', body: { domain: 'bank', section: 'presentation', formatting_rules: [], version_id: 4 } });
  const refuse = vi.fn(async () => { throw Object.assign(new Error('x'), { status: 409, data: { code: 'version_conflict', current: { version_id: 9, updated_by: 'sam', formatting_rules: [], actor_profile: null } } }); });
  expect(await savePresentation(refuse, 'bank', { formatting_rules: [] }, 4)).toMatchObject({ ok: false, conflict: { versionId: 9, updatedBy: 'sam' } });
  const big = vi.fn();
  expect((await savePresentation(big, 'bank', { formatting_rules: [{ icon: 'x'.repeat(PRESENTATION_MAX_BYTES) }] }, 4)).message).toMatch(/over 1 MB/);
  expect(big).not.toHaveBeenCalled();
});
