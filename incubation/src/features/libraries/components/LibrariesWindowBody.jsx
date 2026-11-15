import React, { useCallback, useEffect, useRef, useState } from 'react';

import { useCan } from '../../../auth/useCan.js';
import { useSession } from '../../../shared/session/useSession.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { loadConfiguration, removeRule, uploadRule } from '../../../services/configurationApi.js';
import { getConfigurationErrorMessage } from '../../configuration/lib/configModel.js';
import {
  buildRuleUploadFields,
  builtinNamesFromMessage,
  hasRuleCatalogue,
  pickRuleKeys,
  rememberBuiltinRules,
} from '../lib/rulesLibrary.js';
import RulesLibraryPanel from './RulesLibraryPanel.jsx';
import GraphRenderingPanel from './GraphRenderingPanel.jsx';

// Sections of the Libraries window (docs/libraries-plan.md §3). Only Rules is
// live; the others arrive with the Graph / Chart windows and are shown so the
// analyst knows where those settings will be.
const SECTIONS = [
  { id: 'rules', label: 'Rules', scope: 'System', description: 'Rule sets available to this session.' },
  { id: 'graph_rendering', label: 'Graph rendering', scope: 'Device', description: 'GPU rendering for large graphs.' },
  { id: 'graph_defaults', label: 'Graph defaults', scope: 'Personal', description: 'Default layout, limits and labels.', pending: 'Arrives with the Graph window.' },
  { id: 'charts', label: 'Charts', scope: 'Personal', description: 'Chart colours and metric scope.', pending: 'Arrives with the Chart window.' },
  { id: 'icons', label: 'Icon sets', scope: 'System', description: 'Node icon albums.', pending: 'Arrives with graph editing.' },
  { id: 'templates', label: 'Report templates', scope: 'System', description: 'Evidence report layouts.', pending: 'Arrives with the evidence report.' },
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

  // /init may not carry the rule catalogue: load it once.
  useEffect(() => {
    if (!isSessionReady || !mainSessionId || !canRead || hasRuleCatalogue(configuration)) return;
    refreshRules();
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
      notify({ title: 'Rule upload failed', message: getConfigurationErrorMessage(error, 'Rule upload failed.'), level: 'error', source: 'Libraries' });
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

  const openConfigurationRules = () => {
    workspace.openWindow(WORKSPACE_WINDOW_TYPES.CONFIGURATION, {
      metadata: { configurationUi: { activeTab: 'rules' }, configurationRequest: { tab: 'rules', seq: Date.now() } },
    });
  };

  let content;
  if (activeSection.pending) {
    content = (
      <div className="libraries_pending" role="status">
        <span className={`libraries_badge is-scope is-${activeSection.scope.toLowerCase()}`}>{activeSection.scope}</span>
        <h4>{activeSection.label}</h4>
        <p>{activeSection.description} {activeSection.pending}</p>
      </div>
    );
  } else if (activeSection.id === 'graph_rendering') {
    content = <GraphRenderingPanel configuration={configuration} />;
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
      />
    );
  }

  return (
    <div className="workspace_window_body settings_window_body libraries_window_body">
      <div className="settings_window_workspace">
        <header className="settings_window_choose_header">
          <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
          </svg>
          <div>
            <h2>Libraries</h2>
            <p>{activeSection.description}</p>
          </div>
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
            <span className={`libraries_badge is-scope is-${activeSection.scope.toLowerCase()}`}>{activeSection.scope}</span>
            {' '}
            {activeSection.scope === 'System' ? 'Applies to the whole session; changes need config:write.'
              : activeSection.scope === 'Device' ? 'Applies to this browser on this device only.'
                : 'Applies to your account.'}
          </span>
          <div className="settings_window_footer_actions">
            {activeSection.id === 'rules' ? (
              <button type="button" className="settings_button" disabled={!canRead || Boolean(busy) || !mainSessionId} onClick={refreshRules}>Reload</button>
            ) : null}
          </div>
        </footer>
      </div>
      {busy ? <WindowLoadScreen overlay label={busy} /> : null}
    </div>
  );
}
