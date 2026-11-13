import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SessionContext } from './sessionContext.js';
import { createApiClient } from '../../services/apiClient.js';
import { initializeMainSession, readStoredSessionId } from '../../services/sessionApi.js';
import { createBackendSocket, waitForSocketId } from '../socket/createSocket.js';
import { useNotifications } from '../notifications/useNotifications.js';
import { fetchSessionPolicy, patchSessionPolicy } from '../../services/configurationApi.js';
import { DEFAULT_IDLE_SETTINGS, normalizeIdleSettings, normalizeSessionPolicyResponse } from './idlePolicy.js';
import { createLogger } from '../../shared/logger.js';

const log = createLogger('session');

const ALL_POLICY_FIELDS = ['idle_warning_ms', 'idle_lock_ms', 'max_idle_timeout_ms', 'lock_requires_reauth'];

// Paths whose 401 means the sign-in itself is no longer valid (same list the
// production app logs out on). Other 401s are surfaced as notices only.
const LOGOUT_ON_UNAUTHORIZED_PATHS = new Set(['/auth/me', '/auth/verify', '/init']);

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
      log.warn('Backend socket connection failed', { message: error?.message });
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
        setConfiguration(nextConfiguration && typeof nextConfiguration === 'object' ? nextConfiguration : {});
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
      setIdlePolicyMeta((current) => ({ ...current, isLoading: false, error: error?.message || 'Could not refresh the backend session policy.' }));
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
        const message = error?.message || 'Could not save the backend session policy.';
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
  }), [apiUrl, apiFetch, socket, isSocketConnected, mainSessionId, configuration, updateConfiguration, sessionError, isSessionReady, idleSettings, idlePolicyMeta, updateIdleSettings, refreshIdlePolicy]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
