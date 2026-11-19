import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../auth/useAuth.js';
import { useIdleTimeout } from '../auth/useIdleTimeout.js';
import WorkspaceLockOverlay from '../auth/WorkspaceLockOverlay.jsx';
import { useNotifications } from '../shared/notifications/useNotifications.js';
import { useSession } from '../shared/session/useSession.js';
import { useWorkspace } from '../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../workspace/state/workspaceTypes.js';
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
  const { user, token, logout, verifyToken } = useAuth();
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
      await notifyBackendLogout(reason);
    } finally {
      setLocked(false);
      unlockFailedRef.current = false;
      setIdleResetSeq((value) => value + 1);
      loggingOutRef.current = false;
      logout();
    }
  }, [logout, notifyBackendLogout, setLocked, unlockBackendSession]);

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

  useIdleTimeout({
    enabled: Boolean(token) && idleSettings.enabled,
    warningMs: idleSettings.warningMs,
    lockMs: idleSettings.lockMs,
    timeoutMs: idleSettings.timeoutMs,
    isLocked,
    resetKey: idleResetSeq,
    onWarn: () => {
      const minutes = Math.max(1, Math.ceil((idleSettings.lockMs - idleSettings.warningMs) / 60000));
      notify({ title: 'Inactivity warning', message: `Your session will lock in about ${minutesLabel(minutes)} if it stays inactive.`, source: 'Auth', level: 'warning', durationMs: 9000 });
    },
    onLock: () => {
      if (isLockedRef.current) return;
      setLocked(true);
      lockBackendSession();
      const minutes = Math.max(1, Math.ceil((idleSettings.timeoutMs - idleSettings.lockMs) / 60000));
      notify({ title: 'Workspace locked', message: `Your workspace is preserved. It will sign out in about ${minutesLabel(minutes)} if it remains locked.`, source: 'Auth', level: 'warning', durationMs: 10000 });
    },
    onTimeout: async () => {
      await notifyIdleTimeout();
      notify({ title: 'Signed out', message: 'You were signed out after inactivity.', source: 'Auth', level: 'warning', durationMs: 8000 });
      performLogout('idle_timeout');
    },
  });

  return (
    <>
      <SourceSessionNotifications />
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
