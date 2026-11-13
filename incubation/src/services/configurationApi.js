// Configuration window endpoints (same requests as the production
// Configurations panel). All functions take the session's `apiFetch`.

import { isSuccessResponse } from './apiClient.js';
import {
  buildConfigurationSavePayload,
  extractConfigurationPayload,
  getConfigurationErrorMessage,
  normalizeLoadedConfiguration,
} from '../features/configuration/lib/configModel.js';

const toResult = (data, fallback) => (
  isSuccessResponse(data)
    ? { ok: true, data, configuration: normalizeLoadedConfiguration(extractConfigurationPayload(data)), returned: Boolean(extractConfigurationPayload(data)) }
    : { ok: false, data, message: getConfigurationErrorMessage(data, fallback) }
);

/* ── /configuration ─────────────────────────────────────────────────── */

export const loadConfiguration = async (apiFetch, sessionId, { signal } = {}) => toResult(
  await apiFetch('/configuration', { method: 'POST', body: { id: 'load', session_id: sessionId }, signal }),
  'Could not load configuration. Try again.',
);

export const loadDefaultConfiguration = async (apiFetch, sessionId, { signal } = {}) => toResult(
  await apiFetch('/configuration', { method: 'POST', body: { id: 'load_default', session_id: sessionId }, signal }),
  'Could not reset configuration. Try again.',
);

export const saveConfiguration = async (apiFetch, sessionId, configuration, { signal } = {}) => toResult(
  await apiFetch('/configuration', { method: 'POST', body: { id: 'save', session_id: sessionId, configuration }, signal }),
  'Could not save configuration. Try again.',
);

// Rule upload: production posts the whole configuration form as multipart
// (named fields + rule_file + rule_name) with id=save.
export const uploadRule = async (apiFetch, sessionId, { file, ruleName, fields = {} }, { signal } = {}) => {
  const formData = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) formData.append(key, value.join(', '));
    else if (typeof value === 'object') formData.append(key, JSON.stringify(value));
    else formData.append(key, String(value));
  });
  formData.set('id', 'save');
  formData.set('session_id', sessionId);
  formData.set('rule_file', file);
  formData.set('rule_name', ruleName || '');
  return toResult(
    await apiFetch('/configuration', { method: 'POST', body: formData, signal }),
    'Rule upload failed.',
  );
};

export const removeRule = async (apiFetch, sessionId, ruleName, { signal } = {}) => {
  const formData = new FormData();
  formData.append('id', 'remove_rule');
  formData.append('session_id', sessionId);
  formData.append('rule_name', ruleName);
  return toResult(
    await apiFetch('/configuration', { method: 'POST', body: formData, signal }),
    'Could not remove the selected rule. Try again.',
  );
};

// Domain pillar switch: the backend re-projects storage targets, ports and
// schema mappings for the domain and returns the new configuration.
export const switchDomain = async (apiFetch, sessionId, domain, { signal } = {}) => toResult(
  await apiFetch('/configuration', { method: 'POST', body: { id: 'save', session_id: sessionId, domain }, signal }),
  'Could not switch domain.',
);

/* ── Encrypted (.lxac) import / export ──────────────────────────────── */

export const verifyLxacFile = async (apiFetch, file) => {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const data = await apiFetch('/configuration/lxac/verify', { method: 'POST', body: formData });
    if (data && data.valid === false) return { ok: false, message: data.error || 'The selected file is not a valid LinkX encrypted configuration file.' };
    return { ok: true };
  } catch (error) {
    if (error?.data?.valid === false || error?.data?.detail === 'not_lxac_file') {
      return { ok: false, message: error.data?.error || 'The selected file is not a valid LinkX encrypted configuration file.' };
    }
    // Verification endpoint unavailable: let the import itself decide.
    return { ok: true };
  }
};

export const exportEncryptedConfiguration = async (apiFetch, sessionId, password) => {
  const blob = await apiFetch('/configuration/export/encrypted', {
    method: 'POST',
    body: { session_id: sessionId, password },
    responseType: 'blob',
  });
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const filename = `Linkx_config_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.Lxac`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { filename };
};

export const getLxacErrorMessage = (error, fallback) => {
  if (error?.data?.detail === 'invalid_password') return 'Incorrect password. Please verify the password and try again.';
  if (error?.data?.detail === 'tampered_file') return 'Integrity check failed: the file appears to be damaged or modified.';
  return getConfigurationErrorMessage(error, fallback);
};

export const importEncryptedConfiguration = async (apiFetch, sessionId, file, password) => {
  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('password', password);
  formData.append('file', file);
  const data = await apiFetch('/configuration/import/encrypted', { method: 'POST', body: formData });
  return toResult(data, 'Could not decrypt configuration file.');
};

/* ── Session timeout policy ─────────────────────────────────────────── */

export const fetchSessionPolicy = (apiFetch, sessionId) => apiFetch(
  `/auth/session-policy?session_id=${encodeURIComponent(sessionId)}`,
  { method: 'GET' },
);

export const patchSessionPolicy = (apiFetch, sessionId, idleSettings) => apiFetch('/auth/session-policy', {
  method: 'PATCH',
  body: {
    id: 'session_policy_update',
    session_id: sessionId,
    policy: {
      idle_warning_ms: Number(idleSettings.warningMs),
      idle_lock_ms: Number(idleSettings.lockMs),
      max_idle_timeout_ms: Number(idleSettings.timeoutMs),
      lock_requires_reauth: idleSettings.lockRequiresReauth !== false,
    },
  },
});

/* ── Detection sensitivity ──────────────────────────────────────────── */

// Production tries the domain-scoped endpoint first and falls back to the
// unscoped one. Only a missing route (404/405) falls back: nothing was
// processed then, so retrying cannot duplicate a write, and real errors
// (400/403/500/timeouts) surface instead of being replaced. Backend request
// B-9 removes the need for this.
const isRouteMissing = (error) => error?.status === 404 || error?.status === 405;
const withFallback = async (primary, fallback) => {
  try {
    return await primary();
  } catch (error) {
    if (!isRouteMissing(error)) throw error;
    return fallback();
  }
};

export const fetchRuleThresholds = (apiFetch, isCdr) => withFallback(
  () => apiFetch(isCdr ? '/rule-thresholds?domain_id=cdr' : '/rule-thresholds', { suppressForbiddenHandler: true }),
  () => apiFetch('/rule-thresholds', { suppressForbiddenHandler: true }),
);

export const fetchRuleThresholdHistory = (apiFetch, isCdr) => withFallback(
  () => apiFetch(isCdr ? '/rule-thresholds/history?domain_id=cdr&limit=50' : '/rule-thresholds/history?limit=50', { suppressForbiddenHandler: true }),
  () => apiFetch('/rule-thresholds/history?limit=50', { suppressForbiddenHandler: true }),
);

export const saveRuleThresholds = (apiFetch, isCdr, values) => {
  const body = { ...(isCdr ? { domain_id: 'cdr' } : {}), ...values };
  return withFallback(
    () => apiFetch(`/rule-thresholds?domain=${isCdr ? 'cdr' : 'bank'}`, { method: 'POST', body }),
    () => apiFetch('/rule-thresholds', { method: 'POST', body }),
  );
};

export const fetchScoreLineage = (apiFetch, isCdr) => withFallback(
  () => apiFetch(isCdr ? '/config/score-lineage?domain_id=cdr' : '/config/score-lineage', { suppressForbiddenHandler: true }),
  () => apiFetch('/config/score-lineage', { suppressForbiddenHandler: true }),
);

export const saveScoreLineage = (apiFetch, isCdr, payload) => withFallback(
  () => apiFetch(isCdr ? '/config/score-lineage?domain_id=cdr' : '/config/score-lineage', { method: 'POST', body: payload }),
  () => apiFetch('/config/score-lineage', { method: 'POST', body: payload }),
);

/* ── Activity log (cleanup audit) ───────────────────────────────────── */

export const fetchCleanupAudit = async (apiFetch, { limit = 20, offset = 0, sessionId = '', cleanupType = '', status = '' } = {}) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (sessionId) params.set('session_id', sessionId);
  if (cleanupType) params.set('cleanup_type', cleanupType);
  if (status) params.set('status', status);
  const data = await apiFetch(`/admin/audit/cleanup?${params.toString()}`, { method: 'GET' });
  const results = data?.results || {};
  const items = Array.isArray(results.items) ? results.items : [];
  return {
    items,
    total: Number(results.total) || items.length,
    limit: Number(results.limit) || limit,
    offset: Number(results.offset) || 0,
  };
};

export const requestSessionCleanup = async (apiFetch, payload) => {
  const data = await apiFetch('/admin/cleanup/session', { method: 'POST', body: payload });
  return data?.results || data || {};
};

/* ── Realtime tool credentials (production persistRealtimeToolConfigurationForWindow) ── */

// Realtime streams resolve Neo4j from the *source* session's configuration,
// so after a successful realtime tool connect the credentials are saved to
// that session and read back to confirm a usable password reference exists.
export const persistRealtimeToolConfiguration = async (apiFetch, { sourceSessionId, sessionConfiguration, tool }) => {
  const configuration = {
    ...buildConfigurationSavePayload(sessionConfiguration),
    session_id: sourceSessionId,
    active_tool_url: tool.url,
    active_tool_protocol: tool.url,
    active_tool_username: tool.username,
    active_tool_database: tool.database,
    ...(tool.password && !/^\*+$/.test(String(tool.password).trim()) ? { active_tool_password: tool.password } : {}),
  };
  try {
    const saved = await saveConfiguration(apiFetch, sourceSessionId, configuration);
    if (!saved.ok) return { ok: false, message: saved.message || 'Neo4j credentials could not be saved for this session.' };
    const loaded = await loadConfiguration(apiFetch, sourceSessionId);
    if (!loaded.ok) return { ok: false, message: 'Neo4j credentials were saved, but the session configuration could not be reloaded.' };
    const confirmed = loaded.configuration || {};
    const passwordRef = confirmed.active_tool_password_ref || confirmed.tool_password_ref || confirmed.password_ref || '';
    const hasCredentials = Boolean(confirmed.active_tool_url && confirmed.active_tool_username && (passwordRef || confirmed.active_tool_password));
    return hasCredentials
      ? { ok: true, configuration: confirmed, passwordRef }
      : { ok: false, message: 'Neo4j connected, but this session does not yet have confirmed saved credentials.' };
  } catch (error) {
    return { ok: false, message: getConfigurationErrorMessage(error, 'Neo4j credentials could not be saved for this session.') };
  }
};
