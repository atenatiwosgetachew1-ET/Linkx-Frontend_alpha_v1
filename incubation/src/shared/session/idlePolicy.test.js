import { describe, expect, it } from 'vitest';

import { normalizeIdleSettings, normalizeSessionPolicyResponse } from './idlePolicy.js';

describe('normalizeIdleSettings', () => {
  it('keeps warning < lock <= timeout', () => {
    const settings = normalizeIdleSettings({ warningMs: 20 * 60000, lockMs: 10 * 60000, timeoutMs: 5 * 60000 });
    expect(settings.lockMs).toBeLessThanOrEqual(settings.timeoutMs);
    expect(settings.warningMs).toBeLessThan(settings.lockMs);
  });

  it('clamps the timeout to 1 minute .. 24 hours', () => {
    expect(normalizeIdleSettings({ timeoutMs: 10 }).timeoutMs).toBe(60000);
    expect(normalizeIdleSettings({ timeoutMs: 10 ** 12 }).timeoutMs).toBe(24 * 60 * 60000);
  });
});

describe('normalizeSessionPolicyResponse', () => {
  it('reads backend field names', () => {
    const normalized = normalizeSessionPolicyResponse({
      results: { policy: { idle_warning_ms: 60000, idle_lock_ms: 120000, max_idle_timeout_ms: 600000, lock_requires_reauth: false }, editable_fields: ['idle_lock_ms'], source: 'session' },
    });
    expect(normalized.policy).toMatchObject({ warningMs: 60000, lockMs: 120000, timeoutMs: 600000, lockRequiresReauth: false });
    expect(normalized.editableFields).toEqual(['idle_lock_ms']);
  });
});
