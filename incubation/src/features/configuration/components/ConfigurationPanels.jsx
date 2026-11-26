import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { DraftInput, Field, InfoTip, ListTextarea, OptionField } from '../../../shared/components/form/FormFields.jsx';
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
  isRiskCategory,
} from '../lib/configModel.js';
import { grantedDomains } from '../../../auth/useAllowedDomains.js';
import { sanitizeText } from '../../../utils/inputSecurity.js';
import { CONFIG_PROFILE_KEY, PROFILE_FIELDS, profileToConfiguration, resolveProfileSettings } from '../../graph/lib/nodeProfile.js';
import { CONFIG_FORMATTING_KEY, describeRule, resolveDomainFormatting } from '../../graph/lib/conditionalFormatting.js';
import GraphFormattingBox, { RuleSample } from '../../graph/components/GraphFormattingBox.jsx';
import { OriginBadge } from './DomainHistory.jsx';
import { Block, Masthead, Option, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';

const truthy = (value) => value === true || value === 'true';

/* ── System ─────────────────────────────────────────────────────────── */

export function SystemPanel({ draft, onChange, onSwitchDomain, isSwitchingDomain, canWrite, canSwitchDomain = canWrite, allowedDomains = null, idleSettings, idlePolicyMeta, onIdleSettingsChange }) {
  const activeDomain = getActiveDomainKey(draft);
  const registeredDomains = grantedDomains(getRegisteredDomains(draft), allowedDomains, activeDomain);
  const domainConnections = draft?.domain_connections && typeof draft.domain_connections === 'object' ? draft.domain_connections : {};
  const activeConn = domainConnections[activeDomain] || {};
  const configured = activeConn.configured !== false;
  const tables = Array.isArray(activeConn.storage_tables) ? activeConn.storage_tables : (Array.isArray(draft?.storage_tables) ? draft.storage_tables : []);
  const sourceCol = activeConn.default_source_col || draft?.default_source_col || '';
  const targetCol = activeConn.default_target_col || draft?.default_target_col || '';
  const tablesText = tables.join(', ');

  // [] from the Service: nothing may be edited (B-15).
  const editable = Array.isArray(idlePolicyMeta?.editableFields) ? idlePolicyMeta.editableFields : [];
  const policyBusy = idlePolicyMeta?.isLoading || idlePolicyMeta?.isSaving;
  const canEditPolicy = (field) => !policyBusy && editable.includes(field);
  const minutes = (ms, min) => Math.max(min, Math.round((Number(ms) || 0) / 60000));
  const updateMinutes = (key, value) => {
    const min = key === 'warningMs' ? 0 : 1;
    const next = Math.max(min, Math.min(1440, Number.parseInt(value, 10) || 0));
    onIdleSettingsChange((previous) => ({ ...previous, [key]: next * 60000 }));
  };
  const isReady = (key) => (domainConnections[key] ? domainConnections[key].configured !== false : true);
  const timeouts = [
    ['warningMs', 'Warn after', 0, 1439, 'idle_warning_ms', 'Minutes without activity before the idle warning shows. Range 0 to 1,439 · whole minutes'],
    ['lockMs', 'Lock after', 1, 1440, 'idle_lock_ms', 'Minutes without activity before the session locks. Range 1 to 1,440 · whole minutes'],
    ['timeoutMs', 'Log out after', 1, 1440, 'max_idle_timeout_ms', 'Minutes without activity before the account is logged out. Range 1 to 1,440 · whole minutes'],
  ];
  const services = [
    { icon: 'link', title: 'Automate across services', description: 'Let the services hand work on to each other.', checked: truthy(draft?.automation), onChange: (checked) => onChange('automation', checked) },
    { icon: 'globe', title: 'Remote requests', description: 'Allow requests to remote endpoints.', checked: truthy(draft?.remote), onChange: (checked) => onChange('remote', checked) },
    { icon: 'edit', title: 'Auto fill fields', description: 'Fill Source window fields from this configuration.', checked: isConfigAutoFillEnabled(draft), onChange: (checked) => onChange('auto_fill_fields', checked) },
  ];
  const policyNotes = [
    Number.isFinite(idlePolicyMeta?.authTokenSeconds) ? `Auth token lifetime: ${Math.max(1, Math.round(idlePolicyMeta.authTokenSeconds / 60))} minute(s).` : '',
    idlePolicyMeta?.isLoading ? 'Refreshing session policy…' : '',
    idlePolicyMeta?.isSaving ? 'Saving session policy…' : '',
  ].filter(Boolean);

  return (
    <SettingsPage className="config_page config_system">
      <Masthead>
        <PageHero
          tone={configured ? 'active' : 'danger'}
          eyebrow="Domain pillar (session)"
          title={formatDomainPillarLabel(activeDomain)}
          pill={<Pill tone={configured ? 'active' : ''} dot>{configured ? 'Configured' : 'Unconfigured'}</Pill>}
          meta="The active investigative pillar. Switching re-projects database catalogs, ports, storage paths and schema mappings on the Service."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18M5 21V10M9.5 21V10M14.5 21V10M19 21V10M12 3l9 5H3l9-5z" />
            </svg>
          )}
        />
        <Stats label="Active domain" columns={5} className="config_system_facts">
          <Stat text icon="database" label="Target DB" value={activeConn.storage_database || draft?.active_storage_database || '—'} />
          <Stat text icon="server" label="Storage port" value={String(activeConn.storage_port || draft?.api_port || '5000')} />
          <Stat text icon="clock" label="Date field" value={activeConn.date_column || draft?.date_column || '—'} />
          <Stat text icon="list" label="Source / target" value={sourceCol && targetCol ? `${sourceCol} → ${targetCol}` : 'Auto'} />
          <Stat text icon="layers" label="Storage path" value={activeConn.storage_path || draft?.storage_path || '—'} />
        </Stats>
      </Masthead>

      {tables.length > 0 ? (
        <p className="config_system_tables" title={tablesText}>
          <span>Tables</span>
          {tables.map((table) => <code key={table}>{table}</code>)}
        </p>
      ) : null}

      <Block
        title="Switch domain pillar"
        description={isSwitchingDomain ? 'Switching pillar and projecting configuration…' : 'Takes effect immediately for this session and every Source window.'}
      >
        <div className="config_system_domains" role="radiogroup" aria-label="Active domain pillar">
          {registeredDomains.map((key) => {
            const ready = isReady(key);
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={key === activeDomain}
                className={`config_system_domain${key === activeDomain ? ' is-on' : ''}${ready ? '' : ' is-unready'}`}
                disabled={isSwitchingDomain || !canSwitchDomain}
                title={canSwitchDomain ? (ready ? 'Ready' : 'Unconfigured') : 'You need analysis:run or config:write to switch the domain pillar.'}
                onClick={() => { if (key !== activeDomain) onSwitchDomain(key); }}
              >
                <i aria-hidden="true" />
                {formatDomainPillarLabel(key)}
                <small>{ready ? 'Ready' : 'Unconfigured'}</small>
              </button>
            );
          })}
        </div>
      </Block>

      <fieldset className="config_window_write_gate" disabled={!canWrite} title={canWrite ? undefined : 'You need config:write to change these settings.'}>
        <Block
          title="Session timeout policy"
          description={`Loaded from and saved to the Service session policy. Source: ${idlePolicyMeta?.source || 'session'}.`}
        >
          <div className="config_system_timeouts">
            {timeouts.map(([name, label, min, max, field, info]) => (
              <label key={name} className="config_system_timeout">
                <span className="config_system_timeout_label">{label}<InfoTip text={info} /></span>
                <span className="config_system_timeout_value">
                  <DraftInput name={name} type="number" min={min} max={max} aria-label={`${label} (min)`} value={minutes(idleSettings?.[name], min)} disabled={!canEditPolicy(field)} onCommit={updateMinutes} />
                  <small>min</small>
                </span>
              </label>
            ))}
          </div>
          <div className="settings_options">
            <Option
              icon="lock"
              title="Require re-auth after lock"
              description="Ask for the password again to unlock the session."
              checked={idleSettings?.lockRequiresReauth !== false}
              disabled={!canWrite || !canEditPolicy('lock_requires_reauth')}
              onChange={(checked) => onIdleSettingsChange((previous) => ({ ...previous, lockRequiresReauth: checked }))}
            />
          </div>
          {policyNotes.map((note) => <p key={note} className="settings_hint">{note}</p>)}
          {idlePolicyMeta?.error ? <div className="settings_error">{idlePolicyMeta.error}</div> : null}
        </Block>

        <Block title="Services" description="Saved with the configuration.">
          <div className="settings_options" role="group" aria-label="Services">
            {services.map((service) => <Option key={service.title} {...service} disabled={!canWrite} />)}
          </div>
        </Block>
      </fieldset>

      <Block title="Notes">
        <ul className="config_window_notes config_system_notes">
          <li>Modifications apply to the next instances (new connections and Source windows).</li>
          <li>Removing a rule deletes it permanently.</li>
          <li>Saving is required to add new rules.</li>
          <li>Remember to back up (Export).</li>
        </ul>
      </Block>
    </SettingsPage>
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

// Glyphs for the field labels (24px grid, stroked).
const FIELD_ICONS = {
  server: 'M5 2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM5 14h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM6 6h.01M6 18h.01',
  topic: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  database: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  port: 'M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  table: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  columns: 'M3 3h18v18H3zM9 3v18M15 3v18',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
  limit: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  tool: 'M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z',
  screen: 'M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4',
};

const countOf = (list) => (Array.isArray(list) ? list.filter(Boolean).length : 0);

// columns: the account's own columns, saved apart from this form.
export function ConnectionsPanel({ draft, onChange, canWrite, columns = null }) {
  const largeSearchBackend = normalizeLargeSearchBackend(draft?.large_search_backend);
  const tableCount = countOf(draft?.storage_tables);
  const endpointCount = ENDPOINT_FIELDS.filter(([name]) => String(draft?.[name] || '').trim()).length;
  return (
    <SettingsPage className="config_page config_connections">
      <Masthead>
        <PageHero
          eyebrow="Connections"
          title="Broker, storage and search"
          pill={canWrite ? null : <Pill tone="neutral">Read-only</Pill>}
          meta="The endpoints offered to Source windows. Saved with the configuration."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 9v3a6 6 0 0 0 6 6h3M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9v6" />
            </svg>
          )}
        />
        <Stats label="Connection figures" columns={4}>
          <Stat text icon="bolt" label="Broker" value={draft?.active_kafka_adress || '—'} note={draft?.active_kafka_topic ? `topic ${draft.active_kafka_topic}` : 'no topic chosen'} />
          <Stat text icon="database" label="Storage" value={draft?.active_storage_address || '—'} note={draft?.active_storage_database ? `database ${draft.active_storage_database}` : 'no database chosen'} />
          <Stat icon="layers" label="Tables" value={tableCount.toLocaleString()} note="storage tables" />
          <Stat icon="globe" label="Search endpoints" value={endpointCount.toLocaleString()} note={`of ${ENDPOINT_FIELDS.length} set · ${largeSearchBackend === 'elastic_scroll' ? 'Elastic scroll' : 'Hive / Spark'}`} />
        </Stats>
      </Masthead>

      <fieldset className="config_window_write_gate" disabled={!canWrite}>
        {!canWrite ? <p className="settings_hint config_window_readonly_hint">Read-only: you need config:write to change these settings.</p> : null}

        <Block title="Broker" description="Kafka addresses and topics offered to realtime Source windows.">
          <div className="config_card">
            <div className="config_card_grid">
              <OptionField
                icon={FIELD_ICONS.server}
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
                icon={FIELD_ICONS.topic}
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
          </div>
        </Block>

        <Block title="Storage" description="HDFS / Hive storage used by batch Source windows.">
          <div className="config_card">
            <div className="config_card_grid">
              <OptionField
                icon={FIELD_ICONS.server}
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
                icon={FIELD_ICONS.database}
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
            <p className="config_card_label">Ports</p>
            <div className="config_card_grid is-ports">
              {PORT_FIELDS.map(([name, label]) => (
                <Field key={name} icon={FIELD_ICONS.port} label={label}>
                  <DraftInput name={name} aria-label={`${label} port`} value={draft?.[name] || ''} placeholder="port" onCommit={onChange} />
                </Field>
              ))}
            </div>
            <p className="config_card_label">Location</p>
            <div className="config_card_grid">
              <Field icon={FIELD_ICONS.folder} label="Storage path" hint="Base folder searched by the Storage step. Switching the domain pillar re-projects it.">
                <DraftInput name="storage_path" value={draft?.storage_path || ''} placeholder="/user/<domain>/cleaned_partitioned" onCommit={onChange} />
              </Field>
              <Field icon={FIELD_ICONS.table} label="Tables" hint="Comma separated.">
                <ListTextarea name="storage_tables" value={draft?.storage_tables} placeholder="table_a, table_b" onCommit={onChange} />
              </Field>
            </div>
          </div>
        </Block>

        <Block title="Search" description="Endpoints used by file, Elastic and Hive searches.">
          <div className="config_card">
            <p className="config_card_label">Endpoints</p>
            <div className="config_card_grid">
              {ENDPOINT_FIELDS.map(([name, label, wide]) => (
                <Field key={name} icon={FIELD_ICONS.link} label={label} wide={wide}>
                  <DraftInput name={name} value={draft?.[name] || ''} placeholder={label} onCommit={onChange} />
                </Field>
              ))}
            </div>
            <p className="config_card_label">Large searches</p>
            <div className="config_card_grid">
              <Field icon={FIELD_ICONS.search} label="Large search retrieval">
                <select className="settings_input" value={largeSearchBackend} onChange={(event) => onChange('large_search_backend', event.target.value)}>
                  <option value="hive">Hive / Spark query</option>
                  <option value="elastic_scroll">Elasticsearch scroll</option>
                </select>
              </Field>
              <Field icon={FIELD_ICONS.limit} label="Elasticsearch scroll limit" hint="Used when large fuzzy search results are converted into a dataframe.">
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
          </div>
        </Block>
      </fieldset>
      {columns}
    </SettingsPage>
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
      <span className="config_window_field_label">
        <svg className="config_window_field_icon" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={FIELD_ICONS.lock} /></svg>
        Password{isSaved && !clearing ? ' · saved' : ''}
      </span>
      <div className="config_password_row">
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
  const rawPassword = String(draft?.active_tool_password || '');
  const passwordState = draft?.active_tool_password_clear
    ? 'password will be cleared'
    : (rawPassword || draft?.active_tool_password_ref ? 'password saved' : 'no password');
  const tableCount = countOf(draft?.active_tool_tables);
  return (
    <SettingsPage className="config_page config_tools">
      <Masthead>
        <PageHero
          eyebrow="Tools"
          title={draft?.active_tool ? String(draft.active_tool) : 'Analysis tool'}
          pill={canWrite ? null : <Pill tone="neutral">Read-only</Pill>}
          meta="Graph tool (Neo4j) defaults used when Source windows connect a tool."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 7.5l6.8 1M16 11.5l-5 4.2M6.8 8.9L8.3 15" />
            </svg>
          )}
        />
        <Stats label="Tool figures" columns={4}>
          <Stat text icon="globe" label="URL address" value={draft?.active_tool_url || '—'} note={draft?.tool_protocol_port ? `port ${draft.tool_protocol_port}` : 'no protocol port'} />
          <Stat text icon="database" label="Database" value={draft?.active_tool_database || draft?.custom_tool_database || '—'} note="graph database" />
          <Stat text icon="key" label="Account" value={draft?.active_tool_username || '—'} note={passwordState} />
          <Stat icon="layers" label="Tables" value={tableCount.toLocaleString()} note="tool tables" />
        </Stats>
      </Masthead>

      <fieldset className="config_window_write_gate" disabled={!canWrite}>
        {!canWrite ? <p className="settings_hint config_window_readonly_hint">Read-only: you need config:write to change these settings.</p> : null}

        <Block title="Connection" description="Which tool, and where it is reached.">
          <div className="config_card">
            <div className="config_card_grid">
              <OptionField
                icon={FIELD_ICONS.tool}
                label="Tool"
                name="active_tool"
                options={draft?.tools}
                value={draft?.active_tool}
                onChange={onChange}
              />
              <Field icon={FIELD_ICONS.link} label="URL address">
                <DraftInput name="active_tool_url" value={draft?.active_tool_url || ''} placeholder="bolt://host:7687" onCommit={onChange} />
              </Field>
              <Field icon={FIELD_ICONS.port} label="Protocol port">
                <DraftInput name="tool_protocol_port" value={draft?.tool_protocol_port || ''} placeholder="Tool port" onCommit={onChange} />
              </Field>
              <Field icon={FIELD_ICONS.screen} label="Web UI port">
                <DraftInput name="tool_web_port" value={draft?.tool_web_port || ''} placeholder="UI port" onCommit={onChange} />
              </Field>
            </div>
          </div>
        </Block>

        <Block title="Sign-in" description="The account the tool is opened with.">
          <div className="config_card">
            <div className="config_card_grid">
              <Field icon={FIELD_ICONS.user} label="Username">
                <DraftInput name="active_tool_username" value={draft?.active_tool_username || ''} placeholder="Username" autoComplete="off" onCommit={onChange} />
              </Field>
              <ToolPasswordField draft={draft} onChange={onChange} />
            </div>
          </div>
        </Block>

        <Block title="Data" description="The database and tables the tool works on.">
          <div className="config_card">
            <div className="config_card_grid is-stacked">
              <OptionField
                icon={FIELD_ICONS.database}
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
              <Field icon={FIELD_ICONS.table} label="Tables" hint="Comma separated.">
                <ListTextarea name="active_tool_tables" value={draft?.active_tool_tables} onCommit={onChange} />
              </Field>
            </div>
          </div>
        </Block>
      </fieldset>
    </SettingsPage>
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
  onOpenDomainMapping,
  onNotice,
}) {
  const isCdr = getActiveDomainKey(draft) === 'cdr';
  const ruleNames = useMemo(() => getRuleNames(draft), [draft]);
  const activeRule = normalizeActiveRuleValue(draft?.active_rule);

  const columnMapping = useMemo(() => normalizeColumnMappingEntries(draft?.column_mapping, { preserveEmpty: true }), [draft?.column_mapping]);
  const mappingOrigins = draft?.column_mapping_origins && typeof draft.column_mapping_origins === 'object' ? draft.column_mapping_origins : {};

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

  // The page's figures.
  const domain = getActiveDomainKey(draft);
  const activeRuleItem = ruleNames.find((ruleItem) => getRuleItemName(ruleItem) === activeRule);
  const activeIsBuiltin = Boolean(activeRuleItem) && checkIsBuiltinRule(activeRuleItem, draft, knownBuiltinRules);
  const mappedCount = columnMapping.filter((entry) => String(entry.key || '').trim() && String(entry.value || '').trim()).length;
  const passes = (entry) => entry.pass_through === true && !isRiskCategory(entry.category);
  const passingCount = entities.filter(passes).length;
  const profile = resolveProfileSettings(draft, domain);
  const shownFields = profile.fields.filter((field) => field.shown).length;
  const formattingRules = resolveDomainFormatting(draft, domain);
  const formattingOn = formattingRules.filter((rule) => rule.on).length;

  return (
    <SettingsPage className="config_page config_rules">
      <Masthead>
        <PageHero
          tone={activeRule ? 'active' : 'inactive'}
          eyebrow="Active rule"
          title={activeRule || 'No active rule'}
          pill={(
            <>
              {activeIsBuiltin ? <Pill tone="neutral">Built-in</Pill> : null}
              {canWrite ? null : <Pill tone="neutral">Read-only</Pill>}
            </>
          )}
          meta="The rule this session applies by default, and how its data is mapped, classified and drawn."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0L5 7zM19 7l-3 7a4 4 0 0 0 6 0l-3-7zM8 21h8" />
            </svg>
          )}
        />
        <Stats label="Rule figures" columns={5} className="config_rules_figures">
          <Stat lead icon="list" label="Rules" value={ruleNames.length.toLocaleString()} note="loaded" />
          <Stat icon="layers" label="Column mapping" value={mappedCount.toLocaleString()} note={`of ${columnMapping.length.toLocaleString()} rows filled`} />
          <Stat icon="shield" label="Classified entities" value={entities.length.toLocaleString()} note={`${passingCount.toLocaleString()} passing through`} />
          <Stat icon="users" label="Profile fields" value={shownFields.toLocaleString()} note={profile.enabled ? `of ${profile.fields.length} shown` : 'profile card off'} />
          <Stat icon="sun" label="Formatting rules" value={formattingRules.length.toLocaleString()} note={`${formattingOn.toLocaleString()} on`} />
        </Stats>
      </Masthead>

      <fieldset className="config_window_write_gate" disabled={!canWrite}>
        {!canWrite ? <p className="settings_hint config_window_readonly_hint">Read-only: you need config:write to change these settings.</p> : null}

      <Block
        title="Active rule"
        description={`The rule this session applies by default. ${ruleNames.length} rule${ruleNames.length === 1 ? '' : 's'} loaded.`}
        actions={<button type="button" className="settings_button" onClick={onManageRules} title="Upload or remove rules in the Libraries window">Manage rules</button>}
      >
        <div className={`config_card config_active_rule${activeRule ? '' : ' is-empty'}`}>
          <span className="config_active_rule_icon" aria-hidden="true">
            {/* A banknote between two transfer arrows: financial transactions. */}
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 8h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
              <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
              <path d="M7 4.5h10l-2-2M17 19.5H7l2 2" />
            </svg>
          </span>
          <div className="config_active_rule_text">
            <small>{activeRule ? 'Applied to this session by default' : 'Nothing is applied by default'}</small>
            <strong title={activeRule || undefined}>{activeRule || 'No rule chosen'}</strong>
            <span className="config_active_rule_tags">
              {activeRule ? <em>In use</em> : <em>Choose a rule</em>}
              {activeIsBuiltin ? <em>Built-in</em> : null}
            </span>
          </div>
          <div className="config_window_field config_active_rule_pick">
            <span className="config_window_field_label">Change the active rule</span>
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
            <small className="config_window_field_hint">Rule sets are uploaded and removed in Libraries → Rules.</small>
          </div>
        </div>
      </Block>

      {/* Read-only: the Service uses the domain's own and ignores one that is
          sent with the configuration (round 3, C1). */}
      <Block
        title="Column mapping"
        description="Which source column is which field of the domain. It is the domain's, for everyone, and is changed in Domains."
        actions={onOpenDomainMapping ? <button type="button" className="settings_button" onClick={onOpenDomainMapping}>Open in Domains</button> : null}
      >
        <div className="config_window_table_wrap">
          <table className="config_window_table" aria-label="Column mapping">
            <thead>
              <tr><th>#</th><th>Database column</th><th>Data model column</th><th>From</th></tr>
            </thead>
            <tbody>
              {columnMapping.length === 0 ? (
                <tr><td colSpan={4} className="config_window_table_empty">No column mapping entries yet.</td></tr>
              ) : columnMapping.map((entry, index) => (
                <tr key={`mapping-${index}`}>
                  <td className="config_window_table_index">{index + 1}</td>
                  <td><code>{entry.key}</code></td>
                  <td><code>{entry.value || 'not mapped'}</code></td>
                  <td>{mappingOrigins[entry.key] ? <OriginBadge origin={mappingOrigins[entry.key]} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <Block
        title={isCdr ? 'Classified entities (telecom whitelist / watchlist)' : 'Classified entities'}
        description={canEditEntities ? 'The category decides the list: one that names a risk (Risk, PEP, Sanction, SIM_BOX, WANGIRI…) is a risk, any other is trusted. A trusted entry is passed through when its switch is on.' : 'Only an administrator (users:manage) can edit classified entities.'}
        actions={canEditEntities ? (
          <>
            {isCdr ? <button type="button" className="settings_button" onClick={addEmergencyPresets}>Load emergency presets</button> : null}
            <button type="button" className="settings_button" onClick={() => setEntities([...entities, { name: '', key: '', value: '', category: 'Trusted', pass_through: false }])}>Add row</button>
          </>
        ) : null}
      >
        <div className="config_window_table_wrap">
          <table className="config_window_table" aria-label="Classified entities">
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
                  <td><EntityCategory label={`Category, row ${index + 1}`} value={entry.category || 'Trusted'} options={categoryOptions} disabled={!canEditEntities} onChange={(category) => editEntity(index, 'category', category)} /></td>
                  <td>
                    <label className={`settings_switch config_window_pass ${passes(entry) ? 'is-passing' : 'is-restricted'}`} title={isRiskCategory(entry.category) ? 'A risk is never passed through.' : undefined}>
                      <input type="checkbox" role="switch" aria-label={`Pass through, row ${index + 1}`} checked={passes(entry)} disabled={!canEditEntities || isRiskCategory(entry.category)} onChange={(event) => editEntity(index, 'pass_through', event.target.checked)} />
                      <span aria-hidden="true">{passes(entry) ? 'Passing' : 'Restricted'}</span>
                    </label>
                  </td>
                  {canEditEntities ? (
                    <td className="config_window_table_actions">
                      <RemoveRowButton label={`Remove entity row ${index + 1}`} onClick={() => setEntities(entities.filter((_, i) => i !== index))} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <ProfileMappingSection draft={draft} onChange={onChange} />
      <FormattingRulesSection draft={draft} onChange={onChange} />
      </fieldset>
    </SettingsPage>
  );
}

// An entity's category: the domain's, the one it has, or another typed. (A text
// field with suggestions offered only those matching what it already held, so
// the others could not be reached.)
const OTHER_CATEGORY = '\u0000other';
function EntityCategory({ label, value, options, disabled, onChange }) {
  const [typing, setTyping] = useState(false);
  if (typing) {
    return (
      <DraftInput
        autoFocus
        aria-label={label}
        maxLength={80}
        placeholder="Category name"
        value=""
        onCommit={(_name, text) => {
          setTyping(false);
          const category = sanitizeText(text, { maxLength: 80 }).trim();
          if (category) onChange(category);
        }}
      />
    );
  }
  const listed = options.includes(value) ? options : [value, ...options];
  return (
    <select className="settings_input" aria-label={label} value={value} disabled={disabled} onChange={(event) => (event.target.value === OTHER_CATEGORY ? setTyping(true) : onChange(event.target.value))}>
      {listed.map((option) => <option key={option} value={option}>{option}{isRiskCategory(option) ? ' (risk)' : ''}</option>)}
      <option value={OTHER_CATEGORY}>Other…</option>
    </select>
  );
}

// A table row's remove action: a bin, named for screen readers.
function RemoveRowButton({ label, onClick }) {
  return (
    <button type="button" className="config_row_remove" aria-label={label} title="Remove" onClick={onClick}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}

// Formatting rules (G3.5 i2 #4; analyst decision 2026-11-16; not in
// production): the domain's conditional formatting, applied in every Graph
// window of the domain below the graph's own rules (a graph can turn them
// off). Saved with the configuration as `formatting_rules` (backend request
// B-24); a domain without them starts from this device's copy. Edited in the
// Graph windows' rule editor, without a graph (property names typed).
const portalTo = (host, node) => (host ? createPortal(node, host) : node);

function FormattingRulesSection({ draft, onChange }) {
  const [editing, setEditing] = useState(false);
  const anchorRef = useRef(null);
  const domain = getActiveDomainKey(draft);
  const rules = resolveDomainFormatting(draft, domain);
  // The editor covers the window's body only (its header stays visible).
  const host = editing ? anchorRef.current?.closest('.configuration_window_body') : null;
  return (
    <Block
      title="Formatting rules"
      description="Conditional formatting every Graph window of this domain applies, below its own rules: when a node or link matches, how it is drawn."
      actions={<button type="button" className="settings_button" onClick={() => setEditing(true)}>Edit rules…</button>}
    >
      {rules.length ? (
        <ol className="config_window_rule_list" aria-label="Formatting rules">
          {rules.map((rule, index) => (
            <li key={rule.id} className={rule.on ? '' : 'is-off'}>
              <i aria-hidden="true">{index + 1}</i>
              <RuleSample rule={rule} />
              <span>{rule.name || describeRule(rule)}</span>
              {rule.on ? null : <small>off</small>}
            </li>
          ))}
        </ol>
      ) : <p className="settings_hint">No formatting rules for this domain yet.</p>}
      <span ref={anchorRef} hidden />
      {editing ? portalTo(host, (
        <GraphFormattingBox
          configMode
          title={`Formatting rules · ${formatDomainPillarLabel(domain)}`}
          rules={rules}
          onApply={(next) => onChange(CONFIG_FORMATTING_KEY, next)}
          onClose={() => setEditing(false)}
        />
      )) : null}
    </Block>
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
    <Block
      title="Profile mapping fields"
      description="What the actor profile card shows when a node is clicked in a Graph window: the node property behind the portrait and each detail."
    >
      <div className="settings_options">
        <Option
          icon="user"
          title="Show the actor profile on node click"
          description="Open the profile card when a node is clicked in a Graph window."
          checked={profile.enabled}
          onChange={(checked) => update({ ...profile, enabled: checked })}
        />
      </div>
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
                    <label className="settings_switch">
                      <input type="checkbox" role="switch" aria-label={`Show ${label}`} checked={field.shown} disabled={!profile.enabled} onChange={(event) => setField(field.key, { shown: event.target.checked })} />
                    </label>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="settings_hint">Property names as they appear in the graph's node data (exact spelling). The portrait takes an https or data:image link.</p>
    </Block>
  );
}
