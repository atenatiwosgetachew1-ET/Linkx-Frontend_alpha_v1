// Configuration window endpoints (same requests as the production
// Configurations panel). All functions take the session's `apiFetch`.

import { isSuccessResponse } from './apiClient.js';
import {
  extractConfigurationPayload,
  getConfigurationErrorMessage,
  normalizeLoadedConfiguration,
} from '../features/configuration/lib/configModel.js';

// Saved passwords the Service dropped because their host changed (B-46).
const readCredentialsCleared = (data) => {
  const list = [data?.credentials_cleared, data?.results?.credentials_cleared].find(Array.isArray) || [];
  return list.filter((item) => typeof item === 'string').slice(0, 20);
};

const toResult = (data, fallback) => (
  isSuccessResponse(data)
    ? { ok: true, data, configuration: normalizeLoadedConfiguration(extractConfigurationPayload(data)), returned: Boolean(extractConfigurationPayload(data)), credentialsCleared: readCredentialsCleared(data) }
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

// One's own columns in the session's domain (B-43): only the lists changed;
// null: back to the domain's. Kept per user and per domain by the Service.
export const saveOwnColumns = (apiFetch, sessionId, lists) => saveConfiguration(apiFetch, sessionId, lists);
// All of them: the open session's copy, then the account's.
export const resetOwnColumns = async (apiFetch, sessionId, domain) => {
  const result = await saveOwnColumns(apiFetch, sessionId, { fetch_columns: null, search_columns_strict: null, search_columns_fuzzy: null });
  if (!result.ok) return result;
  await apiFetch('/account/configuration/reset', { method: 'POST', body: { section: 'columns', domain } });
  return result;
};

// Rule upload: production posts the whole configuration form as multipart
// (named fields + rule_file + rule_name) with id=save.
export const uploadRule = async (apiFetch, sessionId, { file, ruleName, fields = {} }, { signal } = {}) => {
  const formData = new FormData();
  Object.entries(fields).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    // Form fields are text: production's form has no field for lists of
    // objects (classified entities) or maps (column mapping), and a list of
    // objects joined is "[object Object]".
    if (Array.isArray(value) ? value.some((item) => typeof item === 'object' && item !== null) : typeof value === 'object') return;
    if (Array.isArray(value)) formData.append(key, value.join(', '));
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
  if (error?.data?.code === 'wrong_password_or_damaged') return 'The password is wrong, or the file is damaged.';
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

// Per domain, read and written (B-9).
const byDomain = (domain) => `domain=${encodeURIComponent(domain || 'bank')}`;
export const fetchRuleThresholds = (apiFetch, domain) => apiFetch(`/rule-thresholds?${byDomain(domain)}`, { suppressForbiddenHandler: true });
export const fetchRuleThresholdHistory = (apiFetch, domain) => apiFetch(`/rule-thresholds/history?${byDomain(domain)}&limit=50`, { suppressForbiddenHandler: true });
export const saveRuleThresholds = (apiFetch, domain, values) => apiFetch('/rule-thresholds', { method: 'POST', body: { ...values, domain: domain || 'bank' } });
export const fetchScoreLineage = (apiFetch, domain) => apiFetch(`/config/score-lineage?${byDomain(domain)}`, { suppressForbiddenHandler: true });
export const saveScoreLineage = (apiFetch, domain, payload) => apiFetch('/config/score-lineage', { method: 'POST', body: { ...payload, domain: domain || 'bank' } });
export const fetchScoreLineageHistory = (apiFetch, domain) => apiFetch(`/config/score-lineage/history?${byDomain(domain)}&limit=50`, { suppressForbiddenHandler: true });

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
