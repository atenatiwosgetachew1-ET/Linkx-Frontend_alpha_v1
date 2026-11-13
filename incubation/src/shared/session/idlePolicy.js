// Idle / session-timeout policy model (ported from the production app).
// The backend session policy (/auth/session-policy) is authoritative; these
// defaults only apply until it has loaded.

export const DEFAULT_IDLE_WARNING_MS = 12 * 60 * 1000;
export const DEFAULT_IDLE_LOCK_MS = 15 * 60 * 1000;
export const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const MIN_IDLE_TIMEOUT_MS = 60 * 1000;
const MAX_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const clampMs = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || min)));

export const normalizeIdleSettings = (value = {}, fallback = {}) => {
  const timeoutMs = clampMs(value.timeoutMs ?? fallback.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, MIN_IDLE_TIMEOUT_MS, MAX_IDLE_TIMEOUT_MS);
  const lockMs = clampMs(value.lockMs ?? fallback.lockMs ?? DEFAULT_IDLE_LOCK_MS, MIN_IDLE_TIMEOUT_MS, timeoutMs);
  const warningMs = clampMs(value.warningMs ?? fallback.warningMs ?? DEFAULT_IDLE_WARNING_MS, 0, Math.max(0, lockMs - 1000));
  return {
    enabled: value.enabled !== false && timeoutMs > 0,
    warningMs,
    lockMs,
    timeoutMs,
    lockRequiresReauth: value.lockRequiresReauth !== false,
  };
};

export const DEFAULT_IDLE_SETTINGS = normalizeIdleSettings({});

export const normalizeSessionPolicyResponse = (data, fallback = DEFAULT_IDLE_SETTINGS) => {
  const results = data?.results && typeof data.results === 'object' ? data.results : (data && typeof data === 'object' ? data : {});
  const policy = results.policy && typeof results.policy === 'object' ? results.policy : {};
  const tokenSeconds = Number(policy.auth_token_seconds ?? results.auth_token_seconds);
  return {
    policy: normalizeIdleSettings({
      warningMs: policy.idle_warning_ms ?? policy.idleWarningMs,
      lockMs: policy.idle_lock_ms ?? policy.idleLockMs,
      timeoutMs: policy.max_idle_timeout_ms ?? policy.maxIdleTimeoutMs,
      lockRequiresReauth: policy.lock_requires_reauth ?? policy.lockRequiresReauth,
    }, fallback),
    source: String(results.source || '').trim(),
    editableFields: Array.isArray(results.editable_fields) ? results.editable_fields.map((field) => String(field || '').trim()).filter(Boolean) : null,
    authTokenSeconds: Number.isFinite(tokenSeconds) && tokenSeconds > 0 ? tokenSeconds : null,
  };
};
