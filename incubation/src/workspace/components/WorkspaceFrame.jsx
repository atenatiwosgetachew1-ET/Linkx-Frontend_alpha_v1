import React, { useEffect, useState } from 'react';

import WorkspaceHome from './WorkspaceHome.jsx';
import NetworkBackground from './NetworkBackground.jsx';
import RightWorkspace from './RightWorkspace.jsx';
import WindowManager from './WindowManager.jsx';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { closeSourceWindow, initializeSourceWindow } from '../../services/sourceApi.js';
import { WORKSPACE_CONTEXT_TABS, WORKSPACE_ORIENTATIONS, WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';



const launcherItems = [
  {
    id: 'source',
    label: 'Source',
    windowType: WORKSPACE_WINDOW_TYPES.SOURCE,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Zm4 2h8M8 12h8M8 16h5',
  },
  {
    id: 'graph',
    label: 'Graph',
    windowType: WORKSPACE_WINDOW_TYPES.GRAPH,
    contextTab: WORKSPACE_CONTEXT_TABS.INFO,
    path: 'M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm2.2-4.2 5.6-7.6M9.5 7.3l5 8.2',
  },
  {
    id: 'chart',
    label: 'Chart',
    windowType: WORKSPACE_WINDOW_TYPES.CHART,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M5 20V10m7 10V4m7 16v-7M3 20h18',
  },
  {
    id: 'reports',
    label: 'Reports',
    windowType: WORKSPACE_WINDOW_TYPES.REPORTS,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    disabled: true,
    path: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    windowType: WORKSPACE_WINDOW_TYPES.TASKS,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    id: 'libraries',
    label: 'Libraries',
    windowType: WORKSPACE_WINDOW_TYPES.LIBRARIES,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z',
  },
  {
    id: 'configuration',
    label: 'Configuration',
    windowType: WORKSPACE_WINDOW_TYPES.CONFIGURATION,
    contextTab: WORKSPACE_CONTEXT_TABS.SETTINGS,
    path: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2M12 18.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  },
  {
    id: 'settings',
    label: 'Settings',
    windowType: WORKSPACE_WINDOW_TYPES.SETTINGS,
    contextTab: WORKSPACE_CONTEXT_TABS.SETTINGS,
    path: 'M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z',
  },
];

const overviewItem = {
  id: 'overview',
  label: 'Windows',
  path: 'M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 13h6v6H4v-6Zm10 0h6v6h-6v-6Z',
};

const orientationItem = {
  id: 'orientation',
  path: 'M4 5h16v5H4V5Zm0 9h7v5H4v-5Zm11 0h5v5h-5v-5Z',
};

const signOutItem = {
  id: 'sign-out',
  label: 'Sign out',
  path: 'M10 6H6.5A2.5 2.5 0 0 0 4 8.5v7A2.5 2.5 0 0 0 6.5 18H10m4-8 4 4-4 4m4-4H9',
};

const windowIconPaths = Object.fromEntries(launcherItems.map((item) => [item.windowType, item.path]));

function LauncherIcon({ path, className = 'workspace_launcher_icon' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={path} />
    </svg>
  );
}

export default function WorkspaceFrame({ user, token, apiUrl, mainSessionId, sessionError, onSignOut, logoSrc }) {
  const displayName = user?.display_name || user?.username || user?.client_id || 'Analyst';
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || 'A';
  const launcherRef = React.useRef(null);
  const [isLauncherExpanded, setIsLauncherExpanded] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [sourceOpenError, setSourceOpenError] = useState('');
  const [isOpeningSource, setIsOpeningSource] = useState(false);
  const [isSidebarOverviewOpen, setIsSidebarOverviewOpen] = useState(false);
  const workspace = useWorkspace();


  useEffect(() => {
    if (!isLauncherExpanded) return undefined;

    const handleOutsidePointerDown = (event) => {
      if (launcherRef.current?.contains(event.target)) return;
      setIsLauncherExpanded(false);
      setIsSidebarOverviewOpen(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [isLauncherExpanded]);

  const collapseLauncher = () => {
    setIsLauncherExpanded(false);
    setIsSidebarOverviewOpen(false);
  };

  const handleCloseWindow = (windowId) => {
    const targetWindow = workspace.windows.find((windowItem) => windowItem.id === windowId);
    if (targetWindow?.type === WORKSPACE_WINDOW_TYPES.SOURCE && token) {
      closeSourceWindow(apiUrl, token, {
        sessionId: targetWindow.parentSessionId,
        windowId: targetWindow.backendWindowId,
        reason: 'user_closed_window',
      }).catch((error) => {
        console.error('Source window cleanup failed', { status: error?.status, message: error?.message });
      });
    }
    workspace.closeWindow(windowId);
  };

  const windowWorkspace = {
    ...workspace,
    closeWindow: handleCloseWindow,
  };

  const handleLauncherAction = async (item) => {
    setSourceOpenError('');
    collapseLauncher();

    if (item.windowType === WORKSPACE_WINDOW_TYPES.SOURCE) {
      if (!mainSessionId || !token) {
        setSourceOpenError('Session is not ready yet.');
        return;
      }

      const sourceWindowId = workspace.nextSourceWindowId;
      setIsOpeningSource(true);
      try {
        const identity = await initializeSourceWindow(apiUrl, token, {
          sessionId: mainSessionId,
          windowId: sourceWindowId,
        });
        workspace.openWindow(item.windowType, {
          contextTab: item.contextTab,
          title: item.label,
          backendWindowId: identity.windowId,
          parentSessionId: identity.parentSessionId,
          sourceSessionId: identity.sourceSessionId,
        });
        workspace.setContextTab(item.contextTab);
      } catch (error) {
        setSourceOpenError(error?.message || 'Source window could not be initialized.');
      } finally {
        setIsOpeningSource(false);
      }
      return;
    }

    workspace.openWindow(item.windowType, {
      contextTab: item.contextTab,
      title: item.label,
    });
    workspace.setContextTab(item.contextTab);
  };

  return (
    <main className="workspace_shell">
      <div className="workspace_background_overlay" aria-hidden="true" />
      <NetworkBackground />
      <div className={`workspace_frame${isLauncherExpanded ? ' is-launcher-expanded' : ''}`}>
        <aside ref={launcherRef} className="workspace_zone workspace_zone_left" aria-label="Workspace launcher">
          <nav className="workspace_launcher" aria-label="Workspace launcher">
            <div className="workspace_launcher_main">
              <button
                className="workspace_launcher_brand linkx_tooltip_anchor"
                type="button"
                aria-label={isLauncherExpanded ? 'Collapse launcher' : 'Expand launcher'}
                data-tooltip={isLauncherExpanded ? 'Collapse launcher' : 'Expand launcher'}
                aria-expanded={isLauncherExpanded}
                onClick={() => setIsLauncherExpanded((current) => !current)}
              >
                <img src={logoSrc} alt="Linkx logo" />
                <span className="workspace_launcher_brand_label">
                  <span>Linkx</span>
                  <small>Web analyzer</small>
                </span>
              </button>
              {launcherItems.map((item) => (
                <button
                  key={item.id}
                  className="workspace_launcher_button linkx_tooltip_anchor"
                  type="button"
                  data-tooltip={item.label}
                  aria-label={item.label}
                  disabled={Boolean(item.disabled || (item.windowType === WORKSPACE_WINDOW_TYPES.SOURCE && isOpeningSource))}
                  onClick={() => handleLauncherAction(item)}
                >
                  <LauncherIcon path={item.path} />
                  <span className="workspace_launcher_label">{item.label}</span>
                </button>
              ))}
            </div>
            <div className="workspace_launcher_bottom">
              {workspace.orientation === WORKSPACE_ORIENTATIONS.FLOATING && workspace.windows.length > 0 && (
                <div className="workspace_sidebar_overview_wrap">
                <button
                  className="workspace_launcher_button workspace_launcher_overview linkx_tooltip_anchor"
                  type="button"
                  data-tooltip="Show all windows"
                  aria-label="Show all open windows"
                  aria-expanded={isSidebarOverviewOpen}
                  onClick={() => setIsSidebarOverviewOpen((current) => !current)}
                >
                  <LauncherIcon path={overviewItem.path} />
                  <span className="workspace_launcher_label">Windows</span>
                </button>
                {isSidebarOverviewOpen && (
                  <div className="workspace_sidebar_overview_menu" role="menu" aria-label="Open windows overview">
                    {workspace.windows.map((windowItem) => (
                      <button
                        key={windowItem.id}
                        className={'workspace_sidebar_overview_item' + (workspace.activeWindowId === windowItem.id ? ' is-active' : '')}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          workspace.focusWindow(windowItem.id);
                          collapseLauncher();
                        }}
                      >
                        <LauncherIcon
                          className="workspace_sidebar_overview_icon"
                          path={windowIconPaths[windowItem.type] || overviewItem.path}
                        />
                        <span>
                          <strong>{windowItem.title}</strong>
                          <small>{windowItem.customTitle || 'Placeholder'}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                </div>
              )}
              <button
                className="workspace_launcher_button workspace_launcher_orientation linkx_tooltip_anchor"
              type="button"
              data-tooltip={workspace.orientation === WORKSPACE_ORIENTATIONS.FLOATING ? 'Switch to docked tabs' : 'Switch to floating windows'}
              aria-label={workspace.orientation === WORKSPACE_ORIENTATIONS.FLOATING ? 'Switch to docked tabs' : 'Switch to floating windows'}
              aria-pressed={workspace.orientation === WORKSPACE_ORIENTATIONS.DOCKED}
              onClick={() => {
                workspace.toggleOrientation();
                collapseLauncher();
              }}
            >
              <LauncherIcon path={orientationItem.path} />
              <span className="workspace_launcher_label">
                {workspace.orientation === WORKSPACE_ORIENTATIONS.FLOATING ? 'Dock' : 'Float'}
              </span>
              </button>
              <button
                className="workspace_launcher_button workspace_launcher_signout linkx_tooltip_anchor"
              type="button"
              data-tooltip={signOutItem.label}
              aria-label={signOutItem.label}
              onClick={() => {
                collapseLauncher();
                onSignOut();
              }}
            >
                <LauncherIcon path={signOutItem.path} />
                <span className="workspace_launcher_label">{signOutItem.label}</span>
              </button>
            </div>
          </nav>
        </aside>
        <div className={`workspace_work_area${isRightCollapsed ? ' is-right-collapsed' : ''}`}>
          <section className="workspace_canvas" aria-label="Workspace canvas">
            <div className="workspace_identity" aria-label="Current user">
              <span className="workspace_avatar" aria-hidden="true">{avatarLetter}</span>
              <span>{displayName}</span>
            </div>
            <WorkspaceHome
              openWindowsCount={workspace.windows.length}
              onOpenWindow={workspace.openWindow}
            />
            {(sessionError || sourceOpenError) && (
              <div className="workspace_session_notice" role="status">
                {sourceOpenError || sessionError}
              </div>
            )}
            {workspace.orientation === WORKSPACE_ORIENTATIONS.DOCKED && <WindowManager workspace={windowWorkspace} />}
          </section>
          <RightWorkspace
            displayName={displayName}
            workspace={workspace}
            isRightCollapsed={isRightCollapsed}
            onToggleCollapse={() => setIsRightCollapsed((current) => !current)}
          />
          {workspace.orientation === WORKSPACE_ORIENTATIONS.FLOATING && <WindowManager workspace={windowWorkspace} />}
        </div>
      </div>
    </main>
  );
}
