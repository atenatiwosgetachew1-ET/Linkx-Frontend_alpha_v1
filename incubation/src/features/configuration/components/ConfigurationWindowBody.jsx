import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useAllowedDomains } from '../../../auth/useAllowedDomains.js';
import { useCan } from '../../../auth/useCan.js';
import { useSession } from '../../../shared/session/useSession.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useWorkspaceActions } from '../../../workspace/hooks/useWorkspace.js';
import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { ConnectionsPanel, RulesPanel, SystemPanel, ToolsPanel } from './ConfigurationPanels.jsx';
import { CONFIG_PROFILE_KEY, profileFromConfiguration, setProfileSettings } from '../../graph/lib/nodeProfile.js';
import { adoptPresentation, getPresentationSeq, getPresentationVersion, subscribePresentation, isPresentationLoaded, loadPresentation, withoutPresentation } from '../../graph/lib/domainPresentation.js';
import { savePresentation } from '../../../services/domainConfigApi.js';
import { CONFIG_FORMATTING_KEY, setDomainFormatting } from '../../graph/lib/conditionalFormatting.js';
import DomainsPanel from './DomainsPanel.jsx';
import OwnColumns from './OwnColumns.jsx';
import ActivityLogPanel from './ActivityLogPanel.jsx';
import LxacDialog from './LxacDialog.jsx';
import {
  applyConfigurationChange,
  buildConfigurationSavePayload,
  withoutAdminKeys,
  withoutColumnLists,
  formatDomainPillarLabel,
  getActiveDomainKey,
  getRegisteredDomains,
  getConfigurationErrorMessage,
  normalizeLoadedConfiguration,
  preserveDomainRegistry,
} from '../lib/configModel.js';
import { keepDomainsView } from '../lib/domainDrafts.js';
import { getConfigurationDraft, keepConfigurationDraft, rebaseConfigurationDraft } from '../lib/configDraft.js';
import { getKnownBuiltinRules, subscribeKnownBuiltinRules } from '../../libraries/lib/rulesLibrary.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import {
  exportEncryptedConfiguration,
  getLxacErrorMessage,
  importEncryptedConfiguration,
  loadConfiguration,
  loadDefaultConfiguration,
  saveConfiguration,
  switchDomain,
  verifyLxacFile,
} from '../../../services/configurationApi.js';

const TABS = [
  { id: 'system', label: 'System', description: 'Domain pillar, session timeout policy and service toggles.' },
  { id: 'connections', label: 'Connections', description: 'Broker, storage and search endpoints used by Source windows.' },
  { id: 'tools', label: 'Tools', description: 'Graph tool (Neo4j) connection defaults.' },
  { id: 'rules', label: 'Rules', description: 'Analysis rules, classified entities, profile mapping and formatting rules.' },
  { id: 'domains', label: 'Domains', description: 'Each domain’s thresholds, sensitivity, score lineage, columns and column mapping.', permission: 'config:read' },
  { id: 'activity', label: 'Activity log', description: 'Session cleanup and cleanup audit trail.', permission: 'users:manage' },
];
// Tabs whose fields belong to the session configuration draft (Save/Reset).
const DRAFT_TABS = new Set(['system', 'connections', 'tools', 'rules']);


const payloadKey = (config) => {
  try {
    return JSON.stringify(buildConfigurationSavePayload(config));
  } catch {
    return '';
  }
};

const isAbort = (error) => error?.name === 'AbortError';

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

  const allowedDomains = useAllowedDomains();
  const canRead = canAccess('config:read');
  const canWrite = canAccess('config:write');
  const canManageUsers = canAccess('users:manage');
  // Analysts may switch domain without config:write (R2-18).
  const canSwitchDomain = canWrite || (canRead && canAccess('analysis:run'));

  // Every tab stays visible; tabs the account can't use explain why inside.
  const visibleTabs = TABS;
  // 'sensitivity': what this tab was called in a kept workspace.
  const keptTab = windowItem?.metadata?.configurationUi?.activeTab;
  const storedTab = keptTab === 'sensitivity' ? 'domains' : keptTab;
  const [activeTab, setActiveTab] = useState(visibleTabs.some((tab) => tab.id === storedTab) ? storedTab : 'system');
  const activeTabMeta = visibleTabs.find((tab) => tab.id === activeTab) || visibleTabs[0];

  // Unsaved edits survive the body unmounting (docked tabs): they are kept per
  // window in configDraft.js and rebased onto the current session config.
  const windowId = windowItem?.id;
  const [initialState] = useState(() => {
    const session = normalizeLoadedConfiguration(configuration);
    const stored = getConfigurationDraft(windowId);
    if (stored && stored.sessionId === mainSessionId) {
      const rebased = preserveDomainRegistry(stored.draft, rebaseConfigurationDraft(stored.draft, stored.base, session));
      return { draft: rebased, base: session, restored: true };
    }
    keepConfigurationDraft(windowId, null);
    return { draft: session, base: session, restored: false };
  });
  const [draft, setDraft] = useState(initialState.draft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  // The configuration the draft was taken from (what "unsaved" compares to).
  const baseRef = useRef(initialState.base);
  const [baseline, setBaseline] = useState(() => payloadKey(initialState.base));
  const isDirty = useMemo(() => payloadKey(draft) !== baseline, [baseline, draft]);
  const dirtyRef = useRef(isDirty);
  dirtyRef.current = isDirty;
  const configurationRef = useRef(configuration);
  configurationRef.current = configuration;

  // Keep (or forget) the unsaved draft for this window. Module memory only:
  // it can hold a typed password, so it never goes into workspace metadata.
  useEffect(() => {
    keepConfigurationDraft(windowId, isDirty ? { draft, base: baseRef.current, sessionId: mainSessionId } : null);
  }, [windowId, draft, isDirty, mainSessionId]);

  const [busy, setBusy] = useState(null); // { label, cancellable }
  // A restored unsaved draft is not overwritten by a reload on remount.
  const [isLoaded, setIsLoaded] = useState(initialState.restored);
  // Rule upload / removal live in the Libraries window; built-in rules it
  // learned about are shared so the active-rule picker marks them too.
  const knownBuiltinRules = useSyncExternalStore(subscribeKnownBuiltinRules, getKnownBuiltinRules);
  const [lxac, setLxac] = useState(null); // { mode, file }
  const importInputRef = useRef(null);
  const controllerRef = useRef(null);
  const mountedRef = useRef(true);
  useEffect(() => () => {
    mountedRef.current = false;
    controllerRef.current?.abort();
  }, []);

  // Opened again with a tab request (e.g. Libraries → "Choose active rule")
  // while already open: switch to it.
  const requestSeq = windowItem?.metadata?.configurationRequest?.seq;
  const lastRequestSeq = useRef(requestSeq);
  useEffect(() => {
    if (!requestSeq || requestSeq === lastRequestSeq.current) return;
    lastRequestSeq.current = requestSeq;
    const tab = windowItem?.metadata?.configurationRequest?.tab;
    if (visibleTabs.some((item) => item.id === tab)) setActiveTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSeq]);

  const selectTab = (tabId) => {
    setActiveTab(tabId);
    workspace.updateWindowMetadata(windowItem.id, { metadata: { configurationUi: { activeTab: tabId } } });
  };

  // Adopts a configuration returned by the backend: becomes the clean draft and
  // the session configuration every Source window reads its defaults from.
  const adoptConfiguration = useCallback((normalized) => {
    const merged = withoutPresentation(preserveDomainRegistry(draftRef.current, normalized), getActiveDomainKey(normalized));
    baseRef.current = merged;
    setDraft(merged);
    setBaseline(payloadKey(merged));
    setConfiguration((current) => preserveDomainRegistry(current, merged));
  }, [setConfiguration]);

  // The domain's shared settings arrived (or changed) after this window opened:
  // shown now, unless they were edited here.
  const presentationSeq = useSyncExternalStore(subscribePresentation, getPresentationSeq);
  useEffect(() => {
    const domainKey = getActiveDomainKey(draftRef.current);
    if (!isPresentationLoaded(domainKey)) return;
    const untouched = [CONFIG_PROFILE_KEY, CONFIG_FORMATTING_KEY].filter((key) => key in (draftRef.current || {}) && JSON.stringify(draftRef.current[key]) === JSON.stringify(baseRef.current?.[key]));
    if (!untouched.length) return;
    const strip = (config) => Object.fromEntries(Object.entries(config || {}).filter(([key]) => !untouched.includes(key)));
    baseRef.current = strip(baseRef.current);
    setBaseline(payloadKey(baseRef.current));
    setDraft(strip);
  }, [presentationSeq]);

  // Keep the draft in step with session changes made elsewhere (e.g. a Source
  // window domain switch). With unsaved edits, untouched keys and the domain
  // follow the session and the edited keys stay, so the header, Domains
  // and the next save never carry a stale domain (production edits
  // one shared configuration, so its save is always current).
  useEffect(() => {
    const loadedConfig = normalizeLoadedConfiguration(configuration);
    if (!Object.keys(loadedConfig).length) return;
    const next = withoutPresentation(loadedConfig, getActiveDomainKey(loadedConfig));
    const merged = dirtyRef.current
      ? preserveDomainRegistry(draftRef.current, rebaseConfigurationDraft(draftRef.current, baseRef.current, next))
      : preserveDomainRegistry(draftRef.current, next);
    baseRef.current = preserveDomainRegistry(baseRef.current, next);
    setDraft(merged);
    setBaseline(payloadKey(baseRef.current));
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

  const handleChange = useCallback((name, value) => {
    setDraft((current) => applyConfigurationChange(current, name, value));
  }, []);

  // The edited profile mapping and formatting rules, if any. -> saved (or
  // nothing to save)
  const savePresentationEdits = useCallback(async (domainKey) => {
    const draftNow = draftRef.current || {};
    const changes = {
      ...(draftNow[CONFIG_PROFILE_KEY] ? { [CONFIG_PROFILE_KEY]: draftNow[CONFIG_PROFILE_KEY] } : {}),
      ...(Array.isArray(draftNow[CONFIG_FORMATTING_KEY]) ? { [CONFIG_FORMATTING_KEY]: draftNow[CONFIG_FORMATTING_KEY] } : {}),
    };
    if (!Object.keys(changes).length) return true;
    const send = (version) => runBusy('Saving profile and formatting…', () => savePresentation(apiFetch, domainKey, changes, version), { cancellable: false });
    let result = await send(getPresentationVersion(domainKey));
    if (result?.conflict) {
      const who = result.conflict.updatedBy || 'Someone else';
      const keepMine = await requestConfirmation({
        title: 'Changed meanwhile',
        icon: 'warning',
        message: `${who} saved this domain’s profile mapping or formatting rules since you opened them. Replace theirs with yours?`,
        confirmText: 'Keep mine',
        cancelText: 'Take theirs',
      });
      if (!keepMine) {
        adoptPresentation(domainKey, result.conflict);
        setDraft((current) => withoutPresentation(current, domainKey));
        notify({ title: 'Configuration notice', message: 'Theirs were loaded. Save again to keep your other changes.', level: 'info', source: 'Configuration' });
        return false;
      }
      result = await send(result.conflict.versionId);
    }
    if (!result?.ok) {
      notify({ title: 'Profile and formatting not saved', message: result?.message || 'They were changed again meanwhile. Try once more.', level: 'warning', source: 'Configuration' });
      return false;
    }
    if (!adoptPresentation(domainKey, result.presentation)) await loadPresentation(apiFetch, domainKey);
    return true;
  }, [apiFetch, notify, requestConfirmation, runBusy]);

  const handleSave = useCallback(async () => {
    if (!requirePermission('config:write', 'configuration changes') || !requireSession()) return;
    // Nothing was loaded: the form's empty lists would replace the real ones.
    if (!isLoaded && !Object.keys(configurationRef.current || {}).length) {
      notify({ title: 'Configuration notice', message: 'The configuration has not been loaded, so it cannot be saved. Reload it first.', level: 'warning', source: 'Configuration' });
      return;
    }
    try {
      const built = buildConfigurationSavePayload(draftRef.current);
      const savedPayload = buildConfigurationSavePayload(baseRef.current || {});
      // Columns are saved apart (Own columns), so an old copy never becomes one's own.
      const payload = withoutColumnLists(canManageUsers ? built : withoutAdminKeys(built));
      // Never left out in silence: what was edited and only an administrator may save.
      if (!canManageUsers) {
        const refused = Object.keys(built).filter((key) => !(key in payload) && JSON.stringify(built[key]) !== JSON.stringify(savedPayload[key]));
        if (refused.length) notify({ title: 'Not all of it can be saved', message: `Only an administrator can change: ${refused.map((key) => key.replace(/_/g, ' ')).join(', ')}. The rest is saved.`, level: 'warning', source: 'Configuration' });
      }
      // The session domain is switched by its own request; a save never
      // sends an older domain back.
      const sessionConfig = normalizeLoadedConfiguration(configurationRef.current);
      ['domain', 'active_domain'].forEach((key) => {
        if (sessionConfig[key]) payload[key] = sessionConfig[key];
      });
      // Profile mapping and formatting rules: the domain's own, on the Service
      // (B-23, B-24). First, so a refusal loses nothing of the rest.
      const domainKey = getActiveDomainKey(sessionConfig);
      const shared = isPresentationLoaded(domainKey);
      if (shared) {
        [CONFIG_PROFILE_KEY, CONFIG_FORMATTING_KEY].forEach((key) => { delete payload[key]; });
        if (!(await savePresentationEdits(domainKey))) return;
      }
      // Saves are not cancellable: an abort could hide a committed change.
      const result = await runBusy('Saving configuration…', (signal) => mutateAndLoad(signal, () => saveConfiguration(apiFetch, mainSessionId, payload, { signal })), { cancellable: false });
      if (!result) return;
      if (!result.ok) {
        notify({ title: 'Configuration notice', message: result.message, level: 'warning', source: 'Configuration' });
        return;
      }
      if (result.credentialsCleared?.length) {
        notify({ title: 'Saved password cleared', message: `The address changed, so the Service dropped: ${result.credentialsCleared.map((key) => key.split('.').slice(-2).join(' ').replace(/_/g, ' ')).join(', ')}. Enter it again.`, level: 'warning', source: 'Configuration' });
      }
      // A Service without the shared settings: a copy in this browser.
      if (!shared && draftRef.current?.[CONFIG_PROFILE_KEY]) {
        setProfileSettings(getActiveDomainKey(sessionConfig), profileFromConfiguration(draftRef.current[CONFIG_PROFILE_KEY]));
      }
      if (!shared && Array.isArray(draftRef.current?.[CONFIG_FORMATTING_KEY])) {
        setDomainFormatting(getActiveDomainKey(sessionConfig), draftRef.current[CONFIG_FORMATTING_KEY]);
      }
      if (result.returned) {
        notify({ title: 'Configuration saved', message: 'Configuration saved successfully.', level: 'success', source: 'Configuration' });
        adoptConfiguration(result.configuration);
      } else {
        // Saved, but no configuration came back and the reload failed. The
        // draft (which may hold a typed raw password) never becomes the
        // session configuration: Source windows keep the last confirmed one
        // until a reload succeeds.
        const saved = withoutPresentation(draftRef.current, domainKey);
        setDraft(saved);
        baseRef.current = saved;
        setBaseline(payloadKey(saved));
        notify({
          title: 'Configuration saved',
          message: 'Saved, but the updated configuration could not be loaded. Use Reload before connecting Source windows.',
          level: 'warning',
          source: 'Configuration',
        });
      }
    } catch (error) {
      notify({ title: 'Configuration error', message: getConfigurationErrorMessage(error), level: 'error', source: 'Configuration' });
    }
  }, [adoptConfiguration, apiFetch, mainSessionId, mutateAndLoad, notify, requirePermission, requireSession, runBusy, isLoaded, canManageUsers, savePresentationEdits]);

  const handleReset = useCallback(async () => {
    // Reset replaces the session configuration every Source window uses.
    if (!requirePermission('config:write', 'configuration reset') || !requireSession()) return;
    const confirmed = await requestConfirmation({
      title: 'Reset to defaults?',
      message: `Load the default configuration for this session? It replaces the current settings for every Source window${dirtyRef.current ? ' and discards your unsaved changes' : ''}.`,
      confirmText: 'Reset',
      icon: 'reset',
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

  const handleSwitchDomain = useCallback(async (domain) => {
    const current = getActiveDomainKey(draftRef.current);
    if (!domain || domain === current) return;
    if (!canSwitchDomain && !requirePermission('config:write', 'domain switching')) return;
    if (!requireSession()) return;
    if (dirtyRef.current && !(await requestConfirmation({
      title: 'Discard unsaved changes?',
      message: 'Switching the domain pillar discards unsaved configuration changes. Continue?',
      confirmText: 'Switch domain',
      icon: 'warning',
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
  }, [adoptConfiguration, apiFetch, mainSessionId, notify, reload, canSwitchDomain, requestConfirmation, requirePermission, requireSession, runBusy]);

  // The session's configuration with the new columns; unsaved edits of the form
  // stay (they are rebased onto it).
  const handleColumnsSaved = useCallback(async (saved) => {
    let next = saved;
    if (!next) {
      const loaded = await loadConfiguration(apiFetch, mainSessionId).catch(() => null);
      next = loaded?.ok ? loaded.configuration : null;
    }
    if (!next || !Object.keys(next).length) {
      notify({ title: 'Configuration notice', message: 'Saved, but the new columns could not be loaded. Use Reload.', level: 'warning', source: 'Configuration' });
      return;
    }
    setConfiguration((current) => preserveDomainRegistry(current, withoutPresentation(next, getActiveDomainKey(next))));
  }, [apiFetch, mainSessionId, notify, setConfiguration]);

  /* ── Encrypted export / import ── */

  const openExport = () => {
    if (!requirePermission('config:write', 'configuration export') || !requireSession()) return;
    if (dirtyRef.current) notify({ title: 'Unsaved changes', message: 'Export uses the saved session configuration. Save first to include your edits.', level: 'info', source: 'Configuration' });
    setLxac({ mode: 'export', file: null });
  };

  const pickImportFile = async () => {
    if (!requirePermission('config:write', 'configuration import') || !requireSession()) return;
    if (dirtyRef.current && !(await requestConfirmation({
      title: 'Discard unsaved changes?',
      message: 'Importing a configuration replaces the current settings and discards your unsaved changes. Continue?',
      confirmText: 'Continue',
      icon: 'warning',
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
        canSwitchDomain={canSwitchDomain}
        allowedDomains={allowedDomains}
        idleSettings={idleSettings}
        idlePolicyMeta={idlePolicyMeta}
        onIdleSettingsChange={updateIdleSettings}
      />
    );
  } else if (activeTab === 'connections') {
    content = (
      <ConnectionsPanel
        draft={draft}
        onChange={handleChange}
        canWrite={canWrite}
        columns={(
          <OwnColumns
            windowId={windowId}
            apiFetch={apiFetch}
            sessionId={mainSessionId}
            domain={getActiveDomainKey(configuration)}
            configuration={configuration}
            canOverride={canAccess('columns:override') && canAccess('analysis:run') && Boolean(mainSessionId)}
            notify={notify}
            requestConfirmation={requestConfirmation}
            onSaved={handleColumnsSaved}
          />
        )}
      />
    );
  } else if (activeTab === 'tools') {
    content = <ToolsPanel draft={draft} onChange={handleChange} canWrite={canWrite} />;
  } else if (activeTab === 'rules') {
    content = (
      <RulesPanel
        draft={draft}
        onChange={handleChange}
        canEditEntities={canWrite && canManageUsers}
        canWrite={canWrite}
        knownBuiltinRules={knownBuiltinRules}
        onManageRules={() => workspace.openWindow(WORKSPACE_WINDOW_TYPES.LIBRARIES, { metadata: { librariesUi: { activeTab: 'rules' }, librariesRequest: { tab: 'rules', seq: Date.now() } } })}
        onOpenDomainMapping={() => { keepDomainsView(windowId, { domain: getActiveDomainKey(draft), part: 'mapping' }); selectTab('domains'); }}
        onNotice={notify}
      />
    );
  } else if (activeTab === 'domains') {
    content = <DomainsPanel windowId={windowId} apiFetch={apiFetch} domains={getRegisteredDomains(draft)} activeDomain={getActiveDomainKey(draft)} canManage={canManageUsers} notify={notify} requestConfirmation={requestConfirmation} />;
  } else if (activeTab === 'activity') {
    content = <ActivityLogPanel apiFetch={apiFetch} canManage={canManageUsers} defaultSessionId={mainSessionId} />;
  }

  return (
    <div className="workspace_window_body settings_window_body configuration_window_body">
      <div className="settings_window_workspace configuration_theme_scope is-compact-header">
        <header className="settings_window_choose_header">
          <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z" />
          </svg>
          <div>
            <h2>Configuration</h2>
            <p>The session's domain, connections, tools and analysis rules.</p>
          </div>
          <dl className="settings_window_session_chip config_window_chips">
            <div>
              <dt>Session</dt>
              <dd title={mainSessionId || undefined}>{mainSessionId || 'not initialized'}</dd>
            </div>
            <div>
              <dt>Domain</dt>
              <dd>{formatDomainPillarLabel(getActiveDomainKey(draft))}</dd>
            </div>
          </dl>
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
            <button type="button" className="settings_button" disabled={!canWrite || Boolean(busy)} onClick={openExport} title={canWrite ? 'Export an encrypted configuration file' : 'You need config:write to export the configuration.'}>Export</button>
            <button type="button" className="settings_button" disabled={!canWrite || Boolean(busy)} onClick={pickImportFile} title="Import an encrypted configuration file">Import</button>
            {showDraftActions ? (
              <button type="button" className={`settings_button${isDirty ? ' is-primary' : ''}`} disabled={!canWrite || Boolean(busy)} onClick={handleSave}>Save</button>
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
