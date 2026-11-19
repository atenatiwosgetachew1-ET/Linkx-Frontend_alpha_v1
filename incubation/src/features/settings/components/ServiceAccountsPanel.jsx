import React, { useCallback, useEffect, useMemo, useState } from 'react';

import PermissionEditor from './PermissionEditor.jsx';
import { tn } from '../../../shared/i18n/index.js';
import { Section } from '../../../shared/components/form/FormFields.jsx';
import {
  DOMAIN_SCHEMA_TEMPLATES,
  STANDARD_FORENSIC_DOMAINS,
  buildServiceConfigPayload,
  cloneServiceConfig,
  defaultDomainConfig,
  defaultServiceConfig,
  extractServiceSecret,
  formatServiceAccountError,
  generateClientSecret,
  tryGenerateClientSecret,
  getCanonicalColumns,
  getDomainMeta,
  normalizeServiceAccountList,
  parseCatalogDomains,
} from '../lib/serviceAccounts.js';
import {
  compactValidationErrors,
  sanitizeConnectionValue,
  sanitizeIdentifier,
  sanitizePermissionList,
  sanitizeSecret,
  sanitizeText,
  validateClientSecret,
  validateDisplayName,
  validateRequiredIdentifier,
} from '../../../utils/inputSecurity.js';

const VALID_PERMISSION = /^[a-z]+:[a-z_]+$/;

function ServiceSecretNotice({ secret, onClear }) {
  const [copied, setCopied] = useState(false);
  if (!secret) return null;
  const copy = () => {
    navigator.clipboard?.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };
  return (
    <div className="settings_secret_notice">
      <div>
        <strong>New client secret generated</strong>
        <p>Copy this secret now and update client applications. It cannot be retrieved again.</p>
      </div>
      <code>{secret}</code>
      <button type="button" className="settings_button" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
      <button type="button" className="settings_button is-danger" onClick={onClear}>Dismiss</button>
    </div>
  );
}

/* ── Multi-domain storage editor (production StorageTargetEditor) ── */

function MappingRow({ sourceKey, target, canonical, onRename, onTarget, onRemove }) {
  const [localKey, setLocalKey] = useState(sourceKey);
  useEffect(() => { setLocalKey(sourceKey); }, [sourceKey]);
  const commit = () => {
    const clean = localKey.trim();
    if (clean && clean !== sourceKey) onRename(sourceKey, clean);
    else setLocalKey(sourceKey);
  };
  return (
    <div className="service_target_mapping_row">
      <input
        className="settings_input"
        value={localKey}
        maxLength={80}
        placeholder="e.g. SENDER_ID"
        onChange={(event) => setLocalKey(event.target.value.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase())}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
      />
      <span aria-hidden="true">→</span>
      <select className="settings_input" value={target} onChange={(event) => onTarget(sourceKey, event.target.value)}>
        {canonical.map((column) => <option key={column.value} value={column.value}>{column.label}</option>)}
        {!canonical.some((column) => column.value === target) ? <option value={target}>{target}</option> : null}
      </select>
      <button type="button" className="settings_button is-danger" onClick={() => onRemove(sourceKey)}>Remove</button>
    </div>
  );
}

function StorageTargetEditor({ config, onChange, catalogDomains, catalogState, onRefreshCatalog, isCdr, readOnly = false }) {
  const current = config || defaultServiceConfig();
  const registered = useMemo(() => (Array.isArray(current.registered_domains) ? current.registered_domains : []), [current.registered_domains]);
  const domains = current.domains && typeof current.domains === 'object' ? current.domains : {};
  const [activeDomain, setActiveDomain] = useState(registered[0] || '');
  const [customDomain, setCustomDomain] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [columnInput, setColumnInput] = useState('');
  const canonical = useMemo(() => getCanonicalColumns(isCdr), [isCdr]);

  useEffect(() => {
    if (!activeDomain || !registered.includes(activeDomain)) setActiveDomain(registered[0] || '');
  }, [registered, activeDomain]);

  const active = (activeDomain && domains[activeDomain]) || defaultDomainConfig(activeDomain || 'banking');
  const emit = (next) => { if (!readOnly) onChange(next); };
  const updateField = (field, value) => {
    if (!activeDomain) return;
    emit({ ...current, registered_domains: registered, domains: { ...domains, [activeDomain]: { ...active, [field]: value } } });
  };
  const updateFields = (patch) => {
    if (!activeDomain) return;
    emit({ ...current, registered_domains: registered, domains: { ...domains, [activeDomain]: { ...active, ...patch } } });
  };

  const toggleRegistration = (rawKey) => {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key) return;
    const nextDomains = { ...domains };
    let nextRegistered;
    if (registered.includes(key)) {
      // Config is kept so re-registering restores it.
      nextRegistered = registered.filter((item) => item !== key);
    } else {
      nextRegistered = [...registered, key];
      if (!nextDomains[key]) nextDomains[key] = defaultDomainConfig(key);
      setActiveDomain(key);
    }
    emit({ ...current, registered_domains: nextRegistered, domains: nextDomains });
  };

  const addCustomDomain = () => {
    const clean = customDomain.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (!clean) return;
    if (!registered.includes(clean)) toggleRegistration(clean);
    else setActiveDomain(clean);
    setCustomDomain('');
  };

  const catalogList = useMemo(() => {
    const base = catalogDomains.length ? catalogDomains : STANDARD_FORENSIC_DOMAINS;
    return Array.from(new Set([...base, ...registered.map((item) => String(item).toLowerCase())]));
  }, [catalogDomains, registered]);

  const fetchColumns = Array.isArray(active.fetch_columns) ? active.fetch_columns : [];
  const mapping = active.column_mapping && typeof active.column_mapping === 'object' ? active.column_mapping : {};
  const mappingEntries = Object.entries(mapping);

  const addColumns = () => {
    const tokens = columnInput.split(/[,\s]+/).map((token) => token.trim().replace(/[^a-zA-Z0-9_]/g, '').toUpperCase()).filter(Boolean);
    if (!tokens.length) return;
    updateField('fetch_columns', Array.from(new Set([...fetchColumns, ...tokens])));
    setColumnInput('');
  };
  const renameMapping = (oldKey, newKey) => {
    const next = { ...mapping };
    const value = next[oldKey] || canonical[0].value;
    delete next[oldKey];
    next[newKey] = value;
    updateField('column_mapping', next);
  };
  const addMapping = () => {
    let candidate = 'SOURCE_COL';
    let index = 1;
    while (mapping[candidate] !== undefined) { candidate = `SOURCE_COL_${index}`; index += 1; }
    updateField('column_mapping', { ...mapping, [candidate]: canonical[0].value });
  };
  const loadTemplate = () => {
    const key = activeDomain === 'banking' ? 'bank' : activeDomain;
    const schema = DOMAIN_SCHEMA_TEMPLATES[key] || DOMAIN_SCHEMA_TEMPLATES.bank;
    updateFields({ fetch_columns: [...schema.fetch_columns], column_mapping: { ...schema.column_mapping } });
  };

  const catalogBadge = catalogState.loading
    ? 'Syncing catalog…'
    : catalogState.error
      ? catalogState.error
      : catalogDomains.length ? `Live catalog (${catalogDomains.length})` : 'Standard domains';

  return (
    <div className="service_target_editor">
      <div className="service_target_header">
        <div>
          <strong>Multi-domain storage configuration</strong>
          <small>Storage targets and column schemas per forensic domain. {registered.length} active.</small>
        </div>
        <span className={`service_target_catalog_badge${catalogState.error ? ' is-error' : ''}`}>
          {catalogBadge}
          {onRefreshCatalog && !catalogState.loading ? <button type="button" className="settings_link_button" onClick={onRefreshCatalog} title="Refresh the domain catalog">⟳</button> : null}
        </span>
      </div>

      <div className="service_target_domain_grid">
        {catalogList.map((key) => {
          const meta = getDomainMeta(key);
          const isRegistered = registered.includes(key);
          const cfg = domains[key] || {};
          return (
            <button
              type="button"
              key={key}
              className={`service_target_domain_card${isRegistered ? ' is-registered' : ''}${activeDomain === key ? ' is-current' : ''}`}
              disabled={readOnly && !isRegistered}
              onClick={() => (isRegistered ? setActiveDomain(key) : toggleRegistration(key))}
              title={isRegistered ? 'Registered. Click to edit.' : `Click to register ${meta.label}`}
            >
              <strong>{meta.label}</strong>
              <small>{meta.tag}</small>
              <span>
                {isRegistered ? '✓ Active' : '+ Register'}
                {isRegistered && (cfg.storage_host || cfg.storage_port) ? ` · :${cfg.storage_port || meta.defaultPort}` : ''}
              </span>
            </button>
          );
        })}
      </div>

      {!readOnly ? (
        <div className="config_window_option_row">
          <input
            className="settings_input"
            value={customDomain}
            maxLength={40}
            placeholder="Register a custom domain (e.g. crypto, logistics, customs)…"
            onChange={(event) => setCustomDomain(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomDomain(); } }}
          />
          <button type="button" className="settings_button" disabled={!customDomain.trim()} onClick={addCustomDomain}>+ Add domain</button>
        </div>
      ) : null}

      {registered.length === 0 ? (
        <p className="settings_hint">No forensic domains registered. Select one or more domains above to configure their storage endpoints and schema mappings.</p>
      ) : (
        <div className="service_target_domain_body">
          <div className="service_target_tabs" role="tablist">
            {registered.map((key) => {
              const cfg = domains[key] || {};
              return (
                <span key={key} className={`service_target_tab${activeDomain === key ? ' is-active' : ''}`}>
                  <button type="button" role="tab" aria-selected={activeDomain === key} onClick={() => setActiveDomain(key)}>
                    <i className={cfg.storage_host || cfg.storage_port ? 'is-configured' : 'is-pending'} aria-hidden="true" />
                    {getDomainMeta(key).label}
                  </button>
                  {!readOnly ? <button type="button" className="service_target_tab_remove" aria-label={`Unregister ${getDomainMeta(key).label}`} onClick={() => toggleRegistration(key)}>✕</button> : null}
                </span>
              );
            })}
          </div>

          {activeDomain ? (
            <>
              <div className="service_target_banner">
                <span>{getDomainMeta(activeDomain).label} storage target · key <code>{activeDomain}</code> · recommended port <code>{getDomainMeta(activeDomain).defaultPort}</code></span>
                {!readOnly ? <button type="button" className="settings_link_button" onClick={loadTemplate}>⚡ Load template</button> : null}
              </div>
              <div className="config_window_grid">
                <label className="config_window_field">
                  <span className="config_window_field_label">Storage host / IP</span>
                  <input className="settings_input" value={active.storage_host || ''} maxLength={160} placeholder="e.g. 10.0.0.10" disabled={readOnly} onChange={(event) => updateField('storage_host', sanitizeConnectionValue(event.target.value, { maxLength: 160 }))} />
                </label>
                <label className="config_window_field">
                  <span className="config_window_field_label">Storage port</span>
                  <input className="settings_input" value={active.storage_port || ''} maxLength={10} placeholder={getDomainMeta(activeDomain).defaultPort} disabled={readOnly} onChange={(event) => updateField('storage_port', sanitizeConnectionValue(event.target.value, { maxLength: 10 }))} />
                </label>
                <label className="config_window_field">
                  <span className="config_window_field_label">Storage endpoint</span>
                  <input className="settings_input" value={active.storage_endpoint || ''} maxLength={160} placeholder="api/search/uii" disabled={readOnly} onChange={(event) => updateField('storage_endpoint', sanitizeConnectionValue(event.target.value, { maxLength: 160 }))} />
                </label>
                <div className="config_window_field">
                  <span className="config_window_field_label">
                    Auth token (optional){active.auth_token_set && !active.auth_token_clear ? ' · saved' : ''}
                  </span>
                  <div className="config_window_option_row">
                    <input
                      className="settings_input"
                      type="password"
                      autoComplete="new-password"
                      aria-label="Auth token"
                      value={active.auth_token || ''}
                      maxLength={256}
                      placeholder={active.auth_token_clear ? 'Will be cleared on save' : active.auth_token_set ? 'Saved; type to replace' : 'Bearer token'}
                      disabled={readOnly}
                      onChange={(event) => updateFields({ auth_token: sanitizeSecret(event.target.value, { maxLength: 256 }), auth_token_clear: false })}
                    />
                    {active.auth_token_set && !readOnly ? (
                      <button type="button" className="settings_button is-compact" onClick={() => updateFields({ auth_token: '', auth_token_clear: !active.auth_token_clear })}>
                        {active.auth_token_clear ? 'Keep' : 'Clear'}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <button type="button" className="service_target_advanced_toggle" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
                <span>
                  <strong>Advanced schema &amp; column mapping (optional)</strong>
                  <small>Custom column names and Elasticsearch schema overrides for {activeDomain}. {fetchColumns.length} columns · {mappingEntries.length} mappings.</small>
                </span>
                <span aria-hidden="true">{advancedOpen ? '▲' : '▼'}</span>
              </button>

              {advancedOpen ? (
                <div className="service_target_advanced">
                  <div className="settings_permission_editor_header">
                    <span>Fetch columns ({fetchColumns.length})</span>
                    {fetchColumns.length && !readOnly ? <button type="button" className="settings_link_button" onClick={() => updateField('fetch_columns', [])}>Clear all</button> : null}
                  </div>
                  <p className="settings_hint">Elasticsearch source projections. Leave empty to use the domain defaults.</p>
                  {fetchColumns.length ? (
                    <div className="service_target_chips">
                      {fetchColumns.map((column) => (
                        <span key={column}>
                          {column}
                          {!readOnly ? <button type="button" aria-label={`Remove ${column}`} onClick={() => updateField('fetch_columns', fetchColumns.filter((item) => item !== column))}>✕</button> : null}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {!readOnly ? (
                    <div className="config_window_option_row">
                      <input
                        className="settings_input"
                        value={columnInput}
                        maxLength={160}
                        placeholder="e.g. RECORD_ID, SENDER_ID, RECEIVER_ID, CREATED_AT, AMOUNT"
                        onChange={(event) => setColumnInput(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addColumns(); } }}
                      />
                      <button type="button" className="settings_button" disabled={!columnInput.trim()} onClick={addColumns}>+ Add column</button>
                    </div>
                  ) : null}

                  <div className="settings_permission_editor_header">
                    <span>Canonical column mapping ({mappingEntries.length})</span>
                    {mappingEntries.length && !readOnly ? <button type="button" className="settings_link_button" onClick={() => updateField('column_mapping', {})}>Clear all</button> : null}
                  </div>
                  <p className="settings_hint">Map raw storage columns to LinkX canonical fields.</p>
                  {mappingEntries.length === 0 ? <p className="settings_hint">No custom mapping overrides (using domain defaults).</p> : mappingEntries.map(([source, target]) => (
                    <MappingRow
                      key={source}
                      sourceKey={source}
                      target={target}
                      canonical={canonical}
                      onRename={renameMapping}
                      onTarget={(key, value) => updateField('column_mapping', { ...mapping, [key]: value })}
                      onRemove={(key) => { const next = { ...mapping }; delete next[key]; updateField('column_mapping', next); }}
                    />
                  ))}
                  {!readOnly ? <button type="button" className="settings_button config_window_add_row" onClick={addMapping}>+ Add mapping pair</button> : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ── Service accounts panel ── */

const emptyDraft = () => ({ client_id: '', client_secret: tryGenerateClientSecret(), display_name: '', permissions: [], config: defaultServiceConfig() });

// PATCH, falling back to PUT only when the backend says the method is not
// allowed (405). A 404 means the account is gone and must not become a PUT
// (which could recreate it). Backend request B-9 removes the fallback.
const patchAccount = async (apiFetch, id, body) => {
  const path = `/auth/admin/service-accounts/${encodeURIComponent(id)}`;
  try {
    return await apiFetch(path, { method: 'PATCH', body });
  } catch (error) {
    if (error?.status !== 405) throw error;
    try {
      return await apiFetch(path, { method: 'PUT', body });
    } catch (putError) {
      if (putError?.status !== 405) throw putError;
      return apiFetch(`/auth/service-accounts/${encodeURIComponent(id)}`, { method: 'PUT', body });
    }
  }
};

// True only when the backend rejects the `config` field itself (older
// schema), never for ordinary validation errors inside the config.
const isConfigSchemaError = (error) => {
  const data = error?.data || {};
  if (data.code === 'unknown_field' && (data.field === 'config' || !data.field)) return true;
  const text = String(data.detail || data.message || data.error || error?.message || '');
  return [400, 422].includes(error?.status)
    && /\bconfig\b/i.test(text)
    && /(unknown|unexpected|extra|not (permitted|allowed)|additional propert)/i.test(text);
};

export default function ServiceAccountsPanel({ apiFetch, canManageUsers, onNotice, requestConfirmation, refreshSignal, isCdr }) {
  const confirmAction = (options) => requestConfirmation(options);
  const [accounts, setAccounts] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editDrafts, setEditDrafts] = useState({});
  const [expandedId, setExpandedId] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newSecret, setNewSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [catalogDomains, setCatalogDomains] = useState([]);
  const [catalogState, setCatalogState] = useState({ loading: false, error: '' });

  const loadCatalog = useCallback(async () => {
    if (!canManageUsers) return;
    setCatalogState({ loading: true, error: '' });
    try {
      const domains = parseCatalogDomains(await apiFetch('/api/v1/rules/catalog?domain=all&format=summary', { method: 'GET', suppressForbiddenHandler: true }));
      setCatalogDomains(domains);
      setCatalogState({ loading: false, error: domains.length ? '' : 'Domains not available!' });
    } catch {
      setCatalogDomains([]);
      setCatalogState({ loading: false, error: 'Domains not available!' });
    }
  }, [apiFetch, canManageUsers]);

  const loadAccounts = useCallback(async () => {
    if (!canManageUsers) return;
    setLoading(true);
    setError('');
    try {
      const normalized = normalizeServiceAccountList(await apiFetch('/auth/admin/service-accounts', { method: 'GET' }));
      setAccounts(normalized);
      setEditDrafts(Object.fromEntries(normalized.map((account) => [String(account.id), {
        display_name: account.display_name,
        is_active: account.is_active !== false,
        permissions: account.permissions || [],
        config: cloneServiceConfig(account.config),
      }])));
    } catch (err) {
      setError(err?.message || 'Failed to load service accounts.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canManageUsers]);

  useEffect(() => {
    if (!canManageUsers) return;
    loadAccounts();
    loadCatalog();
  }, [canManageUsers, loadAccounts, loadCatalog, refreshSignal]);

  const updateEditDraft = (id, patch) => setEditDrafts((current) => ({ ...current, [String(id)]: { ...(current[String(id)] || {}), ...patch } }));
  const restricted = (message) => {
    setError(message);
    onNotice?.({ title: 'Action restricted', message, source: 'Service Accounts', level: 'warning' });
  };

  const createAccount = async () => {
    let clientSecret;
    try {
      clientSecret = sanitizeSecret(draft.client_secret || generateClientSecret(), { maxLength: 128 });
    } catch (err) {
      setError(err.message);
      return;
    }
    const payload = {
      client_id: sanitizeIdentifier(draft.client_id, { maxLength: 80 }).trim(),
      client_secret: clientSecret,
      display_name: sanitizeText(draft.display_name, { maxLength: 120 }).trim(),
      permissions: sanitizePermissionList(draft.permissions).filter((permission) => VALID_PERMISSION.test(permission)),
    };
    if (draft.config?.registered_domains?.length) payload.config = buildServiceConfigPayload(draft.config);
    const validationError = compactValidationErrors(
      validateRequiredIdentifier(payload.client_id, 'Client ID', { minLength: 3, maxLength: 80 }),
      validateClientSecret(payload.client_secret),
      validateDisplayName(payload.display_name),
    );
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError('');
    const finish = async (data, warning) => {
      setNewSecret(extractServiceSecret(data) || clientSecret);
      setDraft(emptyDraft());
      setIsCreateOpen(false);
      onNotice?.({
        title: 'Service account created',
        message: warning || 'Copy the generated secret before closing this panel.',
        source: 'Admin',
        level: warning ? 'warning' : 'success',
      });
      await loadAccounts();
    };
    try {
      await finish(await apiFetch('/auth/admin/service-accounts', { method: 'POST', body: payload }));
    } catch (err) {
      if (payload.config && isConfigSchemaError(err)) {
        try {
          const { config: _config, ...fallback } = payload;
          await finish(await apiFetch('/auth/admin/service-accounts', { method: 'POST', body: fallback }), "Account created, but the Service does not accept 'config' yet, so storage targets were not saved.");
          return;
        } catch { /* show the original error */ }
      }
      setError(err?.message || 'Failed to create service account.');
    } finally {
      setSaving(false);
    }
  };

  const saveAccount = async (account) => {
    const edit = editDrafts[String(account.id)] || {};
    const patch = { display_name: sanitizeText(edit.display_name, { maxLength: 120 }).trim() };
    if (!account.is_system) {
      patch.permissions = sanitizePermissionList(edit.permissions).filter((permission) => VALID_PERMISSION.test(permission));
      if (edit.is_active !== undefined) patch.is_active = Boolean(edit.is_active);
    }
    patch.config = buildServiceConfigPayload(edit.config, account.config?.domains || {});
    const validationError = validateDisplayName(patch.display_name);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError('');
    try {
      await patchAccount(apiFetch, account.id, patch);
      onNotice?.({ title: 'Service account updated', message: `${account.client_id} was updated.`, source: 'Admin', level: 'success' });
      setExpandedId('');
      await loadAccounts();
    } catch (err) {
      if (isConfigSchemaError(err)) {
        try {
          const { config: _config, ...fallback } = patch;
          await patchAccount(apiFetch, account.id, fallback);
          onNotice?.({ title: 'Service account updated', message: `${account.client_id} was updated, but the Service does not accept 'config' yet.`, source: 'Admin', level: 'warning' });
          setExpandedId('');
          await loadAccounts();
          return;
        } catch { /* fall through */ }
      }
      restricted(formatServiceAccountError(err, 'Failed to update service account.'));
    } finally {
      setSaving(false);
    }
  };

  const rotateSecret = async (account) => {
    if (account.is_system) { restricted('Protected system account secret cannot be modified.'); return; }
    if (!(await confirmAction({ title: 'Rotate secret', message: `Rotate secret for "${account.client_id}"? Sibling services must be updated with the new secret immediately.`, confirmText: 'Rotate secret' }))) return;
    let rotated;
    try {
      rotated = sanitizeSecret(generateClientSecret(), { maxLength: 128 });
    } catch (err) {
      setError(err.message);
      return;
    }
    const secretError = validateClientSecret(rotated);
    if (secretError) { setError(secretError); return; }
    setSaving(true);
    setError('');
    try {
      const data = await apiFetch(`/auth/admin/service-accounts/${encodeURIComponent(account.id)}`, { method: 'PATCH', body: { client_secret: rotated } });
      setNewSecret(extractServiceSecret(data) || rotated);
      onNotice?.({ title: 'Secret rotated', message: 'Copy the new secret now. It will not be shown again.', source: 'Admin', level: 'warning' });
      await loadAccounts();
    } catch (err) {
      restricted(formatServiceAccountError(err, 'Failed to rotate secret.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (account) => {
    if (account.is_system) { restricted('Protected system accounts cannot be deleted.'); return; }
    if (!(await confirmAction({ title: 'Delete service account', message: `Delete service account "${account.client_id}"? This action cannot be undone.`, confirmText: 'Delete' }))) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/auth/admin/service-accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE' });
      onNotice?.({ title: 'Service account deleted', message: `${account.client_id} was removed.`, source: 'Admin', level: 'warning' });
      if (expandedId === String(account.id)) setExpandedId('');
      await loadAccounts();
    } catch (err) {
      restricted(formatServiceAccountError(err, 'Failed to delete service account.'));
    } finally {
      setSaving(false);
    }
  };

  if (!canManageUsers) {
    return (
      <section className="settings_section">
        <div className="settings_section_header"><div><h3>Service accounts</h3><p>You need users:manage to manage service accounts.</p></div></div>
      </section>
    );
  }

  return (
    <section className="settings_section">
      <ServiceSecretNotice secret={newSecret} onClear={() => setNewSecret('')} />
      {error ? <div className="settings_error">{error}</div> : null}
      <div className="settings_section_header">
        <div>
          <h3>Service accounts</h3>
          <p>Service clients, their permissions and per-domain storage targets.</p>
        </div>
      </div>

      <Section
        title="Create service account"
        description="Register a sibling service with a client secret, permissions and storage targets."
        actions={<button type="button" className="settings_button" onClick={() => setIsCreateOpen((open) => !open)}>{isCreateOpen ? 'Collapse' : 'Expand form'}</button>}
      >
        {isCreateOpen ? (
          <>
            <div className="config_window_grid">
              <label className="config_window_field">
                <span className="config_window_field_label">Client ID *</span>
                <input className="settings_input" value={draft.client_id} maxLength={80} placeholder="e.g. data_pipeline_service" onChange={(event) => setDraft((current) => ({ ...current, client_id: sanitizeIdentifier(event.target.value, { maxLength: 80 }) }))} />
              </label>
              <label className="config_window_field">
                <span className="config_window_field_label">Display name</span>
                <input className="settings_input" value={draft.display_name} maxLength={120} placeholder="e.g. Data Pipeline Service" onChange={(event) => setDraft((current) => ({ ...current, display_name: sanitizeText(event.target.value, { maxLength: 120 }) }))} />
              </label>
              <div className="config_window_field">
                <span className="config_window_field_label">Client secret</span>
                <div className="config_window_option_row">
                  <input className="settings_input" value={draft.client_secret} maxLength={128} onChange={(event) => setDraft((current) => ({ ...current, client_secret: sanitizeSecret(event.target.value, { maxLength: 128 }) }))} />
                  <button type="button" className="settings_button" onClick={() => {
                    const secret = tryGenerateClientSecret();
                    if (!secret) { setError('Secure random generation is unavailable in this browser; a client secret cannot be generated.'); return; }
                    setDraft((current) => ({ ...current, client_secret: secret }));
                  }}>Generate</button>
                </div>
              </div>
            </div>
            <StorageTargetEditor
              config={draft.config}
              onChange={(config) => setDraft((current) => ({ ...current, config }))}
              catalogDomains={catalogDomains}
              catalogState={catalogState}
              onRefreshCatalog={loadCatalog}
              isCdr={isCdr}
            />
            <PermissionEditor value={draft.permissions} onChange={(permissions) => setDraft((current) => ({ ...current, permissions }))} idPrefix="new_service_permissions" />
            <div className="config_window_inline_actions is-end">
              <button type="button" className="settings_button" onClick={() => setIsCreateOpen(false)}>Cancel</button>
              <button type="button" className="settings_button" disabled={saving} onClick={createAccount}>{saving ? 'Creating…' : 'Create service account'}</button>
            </div>
          </>
        ) : null}
      </Section>

      <Section
        title="Configured service accounts"
        description={tn('settings.serviceAccounts.count', accounts.length)}
        actions={<button type="button" className="settings_button" disabled={loading} onClick={loadAccounts}>{loading ? 'Refreshing…' : 'Refresh'}</button>}
      >
        {accounts.length === 0 ? <p className="settings_hint">{loading ? 'Loading service accounts…' : 'No service accounts found.'}</p> : accounts.map((account) => {
          const id = String(account.id);
          const isExpanded = expandedId === id;
          const edit = editDrafts[id] || { display_name: account.display_name, is_active: account.is_active, permissions: account.permissions, config: cloneServiceConfig(account.config) };
          const registered = account.config?.registered_domains || [];
          return (
            <div className={`service_account_card${isExpanded ? ' is-expanded' : ''}`} key={id}>
              <div className="service_account_card_row">
                <div className="service_account_card_info">
                  <div>
                    <small>ID #{account.id}</small>
                    <strong>{account.client_id}</strong>
                    {account.is_system ? <span className="service_account_badge is-system" title="Protected system service account">🔒 System</span> : null}
                    <span className={`service_account_badge ${account.is_active ? 'is-active' : 'is-inactive'}`}>{account.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                  <p>
                    {account.display_name || <em>No display name</em>}
                    {' · '}{tn('settings.serviceAccounts.permissions', account.permissions.length)}
                    {registered.length ? ` · ${registered.map((key) => getDomainMeta(key).label).join(', ')}` : ''}
                  </p>
                </div>
                <div className="service_account_card_actions">
                  <button type="button" className="settings_button" onClick={() => setExpandedId(isExpanded ? '' : id)} title={account.is_system ? 'Inspect daemon configuration and storage coordinates' : 'Edit display name, permissions and storage'}>
                    {isExpanded ? 'Close' : account.is_system ? 'Inspect' : 'Edit'}
                  </button>
                  <button type="button" className="settings_button" disabled={saving || account.is_system} onClick={() => rotateSecret(account)} title={account.is_system ? 'Protected system account secret cannot be modified.' : 'Rotate client secret'}>Rotate secret</button>
                  <button type="button" className="settings_button is-danger" disabled={saving || account.is_system} onClick={() => deleteAccount(account)} title={account.is_system ? 'Protected system accounts cannot be deleted.' : 'Delete service account'}>Delete</button>
                </div>
              </div>
              {isExpanded ? (
                <div className="service_account_card_drawer">
                  {account.is_system ? <p className="settings_hint">🔒 Protected system service account ({account.client_id}): permissions, status and secret are managed by the platform. Display name and storage targets can still be edited.</p> : null}
                  <div className="config_window_grid">
                    <label className="config_window_field">
                      <span className="config_window_field_label">Display name</span>
                      <input className="settings_input" value={edit.display_name || ''} maxLength={120} onChange={(event) => updateEditDraft(id, { display_name: sanitizeText(event.target.value, { maxLength: 120 }) })} />
                    </label>
                    <label className="settings_toggle_row config_window_toggle" title={account.is_system ? 'Protected system accounts cannot be deactivated.' : undefined}>
                      <input type="checkbox" checked={account.is_system ? true : edit.is_active !== false} disabled={account.is_system} onChange={(event) => updateEditDraft(id, { is_active: event.target.checked })} />
                      <span>{account.is_system ? '🔒 Active (locked)' : edit.is_active !== false ? 'Active' : 'Inactive'}</span>
                    </label>
                  </div>
                  <StorageTargetEditor
                    config={edit.config}
                    onChange={(config) => updateEditDraft(id, { config })}
                    catalogDomains={catalogDomains}
                    catalogState={catalogState}
                    onRefreshCatalog={loadCatalog}
                    isCdr={isCdr}
                  />
                  <PermissionEditor
                    value={edit.permissions || []}
                    onChange={(permissions) => updateEditDraft(id, { permissions })}
                    idPrefix={`service_${id}_permissions`}
                    disabled={account.is_system}
                    disabledHint="System daemon permissions are immutable and managed by the platform."
                  />
                  <div className="config_window_inline_actions is-end">
                    <button type="button" className="settings_button" onClick={() => setExpandedId('')}>Cancel</button>
                    <button type="button" className="settings_button" disabled={saving} onClick={() => saveAccount(account)}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </Section>
    </section>
  );
}
