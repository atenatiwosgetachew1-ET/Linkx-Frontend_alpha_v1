import React, { useCallback, useEffect, useMemo, useState } from 'react';
import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';

import { Masthead, PageHero, Pill, SettingsPage, SettingsPopup, Stat, Stats } from './SettingsPage.jsx';
import { LevelIcon, PrivilegePicker, StepStrip } from './panels/UsersPanel.jsx';
import { usePermissionCatalog } from '../../../auth/permissions.js';
import { tn } from '../../../shared/i18n/index.js';
import {
  DOMAIN_SCHEMA_TEMPLATES,
  STANDARD_FORENSIC_DOMAINS,
  canonicalDomain,
  buildServiceConfigPayload,
  cloneServiceConfig,
  defaultDomainConfig,
  defaultServiceConfig,
  extractServiceSecret,
  formatServiceAccountError,
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
  validateDisplayName,
  validateRequiredIdentifier,
} from '../../../utils/inputSecurity.js';

const VALID_PERMISSION = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)+$/;

// The form's three steps (create, and modify an existing account).
const FORM_STEPS = [
  { label: 'Client', hint: 'Who the client is and how it authenticates.' },
  { label: 'Storage targets', hint: 'Optional: storage endpoints per forensic domain. Open Permissions to set what the client may do.' },
  { label: 'Permissions', hint: 'What the client may do.' },
];
const ICONS = {
  server: 'M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01',
  card: 'M3 5h18v14H3zM7 15h4M15 9h2M15 13h2M9 8.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zM15.5 7.5l3 3L22 7l-3-3',
  power: 'M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  refresh: 'M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10',
  search: 'M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
  pencil: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
};
const STATE_ICONS = {
  idle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  ok: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  bad: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
};

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
      <div className="settings_secret_notice_actions">
        <button type="button" className="settings_button" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
        <button type="button" className="settings_button is-danger" onClick={onClear}>Dismiss</button>
      </div>
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
        className="graph_customize_input"
        aria-label="Source column"
        value={localKey}
        maxLength={80}
        placeholder="e.g. SENDER_ID"
        onChange={(event) => setLocalKey(event.target.value.replace(/[^a-zA-Z0-9_]/g, '').toUpperCase())}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }}
      />
      <span aria-hidden="true">→</span>
      <select className="graph_customize_input" aria-label="Canonical field" value={target} onChange={(event) => onTarget(sourceKey, event.target.value)}>
        {canonical.map((column) => <option key={column.value} value={column.value}>{column.label}</option>)}
        {!canonical.some((column) => column.value === target) ? <option value={target}>{target}</option> : null}
      </select>
      <button type="button" className="users_person_edit service_target_mapping_remove linkx_tooltip_anchor" data-tooltip="Remove" aria-label={`Remove mapping ${sourceKey}`} onClick={() => onRemove(sourceKey)}>
        <LevelIcon d="M18 6L6 18M6 6l12 12" size={13} />
      </button>
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
    const clean = canonicalDomain(customDomain.trim().toLowerCase().replace(/[^a-z0-9_]/g, ''));
    if (!clean) return;
    if (!registered.includes(clean)) toggleRegistration(clean);
    else setActiveDomain(clean);
    setCustomDomain('');
  };

  const catalogList = useMemo(() => {
    const base = catalogDomains.length ? Array.from(new Set(catalogDomains.map(canonicalDomain))) : STANDARD_FORENSIC_DOMAINS;
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
  const templateSchema = DOMAIN_SCHEMA_TEMPLATES[activeDomain === 'banking' ? 'bank' : activeDomain] || DOMAIN_SCHEMA_TEMPLATES.bank;
  const loadTemplate = () => {
    updateFields({ fetch_columns: [...templateSchema.fetch_columns], column_mapping: { ...templateSchema.column_mapping } });
  };
  // True while the columns and mappings are exactly the template's; any
  // edit after loading it makes this false again (and the button live).
  const templateLoaded = fetchColumns.length === templateSchema.fetch_columns.length
    && fetchColumns.every((column, index) => column === templateSchema.fetch_columns[index])
    && mappingEntries.length === Object.keys(templateSchema.column_mapping).length
    && mappingEntries.every(([source, target]) => templateSchema.column_mapping[source] === target);
  // Disabled while the template is what the form already holds.
  const templateButton = (className) => (
    <button type="button" className={`${className} service_target_template`} disabled={templateLoaded} title={templateLoaded ? 'The columns and mappings are already the template’s. Change one to load it again.' : 'Fill the columns and mappings from this domain’s template'} onClick={loadTemplate}>
      <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" /></svg>
      Load template
    </button>
  );

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
        <span className="users_input_wrap has-action service_target_custom">
          <input
            className="graph_customize_input"
            aria-label="Custom domain"
            value={customDomain}
            maxLength={40}
            placeholder="Register a custom domain, e.g. crypto, logistics, customs"
            onChange={(event) => setCustomDomain(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addCustomDomain(); } }}
          />
          <button type="button" className="users_input_action linkx_tooltip_anchor" data-tooltip="Add domain" aria-label="Add domain" disabled={!customDomain.trim()} onClick={addCustomDomain}>
            <LevelIcon d="M12 5v14M5 12h14" size={13} />
          </button>
        </span>
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
                {!readOnly ? templateButton('settings_link_button') : null}
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

              {/* Opens in a popup of its own, over this one. */}
              <div className="service_target_advanced_toggle">
                <button type="button" className="service_target_advanced_open" onClick={() => setAdvancedOpen(true)} aria-haspopup="dialog" aria-expanded={advancedOpen}>
                  <span>
                    <strong>Advanced schema &amp; column mapping (optional){templateLoaded ? <em className="service_target_template_tag">Template</em> : null}</strong>
                    <small>Custom column names and Elasticsearch schema overrides for {activeDomain}. {fetchColumns.length} columns · {mappingEntries.length} mappings.</small>
                  </span>
                </button>
                {/* Drops every column and mapping of this domain at once. */}
                {!readOnly ? (
                  <button
                    type="button"
                    className="users_person_edit service_target_mapping_remove linkx_tooltip_anchor"
                    data-tooltip="Drop all columns and mappings"
                    aria-label={`Drop all columns and mappings of ${activeDomain}`}
                    disabled={!fetchColumns.length && !mappingEntries.length}
                    onClick={() => updateFields({ fetch_columns: [], column_mapping: {} })}
                  >
                    <LevelIcon d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" size={14} />
                  </button>
                ) : null}
              </div>

              {advancedOpen ? (
                <SettingsPopup
                  title="Advanced schema & column mapping"
                  subtitle={getDomainMeta(activeDomain).label}
                  hint={`${fetchColumns.length} columns · ${mappingEntries.length} mappings. Changes are kept with the account's form.`}
                  onClose={() => setAdvancedOpen(false)}
                  footer={(
                    <>
                      {/* The template fills exactly what this popup edits. */}
                      {!readOnly ? templateButton('graph_customize_button') : null}
                      <button type="button" className="graph_customize_button is-primary" onClick={() => setAdvancedOpen(false)}>Done</button>
                    </>
                  )}
                >
                <div className="service_target_editor service_target_advanced">
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
                    <span className="users_input_wrap has-action service_target_custom">
                      <input
                        className="graph_customize_input"
                        aria-label="Add columns"
                        value={columnInput}
                        maxLength={160}
                        placeholder="Add columns, e.g. RECORD_ID, SENDER_ID, AMOUNT"
                        onChange={(event) => setColumnInput(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addColumns(); } }}
                      />
                      <button type="button" className="users_input_action linkx_tooltip_anchor" data-tooltip="Add column" aria-label="Add column" disabled={!columnInput.trim()} onClick={addColumns}>
                        <LevelIcon d="M12 5v14M5 12h14" size={13} />
                      </button>
                    </span>
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
                  {!readOnly ? <button type="button" className="users_pill service_target_add_pair" onClick={addMapping}><LevelIcon d="M12 5v14M5 12h14" size={11} />Add mapping pair</button> : null}
                </div>
                </SettingsPopup>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ── Service accounts panel ── */

const emptyDraft = () => ({ client_id: '', display_name: '', permissions: [], config: defaultServiceConfig() });

const patchAccount = (apiFetch, id, body) => apiFetch(`/auth/admin/service-accounts/${encodeURIComponent(id)}`, { method: 'PATCH', body });

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
  // The page, after the Users page: two cards, each opening a popup. The
  // form popup (create, or modify an existing account) runs in three steps.
  const [isExistingOpen, setIsExistingOpen] = useState(false);
  const [modifying, setModifying] = useState(null);
  const [step, setStep] = useState(0);
  const [checked, setChecked] = useState(false);
  const [query, setQuery] = useState('');
  // The permissions open in a popup of their own, over the form.
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  // The list card showing its brief (one at a time).
  const [briefId, setBriefId] = useState('');
  const { groups: permissionGroups, all: allPermissions } = usePermissionCatalog();

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
    const payload = {
      client_id: sanitizeIdentifier(draft.client_id, { maxLength: 80 }).trim(),
      display_name: sanitizeText(draft.display_name, { maxLength: 120 }).trim(),
      permissions: sanitizePermissionList(draft.permissions).filter((permission) => VALID_PERMISSION.test(permission)),
    };
    if (draft.config?.registered_domains?.length) payload.config = buildServiceConfigPayload(draft.config);
    const validationError = compactValidationErrors(
      validateRequiredIdentifier(payload.client_id, 'Client ID', { minLength: 3, maxLength: 80 }),
      validateDisplayName(payload.display_name),
    );
    if (validationError) {
      // What is wrong shows on the fields of the first step.
      setChecked(true);
      setStep(0);
      setError('');
      return;
    }
    setSaving(true);
    setError('');
    try {
      // The Service makes the secret and gives it once (B-3).
      const secret = extractServiceSecret(await apiFetch('/auth/admin/service-accounts', { method: 'POST', body: payload }));
      setNewSecret(secret);
      setDraft(emptyDraft());
      setIsCreateOpen(false);
      setStep(0);
      setChecked(false);
      onNotice?.({
        title: 'Service account created',
        message: secret ? 'Copy the secret before closing this panel. It is shown once.' : 'The Service returned no secret. Rotate it to get one.',
        source: 'Admin',
        level: secret ? 'success' : 'warning',
      });
      await loadAccounts();
    } catch (err) {
      setError(formatServiceAccountError(err, 'Failed to create service account.'));
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
    if (validationError) { setError(validationError); return false; }
    setSaving(true);
    setError('');
    try {
      await patchAccount(apiFetch, account.id, patch);
      onNotice?.({ title: 'Service account updated', message: `${account.client_id} was updated.`, source: 'Admin', level: 'success' });
      setExpandedId('');
      await loadAccounts();
      return true;
    } catch (err) {
      restricted(formatServiceAccountError(err, 'Failed to update service account.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const rotateSecret = async (account) => {
    if (account.is_system) { restricted('Protected system account secret cannot be modified.'); return; }
    if (!(await confirmAction({ title: 'Rotate secret', message: `Rotate secret for "${account.client_id}"? Sibling services must be updated with the new secret immediately.`, confirmText: 'Rotate secret', icon: 'key' }))) return;
    setSaving(true);
    setError('');
    try {
      const secret = extractServiceSecret(await apiFetch(`/auth/admin/service-accounts/${encodeURIComponent(account.id)}/rotate-secret`, { method: 'POST', body: {} }));
      setNewSecret(secret);
      onNotice?.({ title: 'Secret rotated', message: secret ? 'Copy the new secret now. It will not be shown again.' : 'The Service rotated it but returned no secret. Rotate it again.', source: 'Admin', level: 'warning' });
      await loadAccounts();
    } catch (err) {
      restricted(formatServiceAccountError(err, 'Failed to rotate secret.'));
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (account) => {
    if (account.is_system) { restricted('Protected system accounts cannot be deleted.'); return false; }
    if (!(await confirmAction({ title: 'Delete service account', message: `Delete service account "${account.client_id}"? This action cannot be undone.`, confirmText: 'Delete', icon: 'delete' }))) return false;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/auth/admin/service-accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE' });
      onNotice?.({ title: 'Service account deleted', message: `${account.client_id} was removed.`, source: 'Admin', level: 'warning' });
      if (expandedId === String(account.id)) setExpandedId('');
      await loadAccounts();
      return true;
    } catch (err) {
      restricted(formatServiceAccountError(err, 'Failed to delete service account.'));
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!canManageUsers) {
    return (
      <SettingsPage>
        <Masthead>
          <PageHero tone="locked" eyebrow="Service accounts" title="Access restricted" meta="You need users:manage to manage service accounts." media={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M5 2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM5 14h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM6 6h.01M6 18h.01" /></svg>}>
            <Pill>Locked</Pill>
          </PageHero>
        </Masthead>
      </SettingsPage>
    );
  }

  const activeAccounts = accounts.filter((account) => account.is_active).length;
  const systemAccounts = accounts.filter((account) => account.is_system).length;
  const registeredDomains = new Set(accounts.flatMap((account) => account.config?.registered_domains || [])).size;

  const openCreate = () => {
    setError('');
    setModifying(null);
    setStep(0);
    setChecked(false);
    setIsExistingOpen(false);
    setIsCreateOpen(true);
  };
  const openExisting = () => {
    setError('');
    setIsCreateOpen(false);
    setModifying(null);
    setIsExistingOpen(true);
  };
  // Edit on an account's card: the same form, filled with the account.
  const openModify = (account) => {
    setError('');
    setStep(0);
    setChecked(false);
    setModifying(account);
    setIsExistingOpen(false);
  };
  // Leaving the form: a modified account goes back to the list as it was left.
  const closeForm = () => {
    setPermissionsOpen(false);
    setError('');
    setStep(0);
    if (modifying) {
      setModifying(null);
      setIsExistingOpen(true);
    } else {
      setIsCreateOpen(false);
    }
  };
  // The card's switch: active / inactive, saved at once.
  const toggleActive = async (account) => {
    if (account.is_system) { restricted('Protected system accounts cannot be deactivated.'); return; }
    const next = !account.is_active;
    setSaving(true);
    setError('');
    try {
      await patchAccount(apiFetch, account.id, { is_active: next });
      onNotice?.({ title: next ? 'Service account activated' : 'Service account deactivated', message: `${account.client_id} ${next ? 'can authenticate again.' : 'can no longer authenticate.'}`, source: 'Admin', level: next ? 'success' : 'warning' });
      await loadAccounts();
    } catch (err) {
      restricted(formatServiceAccountError(err, 'Failed to update service account.'));
    } finally {
      setSaving(false);
    }
  };

  const isFormOpen = isCreateOpen || Boolean(modifying);
  const modifyId = modifying ? String(modifying.id) : '';
  const edit = modifying ? (editDrafts[modifyId] || { display_name: modifying.display_name, is_active: modifying.is_active, permissions: modifying.permissions, config: cloneServiceConfig(modifying.config) }) : null;
  const system = Boolean(modifying?.is_system);
  // The form's values and their setter: the new account's draft, or the
  // modified account's.
  const form = modifying ? edit : draft;
  const setForm = (patch) => (modifying ? updateEditDraft(modifyId, patch) : setDraft((current) => ({ ...current, ...patch })));
  const fieldProblems = modifying
    ? { display_name: validateDisplayName(String(form?.display_name || '').trim()) }
    : {
      client_id: validateRequiredIdentifier(String(draft.client_id || '').trim(), 'Client ID', { minLength: 3, maxLength: 80 }),
      display_name: validateDisplayName(String(draft.display_name || '').trim()),
    };
  const goToStep = (next) => {
    if (next > 0 && Object.values(fieldProblems).some(Boolean)) {
      setChecked(true);
      setStep(0);
      return;
    }
    setError('');
    setStep(next);
  };
  const filteredAccounts = accounts.filter((account) => {
    const needle = query.trim().toLowerCase();
    return !needle || [account.client_id, account.display_name, ...(account.permissions || []), ...(account.config?.registered_domains || [])].some((value) => String(value || '').toLowerCase().includes(needle));
  });

  // A labelled field of the form: its name and icon above, the input with a
  // mark of its condition, a line of help underneath.
  const field = ({ key, label, icon, value, problem = '', optional = false, locked = false, hint, input, after = null }) => {
    const state = locked ? 'idle' : problem && (value || checked) ? 'bad' : !value ? 'idle' : 'ok';
    const note = locked ? 'Cannot be changed.' : state === 'bad' ? problem : state === 'ok' ? 'Looks good.' : optional ? 'Optional.' : 'Required.';
    return (
      <label className={`users_input_field is-${state}${locked ? ' is-locked' : ''}`} key={key}>
        <span className="users_input_label">
          <span className="users_input_name"><LevelIcon d={icon} size={13} />{label}</span>
          {state === 'bad' ? <em className="users_input_error" role="alert">{problem}</em> : null}
        </span>
        <span className={'users_input_wrap' + (after ? ' has-action' : '')}>
          <input className="graph_customize_input" value={value} aria-invalid={state === 'bad' || undefined} disabled={locked} {...input} />
          <i className="users_input_state" title={note} aria-hidden="true"><LevelIcon d={locked ? ICONS.lock : STATE_ICONS[state]} size={15} /></i>
          {after}
        </span>
        <small className="graph_customize_hint">{hint}</small>
      </label>
    );
  };

  const stepBodies = isFormOpen ? [
    <div className="users_wizard_fields" key="client">
      {field({
        key: 'client_id',
        label: 'Client ID',
        icon: ICONS.server,
        value: modifying ? modifying.client_id : draft.client_id,
        problem: fieldProblems.client_id,
        locked: Boolean(modifying),
        hint: modifying ? 'Client IDs cannot be changed.' : 'At least 3 characters. Sibling services authenticate with it.',
        input: { autoComplete: 'off', maxLength: 80, placeholder: 'e.g. data_pipeline_service', onChange: (event) => setForm({ client_id: sanitizeIdentifier(event.target.value, { maxLength: 80 }) }) },
      })}
      {field({
        key: 'display_name',
        label: 'Display name',
        icon: ICONS.card,
        value: form.display_name || '',
        problem: fieldProblems.display_name,
        optional: true,
        hint: 'Optional. A readable name for this client.',
        input: { maxLength: 120, placeholder: 'e.g. Data Pipeline Service', onChange: (event) => setForm({ display_name: sanitizeText(event.target.value, { maxLength: 120 }) }) },
      })}
      {modifying ? (
        <label className={'users_input_field settings_switch users_wizard_switch' + (system ? ' is-restricted' : '')} title={system ? 'Protected system accounts cannot be deactivated.' : undefined}>
          <span className="users_input_label"><span className="users_input_name"><LevelIcon d={ICONS.power} size={13} />Active</span></span>
          <span className="users_wizard_switch_row">
            <input type="checkbox" role="switch" aria-label="Active" aria-disabled={system || undefined} checked={system ? true : form.is_active !== false} onChange={(event) => (system ? restricted('Protected system accounts cannot be deactivated.') : setForm({ is_active: event.target.checked }))} />
            <span className="graph_customize_hint">{system ? 'Always active (system account).' : form.is_active !== false ? 'Can authenticate.' : 'Cannot authenticate.'}</span>
          </span>
        </label>
      ) : <p className="graph_customize_hint">The Service makes the client secret. It is shown once, after the account is created.</p>}
    </div>,
    <div className="service_storage_step" key="storage">
      <StorageTargetEditor
        config={form.config}
        onChange={(config) => setForm({ config })}
        catalogDomains={catalogDomains}
        catalogState={catalogState}
        onRefreshCatalog={loadCatalog}
        isCdr={isCdr}
      />
    </div>,
    null,
  ] : [];
  const summaries = isFormOpen ? [
    '',
    `${(form.config?.registered_domains || []).length} domains`,
    `${(form.permissions || []).length} of ${allPermissions.length}`,
  ] : [];

  return (
    <SettingsPage className="settings_section">
      <Masthead>
        <PageHero eyebrow="Service accounts" title="Service clients" meta="Service clients, their permissions and per-domain storage targets." media={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS.server} /></svg>} />
        <Stats label="Service account figures" columns={4}>
          <Stat lead icon="server" label="Accounts" value={accounts.length.toLocaleString()} note="service clients" />
          <Stat icon="check" tone="success" label="Active" value={activeAccounts.toLocaleString()} note={`${(accounts.length - activeAccounts).toLocaleString()} inactive`} />
          <Stat icon="shield" label="System" value={systemAccounts.toLocaleString()} note="protected by the platform" />
          <Stat icon="database" label="Domains" value={registeredDomains.toLocaleString()} note="with storage targets" />
        </Stats>
      </Masthead>
      <ServiceSecretNotice secret={newSecret} onClear={() => setNewSecret('')} />
      {error && !isFormOpen && !isExistingOpen ? <div className="settings_error">{error}</div> : null}

      {/* Two actions, side by side; each opens its popup. */}
      <div className="settings_launch_cards">
        <button type="button" className="settings_launch_card" aria-haspopup="dialog" aria-expanded={isCreateOpen} onClick={openCreate}>
          <span className="settings_launch_icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h18v7H3zM3 13h10v7H3zM7 7.5h.01M7 16.5h.01M19 14v6M22 17h-6" /></svg>
          </span>
          <span className="settings_launch_text">
            <strong>Create service account</strong>
            <small>Register a sibling service with a secret, permissions and storage targets.</small>
          </span>
        </button>
        <button type="button" className="settings_launch_card" aria-haspopup="dialog" aria-expanded={isExistingOpen} onClick={openExisting}>
          <span className="settings_launch_icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ICONS.server} /></svg>
          </span>
          <span className="settings_launch_text">
            <strong>Existing service accounts</strong>
            <small>Review, update, rotate the secret of, or remove current clients.</small>
          </span>
        </button>
      </div>

      {isFormOpen ? (
        <SettingsPopup
          narrow
          title={modifying ? 'Modify Service Account' : 'Create service account'}
          subtitle={modifying ? `${modifying.client_id} · step ${step + 1} of 2` : `Step ${step + 1} of 2`}
          hint={saving ? (modifying ? 'Updating the account…' : 'Creating the account…') : FORM_STEPS[step].hint}
          busy={saving}
          onClose={closeForm}
          footer={(
            <>
              {modifying && !system ? <button type="button" className="graph_customize_button users_danger" disabled={saving} onClick={async () => { if (await deleteAccount(modifying)) closeForm(); }}>Delete</button> : null}
              {step > 0 ? <button type="button" className="graph_customize_button" disabled={saving} onClick={() => goToStep(step - 1)}>Back</button> : null}
              {/* A new account is created from the second page; a modified
                  one can be saved from either. */}
              {step === 0 ? <button type="button" className={'graph_customize_button' + (modifying ? '' : ' is-primary')} disabled={saving} onClick={() => goToStep(step + 1)}>Next</button> : null}
              {modifying ? (
                <button type="button" className="graph_customize_button is-primary" disabled={saving} onClick={async () => { if (await saveAccount(modifying)) closeForm(); }}>{saving ? 'Updating…' : 'Update'}</button>
              ) : step === 0 ? null : (
                <button type="button" className="graph_customize_button is-primary" disabled={saving} onClick={createAccount}>{saving ? 'Creating…' : 'Create service account'}</button>
              )}
            </>
          )}
        >
          <div className="users_make">
            {error ? <div className="settings_error users_popup_error">{error}</div> : null}
            <StepStrip step={step}>
              {FORM_STEPS.map((item, index) => {
                const state = index === step ? 'current' : index < step ? 'done' : 'todo';
                // The permissions are not a page: their header, under the
                // storage targets, opens them in a popup of their own.
                const opensPopup = index === 2;
                const inView = state === 'current' || (opensPopup && step === 1);
                return (
                  <li key={item.label} className={`users_wizard_step is-${state}${opensPopup ? ' is-popup' : ''}`} data-step={index + 1} inert={!inView}>
                    <div className="users_wizard_headrow">
                      <button
                        type="button"
                        className="users_wizard_head"
                        aria-current={state === 'current' ? 'step' : undefined}
                        aria-expanded={opensPopup ? permissionsOpen : state === 'current'}
                        aria-haspopup={opensPopup ? 'dialog' : undefined}
                        disabled={saving}
                        onClick={() => (opensPopup ? setPermissionsOpen(true) : goToStep(index))}
                      >
                        <i aria-hidden="true">{state === 'done' ? '✓' : index + 1}</i>
                        <strong className="graph_customize_section_head">{item.label}</strong>
                        {state !== 'current' && summaries[index] ? <small>{summaries[index]}</small> : null}
                        {opensPopup ? <span className="users_wizard_open" aria-hidden="true"><LevelIcon d="M9 6l6 6-6 6" size={13} /></span> : null}
                      </button>
                    </div>
                    {opensPopup ? null : <div className="users_wizard_body" inert={state !== 'current'}>{stepBodies[index]}</div>}
                  </li>
                );
              })}
            </StepStrip>
          </div>
        </SettingsPopup>
      ) : null}
      {isFormOpen && permissionsOpen ? (
        <SettingsPopup
          title="Permissions"
          subtitle={modifying ? modifying.client_id : String(draft.client_id || '').trim()}
          hint={system ? 'System daemon permissions are managed by the platform.' : `${(form.permissions || []).length} of ${allPermissions.length} granted. Kept with the account's form.`}
          onClose={() => setPermissionsOpen(false)}
          footer={(
            <>
              {system ? null : <button type="button" className="graph_customize_button" onClick={() => setForm({ permissions: [] })}>Clear</button>}
              <button type="button" className="graph_customize_button is-primary" onClick={() => setPermissionsOpen(false)}>Done</button>
            </>
          )}
        >
    <section className="users_wizard_privileges" aria-label="Permissions" inert={system || undefined} title={system ? 'System daemon permissions are immutable and managed by the platform.' : undefined}>
      <PrivilegePicker groups={permissionGroups} all={allPermissions} value={form.permissions || []} onChange={(permissions) => setForm({ permissions })} />
    </section>
        </SettingsPopup>
      ) : null}

      {isExistingOpen && !isFormOpen ? (
        <SettingsPopup
          narrow
          title="Existing service accounts"
          subtitle={`${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}`}
          hint={loading ? 'Loading service accounts…' : filteredAccounts.length === accounts.length ? 'Every service client of this workspace.' : `Showing ${filteredAccounts.length} of ${accounts.length}.`}
          busy={saving}
          onClose={() => setIsExistingOpen(false)}
        >
          <div className="users_existing">
            {error ? <div className="settings_error users_popup_error">{error}</div> : null}
            <ServiceSecretNotice secret={newSecret} onClear={() => setNewSecret('')} />
            <label className="users_input_field">
              <span className="users_input_label"><span className="users_input_name"><LevelIcon d={ICONS.search} size={13} />Search</span></span>
              <span className="users_input_wrap">
                <input type="search" className="graph_customize_input" aria-label="Search service accounts" value={query} placeholder="Client, permission or domain" onChange={(event) => setQuery(sanitizeText(event.target.value, { maxLength: 160 }))} />
                <i className="users_input_state" aria-hidden="true"><LevelIcon d={ICONS.search} size={15} /></i>
              </span>
            </label>
            {filteredAccounts.length > 0 ? (
              <ul className="users_people" aria-label="Service accounts">
                {filteredAccounts.map((account) => {
                  const registered = account.config?.registered_domains || [];
                  const id = String(account.id);
                  const isBriefOpen = briefId === id;
                  // The brief: what the client may do, by area, and where
                  // each of its domains is stored. Not the whole account.
                  const areas = Object.entries((account.permissions || []).reduce((counts, permission) => {
                    const area = String(permission).split(':')[0] || 'other';
                    return { ...counts, [area]: (counts[area] || 0) + 1 };
                  }, {}));
                  return (
                    <li key={account.id} className={'users_person has-brief' + (account.is_active ? '' : ' is-off') + (isBriefOpen ? ' is-open' : '')}>
                     <div className="users_person_row">
                      <button type="button" className="users_person_open" aria-expanded={isBriefOpen} title={isBriefOpen ? 'Hide the brief' : 'Show a brief of this account'} onClick={() => setBriefId(isBriefOpen ? '' : id)}>
                      <span className="users_level_icon" aria-hidden="true"><LevelIcon d={account.is_system ? ICONS.lock : ICONS.server} size={15} /></span>
                      <span className="users_level_text">
                        <strong>{account.client_id}</strong>
                        <small>
                          {[account.display_name, tn('settings.serviceAccounts.permissions', (account.permissions || []).length), registered.map((key) => getDomainMeta(key).label).join(', ')].filter(Boolean).join(' · ')}
                        </small>
                      </span>
                      </button>
                      {account.is_system ? <span className="users_level_count" title="Protected system service account">System</span> : null}
                      {/* The card's actions: edit, rotate the secret, active / inactive. */}
                      <button type="button" className="users_person_edit linkx_tooltip_anchor" data-tooltip={account.is_system ? 'Inspect' : 'Edit'} aria-label={(account.is_system ? 'Inspect ' : 'Edit ') + account.client_id} disabled={saving} onClick={() => openModify(account)}>
                        <LevelIcon d={ICONS.pencil} size={14} />
                      </button>
                      <button type="button" className="users_person_edit linkx_tooltip_anchor" data-tooltip={account.is_system ? 'System secret is protected' : 'Rotate secret'} aria-label={'Rotate secret of ' + account.client_id} disabled={saving || account.is_system} onClick={() => rotateSecret(account)}>
                        <LevelIcon d={ICONS.key} size={14} />
                      </button>
                      <label className={'settings_switch users_person_toggle' + (account.is_system ? ' is-restricted' : '')} title={account.is_system ? 'Protected system accounts cannot be deactivated.' : account.is_active ? 'Active: switch off to deactivate' : 'Inactive: switch on to activate'}>
                        <input type="checkbox" role="switch" aria-label={(account.is_active ? 'Deactivate ' : 'Activate ') + account.client_id} aria-disabled={account.is_system || undefined} checked={Boolean(account.is_active)} disabled={saving} onChange={() => toggleActive(account)} />
                        <span aria-hidden="true">{account.is_active ? 'Active' : 'Inactive'}</span>
                      </label>
                     </div>
                     {isBriefOpen ? (
                       <dl className="users_person_brief" aria-label={'Brief of ' + account.client_id}>
                         <div>
                           <dt><LevelIcon d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" size={12} />Permissions</dt>
                           <dd>
                             {areas.length ? areas.map(([area, count]) => <span className="users_person_fact" key={area}>{area}<b>{count}</b></span>) : <em>None granted</em>}
                           </dd>
                         </div>
                         <div>
                           <dt><LevelIcon d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" size={12} />Storage</dt>
                           <dd>
                             {registered.length ? registered.map((key) => {
                               const cfg = account.config?.domains?.[key] || {};
                               return <span className={'users_person_fact' + (cfg.storage_host ? ' is-code' : ' is-unset')} key={key}>{getDomainMeta(key).label}<b>{cfg.storage_host ? `${cfg.storage_host}:${cfg.storage_port || getDomainMeta(key).defaultPort}` : 'not set'}</b></span>;
                             }) : <em>No domain registered</em>}
                           </dd>
                         </div>
                         <div>
                           <dt><LevelIcon d={ICONS.card} size={12} />Account</dt>
                           <dd>
                             <span className="users_person_fact">ID<b>#{account.id}</b></span>
                             <span className="users_person_fact">Type<b>{account.is_system ? 'System (protected)' : 'Client'}</b></span>
                           </dd>
                         </div>
                       </dl>
                     ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : loading ? (
              <WindowLoadScreen className="is-block" label="Loading service accounts…" />
            ) : (
              <p className="users_empty" role="status" aria-live="polite">{accounts.length === 0 ? 'No service accounts found.' : 'No matching service accounts.'}</p>
            )}
          </div>
        </SettingsPopup>
      ) : null}
    </SettingsPage>
  );
}
