import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/useAuth.js';
import { useIdleTimeout } from '../auth/useIdleTimeout.js';
import WorkspaceLockOverlay from '../auth/WorkspaceLockOverlay.jsx';
import { useNotifications } from '../shared/notifications/useNotifications.js';
import { useSession } from '../shared/session/useSession.js';
import { useWorkspace } from '../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../workspace/state/workspaceTypes.js';
import { getTasks } from '../features/tasks/lib/taskRegistry.js';
import { isTaskUnattended } from '../features/tasks/lib/unattendedSeats.js';
import { loadConfiguration } from '../services/configurationApi.js';
import { noteDomainChange } from '../features/configuration/lib/domainChanges.js';
import { loadDomainRegistry, resetDomainRegistry } from '../shared/domains/domainRegistry.js';
import { formatDomainPillarLabel, getActiveDomainKey, preserveDomainRegistry } from '../features/configuration/lib/configModel.js';
import { withoutPresentation } from '../features/graph/lib/domainPresentation.js';
import { isRunGoing } from '../workspace/lib/leaveReasons.js';
import { createLogger } from '../shared/logger.js';

const log = createLogger('session');

const minutesLabel = (minutes) => `${minutes} minute${minutes === 1 ? '' : 's'}`;

// Idle warning / lock / timeout, unlock and sign-out, with the backend calls
// production makes (src/App.jsx: onLock 17351, handleUnlockWorkspace 17275,
// performLogout 17248, onTimeout 17374):
// - lock:    overlay + POST /auth/lock
// - unlock:  POST /auth/unlock (+ refreshed token), then /init on the same
//            session and its configuration; a refused unlock signs out
// - logout:  /auth/unlock first when locked (otherwise the next session is
//            born locked), then /auth/logout, then the local sign-out
// - timeout: POST /auth/idle-timeout, then logout
// `children` receives the sign-out action for the workspace menu.
export default function SessionLifecycle({ isLocked, setLocked, loginLogo, children }) {
  const { user, token, logout, verifyToken, authMethod } = useAuth();
  // The auto-login account is one account for every visitor: /auth/logout and
  // /auth/idle-timeout work on the account and would end the others' sessions
  // and runs (Service round 4 §2.3). Its token is only dropped here.
  const sharedAccount = authMethod === 'auto';
  const {
    idleSettings,
    lockBackendSession,
    unlockBackendSession,
    notifyBackendLogout,
    notifyIdleTimeout,
    reinitializeSession,
  } = useSession();
  const { notify } = useNotifications();
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [idleResetSeq, setIdleResetSeq] = useState(0);
  const isLockedRef = useRef(isLocked);
  isLockedRef.current = isLocked;
  const unlockFailedRef = useRef(false);
  const loggingOutRef = useRef(false);

  const performLogout = useCallback(async (reason = 'user_logout') => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    try {
      if (isLockedRef.current) await unlockBackendSession({ reason: 'logout_unlock', quiet: true });
      if (!sharedAccount) await notifyBackendLogout(reason);
    } finally {
      setLocked(false);
      unlockFailedRef.current = false;
      setIdleResetSeq((value) => value + 1);
      loggingOutRef.current = false;
      logout();
    }
  }, [logout, notifyBackendLogout, setLocked, sharedAccount, unlockBackendSession]);

  const handleUnlock = async () => {
    if (isUnlocking || unlockFailedRef.current) return;
    setIsUnlocking(true);
    setIdleResetSeq((value) => value + 1);
    try {
      const refreshedToken = await unlockBackendSession({ reason: 'idle_lock' });
      if (refreshedToken) await verifyToken(refreshedToken);
      try {
        await reinitializeSession();
      } catch (error) {
        log.warn('Post-unlock init failed', { status: error?.status });
      }
      setLocked(false);
      setIdleResetSeq((value) => value + 1);
      notify({ title: 'Session unlocked', message: 'Your workspace is ready.', source: 'Auth', level: 'success', durationMs: 3500 });
    } catch (error) {
      log.warn('Unlock failed; signing out', { status: error?.status });
      unlockFailedRef.current = true;
      notify({ title: 'Unlock failed', message: 'Unlock failed. Signing out for a fresh session.', source: 'Auth', level: 'warning', durationMs: 2500 });
      await performLogout('unlock_failed');
    } finally {
      setIsUnlocking(false);
    }
  };

  // Runs that end with the sign-out.
  const stopNotice = () => {
    const ending = getTasks().filter((task) => isRunGoing(task) && !isTaskUnattended(task)).length;
    return ending ? ` Signing out stops ${ending === 1 ? 'your running analysis' : `${ending} running analyses`}.` : '';
  };

  useIdleTimeout({
    enabled: Boolean(token) && idleSettings.enabled,
    warningMs: idleSettings.warningMs,
    lockMs: idleSettings.lockMs,
    timeoutMs: idleSettings.timeoutMs,
    isLocked,
    resetKey: idleResetSeq,
    onWarn: () => {
      const minutes = Math.max(1, Math.ceil((idleSettings.lockMs - idleSettings.warningMs) / 60000));
      notify({ title: 'Inactivity warning', message: `Your session will lock in about ${minutesLabel(minutes)} if it stays inactive.${stopNotice()}`, source: 'Auth', level: 'warning', durationMs: 9000 });
    },
    onLock: () => {
      if (isLockedRef.current) return;
      setLocked(true);
      lockBackendSession();
      const minutes = Math.max(1, Math.ceil((idleSettings.timeoutMs - idleSettings.lockMs) / 60000));
      notify({ title: 'Workspace locked', message: `Your workspace is preserved. It will sign out in about ${minutesLabel(minutes)} if it remains locked.${stopNotice()}`, source: 'Auth', level: 'warning', durationMs: 10000 });
    },
    onTimeout: async () => {
      // The Service leaves the session of a run with a seat alone.
      if (!sharedAccount) await notifyIdleTimeout();
      notify({ title: 'Signed out', message: 'You were signed out after inactivity.', source: 'Auth', level: 'warning', durationMs: 8000 });
      performLogout('idle_timeout');
    },
  });

  return (
    <>
      <SourceSessionNotifications />
      <DomainChangeNotices />
      {children(performLogout)}
      {isLocked && (
        <WorkspaceLockOverlay
          user={user}
          isUnlocking={isUnlocking}
          lockMinutes={Math.max(1, Math.round(idleSettings.lockMs / 60000))}
          logoutMinutes={Math.max(1, Math.round(idleSettings.timeoutMs / 60000))}
          onUnlock={handleUnlock}
          onLogout={() => performLogout('user_logout')}
          logoSrc={loginLogo}
        />
      )}
    </>
  );
}

// An administrator changed a domain's settings (socket, B-47). The open
// Domains page reads them again; in the session's own domain it is said, and
// its columns and mapping are loaded again (the Service resolves them on
// every load). Runs on their way keep what they were queued with.
const DOMAIN_CHANGES = {
  thresholds: ['thresholds', 'Runs that start from now on use them.'],
  sensitivity: ['sensitivity', 'Runs that start from now on use it.'],
  lineage: ['score lineage', 'Runs that start from now on use it.'],
  columns: ['columns', 'The next search and dataframe use them.'],
  mapping: ['column mapping', 'Dataframes made before must be made again.'],
  profile: ['domain profile', 'Runs that start from now on use it.'],
};

function DomainChangeNotices() {
  const { socket, apiFetch, mainSessionId, configuration, setConfiguration } = useSession();
  const { notify } = useNotifications();
  const latest = useRef(null);

  // The Service's list of domains (round 4): read once signed in, again when
  // a superuser creates, deactivates or activates one (`domains_changed`).
  // A Service without the route leaves the app's own list in place.
  useEffect(() => {
    if (!mainSessionId) return undefined;
    loadDomainRegistry(apiFetch);
    return () => resetDomainRegistry();
  }, [apiFetch, mainSessionId]);
  useEffect(() => {
    if (!socket) return undefined;
    const handle = () => { loadDomainRegistry(latest.current.apiFetch); };
    socket.on('domains_changed', handle);
    return () => socket.off('domains_changed', handle);
  }, [socket]);
  latest.current = { apiFetch, mainSessionId, configuration, setConfiguration, notify };
  const announced = useRef('');

  useEffect(() => {
    if (!socket) return undefined;
    const handle = async (payload = {}) => {
      const change = noteDomainChange(payload);
      const now = latest.current;
      // A display name may have changed.
      if (change?.section === 'profile') loadDomainRegistry(now.apiFetch);
      if (!change || change.domain !== getActiveDomainKey(now.configuration)) return;
      if (!change.own) {
        // A preset says it twice, under one version.
        const key = `${change.domain}|${payload.version_id ?? ''}|${['sensitivity', 'thresholds'].includes(change.section) ? 'thresholds' : change.section}`;
        if (payload.version_id == null || announced.current !== key) {
          const [what, effect] = DOMAIN_CHANGES[change.section];
          now.notify({ title: `${formatDomainPillarLabel(change.domain)} settings changed`, message: `An administrator changed the ${what}. ${effect}`, source: 'Configuration', level: 'info', durationMs: 8000 });
        }
        announced.current = key;
      }
      if (!['columns', 'mapping'].includes(change.section) || !now.mainSessionId) return;
      try {
        const result = await loadConfiguration(now.apiFetch, now.mainSessionId);
        const { setConfiguration: set, configuration: current, mainSessionId: session } = latest.current;
        // Signed out, or another domain meanwhile: not this one's any more.
        if (!result.ok || !result.returned || session !== now.mainSessionId || getActiveDomainKey(current) !== change.domain || getActiveDomainKey(result.configuration) !== change.domain) return;
        set((previous) => preserveDomainRegistry(previous, withoutPresentation(result.configuration, change.domain)));
      } catch (error) {
        log.warn('Configuration not reloaded after a domain change', { status: error?.status });
      }
    };
    socket.on('domain_config_changed', handle);
    return () => socket.off('domain_config_changed', handle);
  }, [socket]);

  return null;
}

// Backend notices for each open Source window's session (production
// notification_subscribe / notification / notification_unsubscribe,
// src/App.jsx 12262-12335).
const STR_REPORT_PREPARE_RECEIVER = 'str_report_prepare_receiver';

function SourceSessionNotifications() {
  const { socket } = useSession();
  const { windows } = useWorkspace();
  const { notify } = useNotifications();
  const sessionKey = useMemo(() => windows
    .filter((windowItem) => windowItem.type === WORKSPACE_WINDOW_TYPES.SOURCE && windowItem.sourceSessionId)
    .map((windowItem) => String(windowItem.sourceSessionId))
    .sort()
    .join('|'), [windows]);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  useEffect(() => {
    const sessionIds = sessionKey.split('|').filter(Boolean);
    if (!socket || !sessionIds.length) return undefined;
    const subscribed = new Set(sessionIds);
    const subscribe = () => sessionIds.forEach((sessionId) => socket.emit('notification_subscribe', { session_id: sessionId }));
    if (socket.connected) subscribe();
    socket.on('connect', subscribe);

    const handleNotification = (payload = {}) => {
      const code = String(payload.code || '').trim();
      if (code === STR_REPORT_PREPARE_RECEIVER) return;
      const sessionId = String(payload.session_id ?? '');
      if (!subscribed.has(sessionId)) return;
      const base = String(payload.message || payload.text || '').trim();
      notifyRef.current({
        title: code || 'Service Notice',
        message: base || (code ? `[${code}]` : 'Notification received.'),
        source: payload.source || `Session ${sessionId}`,
        level: ['info', 'success', 'warning', 'error'].includes(payload.level) ? payload.level : 'info',
        durationMs: 7000,
      });
    };
    socket.on('notification', handleNotification);
    return () => {
      if (socket.connected) sessionIds.forEach((sessionId) => socket.emit('notification_unsubscribe', { session_id: sessionId }));
      socket.off('connect', subscribe);
      socket.off('notification', handleNotification);
    };
  }, [socket, sessionKey]);

  return null;
}
