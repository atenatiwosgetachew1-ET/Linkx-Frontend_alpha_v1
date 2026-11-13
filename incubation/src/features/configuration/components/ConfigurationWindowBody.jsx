import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useCan } from '../../../auth/useCan.js';
import { useSession } from '../../../shared/session/useSession.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useWorkspaceActions } from '../../../workspace/hooks/useWorkspace.js';
import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { ConnectionsPanel, RulesPanel, SystemPanel, ToolsPanel } from './ConfigurationPanels.jsx';
import DetectionSensitivityPanel from './DetectionSensitivityPanel.jsx';
import ActivityLogPanel from './ActivityLogPanel.jsx';
import LxacDialog from './LxacDialog.jsx';
import {
  applyConfigurationChange,
  buildConfigurationSavePayload,
  formatDomainPillarLabel,
  getActiveDomainKey,
  getConfigurationErrorMessage,
  normalizeLoadedConfiguration,
  preserveDomainRegistry,
} from '../lib/configModel.js';
import {
  exportEncryptedConfiguration,
  getLxacErrorMessage,
  importEncryptedConfiguration,
  loadConfiguration,
  loadDefaultConfiguration,
  removeRule,
  saveConfiguration,
  switchDomain,
  uploadRule,
  verifyLxacFile,
} from '../../../services/configurationApi.js';

const TABS = [
  { id: 'system', label: 'System', description: 'Domain pillar, session timeout policy and service toggles.' },
  { id: 'connections', label: 'Connections', description: 'Broker, storage and search endpoints used by Source windows.' },
  { id: 'tools', label: 'Tools', description: 'Graph tool (Neo4j) connection defaults.' },
  { id: 'rules', label: 'Rules', description: 'Analysis rules, column mapping and classified entities.' },
  { id: 'sensitivity', label: 'Detection sensitivity', description: 'Rule thresholds and score lineage.', permission: 'config:read' },
  { id: 'activity', label: 'Activity log', description: 'Session cleanup and cleanup audit trail.', permission: 'users:manage' },
];
// Tabs whose fields belong to the session configuration draft (Save/Reset).
const DRAFT_TABS = new Set(['system', 'connections', 'tools', 'rules']);

const RULE_KEYS = ['rules', 'rule_names', 'active_rule', 'builtin_rules', 'custom_rules', 'uploaded_rules'];

const payloadKey = (config) => {
  try {
    return JSON.stringify(buildConfigurationSavePayload(config));
  } catch {
    return '';
  }
};

const isAbort = (error) => error?.name === 'AbortError';
const EMPTY_RULE_UPLOAD = { file: null, name: '', inputKey: 0 };

export default function ConfigurationWindowBody({ windowItem }) {
  const canAccess = useCan();
  const {
    apiFetch,
    mainSessionId,
    isSessionReady,
    configuration,
    setConfiguration,
    idleSettings,
    idlePolicyMeta,
    updateIdleSettings,
  } = useSession();
  const { notify, requestConfirmation } = useNotifications();
  const workspace = useWorkspaceActions();

  const canRead = canAccess('config:read');
  const canWrite = canAccess('config:write');
  const canManageUsers = canAccess('users:manage');

  // Every tab stays visible; tabs the account can't use explain why inside.
  const visibleTabs = TABS;
  const storedTab = windowItem?.metadata?.configurationUi?.activeTab;
  const [activeTab, setActiveTab] = useState(visibleTabs.some((tab) => tab.id === storedTab) ? storedTab : 'system');
  const activeTabMeta = visibleTabs.find((tab) => tab.id === activeTab) || visibleTabs[0];

  const [draft, setDraft] = useState(() => normalizeLoadedConfiguration(configuration));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [baseline, setBaseline] = useState(() => payloadKey(normalizeLoadedConfiguration(configuration)));
  const isDirty = useMemo(() => payloadKey(draft) !== baseline, [baseline, draft]);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;

  const [busy, setBusy] = useState(null); // { label, cancellable }
  const [isLoaded, setIsLoaded] = useState(false);
  const [knownBuiltinRules, setKnownBuiltinRules] = useState(() => new Set());
  const [ruleUpload, setRuleUpload] = useState(EMPTY_RULE_UPLOAD);
  const [lxac, setLxac] = useState(null); // { mode, file }
  const importInputRef = useRef(null);
  const controllerRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    controllerRef.current?.abort();
  }, []);

  const selectTab = (tabId) => {
    setActiveTab(tabId);
    workspace.updateWindowMetadata(windowItem.id, { metadata: { configurationUi: { activeTab: tabId } } });
  };

  // Adopts a configuration returned by the backend: becomes the clean draft and
  // the session configuration every Source window reads its defaults from.
  const adoptConfiguration = useCallback((normalized) => {
    const merged = preserveDomainRegistry(draftRef.current, normalized);
    setDraft(merged);
    setBaseline(payloadKey(merged));
    setConfiguration((current) => preserveDomainRegistry(current, merged));
  }, [setConfiguration]);

  // Keep the draft in step with session changes made elsewhere (e.g. a Source
  // window domain switch) as long as there are no unsaved edits.
  useEffect(() => {
    if (dirtyRef.current) return;
    const next = normalizeLoadedConfiguration(configuration);
    if (!Object.keys(next).length) return;
    const merged = preserveDomainRegistry(draftRef.current, next);
    setDraft(merged);
    setBaseline(payloadKey(merged));
  }, [configuration]);

  // Runs one backend action behind the load screen; Esc/click cancels it.
  const runBusy = useCallback(async (label, action, { cancellable = true } = {}) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy({ label, cancellable });
    try {
      return await action(controller.signal);
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted) return undefined;
      throw error;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        if (mountedRef.current) setBusy(null);
      }
    }
  }, []);

  const cancelBusy = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setBusy(null);
    notify({ title: 'Cancelled', message: 'The configuration request was cancelled.', level: 'info', source: 'Configuration' });
  }, [notify]);

  const requireSession = useCallback(() => {
    if (mainSessionId) return true;
    notify({ title: 'Session initializing', message: 'Session is still initializing. Please try again in a moment.', level: 'warning', source: 'Configuration' });
    return false;
  }, [mainSessionId, notify]);

  const requirePermission = useCallback((permission, actionName) => {
    if (canAccess(permission)) return true;
    notify({ title: 'Permission denied', message: `You need ${permission} to use ${actionName}.`, level: 'warning', source: 'RBAC' });
    return false;
  }, [canAccess, notify]);

  const reload = useCallback(async ({ quiet = false } = {}) => {
    if (!mainSessionId) return;
    try {
      const result = await runBusy('Loading configuration…', (signal) => loadConfiguration(apiFetch, mainSessionId, { signal }));
      if (!result) return;
      if (!result.ok) {
        notify({ title: 'Configuration notice', message: result.message, level: 'warning', source: 'Configuration' });
        return;
      }
      adoptConfiguration(result.configuration);
      setIsLoaded(true);
      if (!quiet) notify({ title: 'Configuration loaded', message: 'Latest session configuration loaded.', level: 'info', source: 'Configuration' });
    } catch (error) {
      notify({ title: 'Configuration error', message: getConfigurationErrorMessage(error, 'Could not load configuration. Try again.'), level: 'error', source: 'Configuration' });
    }
  }, [adoptConfiguration, apiFetch, mainSessionId, notify, runBusy]);

  useEffect(() => {
    if (isSessionReady && mainSessionId && canRead && !isLoaded) reload({ quiet: true });
    // Load once per session; later refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSessionReady, mainSessionId, canRead]);

  // Runs a mutation and, when its response carries no configuration, loads
  // it in the same busy action (backend request B-10 makes this unneeded).
  const mutateAndLoad = useCallback((signal, mutation) => mutation().then(async (result) => {
    if (!result?.ok || result.returned) return result;
    const loaded = await loadConfiguration(apiFetch, mainSessionId, { signal }).catch(() => null);
    return loaded?.ok ? { ...result, configuration: loaded.configuration, returned: true } : result;
  }), [apiFetch, mainSessionId]);

  // Rule changes must not discard unrelated unsaved edits: when the draft is
  // dirty only the rule catalogue is taken from the server.
  const adoptRules = useCallback((configuration) => {
    if (!dirtyRef.current) {
      adoptConfiguration(configuration);
      return;
    }
    const pick = (source) => RULE_KEYS.reduce((acc, key) => (source?.[key] !== undefined ? { ...acc, [key]: source[key] } : acc), {});
    setDraft((current) => ({ ...current, ...pick(configuration) }));
    setConfiguration((current) => ({ ...current, ...pick(configuration) }));
  }, [adoptConfiguration, setConfiguration]);

  const handleChange = useCallback((name, value) => {
    setDraft((current) => applyConfigurationChange(current, name, value));
  }, []);

  const handleRuleUpload = useCallback(async () => {
    if (!ruleUpload.file || !requirePermission('config:write', 'rule uploads') || !requireSession()) return;
    try {
      const fields = { ...buildConfigurationSavePayload(draftRef.current) };
      const result = await runBusy('Uploading rule…', (signal) => mutateAndLoad(signal, () => uploadRule(apiFetch, mainSessionId, { file: ruleUpload.file, ruleName: ruleUpload.name, fields }, { signal })), { cancellable: false });
      if (!result) return;
      if (!result.ok) {
        notify({ title: 'Rule upload', message: result.message, level: 'warning', source: 'Configuration' });
        return;
      }
      setRuleUpload((current) => ({ ...EMPTY_RULE_UPLOAD, inputKey: current.inputKey + 1 }));
      notify({ title: 'Rule uploaded', message: 'Rule uploaded successfully.', level: 'success', source: 'Configuration' });
      if (result.returned) adoptRules(result.configuration);
    } catch (error) {
      notify({ title: 'Rule upload failed', message: getConfigurationErrorMessage(error, 'Rule upload failed.'), level: 'error', source: 'Configuration' });
    }
  }, [adoptRules, apiFetch, mainSessionId, mutateAndLoad, notify, requirePermission, requireSession, ruleUpload, runBusy]);

  const handleSave = useCallback(async () => {
    if (!requirePermission('config:write', 'configuration changes') || !requireSession()) return;
    // Production: a pending rule file turns Save into the multipart rule upload.
    if (ruleUpload.file) {
      await handleRuleUpload();
      return;
    }
    try {
      const payload = buildConfigurationSavePayload(draftRef.current);
      // Saves are not cancellable: an abort could hide a committed change.
      const result = await runBusy('Saving configuration…', (signal) => mutateAndLoad(signal, () => saveConfiguration(apiFetch, mainSessionId, payload, { signal })), { cancellable: false });
      if (!result) return;
      if (!result.ok) {
        notify({ title: 'Configuration notice', message: result.message, level: 'warning', source: 'Configuration' });
        return;
      }
      notify({ title: 'Configuration saved', message: 'Configuration saved successfully.', level: 'success', source: 'Configuration' });
      if (result.returned) adoptConfiguration(result.configuration);
      else {
        // No configuration came back and the reload failed: the saved draft
        // is the best known state, so share it with the session.
        const saved = draftRef.current;
        setBaseline(payloadKey(saved));
        setConfiguration((current) => preserveDomainRegistry(current, saved));
      }
    } catch (error) {
      notify({ title: 'Configuration error', message: getConfigurationErrorMessage(error), level: 'error', source: 'Configuration' });
    }
  }, [adoptConfiguration, apiFetch, handleRuleUpload, mainSessionId, mutateAndLoad, notify, requirePermission, requireSession, ruleUpload.file, runBusy, setConfiguration]);

  const handleReset = useCallback(async () => {
    // Reset replaces the session configuration every Source window uses.
    if (!requirePermission('config:write', 'configuration reset') || !requireSession()) return;
    const confirmed = await requestConfirmation({
      title: 'Reset to defaults?',
      message: `Load the default configuration for this session? It replaces the current settings for every Source window${dirtyRef.current ? ' and discards your unsaved changes' : ''}.`,
      confirmText: 'Reset',
    });
    if (!confirmed) return;
    try {
      const result = await runBusy('Loading default configuration…', (signal) => loadDefaultConfiguration(apiFetch, mainSessionId, { signal }), { cancellable: false });
      if (!result) return;
      if (!result.ok) {
        notify({ title: 'Configuration notice', message: result.message, level: 'warning', source: 'Configuration' });
        return;
      }
      adoptConfiguration(result.configuration);
      notify({ title: 'Configuration reset', message: 'Default configuration loaded for this session.', level: 'success', source: 'Configuration' });
    } catch (error) {
      notify({ title: 'Configuration error', message: getConfigurationErrorMessage(error, 'Could not reset configuration. Try again.'), level: 'error', source: 'Configuration' });
    }
  }, [adoptConfiguration, apiFetch, mainSessionId, notify, requestConfirmation, requirePermission, requireSession, runBusy]);

  const handleRemoveRule = useCallback(async (ruleName) => {
    if (!requirePermission('config:write', 'rule removal') || !requireSession()) return;
    const markBuiltin = (message) => {
      const match = message.match(/rule\s+'([^']+)'/i);
      const names = [match?.[1], ruleName].filter(Boolean).map((name) => name.trim());
      setKnownBuiltinRules((current) => new Set([...current, ...names, ...names.map((name) => name.toLowerCase())]));
    };
    const warn = (message) => {
      const builtin = /built-?in/i.test(message);
      if (builtin) markBuiltin(message);
      notify({ title: builtin ? 'Built-in rule' : 'Rule removal', message, level: 'warning', source: 'Configuration' });
    };
    try {
      const result = await runBusy(`Removing rule “${ruleName}”…`, (signal) => mutateAndLoad(signal, () => removeRule(apiFetch, mainSessionId, ruleName, { signal })), { cancellable: false });
      if (!result) return;
      if (!result.ok) {
        warn(result.message);
        return;
      }
      notify({ title: 'Rule removed', message: `Rule “${ruleName}” was removed.`, level: 'success', source: 'Configuration' });
      if (result.returned) adoptRules(result.configuration);
    } catch (error) {
      warn(getConfigurationErrorMessage(error, 'Could not remove the selected rule. Try again.'));
    }
  }, [adoptRules, apiFetch, mainSessionId, mutateAndLoad, notify, requirePermission, requireSession, runBusy]);

  const handleSwitchDomain = useCallback(async (domain) => {
    const current = getActiveDomainKey(draftRef.current);
    if (!domain || domain === current) return;
    if (!requirePermission('config:write', 'domain switching') || !requireSession()) return;
    if (dirtyRef.current && !(await requestConfirmation({
      title: 'Discard unsaved changes?',
      message: 'Switching the domain pillar discards unsaved configuration changes. Continue?',
      confirmText: 'Switch domain',
    }))) return;
    const label = formatDomainPillarLabel(domain);
    try {
      const result = await runBusy(`Switching domain to ${label}…`, (signal) => switchDomain(apiFetch, mainSessionId, domain, { signal }), { cancellable: false });
      if (!result) {
        // Cancelled: the backend may already have switched (no job cancel
        // yet, backend request B-7), so reload to match the session.
        setTimeout(() => { if (mountedRef.current) reload({ quiet: true }); }, 0);
        return;
      }
      if (!result.ok) {
        notify({ title: 'Domain switch failed', message: result.message || `Could not switch to ${label}.`, level: 'warning', source: 'Configuration' });
        return;
      }
      const next = { ...result.configuration };
      if (!next.active_domain) next.active_domain = domain;
      if (!next.domain) next.domain = domain;
      // The returned configuration replaces the draft (only the backend-owned
      // domain registry is carried over), discarding unsaved edits.
      adoptConfiguration(next);
      notify({
        title: 'Domain pillar switched',
        message: `Session domain switched to ${label}. Storage targets and connection settings re-projected.`,
        level: 'success',
        source: 'Configuration',
      });
    } catch (error) {
      notify({ title: 'Domain switch error', message: getConfigurationErrorMessage(error, 'Failed to switch domain pillar.'), level: 'error', source: 'Configuration' });
    }
  }, [adoptConfiguration, apiFetch, mainSessionId, notify, reload, requestConfirmation, requirePermission, requireSession, runBusy]);

  /* ── Encrypted export / import ── */

  const openExport = () => {
    if (!requirePermission('config:read', 'configuration export') || !requireSession()) return;
    if (dirtyRef.current) notify({ title: 'Unsaved changes', message: 'Export uses the saved session configuration. Save first to include your edits.', level: 'info', source: 'Configuration' });
    setLxac({ mode: 'export', file: null });
  };

  const pickImportFile = async () => {
    if (!requirePermission('config:write', 'configuration import') || !requireSession()) return;
    if (dirtyRef.current && !(await requestConfirmation({
      title: 'Discard unsaved changes?',
      message: 'Importing a configuration replaces the current settings and discards your unsaved changes. Continue?',
      confirmText: 'Continue',
    }))) return;
    importInputRef.current?.click();
  };

  const handleImportFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.lxac')) {
      notify({ title: 'Invalid file type', message: 'Only LinkX encrypted configuration files (.lxac) are supported.', level: 'warning', source: 'Configuration' });
      return;
    }
    const verdict = await verifyLxacFile(apiFetch, file);
    if (!verdict.ok) {
      notify({ title: 'Invalid file format', message: verdict.message, level: 'error', source: 'Configuration' });
      return;
    }
    setLxac({ mode: 'import', file });
  };

  const submitLxac = async (password) => {
    if (lxac?.mode === 'export') {
      try {
        const { filename } = await exportEncryptedConfiguration(apiFetch, mainSessionId, password);
        notify({ title: 'Configuration exported', message: `Encrypted configuration exported as ${filename}. Keep your password safe.`, level: 'success', source: 'Configuration' });
        setLxac(null);
      } catch (error) {
        throw new Error(getLxacErrorMessage(error, 'Failed to export encrypted configuration. Try again.'));
      }
      return;
    }
    let result;
    try {
      result = await importEncryptedConfiguration(apiFetch, mainSessionId, lxac.file, password);
    } catch (error) {
      throw new Error(getLxacErrorMessage(error, 'Could not decrypt configuration file. Try again.'));
    }
    if (!result.ok) throw new Error(result.message);
    adoptConfiguration(result.configuration);
    notify({ title: 'Configuration imported', message: 'Configuration decrypted and imported. Multi-domain settings applied.', level: 'success', source: 'Configuration' });
    setLxac(null);
  };

  /* ── Render ── */

  const isCdr = getActiveDomainKey(draft) === 'cdr';
  const showDraftActions = DRAFT_TABS.has(activeTab);

  let content = null;
  if (!canRead) {
    content = <p className="settings_hint">You need config:read to view the configuration.</p>;
  } else if (activeTab === 'system') {
    content = (
      <SystemPanel
        draft={draft}
        onChange={handleChange}
        onSwitchDomain={handleSwitchDomain}
        isSwitchingDomain={Boolean(busy?.label?.startsWith('Switching domain'))}
        canWrite={canWrite}
        idleSettings={idleSettings}
        idlePolicyMeta={idlePolicyMeta}
        onIdleSettingsChange={updateIdleSettings}
      />
    );
  } else if (activeTab === 'connections') {
    content = <ConnectionsPanel draft={draft} onChange={handleChange} canWrite={canWrite} />;
  } else if (activeTab === 'tools') {
    content = <ToolsPanel draft={draft} onChange={handleChange} canWrite={canWrite} />;
  } else if (activeTab === 'rules') {
    content = (
      <RulesPanel
        draft={draft}
        onChange={handleChange}
        canEditEntities={canWrite}
        canWrite={canWrite}
        knownBuiltinRules={knownBuiltinRules}
        ruleUpload={ruleUpload}
        onRuleUploadChange={(patch) => setRuleUpload((current) => ({ ...current, ...patch }))}
        onUploadRule={handleRuleUpload}
        onRemoveRule={handleRemoveRule}
        onNotice={notify}
      />
    );
  } else if (activeTab === 'sensitivity') {
    content = <DetectionSensitivityPanel key={isCdr ? 'cdr' : 'bank'} apiFetch={apiFetch} isCdr={isCdr} canManage={canManageUsers} notify={notify} />;
  } else if (activeTab === 'activity') {
    content = <ActivityLogPanel apiFetch={apiFetch} canManage={canManageUsers} defaultSessionId={mainSessionId} />;
  }

  return (
    <div className="workspace_window_body settings_window_body configuration_window_body">
      <div className="settings_window_workspace">
        <header className="settings_window_choose_header">
          <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z" />
          </svg>
          <div>
            <h2>Configuration</h2>
            <p>{activeTabMeta?.description}</p>
            <dl className="settings_window_session_chip config_window_chips">
              <div>
                <dt>Session</dt>
                <dd>{mainSessionId || 'not initialized'}</dd>
              </div>
              <div>
                <dt>Domain</dt>
                <dd>{formatDomainPillarLabel(getActiveDomainKey(draft))}</dd>
              </div>
            </dl>
          </div>
        </header>
        <div className="settings_window_workflow_shell">
          <nav className="settings_window_timeline source_window_timeline is-tabs" aria-label="Configuration tabs">
            <div className="source_window_timeline_steps">
              {visibleTabs.map((tab, index) => (
                <React.Fragment key={tab.id}>
                  {index > 0 && <span className="source_window_timeline_connector" aria-hidden="true" />}
                  <button
                    type="button"
                    className={activeTab === tab.id ? 'is-active' : 'is-inactive'}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    onClick={() => selectTab(tab.id)}
                  >
                    <span className="source_window_timeline_marker" aria-hidden="true">
                      <i className="source_window_timeline_marker_dot" />
                    </span>
                    <strong>{tab.label}{tab.permission && !canAccess(tab.permission) ? <span aria-hidden="true"> 🔒</span> : null}</strong>
                    <small>{tab.permission && !canAccess(tab.permission) ? `Requires ${tab.permission}` : tab.description}</small>
                  </button>
                </React.Fragment>
              ))}
            </div>
          </nav>
          <div className="settings_window_surface config_window_surface">
            {content}
          </div>
        </div>
        <footer className="settings_window_footer">
          <span>
            <svg className="window_footer_info_icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            {isDirty && showDraftActions
              ? 'Unsaved changes. Save to apply them to the session and new Source windows.'
              : showDraftActions
                ? 'Changes apply to the session after Save.'
                : activeTabMeta?.description}
          </span>
          <div className="settings_window_footer_actions">
            <button type="button" className="settings_button" disabled={!canRead || Boolean(busy)} onClick={() => reload()} title="Reload the saved session configuration">Reload</button>
            <button type="button" className="settings_button" disabled={!canWrite || Boolean(busy)} onClick={handleReset} title="Load the default configuration">Reset</button>
            <button type="button" className="settings_button" disabled={!canRead || Boolean(busy)} onClick={openExport} title="Export an encrypted configuration file">Export</button>
            <button type="button" className="settings_button" disabled={!canWrite || Boolean(busy)} onClick={pickImportFile} title="Import an encrypted configuration file">Import</button>
            {showDraftActions ? (
              <button type="button" className={`settings_button${isDirty || ruleUpload.file ? ' is-primary' : ''}`} disabled={!canWrite || Boolean(busy)} onClick={handleSave}>Save</button>
            ) : null}
          </div>
          <input ref={importInputRef} type="file" accept=".lxac,.Lxac" hidden onChange={handleImportFileChange} />
        </footer>
      </div>
      {busy ? <WindowLoadScreen overlay label={busy.label} onCancel={busy.cancellable ? cancelBusy : undefined} /> : null}
      {lxac ? (
        <LxacDialog
          mode={lxac.mode}
          file={lxac.file}
          onSelectFile={() => importInputRef.current?.click()}
          onDropFile={() => setLxac((current) => ({ ...current, file: null }))}
          onSubmit={submitLxac}
          onClose={() => setLxac(null)}
        />
      ) : null}
    </div>
  );
}
