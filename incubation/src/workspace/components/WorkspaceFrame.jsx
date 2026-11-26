import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

import WorkspaceHome from './WorkspaceHome.jsx';
import { useAuth } from '../../auth/useAuth.js';
import NetworkBackground from './NetworkBackground.jsx';
import RightWorkspace from './RightWorkspace.jsx';
import WindowManager from './WindowManager.jsx';
import WindowSwitcher from './WindowSwitcher.jsx';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { useCan } from '../../auth/useCan.js';
import { getVisibleLauncherItems, launcherItems } from './launcherItems.js';
import { closeSourceWindow } from '../../services/sourceApi.js';
import { useSession } from '../../shared/session/useSession.js';
import { disposeAllSourceRuntimes, disposeSourceRuntime } from '../../features/source/lib/sourceRuntime.js';
import { bindStreamLogSocket, disposeAllStreamLogs, disposeStreamLog, peekStreamLogLines } from '../../features/source/lib/streamLogs.js';
import { clearReportsPages } from '../../features/reports/lib/reportsPageCache.js';
import { clearEvidenceGraphs } from '../../features/reports/lib/evidenceGraphs.js';
import { clearConfigurationDrafts } from '../../features/configuration/lib/configDraft.js';
import { resetDomainChanges } from '../../features/configuration/lib/domainChanges.js';
import { clearKnownBuiltinRules } from '../../features/libraries/lib/rulesLibrary.js';
import { clearGraphStores, disposeGraphStore, getGraphStore, hasGraphStore } from '../../features/graph/lib/graphStore.js';
import { forgetGraphState } from '../../features/graph/lib/graphLinkBus.js';
import { forgetLayoutOwner } from '../../features/graph/lib/layoutClient.js';
import { bindGraphStatusSocket, clearGraphStatus, markGraphSessionClosed, markGraphSessionTerminated, retainGraphStatus, setGraphStatusNotifier } from '../../features/graph/lib/graphStatus.js';
import { isRunGraphAvailable, isRunGraphKept, runGraphMissingReason, streamingSessionIds } from '../../features/graph/lib/graphLinkFlow.js';
import { forgetActiveStreams, endAbandonedStream, endAllAbandonedStreams, getActiveStream } from '../../features/source/lib/activeStreams.js';
import { continueStreamInBackground } from '../../features/source/lib/backgroundStreams.js';
import {
  TASK_ORIGINS,
  TASK_STATUSES,
  countActiveTasks,
  finishTask,
  freezeWindowTaskLogs,
  getActiveTaskForWindow,
  getLatestTaskForWindow,
  getTask,
  holdTaskSession,
  releaseAllTaskSessions,
  releaseTaskSession,
  subscribeTasks,
  getSessionUsage,
  getTasksSnapshot,
  onTaskEnded,
  requestTaskFocus,
  resetTasks,
  sessionLimitMessage,
  taskRemark,
} from '../../features/tasks/lib/taskRegistry.js';
import { useNotifications } from '../../shared/notifications/useNotifications.js';
import CloseAnalysisDialog from './CloseAnalysisDialog.jsx';
import SaveBeforeCloseDialog from './SaveBeforeCloseDialog.jsx';
import RestoreWorkspaceDialog from './RestoreWorkspaceDialog.jsx';
import SignOutDialog from './SignOutDialog.jsx';
import { useWorkspaceCopy } from '../hooks/useWorkspaceCopy.js';
import { isRunGoing, leaveReasons, ownUnattendedGoing } from '../lib/leaveReasons.js';
import { resetSeats, unattendedWindowIds } from '../../features/tasks/lib/unattendedSeats.js';
import { loadPresentation, resetPresentation } from '../../features/graph/lib/domainPresentation.js';
import { resetQuickRun } from '../../features/quick/lib/quickRun.js';
import { rememberAwayRuns } from '../lib/awayRuns.js';
import { useAwayRuns } from '../hooks/useAwayRuns.js';
import { openSourceSession } from '../lib/openSourceSession.js';
import { isRememberingWorkspace, windowOutcome, workspaceOwnerKey } from '../lib/workspaceCopy.js';
import TaskEvidenceDialog from '../../features/tasks/components/TaskEvidenceDialog.jsx';
import { canSaveAsEvidence, saveRunAsEvidence } from '../../features/tasks/lib/saveEvidence.js';
import { WORKSPACE_CONTEXT_TABS, WORKSPACE_ORIENTATIONS, WORKSPACE_WINDOW_TYPES, getWindowLimitBlock } from '../state/workspaceTypes.js';
import { getServiceRefusalMessage } from '../../services/apiErrors.js';
import { createLogger } from '../../shared/logger.js';
import { useParentAlerts } from '../../features/alerts/hooks/useParentAlerts.js';
import { useServerTasks } from '../../features/tasks/hooks/useServerTasks.js';
import { resetPermissionCatalog } from '../../auth/permissions.js';
import { clearChartResults } from '../../features/chart/lib/chartResultCache.js';
import { resetGraphLinkBus } from '../../features/graph/lib/graphLinkBus.js';
import { resetAlerts } from '../../features/alerts/lib/alertStore.js';
import { onSignOutRequest } from '../lib/signOutRequest.js';

// Signed out / workspace gone: the next workspace reuses window ids
// (source-1, reports-4…), so nothing kept per window may survive into it:
// typed passwords, stream logs, cached report pages, evidence graphs, graph
// window stores and unsaved Configuration drafts.
const clearWorkspaceSessionData = () => {
  resetQuickRun();
  resetTasks();
  resetSeats();
  resetPresentation();
  resetPermissionCatalog();
  disposeAllSourceRuntimes();
  disposeAllStreamLogs();
  clearReportsPages();
  clearEvidenceGraphs();
  resetAlerts();
  clearConfigurationDrafts();
  resetDomainChanges();
  clearKnownBuiltinRules();
  clearGraphStores();
  clearGraphStatus();
  clearChartResults();
  resetGraphLinkBus();
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
  const workspace = useWorkspace();
  const can = useCan();
  // Production hides launcher items the user has no permission for.
  const visibleLauncherItems = useMemo(() => getVisibleLauncherItems(can), [can]);
  const { apiFetch, socket, configuration } = useSession();
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
  // Closing a Source window with a completed run nobody saved:
  // { windowId, windowTitle, taskId, saving }.
  const [pendingSave, setPendingSave] = useState(null);
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
  // STR alerts from the parent service (analysis-results-plan Phase 4): a
  // new or newly assigned alert counts on the Reports badge.
  useParentAlerts({ workspace, notify, user, onArrival: handleReportReady });
  // The Service's record of every run (H-2), live with task_updated.
  useServerTasks({ user });
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
    const source = task.quick ? 'Quick analysis' : task.background ? 'Background task' : (task.windowTitle || 'Tasks');
    if (task.status === TASK_STATUSES.COMPLETED) {
      const kept = task.background && task.origin === TASK_ORIGINS.SOURCE && !task.quick && !task.graphSaved ? ' Its session is kept for its graph: save it or release it in Tasks.' : '';
      notify({ title: `${task.title} completed`, message: `${task.input || 'The results are ready.'}${kept}`, level: 'success', source, action: view });
    } else if (task.background && task.status === TASK_STATUSES.FAILED) {
      notify({ title: `${task.title} failed`, message: task.message || task.input || 'The analysis failed.', level: 'error', source, action: view });
    } else if (task.background && task.status === TASK_STATUSES.TERMINATED) {
      notify({ title: `${task.title} stopped`, message: task.message || task.input || 'The analysis was stopped.', level: 'warning', source, action: view });
    }
  }), [notify, openTask]);
  useAwayRuns({ user, notify, openTask });
  // The active domain's shared profile mapping and formatting rules.
  const activeDomain = configuration?.active_domain || configuration?.domain || '';
  useEffect(() => {
    if (token && activeDomain && can('config:read')) loadPresentation(apiFetch, activeDomain);
    // Once per domain and sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDomain, Boolean(token)]);
  // A held run whose graph the Service now keeps: its session is free again.
  useEffect(() => subscribeTasks(() => {
    getTasksSnapshot().tasks.filter((task) => task.heldSession && isRunGraphKept(task)).forEach((task) => releaseTaskSession(task.id));
  }), []);
  const toggleRightCollapsed = useCallback(() => setIsRightCollapsed((current) => !current), []);


  useEffect(() => {
    if (!isLauncherExpanded) return undefined;

    const handleOutsidePointerDown = (event) => {
      if (launcherRef.current?.contains(event.target)) return;
      setIsLauncherExpanded(false);
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
  }, [isLauncherExpanded]);

  const collapseLauncher = () => {
    setIsLauncherExpanded(false);
  };

  const windowsRef = React.useRef(workspace.windows);
  windowsRef.current = workspace.windows;
  const { closeWindow } = workspace;

  // Requests made after the window is gone (background streams) use the
  // latest client.
  const apiFetchRef = React.useRef(apiFetch);
  apiFetchRef.current = token ? apiFetch : apiFetchRef.current;
  const latestApiFetch = useCallback((...args) => apiFetchRef.current(...args), []);

  const releaseSourceSession = useCallback((targetWindow, reason, { keepalive = false } = {}) => {
    closeSourceWindow(latestApiFetch, {
      sessionId: targetWindow.parentSessionId,
      windowId: targetWindow.backendWindowId,
      reason,
      keepalive,
    }).catch((error) => {
      log.error('Source window cleanup failed', { status: error?.status, message: error?.message });
    });
  }, [latestApiFetch]);

  const releaseSourceSessionRef = React.useRef(releaseSourceSession);
  releaseSourceSessionRef.current = releaseSourceSession;

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
  // its runtime is freed once the stream ends. Its backend session too, unless
  // the run completed: it is then held until the analyst saves or releases it,
  // so its graph can still be shown and saved (analyst decision 2026-11-24).
  const closeAndKeepRunning = useCallback((targetWindow) => {
    const windowId = targetWindow.id;
    const task = getActiveTaskForWindow(windowId);
    const detached = task && continueStreamInBackground({
      windowId,
      taskId: task.id,
      apiFetch: latestApiFetch,
      release: (ended) => {
        disposeSourceRuntime(windowId);
        disposeStreamLog(windowId);
        if (!apiFetchRef.current || !hadTokenRef.current) return;
        // Not completed, or its graph is kept by the Service (B-37): no need
        // to hold its session.
        if (ended?.status !== TASK_STATUSES.COMPLETED || ended.graphSaved) {
          releaseSourceSession(targetWindow, 'background_task_ended');
          return;
        }
        holdTaskSession(ended.id, (options) => {
          // Linked Graph windows unlink and keep what they show.
          markGraphSessionTerminated(targetWindow.sourceSessionId);
          releaseSourceSession(targetWindow, 'background_task_released', options);
        });
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
        forgetGraphState(windowId); // its Table windows say it closed
      }
      closeWindow(windowId);
      return;
    }
    const task = getActiveTaskForWindow(windowId);
    if (token && task && getActiveStream(windowId)) {
      setPendingClose({ windowId, windowTitle: targetWindow.title, taskTitle: task.title });
      return;
    }
    // A completed run nobody saved: its graph goes with the window.
    const latest = getLatestTaskForWindow(windowId);
    if (token && canSaveAsEvidence(latest, can) && isRunGraphAvailable(latest, windowsRef.current) && !isRunGraphKept(latest)) {
      setPendingSave({ windowId, windowTitle: targetWindow.title, taskId: latest.id, saving: false });
      return;
    }
    closeAndStop(targetWindow);
  }, [token, can, closeWindow, closeAndStop]);

  const closePendingSave = () => {
    const targetWindow = pendingSave && windowsRef.current.find((windowItem) => windowItem.id === pendingSave.windowId);
    setPendingSave(null);
    if (targetWindow) closeAndStop(targetWindow);
  };
  const pendingSaveTask = pendingSave ? getTask(pendingSave.taskId) : null;
  const savePending = async (values, options) => {
    const result = await saveRunAsEvidence(apiFetch, pendingSaveTask, values, options);
    if (!result.ok) return result;
    // Asked for a graph and none was kept: the window stays, so the graph
    // can still be looked at.
    if (result.graphLost) {
      setPendingSave(null);
      notify({ title: 'Saved without its graph', message: `${result.message} The Source window was left open.`, level: 'warning', source: pendingSave.windowTitle });
      return result;
    }
    notify({ title: 'Saved as evidence', message: result.message, level: 'success', source: pendingSave.windowTitle });
    closePendingSave();
    return result;
  };

  const resolvePendingClose = (choice) => {
    const pending = pendingClose;
    setPendingClose(null);
    const targetWindow = pending && windowsRef.current.find((windowItem) => windowItem.id === pending.windowId);
    if (!targetWindow || choice === 'cancel') return;
    if (choice === 'keep') closeAndKeepRunning(targetWindow);
    else closeAndStop(targetWindow);
  };

  // The workspace goes away (sign-out, idle timeout): runs are ended with
  // keepalive requests, but the one the Service gave a seat, which goes on
  // (analyst decision 2026-11-25). How they ended is told at the next sign-in.
  // Finished runs' kept sessions are released.
  const ownerRef = React.useRef('');
  // The shared auto-login account signs out without /auth/logout (it would
  // end every visitor's work, Service round 4 §2.3): this browser's own
  // Source window sessions are closed here instead.
  const { authMethod } = useAuth() || {};
  const sharedAccountRef = React.useRef(false);
  sharedAccountRef.current = authMethod === 'auto';
  ownerRef.current = workspaceOwnerKey(user);
  useEffect(() => {
    const onPageHide = (event) => {
      // Runs are left to the Service: it stops one without a seat 2 minutes
      // after its owner's last browser is gone, so a reload, or another tab,
      // keeps it (R2-19). Their sessions stay; the others are closed: ids are never reused, so
      // nothing could open them again.
      rememberAwayRuns(ownerRef.current);
      releaseAllTaskSessions({ keepalive: true });
      if (event.persisted) return;
      windowsRef.current.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.SOURCE && !getActiveStream(item.id)).forEach((item) => {
        releaseSourceSessionRef.current(item, 'page_closed', { keepalive: true });
      });
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      // Signed out: the Service ends this user's runs without a seat.
      rememberAwayRuns(ownerRef.current);
      endAllAbandonedStreams(apiFetchRef.current, { reason: 'workspace_closed', keepalive: true, except: unattendedWindowIds() }).catch(() => null);
      releaseAllTaskSessions({ keepalive: true });
      if (sharedAccountRef.current) {
        windowsRef.current.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.SOURCE && !getActiveStream(item.id)).forEach((item) => {
          releaseSourceSessionRef.current(item, 'signed_out', { keepalive: true });
        });
      }
      forgetActiveStreams();
      clearWorkspaceSessionData();
    };
  }, []);

  // Signed out without unmounting (token cleared): same clean-up.
  const hadTokenRef = React.useRef(Boolean(token));
  useEffect(() => {
    if (hadTokenRef.current && !token) {
      rememberAwayRuns(ownerRef.current);
      endAllAbandonedStreams(apiFetchRef.current, { reason: 'signed_out', keepalive: true, except: unattendedWindowIds() }).catch(() => null);
      forgetActiveStreams();
      releaseAllTaskSessions({ keepalive: true });
      clearWorkspaceSessionData();
    }
    hadTokenRef.current = Boolean(token);
  }, [token]);

  /* ── The last workspace (lib/workspaceCopy.js) ──────────────────────── */
  const { offer: lastWorkspace, answered: lastWorkspaceAnswered } = useWorkspaceCopy({ user, workspace, configuration });
  const [restoring, setRestoring] = useState(false);
  const restoreLastWorkspace = async () => {
    if (restoring || !lastWorkspace) return;
    setRestoring(true);
    const ready = [];
    const missing = [];
    let sessions = sessionUsage.available;
    for (const item of lastWorkspace.windows) {
      const permission = launcherItems.find((entry) => entry.windowType === item.type)?.permission;
      if (permission && !can(permission)) {
        missing.push('a window you have no permission for');
      } else if (item.type === WORKSPACE_WINDOW_TYPES.SOURCE) {
        if (sessions <= 0) {
          missing.push('a Source window (all analysis sessions are in use)');
          continue;
        }
        try {
          // In order: each takes a session of its own.
          const identity = await openSourceSession(apiFetch, mainSessionId, workspace.nextSourceWindowId + ready.length);
          sessions -= 1;
          ready.push({ ...item, backendWindowId: identity.windowId, parentSessionId: identity.parentSessionId, sourceSessionId: identity.sourceSessionId });
        } catch (error) {
          missing.push(`a Source window (${getServiceRefusalMessage(error) || 'its session could not be opened'})`);
        }
      } else {
        const { state, note } = windowOutcome(item, lastWorkspace);
        ready.push(item.type === WORKSPACE_WINDOW_TYPES.GRAPH && state === 'lost'
          ? { ...item, metadata: { ...item.metadata, restoredNote: note } }
          : item);
      }
    }
    workspace.restoreWindows({ ...lastWorkspace, windows: ready });
    setRestoring(false);
    lastWorkspaceAnswered();
    if (missing.length) notify({ title: 'Workspace restored in part', message: `Not restored: ${missing.join('; ')}.`, level: 'warning', source: 'Workspace' });
  };

  /* ── Leaving with work that would be lost (lib/leaveReasons.js) ─────── */
  const reasonsToStay = () => leaveReasons({
    tasks: getTasksSnapshot().tasks,
    windows: windowsRef.current,
    can,
    graphChanged: (windowId) => {
      if (!hasGraphStore(windowId)) return false;
      const { nodes, history } = getGraphStore(windowId).getSnapshot();
      const metadata = windowsRef.current.find((item) => item.id === windowId)?.metadata || {};
      return nodes > 0 && (history.canUndo || metadata.graphBlank === true);
    },
  });
  const reasonsRef = useRef(reasonsToStay);
  reasonsRef.current = reasonsToStay;
  useEffect(() => {
    // The browser asks in its own words (reload, tab closed).
    const onBeforeUnload = (event) => {
      if (!reasonsRef.current().length) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  const [signOutReasons, setSignOutReasons] = useState(null);
  const requestSignOut = () => {
    const reasons = reasonsToStay();
    if (reasons.length) setSignOutReasons(reasons);
    else onSignOut();
  };
  // Stopped while the sign-in still holds, then signed out.
  const stopRunsAndSignOut = async () => {
    setSignOutReasons(null);
    getTasksSnapshot().tasks.filter((task) => isRunGoing(task)).forEach((task) => finishTask(task.id, TASK_STATUSES.TERMINATED, { message: 'Stopped at sign-out.' }));
    await endAllAbandonedStreams(apiFetch, { reason: 'user_logout' }).catch(() => null);
    onSignOut();
  };
  // Settings → Log out takes the same flow.
  const requestSignOutRef = useRef(requestSignOut);
  requestSignOutRef.current = requestSignOut;
  useEffect(() => onSignOutRequest(() => requestSignOutRef.current()), []);

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

      setIsOpeningSource(true);
      try {
        const identity = await openSourceSession(apiFetch, mainSessionId, workspace.nextSourceWindowId);
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
              {workspace.orientation === WORKSPACE_ORIENTATIONS.FLOATING ? (
                <WindowSwitcher
                  workspace={windowWorkspace}
                  iconPaths={windowIconPaths}
                  fallbackIcon={overviewItem.path}
                  renderIcon={(path, className) => <LauncherIcon path={path} className={className} />}
                  onSwitched={collapseLauncher}
                />
              ) : null}
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
                requestSignOut();
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
              onOpenTask={openTask}
              unseenTasks={activeTaskCount}
              unseenReports={unseenBadges.reports}
              nextSourceWindowNumber={workspace.nextSourceWindowId}
              apiFetch={latestApiFetch}
              signedIn={Boolean(token && mainSessionId)}
              sessionsFull={sessionUsage.available <= 0 ? sessionLimitMessage(sessionUsage) : ''}
              sessionUsage={sessionUsage}
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
            {lastWorkspace && mainSessionId ? (
              <RestoreWorkspaceDialog copy={lastWorkspace} iconPaths={windowIconPaths} busy={restoring} onRestore={restoreLastWorkspace} onFresh={lastWorkspaceAnswered} />
            ) : null}
            {signOutReasons ? (
              <SignOutDialog
                reasons={signOutReasons}
                remembered={isRememberingWorkspace()}
                running={ownUnattendedGoing(getTasksSnapshot().tasks)}
                onStopAndSignOut={stopRunsAndSignOut}
                onSignOut={() => { setSignOutReasons(null); onSignOut(); }}
                onCancel={() => setSignOutReasons(null)}
              />
            ) : null}
            {pendingSaveTask && !pendingSave.saving ? (
              <SaveBeforeCloseDialog
                windowTitle={pendingSave.windowTitle}
                taskTitle={`${pendingSaveTask.title} #${pendingSaveTask.number}`}
                onSave={() => setPendingSave((current) => ({ ...current, saving: true }))}
                onClose={closePendingSave}
                onCancel={() => setPendingSave(null)}
              />
            ) : null}
            {pendingSaveTask && pendingSave.saving ? createPortal(
              <TaskEvidenceDialog
                initial={{ title: `${pendingSaveTask.title} #${pendingSaveTask.number}`, summary: '', includeGraph: true }}
                taskLabel={`${pendingSaveTask.title} #${pendingSaveTask.number}`}
                graphMissing={runGraphMissingReason(pendingSaveTask, workspace.windows)}
                remark={taskRemark(pendingSaveTask)}
                overScreen
                onSave={savePending}
                onCancel={() => setPendingSave(null)}
              />,
              document.body,
            ) : null}
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
