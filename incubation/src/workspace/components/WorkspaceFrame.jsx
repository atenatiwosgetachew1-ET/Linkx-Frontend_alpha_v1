import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import WorkspaceHome from './WorkspaceHome.jsx';
import NetworkBackground from './NetworkBackground.jsx';
import RightWorkspace from './RightWorkspace.jsx';
import WindowManager from './WindowManager.jsx';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { useCan } from '../../auth/useCan.js';
import { getVisibleLauncherItems, launcherItems } from './launcherItems.js';
import { closeSourceWindow, initializeSourceWindow } from '../../services/sourceApi.js';
import { useSession } from '../../shared/session/useSession.js';
import { disposeAllSourceRuntimes, disposeSourceRuntime } from '../../features/source/lib/sourceRuntime.js';
import { bindStreamLogSocket, disposeAllStreamLogs, disposeStreamLog, peekStreamLogLines } from '../../features/source/lib/streamLogs.js';
import { clearReportsPages } from '../../features/reports/lib/reportsPageCache.js';
import { clearEvidenceGraphs } from '../../features/reports/lib/evidenceGraphs.js';
import { clearConfigurationDrafts } from '../../features/configuration/lib/configDraft.js';
import { clearKnownBuiltinRules } from '../../features/libraries/lib/rulesLibrary.js';
import { clearGraphStores, disposeGraphStore } from '../../features/graph/lib/graphStore.js';
import { forgetLayoutOwner } from '../../features/graph/lib/layoutClient.js';
import { bindGraphStatusSocket, clearGraphStatus, markGraphSessionClosed, retainGraphStatus, setGraphStatusNotifier } from '../../features/graph/lib/graphStatus.js';
import { streamingSessionIds } from '../../features/graph/lib/graphLinkFlow.js';
import { endAbandonedStream, endAllAbandonedStreams, getActiveStream } from '../../features/source/lib/activeStreams.js';
import { continueStreamInBackground } from '../../features/source/lib/backgroundStreams.js';
import {
  TASK_ORIGINS,
  TASK_STATUSES,
  countActiveTasks,
  finishTask,
  freezeWindowTaskLogs,
  getActiveTaskForWindow,
  getSessionUsage,
  getTasksSnapshot,
  onTaskEnded,
  requestTaskFocus,
  resetTasks,
  sessionLimitMessage,
  subscribeTasks,
} from '../../features/tasks/lib/taskRegistry.js';
import { useNotifications } from '../../shared/notifications/useNotifications.js';
import CloseAnalysisDialog from './CloseAnalysisDialog.jsx';
import { WORKSPACE_CONTEXT_TABS, WORKSPACE_ORIENTATIONS, WORKSPACE_WINDOW_TYPES, getWindowLimitBlock } from '../state/workspaceTypes.js';
import { createLogger } from '../../shared/logger.js';

// Signed out / workspace gone: the next workspace reuses window ids
// (source-1, reports-4…), so nothing kept per window may survive into it:
// typed passwords, stream logs, cached report pages, evidence graphs, graph
// window stores and unsaved Configuration drafts.
const clearWorkspaceSessionData = () => {
  resetTasks();
  disposeAllSourceRuntimes();
  disposeAllStreamLogs();
  clearReportsPages();
  clearEvidenceGraphs();
  clearConfigurationDrafts();
  clearKnownBuiltinRules();
  clearGraphStores();
  clearGraphStatus();
};

const log = createLogger('workspace');



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

export default function WorkspaceFrame({ user, token, mainSessionId, sessionError, onSignOut, logoSrc }) {
  const displayName = user?.display_name || user?.username || user?.client_id || 'Analyst';
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || 'A';
  const launcherRef = React.useRef(null);
  const [isLauncherExpanded, setIsLauncherExpanded] = useState(false);
  const [isRightCollapsed, setIsRightCollapsed] = useState(false);
  const [sourceOpenError, setSourceOpenError] = useState('');
  const [isOpeningSource, setIsOpeningSource] = useState(false);
  const [isSidebarOverviewOpen, setIsSidebarOverviewOpen] = useState(false);
  const workspace = useWorkspace();
  const can = useCan();
  // Production hides launcher items the user has no permission for.
  const visibleLauncherItems = useMemo(() => getVisibleLauncherItems(can), [can]);
  const { apiFetch, socket } = useSession();
  // Token renewal re-creates the socket: move running stream logs and graph
  // status subscriptions onto it.
  useEffect(() => {
    bindStreamLogSocket(socket);
    bindGraphStatusSocket(socket);
  }, [socket]);
  const { notify } = useNotifications();
  const { tasks } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const activeTaskCount = useMemo(() => countActiveTasks(tasks), [tasks]);
  const openSourceCount = useMemo(
    () => workspace.windows.filter((windowItem) => windowItem.type === WORKSPACE_WINDOW_TYPES.SOURCE).length,
    [workspace.windows],
  );
  // Analysis sessions (max 3): open Source windows + background streams +
  // running quick analyses (taskRegistry.js getSessionUsage).
  // A Source window being opened (its /init request in flight) already holds
  // a session, so a quick analysis started meanwhile cannot exceed the cap.
  // Graph status subscriptions (production graphStatusSessionIds, A:11390):
  // every session a Graph window is linked to, and every streaming session
  // (so its relationships are known before a graph links to it). They follow
  // the windows and tasks, not which window body is on screen.
  useEffect(() => {
    setGraphStatusNotifier(notify);
  }, [notify]);
  const graphStatusKey = useMemo(() => {
    const sessions = streamingSessionIds(tasks);
    workspace.windows.forEach((windowItem) => {
      if (windowItem.type === WORKSPACE_WINDOW_TYPES.GRAPH && windowItem.metadata?.graphLinkSource) {
        sessions.add(String(windowItem.metadata.graphLinkSource));
      }
    });
    return [...sessions].sort().join('|');
  }, [tasks, workspace.windows]);
  const graphStatusHoldsRef = useRef(new Map());
  useEffect(() => {
    const wanted = new Set(graphStatusKey.split('|').filter(Boolean));
    const holds = graphStatusHoldsRef.current;
    holds.forEach((release, sessionId) => {
      if (wanted.has(sessionId)) return;
      release();
      holds.delete(sessionId);
    });
    wanted.forEach((sessionId) => {
      if (!holds.has(sessionId)) holds.set(sessionId, retainGraphStatus(sessionId));
    });
  }, [graphStatusKey]);
  useEffect(() => () => {
    graphStatusHoldsRef.current.forEach((release) => release());
    graphStatusHoldsRef.current.clear();
  }, []);

  const sessionUsage = useMemo(
    () => getSessionUsage(openSourceCount + (isOpeningSource ? 1 : 0), tasks),
    [openSourceCount, isOpeningSource, tasks],
  );
  const [pendingClose, setPendingClose] = useState(null); // { windowId, windowTitle, taskTitle }
  // Unseen task/report counters shared by the quick analysis panel and the
  // sidebar. They clear when the Tasks/Reports window becomes the active
  // window (opened from the sidebar, the panel, the dock or the windows list).
  const [unseenBadges, setUnseenBadges] = useState({ tasks: 0, reports: 0 });
  const activeWindowType = useMemo(
    () => workspace.windows.find((windowItem) => windowItem.id === workspace.activeWindowId)?.type || null,
    [workspace.windows, workspace.activeWindowId],
  );
  const activeWindowTypeRef = useRef(activeWindowType);
  activeWindowTypeRef.current = activeWindowType;
  useEffect(() => {
    const key = activeWindowType === WORKSPACE_WINDOW_TYPES.TASKS ? 'tasks'
      : activeWindowType === WORKSPACE_WINDOW_TYPES.REPORTS ? 'reports' : null;
    if (!key) return;
    setUnseenBadges((current) => (current[key] ? { ...current, [key]: 0 } : current));
  }, [activeWindowType]);
  const handleReportReady = useCallback(() => {
    setUnseenBadges((current) => ({
      ...current,
      reports: activeWindowTypeRef.current === WORKSPACE_WINDOW_TYPES.REPORTS ? current.reports : current.reports + 1,
    }));
  }, []);
  // The Tasks badge counts running analyses (it stays while they run).
  const launcherBadges = useMemo(() => ({ ...unseenBadges, tasks: activeTaskCount }), [unseenBadges, activeTaskCount]);
  const { openWindow } = workspace;
  const handleOpenWindow = useCallback((type, options) => openWindow(type, options), [openWindow]);
  const openTask = useCallback((taskId) => {
    if (taskId) requestTaskFocus(taskId);
    openWindow(WORKSPACE_WINDOW_TYPES.TASKS, { title: 'Tasks', contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW });
  }, [openWindow]);

  // Finished analyses are announced with a shortcut to their task. Failures
  // and stops of foreground runs are already shown in their window.
  useEffect(() => onTaskEnded((task) => {
    if (task.origin === TASK_ORIGINS.QUICK && !task.background) return;
    const view = { label: 'View task', onClick: () => openTask(task.id) };
    const source = task.background ? 'Background task' : (task.windowTitle || 'Tasks');
    if (task.status === TASK_STATUSES.COMPLETED) {
      notify({ title: `${task.title} completed`, message: task.input || 'The results are ready.', level: 'success', source, action: view });
    } else if (task.background && task.status === TASK_STATUSES.FAILED) {
      notify({ title: `${task.title} failed`, message: task.message || task.input || 'The analysis failed.', level: 'error', source, action: view });
    } else if (task.background && task.status === TASK_STATUSES.TERMINATED) {
      notify({ title: `${task.title} stopped`, message: task.message || task.input || 'The analysis was stopped.', level: 'warning', source, action: view });
    }
  }), [notify, openTask]);
  const toggleRightCollapsed = useCallback(() => setIsRightCollapsed((current) => !current), []);


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

  const windowsRef = React.useRef(workspace.windows);
  windowsRef.current = workspace.windows;
  const { closeWindow } = workspace;

  // Requests made after the window is gone (background streams) use the
  // latest client.
  const apiFetchRef = React.useRef(apiFetch);
  apiFetchRef.current = token ? apiFetch : apiFetchRef.current;
  const latestApiFetch = useCallback((...args) => apiFetchRef.current(...args), []);

  const releaseSourceSession = useCallback((targetWindow, reason) => {
    closeSourceWindow(latestApiFetch, {
      sessionId: targetWindow.parentSessionId,
      windowId: targetWindow.backendWindowId,
      reason,
    }).catch((error) => {
      log.error('Source window cleanup failed', { status: error?.status, message: error?.message });
    });
  }, [latestApiFetch]);

  // Closes the window and stops its stream, if any (production Terminate
  // request: log_stream_unplug + end_session), then the window session.
  const closeAndStop = useCallback((targetWindow) => {
    const windowId = targetWindow.id;
    const task = getActiveTaskForWindow(windowId);
    const endStream = token && getActiveStream(windowId)
      ? endAbandonedStream(apiFetch, windowId, { reason: 'user_closed_window' })
      : Promise.resolve(null);
    if (task) finishTask(task.id, TASK_STATUSES.TERMINATED, { message: 'Stopped when its Source window was closed.' });
    freezeWindowTaskLogs(windowId, peekStreamLogLines(windowId));
    disposeSourceRuntime(windowId);
    disposeStreamLog(windowId); // log_stream_unplug (production close behaviour)
    // Production: Graph windows linked to this session reset to empty.
    markGraphSessionClosed(targetWindow.sourceSessionId);
    if (token) {
      endStream.catch(() => null).then(() => releaseSourceSession(targetWindow, 'user_closed_window'));
    }
    closeWindow(windowId);
  }, [apiFetch, token, closeWindow, releaseSourceSession]);

  // Keeps the stream as a background task: the window leaves the workspace,
  // its runtime and backend session are freed once the stream ends.
  const closeAndKeepRunning = useCallback((targetWindow) => {
    const windowId = targetWindow.id;
    const task = getActiveTaskForWindow(windowId);
    const detached = task && continueStreamInBackground({
      windowId,
      taskId: task.id,
      apiFetch: latestApiFetch,
      release: () => {
        disposeSourceRuntime(windowId);
        disposeStreamLog(windowId);
        if (apiFetchRef.current && hadTokenRef.current) releaseSourceSession(targetWindow, 'background_task_ended');
      },
    });
    if (!detached) {
      closeAndStop(targetWindow);
      return;
    }
    closeWindow(windowId);
  }, [latestApiFetch, closeWindow, closeAndStop, releaseSourceSession]);

  const handleCloseWindow = useCallback((windowId) => {
    const targetWindow = windowsRef.current.find((windowItem) => windowItem.id === windowId);
    if (targetWindow?.type !== WORKSPACE_WINDOW_TYPES.SOURCE) {
      // A Graph window's data and layout requests go with it.
      if (targetWindow?.type === WORKSPACE_WINDOW_TYPES.GRAPH) {
        disposeGraphStore(windowId);
        forgetLayoutOwner(windowId);
      }
      closeWindow(windowId);
      return;
    }
    const task = getActiveTaskForWindow(windowId);
    if (token && task && getActiveStream(windowId)) {
      setPendingClose({ windowId, windowTitle: targetWindow.title, taskTitle: task.title });
      return;
    }
    closeAndStop(targetWindow);
  }, [token, closeWindow, closeAndStop]);

  const resolvePendingClose = (choice) => {
    const pending = pendingClose;
    setPendingClose(null);
    const targetWindow = pending && windowsRef.current.find((windowItem) => windowItem.id === pending.windowId);
    if (!targetWindow || choice === 'cancel') return;
    if (choice === 'keep') closeAndKeepRunning(targetWindow);
    else closeAndStop(targetWindow);
  };

  // Streams left running when the page goes away (tab closed / reloaded) or
  // the workspace unmounts (sign-out, idle timeout) are ended with keepalive
  // requests, sent while the session token is still known. Background tasks
  // included: nobody is left to receive their results.
  useEffect(() => {
    const endAll = (reason) => {
      endAllAbandonedStreams(apiFetchRef.current, { reason, keepalive: true }).catch(() => null);
    };
    const onPageHide = () => endAll('page_closed');
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      endAll('workspace_closed');
      clearWorkspaceSessionData();
    };
  }, []);

  // Signed out without unmounting (token cleared): same clean-up.
  const hadTokenRef = React.useRef(Boolean(token));
  useEffect(() => {
    if (hadTokenRef.current && !token) {
      endAllAbandonedStreams(apiFetchRef.current, { reason: 'signed_out', keepalive: true }).catch(() => null);
      clearWorkspaceSessionData();
    }
    hadTokenRef.current = Boolean(token);
  }, [token]);

  const windowWorkspace = useMemo(() => ({
    ...workspace,
    closeWindow: handleCloseWindow,
  }), [workspace, handleCloseWindow]);

  const handleLauncherAction = async (item) => {
    setSourceOpenError('');
    collapseLauncher();
    if (item.permission && !can(item.permission)) {
      notify({ title: 'Permission denied', message: `You need ${item.permission} to use ${item.label.toLowerCase()} windows.`, level: 'warning', source: 'RBAC' });
      return;
    }

    if (item.windowType === WORKSPACE_WINDOW_TYPES.SOURCE) {
      if (!mainSessionId || !token) {
        setSourceOpenError('Session is not ready yet.');
        return;
      }

      // Check the cap before asking the backend for a new source session;
      // openWindow notifies and focuses the latest Source window.
      if (getWindowLimitBlock(workspace.windows, WORKSPACE_WINDOW_TYPES.SOURCE)) {
        workspace.openWindow(item.windowType);
        return;
      }
      // Background streams and quick analyses hold sessions too.
      if (sessionUsage.available <= 0) {
        notify({ title: 'Analysis session limit reached', message: sessionLimitMessage(sessionUsage), level: 'warning', source: 'Workspace' });
        openTask(null);
        return;
      }

      const sourceWindowId = workspace.nextSourceWindowId;
      setIsOpeningSource(true);
      try {
        const identity = await initializeSourceWindow(apiFetch, {
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
        setSourceOpenError(error?.status === 403
          ? 'Not allowed to open a source window (sign-in expired or missing source:create). Refresh and try again.'
          : error?.message || 'Source window could not be initialized.');
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
      <NetworkBackground paused={activeWindowType === WORKSPACE_WINDOW_TYPES.GRAPH} />
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
              {visibleLauncherItems.map((item) => (
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
                  {item.badgeKey && launcherBadges[item.badgeKey] > 0 && (
                    <>
                      <span
                        className={'workspace_launcher_badge_dot is-item is-' + item.badgeKey}
                        role="status"
                        aria-label={`${launcherBadges[item.badgeKey]} ${item.badgeKey === 'tasks' ? 'running' : 'new'} ${item.badgeNoun}${launcherBadges[item.badgeKey] === 1 ? '' : 's'}`}
                      />
                      <span className={'workspace_launcher_count is-' + item.badgeKey} aria-hidden="true">{launcherBadges[item.badgeKey]}</span>
                    </>
                  )}
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
              onOpenWindow={handleOpenWindow}
              onReportReady={handleReportReady}
              onOpenTask={openTask}
              sessionUsage={sessionUsage}
              unseenTasks={activeTaskCount}
              unseenReports={unseenBadges.reports}
            />
            {(sessionError || sourceOpenError) && (
              <div className="workspace_session_notice" role="status">
                {sourceOpenError || sessionError}
              </div>
            )}
            <WindowManager workspace={windowWorkspace} />
            {pendingClose && (
              <CloseAnalysisDialog
                windowTitle={pendingClose.windowTitle}
                taskTitle={pendingClose.taskTitle}
                onKeep={() => resolvePendingClose('keep')}
                onStop={() => resolvePendingClose('stop')}
                onCancel={() => resolvePendingClose('cancel')}
              />
            )}
          </section>
          <RightWorkspace
            displayName={displayName}
            workspace={workspace}
            logoSrc={logoSrc}
            isRightCollapsed={isRightCollapsed}
            onToggleCollapse={toggleRightCollapsed}
          />
        </div>
      </div>
    </main>
  );
}
