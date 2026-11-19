import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SessionContext } from './sessionContext.js';
import { createApiClient } from '../../services/apiClient.js';
import { initializeMainSession, readStoredSessionId } from '../../services/sessionApi.js';
import { createBackendSocket, waitForSocketId } from '../socket/createSocket.js';
import { useNotifications } from '../notifications/useNotifications.js';
import { fetchSessionPolicy, patchSessionPolicy } from '../../services/configurationApi.js';
import { DEFAULT_IDLE_SETTINGS, normalizeIdleSettings, normalizeSessionPolicyResponse } from './idlePolicy.js';
import { normalizeLoadedConfiguration } from '../../features/configuration/lib/configModel.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('session');

const ALL_POLICY_FIELDS = ['idle_warning_ms', 'idle_lock_ms', 'max_idle_timeout_ms', 'lock_requires_reauth'];

// Paths whose 401 means the sign-in itself is no longer valid (same list the
// production app logs out on). Other 401s are surfaced as notices only.
const LOGOUT_ON_UNAUTHORIZED_PATHS = new Set(['/auth/me', '/auth/verify', '/init']);

// Production socket protocol for the main session: backend notices and the
// STR report receiver (str_report_register_receiver) are bound to it.
const STR_REPORT_EVENT_LINK_ANALYSIS = 'str_report_link_analysis';
const STR_REPORT_REGISTER_RECEIVER = 'str_report_register_receiver';

// Lock / unlock / logout requests must not trigger the 401 sign-out or the
// 423 lock handlers themselves (production passes the same flags).
const QUIET_AUTH_REQUEST = { suppressUnauthorizedHandler: true, suppressLockedHandler: true };
const isMissingEndpoint = (error) => [404, 405].includes(Number(error?.status));

// The /init configuration is normalised like production
// (normalizeLoadedConfiguration): secrets given as objects keep their
// password_ref, address lists are merged.
const toSessionConfiguration = (value) => (
  value && typeof value === 'object' ? normalizeLoadedConfiguration(value) : {}
);

// Owns everything "backend session" for the authenticated workspace:
// the shared apiFetch, the Socket.IO connection, the main session id and the
// session configuration returned by /init.
export function SessionProvider({ apiUrl, token, onLogout, onLocked, onIdleSettingsChange, children }) {
  const { notify } = useNotifications();
  const [socket, setSocket] = useState(null);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [mainSessionId, setMainSessionId] = useState(readStoredSessionId);
  const [configuration, setConfiguration] = useState({});
  const [sessionError, setSessionError] = useState('');
  const [isSessionReady, setIsSessionReady] = useState(false);

  // Backend session-timeout policy (production: /auth/session-policy).
  const [idleSettings, setIdleSettings] = useState(DEFAULT_IDLE_SETTINGS);
  const [idlePolicyMeta, setIdlePolicyMeta] = useState({
    source: '',
    editableFields: ALL_POLICY_FIELDS,
    authTokenSeconds: null,
    isLoading: false,
    isSaving: false,
    error: '',
  });
  const idlePatchTimerRef = useRef(null);
  const idleSettingsRef = useRef(idleSettings);
  idleSettingsRef.current = idleSettings;
  const onIdleSettingsChangeRef = useRef(onIdleSettingsChange);
  onIdleSettingsChangeRef.current = onIdleSettingsChange;

  const tokenRef = useRef(token);
  tokenRef.current = token;
  const handlersRef = useRef({ notify, onLogout, onLocked });
  handlersRef.current = { notify, onLogout, onLocked };

  const apiFetch = useMemo(() => createApiClient({
    baseUrl: apiUrl,
    getToken: () => tokenRef.current,
    onUnauthorized: (_data, meta) => {
      if (LOGOUT_ON_UNAUTHORIZED_PATHS.has(meta.path)) {
        handlersRef.current.notify({ title: 'Session expired', message: 'Your session expired. Please sign in again.', source: 'Auth', level: 'warning' });
        handlersRef.current.onLogout?.();
        return;
      }
      handlersRef.current.notify({ title: 'Sign-in required', message: 'Your sign-in could not be verified for this action.', level: 'warning' });
    },
    onForbidden: (data) => handlersRef.current.notify({
      title: 'Not allowed',
      message: data?.message || 'Your account does not have permission for this action.',
      level: 'warning',
    }),
    onLocked: () => handlersRef.current.onLocked?.(),
    onRateLimited: (data) => handlersRef.current.notify({
      title: 'Slow down',
      message: `Too many requests. Retry after ${data?.retry_after || 'a few'} seconds.`,
      level: 'warning',
    }),
    onPayloadTooLarge: () => handlersRef.current.notify({
      title: 'Upload too large',
      message: 'The request is larger than the server accepts.',
      level: 'error',
    }),
    onSecurityPolicyBlocked: (data) => handlersRef.current.notify({
      title: 'Connection blocked',
      message: data?.message || 'Connection rejected by security policy.',
      level: 'error',
    }),
  }), [apiUrl]);

  // One socket per token; re-created on sign-in changes.
  useEffect(() => {
    if (!token) return undefined;
    const nextSocket = createBackendSocket(apiUrl, token);
    const handleConnect = () => setIsSocketConnected(true);
    const handleDisconnect = () => setIsSocketConnected(false);
    const handleConnectError = (error) => {
      setIsSocketConnected(false);
      log.warn('Service socket connection failed', { message: error?.message });
    };
    nextSocket.on('connect', handleConnect);
    nextSocket.on('disconnect', handleDisconnect);
    nextSocket.on('connect_error', handleConnectError);
    setSocket(nextSocket);

    return () => {
      nextSocket.off('connect', handleConnect);
      nextSocket.off('disconnect', handleDisconnect);
      nextSocket.off('connect_error', handleConnectError);
      nextSocket.disconnect();
      setSocket(null);
      setIsSocketConnected(false);
    };
  }, [apiUrl, token]);

  // Main session: wait briefly for the socket so /init can bind it.
  useEffect(() => {
    if (!token || !socket) return undefined;
    let cancelled = false;
    setIsSessionReady(false);

    waitForSocketId(socket)
      .then((socketId) => initializeMainSession(apiFetch, { socketId }))
      .then(({ sessionId, configuration: nextConfiguration }) => {
        if (cancelled) return;
        if (sessionId) setMainSessionId(sessionId);
        setConfiguration(toSessionConfiguration(nextConfiguration));
        setSessionError(sessionId ? '' : 'Session initialization returned no session id.');
        setIsSessionReady(Boolean(sessionId));
      })
      .catch((error) => {
        if (!cancelled) setSessionError(error?.message || 'Session initialization failed.');
      });

    return () => {
      cancelled = true;
    };
  }, [apiFetch, socket, token]);

  // Main session on the socket (production registerStrReportSocketReceiver):
  // after /init and again on every reconnect.
  useEffect(() => {
    if (!socket || !mainSessionId || !isSessionReady) return undefined;
    const register = () => {
      socket.emit('notification_subscribe', { session_id: mainSessionId });
      socket.emit(STR_REPORT_REGISTER_RECEIVER, { session_id: mainSessionId, socket_id: socket.id });
    };
    if (socket.connected) register();
    socket.on('connect', register);
    // An STR report analysis is routed here. Its graph view arrives with the
    // Graph window (analysis-results-plan Phase 2); until then it is announced.
    const handleStrReport = (payload = {}) => {
      const analysisSessionId = String(payload.session_id ?? payload.analysis_session_id ?? payload.analysisSessionId ?? '').trim();
      if (!analysisSessionId) return;
      handlersRef.current.notify({
        title: 'STR Report Analysis',
        message: `Analysis session ${analysisSessionId} is ready.`,
        source: 'Socket',
        level: 'info',
      });
    };
    socket.on(STR_REPORT_EVENT_LINK_ANALYSIS, handleStrReport);
    return () => {
      socket.off('connect', register);
      socket.off(STR_REPORT_EVENT_LINK_ANALYSIS, handleStrReport);
    };
  }, [socket, mainSessionId, isSessionReady]);

  // ---- Backend session lifecycle (production App.jsx 11880-11943, 17216-17395)

  // Re-binds the existing main session after an unlock and re-applies its
  // configuration.
  const reinitializeSession = useCallback(async () => {
    const { sessionId, configuration: nextConfiguration } = await initializeMainSession(apiFetch, {
      socketId: socket?.id || null,
      requestOptions: { suppressLockedHandler: true },
    });
    if (sessionId) setMainSessionId(sessionId);
    if (nextConfiguration && Object.keys(nextConfiguration).length) setConfiguration(toSessionConfiguration(nextConfiguration));
    return sessionId;
  }, [apiFetch, socket]);

  const lockBackendSession = useCallback(() => {
    apiFetch('/auth/lock', { method: 'POST', body: { id: 'lock_session', reason: 'idle_lock' } }).catch((error) => {
      if (!isMissingEndpoint(error)) log.warn('Idle lock notification failed', { status: error?.status });
    });
  }, [apiFetch]);

  // Throws when the backend refuses the unlock (the caller signs out).
  // Returns a refreshed token when the backend issues one.
  const unlockBackendSession = useCallback(async ({ reason = 'idle_lock', quiet = false } = {}) => {
    try {
      const data = await apiFetch('/auth/unlock', { method: 'POST', body: { id: 'unlock_session', reason }, ...QUIET_AUTH_REQUEST });
      return data?.results?.token || data?.token || data?.access_token || '';
    } catch (error) {
      if (quiet || isMissingEndpoint(error)) {
        if (!isMissingEndpoint(error)) log.warn('Unlock failed', { status: error?.status });
        return '';
      }
      throw error;
    }
  }, [apiFetch]);

  const notifyBackendLogout = useCallback(async (reason = 'user_logout') => {
    try {
      await apiFetch('/auth/logout', { method: 'POST', body: { id: 'logout', reason }, ...QUIET_AUTH_REQUEST });
    } catch (error) {
      if (!isMissingEndpoint(error)) log.warn('Service logout notification failed', { status: error?.status });
    }
  }, [apiFetch]);

  const notifyIdleTimeout = useCallback(async () => {
    try {
      await apiFetch('/auth/idle-timeout', { method: 'POST', body: { id: 'idle_timeout', reason: 'max_idle_expired', cleanup: true }, ...QUIET_AUTH_REQUEST });
    } catch (error) {
      log.warn('Idle timeout notification failed', { status: error?.status });
    }
  }, [apiFetch]);

  const applyIdlePolicy = useCallback((data) => {
    const normalized = normalizeSessionPolicyResponse(data, idleSettingsRef.current);
    setIdleSettings(normalized.policy);
    onIdleSettingsChangeRef.current?.(normalized.policy);
    setIdlePolicyMeta((current) => ({
      ...current,
      source: normalized.source || current.source,
      editableFields: normalized.editableFields || current.editableFields,
      authTokenSeconds: normalized.authTokenSeconds ?? current.authTokenSeconds,
      isLoading: false,
      isSaving: false,
      error: '',
    }));
  }, []);

  const refreshIdlePolicy = useCallback(async () => {
    if (!mainSessionId || !token) return;
    setIdlePolicyMeta((current) => ({ ...current, isLoading: true, error: '' }));
    try {
      applyIdlePolicy(await fetchSessionPolicy(apiFetch, mainSessionId));
    } catch (error) {
      setIdlePolicyMeta((current) => ({ ...current, isLoading: false, error: error?.message || 'Could not refresh the Service session policy.' }));
    }
  }, [apiFetch, applyIdlePolicy, mainSessionId, token]);

  useEffect(() => {
    if (isSessionReady) refreshIdlePolicy();
  }, [isSessionReady, refreshIdlePolicy]);

  useEffect(() => () => clearTimeout(idlePatchTimerRef.current), []);

  // Applied locally at once, then PATCHed (debounced) to the backend.
  const updateIdleSettings = useCallback((next) => {
    const normalized = normalizeIdleSettings(
      typeof next === 'function' ? next(idleSettingsRef.current) : next,
      idleSettingsRef.current,
    );
    setIdleSettings(normalized);
    onIdleSettingsChangeRef.current?.(normalized);
    clearTimeout(idlePatchTimerRef.current);
    if (!mainSessionId) return;
    setIdlePolicyMeta((current) => ({ ...current, isSaving: true, error: '' }));
    idlePatchTimerRef.current = setTimeout(async () => {
      try {
        const data = await patchSessionPolicy(apiFetch, mainSessionId, normalized);
        if (data?.results?.policy) applyIdlePolicy(data);
        else setIdlePolicyMeta((current) => ({ ...current, isSaving: false }));
      } catch (error) {
        const message = error?.message || 'Could not save the Service session policy.';
        setIdlePolicyMeta((current) => ({ ...current, isSaving: false, error: message }));
        handlersRef.current.notify({ title: 'Session policy save failed', message, source: 'Auth', level: 'warning' });
        refreshIdlePolicy();
      }
    }, 450);
  }, [apiFetch, applyIdlePolicy, mainSessionId, refreshIdlePolicy]);

  const updateConfiguration = useCallback((patch) => {
    setConfiguration((current) => ({ ...current, ...(patch || {}) }));
  }, []);

  const value = useMemo(() => ({
    apiUrl,
    apiFetch,
    socket,
    isSocketConnected,
    mainSessionId,
    configuration,
    setConfiguration,
    updateConfiguration,
    sessionError,
    isSessionReady,
    idleSettings,
    idlePolicyMeta,
    updateIdleSettings,
    refreshIdlePolicy,
    reinitializeSession,
    lockBackendSession,
    unlockBackendSession,
    notifyBackendLogout,
    notifyIdleTimeout,
  }), [apiUrl, apiFetch, socket, isSocketConnected, mainSessionId, configuration, updateConfiguration, sessionError, isSessionReady, idleSettings, idlePolicyMeta, updateIdleSettings, refreshIdlePolicy, reinitializeSession, lockBackendSession, unlockBackendSession, notifyBackendLogout, notifyIdleTimeout]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
