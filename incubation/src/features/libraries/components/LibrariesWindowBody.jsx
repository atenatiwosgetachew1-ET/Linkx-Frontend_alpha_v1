import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useCan } from '../../../auth/useCan.js';
import { useSession } from '../../../shared/session/useSession.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { loadConfiguration, removeRule, uploadRule } from '../../../services/configurationApi.js';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { getConfigurationErrorMessage } from '../../configuration/lib/configModel.js';
import { RULE_TEMPLATE_FILE, RULE_TEMPLATE_PATH,
  buildRuleUploadFields,
  builtinNamesFromMessage,
  hasRuleCatalogue,
  pickRuleKeys,
  rememberBuiltinRules,
} from '../lib/rulesLibrary.js';
import { Masthead, PageHero, Pill, SettingsPage } from '../../settings/components/SettingsPage.jsx';
import RulesLibraryPanel from './RulesLibraryPanel.jsx';
import GraphRenderingPanel from './GraphRenderingPanel.jsx';
import ReportTemplatesPanel from './ReportTemplatesPanel.jsx';
import ChartDefaultsPanel from './ChartDefaultsPanel.jsx';
import GraphDefaultsPanel from './GraphDefaultsPanel.jsx';
import TableDefaultsPanel from './TableDefaultsPanel.jsx';
import IconSetsPanel from './IconSetsPanel.jsx';

// Sections of the Libraries window (docs/libraries-plan.md §3). Only Rules is
// live; the others arrive with the Graph / Chart windows and are shown so the
// analyst knows where those settings will be.
const SECTIONS = [
  { id: 'rules', label: 'Rules', scope: 'System', description: 'Rule sets available to this session.' },
  { id: 'graph_rendering', label: 'Graph rendering', scope: 'Device', description: 'GPU rendering for large graphs.' },
  { id: 'graph_defaults', label: 'Graph defaults', scope: 'Device', description: 'Default graph settings.' },
  { id: 'table_defaults', label: 'Table defaults', scope: 'Device', description: 'Default table settings.' },
  { id: 'charts', label: 'Chart defaults', scope: 'Device', description: 'Default chart settings.' },
  { id: 'icons', label: 'Icon sets', scope: 'Device', description: 'Node icons for graphs.' },
  { id: 'templates', label: 'Report templates', scope: 'System', description: 'Report and chart snap layouts.' },
];

export default function LibrariesWindowBody({ windowItem }) {
  const workspace = useWorkspace();
  const canAccess = useCan();
  const canRead = canAccess('config:read');
  const canWrite = canAccess('config:write');
  const { apiFetch, mainSessionId, isSessionReady, configuration, setConfiguration } = useSession();
  const { notify } = useNotifications();
  const [activeTab, setActiveTab] = useState(() => windowItem?.metadata?.librariesUi?.activeTab || 'rules');
  const [busy, setBusy] = useState('');
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Opened again with a section request (Configuration → "Manage rules",
  // Source → "Rules library") while already open: switch to it.
  const requestSeq = windowItem?.metadata?.librariesRequest?.seq;
  const lastRequestSeq = useRef(requestSeq);
  useEffect(() => {
    if (!requestSeq || requestSeq === lastRequestSeq.current) return;
    lastRequestSeq.current = requestSeq;
    const tab = windowItem?.metadata?.librariesRequest?.tab;
    if (SECTIONS.some((section) => section.id === tab)) setActiveTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestSeq]);

  const activeSection = SECTIONS.find((section) => section.id === activeTab) || SECTIONS[0];
  const selectTab = (tabId) => {
    setActiveTab(tabId);
    workspace.updateWindowMetadata(windowItem.id, { metadata: { librariesUi: { activeTab: tabId } } });
  };

  // Only the rule catalogue is taken from the server: other session settings
  // (and the Configuration window's unsaved draft) are left alone.
  const adoptRules = useCallback((loaded) => {
    setConfiguration((current) => ({ ...current, ...pickRuleKeys(loaded) }));
  }, [setConfiguration]);

  const refreshRules = useCallback(async () => {
    const loaded = await loadConfiguration(apiFetch, mainSessionId).catch(() => null);
    if (loaded?.ok) adoptRules(loaded.configuration);
    return Boolean(loaded?.ok);
  }, [adoptRules, apiFetch, mainSessionId]);

  // First load and Reload: shown on the busy overlay, and a failure is told
  // (the panel would otherwise read as an empty catalogue).
  const reloadRules = useCallback(async () => {
    setBusy('Loading rules…');
    try {
      const loaded = await loadConfiguration(apiFetch, mainSessionId);
      if (loaded?.ok) adoptRules(loaded.configuration);
      else notify({ title: 'Rules not loaded', message: loaded?.message || 'Could not load configuration. Try again.', level: 'warning', source: 'Libraries' });
    } catch (error) {
      if (mountedRef.current) notify({ title: 'Rules not loaded', message: getConfigurationErrorMessage(error, 'Could not load configuration. Try again.'), level: 'error', source: 'Libraries' });
    } finally {
      if (mountedRef.current) setBusy('');
    }
  }, [adoptRules, apiFetch, mainSessionId, notify]);

  // /init may not carry the rule catalogue: load it once.
  useEffect(() => {
    if (!isSessionReady || !mainSessionId || !canRead || hasRuleCatalogue(configuration)) return;
    reloadRules();
    // Once per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSessionReady, mainSessionId, canRead]);

  const runRuleChange = async (label, request) => {
    if (!mainSessionId) {
      notify({ title: 'Session not ready', message: 'The analysis session is not initialized yet.', level: 'warning', source: 'Libraries' });
      return null;
    }
    setBusy(label);
    try {
      const result = await request();
      if (result?.ok) {
        if (result.returned) adoptRules(result.configuration);
        else await refreshRules();
      }
      return result;
    } finally {
      if (mountedRef.current) setBusy('');
    }
  };

  const handleUpload = async ({ file, ruleName }) => {
    if (!canWrite) {
      notify({ title: 'Permission denied', message: 'You need config:write to use rule uploads.', level: 'warning', source: 'RBAC' });
      return false;
    }
    try {
      const result = await runRuleChange('Uploading rule…', () => uploadRule(apiFetch, mainSessionId, { file, ruleName, fields: buildRuleUploadFields(configuration) }));
      if (!result) return false;
      if (!result.ok) {
        notify({ title: 'Rule upload', message: result.message, level: 'warning', source: 'Libraries' });
        return false;
      }
      notify({ title: 'Rule uploaded', message: 'Rule uploaded successfully.', level: 'success', source: 'Libraries' });
      return true;
    } catch (error) {
      // A built-in rule set's name or pattern is refused with its name (round 4 §6).
      notify({ title: 'Rule upload failed', message: getServiceRefusalMessage(error) || getConfigurationErrorMessage(error, 'Rule upload failed.'), level: 'error', source: 'Libraries' });
      return false;
    }
  };

  const handleRemove = async (ruleName) => {
    if (!canWrite) {
      notify({ title: 'Permission denied', message: 'You need config:write to use rule removal.', level: 'warning', source: 'RBAC' });
      return;
    }
    const warn = (message) => {
      const builtin = /built-?in/i.test(message);
      if (builtin) rememberBuiltinRules(builtinNamesFromMessage(message, ruleName));
      notify({ title: builtin ? 'Built-in rule' : 'Rule removal', message, level: 'warning', source: 'Libraries' });
    };
    try {
      const result = await runRuleChange(`Removing rule “${ruleName}”…`, () => removeRule(apiFetch, mainSessionId, ruleName));
      if (!result) return;
      if (!result.ok) {
        warn(result.message);
        return;
      }
      notify({ title: 'Rule removed', message: `Rule “${ruleName}” was removed.`, level: 'success', source: 'Libraries' });
    } catch (error) {
      warn(getConfigurationErrorMessage(error, 'Could not remove the selected rule. Try again.'));
    }
  };

  // The Service's rule template (B-16).
  const downloadTemplate = async () => {
    try {
      const blob = await apiFetch(RULE_TEMPLATE_PATH, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = RULE_TEMPLATE_FILE;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      notify({ title: 'Rule template', message: error?.status === 404 ? 'The Service has no rule template.' : 'The rule template could not be downloaded.', level: 'warning', source: 'Libraries' });
    }
  };
  const openConfigurationRules = () => {
    workspace.openWindow(WORKSPACE_WINDOW_TYPES.CONFIGURATION, {
      metadata: { configurationUi: { activeTab: 'rules' }, configurationRequest: { tab: 'rules', seq: Date.now() } },
    });
  };

  const scopeNote = activeSection.scope === 'System' ? 'Applies to the whole session; changes need config:write.'
    : activeSection.scope === 'Device' ? 'Applies to this browser on this device only.'
      : 'Applies to your account.';

  let content;
  if (activeSection.pending) {
    content = (
      <SettingsPage className="config_page libraries_page">
        <Masthead>
          <PageHero
            tone="inactive"
            eyebrow={`${activeSection.scope} library`}
            title={activeSection.label}
            pill={<Pill tone="neutral">Coming soon</Pill>}
            meta={activeSection.description}
            media={(
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2" />
              </svg>
            )}
          />
        </Masthead>
        <div className="libraries_pending" role="status">
          <h4>Not here yet</h4>
          <p>{activeSection.pending}</p>
        </div>
      </SettingsPage>
    );
  } else if (activeSection.id === 'graph_rendering') {
    content = <GraphRenderingPanel configuration={configuration} />;
  } else if (activeSection.id === 'templates') {
    content = <ReportTemplatesPanel />;
  } else if (activeSection.id === 'charts') {
    content = <ChartDefaultsPanel />;
  } else if (activeSection.id === 'graph_defaults') {
    content = <GraphDefaultsPanel />;
  } else if (activeSection.id === 'icons') {
    content = <IconSetsPanel onNotice={notify} />;
  } else if (activeSection.id === 'table_defaults') {
    content = <TableDefaultsPanel />;
  } else {
    content = (
      <RulesLibraryPanel
        configuration={configuration}
        canRead={canRead}
        canWrite={canWrite}
        busy={busy}
        onUpload={handleUpload}
        onRemove={handleRemove}
        onOpenConfiguration={openConfigurationRules}
        onTemplate={downloadTemplate}
      />
    );
  }

  return (
    <div className="workspace_window_body settings_window_body libraries_window_body">
      <div className="settings_window_workspace libraries_theme_scope is-compact-header">
        <header className="settings_window_choose_header">
          <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
          </svg>
          <div>
            <h2>Libraries</h2>
            <p>Rule sets, window defaults, icon sets, rendering and report templates.</p>
          </div>
          <dl className="settings_window_session_chip config_window_chips">
            <div>
              <dt>Session</dt>
              <dd title={mainSessionId || undefined}>{mainSessionId || 'not initialized'}</dd>
            </div>
            <div>
              <dt>Scope</dt>
              <dd>{activeSection.scope}</dd>
            </div>
          </dl>
        </header>
        <div className="settings_window_workflow_shell">
          <nav className="settings_window_timeline source_window_timeline is-tabs" aria-label="Library sections">
            <div className="source_window_timeline_steps">
              {SECTIONS.map((section, index) => (
                <React.Fragment key={section.id}>
                  {index > 0 && <span className="source_window_timeline_connector" aria-hidden="true" />}
                  <button
                    type="button"
                    className={activeTab === section.id ? 'is-active' : 'is-inactive'}
                    aria-current={activeTab === section.id ? 'page' : undefined}
                    onClick={() => selectTab(section.id)}
                  >
                    <span className="source_window_timeline_marker" aria-hidden="true">
                      <i className="source_window_timeline_marker_dot" />
                    </span>
                    <strong>{section.label}</strong>
                    <small>{section.pending ? 'Coming soon' : `${section.scope} · ${section.description}`}</small>
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
            {activeSection.scope} library. {scopeNote}
          </span>
          <div className="settings_window_footer_actions">
            {activeSection.id === 'rules' ? (
              <button type="button" className="settings_button" disabled={!canRead || Boolean(busy) || !mainSessionId} onClick={reloadRules}>Reload</button>
            ) : null}
          </div>
        </footer>
      </div>
      {busy ? <WindowLoadScreen overlay label={busy} /> : null}
    </div>
  );
}
