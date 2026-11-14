import React, { useEffect, useMemo, useState, useCallback } from 'react';

import ServiceAccountsPanel from './ServiceAccountsPanel.jsx';
import VigilancePanel from './VigilancePanel.jsx';
import { useAuth } from '../../../auth/useAuth.js';
import { useCan } from '../../../auth/useCan.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useSession } from '../../../shared/session/useSession.js';
import { useBackgroundAnimations } from '../../../utils/backgroundAnimations.js';
import { useWorkspaceActions } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { getActiveDomainKey } from '../../configuration/lib/configModel.js';
import { SESSION_STORAGE_KEY, settingsTabDescriptions, settingsTabs } from '../lib/settingsModel.js';
import { IntegrationPanel } from './panels/IntegrationPanel.jsx';
import { PreferencesPanel } from './panels/PreferencesPanel.jsx';
import { ProfilePanel } from './panels/ProfilePanel.jsx';
import { UsersPanel } from './panels/UsersPanel.jsx';

export default function SettingsWindowBody({ windowItem }) {
  const { user, token, logout } = useAuth();
  const { notify, requestConfirmation } = useNotifications();
  const { areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const workspace = useWorkspaceActions();
  const storedSettingsUi = windowItem?.metadata?.settingsUi;
  const settingsUiState = useMemo(() => storedSettingsUi || {}, [storedSettingsUi]);
  const [activeTab, setActiveTab] = useState(() => settingsUiState.activeTab || 'profile');
  const [sessionId, setSessionId] = useState('');
  const [refreshSignal, setRefreshSignal] = useState(0);
  // Production canAccess: admins pass every permission check.
  const canAccess = useCan();
  const canManageUsers = canAccess('users:manage');
  const canManageSuperusers = canAccess('superuser:manage');
  const { apiFetch, configuration, mainSessionId } = useSession();
  const activeDomain = getActiveDomainKey(configuration);
  const isCdr = activeDomain === 'cdr';
  // Reports is a single window: when it is already open, the new metadata
  // is merged into it and openSeq tells it to re-apply the tab / run window.
  const canOpenReports = canAccess('graph:create'); // production gates Reports with graph:create
  const openFindings = useCallback((detail = {}) => {
    if (!canOpenReports) {
      notify({ title: 'Permission denied', message: 'You need graph:create to use Reports.', source: 'RBAC', level: 'warning' });
      return;
    }
    workspace.openWindow(WORKSPACE_WINDOW_TYPES.REPORTS, {
      customTitle: 'Vigilance findings',
      metadata: { reportsTab: detail.tab || 'xvigilance', vigilanceRun: detail.run_id ? detail : null, openSeq: Date.now() },
    });
  }, [workspace, canOpenReports, notify]);
  // Every tab stays visible; tabs the account can't use explain why inside.
  const visibleTabs = settingsTabs;
  const activeTabMeta = visibleTabs.find((tab) => tab.id === activeTab) || visibleTabs[0] || settingsTabs[0];

  useEffect(() => {
    const storedSession = windowItem?.metadata?.sessionId || mainSessionId || localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY) || '';
    setSessionId(String(storedSession || ''));
  }, [mainSessionId, windowItem?.metadata?.sessionId]);

  const persistSettingsUi = useCallback((patch) => {
    workspace.updateWindowMetadata(windowItem.id, {
      metadata: {
        settingsUi: {
          ...settingsUiState,
          ...patch,
        },
      },
    });
  }, [settingsUiState, workspace, windowItem.id]);



  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  const handleRefresh = useCallback(() => {
    setSessionId(String(windowItem?.metadata?.sessionId || localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY) || ''));
    setRefreshSignal((current) => current + 1);
  }, [windowItem?.metadata?.sessionId]);

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case 'profile':
        return <ProfilePanel actor={user} token={token} sessionId={sessionId} roles={user?.roles || []} permissions={user?.permissions || []} activeDomain={activeDomain} />;
      case 'preferences':
        return <PreferencesPanel areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled} setBackgroundAnimationsEnabled={setBackgroundAnimationsEnabled} />;
      case 'vigilance':
        return <VigilancePanel apiFetch={apiFetch} canManage={canManageUsers} isCdr={isCdr} notify={notify} onOpenFindings={openFindings} />;
      case 'users':
        return <UsersPanel apiFetch={apiFetch} canManageUsers={canManageUsers} canManageSuperusers={canManageSuperusers} currentActor={user} onNotice={notify} requestConfirmation={requestConfirmation} refreshSignal={refreshSignal} initialUiState={settingsUiState.users || {}} onUiStateChange={(uiState) => persistSettingsUi({ activeTab, users: uiState })} />;
      case 'service_accounts':
        return <ServiceAccountsPanel apiFetch={apiFetch} canManageUsers={canManageUsers} onNotice={notify} requestConfirmation={requestConfirmation} refreshSignal={refreshSignal} isCdr={isCdr} />;
      case 'integration':
        return <IntegrationPanel />;
      default:
        return null;
    }
  }, [activeDomain, activeTab, apiFetch, areBackgroundAnimationsEnabled, canManageSuperusers, canManageUsers, isCdr, notify, openFindings, persistSettingsUi, refreshSignal, requestConfirmation, sessionId, settingsUiState, setBackgroundAnimationsEnabled, token, user]);

  return (
    <div className="workspace_window_body settings_window_body">
      <div className="settings_window_workspace">
        <header className="settings_window_choose_header">
          <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
          </svg>
          <div>
            <h2>Settings</h2>
            <p>{settingsTabDescriptions[activeTabMeta.id] || 'Manage workspace settings.'}</p>
            <dl className="settings_window_session_chip">
              <div>
                <dt>Session</dt>
                <dd>{sessionId || 'not initialized'}</dd>
              </div>
            </dl>
          </div>
        </header>
        <div className="settings_window_workflow_shell">
          {/* Same look as the Source window timeline (shared --timeline-* tokens),
              but as plain tabs: no progress meter, no pinned last item. */}
          <nav className="settings_window_timeline source_window_timeline is-tabs" aria-label="Settings tabs">
            <div className="source_window_timeline_steps">
              {visibleTabs.map((tab, index) => (
                <React.Fragment key={tab.id}>
                  {index > 0 && <span className="source_window_timeline_connector" aria-hidden="true" />}
                  <button
                    type="button"
                    className={activeTab === tab.id ? 'is-active' : 'is-inactive'}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    onClick={() => {
                      setActiveTab(tab.id);
                      persistSettingsUi({ activeTab: tab.id });
                    }}
                  >
                    <span className="source_window_timeline_marker" aria-hidden="true">
                      <i className="source_window_timeline_marker_dot" />
                    </span>
                    <strong>{tab.label}{tab.permission && !canAccess(tab.permission) ? <span aria-hidden="true"> 🔒</span> : null}</strong>
                    <small>{tab.permission && !canAccess(tab.permission) ? `Requires ${tab.permission}` : settingsTabDescriptions[tab.id]}</small>
                  </button>
                </React.Fragment>
              ))}
            </div>
          </nav>
          <div className="settings_window_surface">
            {tabContent}
          </div>
        </div>
        <footer className="settings_window_footer">
          <span>
            <svg className="window_footer_info_icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            {settingsTabDescriptions[activeTabMeta.id] || 'Manage workspace settings.'}
          </span>
          <div className="settings_window_footer_actions">
            <button type="button" className="settings_button" onClick={handleRefresh}>Refresh</button>
            <button type="button" className="settings_button is-danger" onClick={handleLogout}>Log out</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
