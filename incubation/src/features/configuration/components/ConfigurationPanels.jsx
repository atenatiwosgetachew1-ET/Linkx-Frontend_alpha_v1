import React, { useMemo } from 'react';

import { DraftInput, Field, ListTextarea, OptionField, Section } from '../../../shared/components/form/FormFields.jsx';
import {
  checkIsBuiltinRule,
  formatDomainPillarLabel,
  getActiveDomainKey,
  getRegisteredDomains,
  getRuleItemName,
  getRuleNames,
  isConfigAutoFillEnabled,
  normalizeActiveRuleValue,
  normalizeColumnMappingEntries,
  normalizeElasticScrollLimit,
  normalizeLargeSearchBackend,
  readClassifiedEntities,
} from '../lib/configModel.js';
import { sanitizeText } from '../../../utils/inputSecurity.js';
import { CONFIG_PROFILE_KEY, PROFILE_FIELDS, profileToConfiguration, resolveProfileSettings } from '../../graph/lib/nodeProfile.js';

const truthy = (value) => value === true || value === 'true';

/* ── System ─────────────────────────────────────────────────────────── */

export function SystemPanel({ draft, onChange, onSwitchDomain, isSwitchingDomain, canWrite, idleSettings, idlePolicyMeta, onIdleSettingsChange }) {
  const activeDomain = getActiveDomainKey(draft);
  const registeredDomains = getRegisteredDomains(draft);
  const domainConnections = draft?.domain_connections && typeof draft.domain_connections === 'object' ? draft.domain_connections : {};
  const activeConn = domainConnections[activeDomain] || {};
  const configured = activeConn.configured !== false;
  const tables = Array.isArray(activeConn.storage_tables) ? activeConn.storage_tables : (Array.isArray(draft?.storage_tables) ? draft.storage_tables : []);
  const sourceCol = activeConn.default_source_col || draft?.default_source_col || '';
  const targetCol = activeConn.default_target_col || draft?.default_target_col || '';
  const meta = [
    ['Target DB', activeConn.storage_database || draft?.active_storage_database || '—'],
    ['Storage port', activeConn.storage_port || draft?.api_port || '5000'],
    ['Date field', activeConn.date_column || draft?.date_column || '—'],
    ['Source / target', sourceCol && targetCol ? `${sourceCol} → ${targetCol}` : 'Auto'],
    ['Storage path', activeConn.storage_path || draft?.storage_path || '—'],
  ];

  const editable = Array.isArray(idlePolicyMeta?.editableFields) ? idlePolicyMeta.editableFields : [];
  const policyBusy = idlePolicyMeta?.isLoading || idlePolicyMeta?.isSaving;
  const canEditPolicy = (field) => !policyBusy && (editable.length === 0 || editable.includes(field));
  const minutes = (ms, min) => Math.max(min, Math.round((Number(ms) || 0) / 60000));
  const updateMinutes = (key, value) => {
    const min = key === 'warningMs' ? 0 : 1;
    const next = Math.max(min, Math.min(1440, Number.parseInt(value, 10) || 0));
    onIdleSettingsChange((previous) => ({ ...previous, [key]: next * 60000 }));
  };

  return (
    <>
      <Section
        title="Domain pillar (session)"
        description="Active investigative pillar for this session. Switching re-projects database catalogs, ports, storage paths and schema mappings on the backend."
      >
        <Field label="Active domain pillar" hint={isSwitchingDomain ? 'Switching pillar and projecting configuration…' : 'Takes effect immediately for this session and every Source window.'}>
          <select
            className="settings_input"
            value={activeDomain}
            disabled={isSwitchingDomain || !canWrite}
            onChange={(event) => onSwitchDomain(event.target.value)}
          >
            {registeredDomains.map((key) => {
              const conn = domainConnections[key];
              const ready = conn ? conn.configured !== false : true;
              return <option key={key} value={key}>{formatDomainPillarLabel(key)} ({ready ? 'Ready' : 'Unconfigured'})</option>;
            })}
          </select>
        </Field>
        <div className={`config_window_domain_card ${configured ? 'is-ready' : 'is-unconfigured'}`}>
          <div className="config_window_domain_card_header">
            <strong>{formatDomainPillarLabel(activeDomain)}</strong>
            <span>{configured ? '● Configured' : '○ Unconfigured'}</span>
          </div>
          <dl className="config_window_domain_meta">
            {meta.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd title={String(value)}>{value}</dd>
              </div>
            ))}
          </dl>
          {tables.length > 0 ? <p className="config_window_domain_tables" title={tables.join(', ')}><span>Tables:</span> {tables.join(', ')}</p> : null}
        </div>
      </Section>

      <fieldset className="config_window_write_gate" disabled={!canWrite} title={canWrite ? undefined : 'You need config:write to change these settings.'}>
      <Section
        title="Session timeout policy"
        description={`Loaded from and saved to the backend session policy. Source: ${idlePolicyMeta?.source || 'session'}.`}
      >
        <div className="config_window_grid is-compact">
          <Field label="Warn after (min)">
            <DraftInput name="warningMs" type="number" min="0" max="1439" value={minutes(idleSettings?.warningMs, 0)} disabled={!canEditPolicy('idle_warning_ms')} onCommit={updateMinutes} />
          </Field>
          <Field label="Lock after (min)">
            <DraftInput name="lockMs" type="number" min="1" max="1440" value={minutes(idleSettings?.lockMs, 1)} disabled={!canEditPolicy('idle_lock_ms')} onCommit={updateMinutes} />
          </Field>
          <Field label="Logout after (min)">
            <DraftInput name="timeoutMs" type="number" min="1" max="1440" value={minutes(idleSettings?.timeoutMs, 1)} disabled={!canEditPolicy('max_idle_timeout_ms')} onCommit={updateMinutes} />
          </Field>
        </div>
        <label className="settings_toggle_row config_window_toggle">
          <input
            type="checkbox"
            checked={idleSettings?.lockRequiresReauth !== false}
            disabled={!canEditPolicy('lock_requires_reauth')}
            onChange={(event) => onIdleSettingsChange((previous) => ({ ...previous, lockRequiresReauth: event.target.checked }))}
          />
          <span>Require re-auth after lock</span>
        </label>
        {Number.isFinite(idlePolicyMeta?.authTokenSeconds) ? <p className="settings_hint">Auth token lifetime: {Math.max(1, Math.round(idlePolicyMeta.authTokenSeconds / 60))} minute(s).</p> : null}
        {idlePolicyMeta?.isLoading ? <p className="settings_hint">Refreshing session policy…</p> : null}
        {idlePolicyMeta?.isSaving ? <p className="settings_hint">Saving session policy…</p> : null}
        {idlePolicyMeta?.error ? <div className="settings_error">{idlePolicyMeta.error}</div> : null}
      </Section>

      <Section title="Miscellaneous" description="Saved with the configuration.">
        <div className="settings_toggle_list">
          <label className="settings_toggle_row">
            <input type="checkbox" checked={truthy(draft?.automation)} onChange={(event) => onChange('automation', event.target.checked)} />
            <span>Automate across services</span>
          </label>
          <label className="settings_toggle_row">
            <input type="checkbox" checked={truthy(draft?.remote)} onChange={(event) => onChange('remote', event.target.checked)} />
            <span>Remote requests</span>
          </label>
          <label className="settings_toggle_row">
            <input type="checkbox" checked={isConfigAutoFillEnabled(draft)} onChange={(event) => onChange('auto_fill_fields', event.target.checked)} />
            <span>Auto fill fields</span>
          </label>
        </div>
      </Section>

      </fieldset>

      <Section title="Notes">
        <ul className="config_window_notes">
          <li>Modifications apply to the next instances (new connections and Source windows).</li>
          <li>Removing a rule deletes it permanently.</li>
          <li>Saving is required to add new rules.</li>
          <li>Remember to back up (Export).</li>
        </ul>
      </Section>
    </>
  );
}

/* ── Connections ────────────────────────────────────────────────────── */

const PORT_FIELDS = [
  ['hadoop_rcp_port', 'Hadoop RPC'],
  ['hadoop_web_port', 'Hadoop Web'],
  ['spark_port', 'Spark'],
  ['hive_port', 'Hive'],
  ['api_port', 'API'],
];

const ENDPOINT_FIELDS = [
  ['search_api_endpoint', 'API search endpoint', true],
  ['search_api_endpoint_es_fuzzy', 'Elasticsearch fuzzy endpoint'],
  ['search_api_endpoint_es_strict', 'Elasticsearch strict endpoint'],
  ['search_api_endpoint_hive_fuzzy', 'Hive fuzzy endpoint'],
  ['search_api_endpoint_hive_strict', 'Hive strict endpoint'],
];

// Read-only users get every control disabled natively through <fieldset>.
function WriteGate({ canWrite, children }) {
  return (
    <fieldset className="config_window_write_gate" disabled={!canWrite}>
      {!canWrite ? <p className="settings_hint config_window_readonly_hint">Read-only: you need config:write to change these settings.</p> : null}
      {children}
    </fieldset>
  );
}

export function ConnectionsPanel({ draft, onChange, canWrite }) {
  const largeSearchBackend = normalizeLargeSearchBackend(draft?.large_search_backend);
  return (
    <WriteGate canWrite={canWrite}>
      <Section title="Broker" description="Kafka addresses and topics offered to realtime Source windows.">
        <div className="config_window_grid">
          <OptionField
            label="IP address"
            name="active_kafka_adress"
            options={draft?.kafka_addresses}
            value={draft?.active_kafka_adress}
            customName="kafka_custom_address"
            customValue={draft?.kafka_custom_address}
            customPlaceholder="Custom Kafka / API address"
            onChange={onChange}
            onCommit={onChange}
          />
          <OptionField
            label="Topic"
            name="active_kafka_topic"
            options={draft?.kafka_topics}
            value={draft?.active_kafka_topic}
            customName="kafka_custom_topic"
            customValue={draft?.kafka_custom_topic}
            customPlaceholder="Custom Kafka topic"
            onChange={onChange}
            onCommit={onChange}
          />
        </div>
      </Section>

      <Section title="Storage" description="HDFS / Hive storage used by batch Source windows.">
        <div className="config_window_grid">
          <OptionField
            label="IP address"
            name="active_storage_address"
            options={draft?.storage_addresses}
            value={draft?.active_storage_address}
            customName="storage_custom_address"
            customValue={draft?.storage_custom_address}
            customPlaceholder="Custom HDFS address"
            onChange={onChange}
            onCommit={onChange}
          />
          <OptionField
            label="Database"
            name="active_storage_database"
            options={draft?.storage_databases}
            value={draft?.active_storage_database}
            customName="storage_database_custom"
            customValue={draft?.storage_database_custom}
            customPlaceholder="Custom database name"
            onChange={onChange}
            onCommit={onChange}
          />
        </div>
        <div className="config_window_grid is-compact">
          {PORT_FIELDS.map(([name, label]) => (
            <Field key={name} label={`${label} port`}>
              <DraftInput name={name} value={draft?.[name] || ''} placeholder={`${label} port`} onCommit={onChange} />
            </Field>
          ))}
        </div>
        <Field label="Storage path" hint="Base folder searched by the Storage step. Switching the domain pillar re-projects it.">
          <DraftInput name="storage_path" value={draft?.storage_path || ''} placeholder="/user/<domain>/cleaned_partitioned" onCommit={onChange} />
        </Field>
        <Field label="Tables (comma separated)">
          <ListTextarea name="storage_tables" value={draft?.storage_tables} placeholder="table_a, table_b" onCommit={onChange} />
        </Field>
      </Section>

      <Section title="Search" description="Endpoints and columns used by file, Elastic and Hive searches.">
        <div className="config_window_grid">
          {ENDPOINT_FIELDS.map(([name, label, wide]) => (
            <Field key={name} label={label} wide={wide}>
              <DraftInput name={name} value={draft?.[name] || ''} placeholder={label} onCommit={onChange} />
            </Field>
          ))}
        </div>
        <Field label="Search columns – fuzzy (comma separated)">
          <ListTextarea name="search_columns_fuzzy" value={draft?.search_columns_fuzzy} onCommit={onChange} />
        </Field>
        <Field label="Search columns – strict (comma separated)">
          <ListTextarea name="search_columns_strict" value={draft?.search_columns_strict} onCommit={onChange} />
        </Field>
        <Field label="Fetch columns (comma separated)">
          <ListTextarea name="fetch_columns" value={draft?.fetch_columns} onCommit={onChange} />
        </Field>
        <div className="config_window_grid">
          <Field label="Large search retrieval">
            <select className="settings_input" value={largeSearchBackend} onChange={(event) => onChange('large_search_backend', event.target.value)}>
              <option value="hive">Hive / Spark query</option>
              <option value="elastic_scroll">Elasticsearch scroll</option>
            </select>
          </Field>
          <Field label="Elasticsearch scroll limit" hint="Used when large fuzzy search results are converted into a dataframe.">
            <DraftInput
              name="elastic_scroll_limit"
              type="number"
              min="1"
              step="1000"
              value={normalizeElasticScrollLimit(draft?.elastic_scroll_limit)}
              disabled={largeSearchBackend !== 'elastic_scroll'}
              onCommit={onChange}
            />
          </Field>
        </div>
      </Section>
    </WriteGate>
  );
}

/* ── Tools ──────────────────────────────────────────────────────────── */

// The saved password comes back masked ("***"): show an empty field with a
// "saved" placeholder, so typing never appends to the mask. Clear is explicit.
function ToolPasswordField({ draft, onChange }) {
  const raw = String(draft?.active_tool_password || '');
  const isMasked = /^\*+$/.test(raw.trim());
  const isSaved = isMasked || Boolean(draft?.active_tool_password_ref);
  const clearing = Boolean(draft?.active_tool_password_clear);
  return (
    <div className="config_window_field">
      <span className="config_window_field_label">Password{isSaved && !clearing ? ' · saved' : ''}</span>
      <div className="config_window_option_row">
        <DraftInput
          name="active_tool_password"
          type="password"
          autoComplete="new-password"
          aria-label="Tool password"
          value={isMasked ? '' : raw}
          placeholder={clearing ? 'Will be cleared on save' : isSaved ? 'Saved; type to replace' : 'Password'}
          onCommit={(name, value) => {
            if (!value && isMasked) return; // untouched: keep the saved one
            onChange(name, value);
            if (value) onChange('active_tool_password_clear', false);
          }}
        />
        {isSaved ? (
          <button type="button" className="settings_button is-compact" onClick={() => onChange('active_tool_password_clear', !clearing)}>
            {clearing ? 'Keep' : 'Clear'}
          </button>
        ) : null}
      </div>
      <small className="config_window_field_hint">Leave empty to keep the saved password.</small>
    </div>
  );
}

export function ToolsPanel({ draft, onChange, canWrite }) {
  const databaseOptions = draft?.active_tool_database ? [draft.active_tool_database] : [];
  return (
    <WriteGate canWrite={canWrite}>
    <Section title="Analysis tool" description="Graph tool (Neo4j) defaults used when Source windows connect a tool.">
      <div className="config_window_grid">
        <OptionField
          label="Tool"
          name="active_tool"
          options={draft?.tools}
          value={draft?.active_tool}
          onChange={onChange}
        />
        <Field label="URL address">
          <DraftInput name="active_tool_url" value={draft?.active_tool_url || ''} placeholder="bolt://host:7687" onCommit={onChange} />
        </Field>
        <Field label="Protocol port">
          <DraftInput name="tool_protocol_port" value={draft?.tool_protocol_port || ''} placeholder="Tool port" onCommit={onChange} />
        </Field>
        <Field label="Web UI port">
          <DraftInput name="tool_web_port" value={draft?.tool_web_port || ''} placeholder="UI port" onCommit={onChange} />
        </Field>
        <Field label="Username">
          <DraftInput name="active_tool_username" value={draft?.active_tool_username || ''} placeholder="Username" autoComplete="off" onCommit={onChange} />
        </Field>
        <ToolPasswordField draft={draft} onChange={onChange} />
        <OptionField
          label="Database"
          name="active_tool_database"
          options={databaseOptions}
          value={draft?.active_tool_database}
          customName="custom_tool_database"
          customValue={draft?.custom_tool_database}
          customPlaceholder="Custom database name"
          onChange={onChange}
          onCommit={onChange}
        />
      </div>
      <Field label="Tables (comma separated)">
        <ListTextarea name="active_tool_tables" value={draft?.active_tool_tables} onCommit={onChange} />
      </Field>
    </Section>
    </WriteGate>
  );
}

/* ── Rules ──────────────────────────────────────────────────────────── */

const CDR_EMERGENCY_PRESETS = [
  { name: 'Police Emergency Hotlines', key: 'MSISDN', value: '911', category: 'Emergency / Service Hotlines', pass_through: true },
  { name: 'Ambulance / Medical Hotlines', key: 'MSISDN', value: '994', category: 'Emergency / Service Hotlines', pass_through: true },
  { name: 'Fire & Rescue Hotlines', key: 'MSISDN', value: '991', category: 'Emergency / Service Hotlines', pass_through: true },
  { name: 'Civil Defense Hotlines', key: 'MSISDN', value: '980', category: 'Emergency / Service Hotlines', pass_through: true },
];

export function RulesPanel({
  draft,
  onChange,
  canEditEntities,
  canWrite,
  knownBuiltinRules,
  onManageRules,
  onNotice,
}) {
  const isCdr = getActiveDomainKey(draft) === 'cdr';
  const ruleNames = useMemo(() => getRuleNames(draft), [draft]);
  const activeRule = normalizeActiveRuleValue(draft?.active_rule);

  const columnMapping = useMemo(() => normalizeColumnMappingEntries(draft?.column_mapping, { preserveEmpty: true }), [draft?.column_mapping]);
  const setColumnMapping = (entries) => onChange('column_mapping', entries);

  const entities = useMemo(() => readClassifiedEntities(draft), [draft]);
  const setEntities = (entries) => onChange('classified_entities', entries);
  const editEntity = (index, field, value) => setEntities(entities.map((entry, i) => (
    i === index
      ? { ...entry, [field]: field === 'pass_through' ? Boolean(value) : field === 'category' ? String(value) : sanitizeText(value, { maxLength: field === 'key' ? 160 : 500 }) }
      : entry
  )));

  const addEmergencyPresets = () => {
    const existing = new Set(entities.map((entry) => String(entry.value).trim()));
    const toAdd = CDR_EMERGENCY_PRESETS.filter((preset) => !existing.has(preset.value));
    if (!toAdd.length) {
      onNotice({ title: 'Presets', message: 'Emergency hotlines (911, 994, 991, 980) are already present.', level: 'info' });
      return;
    }
    setEntities([...entities, ...toAdd]);
  };

  const categoryOptions = isCdr
    ? ['Emergency / Service Hotlines', 'SIM_BOX', 'WANGIRI', 'HIGH_RISK', 'Trusted', 'Risk']
    : ['Trusted', 'Risk', 'PEP', 'Sanction'];

  return (
    <WriteGate canWrite={canWrite}>
      <Section
        title="Active rule"
        description={`The rule this session applies by default. ${ruleNames.length} rule${ruleNames.length === 1 ? '' : 's'} loaded.`}
        actions={<button type="button" className="settings_button" onClick={onManageRules} title="Upload or remove rules in the Libraries window">Manage rules</button>}
      >
        <div className="config_window_option_row">
          <select
            className="settings_input"
            aria-label="Active rule"
            value={activeRule}
            onChange={(event) => onChange('active_rule', sanitizeText(event.target.value, { maxLength: 120 }))}
          >
            {ruleNames.length === 0 ? <option value="">No rules loaded</option> : null}
            {ruleNames.map((ruleItem) => {
              const name = getRuleItemName(ruleItem);
              const builtin = checkIsBuiltinRule(ruleItem, draft, knownBuiltinRules);
              return <option key={name} value={name}>{builtin && !/\(built-in\)$/i.test(name) ? `${name} (Built-in)` : name}</option>;
            })}
          </select>
        </div>
        <p className="settings_hint">Rule sets are uploaded and removed in Libraries → Rules.</p>
      </Section>

      <Section
        title="Column mapping"
        description="Maps database columns to data model columns."
        actions={<button type="button" className="settings_button" onClick={() => setColumnMapping([...columnMapping, { key: '', value: '' }])}>Add row</button>}
      >
        <div className="config_window_table_wrap">
          <table className="config_window_table">
            <thead>
              <tr><th>#</th><th>Database column</th><th>Data model column</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {columnMapping.length === 0 ? (
                <tr><td colSpan={4} className="config_window_table_empty">No column mapping entries yet.</td></tr>
              ) : columnMapping.map((entry, index) => (
                <tr key={`mapping-${index}`}>
                  <td className="config_window_table_index">{index + 1}</td>
                  <td>
                    <input className="settings_input" value={entry.key} placeholder="e.g. CREATEDDATE" onChange={(event) => setColumnMapping(columnMapping.map((item, i) => (i === index ? { ...item, key: sanitizeText(event.target.value, { maxLength: 160 }) } : item)))} />
                  </td>
                  <td>
                    <input className="settings_input" value={entry.value} placeholder={isCdr ? 'e.g. START_TIME' : 'e.g. TRANSACTIONDATE'} onChange={(event) => setColumnMapping(columnMapping.map((item, i) => (i === index ? { ...item, value: sanitizeText(event.target.value, { maxLength: 160 }) } : item)))} />
                  </td>
                  <td className="config_window_table_actions">
                    <button type="button" className="settings_button is-danger" onClick={() => setColumnMapping(columnMapping.filter((_, i) => i !== index))}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section
        title={isCdr ? 'Classified entities (telecom whitelist / watchlist)' : 'Classified entities'}
        description={canEditEntities ? 'Trusted entries are passed through; risk entries are flagged.' : 'You need config:write to edit classified entities.'}
        actions={canEditEntities ? (
          <>
            {isCdr ? <button type="button" className="settings_button" onClick={addEmergencyPresets}>Load emergency presets</button> : null}
            <button type="button" className="settings_button" onClick={() => setEntities([...entities, { name: '', key: '', value: '', category: 'Trusted', pass_through: false }])}>Add row</button>
          </>
        ) : null}
      >
        <div className="config_window_table_wrap">
          <table className="config_window_table">
            <thead>
              <tr>
                <th>#</th>
                <th>{isCdr ? 'Subscriber / contact' : 'Entity name'}</th>
                <th>{isCdr ? 'Identifier (MSISDN)' : 'Key'}</th>
                <th>{isCdr ? 'Phone / contact number' : 'Value'}</th>
                <th>{isCdr ? 'Telecom classification' : 'Category'}</th>
                <th>{isCdr ? 'Pass through (suppress alerts)' : 'Pass through'}</th>
                {canEditEntities ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {entities.length === 0 ? (
                <tr><td colSpan={canEditEntities ? 7 : 6} className="config_window_table_empty">No classified-entity entries yet.</td></tr>
              ) : entities.map((entry, index) => (
                <tr key={`entity-${index}`}>
                  <td className="config_window_table_index">{index + 1}</td>
                  <td><input className="settings_input" value={entry.name || ''} disabled={!canEditEntities} onChange={(event) => editEntity(index, 'name', event.target.value)} /></td>
                  <td><input className="settings_input" value={entry.key || ''} disabled={!canEditEntities} onChange={(event) => editEntity(index, 'key', event.target.value)} /></td>
                  <td><input className="settings_input" value={entry.value || ''} disabled={!canEditEntities} onChange={(event) => editEntity(index, 'value', event.target.value)} /></td>
                  <td><input className="settings_input" list="config-window-category-options" value={entry.category || 'Trusted'} disabled={!canEditEntities} onChange={(event) => editEntity(index, 'category', event.target.value)} /></td>
                  <td>
                    <label className={`config_window_pass ${entry.pass_through ? 'is-passing' : 'is-restricted'}`}>
                      <input type="checkbox" checked={entry.pass_through === true} disabled={!canEditEntities} onChange={(event) => editEntity(index, 'pass_through', event.target.checked)} />
                      <span>{entry.pass_through ? 'Passing' : 'Restricted'}</span>
                    </label>
                  </td>
                  {canEditEntities ? (
                    <td className="config_window_table_actions">
                      <button type="button" className="settings_button is-danger" onClick={() => setEntities(entities.filter((_, i) => i !== index))}>Remove</button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <datalist id="config-window-category-options">
          {categoryOptions.map((option) => <option key={option} value={option} />)}
        </datalist>
      </Section>

      <ProfileMappingSection draft={draft} onChange={onChange} />
    </WriteGate>
  );
}

// Profile mapping fields (analyst decision 2026-11-16; not in production):
// what the actor profile card shows when a node is clicked in a Graph window
// of this domain. Saved with the configuration as `actor_profile` (backend
// request B-23); a domain without one starts from this device's copy.
function ProfileMappingSection({ draft, onChange }) {
  const domain = getActiveDomainKey(draft);
  const profile = resolveProfileSettings(draft, domain);
  const update = (next) => onChange(CONFIG_PROFILE_KEY, profileToConfiguration(next));
  const setField = (key, patch) => update({ ...profile, fields: profile.fields.map((field) => (field.key === key ? { ...field, ...patch } : field)) });
  const property = (value) => sanitizeText(value, { maxLength: 120 });
  return (
    <Section
      title="Profile mapping fields"
      description="What the actor profile card shows when a node is clicked in a Graph window: the node property behind the portrait and each detail."
    >
      <label className="config_window_profile_switch">
        <input type="checkbox" checked={profile.enabled} onChange={(event) => update({ ...profile, enabled: event.target.checked })} />
        <span>Show the actor profile on node click</span>
      </label>
      <div className="config_window_table_wrap">
        <table className="config_window_table" aria-label="Profile mapping fields">
          <thead>
            <tr><th>#</th><th>Profile field</th><th>Node property</th><th>Shown</th></tr>
          </thead>
          <tbody>
            <tr>
              <td className="config_window_table_index">1</td>
              <td>Portrait</td>
              <td>
                <input
                  className="settings_input"
                  aria-label="Portrait property"
                  value={profile.portraitKey}
                  placeholder="An image link property, e.g. PHOTO_URL (empty: no portrait)"
                  disabled={!profile.enabled}
                  onChange={(event) => update({ ...profile, portraitKey: property(event.target.value) })}
                />
              </td>
              <td />
            </tr>
            {profile.fields.map((field, index) => {
              const label = PROFILE_FIELDS.find((entry) => entry.key === field.key)?.label || field.key;
              return (
                <tr key={field.key}>
                  <td className="config_window_table_index">{index + 2}</td>
                  <td>{label}</td>
                  <td>
                    <input
                      className="settings_input"
                      aria-label={`${label} property`}
                      value={field.source}
                      placeholder="Node property (empty: —)"
                      disabled={!profile.enabled}
                      onChange={(event) => setField(field.key, { source: property(event.target.value) })}
                    />
                  </td>
                  <td>
                    <input type="checkbox" aria-label={`Show ${label}`} checked={field.shown} disabled={!profile.enabled} onChange={(event) => setField(field.key, { shown: event.target.checked })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="settings_hint">Property names as they appear in the graph's node data (exact spelling). The portrait takes an https or data:image link.</p>
    </Section>
  );
}
