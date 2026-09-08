import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { createPortal } from 'react-dom';

import './main.css'
import { createApiClient } from './api/client.js';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import LoginPage from './auth/LoginPage.jsx';
import { useBackgroundAnimations } from "./utils/backgroundAnimations.js";
import {
  compactValidationErrors,
  sanitizeConnectionValue,
  sanitizeIdentifier,
  sanitizeKafkaTopic,
  sanitizeRelationshipName,
  sanitizePermissionList,
  sanitizeRoleList,
  sanitizeSecret,
  sanitizeText,
  stripControlChars,
  validateClientSecret,
  validateDisplayName,
  validateNewPassword,
  validateRequiredIdentifier,
  validateSchema,
} from './utils/inputSecurity.js';
//importing the icons function
import Icons from './Icons.jsx'
// importing action functions
// import ToggleMenuActions from './ToggleMenuActions.jsx'
// import NavBarActions from './NavBarActions.jsx'
// import WindowsActions from './WindowsActions.jsx'

//window.clipboardBuffer = [];
let clipboard = { nodes: [], edges: [] };
const GRAPH_LIMIT_WARNING_THRESHOLD = 300;
const GRAPH_LIMIT_HARD_MAX = 100000;
const DEFAULT_GRAPH_IFRAME_SETTINGS = ["", "", { min: 0, max: 25 }, "", "", "", false, false, false, false, "concentric", "UD", "directed", "hop_distance", ""];
const LINKX_IFRAME_CHANNEL = "linkx:iframe";
const LINKX_IFRAME_VERSION = 1;
const TRUSTED_IFRAME_MESSAGE_TYPES = new Set(["app_notification", "notification", "nodeProperties", "all_property_keys_response", "graph_search_results", "graph_render_stats", "network_components", "entity_selection", "graph_alerts", "pinned_evidence_update", "clipboard_get", "clipboard_set"]);
const SESSION_POLICY_CACHE_KEY = "linkx_session_policy_cache";
const DEFAULT_IDLE_WARNING_MS = 14 * 60 * 1000;
const DEFAULT_IDLE_LOCK_MS = 15 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const MIN_IDLE_TIMEOUT_MS = 60 * 1000;
const MAX_IDLE_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const parsePositiveMs = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
};

const clampMs = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || min)));

const normalizeIdleSettings = (value = {}, fallback = {}) => {
  const fallbackTimeout = clampMs(fallback.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS, MIN_IDLE_TIMEOUT_MS, MAX_IDLE_TIMEOUT_MS);
  const timeoutMs = clampMs(value.timeoutMs ?? fallbackTimeout, MIN_IDLE_TIMEOUT_MS, MAX_IDLE_TIMEOUT_MS);
  const fallbackLock = clampMs(fallback.lockMs ?? DEFAULT_IDLE_LOCK_MS, MIN_IDLE_TIMEOUT_MS, timeoutMs);
  const lockMs = clampMs(value.lockMs ?? fallbackLock, MIN_IDLE_TIMEOUT_MS, timeoutMs);
  const fallbackWarning = clampMs(fallback.warningMs ?? DEFAULT_IDLE_WARNING_MS, 0, Math.max(0, lockMs - 1000));
  const warningMs = clampMs(value.warningMs ?? fallbackWarning, 0, Math.max(0, lockMs - 1000));

  return {
    enabled: value.enabled !== false && timeoutMs > 0,
    warningMs,
    lockMs,
    timeoutMs,
    lockRequiresReauth: value.lockRequiresReauth !== false,
  };
};

const getDefaultIdleSettings = () => normalizeIdleSettings({
  enabled: String(import.meta.env.VITE_IDLE_TIMEOUT_ENABLED || "true").toLowerCase() !== "false",
  warningMs: parsePositiveMs(import.meta.env.VITE_IDLE_WARNING_MS, DEFAULT_IDLE_WARNING_MS),
  lockMs: parsePositiveMs(import.meta.env.VITE_IDLE_LOCK_MS, DEFAULT_IDLE_LOCK_MS),
  timeoutMs: parsePositiveMs(import.meta.env.VITE_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
  lockRequiresReauth: String(import.meta.env.VITE_IDLE_LOCK_REQUIRES_REAUTH || "true").toLowerCase() !== "false",
});

const readCachedSessionPolicy = (sessionId, fallback = null) => {
  const sessionKey = normalizeSessionId(sessionId);
  if (!sessionKey) return fallback;
  try {
    const raw = localStorage.getItem(SESSION_POLICY_CACHE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    const entry = parsed?.[sessionKey];
    if (!entry || typeof entry !== "object") return fallback;
    return {
      ...entry,
      sessionId: sessionKey,
      policy: normalizeIdleSettings(entry.policy, fallback?.policy || getDefaultIdleSettings()),
      editableFields: Array.isArray(entry.editableFields) ? entry.editableFields : [],
      authTokenSeconds: Number.isFinite(Number(entry.authTokenSeconds)) ? Number(entry.authTokenSeconds) : null,
      source: String(entry.source || "").trim(),
    };
  } catch {
    return fallback;
  }
};

const persistSessionPolicyCache = (sessionId, value) => {
  const sessionKey = normalizeSessionId(sessionId);
  if (!sessionKey || !value || typeof value !== "object") return;
  try {
    const raw = localStorage.getItem(SESSION_POLICY_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    parsed[sessionKey] = {
      ...value,
      sessionId: sessionKey,
      cachedAt: Date.now(),
    };
    localStorage.setItem(SESSION_POLICY_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // Cache failures are non-fatal. Backend policy remains authoritative.
  }
};

const normalizeSessionPolicyResponse = (data, fallbackSessionId = "") => {
  const results = data?.results && typeof data.results === "object" ? data.results : (data && typeof data === "object" ? data : {});
  const policy = results.policy && typeof results.policy === "object" ? results.policy : {};
  const normalizedPolicy = normalizeIdleSettings({
    enabled: true,
    warningMs: policy.idle_warning_ms ?? policy.idleWarningMs,
    lockMs: policy.idle_lock_ms ?? policy.idleLockMs,
    timeoutMs: policy.max_idle_timeout_ms ?? policy.maxIdleTimeoutMs,
    lockRequiresReauth: policy.lock_requires_reauth ?? policy.lockRequiresReauth,
  }, getDefaultIdleSettings());

  return {
    sessionId: normalizeSessionId(results.session_id ?? fallbackSessionId),
    policy: normalizedPolicy,
    source: String(results.source || "").trim(),
    editableFields: Array.isArray(results.editable_fields) ? results.editable_fields.map((field) => String(field || "").trim()).filter(Boolean) : [],
    authTokenSeconds: Number.isFinite(Number(policy.auth_token_seconds ?? results.auth_token_seconds)) ? Number(policy.auth_token_seconds ?? results.auth_token_seconds) : null,
  };
};

const buildSessionPolicyPatchBody = (sessionId, idleSettings) => ({
  id: "session_policy_update",
  session_id: normalizeSessionId(sessionId),
  policy: {
    idle_warning_ms: Number(idleSettings?.warningMs) || DEFAULT_IDLE_WARNING_MS,
    idle_lock_ms: Number(idleSettings?.lockMs) || DEFAULT_IDLE_LOCK_MS,
    max_idle_timeout_ms: Number(idleSettings?.timeoutMs) || DEFAULT_IDLE_TIMEOUT_MS,
    lock_requires_reauth: idleSettings?.lockRequiresReauth !== false,
  },
});

function useIdleTimeout({ enabled, warningMs, lockMs, timeoutMs, isLocked = false, resetKey = 0, onWarn, onLock, onTimeout }) {
  const warningTimerRef = useRef(null);
  const lockTimerRef = useRef(null);
  const timeoutTimerRef = useRef(null);
  const onWarnRef = useRef(onWarn);
  const onLockRef = useRef(onLock);
  const onTimeoutRef = useRef(onTimeout);
  const isLockedRef = useRef(isLocked);

  useEffect(() => {
    onWarnRef.current = onWarn;
  }, [onWarn]);

  useEffect(() => {
    onLockRef.current = onLock;
  }, [onLock]);

  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  useEffect(() => {
    isLockedRef.current = isLocked;
  }, [isLocked]);

  const clearIdleTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (lockTimerRef.current) {
      clearTimeout(lockTimerRef.current);
      lockTimerRef.current = null;
    }
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const resetIdleTimers = useCallback(() => {
    clearIdleTimers();
    if (!enabled || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;

    if (Number.isFinite(warningMs) && warningMs > 0 && warningMs < lockMs) {
      warningTimerRef.current = setTimeout(() => {
        onWarnRef.current?.();
      }, warningMs);
    }

    if (Number.isFinite(lockMs) && lockMs > 0 && lockMs <= timeoutMs) {
      lockTimerRef.current = setTimeout(() => {
        onLockRef.current?.();
      }, lockMs);
    }

    timeoutTimerRef.current = setTimeout(() => {
      onTimeoutRef.current?.();
    }, timeoutMs);
  }, [clearIdleTimers, enabled, lockMs, timeoutMs, warningMs]);

  useEffect(() => {
    if (!enabled) {
      clearIdleTimers();
      return clearIdleTimers;
    }

    const activityEvents = ["pointerdown", "mousemove", "keydown", "wheel", "scroll", "touchstart"];
    const handleActivity = () => {
      if (isLockedRef.current) return;
      resetIdleTimers();
    };
    const handleVisibilityChange = () => {
      if (isLockedRef.current) return;
      if (document.visibilityState === "visible") resetIdleTimers();
    };

    activityEvents.forEach((eventName) => {
      window.addEventListener(eventName, handleActivity, { passive: true });
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    resetIdleTimers();

    return () => {
      activityEvents.forEach((eventName) => {
        window.removeEventListener(eventName, handleActivity);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearIdleTimers();
    };
  }, [clearIdleTimers, enabled, resetIdleTimers, resetKey]);
}

const isRealSessionId = (value) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) return false;
  return !["null", "undefined", "nan"].includes(normalized.toLowerCase());
};

const normalizeSessionId = (value) => (isRealSessionId(value) ? String(value).trim() : "");

const readStoredSessionId = () => normalizeSessionId(localStorage.getItem("session"));

const CLIENT_DEV_LOGS_ENABLED = !import.meta.env.PROD || import.meta.env.VITE_ENABLE_CLIENT_LOGS === "true";

const extractMainSessionId = (data) => normalizeSessionId(
  data?.results?.session_id ??
  data?.results?.sessionId ??
  data?.results?.id ??
  data?.session_id ??
  data?.sessionId ??
  data?.configurations?.session_id ??
  data?.results
);

const extractInitConfiguration = (data) => (
  data?.results?.configuration ??
  data?.results?.configurations ??
  data?.configuration ??
  data?.configurations ??
  {}
);

const extractSourceWindowSessionId = (data, fallbackWindowId, fallbackParentSessionId) => normalizeSessionId(
  data?.results?.source_id ??
  data?.results?.session_id ??
  data?.source_id ??
  data?.session_id ??
  `${fallbackWindowId}_${fallbackParentSessionId}`
);

const shouldLogoutOnUnauthorized = (path) => ["/auth/me", "/auth/verify", "/init"].includes(String(path || "").trim());

const extractParentSessionId = (value) => {
  const normalized = normalizeSessionId(value);
  if (!normalized) return "";
  const parts = normalized.split("_");
  return parts.length > 1 ? normalizeSessionId(parts.slice(1).join("_")) : normalized;
};


const sanitizeGraphEndpointId = (value = "", { maxLength = 128 } = {}) => (
  stripControlChars(value).replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, maxLength)
);

const sanitizeGraphRelationshipValue = (value = "", { maxLength = 128 } = {}) => {
  const cleaned = stripControlChars(value).trim();
  if (cleaned === "*") return "*";
  return cleaned.replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, maxLength);
};

const getTrustedMessageOrigin = () => window.location.origin;
const getIframeElement = (frameOrRef = null) => frameOrRef?.current || frameOrRef || null;
const getIframePostMessageOrigin = (frameOrRef = null) => {
  const frameEl = getIframeElement(frameOrRef);
  const sandbox = String(frameEl?.getAttribute?.("sandbox") || "");
  return sandbox.includes("allow-same-origin") ? getTrustedMessageOrigin() : "*";
};
const getIframePathname = (frameOrRef = null) => {
  const frameEl = getIframeElement(frameOrRef);
  const rawSrc = String(frameEl?.getAttribute?.("src") || frameEl?.src || "").trim();
  if (!rawSrc) return "";
  try {
    return new URL(rawSrc, window.location.href).pathname;
  } catch (_err) {
    return "";
  }
};
const postMessageToIframe = (frameOrRef, payload) => {
  const frameEl = getIframeElement(frameOrRef);
  frameEl?.contentWindow?.postMessage(payload, getIframePostMessageOrigin(frameEl));
};
const buildIframeMessage = (action, payload = {}) => ({ channel: LINKX_IFRAME_CHANNEL, version: LINKX_IFRAME_VERSION, action, payload });
const getIframeMessageAction = (data) => data?.action || data?.type || "";
const isTrustedMessageOrigin = (event) => {
  const origin = String(event?.origin || "");
  return origin === getTrustedMessageOrigin() || origin === "null";
};
const isRegisteredIframeSource = (source, iframeRefs = {}) => Object.values(iframeRefs || {}).some((frameRef) => frameRef?.current?.contentWindow === source);


const STR_REPORT_SOCKET_EVENT_LINK_ANALYSIS = "str_report_link_analysis";
const STR_REPORT_NOTIFICATION_CODE_PREPARE_RECEIVER = "str_report_prepare_receiver";
const STR_REPORT_SOCKET_EMIT_REGISTER_RECEIVER = "str_report_register_receiver";
const PERMISSIONS = {
  CONFIG_READ: "config:read",
  CONFIG_WRITE: "config:write",
  SOURCE_CREATE: "source:create",
  SOURCE_CONNECT: "source:connect",
  SOURCE_DISCONNECT: "source:disconnect",
  GRAPH_CREATE: "graph:create",
  GRAPH_READ: "graph:read",
  GRAPH_LINK: "graph:link",
  BATCH_UPLOAD: "batch:upload",
  BATCH_QUERY: "batch:query",
  ANALYSIS_RUN: "analysis:run",
};

const getWindowActionPermission = (menuId, action) => {
  if (menuId === "upload_source_files") return PERMISSIONS.BATCH_UPLOAD;
  if (["batch_files_search_input", "batch_input_form_swap"].includes(menuId) && ["page_II", "page_III"].includes(action)) return PERMISSIONS.BATCH_QUERY;
  if (menuId === "batch_input_form_swap" && action === "page_IV") return PERMISSIONS.ANALYSIS_RUN;
  if (menuId === "batch_input_stream_terminate") return PERMISSIONS.ANALYSIS_RUN;
  if (["real_time_input_form", "batch_input_form"].includes(menuId) && action === "connect") return PERMISSIONS.SOURCE_CONNECT;
  if (["real_time_input_form", "batch_input_form"].includes(menuId) && action === "disconnect") return PERMISSIONS.SOURCE_DISCONNECT;
  if (menuId === "graph_link_form" && action === "link") return PERMISSIONS.GRAPH_LINK;
  return null;
};

const isStrReportAnalysisSession = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return false;
  return normalized.startsWith("str_report_") || /^\d+$/.test(normalized);
};

const normalizeStrReportSocketEmitList = (socketEmit) => {
  if (socketEmit == null) return [];

  const toEntry = (item) => {
    if (typeof item === "string" && item.trim()) {
      return { event: item.trim(), data: {} };
    }
    if (!item || typeof item !== "object") return null;
    const event = item.event || item.emit || item.name;
    if (!event) return null;
    const data = item.data ?? item.payload ?? {};
    return { event: String(event), data };
  };

  if (Array.isArray(socketEmit)) {
    return socketEmit.map(toEntry).filter(Boolean);
  }

  if (typeof socketEmit === "object") {
    return Object.entries(socketEmit).map(([event, data]) => ({ event: String(event), data: data ?? {} }));
  }

  return [];
};

const applyStrReportSocketEmitList = (socket, analysisSessionId, socketEmit) => {
  if (!socket || !analysisSessionId) return;
  const emitList = normalizeStrReportSocketEmitL
  ist(socketEmit);
  emitList.forEach(({ event, data }) => {
    const emitPayload = typeof data === "object" && data !== null ? { ...data } : { value: data };
    if (emitPayload.session_id == null || emitPayload.session_id === "") {
      emitPayload.session_id = analysisSessionId;
    }
    socket.emit(event, emitPayload);
  });
};

const normalizeGraphLimitRange = (value, fallbackMax = 25) => {
  const clampInt = (num, min, max) => Math.max(min, Math.min(max, Math.floor(Number(num) || 0)));

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const rawMin = value.min ?? 0;
    const rawMax = value.max ?? fallbackMax;
    const min = clampInt(rawMin, 0, GRAPH_LIMIT_HARD_MAX - 1);
    const max = clampInt(rawMax, 1, GRAPH_LIMIT_HARD_MAX);
    return { min, max: Math.max(min + 1, max) };
  }

  if (Array.isArray(value) && value.length >= 2) {
    const min = clampInt(value[0], 0, GRAPH_LIMIT_HARD_MAX - 1);
    const max = clampInt(value[1], 1, GRAPH_LIMIT_HARD_MAX);
    return { min, max: Math.max(min + 1, max) };
  }

  const numeric = clampInt(value, 1, GRAPH_LIMIT_HARD_MAX) || clampInt(fallbackMax, 1, GRAPH_LIMIT_HARD_MAX);
  return { min: 0, max: numeric };
};

const normalizeGraphIframeSettings = (value) => {
  const normalized = [...DEFAULT_GRAPH_IFRAME_SETTINGS];
  if (Array.isArray(value)) {
    for (let i = 0; i < normalized.length; i += 1) {
      if (value[i] !== undefined) normalized[i] = value[i];
    }
  } else if (value && typeof value === "object") {
    Object.keys(value).forEach((rawKey) => {
      const idx = Number(rawKey);
      if (!Number.isInteger(idx)) return;
      if (idx < 0 || idx >= normalized.length) return;
      if (value[rawKey] !== undefined) normalized[idx] = value[rawKey];
    });
  }
  normalized[2] = normalizeGraphLimitRange(normalized[2], 25);
  if (normalized[10] === "default" || !normalized[10]) {
    normalized[10] = "concentric";
  }
  return normalized;
};

const normalizeClipboardPayload = (payload) => {
  if (Array.isArray(payload)) {
    const nodes = payload.map(item => ({ ...item }));
    const edges = Array.isArray(payload.__edges)
      ? payload.__edges.map(edge => ({ ...edge }))
      : [];
    return { nodes, edges };
  }

  const nodes = Array.isArray(payload?.nodes)
    ? payload.nodes.map(item => ({ ...item }))
    : [];
  const edges = Array.isArray(payload?.edges)
    ? payload.edges.map(edge => ({ ...edge }))
    : [];

  return { nodes, edges };
};

const serializeClipboardPayload = (value) => {
  const nodes = Array.isArray(value?.nodes)
    ? value.nodes.map(item => ({ ...item }))
    : [];
  const edges = Array.isArray(value?.edges)
    ? value.edges.map(edge => ({ ...edge }))
    : [];

  // Backward-compatible shape for older iframe scripts:
  // an array clipboard with attached edge metadata.
  nodes.__edges = edges;
  return nodes;
};

const SOURCE_FLOW_STEPS = {
  CONNECT: "connect",
  SEARCH: "search",
  DATAFRAME: "dataframe",
  STREAM: "stream",
};

const SOURCE_KINDS = {
  BROKER: "broker",
  API: "api",
  STORAGE: "storage",
  UPLOAD: "upload",
};

const SOURCE_STATUSES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTING: "disconnecting",
  DISCONNECTED: "disconnected",
  FAILED: "failed",
  UPLOADED: "uploaded",
};

const TOOL_STATUSES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTING: "disconnecting",
  DISCONNECTED: "disconnected",
  FAILED: "failed",
};

const DATAFRAME_STATUSES = {
  NONE: "none",
  CREATING: "creating",
  READY: "ready",
  FAILED: "failed",
};

const STREAM_STATUSES = {
  IDLE: "idle",
  STARTING: "starting",
  RUNNING: "running",
  TERMINATING: "terminating",
  TERMINATED: "terminated",
  FAILED: "failed",
};

const sourceStatusFromResponse = (response) => {
  if (response === "Connection established!") return SOURCE_STATUSES.CONNECTED;
  if (response === "Dataset uploaded!") return SOURCE_STATUSES.UPLOADED;
  if (response === "Connecting...") return SOURCE_STATUSES.CONNECTING;
  if (response === "Disconnecting...") return SOURCE_STATUSES.DISCONNECTING;
  if (response === "Disconnected!") return SOURCE_STATUSES.DISCONNECTED;
  if (String(response || "").toLowerCase().includes("failed")) return SOURCE_STATUSES.FAILED;
  return SOURCE_STATUSES.IDLE;
};

const toolStatusFromResponse = (response) => {
  if (response === "Connected!") return TOOL_STATUSES.CONNECTED;
  if (response === "Connecting...") return TOOL_STATUSES.CONNECTING;
  if (response === "Disconnecting...") return TOOL_STATUSES.DISCONNECTING;
  if (response === "Disconnected!") return TOOL_STATUSES.DISCONNECTED;
  if (String(response || "").toLowerCase().includes("failed")) return TOOL_STATUSES.FAILED;
  return TOOL_STATUSES.IDLE;
};

const sourceStepFromSubContent = (selectedSubContent) => {
  if (selectedSubContent === "batch_input_form_pageIV") return SOURCE_FLOW_STEPS.STREAM;
  if (selectedSubContent === "batch_input_form_pageIII") return SOURCE_FLOW_STEPS.DATAFRAME;
  if (selectedSubContent === "batch_input_form_pageII") return SOURCE_FLOW_STEPS.SEARCH;
  return SOURCE_FLOW_STEPS.CONNECT;
};

const getSourceFlowState = (win = {}) => {
  const sourceKind = win.sourceKind || (win.windowResponseI === "Dataset uploaded!" ? SOURCE_KINDS.UPLOAD : win.sourceAddressType || SOURCE_KINDS.BROKER);
  const sourceStatus = win.sourceStatus || sourceStatusFromResponse(win.windowResponseI);
  const toolStatus = win.toolStatus || toolStatusFromResponse(win.formToolResponse);
  const dataframeStatus = win.dataframeStatus || (Array.isArray(win.batchFilesDataframeInfoI) && win.batchFilesDataframeInfoI.length > 0 ? DATAFRAME_STATUSES.READY : DATAFRAME_STATUSES.NONE);
  const streamStatus = win.streamStatus || (win.sourceStreamListener || win.windowResponseI === "Streaming..." ? STREAM_STATUSES.RUNNING : STREAM_STATUSES.IDLE);
  const sourceStep = win.sourceStep || sourceStepFromSubContent(win.selectedSubContent);

  return { sourceKind, sourceStatus, toolStatus, dataframeStatus, streamStatus, sourceStep };
};

const isSourceConnectedState = (flow) => flow.sourceStatus === SOURCE_STATUSES.CONNECTED;
const isSourceUploadedState = (flow) => flow.sourceStatus === SOURCE_STATUSES.UPLOADED || flow.sourceKind === SOURCE_KINDS.UPLOAD;
const isToolConnectedState = (flow) => flow.toolStatus === TOOL_STATUSES.CONNECTED;
const isSourceActiveForGraphLink = (win = {}) => {
  const flow = getSourceFlowState(win);
  return [STREAM_STATUSES.STARTING, STREAM_STATUSES.RUNNING].includes(flow.streamStatus) || win.sourceStreamListener === true;
};

const getPreviousBatchSourceStep = (flow) => {
  if (flow.sourceStep === SOURCE_FLOW_STEPS.SEARCH) return SOURCE_FLOW_STEPS.CONNECT;
  if (flow.sourceStep === SOURCE_FLOW_STEPS.DATAFRAME) {
    return flow.sourceKind === SOURCE_KINDS.STORAGE ? SOURCE_FLOW_STEPS.SEARCH : SOURCE_FLOW_STEPS.CONNECT;
  }
  if (flow.sourceStep === SOURCE_FLOW_STEPS.STREAM) return SOURCE_FLOW_STEPS.DATAFRAME;
  return null;
};

const getStatusToneStyle = (statusValue) => {
  const status = String(statusValue || "").trim();
  const normalized = status.toLowerCase();

  if (!status || status === "..." || status === "Connecting...") {
    return {
      color: "var(--status-pending-text)",
      backgroundColor: "var(--status-pending-bg)"
    };
  }

  if (status === "Streaming...") {
    return {
      color: "var(--status-info-text)",
      backgroundColor: "var(--status-info-bg)"
    };
  }

  if (status === "Connection established!" || status === "Dataset uploaded!" || status === "Connected!") {
    return {
      color: "var(--status-success-text)",
      backgroundColor: "var(--status-success-bg)"
    };
  }

  if (normalized.includes("failed") || normalized.includes("error")) {
    return {
      color: "var(--status-error-text)",
      backgroundColor: "var(--status-error-bg)"
    };
  }

  return {
    color: "var(--status-default-text)",
    backgroundColor: "var(--status-default-bg)"
  };
};

const sourceOptionTitleStyle = { color: "var(--app-text)" };
const sourceOptionBodyStyle = { color: "var(--muted-text)" };

const getToolStatusTextStyle = (statusValue) => {
  const status = String(statusValue || "").trim();
  const normalized = status.toLowerCase();

  if (!status || status === "Not connected!" || status === "Connecting...") {
    return { color: "var(--status-pending-text)" };
  }

  if (status === "Connected!") {
    return { color: "var(--status-success-text)" };
  }

  if (normalized.includes("failed") || normalized.includes("error")) {
    return { color: "var(--status-error-text)" };
  }

  return { color: "var(--status-default-text)" };
};

const broadcastClipboard = () => {
  const payload = serializeClipboardPayload(clipboard);
  for (let i = 0; i < window.frames.length; i += 1) {
    try {
      window.frames[i].postMessage(
        { type: "clipboard_data", payload },
        "*"
      );
    } catch {
      // Ignore inaccessible frames.
    }
  }
};

window.addEventListener("message", e => {
  if (!isTrustedMessageOrigin(e)) return;

  if (e.data?.type === "clipboard_get") {
    const payload = serializeClipboardPayload(clipboard);
    const targetOrigin = e.origin === "null" ? "*" : e.origin;
    e.source?.postMessage(
      { type: "clipboard_data", payload },
      targetOrigin
    );
    window.dispatchEvent(new CustomEvent("linkx_iframe_ready", { detail: { source: e.source } }));
  }

  if (e.data?.type === "clipboard_set") {
    clipboard = normalizeClipboardPayload(e.data.payload);
    broadcastClipboard();
  }
});
/** Home + zero windows: upload dropzone and quick actions over the workspace background. */
function HomeMenuOverlay({ toggleAction, canAccess = () => true, areBackgroundAnimationsEnabled = false }) {
  const [isUploadDragActive, setIsUploadDragActive] = useState(false);
  const uploadDragDepthRef = useRef(0);
  const openUploadSource = () => {
    if (canAccess(PERMISSIONS.SOURCE_CREATE)) {
      toggleAction("toggle_menu_upload_source_window");
    }
  };

  const actionItems = [
    {
      label: "New source",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1em", height: "1em", opacity: 0.9 }}><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>,
      action: "toggle_menu_new_source_window",
      permission: PERMISSIONS.SOURCE_CREATE,
    },
    {
      label: "New Graph",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1em", height: "1em", opacity: 0.9 }}><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>,
      action: "toggle_menu_new_graph_window",
      permission: PERMISSIONS.GRAPH_CREATE,
    },
    {
      label: "Reports",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1em", height: "1em", opacity: 0.9 }}><path d="M11 6h10"></path><path d="M11 12h10"></path><path d="M11 18h10"></path><polyline points="3 6 4 7 7 4"></polyline><polyline points="3 12 4 13 7 10"></polyline><polyline points="3 18 4 19 7 16"></polyline></svg>,
      action: "toggle_menu_new_report_window",
      permission: PERMISSIONS.GRAPH_CREATE,
    },
    {
      label: "Saved Graphs",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1em", height: "1em", opacity: 0.9 }}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>,
      action: "saved_graphs",
      disabled: true,
    },
    {
      label: "Settings",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1em", height: "1em", opacity: 0.9 }}><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>,
      action: "settings",
    },
    {
      label: "Configurations",
      icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ width: "1em", height: "1em", opacity: 0.9 }}><path d="M21 7.5a6 6 0 0 1-8.5 5.5L6.1 19.4a2.1 2.1 0 0 1-3-3l6.4-6.4A6 6 0 0 1 15 3l-3.1 3.1a1.2 1.2 0 0 0 0 1.7l1.3 1.3a1.2 1.2 0 0 0 1.7 0L18 6a6 6 0 0 1 3-.5Z"></path></svg>,
      action: "configurations",
      permission: PERMISSIONS.CONFIG_READ,
    },
  ];

  const handleUploadDragEnter = (event) => {
    event.preventDefault();
    uploadDragDepthRef.current += 1;
    setIsUploadDragActive(true);
  };

  const handleUploadDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isUploadDragActive) setIsUploadDragActive(true);
  };

  const handleUploadDragLeave = (event) => {
    event.preventDefault();
    uploadDragDepthRef.current = Math.max(0, uploadDragDepthRef.current - 1);

    if (uploadDragDepthRef.current === 0) {
      setIsUploadDragActive(false);
    }
  };

  const handleUploadDrop = (event) => {
    event.preventDefault();
    uploadDragDepthRef.current = 0;
    setIsUploadDragActive(false);
    openUploadSource();
  };

  return (
    <div
      className="dark_home_menu_overlay"
      data-animations-enabled={areBackgroundAnimationsEnabled ? "true" : "false"}
      role="dialog"
      aria-label="Linkx menu"
    >
      <div className="dark_home_menu_overlay__dock">
        <section
          className={`dark_home_menu_overlay__upload_card${isUploadDragActive ? " is-drag-active" : ""}`}
          aria-label="Upload files"
          onDragEnter={handleUploadDragEnter}
          onDragOver={handleUploadDragOver}
          onDragLeave={handleUploadDragLeave}
          onDrop={handleUploadDrop}
        >
          <span className="dark_home_menu_overlay__upload_icon" aria-hidden="true">
            <svg viewBox="0 0 64 64" focusable="false">
              <path
                d="M32 12v28M24 22l8-10 8 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M18 40v10h28V40M18 50h28"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <button
            type="button"
            className="dark_home_menu_overlay__upload_button"
            onClick={openUploadSource}
            disabled={!canAccess(PERMISSIONS.SOURCE_CREATE)}
          >
            Choose Files
          </button>
          <div className="dark_home_menu_overlay__upload_text">
            <span>Drag and drop here or choose files to analyze</span>
            <small>Excel | CSV | Parquet | Json</small>
            <small>Max size 50Mb</small>
          </div>
        </section>

        <nav className="dark_home_menu_overlay__quick_menu" aria-label="Main actions">
          {actionItems.filter((item) => !item.permission || canAccess(item.permission)).map((item) => (
            <button
              type="button"
              key={item.label}
              className="dark_home_menu_overlay__quick_action"
              onClick={() => !item.disabled && toggleAction(item.action)}
              disabled={item.disabled}
            >
              <span className="dark_home_menu_overlay__quick_icon" aria-hidden="true">{item.icon}</span>
              <span className="dark_home_menu_overlay__quick_label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
      <footer className="dark_home_menu_overlay__footer" aria-label="Application footer">
        <p>© Linkx Web Analyzer. All rights reserved.</p>
        <nav aria-label="Footer links">
          {["Privacy Policy", "Terms of Service", "Contact Us", "Help"].map((label) => (
            <button type="button" key={label}>{label}</button>
          ))}
        </nav>
      </footer>
    </div>
  );
}

function ToggleMenu({ onToggle, isToggleMenuOpen, toggleAction, isMaximized, windows, orientation, menuRef, themeMode, canAccess = () => true }){
  return(
  <div
    ref={menuRef}
    id='toggle_menu'
    data-menu-open={isToggleMenuOpen ? "true" : "false"}
    style={{width: isToggleMenuOpen ? '15vw' : '0vw', zIndex: isToggleMenuOpen ? '99999':'', visibility: orientation === "windows" || windows.length == 0 || isToggleMenuOpen ? 'visible':'hidden'}}>
      <div id="toggle_main_list">
        <div className="animated_logo">
          <span onClick={onToggle}>
            <i>
              <a></a>
            </i>
          </span>
          <label>Linkx | <i>Web Analyzer</i></label>
        </div>
        <div className="animated_windows_taskbar" onClick={() => toggleAction("windows_taskbar")}>
          <span>&#10070;</span>
        </div>
      </div>
      <div id="toggle_side_list">
        <div className="toggle_side_list_container">
          <div className="toogle_side_list_items" 
            style={{
              display: isToggleMenuOpen ? 'block' : 'none'}}>
              <ul>
                <div className="toogle_side_list_menu_container">  
                  {canAccess(PERMISSIONS.SOURCE_CREATE) && (
                  <li onClick={() => toggleAction("toggle_menu_new_source_window")} style={{ display: "flex", alignItems: "center", gap: "10px" }}>    
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "16px", height: "16px" }}><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
                    <span>Source window</span>
                  </li>
                  )}
                  {canAccess(PERMISSIONS.GRAPH_CREATE) && (
                  <li onClick={() => toggleAction("toggle_menu_new_graph_window")} style={{ display: "flex", alignItems: "center", gap: "10px" }}>    
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "16px", height: "16px" }}><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                    <span>Graph window</span>
                  </li>
                  )}
                  {canAccess(PERMISSIONS.GRAPH_CREATE) && (
                  <li onClick={() => toggleAction("toggle_menu_new_report_window")} style={{ display: "flex", alignItems: "center", gap: "10px" }}>    
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "16px", height: "16px" }}><path d="M11 6h10"></path><path d="M11 12h10"></path><path d="M11 18h10"></path><polyline points="3 6 4 7 7 4"></polyline><polyline points="3 12 4 13 7 10"></polyline><polyline points="3 18 4 19 7 16"></polyline></svg>
                    <span>Reports</span>
                  </li>
                  )}
                  {/*<li onClick={() => toggleAction("toggle_menu_new_chart_window")}>    
                    <i>
                      <Icons id="toggle_menu" type="chart_window" condition="True"/>
                    </i>              
                    <span>&#10011; &nbsp;Chart window</span>
                  </li>
                  <li onClick={() => toggleAction("toggle_menu_new_table_window")}>    
                    <i>
                      <Icons id="window_side_bar" type="tabular_window" condition="True"/>
                    </i>             
                    <span>&#10011; &nbsp;Tabular window</span>
                  </li>*/}
                </div>
                <div className="toogle_side_list_options_container">                    
                  <li onClick={() => toggleAction("settings")}>
                    <span>&#9881; &nbsp;Settings</span>
                  </li>
                  {canAccess(PERMISSIONS.CONFIG_READ) && (
                  <li onClick={() => toggleAction("configurations")}>    
                    {/*<i>
                      <Icons id="window_side_bar" type="tabular_window" condition="True"/>
                    </i> */}             
                    <span>&#9881; &nbsp;Configurations</span>
                  </li>
                  )}
                  <li>    
                    {/*<i>
                      <Icons id="window_side_bar" type="tabular_window" condition="True"/>
                    </i> */}             
                    <span>&#9715; &nbsp;Orientation</span>
                    <div className="toggle_btn_conatiner" onClick={() => toggleAction("toggle_menu_orientation")}>
                      <span className={`${orientation==="tabs" ? '' : 'active'}`}>Float</span><span className={`${orientation==="tabs" ? 'active' : ''}`}>Tabs</span>
                    </div>
                  </li>
                  <li>    
                    {/*<i>
                      <Icons id="window_side_bar" type="tabular_window" condition="True"/>
                    </i> */}             
                    <span>&#9732; &nbsp;Mood</span>
                    <div className="toggle_btn_conatiner" onClick={() => toggleAction("toggle_menu_mood")}>
                      <span className={themeMode === "light" ? "active" : ""}>Day</span>
                      <span className={themeMode === "dark" ? "active" : ""}>Night</span>
                    </div>
                  </li>
                </div>
              </ul>
            </div>      
        </div>
      </div>
    </div>
  );
}
function NavBar({ onNavAction, user }) {
  return (
    <nav id="nav_bar">
      <span className="nav_status_badge" style={{ cursor: "default", opacity: 0.9 }}>
        Admin (Logged in)
      </span>
      <span onClick={() => onNavAction("about")}>About</span>
    </nav>
  );
}
function Taskbar({ windows, isTaskBarOpen, activeWindowId, focusWindow, toggleAction, isCtrlHeld}) {
  const thumbnailBaseUrl = `${import.meta.env.BASE_URL}thumbnails`;
  return (
    <div id="windows_taskbar_container" style={{ display: isTaskBarOpen || isCtrlHeld ? 'block' : 'none' }} onClick={() => toggleAction("windows_taskbar")}>       
      <div className="windows_taskbar_lists">
        <div className="windows_taskbar_menu">
          {/*<span onClick={() => toggleAction("windows_taskbar")}>x</span>*/}
          <label>Task bar</label>
        </div>
        {windows.map(w => (
          <span
            key={w.id}
            style={{backgroundImage: activeWindowId === w.id ? `url(${thumbnailBaseUrl}/windows_thumbnail_active.png)` : `url(${thumbnailBaseUrl}/windows_thumbnail_passive.png)`}}
            onMouseEnter={() => focusWindow(w.id)}>
            <label>{`${w.type.charAt(0).toUpperCase()}${w.type.slice(1)} Window`}</label>
            <b>{` ${w.id}`}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
function Configurations({sessionId,actions,loadscreenState,setloadscreenState,toggleAction,configurations,isConfigurationsOpen,apiFetch,canAccess,idleSettings,idlePolicyMeta,onIdleSettingsChange}) {
  const [remote, setRemote] = useState(false);
  const [automation, setAutomation] = useState(false);
  const [parsedConfig, setParsedConfig] = useState(null);
  const [activeConfigTab, setActiveConfigTab] = useState("system");
  const [removeRuleArmed, setRemoveRuleArmed] = useState(false);
  const [selectedRuleForRemoval, setSelectedRuleForRemoval] = useState("");

  const normalizeActiveRuleValue = useCallback((value) => {
    if (Array.isArray(value)) return String(value[0] || "");
    if (typeof value === "string") return value;
    return "";
  }, []);

  const activeRuleValue = normalizeActiveRuleValue(parsedConfig?.active_rule);
  const ruleNames = Array.isArray(parsedConfig?.rule_names) ? parsedConfig.rule_names : [];
  const canRemoveRule = ruleNames.length > 0 && selectedRuleForRemoval !== "";
  const classifiedEntityEntries = normalizeClassifiedEntityEntries(
    parsedConfig?.trusted_entities ?? parsedConfig?.trusted_catalog ?? parsedConfig?.trusted_list ?? parsedConfig?.trustedList ?? parsedConfig?.active_tool_trusted_list,
    parsedConfig?.risk_entities ?? parsedConfig?.riskEntities ?? parsedConfig?.active_risk_entities,
    {
      value: parsedConfig?.classified_entities ?? parsedConfig?.classifiedEntities,
      preserveEmpty: true,
    }
  );
  const largeSearchBackend = normalizeLargeSearchBackend(parsedConfig?.large_search_backend);
  const elasticScrollLimit = normalizeElasticScrollLimit(parsedConfig?.elastic_scroll_limit);
  const idleTimeoutMinutes = Math.max(1, Math.round((idleSettings?.timeoutMs || DEFAULT_IDLE_TIMEOUT_MS) / 60000));
  const idleLockMinutes = Math.max(1, Math.round((idleSettings?.lockMs || DEFAULT_IDLE_LOCK_MS) / 60000));
  const idleWarningMinutes = Math.max(0, Math.round((idleSettings?.warningMs || DEFAULT_IDLE_WARNING_MS) / 60000));
  const editableIdleFields = Array.isArray(idlePolicyMeta?.editableFields) ? idlePolicyMeta.editableFields : [];
  const isIdlePolicyFieldEditable = (field) => editableIdleFields.length === 0 || editableIdleFields.includes(field);

  const updateIdleMinutes = (key, value) => {
    const minMinutes = key === "warningMs" ? 0 : 1;
    const minutes = Math.max(minMinutes, Math.min(1440, Number.parseInt(value, 10) || 0));
    onIdleSettingsChange?.((previous) => normalizeIdleSettings({
      ...previous,
      [key]: minutes * 60 * 1000,
    }, getDefaultIdleSettings()));
  };

  useEffect(() => {
    if (configurations) {
      // configurations may be a {value: string} object or already parsed
      let cfg = parseConfigurationValue(configurations);
      setParsedConfig(cfg);      
      setRemote(cfg.remote === "true" || cfg.remote === true);
      setAutomation(cfg.automation === "true" || cfg.automation === true);
      setloadscreenState(false);
    }
  }, [configurations]);

  useEffect(() => {
    const nextRule = activeRuleValue || (ruleNames[0] || "");
    setSelectedRuleForRemoval(nextRule);
    setRemoveRuleArmed(false);
  }, [activeRuleValue, ruleNames]);

  useEffect(() => {
    if (!removeRuleArmed) return;
    const timeoutId = setTimeout(() => setRemoveRuleArmed(false), 6000);
    return () => clearTimeout(timeoutId);
  }, [removeRuleArmed]);

  const handleActiveRuleChange = (event) => {
    const nextRule = sanitizeText(event.target.value, { maxLength: 120 });
    setSelectedRuleForRemoval(nextRule);
    setRemoveRuleArmed(false);
    actions("change", { name: event.target.name, value: nextRule });
  };

  const handleRemoveRule = () => {
    if (!canRemoveRule) {
      alert("Select a rule before removing.");
      return;
    }
    if (!removeRuleArmed) {
      setRemoveRuleArmed(true);
      return;
    }
    setRemoveRuleArmed(false);
    actions("remove", { rule: selectedRuleForRemoval });
  };

  const updateClassifiedEntities = (nextEntries) => {
    actions("change", {
      name: "classified_entities",
      value: normalizeClassifiedEntityEntries(null, null, { value: nextEntries, preserveEmpty: true }),
    });
  };

  const handleClassifiedEntityAdd = () => {
    updateClassifiedEntities([
      ...classifiedEntityEntries,
      { key: "", value: "", category: "Trusted" },
    ]);
  };

  const handleClassifiedEntityChange = (index, field, value) => {
    const nextEntries = classifiedEntityEntries.map((entry, entryIndex) => (
      entryIndex === index
        ? {
            ...entry,
            [field]: field === "category"
              ? (["Risk", "PEP", "Sanction"].includes(String(value)) ? String(value) : "Trusted")
              : sanitizeText(value, { maxLength: field === "key" ? 160 : 500 }),
          }
        : entry
    ));
    updateClassifiedEntities(nextEntries);
  };

  const handleClassifiedEntityRemove = (index) => {
    updateClassifiedEntities(classifiedEntityEntries.filter((_, entryIndex) => entryIndex !== index));
  };

  return (
    <div
      id="configurations_container"
      style={{ display: isConfigurationsOpen ? "block" : "none" }}
    >
      <div className="configurations_options_container">
        <div className="configurations_options_container_bar">
          <span onClick={() => toggleAction("configurations")}>x</span>
          <label>Configurations</label>
        </div>

        <div className="configurations_options">
          <div
            id="configurations_loadscreen"
            className="windows_loadscreen"
            style={{ display: loadscreenState ? "block" : "none" }}
          >
            <Loadscreen loadingText="Loading" />
          </div>

          <div className="configurations_tabs">
            <button type="button" className={activeConfigTab === "system" ? "active" : ""} onClick={() => setActiveConfigTab("system")}>System</button>
            <button type="button" className={activeConfigTab === "connections" ? "active" : ""} onClick={() => setActiveConfigTab("connections")}>Connections</button>
            <button type="button" className={activeConfigTab === "tools" ? "active" : ""} onClick={() => setActiveConfigTab("tools")}>Tools</button>
            <button type="button" className={activeConfigTab === "rules" ? "active" : ""} onClick={() => setActiveConfigTab("rules")}>Rules</button>
            <button type="button" className={activeConfigTab === "activity" ? "active" : ""} onClick={() => setActiveConfigTab("activity")}>Activity Log</button>
          </div>

          <form
            id="configurations_form"
            className="configurations_tab_form"
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              actions("save", formData);
            }}
          >
            <ActivityAuditPanel apiFetch={apiFetch} canAccess={canAccess} isActive={activeConfigTab === "activity"} />

            {/* ───────── Left Panel ───────── */}
            <div className="configurations_options_panel" style={{ display: activeConfigTab === "connections" || activeConfigTab === "system" ? "block" : "none" }}>
              {/* Broker Configuration */}
              <fieldset style={{ display: activeConfigTab === "connections" ? "block" : "none" }}>
                <legend>Broker configuration</legend>

                <label>IP address</label>
                <select
                  id="config_kafka_addresses"
                  name="active_kafka_adress"
                  value={parsedConfig?.active_kafka_adress || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                >
                  <option disabled>Custom</option>
                  {parsedConfig?.kafka_addresses?.map((addr, idx) => (
                    <option key={idx} value={addr}>{addr}</option>
                  ))}
                </select>

                <input
                  type="text"
                  name="kafka_custom_address"
                  className="input_text"
                  placeholder="Kafka / API address"
                  value={parsedConfig?.kafka_custom_address || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

                <label>Topics</label>
                <select
                  name="active_kafka_topic"
                  value={parsedConfig?.active_kafka_topic || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                >
                  <option disabled>Custom</option>
                  {parsedConfig?.kafka_topics?.map((topic, idx) => (
                    <option key={idx} value={topic}>{topic}</option>
                  ))}
                </select>

                <input
                  type="text"
                  name="kafka_custom_topic"
                  className="input_text"
                  placeholder="Kafka topic"
                  value={parsedConfig?.kafka_custom_topic || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />
              </fieldset>

              {/* Storage Configuration */}
              <fieldset style={{ display: activeConfigTab === "connections" ? "block" : "none" }}>
                <legend>Storage configuration</legend>

                <label>IP address</label>
                <select
                  name="active_storage_address"
                  value={parsedConfig?.active_storage_address || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                >
                  <option disabled>Custom</option>
                  {parsedConfig?.storage_addresses?.map((addr, idx) => (
                    <option key={idx} value={addr}>{addr}</option>
                  ))}
                </select>

                <input
                  type="text"
                  name="storage_custom_address"
                  className="input_text"
                  placeholder="HDFS address"
                  value={parsedConfig?.storage_custom_address || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

                <label>Ports</label>
                <table>
                  <tbody>
                    <tr>
                      <td>
                        Hadoop RPC
                        <input
                          type="text"
                          className="subinput"
                          name="hadoop_rcp_port"
                          placeholder="Hadoop port"
                          value={parsedConfig?.hadoop_rcp_port || ""}
                          onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                        />
                      </td>
                      <td>
                        Hadoop Web
                        <input
                          type="text"
                          className="subinput"
                          name="hadoop_web_port"
                          placeholder="UI port"
                          value={parsedConfig?.hadoop_web_port || ""}
                          onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td>
                        Spark port
                        <input
                          type="text"
                          className="subinput"
                          name="spark_port"
                          placeholder="Spark port"
                          value={parsedConfig?.spark_port || ""}
                          onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                        />
                      </td>
                      <td>
                        Hive port
                        <input
                          type="text"
                          className="subinput"
                          name="hive_port"
                          placeholder="Hive port"
                          value={parsedConfig?.hive_port || ""}
                          onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                        />
                      </td>
                    </tr>
                    <tr>
                      <td>
                        API port
                        <input
                          type="text"
                          className="subinput"
                          name="api_port"
                          placeholder="API port"
                          value={parsedConfig?.api_port || ""}
                          onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="config_endpoint_grid">
                  <div className="config_endpoint_field config_endpoint_field--wide">
                    <label>API search Endpoint</label>
                    <input
                      type="text"
                      name="search_api_endpoint"
                      className="input_text"
                      placeholder="API search Endpoint"
                      value={parsedConfig?.search_api_endpoint || ""}
                      onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                    />
                  </div>

                  <div className="config_endpoint_field">
                    <label>Elasticsearch fuzzy search endpoint</label>
                    <input
                      type="text"
                      name="search_api_endpoint_es_fuzzy"
                      className="input_text"
                      placeholder="Elasticsearch fuzzy endpoint"
                      value={parsedConfig?.search_api_endpoint_es_fuzzy || ""}
                      onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                    />
                  </div>

                  <div className="config_endpoint_field">
                    <label>Elasticsearch strict search endpoint</label>
                    <input
                      type="text"
                      name="search_api_endpoint_es_strict"
                      className="input_text"
                      placeholder="Elasticsearch strict endpoint"
                      value={parsedConfig?.search_api_endpoint_es_strict || ""}
                      onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                    />
                  </div>

                  <div className="config_endpoint_field">
                    <label>Hive fuzzy search endpoint</label>
                    <input
                      type="text"
                      name="search_api_endpoint_hive_fuzzy"
                      className="input_text"
                      placeholder="Hive fuzzy endpoint"
                      value={parsedConfig?.search_api_endpoint_hive_fuzzy || ""}
                      onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                    />
                  </div>

                  <div className="config_endpoint_field">
                    <label>Hive strict search endpoint</label>
                    <input
                      type="text"
                      name="search_api_endpoint_hive_strict"
                      className="input_text"
                      placeholder="Hive strict endpoint"
                      value={parsedConfig?.search_api_endpoint_hive_strict || ""}
                      onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                    />
                  </div>
                </div>

                <label>Large search retrieval</label>
                <select
                  name="large_search_backend"
                  className="input_text"
                  value={largeSearchBackend}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                >
                  <option value="hive">Hive/Spark query</option>
                  <option value="elastic_scroll">Elasticsearch scroll</option>
                </select>

                <label>Elasticsearch scroll limit</label>
                <input
                  type="number"
                  min="1"
                  step="1000"
                  name="elastic_scroll_limit"
                  className="input_text"
                  value={elasticScrollLimit}
                  disabled={largeSearchBackend !== "elastic_scroll"}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />
                <label className="idle_timeout_hint">Used by the backend when large fuzzy search results are converted into a dataframe.</label>

                <label>Database</label>
                <select
                  name="active_storage_database"
                  value={parsedConfig?.active_storage_database || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                >
                  <option disabled>Custom</option>
                  {parsedConfig?.storage_databases?.map((db, idx) => (
                    <option key={idx} value={db}>{db}</option>
                  ))}
                </select>

                <input
                  type="text"
                  name="storage_database_custom"
                  className="input_text"
                  placeholder="Database name"
                  value={parsedConfig?.storage_database_custom || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

                <label>Storage path</label>
                <textarea
                  name="storage_path"
                  className="input_textarea"
                  placeholder="Storage base path"
                  value={parsedConfig?.storage_path || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

                <label>Tables (Separate with comma)</label>
                <textarea
                  name="storage_tables"
                  className="input_textarea"
                  placeholder="Tables lists (Separated with comma)"
                  value={Array.isArray(parsedConfig?.storage_tables) ? parsedConfig.storage_tables.join(", ") : ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

              </fieldset>

              {/* Notes */}
              <fieldset style={{ display: activeConfigTab === "system" ? "block" : "none" }}>
                <legend>Note</legend>
                <label>* Any modifications apply only to next instances.</label>
                <label>* Removing a rule will delete it permanently.</label>
                <label>* Saving is required to add new rules.</label>
                <label>* Remember to backup.</label>
              </fieldset>
            </div>

            {/* ───────── Right Panel ───────── */}
            <div className="configurations_options_panel" style={{ display: activeConfigTab !== "connections" ? "block" : "none" }}>
              {/* Tool Configuration */}
              <fieldset style={{ display: activeConfigTab === "tools" ? "block" : "none" }}>
                <legend>Tool configuration</legend>

                <label>Tool</label>
                <select
                  name="active_tool"
                  className="input_text"
                  value={parsedConfig?.active_tool || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                >
                  <option disabled>Custom</option>
                  {parsedConfig?.tools?.map((tool, idx) => (
                    <option key={idx} value={tool}>{tool}</option>
                  ))}
                </select>

                <input
                  type="text"
                  name="active_tool_url"
                  className="input_text"
                  placeholder="Url address"
                  value={parsedConfig?.active_tool_url || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

                <label>Ports</label>
                <table>
                  <tbody>
                    <tr>
                      <td>
                        Protocol Port
                        <input
                          type="text"
                          className="subinput"
                          name="tool_protocol_port"
                          placeholder="Tool port"
                          value={parsedConfig?.tool_protocol_port || ""}
                          onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                        />
                      </td>
                      <td>
                        Web UI Port
                        <input
                          type="text"
                          className="subinput"
                          name="tool_web_port"
                          placeholder="UI port"
                          value={parsedConfig?.tool_web_port || ""}
                          onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                        />
                      </td>
                    </tr>
                  </tbody>
                </table>

                <label>Credentials</label>
                <label>Username and Password</label>
                <input
                  type="text"
                  name="active_tool_username"
                  className="input_text"
                  placeholder="Username"
                  value={parsedConfig?.active_tool_username || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  name="active_tool_password"
                  className="input_text"
                  placeholder="Leave masked value unchanged to keep current password"
                  value={parsedConfig?.active_tool_password || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

                <label>Database</label>
                <select
                  name="active_tool_database"
                  className="input_text"
                  value={parsedConfig?.active_tool_database || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                >
                  <option disabled>Custom</option>
                  {parsedConfig?.active_tool_database && (
                    <option value={parsedConfig.active_tool_database}>{parsedConfig.active_tool_database}</option>
                  )}
                </select>

                <input
                  type="text"
                  name="custom_tool_database"
                  className="input_text"
                  placeholder="Database name"
                  value={parsedConfig?.custom_tool_database || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

                <label>Tables (Separate with comma)</label>
                <textarea
                  name="active_tool_tables"
                  className="input_textarea"
                  placeholder="Tables lists (Separated with comma)"
                  value={Array.isArray(parsedConfig?.active_tool_tables) ? parsedConfig.active_tool_tables.join(", ") : ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

              </fieldset>

              {/* Analysis Rules */}
              <fieldset style={{ display: activeConfigTab === "rules" ? "block" : "none" }}>
                <legend>Analysis Rules</legend>
                <label>Active rule</label>
                <select
                  name="active_rule"
                  className="input_text"
                  value={activeRuleValue}
                  onChange={handleActiveRuleChange}
                >
                  {ruleNames.map((rule, idx) => (
                    <option key={idx} value={rule}>{rule}</option>
                  ))}
                </select>

                <input
                  type="button"
                  className="critical_btns"
                  value={removeRuleArmed ? "Confirm Remove" : "Remove"}
                  disabled={!canRemoveRule}
                  onClick={handleRemoveRule}
                />
                <label>
                  {removeRuleArmed
                    ? `Click "Confirm Remove" to remove "${selectedRuleForRemoval}".`
                    : `Loaded rules: ${ruleNames.length}`}
                </label>

                <label>Upload rules (JSON)</label>
                <input
                  id="rule_to_upload"
                  type="file"
                  className="input_file"
                  accept=".json"
                  name="rule_file"
                />

                <input
                  type="text"
                  name="rule_name"
                  className="input_text"
                  placeholder="Rule name"
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

                <label>
                  Get latest sample <a href="/linkxDS2026/temp_rules/Linkx_Rules_Template.zip" download> Template</a>
                </label>
              </fieldset>

              <fieldset style={{ display: activeConfigTab === "rules" ? "block" : "none" }}>
                <legend>Classified Entities</legend>
                <table className="config_classified_entities_table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Key</th>
                      <th>Value</th>
                      <th>Category</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {classifiedEntityEntries.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="config_trusted_list_empty">No classified-entity entries yet.</td>
                      </tr>
                    ) : classifiedEntityEntries.map((entry, index) => (
                      <tr key={"classified-entity-" + index}>
                        <td className="config_trusted_list_index">{index + 1}</td>
                        <td>
                          <input
                            type="text"
                            className="subinput config_trusted_list_input"
                            value={entry.key || ""}
                            onChange={(e) => handleClassifiedEntityChange(index, "key", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="text"
                            className="subinput config_trusted_list_input"
                            value={entry.value || ""}
                            onChange={(e) => handleClassifiedEntityChange(index, "value", e.target.value)}
                          />
                        </td>
                        <td>
                          <select
                            className="config_classified_entities_select"
                            value={entry.category || "Trusted"}
                            onChange={(e) => handleClassifiedEntityChange(index, "category", e.target.value)}
                          >
                            <option value="Trusted">Trusted</option>
                            <option value="Risk">Risk</option>
                            <option value="PEP">PEP</option>
                            <option value="Sanction">Sanction</option>
                          </select>
                        </td>
                        <td className="config_trusted_list_actions">
                          <button
                            type="button"
                            className="critical_btns config_trusted_list_remove"
                            onClick={() => handleClassifiedEntityRemove(index)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <button type="button" className="action_btns config_trusted_list_add" onClick={handleClassifiedEntityAdd}>
                  Add row
                </button>
              </fieldset>


              <fieldset style={{ display: activeConfigTab === "system" ? "block" : "none" }}>
                <legend>Session timeout policy</legend>
                <label className="sublabel">Backend source: {idlePolicyMeta?.source || "session"}</label>
                <div className="idle_timeout_grid">
                  <label>Warn after
                    <input
                      type="number"
                      min="0"
                      max="1439"
                      value={idleWarningMinutes}
                      onChange={(event) => updateIdleMinutes("warningMs", event.target.value)}
                      disabled={!isIdlePolicyFieldEditable("idle_warning_ms") || idlePolicyMeta?.isLoading || idlePolicyMeta?.isSaving}
                    />
                  </label>
                  <label>Lock after
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={idleLockMinutes}
                      onChange={(event) => updateIdleMinutes("lockMs", event.target.value)}
                      disabled={!isIdlePolicyFieldEditable("idle_lock_ms") || idlePolicyMeta?.isLoading || idlePolicyMeta?.isSaving}
                    />
                  </label>
                  <label>Logout after
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={idleTimeoutMinutes}
                      onChange={(event) => updateIdleMinutes("timeoutMs", event.target.value)}
                      disabled={!isIdlePolicyFieldEditable("max_idle_timeout_ms") || idlePolicyMeta?.isLoading || idlePolicyMeta?.isSaving}
                    />
                  </label>
                </div>
                <label className="settings_inline_check">
                  <input
                    type="checkbox"
                    checked={idleSettings?.lockRequiresReauth !== false}
                    onChange={(event) => onIdleSettingsChange?.((previous) => normalizeIdleSettings({
                      ...previous,
                      lockRequiresReauth: event.target.checked,
                    }, getDefaultIdleSettings()))}
                    disabled={!isIdlePolicyFieldEditable("lock_requires_reauth") || idlePolicyMeta?.isLoading || idlePolicyMeta?.isSaving}
                  />
                  Require re-auth after lock
                </label>
                <label className="idle_timeout_hint">Policy is loaded from the backend session and saved back through the session policy endpoint.</label>
                {Number.isFinite(idlePolicyMeta?.authTokenSeconds) && (
                  <label className="idle_timeout_hint">Auth token lifetime: {Math.max(1, Math.round(idlePolicyMeta.authTokenSeconds / 60))} minute(s).</label>
                )}
                {idlePolicyMeta?.isLoading && <label className="idle_timeout_hint">Refreshing session policy...</label>}
                {idlePolicyMeta?.isSaving && <label className="idle_timeout_hint">Saving session policy...</label>}
                {idlePolicyMeta?.error && <label className="idle_timeout_hint">{idlePolicyMeta.error}</label>}
              </fieldset>

              {/* Miscellaneous */}
              <fieldset style={{ display: activeConfigTab === "system" ? "block" : "none" }}>
                <legend>Miscellaneous</legend>
                <input
                  type="checkbox"
                  id="Automated_across_service"
                  className="input_checkbox"
                  name="automation"
                  checked={!!parsedConfig?.automation}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.checked })}
                />
                <label htmlFor="Automated_across_service" className="sublabel">Automate across services</label>

                <input
                  type="checkbox"
                  id="remote_requests"
                  className="input_checkbox"
                  name="remote"
                  checked={!!parsedConfig?.remote}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.checked })}
                />
                <label htmlFor="remote_requests" className="sublabel">Remote requests</label>

                <input
                  type="checkbox"
                  id="auto_fill_fields"
                  className="input_checkbox"
                  name="auto_fill_fields"
                  checked={isConfigAutoFillEnabled(parsedConfig)}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.checked })}
                />
                <label htmlFor="auto_fill_fields" className="sublabel">Auto fill fields</label>
              </fieldset>
            </div>
          </form>
          <div className="configurations_actions_bar" style={{ display: activeConfigTab === "activity" ? "none" : "flex" }}>
            <button className="action_btns" type="button" onClick={() => actions("load_default")} title="Reset">⟳ Reset</button>
            <a
              className="action_btns"
              href={`/linkxDS2026/temp_config/${sessionId}_temp_config.JSON`}
              download
              title="Download"
            >⭳ Export</a>
            <button
              className="action_btns"
              type="button"
              onClick={() => {
                const form = document.getElementById("configurations_form");
                if (!form) return;
                actions("save", new FormData(form));
              }}
              title="Save Configurations"
            >🖫 Save</button>
            <input
              type="file"
              id="import_config_file"
              name="import_config_file"
              style={{ display: "none" }}
              onChange={() => actions("upload")}
              accept=".json"
            />
            <button
              className="action_btns"
              type="button"
              onClick={() => document.getElementById("import_config_file").click()}
              title="Upload Configuration file"
            >&#128448; Import</button>
          </div>
        </div>
      </div>
    </div>
  );
}
const formatAuditDate = (value) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
};

const isSuccessResponse = (data) => {
  const message = String(data?.message || "").trim().toLowerCase();
  return message === "success" || message === "success!";
};

const JOB_POLL_DEFAULT_INTERVAL_MS = 1000;
const JOB_POLL_DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
const GRAPH_STATUS_REFRESH_INTERVAL_MS = 5000;
const UPLOAD_ALLOWED_EXTENSIONS = [".csv", ".json", ".parquet", ".xlsx"];
const MAX_UPLOAD_FILE_COUNT = Number(import.meta.env.VITE_MAX_UPLOAD_FILE_COUNT || 25);
const MAX_UPLOAD_BYTES = Number(import.meta.env.VITE_MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const MAX_UPLOAD_TOTAL_BYTES = Number(import.meta.env.VITE_MAX_UPLOAD_TOTAL_BYTES || 50 * 1024 * 1024);
const WINDOW_CAPS = {
  source: { soft: 2, hard: 3, label: "source windows" },
  graph: { soft: 3, hard: 5, label: "graph windows" },
  chart: { soft: 3, hard: 5, label: "chart windows" },
};
const JOB_SUCCESS_STATUSES = new Set(["succeeded", "success", "finished", "completed", "done"]);
const JOB_PENDING_STATUSES = new Set(["queued", "pending", "running", "started", "processing", "in_progress"]);
const JOB_CANCEL_STATUSES = new Set(["cancel_requested", "cancellation_requested", "cancelled", "canceled"]);
const JOB_FAILURE_STATUSES = new Set(["failed", "failure", "error", ...JOB_CANCEL_STATUSES]);

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const getQueuedJobId = (data) => (
  data?.results?.job_id ??
  data?.results?.jobId ??
  data?.results?.job?.job_id ??
  data?.results?.job?.jobId ??
  data?.job_id ??
  data?.jobId ??
  data?.result?.job_id ??
  data?.result?.jobId ??
  null
);

const getQueuedPollPath = (data) => {
  const pollUrl = data?.results?.poll_url ?? data?.results?.pollUrl ?? data?.poll_url ?? data?.pollUrl ?? null;
  if (pollUrl) return String(pollUrl);
  const jobId = getQueuedJobId(data);
  return jobId ? "/jobs/" + encodeURIComponent(jobId) : null;
};

const getJobStatus = (job) => String(
  job?.results?.status ??
  job?.status ??
  job?.result?.status ??
  job?.graph?.status ??
  ""
).trim().toLowerCase();

const getJobResult = (job) => (
  job?.results?.result ??
  job?.result ??
  job?.results ??
  job
);

const getJobErrorMessage = (job, fallback = "Job failed") => {
  const result = getJobResult(job);
  return result?.message ??
    result?.error ??
    job?.results?.error_message ??
    job?.results?.message ??
    job?.results?.error ??
    job?.message ??
    job?.error ??
    fallback;
};


const getStreamStartErrorMessage = (errorOrData, fallback = "The streaming request could not be completed.") => {
  if (!errorOrData) return fallback;

  const directMessage =
    errorOrData?.data?.message ??
    errorOrData?.data?.error ??
    errorOrData?.jobResponse?.message ??
    errorOrData?.jobResponse?.error ??
    errorOrData?.jobResult?.message ??
    errorOrData?.jobResult?.error ??
    errorOrData?.message ??
    errorOrData?.error;

  const normalized = String(directMessage || "").trim();
  if (!normalized || normalized.toLowerCase() === "failed to fetch") {
    return fallback;
  }
  return normalized;
};

const getApiProblemPayload = (input) => {
  if (input?.data && typeof input.data === "object") return input.data;
  if (input?.jobResponse && typeof input.jobResponse === "object") return input.jobResponse;
  if (input && typeof input === "object") return input;
  return {};
};

const getApiProblemStatus = (input) => {
  const payload = getApiProblemPayload(input);
  const status = Number(input?.status ?? payload?.__httpStatus ?? 0);
  return Number.isFinite(status) ? status : 0;
};

const getApiProblemMessage = (input) => {
  const payload = getApiProblemPayload(input);
  return String(payload?.message ?? payload?.error ?? input?.message ?? "").trim();
};

const getSharedApiErrorMessage = (input, fallback = "Something went wrong. Please try again.") => {
  const status = getApiProblemStatus(input);
  const message = getApiProblemMessage(input).toLowerCase();
  if (status === 401 || message === "unauthorized") return "Your session expired. Please sign in again.";
  if (status === 403 || message === "forbidden") return "You do not have access to do that.";
  if (status === 413 || message === "payload_too_large") return "The request was too large. Reduce file size or payload size and try again.";
  if (status === 500 && message === "internal_server_error") return fallback;
  return fallback;
};

const sanitizeBackendUserMessage = (message, fallback = "Operation failed.") => {
  const normalized = String(message || "").trim();
  if (!normalized) return fallback;

  if (/tool_credentials/i.test(normalized)) {
    return "Neo4j connection details are missing for this session.";
  }
  if (/password_ref/i.test(normalized)) {
    return "Please enter the Neo4j password again.";
  }
  if (/(session_id|source_id|invalid_fields|validation_error|internal_server_error|payload_too_large|not_found)/i.test(normalized)) {
    return fallback;
  }
  if (/^failed!$/i.test(normalized)) {
    return fallback;
  }

  return normalized;
};

const getConfigurationErrorMessage = (input, fallback = "Could not save configuration. Try again.") => {
  const payload = getApiProblemPayload(input);
  const status = getApiProblemStatus(input);
  const message = String(payload?.message || "").trim().toLowerCase();
  const detail = String(payload?.detail || "").trim();
  const field = String(payload?.field || "").trim();
  const resultsText = typeof payload?.results === "string" ? payload.results.trim() : "";
  if (status === 400 && message === "validation_error" && detail === "json_object_required") return "Configuration payload must be an object.";
  if (status === 400 && message === "validation_error" && field === "trusted_entities") return "Trusted entities are invalid.";
  if (status === 400 && message === "validation_error" && field === "risk_entities") return "Risk entities are invalid.";
  if (message === "failed!" && String(payload?.error || "") === "rule_upload_failed") return "Rule upload failed.";
  if (status === 404 && resultsText) return resultsText;
  if (status === 500 && message === "failed!" && String(payload?.error || "") === "configuration_load_failed") return "Could not load configuration. Try again.";
  return getSharedApiErrorMessage(input, fallback);
};

const getConnectToolErrorMessage = (input, fallback = "Could not connect to Neo4j. Check the connection details and try again.") => {
  const payload = getApiProblemPayload(input);
  const status = getApiProblemStatus(input);
  const message = String(payload?.message || "").trim();
  const detail = String(payload?.detail || "").trim();
  if (status === 400 && message === "validation_error") {
    if (detail === "json_body_required") return "Request body missing.";
    if (detail === "json_object_required") return "Connection payload must be an object.";
    if (detail === "session_id_and_source_id_must_match_for_connect_to_tool") return "Session mismatch. Refresh and try again.";
    if (detail === "Neo4j password is masked but no password_ref is available") return "Please enter the Neo4j password again.";
    if (detail === "missing_required_connection_fields") return "Please complete the required connection fields.";
  }
  if (String(payload?.status || "").toLowerCase() === "error" && detail === "neo4j_credential_persistence_failed") return "Connected check passed, but the session could not save the connection. Try again.";
  if (String(payload?.status || "").toLowerCase() === "error" && message === "Not connected!") return fallback;
  return getSharedApiErrorMessage(input, fallback);
};

const getConnectSourceErrorMessage = (input, fallback = "Connection failed!") => {
  const payload = getApiProblemPayload(input);
  const candidates = [
    payload?.message,
    payload?.detail,
    payload?.error,
    payload?.results?.message,
    payload?.results?.detail,
    payload?.results?.error,
    typeof payload?.results === "string" ? payload.results : "",
    input?.message,
    input?.error,
    typeof input === "string" ? input : "",
  ];
  const directMessage = candidates.map((value) => String(value || "").trim()).find(Boolean);
  if (!directMessage || /^failed!$/i.test(directMessage)) return fallback;
  return directMessage;
};

const getStreamingErrorMessage = (input, fallback = "The streaming request failed. Please check the backend response and try again.") => {
  const payload = getApiProblemPayload(input);
  const message = String(payload?.message || input?.message || "").trim();
  const detail = String(payload?.detail || "").trim();
  const resultsText = typeof payload?.results === "string" ? payload.results.trim() : "";
  if (message === "Missing action_id or session_id") return "Streaming request is missing required session state.";
  if (message === "Invalid stream value") return "Streaming settings were incomplete.";
  if (message === "neo4j_not_connected_for_session") return detail ? "Neo4j is not connected for this session. " + detail : "Neo4j is not connected for this session.";
  if (message === "failed!" && resultsText) return resultsText;
  if (String(payload?.error || "").startsWith("Invalid action:")) return "Unsupported action.";
  return getSharedApiErrorMessage(input, fallback);
};

const getGraphFetchErrorMessage = (input, fallback = "Graph fetch failed. Please retry.") => {
  const payload = getApiProblemPayload(input);
  const status = getApiProblemStatus(input);
  const message = String(payload?.message || input?.message || "").trim();
  const detail = String(payload?.detail || "").trim();
  if (status === 400 && message === "validation_error" && detail === "source_id_or_session_window_required") return "Select a graph session first.";
  if (status === 403 || message === "forbidden") return "You do not have access to this graph.";
  if (status === 500 && message === "failed!" && String(payload?.error || "") === "graph_fetch_failed") return "Graph fetch failed. Please retry.";
  if (message === "failed!") return fallback;
  return getSharedApiErrorMessage(input, fallback);
};

const getJobFailureMessage = (input, fallback = "Operation failed.") => {
  const payload = getApiProblemPayload(input);
  const status = getApiProblemStatus(input);
  const jobId = getQueuedJobId(payload) || getQueuedJobId(input);
  if (status === 404 || String(payload?.message || "") === "not_found") return "Job not found or no longer available.";
  if (status === 403 || String(payload?.message || "") === "forbidden") return "You do not have access to this job.";
  const base = sanitizeBackendUserMessage(getJobErrorMessage(payload, fallback), fallback);
  return jobId ? base + " Reference: " + jobId : base;
};

const getDisconnectSourceErrorMessage = (input, fallback = "Could not disconnect source. Try again.") => {
  const payload = getApiProblemPayload(input);
  const detail = String(payload?.detail || "").trim();
  if (detail === "session_id_required") return "Missing session.";
  return getSharedApiErrorMessage(input, fallback);
};

const getDisconnectToolErrorMessage = (input, fallback = "Could not disconnect tool. Try again.") => (
  getSharedApiErrorMessage(input, fallback)
);
const isQueuedJobResponse = (data) => (
  data?.results?.accepted === true &&
  !!getQueuedPollPath(data)
);

const resolveLogStreamFilename = (value) => {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    return String(value.logFile ?? value.log_file ?? value.filename ?? value.results ?? "").trim();
  }
  return "";
};

const resolveStreamResponseLogFilename = (response) => {
  if (typeof response?.results === "string") return response.results.trim();
  return String(
    response?.results?.log_file ??
    response?.results?.logFile ??
    response?.job?.payload?.log_file ??
    response?.job?.payload?.logFile ??
    response?.results?.job?.payload?.log_file ??
    response?.results?.job?.payload?.logFile ??
    response?.payload?.log_file ??
    response?.payload?.logFile ??
    response?.log_file ??
    response?.logFile ??
    response?.result?.log_file ??
    response?.result?.logFile ??
    ""
  ).trim();
};

const pollJob = async (apiFetch, jobIdOrPath, { intervalMs = JOB_POLL_DEFAULT_INTERVAL_MS, timeoutMs, signal, timeoutMessage = "Job timed out", cancelledMessage = "Job request cancelled", label = "job" } = {}) => {
  let effectiveTimeoutMs = timeoutMs;
  if (!effectiveTimeoutMs) {
    if (label === "ingestion" || label === "analysis") {
      effectiveTimeoutMs = 7200 * 1000; // 2 hours
    } else {
      effectiveTimeoutMs = JOB_POLL_DEFAULT_TIMEOUT_MS;
    }
  }

  const startedAt = Date.now();
  const pollPath = String(jobIdOrPath || "").startsWith("/")
    ? String(jobIdOrPath)
    : "/jobs/" + encodeURIComponent(jobIdOrPath);
  let attempt = 0;

  while (Date.now() - startedAt < effectiveTimeoutMs) {
    if (signal?.aborted) throw new DOMException("Job request was cancelled", "AbortError");

    const job = await apiFetch(pollPath, {
      method: "GET",
      signal,
    });
    attempt += 1;
    const status = getJobStatus(job);
    const result = getJobResult(job);

    if (JOB_SUCCESS_STATUSES.has(status)) {
      console.log("[job poll succeeded]", { label, pollPath, attempt, status, result, response: job });
      return result;
    }

    if (JOB_FAILURE_STATUSES.has(status)) {
      const rawMessage = getJobErrorMessage(job);
      const message = JOB_CANCEL_STATUSES.has(status) && (!rawMessage || String(rawMessage).toLowerCase() === "success")
        ? cancelledMessage
        : rawMessage;
      const error = new Error(message);
      error.jobResponse = job;
      error.jobResult = result;
      error.jobStatus = status;
      error.pollPath = pollPath;
      console.error("[job failed response]", { label, pollPath, attempt, status, result, response: job });
      throw error;
    }

    if (attempt === 1 || attempt % 5 === 0 || !JOB_PENDING_STATUSES.has(status)) {
      console.log("[job poll pending]", {
        label,
        pollPath,
        attempt,
        status: status || "unknown",
        elapsedMs: Date.now() - startedAt,
        result,
        response: job,
      });
    }

    await delay(intervalMs);
  }

  const timeoutError = new Error(timeoutMessage);
  timeoutError.pollPath = pollPath;
  console.error("[job poll timed out]", { label, pollPath, elapsedMs: Date.now() - startedAt });
  throw timeoutError;
};

const fetchMaybeQueued = async (apiFetch, url, options = {}, pollOptions = {}) => {
  const response = await apiFetch(url, options);
  console.log("[api response]", url, response);

  if (isQueuedJobResponse(response)) {
    const pollPath = getQueuedPollPath(response);
    pollOptions.onQueued?.({ url, pollPath, response });
    console.log("[queued job response]", { label: pollOptions.label || url, url, pollPath, response });
    const result = await pollJob(apiFetch, pollPath, {
      ...pollOptions,
      signal: pollOptions.signal ?? options.signal,
    });
    console.log("[queued job result]", { label: pollOptions.label || url, url, pollPath, result });
    return result;
  }

  return response;
};

const normalizeGraphChunkEventId = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const buildGraphChunkPollPath = (pollPath, afterEventId) => {
  const separator = String(pollPath).includes("?") ? "&" : "?";
  return String(pollPath) + separator + "include_chunks=1&after_event_id=" + encodeURIComponent(String(afterEventId || 0));
};

const mergeGraphChunksIntoState = (state, chunks = []) => {
  const nextState = {
    afterEventId: state?.afterEventId || 0,
    nodesById: state?.nodesById instanceof Map ? state.nodesById : new Map(),
    edges: Array.isArray(state?.edges) ? state.edges : [],
    chunkCount: Number(state?.chunkCount || 0),
    lastChunkCount: 0,
  };

  if (!Array.isArray(chunks)) return nextState;

  chunks.forEach((chunk, index) => {
    const eventId = normalizeGraphChunkEventId(chunk?.event_id ?? chunk?.eventId);
    if (eventId > nextState.afterEventId) nextState.afterEventId = eventId;
    const chunkNodes = Array.isArray(chunk?.nodes) ? chunk.nodes : [];
    const chunkEdges = Array.isArray(chunk?.edges) ? chunk.edges : [];

    chunkNodes.forEach((node) => {
      if (!node || typeof node !== "object") return;
      const nodeId = String(node.id ?? node.identity ?? node.elementId ?? "");
      if (!nodeId) return;
      nextState.nodesById.set(nodeId, node);
    });

    chunkEdges.forEach((edge) => {
      if (!edge || typeof edge !== "object") return;
      nextState.edges.push(edge);
    });

    nextState.chunkCount += 1;
    nextState.lastChunkCount += 1;

    console.log("[graph chunk merged]", {
      chunk_index: index,
      event_id: eventId || null,
      chunk_nodes: chunkNodes.length,
      chunk_edges: chunkEdges.length,
      total_nodes: nextState.nodesById.size,
      total_edges: nextState.edges.length,
    });
  });

  return nextState;
};

const buildChunkedGraphResponse = (job, aggregateState, fallback = {}) => {
  const jobResults = job?.results && typeof job.results === "object" ? job.results : {};
  const jobResult = jobResults?.result && typeof jobResults.result === "object" ? jobResults.result : {};
  const fallbackPayload = getGraphPayloadCandidate(fallback) || {};
  const fallbackGraph = fallbackPayload?.graph && typeof fallbackPayload.graph === "object" ? fallbackPayload.graph : fallback?.graph;
  const nodes = Array.from(aggregateState?.nodesById?.values?.() || []);
  const edges = Array.isArray(aggregateState?.edges) ? aggregateState.edges : [];

  return {
    ...job,
    message: jobResult.message || jobResults.message || job?.message || fallbackPayload.message || "success",
    results: {
      ...jobResults,
      ...jobResult,
      nodes,
      edges,
      source_id: jobResult.source_id ?? jobResults.source_id ?? fallbackPayload.source_id ?? fallback?.source_id,
      graph_session_id: jobResult.graph_session_id ?? jobResults.graph_session_id ?? fallbackPayload.graph_session_id ?? fallback?.graph_session_id,
      relationship: jobResult.relationship ?? jobResults.relationship ?? fallbackPayload.relationship ?? fallback?.relationship,
      chunk_count: jobResult.chunk_count ?? jobResults.chunk_count ?? aggregateState?.chunkCount ?? 0,
      chunked: jobResult.chunked ?? jobResults.chunked ?? true,
      next_chunk_after_event_id: jobResults.next_chunk_after_event_id ?? aggregateState?.afterEventId ?? 0,
      graph: {
        ...(fallbackGraph && typeof fallbackGraph === "object" ? fallbackGraph : {}),
        nodes,
        edges,
        source_id: jobResult.source_id ?? jobResults.source_id ?? fallbackPayload.source_id ?? fallback?.source_id,
        graph_session_id: jobResult.graph_session_id ?? jobResults.graph_session_id ?? fallbackPayload.graph_session_id ?? fallback?.graph_session_id,
        relationship: jobResult.relationship ?? jobResults.relationship ?? fallbackPayload.relationship ?? fallback?.relationship,
        status: jobResult.status ?? jobResults.status ?? job?.status ?? fallbackPayload.status ?? fallback?.status ?? "succeeded",
        message: jobResult.message ?? jobResults.message ?? job?.message ?? fallbackPayload.message ?? fallback?.message ?? "success",
      },
    },
  };
};

const pollGraphJob = async (apiFetch, jobIdOrPath, { intervalMs = JOB_POLL_DEFAULT_INTERVAL_MS, timeoutMs = JOB_POLL_DEFAULT_TIMEOUT_MS, signal, timeoutMessage = "Graph request timed out. Retry graph load.", cancelledMessage = "Graph request cancelled.", label = "graph", onProgress, initialResponse } = {}) => {
  const startedAt = Date.now();
  const pollPath = String(jobIdOrPath || "").startsWith("/") ? String(jobIdOrPath) : "/jobs/" + encodeURIComponent(jobIdOrPath);
  let attempt = 0;
  let aggregateState = { afterEventId: 0, nodesById: new Map(), edges: [], chunkCount: 0, lastChunkCount: 0 };

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) throw new DOMException("Job request was cancelled", "AbortError");

    const requestPath = buildGraphChunkPollPath(pollPath, aggregateState.afterEventId);
    const job = await apiFetch(requestPath, { method: "GET", signal });
    attempt += 1;
    const status = getJobStatus(job);
    const jobResults = job?.results && typeof job.results === "object" ? job.results : {};
    const chunks = Array.isArray(jobResults.chunks) ? jobResults.chunks : [];
    aggregateState = mergeGraphChunksIntoState(aggregateState, chunks);
    const nextCursor = normalizeGraphChunkEventId(jobResults.next_chunk_after_event_id ?? jobResults.nextChunkAfterEventId);
    if (nextCursor > aggregateState.afterEventId) aggregateState.afterEventId = nextCursor;
    const partialResponse = buildChunkedGraphResponse(job, aggregateState, initialResponse);

    console.log("[graph chunk poll]", {
      label,
      pollPath,
      requestPath,
      attempt,
      status: status || "unknown",
      elapsedMs: Date.now() - startedAt,
      chunk_count: chunks.length,
      next_after_event_id: aggregateState.afterEventId,
      total_nodes: partialResponse.results.nodes.length,
      total_edges: partialResponse.results.edges.length,
      summary: {
        total_nodes: jobResults?.result?.total_nodes ?? null,
        total_edges: jobResults?.result?.total_edges ?? null,
        chunk_count: jobResults?.result?.chunk_count ?? null,
        chunked: jobResults?.result?.chunked ?? null,
      },
      response: job,
    });

    onProgress?.(partialResponse, {
      attempt,
      status,
      pollPath,
      requestPath,
      chunkCount: chunks.length,
      afterEventId: aggregateState.afterEventId,
    });

    if (JOB_SUCCESS_STATUSES.has(status)) {
      console.log("[graph chunk poll succeeded]", {
        label,
        pollPath,
        attempt,
        total_nodes: partialResponse.results.nodes.length,
        total_edges: partialResponse.results.edges.length,
        response: job,
      });
      return partialResponse;
    }

    if (JOB_FAILURE_STATUSES.has(status)) {
      const rawMessage = getJobErrorMessage(job, "Graph request failed");
      const message = JOB_CANCEL_STATUSES.has(status) && (!rawMessage || String(rawMessage).toLowerCase() === "success") ? cancelledMessage : rawMessage;
      const error = new Error(message);
      error.jobResponse = job;
      error.jobResult = partialResponse;
      error.jobStatus = status;
      error.pollPath = pollPath;
      console.error("[graph chunk poll failed]", {
        label,
        pollPath,
        attempt,
        status,
        after_event_id: aggregateState.afterEventId,
        total_nodes: partialResponse.results.nodes.length,
        total_edges: partialResponse.results.edges.length,
        response: job,
      });
      throw error;
    }

    await delay(intervalMs);
  }

  const timeoutError = new Error(timeoutMessage);
  timeoutError.pollPath = pollPath;
  console.error("[graph chunk poll timed out]", { label, pollPath, elapsedMs: Date.now() - startedAt, after_event_id: aggregateState.afterEventId });
  throw timeoutError;
};

const getDataframeJobMessage = (data) => getJobErrorMessage(data, "Dataframe job failed");

const normalizeSearchResponse = (data) => {
  const response = data?.results?.result && typeof data.results.result === "object"
    ? data.results.result
    : data?.result && typeof data.result === "object" && Array.isArray(data.result.results)
      ? data.result
      : data;

  const results = Array.isArray(response?.results) ? response.results : [];
  const hasMore = response?.has_more === true || response?.has_more === 1 || response?.has_more === "1";

  return {
    ...response,
    results,
    has_more: hasMore,
    offset: Number(response?.offset || 0),
    limit: Number(response?.limit || 0),
    message: response?.message ?? data?.message ?? "",
  };
};

const normalizeDataframeInfoList = (results) => {
  const toList = (value) => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
    if (typeof value === "string" && value.trim()) return [value];
    return [];
  };
  const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");

  const source = results && typeof results === "object" ? results : {};
  const legacy = Array.isArray(results) ? [...results] : Object.values(source);
  const normalized = [...legacy];

  const columns = toList(pick(
    source.columns,
    source.column_names,
    source.dataframe_columns,
    source.headers,
    normalized[2]
  ));

  normalized[0] = toList(pick(source.actions, source.action_options, source.available_actions, normalized[0]));
  normalized[1] = pick(
    source.broker_api,
    source.brokerApi,
    source.broker,
    source.api,
    source.source,
    source.source_name,
    source.sourceName,
    normalized[1]
  );
  normalized[2] = columns;
  normalized[3] = pick(
    source.total_columns,
    source.totalColumns,
    source.column_count,
    source.columnCount,
    source.columns_count,
    source.num_columns,
    normalized[3],
    columns.length || undefined
  );
  normalized[4] = pick(
    source.total_rows,
    source.totalRows,
    source.row_count,
    source.rowCount,
    source.rows_count,
    source.num_rows,
    source.rows,
    normalized[4]
  );
  normalized[5] = toList(pick(source.rules, source.analysis_rules, source.link_analysis_rules, normalized[5]));
  normalized[6] = pick(
    source.storage,
    source.storage_name,
    source.storageName,
    source.dataset,
    source.dataframe,
    source.dataframe_name,
    source.dataframeName,
    normalized[6]
  );
  normalized[7] = pick(source.tool, source.tool_name, source.toolName, source.graph_tool, normalized[7]);

  return normalized;
};

const normalizeCompletedDataframeJob = (data) => {
  const nestedResponse =
    data?.results?.result ??
    data?.results?.response ??
    data?.result?.result ??
    data?.result?.response ??
    data?.response;

  if (nestedResponse && typeof nestedResponse === "object") {
    if (nestedResponse.results || nestedResponse.message) {
      return {
        ...nestedResponse,
        message: nestedResponse.message || "success",
      };
    }

    return {
      ...data,
      message: data?.message || "success",
      results: nestedResponse,
    };
  }

  if (data?.results && !JOB_SUCCESS_STATUSES.has(getJobStatus(data?.results))) {
    return {
      ...data,
      message: data.message || "success",
    };
  }

  return {
    ...data,
    message: data?.message || "success",
    results: data?.data ?? data?.result?.data ?? data?.result ?? data?.results,
  };
};

const formatDataframeFailureMessage = (errorOrData, fallback) => {
  const data = errorOrData?.jobResult ?? errorOrData?.data ?? errorOrData;
  const results = data?.results ?? data?.result ?? data;
  const failedSources = Array.isArray(results?.failed_sources)
    ? results.failed_sources
    : Array.isArray(results?.failedSources)
      ? results.failedSources
      : [];
  const base = errorOrData?.message && String(errorOrData.message).toLowerCase() !== "success"
    ? errorOrData.message
    : data?.message || fallback;
  if (failedSources.length === 0) return base || fallback;
  const sourceText = failedSources
    .slice(0, 5)
    .map((item) => typeof item === "string" ? item : (item?.name || item?.source || item?.path || JSON.stringify(item)))
    .join("; ");
  const suffix = failedSources.length > 5 ? "; and " + (failedSources.length - 5) + " more" : "";
  return (base || fallback) + " Failed sources: " + sourceText + suffix;
};

const requestDataframeCreation = async (apiFetch, payload, options = {}) => {
  const data = await apiFetch("/live_batch_files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (isQueuedJobResponse(data)) {
    options.onQueued?.(data);
    const result = await pollJob(apiFetch, getQueuedPollPath(data), { intervalMs: 2000, label: options.label || "dataframe" });
    return normalizeCompletedDataframeJob(result);
  }

  return data;
};

const getGraphJobMessage = (data) => getJobErrorMessage(data, "Graph request failed");

const parseMaybeSerializedGraphPayload = (value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;

  try {
    return JSON.parse(trimmed);
  } catch (_) {
    // Some worker responses currently arrive as a Python dict repr. Keep this
    // narrow and only use it as a graph payload compatibility fallback.
  }

  try {
    const stringifyPythonConstructor = (match) => JSON.stringify(match);
    const jsonish = trimmed
      .replace(/\bNone\b/g, "null")
      .replace(/\bTrue\b/g, "true")
      .replace(/\bFalse\b/g, "false")
      .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner) => JSON.stringify(
        inner
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, "\\")
      ))
      .replace(/\bneo4j\.time\.[A-Za-z_][\w.]*\((?:[^()]|\([^()]*\))*\)/g, stringifyPythonConstructor)
      .replace(/\b(?:datetime\.)?(?:datetime|date|time|timedelta)\((?:[^()]|\([^()]*\))*\)/g, stringifyPythonConstructor)
      .replace(/\bNaN\b/g, "null")
      .replace(/\bInfinity\b/g, "null")
      .replace(/-\s*null\b/g, "null");
    return JSON.parse(jsonish);
  } catch (error) {
    console.warn("[graph payload parse failed]", { error, value: trimmed.slice(0, 500) });
    return value;
  }
};

const getContrastColor = (hexcolor) => {
  if (!hexcolor) return "#FFF";
  let r, g, b;
  if (hexcolor.startsWith("rgb")) {
    const match = hexcolor.match(/\d+/g);
    if (match && match.length >= 3) {
      r = parseInt(match[0]);
      g = parseInt(match[1]);
      b = parseInt(match[2]);
    } else return "#FFF";
  } else {
    let hex = hexcolor.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
    if (hex.length !== 6) return "#FFF";
    r = parseInt(hex.substr(0, 2), 16);
    g = parseInt(hex.substr(2, 2), 16);
    b = parseInt(hex.substr(4, 2), 16);
  }
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#333333" : "#FFFFFF";
};

const normalizeGraphRelationships = (value) => {
  const source =
    Array.isArray(value)
      ? value
      : value?.relationships ??
        value?.results?.relationships ??
        value?.result?.relationships ??
        value?.data?.relationships ??
        value?.items ??
        [];

  if (!Array.isArray(source)) return [];

  return source
    .map((item, index) => {
      if (typeof item === "string" || typeof item === "number") {
        const type = String(item);
        return { id: type, type };
      }
      if (!item || typeof item !== "object") return null;
      const type = String(item.type ?? item.relationship ?? item.name ?? item.label ?? item.id ?? "").trim();
      if (!type) return null;
      
      const bgcolor = item.bgcolor ?? item.bgColor ?? item.bg_color ?? item.backgroundColor ?? item.color ?? "#555555";
      const textcolor = item.textcolor ?? item.textColor ?? item.text_color ?? item.fontColor ?? item.font_color ?? item.labelColor ?? item.label_color ?? getContrastColor(bgcolor);
      
      return {
        ...item,
        id: item.id ?? type ?? index,
        type,
        textcolor,
        bgcolor,
      };
    })
    .filter(Boolean);
};

const getGraphPayloadCandidate = (data) => {
  const parsedData = parseMaybeSerializedGraphPayload(data);
  const source = parsedData === data ? data : parsedData;
  if (Array.isArray(source?.results?.nodes) || Array.isArray(source?.results?.edges)) return source.results;
  if (Array.isArray(source?.nodes) || Array.isArray(source?.edges)) return source;
  if (source?.graph && (Array.isArray(source.graph.nodes) || Array.isArray(source.graph.edges))) return source.graph;
  if (source?.results?.graph && (Array.isArray(source.results.graph.nodes) || Array.isArray(source.results.graph.edges))) return source.results.graph;
  const parsedResult = parseMaybeSerializedGraphPayload(source?.results?.result);
  if (parsedResult && typeof parsedResult === "object") return parsedResult;
  if (source?.results?.result && typeof source.results.result === "object") return source.results.result;
  return source?.results ?? source;
};

const hasGraphPayload = (data) => {
  const payload = getGraphPayloadCandidate(data);
  const graphPayload = payload?.graph && typeof payload.graph === "object" ? payload.graph : data?.graph;
  return Array.isArray(payload?.nodes) || Array.isArray(payload?.edges) || Array.isArray(graphPayload?.nodes) || Array.isArray(graphPayload?.edges);
};

const normalizeGraphFetchResponse = (data) => {
  const payload = getGraphPayloadCandidate(data) || {};
  const graphPayload = payload.graph && typeof payload.graph === "object" ? payload.graph : data?.graph;
  const nodes = Array.isArray(payload.nodes)
    ? payload.nodes
    : Array.isArray(graphPayload?.nodes)
      ? graphPayload.nodes
      : [];
  const edges = Array.isArray(payload.edges)
    ? payload.edges
    : Array.isArray(graphPayload?.edges)
      ? graphPayload.edges
      : [];

  return {
    ...data,
    message: payload.message || data?.message || "success",
    results: {
      ...payload,
      nodes,
      edges,
      file: payload.file ?? graphPayload?.file ?? data?.file,
      source_id: payload.source_id ?? data?.source_id,
      graph_session_id: payload.graph_session_id ?? data?.graph_session_id,
      relationship: payload.relationship ?? data?.relationship,
      graph: graphPayload ?? { nodes, edges, file: payload.file ?? data?.file, status: payload.status ?? data?.status, message: payload.message ?? data?.message },
    },
  };
};

const requestGraphFetch = async (apiFetch, payload, signal, options = {}) => {
  const response = await apiFetch('/get_graph', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  });

  console.log('[graph fetch initial response]', { payload, response });

  let data = response;
  if (isQueuedJobResponse(response)) {
    const pollPath = getQueuedPollPath(response);
    options.onQueued?.({ url: '/get_graph', pollPath, response });
    console.log('[graph fetch queued]', { payload, pollPath, response });
    data = await pollGraphJob(apiFetch, pollPath, {
      signal,
      timeoutMs: 120 * 1000,
      timeoutMessage: 'Graph request timed out. Retry graph load.',
      cancelledMessage: 'Graph request cancelled.',
      label: 'graph',
      onProgress: options.onProgress,
      initialResponse: response,
    });
  }

  console.log('[direct graph fetch response]', { payload, data });

  const status = getJobStatus(data);
  if (JOB_FAILURE_STATUSES.has(status) || data?.error || data?.results?.error || data?.result?.error) {
    const message = JOB_CANCEL_STATUSES.has(status) ? 'Graph request cancelled.' : getGraphJobMessage(data);
    console.error('[graph fetch failed]', { status, data });
    console.log('[graph fetch failed raw]', data);
    throw new Error(message);
  }

  if (!hasGraphPayload(data)) {
    console.error('[graph fetch missing payload]', { data, candidate: getGraphPayloadCandidate(data) });
    console.log('[graph fetch missing payload raw]', data);
    throw new Error(getGraphJobMessage(data));
  }

  return normalizeGraphFetchResponse(data);
};

const extractConfigurationPayload = (data) => (
  data?.results?.configuration ??
  data?.results?.configurations ??
  data?.results?.data ??
  data?.configuration ??
  data?.configurations ??
  data?.data ??
  null
);

const parseConfigurationValue = (value) => {
  if (!value) return {};
  if (value.value) {
    try {
      return JSON.parse(String(value.value).replace(/'/g, '"'));
    } catch (_err) {
      return {};
    }
  }
  return value && typeof value === "object" ? value : {};
};

const LARGE_SEARCH_BACKENDS = new Set(["hive", "elastic_scroll"]);
const DEFAULT_LARGE_SEARCH_BACKEND = "hive";
const DEFAULT_ELASTIC_SCROLL_LIMIT = 1000000;

const normalizeBooleanConfigValue = (value) => value === true || value === "true";

const normalizeElasticScrollLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ELASTIC_SCROLL_LIMIT;
  return parsed;
};

const normalizeConfigAddressList = (value) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? value.split(",")
      : [];

  const seen = new Set();
  const items = [];
  source.forEach((item) => {
    const normalized = sanitizeConnectionValue(item, { maxLength: 300 });
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    items.push(normalized);
  });
  return items;
};

const mergeConfigAddressOptions = ({ list, activeValue, pendingValue }) => {
  const existing = normalizeConfigAddressList(list);
  const active = sanitizeConnectionValue(activeValue, { maxLength: 300 });
  const pending = sanitizeConnectionValue(pendingValue, { maxLength: 300 });
  const preferred = pending || active;
  const merged = normalizeConfigAddressList([
    ...(preferred ? [preferred] : []),
    ...(active ? [active] : []),
    ...existing,
  ]);

  return {
    list: merged,
    active: preferred || active,
    pending,
  };
};

const normalizeTrustedListEntries = (value, options = {}) => {
  const preserveEmpty = options?.preserveEmpty === true;
  const source = Array.isArray(value)
    ? value
    : typeof value === "string" && value.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
          } catch (_error) {
            return [];
          }
        })()
      : [];

  return source.map((item) => {
    if (Array.isArray(item)) {
      return {
        key: sanitizeText(item[0] ?? "", { maxLength: 160 }),
        value: sanitizeText(item[1] ?? "", { maxLength: 500 }),
      };
    }
    if (!item || typeof item !== "object") {
      return { key: "", value: "" };
    }

    if (Object.prototype.hasOwnProperty.call(item, "key") || Object.prototype.hasOwnProperty.call(item, "value") || Object.prototype.hasOwnProperty.call(item, "name") || Object.prototype.hasOwnProperty.call(item, "data")) {
      return {
        key: sanitizeText(item.key ?? item.name ?? "", { maxLength: 160 }),
        value: sanitizeText(item.value ?? item.data ?? "", { maxLength: 500 }),
      };
    }

    const firstScalarEntry = Object.entries(item).find(([, entryValue]) => ["string", "number", "boolean"].includes(typeof entryValue));
    if (!firstScalarEntry) {
      return { key: "", value: "" };
    }

    return {
      key: sanitizeText(firstScalarEntry[0] ?? "", { maxLength: 160 }),
      value: sanitizeText(firstScalarEntry[1] ?? "", { maxLength: 500 }),
    };
  }).filter((item) => preserveEmpty || item.key !== "" || item.value !== "");
};

const normalizeClassifiedEntityEntries = (trustedValue, riskValue, options = {}) => {
  const preserveEmpty = options?.preserveEmpty === true;
  const explicitSource = options?.value;

  if (explicitSource !== undefined) {
    const sourceEntries = Array.isArray(explicitSource)
      ? explicitSource
      : typeof explicitSource === "string" && explicitSource.trim()
        ? (() => {
            try {
              const parsed = JSON.parse(explicitSource);
              return Array.isArray(parsed) ? parsed : [];
            } catch (_error) {
              return [];
            }
          })()
        : [];

    return sourceEntries.map((item) => ({
      key: sanitizeText(item?.key ?? item?.name ?? "", { maxLength: 160 }),
      value: sanitizeText(item?.value ?? item?.data ?? "", { maxLength: 500 }),
      category: ["Risk", "PEP", "Sanction"].includes(String(item?.category)) ? String(item.category) : "Trusted",
    })).filter((item) => preserveEmpty || item.key !== "" || item.value !== "");
  }

  const trustedEntries = normalizeTrustedListEntries(trustedValue, { preserveEmpty: true }).map((item) => ({
    ...item,
    category: "Trusted",
  }));
  const riskEntries = normalizeTrustedListEntries(riskValue, { preserveEmpty: true }).map((item) => ({
    ...item,
    category: "Risk",
  }));

  return [...trustedEntries, ...riskEntries].filter((item) => preserveEmpty || item.key !== "" || item.value !== "");
};

const splitClassifiedEntityEntries = (entries) => {
  const normalized = normalizeClassifiedEntityEntries(null, null, { value: entries, preserveEmpty: false });
  return normalized.reduce((acc, item) => {
    const targetKey = item.category === "Risk" ? "risk_entities" : "trusted_entities";
    if (item.key) {
      acc[targetKey].push({ [item.key]: item.value });
    }
    return acc;
  }, { trusted_entities: [], risk_entities: [] });
};

const normalizeLargeSearchBackend = (value) => (
  LARGE_SEARCH_BACKENDS.has(String(value || "")) ? String(value) : DEFAULT_LARGE_SEARCH_BACKEND
);

const normalizeConfigurationFieldValue = (name, value) => {
  if (name === "storage_tables" || name === "active_tool_tables") {
    return Array.isArray(value) ? value : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (name === "trusted_list") {
    return normalizeTrustedListEntries(value, { preserveEmpty: true });
  }
  if (name === "risk_entities") {
    return normalizeTrustedListEntries(value, { preserveEmpty: true });
  }
  if (name === "classified_entities") {
    return normalizeClassifiedEntityEntries(null, null, { value, preserveEmpty: true });
  }
  if (name === "large_search_backend") {
    return normalizeLargeSearchBackend(value);
  }
  if (name === "elastic_scroll_enabled") {
    return normalizeBooleanConfigValue(value);
  }
  if (name === "elastic_scroll_limit") {
    return normalizeElasticScrollLimit(value);
  }
  return value;
};

const normalizeConfigurationStatePatch = (previous, name, value) => {
  const normalizedValue = normalizeConfigurationFieldValue(name, value);
  const baseConfig = parseConfigurationValue(previous);
  const nextConfig = {
    ...baseConfig,
    [name]: normalizedValue,
  };

  if (name === "active_tool_url") {
    nextConfig.active_tool_protocol = normalizedValue;
  }

  if (name === "large_search_backend") {
    nextConfig.elastic_scroll_enabled = normalizedValue === "elastic_scroll";
  }

  if (name === "elastic_scroll_enabled") {
    nextConfig.large_search_backend = normalizedValue ? "elastic_scroll" : "hive";
  }

  if (previous?.value) {
    return {
      ...previous,
      ...nextConfig,
      value: JSON.stringify(nextConfig),
    };
  }

  return nextConfig;
};

const isConfigAutoFillEnabled = (configurations) => {
  const config = parseConfigurationValue(configurations);
  if (config?.auto_fill_fields === undefined || config?.auto_fill_fields === null || config?.auto_fill_fields === "") {
    return true;
  }
  return config?.auto_fill_fields === true || config?.auto_fill_fields === "true";
};

const getConfigValue = (configurations, keys, fallback = "") => {
  const config = parseConfigurationValue(configurations);
  const keyList = Array.isArray(keys) ? keys : [keys];
  for (const key of keyList) {
    const value = config?.[key];
    if (Array.isArray(value)) {
      if (value.length) return String(value[0] ?? "");
      continue;
    }
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value);
    }
  }
  return fallback;
};

const getSourceWindowAutofillDefaults = (configurations) => {
  if (!isConfigAutoFillEnabled(configurations)) {
    return {
      sourceAddressType: "broker",
      sourceAddressText: "",
      sourceStorageText: "",
      sourceTopicText: "",
      sourceRealtimeAddressType: "broker",
      sourceRealtimeAddressText: "",
      sourceRealtimeTopicText: "",
      toolUrl: "",
      toolUsername: "",
      toolPassword: "",
      toolPasswordRef: "",
      toolDatabase: "",
      realtimeToolUrl: "",
      realtimeToolUsername: "",
      realtimeToolPassword: "",
      realtimeToolPasswordRef: "",
      realtimeToolDatabase: "",
    };
  }

  const brokerAddress = getConfigValue(configurations, ["active_kafka_adress", "kafka_custom_address", "active_REST_API"]);
  const storageAddress = getConfigValue(configurations, ["active_storage_address", "storage_custom_address", "storage_address"]);
  const brokerTopic = getConfigValue(configurations, ["active_kafka_topic", "kafka_custom_topic"]);

  const toolUrl = getConfigValue(configurations, ["active_tool_url", "active_tool_protocol"]);
  const toolUsername = getConfigValue(configurations, "active_tool_username");
  const toolDatabase = getConfigValue(configurations, ["active_tool_database", "custom_tool_database"]);
  const toolPasswordRef = getConfigurationToolPasswordRef(configurations);
  const rawToolPassword = getConfigValue(configurations, ["active_tool_password", "tool_password", "neo4j_password"]);
  const maskedToolPassword = toolPasswordRef ? "***" : (rawToolPassword || "");

  return {
    sourceAddressType: "broker",
    sourceAddressText: brokerAddress,
    sourceStorageText: storageAddress,
    sourceTopicText: brokerTopic,
    sourceRealtimeAddressType: "broker",
    sourceRealtimeAddressText: brokerAddress,
    sourceRealtimeTopicText: brokerTopic,
    toolUrl,
    toolUsername,
    toolPassword: maskedToolPassword,
    toolPasswordRef,
    toolDatabase,
    realtimeToolUrl: toolUrl,
    realtimeToolUsername: toolUsername,
    realtimeToolPassword: maskedToolPassword,
    realtimeToolPasswordRef: toolPasswordRef,
    realtimeToolDatabase: toolDatabase,
  };
};

const buildSourceWindowAutofillPatch = (configurations) => {
  const defaults = getSourceWindowAutofillDefaults(configurations);
  return {
    sourceKind: defaults.sourceAddressType || SOURCE_KINDS.BROKER,
    sourceAddressType: defaults.sourceAddressType,
    sourceAddressText: defaults.sourceAddressText,
    sourceStorageText: defaults.sourceStorageText,
    sourceTopicText: defaults.sourceTopicText,
    sourceRealtimeAddressType: defaults.sourceRealtimeAddressType,
    sourceRealtimeAddressText: defaults.sourceRealtimeAddressText,
    sourceRealtimeTopicText: defaults.sourceRealtimeTopicText,
    toolUrl: defaults.toolUrl,
    toolUsername: defaults.toolUsername,
    toolPassword: defaults.toolPassword,
    toolPasswordRef: defaults.toolPasswordRef,
    toolDatabase: defaults.toolDatabase,
    realtimeToolUrl: defaults.realtimeToolUrl,
    realtimeToolUsername: defaults.realtimeToolUsername,
    realtimeToolPassword: defaults.realtimeToolPassword,
    realtimeToolPasswordRef: defaults.realtimeToolPasswordRef,
    realtimeToolDatabase: defaults.realtimeToolDatabase,
  };
};


const CONFIG_SECRET_FIELD_KEYS = ["active_tool_password", "tool_password", "neo4j_password", "postgres_password", "api_secret", "api_key"];
const CONFIG_SECRET_REF_KEYS = {
  active_tool_password: ["active_tool_password_ref", "tool_password_ref", "password_ref"],
  tool_password: ["tool_password_ref", "active_tool_password_ref", "password_ref"],
  neo4j_password: ["neo4j_password_ref", "password_ref"],
  postgres_password: ["postgres_password_ref", "password_ref"],
  api_secret: ["api_secret_ref", "secret_ref"],
  api_key: ["api_key_ref", "key_ref"],
};
const CONFIG_SECRET_MASK_PATTERN = /^\*+$/;

const normalizeSecretRefValue = (value) => String(value ?? "").trim();

const getConfigurationToolPasswordRef = (configuration) => (
  normalizeSecretRefValue(
    configuration?.active_tool_password_ref ||
    configuration?.tool_password_ref ||
    configuration?.password_ref
  )
);

const buildToolCredentialWindowPatch = (configuration) => {
  const passwordRef = getConfigurationToolPasswordRef(configuration);
  const rawToolPassword = getConfigValue(configuration, ["active_tool_password", "tool_password", "neo4j_password"]);
  const maskedPassword = passwordRef ? "***" : (rawToolPassword || "");
  return {
    toolUrl: getConfigValue(configuration, ["active_tool_url", "active_tool_protocol"]),
    toolUsername: getConfigValue(configuration, "active_tool_username"),
    toolDatabase: getConfigValue(configuration, ["active_tool_database", "custom_tool_database"]),
    toolPassword: maskedPassword,
    toolPasswordRef: passwordRef,
    realtimeToolUrl: getConfigValue(configuration, ["active_tool_url", "active_tool_protocol"]),
    realtimeToolUsername: getConfigValue(configuration, "active_tool_username"),
    realtimeToolDatabase: getConfigValue(configuration, ["active_tool_database", "custom_tool_database"]),
    realtimeToolPassword: maskedPassword,
    realtimeToolPasswordRef: passwordRef,
  };
};

const buildConnectToToolPayload = ({ payload, validatedValues, sessionKey, passwordRef }) => {
  const nextPayload = {
    ...payload,
    ...validatedValues,
    source_id: sessionKey,
    session_id: sessionKey,
  };
  const normalizedPassword = sanitizeSecret(nextPayload.password, { maxLength: 256 });
  const normalizedPasswordRef = normalizeSecretRefValue(passwordRef || payload?.password_ref);

  if (CONFIG_SECRET_MASK_PATTERN.test(String(normalizedPassword || "").trim())) {
    if (!normalizedPasswordRef) {
      return { ok: false, message: "Enter the real Neo4j password before connecting." };
    }
    nextPayload.password = normalizedPassword;
    nextPayload.password_ref = normalizedPasswordRef;
    return { ok: true, payload: nextPayload };
  }

  delete nextPayload.password_ref;
  nextPayload.password = normalizedPassword;
  return { ok: true, payload: nextPayload };
};

const normalizeLoadedConfiguration = (payload) => {
  if (!payload) return {};
  const parsed = payload.value ? parseConfigurationValue(payload) : { ...payload };
  if (parsed && typeof parsed === "object") {
    CONFIG_SECRET_FIELD_KEYS.forEach((key) => {
      const value = parsed[key];
      if (value && typeof value === "object") {
        const refValue = value.password_ref || value.passwordRef || value.secret_ref || value.secretRef || value.ref;
        const refKey = CONFIG_SECRET_REF_KEYS[key]?.[0];
        if (refValue && refKey && !parsed[refKey]) parsed[refKey] = refValue;
        parsed[key] = String(value.value || value.masked || value.mask || "***");
      } else if (value !== undefined && value !== null) {
        parsed[key] = String(value);
      }
    });

    const kafkaAddressState = mergeConfigAddressOptions({
      list: parsed.kafka_addresses,
      activeValue: parsed.active_kafka_adress,
      pendingValue: parsed.kafka_custom_address,
    });
    parsed.kafka_addresses = kafkaAddressState.list;
    if (kafkaAddressState.active) parsed.active_kafka_adress = kafkaAddressState.active;
    parsed.kafka_custom_address = "";

    const kafkaTopicState = mergeConfigAddressOptions({
      list: parsed.kafka_topics,
      activeValue: parsed.active_kafka_topic,
      pendingValue: parsed.kafka_custom_topic,
    });
    parsed.kafka_topics = kafkaTopicState.list;
    if (kafkaTopicState.active) parsed.active_kafka_topic = kafkaTopicState.active;
    parsed.kafka_custom_topic = "";

    const storageAddressState = mergeConfigAddressOptions({
      list: parsed.storage_addresses,
      activeValue: parsed.active_storage_address,
      pendingValue: parsed.storage_custom_address,
    });
    parsed.storage_addresses = storageAddressState.list;
    if (storageAddressState.active) parsed.active_storage_address = storageAddressState.active;
    parsed.storage_custom_address = "";

    if (parsed.auto_fill_fields === undefined || parsed.auto_fill_fields === null || parsed.auto_fill_fields === "") {
      parsed.auto_fill_fields = true;
    }
  }
  return parsed;
};

const buildConfigurationSavePayload = (configuration) => {
  const parsed = parseConfigurationValue(configuration);
  const { value: _value, ...rest } = parsed;
  CONFIG_SECRET_FIELD_KEYS.forEach((key) => {
    const value = rest[key];
    const textValue = String(value ?? "").trim();
    if (value === undefined || value === null || textValue === "" || CONFIG_SECRET_MASK_PATTERN.test(textValue)) {
      delete rest[key];
    }
  });
  Object.values(CONFIG_SECRET_REF_KEYS).flat().forEach((key) => {
    delete rest[key];
  });
  delete rest.tool_credentials;
  const largeSearchBackend = normalizeLargeSearchBackend(rest.large_search_backend);
  const classifiedEntities = normalizeClassifiedEntityEntries(
    rest.trusted_entities ?? rest.trusted_catalog ?? rest.trusted_list ?? rest.trustedList ?? rest.active_tool_trusted_list,
    rest.risk_entities ?? rest.riskEntities ?? rest.active_risk_entities,
    {
      value: rest.classified_entities ?? rest.classifiedEntities,
      preserveEmpty: false,
    }
  );
  const splitEntities = splitClassifiedEntityEntries(classifiedEntities);
  rest.trusted_entities = splitEntities.trusted_entities;
  rest.risk_entities = splitEntities.risk_entities;
  delete rest.trusted_catalog;
  delete rest.trusted_list;
  delete rest.trustedList;
  delete rest.active_tool_trusted_list;
  delete rest.classified_entities;
  delete rest.classifiedEntities;

  const kafkaAddressState = mergeConfigAddressOptions({
    list: rest.kafka_addresses,
    activeValue: rest.active_kafka_adress,
    pendingValue: rest.kafka_custom_address,
  });
  rest.kafka_addresses = kafkaAddressState.list;
  rest.active_kafka_adress = kafkaAddressState.active;
  rest.kafka_custom_address = "";

  const kafkaTopicState = mergeConfigAddressOptions({
    list: rest.kafka_topics,
    activeValue: rest.active_kafka_topic,
    pendingValue: rest.kafka_custom_topic,
  });
  rest.kafka_topics = kafkaTopicState.list;
  rest.active_kafka_topic = kafkaTopicState.active;
  rest.kafka_custom_topic = "";

  const storageAddressState = mergeConfigAddressOptions({
    list: rest.storage_addresses,
    activeValue: rest.active_storage_address,
    pendingValue: rest.storage_custom_address,
  });
  rest.storage_addresses = storageAddressState.list;
  rest.active_storage_address = storageAddressState.active;
  rest.storage_custom_address = "";

  return {
    ...rest,
    large_search_backend: largeSearchBackend,
    elastic_scroll_enabled: largeSearchBackend === "elastic_scroll",
    elastic_scroll_limit: normalizeElasticScrollLimit(rest.elastic_scroll_limit),
  };
};

const buildRealtimeToolConfigurationPayload = (configuration, windowState) => {
  const baseConfiguration = buildConfigurationSavePayload(configuration);
  const realtimeToolUrl = sanitizeConnectionValue(windowState?.realtimeToolUrl, { maxLength: 300 });
  const realtimeToolUsername = sanitizeIdentifier(windowState?.realtimeToolUsername, { maxLength: 120 });
  const realtimeToolDatabase = sanitizeIdentifier(windowState?.realtimeToolDatabase, { maxLength: 120 });
  const realtimeToolPassword = sanitizeSecret(windowState?.realtimeToolPassword, { maxLength: 256 });

  const nextConfiguration = {
    ...baseConfiguration,
    session_id: normalizeSessionId(windowState?.id || windowState?.sessionId),
    active_tool_url: realtimeToolUrl,
    active_tool_protocol: realtimeToolUrl,
    active_tool_username: realtimeToolUsername,
    active_tool_database: realtimeToolDatabase,
  };

  if (realtimeToolPassword && !CONFIG_SECRET_MASK_PATTERN.test(realtimeToolPassword)) {
    nextConfiguration.active_tool_password = realtimeToolPassword;
  }

  return nextConfiguration;
};

const redactRequestHeadersForLog = (headersLike) => {
  const headers = new Headers(headersLike || {});
  const redacted = {};
  headers.forEach((value, key) => {
    const lowerKey = String(key || "").toLowerCase();
    if (lowerKey === "authorization") {
      redacted[key] = value ? "Bearer <redacted>" : "<redacted>";
      return;
    }
    if (lowerKey.includes("token")) {
      redacted[key] = "<redacted>";
      return;
    }
    redacted[key] = value;
  });
  return redacted;
};

const sourceConnectionSchema = {
  session_id: { label: "Session ID", required: true, sanitize: (value) => sanitizeGraphEndpointId(value, { maxLength: 128 }) },
  addressType: { label: "Source type", sanitize: (value) => sanitizeIdentifier(value, { maxLength: 40 }), pattern: /^$|^(broker|api|storage)$/i, message: "Source type must be broker, api, or storage." },
  address: { label: "Source address", sanitize: (value) => sanitizeConnectionValue(value, { maxLength: 300 }) },
  broker: { label: "Broker", sanitize: (value) => sanitizeConnectionValue(value, { maxLength: 300 }) },
  hdfs: { label: "Storage address", sanitize: (value) => sanitizeConnectionValue(value, { maxLength: 300 }) },
  topic: { label: "Topic", sanitize: (value) => sanitizeKafkaTopic(value, { maxLength: 249 }) },
  storage: { label: "Storage address", sanitize: (value) => sanitizeConnectionValue(value, { maxLength: 300 }) },
};

const toolConnectionSchema = {
  source_id: { label: "Source ID", required: true, sanitize: (value) => sanitizeGraphEndpointId(value, { maxLength: 128 }) },
  session_id: { label: "Session ID", sanitize: (value) => sanitizeGraphEndpointId(value, { maxLength: 128 }) },
  url: { label: "Tool URL", required: true, sanitize: (value) => sanitizeConnectionValue(value, { maxLength: 300 }) },
  username: { label: "Tool username", required: true, sanitize: (value) => sanitizeIdentifier(value, { maxLength: 120 }) },
  password: { label: "Tool password", required: true, sanitize: (value) => sanitizeSecret(value, { maxLength: 256 }) },
  database: { label: "Tool database", sanitize: (value) => sanitizeIdentifier(value, { maxLength: 120 }) },
};

const searchRequestSchema = {
  keyword: { label: "Search keyword", required: true, sanitize: (value) => sanitizeText(value, { maxLength: 500 }).trim(), maxLength: 500 },
  date: { label: "Search date", sanitize: (value) => String(value || "").trim(), pattern: /^$|^\d{4}-\d{2}-\d{2}$/ },
  search_column: { label: "Search column", sanitize: (value) => sanitizeText(value, { maxLength: 120 }).trim(), maxLength: 120 },
};

const cleanupRequestSchema = {
  session_id: { label: "Session ID", required: true, sanitize: (value) => sanitizeGraphEndpointId(value, { maxLength: 128 }) },
  cleanup_type: { label: "Cleanup type", sanitize: (value) => sanitizeGraphEndpointId(value, { maxLength: 40 }), pattern: /^$|^(session|session_tree|window|run|neo4j_session)$/ },
  run_id: { label: "Run ID", sanitize: (value) => sanitizeGraphEndpointId(value, { maxLength: 128 }) },
};

const streamRequestSchema = {
  action: { label: "Analysis action", required: true, sanitize: (value) => sanitizeText(value, { maxLength: 120 }).trim() },
  source: { label: "Source column", required: true, sanitize: (value) => sanitizeText(value, { maxLength: 120 }).trim() },
  target: { label: "Target column", required: true, sanitize: (value) => sanitizeText(value, { maxLength: 120 }).trim() },
  relationship: { label: "Relationship", required: true, sanitize: (value) => sanitizeRelationshipName(value || "HAS_RELATIONSHIP", { maxLength: 80 }), pattern: /^[A-Z][A-Z0-9_]*$/ },
  tool: { label: "Analysis tool", required: true, sanitize: (value) => sanitizeIdentifier(value, { maxLength: 80 }) },
  rule: { label: "Rule", sanitize: (value) => sanitizeText(value, { maxLength: 160 }).trim() },
};

const showValidationFailure = (message) => {
  alert(message || "Please review the highlighted fields and try again.");
};

const normalizeCleanupAuditResults = (data) => {
  const results = data?.results || {};
  const items = Array.isArray(results.items) ? results.items : [];
  return {
    items,
    total: Number(results.total) || items.length,
    limit: Number(results.limit) || 20,
    offset: Number(results.offset) || 0,
  };
};

function ActivityAuditPanel({ apiFetch, canAccess, isActive }) {
  const [filters, setFilters] = useState({ session_id: "", cleanup_type: "", status: "", limit: "20" });
  const [cleanupDraft, setCleanupDraft] = useState({ session_id: "", cleanup_type: "", run_id: "", preserve_session_config: true });
  const [cleanupPreview, setCleanupPreview] = useState(null);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [audit, setAudit] = useState({ items: [], total: 0, limit: 20, offset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadedRef = useRef(false);
  const canManageUsers = typeof canAccess === "function" && canAccess("users:manage");

  const updateFilter = (name, value) => {
    setFilters((prev) => ({ ...prev, [name]: sanitizeText(value, { maxLength: 120 }) }));
  };

  const updateCleanupDraft = (name, value) => {
    setCleanupDraft((prev) => ({
      ...prev,
      [name]: name === "preserve_session_config" ? !!value : sanitizeText(value, { maxLength: 160 }),
    }));
    setCleanupMessage("");
  };

  const buildCleanupPayload = (dryRun) => {
    const sessionId = sanitizeGraphEndpointId(cleanupDraft.session_id, { maxLength: 128 });
    const runId = sanitizeGraphEndpointId(cleanupDraft.run_id, { maxLength: 128 });
    const cleanupType = sanitizeGraphEndpointId(cleanupDraft.cleanup_type, { maxLength: 40 });
    const payload = {
      id: "cleanup_session",
      session_id: sessionId,
      reason: dryRun ? "admin_cleanup_preview" : "admin_manual_cleanup",
      dry_run: dryRun,
      preserve_session_config: cleanupDraft.preserve_session_config !== false,
    };

    if (cleanupType) payload.cleanup_type = cleanupType;
    if (runId) payload.run_id = runId;
    return payload;
  };

  const submitCleanup = async (dryRun) => {
    if (!apiFetch || !canManageUsers) return;
    const payload = buildCleanupPayload(dryRun);
    const cleanupValidation = validateSchema(payload, cleanupRequestSchema);
    if (!cleanupValidation.ok) {
      setError(cleanupValidation.message || "Provide a valid session ID before cleanup.");
      return;
    }
    payload.session_id = cleanupValidation.value.session_id;
    if (cleanupValidation.value.cleanup_type) payload.cleanup_type = cleanupValidation.value.cleanup_type;
    else delete payload.cleanup_type;
    if (cleanupValidation.value.run_id) payload.run_id = cleanupValidation.value.run_id;
    else delete payload.run_id;
    if (!dryRun && !window.confirm("Queue cleanup for " + (payload.run_id || payload.session_id) + "?")) return;

    setCleanupLoading(true);
    setError("");
    setCleanupMessage("");
    try {
      const data = await apiFetch("/admin/cleanup/session", {
        method: "POST",
        body: payload,
      });
      const results = data?.results || data || {};
      setCleanupPreview(results);
      setCleanupMessage(dryRun ? "Cleanup preview completed." : "Cleanup queued.");
      const nextFilters = { ...filters, session_id: payload.session_id || filters.session_id };
      setFilters(nextFilters);
      await loadAudit(0, nextFilters);
    } catch (err) {
      setError(err?.message || "Cleanup request failed.");
    } finally {
      setCleanupLoading(false);
    }
  };

  const loadAudit = useCallback(async (nextOffset = 0, nextFilters = filters) => {
    if (!apiFetch || !canManageUsers) return;
    const limit = Math.max(1, Math.min(Number.parseInt(nextFilters.limit, 10) || 20, 100));
    const offset = Math.max(0, Number.parseInt(nextOffset, 10) || 0);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    ["session_id", "cleanup_type", "status"].forEach((key) => {
      const value = String(nextFilters[key] || "").trim();
      if (value) params.set(key, value);
    });

    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/admin/audit/cleanup?" + params.toString(), { method: "GET" });
      setAudit(normalizeCleanupAuditResults(data));
      loadedRef.current = true;
    } catch (err) {
      setError(err?.message || "Could not load cleanup activity logs.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canManageUsers, filters]);

  useEffect(() => {
    if (!isActive || !canManageUsers || loadedRef.current) return;
    loadAudit(0, filters);
  }, [isActive, canManageUsers, loadAudit, filters]);

  if (!isActive) return null;

  if (!canManageUsers) {
    return (
      <div className="configurations_options_panel cleanup_audit_panel">
        <fieldset>
          <legend>Activity Log</legend>
          <p className="settings_hint">You need users:manage to view cleanup activity logs.</p>
        </fieldset>
      </div>
    );
  }

  const canGoPrev = audit.offset > 0 && !loading;
  const canGoNext = audit.offset + audit.items.length < audit.total && !loading;

  return (
    <div className="configurations_options_panel cleanup_audit_panel">
      <fieldset>
        <legend>Activity Log</legend>
        <div className="cleanup_manual_form">
          <label>Session ID<input type="text" value={cleanupDraft.session_id} onChange={(event) => updateCleanupDraft("session_id", event.target.value)} placeholder="1_815493" /></label>
          <label>Cleanup type
            <select value={cleanupDraft.cleanup_type} onChange={(event) => updateCleanupDraft("cleanup_type", event.target.value)}>
              <option value="">Auto</option>
              <option value="session">Session</option>
              <option value="session_tree">Session tree</option>
              <option value="window">Window</option>
              <option value="run">Run</option>
              <option value="neo4j_session">Neo4j session</option>
            </select>
          </label>
          <label>Run ID<input type="text" value={cleanupDraft.run_id} onChange={(event) => updateCleanupDraft("run_id", event.target.value)} placeholder="Optional" /></label>
          <label className="settings_inline_check"><input type="checkbox" checked={cleanupDraft.preserve_session_config !== false} onChange={(event) => updateCleanupDraft("preserve_session_config", event.target.checked)} /> Preserve config</label>
        </div>
        <div className="cleanup_audit_actions">
          <button type="button" className="action_btns" onClick={() => submitCleanup(true)} disabled={cleanupLoading}>{cleanupLoading ? "Working..." : "Preview cleanup"}</button>
          <button type="button" className="critical_btns" onClick={() => submitCleanup(false)} disabled={cleanupLoading}>{cleanupLoading ? "Working..." : "Queue cleanup"}</button>
          {cleanupMessage && <span>{cleanupMessage}</span>}
        </div>
        {cleanupPreview && <div className="cleanup_preview_result"><span>Type: <b>{cleanupPreview.cleanup_type || "auto"}</b></span><span>Status: <b>{cleanupPreview.status || "unknown"}</b></span><span>Dry run: <b>{cleanupPreview.dry_run ? "yes" : "no"}</b></span>{cleanupPreview.cleanup_id && <span>Cleanup ID: <b>{cleanupPreview.cleanup_id}</b></span>}</div>}
        <div className="cleanup_audit_filters">
          <label>Session ID<input type="text" value={filters.session_id} onChange={(event) => updateFilter("session_id", event.target.value)} placeholder="1_895258" /></label>
          <label>Cleanup type<input type="text" value={filters.cleanup_type} onChange={(event) => updateFilter("cleanup_type", event.target.value)} placeholder="window" /></label>
          <label>Status<input type="text" value={filters.status} onChange={(event) => updateFilter("status", event.target.value)} placeholder="succeeded" /></label>
          <label>Limit<input type="number" min="1" max="100" value={filters.limit} onChange={(event) => updateFilter("limit", event.target.value)} /></label>
        </div>
        <div className="cleanup_audit_actions">
          <button type="button" className="action_btns" onClick={() => loadAudit(0, filters)} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
          <button type="button" className="action_btns" onClick={() => loadAudit(Math.max(0, audit.offset - audit.limit), filters)} disabled={!canGoPrev}>Prev</button>
          <button type="button" className="action_btns" onClick={() => loadAudit(audit.offset + audit.limit, filters)} disabled={!canGoNext}>Next</button>
          <span>{audit.total ? audit.offset + 1 : 0}-{audit.offset + audit.items.length} of {audit.total}</span>
        </div>
        {error && <div className="settings_error">{error}</div>}
        <div className="cleanup_audit_table_wrap">
          <table className="cleanup_audit_table">
            <thead>
              <tr><th>Created</th><th>Session</th><th>Type</th><th>Status</th><th>Owner</th><th>Artifacts</th><th>Error</th></tr>
            </thead>
            <tbody>
              {audit.items.length === 0 && !loading ? (
                <tr><td colSpan="7">No cleanup activity found.</td></tr>
              ) : audit.items.map((item) => (
                <tr key={item.id || item.created_at || item.session_id}>
                  <td>{formatAuditDate(item.created_at || item.started_at)}</td>
                  <td title={item.session_id || ""}>{item.session_id || "-"}</td>
                  <td>{item.cleanup_type || "-"}</td>
                  <td><span className={'cleanup_audit_status cleanup_audit_status_' + String(item.status || "unknown").toLowerCase()}>{item.status || "unknown"}</span></td>
                  <td>{item.session?.owner_user_id ?? "-"}</td>
                  <td>{item.artifacts?.deleted_count ?? 0}/{item.artifacts?.count ?? 0}</td>
                  <td title={item.error_message || ""}>{item.error_message || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>
    </div>
  );
}
function PermissionGate({ permission, canAccess, children, fallback = null }) {
  return canAccess(permission) ? children : fallback;
}

function PermissionEditor({ value = [], onChange, idPrefix = "permissions" }) {
  const permissionGroups = [
    { label: "Session", items: ["session:create", "session:read"] },
    { label: "Config", items: ["config:read", "config:write"] },
    { label: "Source", items: ["source:create", "source:connect", "source:disconnect"] },
    { label: "Graph", items: ["graph:create", "graph:read", "graph:link"] },
    { label: "Batch", items: ["batch:upload", "batch:query"] },
    { label: "Analysis", items: ["analysis:run"] },
    { label: "Reports", items: ["reports:read"] },
    { label: "Admin", items: ["users:manage"] },
    { label: "Auth", items: ["auth:verify"] },
  ];
  const selected = new Set(Array.isArray(value) ? value : []);
  const togglePermission = (permission) => {
    const next = new Set(selected);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange(sanitizePermissionList(Array.from(next).sort()));
  };
  return (
    <div className="permission_editor">
      {permissionGroups.map((group) => (
        <fieldset className="permission_group" key={group.label}>
          <legend>{group.label}</legend>
          {group.items.map((permission) => {
            const inputId = idPrefix + "_" + permission.replace(/[^a-z0-9]/gi, "_");
            return (
              <label className="permission_option" htmlFor={inputId} key={permission}>
                <input id={inputId} type="checkbox" checked={selected.has(permission)} onChange={() => togglePermission(permission)} />
                <span>{permission}</span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

const normalizeServiceAccountList = (data) => {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.service_accounts) ? data.service_accounts : Array.isArray(data?.data) ? data.data : [];
  return raw.map((account) => ({
    ...account,
    id: account.id ?? account.client_id,
    client_id: account.client_id || account.username || "",
    display_name: account.display_name || account.name || account.client_id || "",
    is_active: account.is_active !== false,
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
  }));
};
const extractServiceSecret = (data) => (data?.client_secret || data?.secret || data?.results?.client_secret || data?.results?.secret || data?.service_account?.client_secret || data?.service_account?.secret || "");
const generateClientSecret = () => {
  const bytes = new Uint8Array(24);
  window.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
};

function CurrentActorPanel({ actor, roles = [], permissions = [], sessionId, onLogout }) {
  const actorType = actor?.actor_type || (actor?.client_id ? "service" : "user");
  const actorName = actorType === "service" ? actor?.client_id : actor?.username;
  return (
    <div className="settings_admin_panel">
      <fieldset><legend>Current Actor</legend><div className="profile_grid"><span>Actor type</span><b>{actorType || "unknown"}</b><span>Identifier</span><b>{actorName || "unknown"}</b><span>Display name</span><b>{actor?.display_name || actorName || "unknown"}</b><span>Linkx session</span><b>{sessionId || "not initialized"}</b></div><div className="settings_action_row"><button type="button" className="profile_logout_btn" onClick={onLogout}>Logout</button></div></fieldset>
      <fieldset><legend>Roles</legend><div className="token_list">{(roles.length ? roles : ["none"]).map((role) => <span key={role}>{role}</span>)}</div></fieldset>
      <fieldset><legend>Permissions</legend><div className="token_list">{(permissions.length ? permissions : ["none"]).map((permission) => <span key={permission}>{permission}</span>)}</div></fieldset>
    </div>
  );
}

function ServiceSecretNotice({ secret, onClear }) {
  if (!secret) return null;
  return <div className="service_secret_notice"><div><b>New client secret</b><p>Copy this now. It will not be shown again.</p></div><code>{secret}</code><button type="button" onClick={() => navigator.clipboard?.writeText(secret)}>Copy</button><button type="button" onClick={onClear}>Dismiss</button></div>;
}


const normalizeAdminUserList = (data) => {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.users) ? data.users : Array.isArray(data?.data) ? data.data : [];
  return raw.map((item) => ({
    ...item,
    id: item.id ?? item.username,
    username: item.username || "",
    display_name: item.display_name || item.name || item.username || "",
    roles: Array.isArray(item.roles) ? item.roles : [],
    permissions: Array.isArray(item.permissions) ? item.permissions : [],
    is_active: item.is_active !== false,
  }));
};

function UserManagementPanel({ apiFetch, canManageUsers, canManageSuperusers, onNotice, isActive }) {
  const availableRoles = canManageSuperusers ? ["superuser", "admin", "analyst", "viewer"] : ["analyst", "viewer"];
  const emptyDraft = { username: "", password: "", display_name: "", roles: [availableRoles[0]], is_active: true, permissions: [] };
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editDrafts, setEditDrafts] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    if (!canManageUsers) return;
    setLoading(true);
    setError("");
    try {
      const data = await apiFetch("/auth/admin/users", { method: "GET" });
      const normalized = normalizeAdminUserList(data);
      setUsers(normalized);
      setEditDrafts(Object.fromEntries(normalized.map((user) => [String(user.id), {
        display_name: user.display_name,
        roles: user.roles,
        permissions: user.permissions,
        is_active: user.is_active,
        password: "",
      }])));
    } catch (err) {
      setError(err?.message || "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canManageUsers]);

  useEffect(() => {
    if (isActive && canManageUsers) loadUsers();
  }, [isActive, canManageUsers, loadUsers]);

  useEffect(() => {
    setDraft((prev) => ({ ...prev, roles: prev.roles.filter((role) => availableRoles.includes(role)).length ? prev.roles.filter((role) => availableRoles.includes(role)) : [availableRoles[0]] }));
  }, [canManageSuperusers]);

  const updateEditDraft = (id, patch) => setEditDrafts((prev) => ({ ...prev, [String(id)]: { ...(prev[String(id)] || {}), ...patch } }));
  const toggleRole = (roles, role) => {
    const next = new Set(Array.isArray(roles) ? roles : []);
    if (next.has(role)) next.delete(role);
    else next.add(role);
    return Array.from(next).filter((item) => availableRoles.includes(item));
  };

  const createUser = async () => {
    const payload = {
      username: sanitizeIdentifier(draft.username, { maxLength: 120 }).trim(),
      password: sanitizeSecret(draft.password, { maxLength: 256 }),
      display_name: sanitizeText(draft.display_name, { maxLength: 120 }).trim(),
      roles: sanitizeRoleList(draft.roles, availableRoles),
      permissions: sanitizePermissionList(draft.permissions),
      is_active: !!draft.is_active,
    };
    const validationError = compactValidationErrors(
      validateRequiredIdentifier(payload.username, "Username", { minLength: 3, maxLength: 120 }),
      validateNewPassword(payload.password, { required: true }),
      validateDisplayName(payload.display_name),
      payload.roles.length ? "" : "At least one allowed role is required.",
    );
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError("");
    try {
      await apiFetch("/auth/admin/users", { method: "POST", body: payload });
      setDraft(emptyDraft);
      onNotice?.({ title: "User created", message: payload.username + " was created.", source: "Admin", level: "success" });
      await loadUsers();
    } catch (err) {
      setError(err?.message || "Failed to create user.");
    } finally {
      setSaving(false);
    }
  };

  const saveUser = async (user) => {
    const draftPatch = { ...(editDrafts[String(user.id)] || {}) };
    const patch = {
      display_name: sanitizeText(draftPatch.display_name, { maxLength: 120 }).trim(),
      roles: sanitizeRoleList(draftPatch.roles, availableRoles),
      permissions: sanitizePermissionList(draftPatch.permissions),
      is_active: !!draftPatch.is_active,
    };
    if (draftPatch.password) patch.password = sanitizeSecret(draftPatch.password, { maxLength: 256 });
    const validationError = compactValidationErrors(
      validateDisplayName(patch.display_name),
      validateNewPassword(patch.password || "", { required: false }),
      patch.roles.length ? "" : "At least one allowed role is required.",
    );
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    setError("");
    try {
      await apiFetch("/auth/admin/users/" + encodeURIComponent(user.id), { method: "PATCH", body: patch });
      onNotice?.({ title: "User updated", message: user.username + " was updated.", source: "Admin", level: "success" });
      await loadUsers();
    } catch (err) {
      setError(err?.message || "Failed to update user.");
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (user) => {
    if (!window.confirm("Delete user " + user.username + "?")) return;
    setSaving(true);
    setError("");
    try {
      await apiFetch("/auth/admin/users/" + encodeURIComponent(user.id), { method: "DELETE" });
      onNotice?.({ title: "User deleted", message: user.username + " was removed.", source: "Admin", level: "warning" });
      await loadUsers();
    } catch (err) {
      setError(err?.message || "Failed to delete user.");
    } finally {
      setSaving(false);
    }
  };

  if (!canManageUsers) return <div className="settings_admin_panel"><fieldset><legend>Users</legend><p className="settings_hint">You need users:manage to manage users.</p></fieldset></div>;

  return (
    <div className="settings_admin_panel">
      {error && <div className="settings_error">{error}</div>}
      <fieldset><legend>Create User</legend><div className="service_account_form_grid"><label>Username<input className="settings_textinput" value={draft.username} maxLength={120} onChange={(event) => setDraft((prev) => ({ ...prev, username: sanitizeIdentifier(event.target.value, { maxLength: 120 }) }))} /></label><label>Display name<input className="settings_textinput" value={draft.display_name} maxLength={120} onChange={(event) => setDraft((prev) => ({ ...prev, display_name: sanitizeText(event.target.value, { maxLength: 120 }) }))} /></label><label>Password<input className="settings_textinput" type="password" value={draft.password} maxLength={256} onChange={(event) => setDraft((prev) => ({ ...prev, password: sanitizeSecret(event.target.value, { maxLength: 256 }) }))} /></label><label className="settings_inline_check"><input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((prev) => ({ ...prev, is_active: event.target.checked }))} /> Active</label></div><div className="role_editor">{availableRoles.map((role) => <label key={role} className="permission_option"><input type="checkbox" checked={draft.roles.includes(role)} onChange={() => setDraft((prev) => ({ ...prev, roles: toggleRole(prev.roles, role) }))} /> <span>{role}</span></label>)}</div><PermissionEditor value={draft.permissions} onChange={(permissions) => setDraft((prev) => ({ ...prev, permissions: sanitizePermissionList(permissions) }))} idPrefix="new_user_permissions" /><div className="settings_action_row"><button type="button" onClick={createUser} disabled={saving}>Create user</button></div></fieldset>
      <fieldset><legend>Existing Users</legend><div className="settings_action_row"><button type="button" onClick={loadUsers} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button></div>{users.length === 0 && <p className="settings_hint">No users found.</p>}{users.map((user) => { const editDraft = editDrafts[String(user.id)] || { display_name: user.display_name, roles: user.roles, permissions: user.permissions, is_active: user.is_active, password: "" }; return <div className="service_account_card" key={user.id}><div className="service_account_card_header"><div><b>{user.username}</b><span>{(user.roles || []).join(", ") || "no role"} · {user.is_active ? "Active" : "Inactive"}</span></div><div className="service_account_actions"><button type="button" onClick={() => saveUser(user)} disabled={saving}>Save</button><button type="button" className="critical_btns" onClick={() => deleteUser(user)} disabled={saving}>Delete</button></div></div><label>Display name<input className="settings_textinput" value={editDraft.display_name || ""} maxLength={120} onChange={(event) => updateEditDraft(user.id, { display_name: sanitizeText(event.target.value, { maxLength: 120 }) })} /></label><label>Password reset<input className="settings_textinput" type="password" value={editDraft.password || ""} maxLength={256} placeholder="Leave blank to keep current password" onChange={(event) => updateEditDraft(user.id, { password: sanitizeSecret(event.target.value, { maxLength: 256 }) })} /></label><label className="settings_inline_check"><input type="checkbox" checked={!!editDraft.is_active} onChange={(event) => updateEditDraft(user.id, { is_active: event.target.checked })} /> Active</label><div className="role_editor">{availableRoles.map((role) => <label key={role} className="permission_option"><input type="checkbox" checked={(editDraft.roles || []).includes(role)} onChange={() => updateEditDraft(user.id, { roles: toggleRole(editDraft.roles, role) })} /> <span>{role}</span></label>)}</div><PermissionEditor value={editDraft.permissions || []} onChange={(permissions) => updateEditDraft(user.id, { permissions: sanitizePermissionList(permissions) })} idPrefix={"user_" + user.id + "_permissions"} /></div>; })}</fieldset>
    </div>
  );
}

function ServiceAccountsPanel({ apiFetch, canManageUsers, onNotice, isActive }) {
  const emptyDraft = { client_id: "", client_secret: generateClientSecret(), display_name: "", is_active: true, permissions: [] };
  const [accounts, setAccounts] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [editDrafts, setEditDrafts] = useState({});
  const [newSecret, setNewSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const loadAccounts = useCallback(async () => {
    if (!canManageUsers) return;
    setLoading(true); setError("");
    try {
      const data = await apiFetch("/auth/admin/service-accounts", { method: "GET" });
      const normalized = normalizeServiceAccountList(data);
      setAccounts(normalized);
      setEditDrafts(Object.fromEntries(normalized.map((account) => [String(account.id), { display_name: account.display_name, is_active: account.is_active, permissions: account.permissions }])));
    } catch (err) { setError(err?.message || "Failed to load service accounts."); }
    finally { setLoading(false); }
  }, [apiFetch, canManageUsers]);
  useEffect(() => { if (isActive && canManageUsers) loadAccounts(); }, [isActive, canManageUsers, loadAccounts]);
  const updateEditDraft = (id, patch) => setEditDrafts((prev) => ({ ...prev, [String(id)]: { ...(prev[String(id)] || {}), ...patch } }));
  const createAccount = async () => {
    const clientSecret = sanitizeSecret(draft.client_secret || generateClientSecret(), { maxLength: 128 });
    const payload = {
      client_id: sanitizeIdentifier(draft.client_id, { maxLength: 80 }).trim(),
      client_secret: clientSecret,
      display_name: sanitizeText(draft.display_name, { maxLength: 120 }).trim(),
      is_active: !!draft.is_active,
      permissions: sanitizePermissionList(draft.permissions),
    };
    const validationError = compactValidationErrors(
      validateRequiredIdentifier(payload.client_id, "Client ID", { minLength: 3, maxLength: 80 }),
      validateClientSecret(payload.client_secret),
      validateDisplayName(payload.display_name),
    );
    if (validationError) { setError(validationError); return; }
    setSaving(true); setError("");
    try {
      const data = await apiFetch("/auth/admin/service-accounts", { method: "POST", body: payload });
      setNewSecret(extractServiceSecret(data) || clientSecret); setDraft({ ...emptyDraft, client_secret: generateClientSecret() });
      onNotice?.({ title: "Service account created", message: "Copy the generated secret before closing this panel.", source: "Admin", level: "success" });
      await loadAccounts();
    } catch (err) { setError(err?.message || "Failed to create service account."); }
    finally { setSaving(false); }
  };
  const saveAccount = async (account) => {
    const draftPatch = editDrafts[String(account.id)] || {};
    const patch = {
      display_name: sanitizeText(draftPatch.display_name, { maxLength: 120 }).trim(),
      is_active: !!draftPatch.is_active,
      permissions: sanitizePermissionList(draftPatch.permissions),
    };
    const validationError = validateDisplayName(patch.display_name);
    if (validationError) { setError(validationError); return; }
    setSaving(true); setError("");
    try { await apiFetch("/auth/admin/service-accounts/" + encodeURIComponent(account.id), { method: "PATCH", body: patch }); onNotice?.({ title: "Service account updated", message: account.client_id + " was updated.", source: "Admin", level: "success" }); await loadAccounts(); }
    catch (err) { setError(err?.message || "Failed to update service account."); }
    finally { setSaving(false); }
  };
  const rotateSecret = async (account) => {
    if (!window.confirm("Rotate secret for " + account.client_id + "? The old secret should stop being used by sibling services.")) return;
    setSaving(true); setError("");
    try { const rotatedSecret = sanitizeSecret(generateClientSecret(), { maxLength: 128 }); const secretError = validateClientSecret(rotatedSecret); if (secretError) { setError(secretError); return; } const data = await apiFetch("/auth/admin/service-accounts/" + encodeURIComponent(account.id), { method: "PATCH", body: { rotate_secret: true, client_secret: rotatedSecret } }); setNewSecret(extractServiceSecret(data) || rotatedSecret); onNotice?.({ title: "Secret rotated", message: "Copy the new secret now. It will not be shown again.", source: "Admin", level: "warning" }); await loadAccounts(); }
    catch (err) { setError(err?.message || "Failed to rotate secret."); }
    finally { setSaving(false); }
  };
  const deleteAccount = async (account) => {
    if (!window.confirm("Delete service account " + account.client_id + "?")) return;
    setSaving(true); setError("");
    try { await apiFetch("/auth/admin/service-accounts/" + encodeURIComponent(account.id), { method: "DELETE" }); onNotice?.({ title: "Service account deleted", message: account.client_id + " was removed.", source: "Admin", level: "warning" }); await loadAccounts(); }
    catch (err) { setError(err?.message || "Failed to delete service account."); }
    finally { setSaving(false); }
  };
  if (!canManageUsers) return <div className="settings_admin_panel"><fieldset><legend>Service Accounts</legend><p className="settings_hint">You need users:manage to manage service accounts.</p></fieldset></div>;
  return (
    <div className="settings_admin_panel">
      <ServiceSecretNotice secret={newSecret} onClear={() => setNewSecret("")} />{error && <div className="settings_error">{error}</div>}
      <fieldset><legend>Create Service Account</legend><div className="service_account_form_grid"><label>Client ID<input className="settings_textinput" value={draft.client_id} maxLength={80} onChange={(event) => setDraft((prev) => ({ ...prev, client_id: sanitizeIdentifier(event.target.value, { maxLength: 80 }) }))} /></label><label>Display name<input className="settings_textinput" value={draft.display_name} maxLength={120} onChange={(event) => setDraft((prev) => ({ ...prev, display_name: sanitizeText(event.target.value, { maxLength: 120 }) }))} /></label><label>Client secret<input className="settings_textinput" value={draft.client_secret} maxLength={128} onChange={(event) => setDraft((prev) => ({ ...prev, client_secret: sanitizeSecret(event.target.value, { maxLength: 128 }) }))} /></label><label className="settings_inline_check"><input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((prev) => ({ ...prev, is_active: event.target.checked }))} /> Active</label></div><PermissionEditor value={draft.permissions} onChange={(permissions) => setDraft((prev) => ({ ...prev, permissions: sanitizePermissionList(permissions) }))} idPrefix="new_service_permissions" /><div className="settings_action_row"><button type="button" onClick={createAccount} disabled={saving}>Create service account</button></div></fieldset>
      <fieldset><legend>Existing Service Accounts</legend><div className="settings_action_row"><button type="button" onClick={loadAccounts} disabled={loading}>{loading ? "Refreshing..." : "Refresh"}</button></div>{accounts.length === 0 && <p className="settings_hint">No service accounts found.</p>}{accounts.map((account) => { const editDraft = editDrafts[String(account.id)] || { display_name: account.display_name, is_active: account.is_active, permissions: account.permissions }; return <div className="service_account_card" key={account.id}><div className="service_account_card_header"><div><b>{account.client_id}</b><span>{account.is_active ? "Active" : "Inactive"}</span></div><div className="service_account_actions"><button type="button" onClick={() => saveAccount(account)} disabled={saving}>Save</button><button type="button" onClick={() => rotateSecret(account)} disabled={saving}>Rotate secret</button><button type="button" className="critical_btns" onClick={() => deleteAccount(account)} disabled={saving}>Delete</button></div></div><label>Display name<input className="settings_textinput" value={editDraft.display_name || ""} maxLength={120} onChange={(event) => updateEditDraft(account.id, { display_name: sanitizeText(event.target.value, { maxLength: 120 }) })} /></label><label className="settings_inline_check"><input type="checkbox" checked={!!editDraft.is_active} onChange={(event) => updateEditDraft(account.id, { is_active: event.target.checked })} /> Active</label><PermissionEditor value={editDraft.permissions || []} onChange={(permissions) => updateEditDraft(account.id, { permissions: sanitizePermissionList(permissions) })} idPrefix={"service_" + account.id + "_permissions"} /></div>; })}</fieldset>
    </div>
  );
}

function IntegrationContractPanel() {
  const integrationDocHref = `docs/integration_contract.md`;
  return <div className="settings_admin_panel"><fieldset><legend>Integration Contract</legend><p className="settings_hint">Backend service account API details are documented for sibling-service developers.</p><a className="settings_doc_link" href={integrationDocHref} target="_blank" rel="noreferrer">Open integration_contract.md</a></fieldset><fieldset><legend>Frontend Contract Notes</legend><div className="profile_grid"><span>Auth token</span><b>Stored separately as linkx_auth_token</b><span>Linkx session</span><b>Stored separately as session</b><span>Socket auth</span><b>io(API_URL, auth token)</b><span>Forbidden handling</span><b>Central apiFetch shows 403 notices</b></div></fieldset></div>;
}

function Settings({ isSettingsOpen, toggleAction, actor, roles = [], permissions = [], canAccess, apiFetch, sessionId, onNotice, onLogout, areBackgroundAnimationsEnabled = true, onBackgroundAnimationsChange }) {
  const [activeSettingsTab, setActiveSettingsTab] = useState("profile");
  const [rememberLayout, setRememberLayout] = useState(true);
  const [enableNotifications, setEnableNotifications] = useState(true);
  const canManageUsers = canAccess("users:manage");
  const canManageSuperusers = canAccess("superuser:manage");
  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "preferences", label: "Preferences" },
    { id: "users", label: "Users", permission: "users:manage" },
    { id: "service_accounts", label: "Service Accounts", permission: "users:manage" },
    { id: "integration", label: "Integration" },
  ];

  useEffect(() => {
    if ((activeSettingsTab === "service_accounts" || activeSettingsTab === "users") && !canManageUsers) {
      setActiveSettingsTab("profile");
    }
  }, [activeSettingsTab, canManageUsers]);

  return (
    <div id="configurations_container" style={{ display: isSettingsOpen ? "block" : "none" }}>
      <div className="configurations_options_container settings_options_container">
        <div className="configurations_options_container_bar">
          <span onClick={() => toggleAction("settings")}>x</span>
          <label>Settings</label>
        </div>
        <div className="configurations_options">
          <div className="configurations_tabs">
            {tabs.filter((tab) => !tab.permission || canAccess(tab.permission)).map((tab) => (
              <button key={tab.id} type="button" className={activeSettingsTab === tab.id ? "active" : ""} onClick={() => setActiveSettingsTab(tab.id)}>
                {tab.label}
              </button>
            ))}
          </div>
          <form className="configurations_tab_form" onSubmit={(event) => event.preventDefault()}>
            <div className="configurations_options_panel" style={{ display: activeSettingsTab === "profile" ? "block" : "none" }}>
              <CurrentActorPanel actor={actor} roles={roles} permissions={permissions} sessionId={sessionId} onLogout={onLogout} />
            </div>
            <div className="configurations_options_panel" style={{ display: activeSettingsTab === "preferences" ? "block" : "none" }}>
              <fieldset>
                <legend>Preferences</legend>
                <label>Workspace</label>
                <input type="checkbox" id="pref_remember_layout" className="input_checkbox" checked={rememberLayout} onChange={() => setRememberLayout((prev) => !prev)} />
                <label htmlFor="pref_remember_layout" className="sublabel">Remember window layout</label>
                <input type="checkbox" id="pref_enable_notifications" className="input_checkbox" checked={enableNotifications} onChange={() => setEnableNotifications((prev) => !prev)} />
                <label htmlFor="pref_enable_notifications" className="sublabel">Enable notifications</label>
                <input type="checkbox" id="pref_enable_background_animations" className="input_checkbox" checked={areBackgroundAnimationsEnabled} onChange={(event) => onBackgroundAnimationsChange?.(event.target.checked)} />
                <label htmlFor="pref_enable_background_animations" className="sublabel">Enable animations</label>
              </fieldset>
            </div>
            <div className="configurations_options_panel" style={{ display: activeSettingsTab === "users" ? "block" : "none" }}>
              <PermissionGate permission="users:manage" canAccess={canAccess} fallback={<p className="settings_hint">You need users:manage to open this panel.</p>}>
                <UserManagementPanel apiFetch={apiFetch} canManageUsers={canManageUsers} canManageSuperusers={canManageSuperusers} onNotice={onNotice} isActive={activeSettingsTab === "users"} />
              </PermissionGate>
            </div>
            <div className="configurations_options_panel" style={{ display: activeSettingsTab === "service_accounts" ? "block" : "none" }}>
              <PermissionGate permission="users:manage" canAccess={canAccess} fallback={<p className="settings_hint">You need users:manage to open this panel.</p>}>
                <ServiceAccountsPanel apiFetch={apiFetch} canManageUsers={canManageUsers} onNotice={onNotice} isActive={activeSettingsTab === "service_accounts"} />
              </PermissionGate>
            </div>
            <div className="configurations_options_panel" style={{ display: activeSettingsTab === "integration" ? "block" : "none" }}>
              <IntegrationContractPanel />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
function WindowVerticalSplitPanels({id, type, sourceId, initialTopHeight, minTopHeight, maxTopHeight, graphStatus, graphStatusBySession, graphRenderStats, activeGraph, graphAction, iframeRef, iframeSearch, iframeSettings, performanceMood, selectedPropertyTab, nodeProperties, filterPropertyKeys, filterResults}) {
  const containerRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [topHeightPx, setTopHeightPx] = useState(0);
  const isDragging = useRef(false);
  const minHeightPx = useRef(0);
  const maxHeightPx = useRef(0);

  const settings = normalizeGraphIframeSettings(iframeSettings[id]);
  const search = Array.isArray(iframeSearch[id]) ? iframeSearch[id] : ["", false, {}, { nodes: 0, edges: 0 }];
  const relationships = activeGraph === "graph_placeholder" ? [] : normalizeGraphRelationships(graphStatus);
  const renderedGraphStats = graphRenderStats && typeof graphRenderStats === "object" ? graphRenderStats : {};
  const graphNodeCount = Number(
    renderedGraphStats.visible_nodes ??
    renderedGraphStats.total_nodes ??
    renderedGraphStats.nodes ??
    0
  );
  const physicsSettingDisabled = !activeGraph || graphNodeCount >= 300;
  const hierarchicalLayoutDisabled = !activeGraph || graphNodeCount >= 300;
  const selectedSearchKeysCount = Object.values(search[2] || {}).filter(Boolean).length;

  const limitRange = normalizeGraphLimitRange(settings?.[2], 25);
  const [limitMinDraft, setLimitMinDraft] = useState(String(limitRange.min));
  const [limitMaxDraft, setLimitMaxDraft] = useState(String(limitRange.max));
  const isEditingLimitMin = useRef(false);
  const isEditingLimitMax = useRef(false);

  useEffect(() => {
    if (!isEditingLimitMin.current) setLimitMinDraft(String(limitRange.min));
    if (!isEditingLimitMax.current) setLimitMaxDraft(String(limitRange.max));
  }, [limitRange.min, limitRange.max]);

  const commitLimitRange = (rawMin, rawMax, options = {}) => {
    const syncDraft = options.syncDraft !== false;
    const parsedMin = Number.parseInt(String(rawMin ?? "").trim(), 10);
    const parsedMax = Number.parseInt(String(rawMax ?? "").trim(), 10);
    const nextMin = Number.isFinite(parsedMin) ? parsedMin : limitRange.min;
    const nextMax = Number.isFinite(parsedMax) ? parsedMax : limitRange.max;
    const normalized = normalizeGraphLimitRange({ min: nextMin, max: nextMax }, limitRange.max);

    if (normalized.max > GRAPH_LIMIT_WARNING_THRESHOLD && limitRange.max <= GRAPH_LIMIT_WARNING_THRESHOLD) {
      window.alert("Setting Limit > 300 Might be unstable.");
    }

    if (syncDraft) {
      setLimitMinDraft(String(normalized.min));
      setLimitMaxDraft(String(normalized.max));
    }

    graphAction(id, "properties_tab", "settings", {
      iframe: iframeRef,
      settings: "limit_nodes_amount",
      state: {
        key: String(settings[0]) || "",
        sort: String(settings[1]) || "asc",
        amount: normalized
      },
    });
  };

  // Update container height
  useEffect(() => {
    const updateContainerHeight = () => {
      if (containerRef.current) {
        setContainerHeight(containerRef.current.clientHeight);
      }
    };
    updateContainerHeight();
    window.addEventListener('resize', updateContainerHeight);
    return () => window.removeEventListener('resize', updateContainerHeight);
  }, []);
  // Parse function 
  function parseSize(size, containerSize) { // This function is used to estimate the percentile relative to number base
  if (typeof size === 'string' && size.trim().endsWith('%')) {
    const percent = parseFloat(size);
    return (percent / 100) * containerSize;
  }
  return typeof size === 'number' ? size : 0;
  }
  // Parse sizes once (call the above function)
  useEffect(() => {
    if (containerHeight > 0) {
      const initHeight = parseSize(initialTopHeight, containerHeight);
      setTopHeightPx(initHeight);
      minHeightPx.current = parseSize(minTopHeight, containerHeight);
      maxHeightPx.current = parseSize(maxTopHeight, containerHeight);
    }
  }, [containerHeight, initialTopHeight, minTopHeight, maxTopHeight]);

  // when slider (separator) is grabed
  const handleMouseDown = () => {
    isDragging.current = true;
  };
  // when slider (separator) is released
  const handleMouseUp = () => {
    isDragging.current = false;
  };
  // when slider (separator) is dragged
  const handleMouseMove = (e) => {
    if (!isDragging.current) return;
    const containerTop = containerRef.current.getBoundingClientRect().top;
    const newHeight = e.clientY - containerTop;
    if (newHeight < minHeightPx.current) {
      setTopHeightPx(minHeightPx.current);
    } else if (newHeight > maxHeightPx.current) {
      setTopHeightPx(maxHeightPx.current);
    } else {
      setTopHeightPx(newHeight);
    }
  };
  // Attaching global listeners to call the above event functions (grabing,releasing,dragginf)
  useEffect(() => {
    const handleMouseUpGlobal = () => handleMouseUp();
    const handleMouseMoveGlobal = (e) => handleMouseMove(e);
    document.addEventListener('mouseup', handleMouseUpGlobal);
    document.addEventListener('mousemove', handleMouseMoveGlobal);
    return () => {
      document.removeEventListener('mouseup', handleMouseUpGlobal);
      document.removeEventListener('mousemove', handleMouseMoveGlobal);
    };
  }, []);
  useEffect(() => {
    if (!filterPropertyKeys) {
      graphAction(id, "properties_tab", "filter_keys", {
        iframe: iframeRef,
        filter: "all_property_keys",
        state: ""
      });
    }
  }, []);   // run only once
  useEffect(() => {
    if (!selectedPropertyTab) {
      graphAction(id, "properties_tab", "switch_tab", "graph_filters");
    }
  }, [id, selectedPropertyTab, graphAction]);


  //alert(filterPropertyKeys)
  const tabGroupName = `${type}_window_${id}_ppt_tab_radio`;

  // End result
  return (
    <div ref={containerRef} className="reference_container">
      {/* Top Panel */}
      <div className="top_panel" style={{height: topHeightPx}}>
        <div className="ppt_tabs_container">
          <input id={`${type}_window_${id}_filters_tab_radio`} name={tabGroupName} type="radio" checked={selectedPropertyTab === "graph_filters"} onChange={(e) => {graphAction(id, "properties_tab", "switch_tab", "graph_filters");}}/>
          <label htmlFor={`${type}_window_${id}_filters_tab_radio`} className="ppt_tabs" title="Graph filters">
            <i>
              <Icons id="properties_container" type="filter" condition="True"/>
            </i>
            <span>Filters</span>
          </label>
          <input id={`${type}_window_${id}_infos_tab_radio`}  name={tabGroupName} type="radio" checked={selectedPropertyTab === "graph_infos"} onChange={(e) => {graphAction(id, "properties_tab", "switch_tab", "graph_infos");}}/>
          <label htmlFor={`${type}_window_${id}_infos_tab_radio`} className="ppt_tabs" title="Nodes informations">
            <i>
              <Icons id="properties_container" type="info" condition="True"/>
            </i>
            <span>Infos</span>
          </label>
          <input id={`${type}_window_${id}_settings_tab_radio`} name={tabGroupName} type="radio" checked={selectedPropertyTab === "graph_settings"} onChange={(e) => {graphAction(id, "properties_tab", "switch_tab", "graph_settings");}}/>
          <label htmlFor={`${type}_window_${id}_settings_tab_radio`} className="ppt_tabs" title="Graph settings">
            <i>
              <Icons id="properties_container" type="settings" condition="True"/>
            </i>
            <span>Settings</span>
          </label>        
        </div>
        <div className="ppt_tabs_body_container">
          {selectedPropertyTab === "graph_filters" &&(
          <div id={`${type}_window_${id}_${iframeRef}_graph_filters`} className="graph_filters_container">
            <form className="filter_form"
                  onSubmit={(e) => {e.preventDefault();
                    const keyword = document.getElementById(
                      `${type}_window_${id}_${iframeRef}_graph_filters_input`
                    ).value;                    
                    const keys = Object.keys(search[2] || {}).filter(k => search[2][k] === true);
                    graphAction(id, "properties_tab", "search", {
                      iframe: iframeRef,
                      keyword,
                      option: search[1],
                      keys,
                      settings: settings
                    });
                  }}
                >
              <label className="filter_form_header_label">Search <i><b>Note :</b> Make sure an attribute name is selected for more specific results.</i></label>
                <div className="filter_form_search_container">
                  <input id={`${type}_window_${id}_${iframeRef}_graph_filters_input`} type="text" placeholder="Type here to seach" disabled={!activeGraph}/>
                  <button title="Search" disabled={!activeGraph}><Icons id="properties_container" type="search" condition="True"/></button>
                  <div className="filter_form_search_options_container">
                  <input id={`${type}_window_${id}_${iframeRef}_graph_filters_linked_option_input`} type="checkbox" title='Return the linked neighbours' checked={!!search[1]} onChange={(e) => graphAction(id, "properties_tab", "search_change", {componentId:1,value: e.target.checked})} disabled={!activeGraph}/>
                  <label htmlFor={`${type}_window_${id}_${iframeRef}_graph_filters_linked_option_input`} title='Return the linked neighbours'>Include linked nodes</label>
                </div>
                  <div className="filter_form_search_condition">
                    <span>
                      {selectedSearchKeysCount > 0
                        ? `Search from ${selectedSearchKeysCount} property key${selectedSearchKeysCount === 1 ? "" : "s"}.`
                        : "Search from all property keys."}
                    </span>
                    <button
                      type="button"
                      className="search_condition_reset_btn"
                      onClick={() => graphAction(id, "properties_tab", "search_change", { componentId: 2, value: "__reset__" })}
                      disabled={!activeGraph || selectedSearchKeysCount === 0}
                    >
                      Reset
                    </button>
                  </div>
                  <div className="filterPropertyKeys">       
                  {filterPropertyKeys && (
                    <div>
                      {filterPropertyKeys.map((key, index) => (
                        <span key={index}>
                          <input
                            id={`${type}_window_${id}_${iframeRef}_graph_filters_attribute_checkbox_${index}`}
                            type="checkbox"
                            value={key}
                            name={`${type}_window_${id}_${iframeRef}_graph_filters_key`}
                            checked={!!search[2]?.[key]}
                            onChange={(e) => graphAction(id, "properties_tab", "search_change", {componentId:2,value: key})}
                          />
                          <label htmlFor={`${type}_window_${id}_${iframeRef}_graph_filters_attribute_checkbox_${index}`}>{key}</label>
                        </span>
                      ))}
                    </div>
                  )}
                  </div>
                  <div className="filter_results">
                    <h4>Search Results</h4>
                    <span>
                      Nodes found <b>{search[3] ? search[3].nodes : 0}</b>
                    </span>
                    <span>
                      Edges found <b>{search[3] ? search[3].edges : 0}</b>
                    </span>
                  </div>                                                 
              </div>
            </form>
          </div>
          )}
          {selectedPropertyTab === "graph_infos" && (
            <div
              id={`${type}_window_${id}_${iframeRef}_graph_infos`}
              className="graph_infos_container"
            >
              <form className="infos_form">
                <label className="infos_form_header_label">Informations <i><b>Note :</b> Make sure to check the 'edit Informations' checkbox in Settings inorder to modify node properties.</i></label>
                {nodeProperties ? (
                  <div id="graph_infos" className="graph_options_infos">
                    <div>
                      <span><label>Key</label></span>
                      <span>Value</span>
                    </div>
                    {Object.entries(nodeProperties).map(([key, value]) => (
                      <div key={key}>
                        <span title={String(key)}><label>{key}</label></span>
                        <span title={String(value)}>{String(value)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                   <p>No Information to show.</p>
                )}
            </form>
            </div>
          )}
          {selectedPropertyTab === "graph_settings" &&(
          <div id={`${type}_window_${id}_${iframeRef}_graph_settings`} className="graph_settings_container">
            <form className="settings_form" onSubmit={(e) => { e.preventDefault();}}>
              <label className="setting_form_header_label">Settings <i><b>Note :</b> Analysis time settings are not stored.</i></label>
              <div className="settings_form_div_performance_mood">
                <label className="input_labels" htmlFor={`${type}_window_${id}_performance_mood`}>Performance mood</label>
                <input
                  id={`${type}_window_${id}_performance_mood`}
                  type="checkbox"
                  checked={!!performanceMood}
                  onChange={(e) => {
                    graphAction(id, "properties_tab", "settings", {
                      iframe: iframeRef,
                      settings: "performance_mode",
                      state: e.target.checked,
                    });
                  }}
                  disabled={!activeGraph}
                />
              </div>
              <div className="settings_form_div_firstChild">
                <label>Limit Nodes</label>
                {/* Key Selector */}
                {filterPropertyKeys && (
                  <select
                    className="select_option"
                    value={settings[0] || ""}
                    onChange={(e) => {
                      const payload = {
                        key: e.target.value,
                        sort: String(settings[1]) || "asc",
                        amount: { min: limitRange.min, max: limitRange.max }
                      };
                      graphAction(id, "properties_tab", "settings", {
                        iframe: iframeRef,
                        settings: "limit_nodes_key",
                        state: payload,
                      });
                    }}
                    disabled={!activeGraph}
                  >
                    {filterPropertyKeys.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                )}
                {/* Sort Selector */}
                <select
                  className="select_option"
                  style={{ width: "4vw" }}
                  value={settings[1] || "asc"}
                  onChange={(e) => {
                    const payload = {
                      key: String(settings[0]) || "",
                      sort: e.target.value,
                      amount: { min: limitRange.min, max: limitRange.max }
                    };
                    graphAction(id, "properties_tab", "settings", {
                      iframe: iframeRef,
                      settings: "limit_nodes_sort",
                      state: payload,
                    });
                  }}
                  disabled={!activeGraph}
                >
                  <option value="asc">Asc</option>
                  <option value="desc">Desc</option>
                </select>
                {/* Min/Max Inputs */}
                <label className='input_labels' style={{ padding: "0.2vw 0 0 0.5vw"}}>Range</label>
                <input
                  className="input_text"
                  id="graph_settings_limit_min"
                  type="number"
                  min="0"
                  max={String(GRAPH_LIMIT_HARD_MAX - 1)}
                  placeholder="Min"
                  value={limitMinDraft}
                  onChange={(e) => {
                    const rawMin = e.target.value;
                    setLimitMinDraft(rawMin);
                    commitLimitRange(rawMin, limitMaxDraft, { syncDraft: false });
                  }}
                  onFocus={() => { isEditingLimitMin.current = true; }}
                  onBlur={() => {
                    isEditingLimitMin.current = false;
                    commitLimitRange(limitMinDraft, limitMaxDraft);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  disabled={!activeGraph}
                />
                <span className="limit_range_separator">-</span>
                <input
                  className="input_text"
                  id="graph_settings_limit_max"
                  type="number"
                  min="1"
                  max={String(GRAPH_LIMIT_HARD_MAX)}
                  placeholder="Max"
                  value={limitMaxDraft}
                  onChange={(e) => {
                    const rawMax = e.target.value;
                    setLimitMaxDraft(rawMax);
                    commitLimitRange(limitMinDraft, rawMax, { syncDraft: false });
                  }}
                  onFocus={() => { isEditingLimitMax.current = true; }}
                  onBlur={() => {
                    isEditingLimitMax.current = false;
                    commitLimitRange(limitMinDraft, limitMaxDraft);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  disabled={!activeGraph}
                />
              </div>
              <div className="settings_form_div">
                <label className="input_labels">Label Group</label>
                <select
                    className="select_option"
                    value={settings[3] || ""}
                    onChange={(e) => {
                      graphAction(id, "properties_tab", "settings", {
                        iframe: iframeRef,
                        settings: "label_nodes_group",
                        state: e.target.value,
                      });
                    }}
                    disabled={!activeGraph}
                  >
                  <option value="Entity Node">Entity Nodes</option>
                  <option value="Source Node">Source Nodes</option>
                  <option value="Target Node">Target Nodes</option>
                </select>
              </div>
              <div className="settings_form_div">
                <label className="input_labels">Label nodes by</label>
                <select
                    className="select_option"
                    value={settings[4] || ""}
                    onChange={(e) => {
                      graphAction(id, "properties_tab", "settings", {
                        iframe: iframeRef,
                        settings: "label_nodes_by",
                        state: {
                          labelIdentity: settings[3],
                          labelkey: e.target.value,
                          filterKey: settings[0],
                          filterSort: settings[1],
                          limitAmount: { min: limitRange.min, max: limitRange.max }
                        },
                      });
                    }}
                    disabled={!activeGraph}
                  >
                  {filterPropertyKeys && filterPropertyKeys.map((key) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings_form_div">
                <label className="input_labels">Weight Edges by</label>
                <select
                  className="select_option"
                  value={settings[5] === true || settings[5] === "true" ? "default" : (settings[5] || "")}
                  onChange={(e) => {
                    graphAction(id, "properties_tab", "settings",
                      {
                        iframe: iframeRef,
                        settings: "weight_edges",
                        state: e.target.value,
                      });
                  }}
                  disabled={!activeGraph}
                >
                  <option value="">Off</option>
                  <option value="default">Default</option>
                  {filterPropertyKeys && filterPropertyKeys.map((key) => (
                    <option key={`edge-weight-${key}`} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>
              <div className="settings_form_div">                
                <label className="input_labels">Show Titles</label>
                <select className="select_option" value={settings[6] ? (settings[6]):("")} onChange={(e) => {graphAction(id, "properties_tab", "settings", 
                  {
                    iframe: iframeRef,
                    settings: "show_title",
                    state: e.target.value,
                  })}}
                  disabled={!activeGraph}>
                  <option value="">Off</option>
                  <option value="true">On</option>
                </select>
              </div>
              <div className="settings_form_div">                
                <label className="input_labels">Show Labels</label>                
                <select className="select_option" value={settings[7] ? (settings[7]):("")} onChange={(e) => {graphAction(id, "properties_tab", "settings", 
                  {
                    iframe: iframeRef,
                    settings: "show_label",
                    state: e.target.value,
                  })}}
                  disabled={!activeGraph}>
                  <option value="">Off</option>
                  <option value="true">On</option>
                </select>
              </div>
              <div className="settings_form_div">                
                <label className="input_labels">Edit Informations</label>                
                <select className="select_option" value={settings[8] ? (settings[8]):("")} onChange={(e) => {graphAction(id, "properties_tab", "settings", 
                  {
                    iframe: iframeRef,
                    settings: "edit_infos",
                    state: e.target.value,
                  })}}
                  disabled={!activeGraph || 1==1}>
                  <option value="">Off</option>
                  <option value="true">On</option>
                </select>
              </div>
              <div className="settings_form_div">                
                <label className="input_labels">Graph Physics</label>                
                <select className="select_option" value={settings[9] ? (settings[9]): ("")} onChange={(e) => {graphAction(id, "properties_tab", "settings", 
                  {
                    iframe: iframeRef,
                    settings: "graph_physics",
                    state: e.target.value,
                  })}}
                  disabled={physicsSettingDisabled}>
                  <option value="">Off</option>
                  <option value="true">On</option>
                </select>                
              </div>
              <div className="settings_form_div">
                <label className="input_labels">Layout type</label>
                <select className="select_option" value={settings[10] === "concentric" ? "default" : (settings[10] ? settings[10] : "default")} onChange={(e) => {graphAction(id, "properties_tab", "settings", 
                  {
                    iframe: iframeRef,
                    settings: "layout_type",
                    state: e.target.value,
                  })}}
                  disabled={!activeGraph}>
                  <option value="default">Default (Concentric)</option>
                  <option value="hierarchical" disabled={hierarchicalLayoutDisabled}>hierarchical</option>
                  <option value="layered">layered</option>
                  <option value="circle">circle</option>
                  <option value="star">star</option>
                  <option value="radial">radial</option>
                  <option value="grid">grid</option>
                  <option value="spiral">spiral</option>
                </select>                
              </div>
              <div className="settings_form_div">
                <label className="input_labels">Layout direction</label>
                <select className="select_option" value={(settings[10] === "hierarchical" || settings[10] === "layered") && settings[11] ? settings[11]:"UD"} onChange={(e) => {graphAction(id, "properties_tab", "settings", 
                  {
                    iframe: iframeRef,
                    settings: "layout_direction",
                    state: e.target.value,
                  })}}
                  disabled={!activeGraph || (settings[10] !== "hierarchical" && settings[10] !== "layered")}>
                  <option value="UD">Up-Down</option>
                  <option value="LR">Left-Right</option>
                </select>                
              </div>
              <div className="settings_form_div">
                <label className="input_labels">Sort method</label>
                <select className="select_option" value={settings[10] === "hierarchical" && settings[12] ? settings[12]:"directed"} onChange={(e) => {graphAction(id, "properties_tab", "settings", 
                  {
                    iframe: iframeRef,
                    settings: "sort_method",
                    state: e.target.value,
                  })}}
                  disabled={!activeGraph || settings[10] !== "hierarchical"}>
                  <option value="directed">Directed</option>
                  <option value="hubsize">Hub-Size</option>
                </select>                
              </div>
              <div className="settings_form_div">
                <label className="input_labels">Layer mode</label>
                <select className="select_option" value={settings[13] || "hop_distance"} onChange={(e) => {graphAction(id, "properties_tab", "settings",
                  {
                    iframe: iframeRef,
                    settings: "layer_mode",
                    state: e.target.value,
                  })}}
                  disabled={!activeGraph || settings[10] !== "layered"}>
                  <option value="hop_distance">Hop Distance</option>
                  <option value="node_identity">Node Identity</option>
                  <option value="by_key">By Property Key</option>
                </select>
              </div>
              <div className="settings_form_div">
                <label className="input_labels">Layer key</label>
                <select className="select_option" value={settings[14] || ""} onChange={(e) => {graphAction(id, "properties_tab", "settings",
                  {
                    iframe: iframeRef,
                    settings: "layer_key",
                    state: e.target.value,
                  })}}
                  disabled={!activeGraph || settings[10] !== "layered" || (settings[13] || "hop_distance") !== "by_key"}>
                  <option value="">Auto</option>
                  {filterPropertyKeys && filterPropertyKeys.map((key) => (
                    <option key={`layer-key-${key}`} value={key}>
                      {key}
                    </option>
                  ))}
                </select>
              </div>             
            </form>
          </div>
          )}
        </div>
      </div>
      {/* Drag Separator */}
      <div className="panel_separator" onMouseDown={handleMouseDown}>
        <span>...</span>
      </div>
      {/* Bottom Panel */}
      <div className="bottom_panel">
        <label className="bottom_panel_title">Graph Relationships</label>
        <ul>
          <li>
            <input
              id={`window_${id}_all_relationships`}
              name={`window_${id}_relationship`}
              type="radio"
              disabled={relationships.filter(r => r.type !== '*').length === 0}
              onChange={() =>
                graphAction(id, "get_graph", "relationship", {
                  graphId: id,
                  sourceId: sourceId,
                  relationship: "*",
                  iframe: iframeRef,
                })
              }
            />
            <label htmlFor={`window_${id}_all_relationships`}>*</label>
          </li>
          {relationships.map((rel, index) => (
            <li key={`${rel.type}-${index}`}>
              <input
                id={`window_${id}_${rel.type}_relationship_${index}`}
                name={`window_${id}_relationship`}
                type="radio"
                onChange={() =>
                  graphAction(id, "get_graph", "relationship", {
                    graphId: id,
                    sourceId: sourceId,
                    relationship: rel.type,
                    iframe: iframeRef,
                  })
                }
              />
              <label
                htmlFor={`window_${id}_${rel.type}_relationship_${index}`}
                style={{ backgroundColor: rel.bgcolor, color: rel.textcolor }}
              >
                {rel.type}
              </label>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
function IframeEmbed({wId,id,fileName,title,activeGraph,graphAction,iframeRef,BASE_URL,themeMode = "light"}) {
  const normalizedBaseUrl = String(BASE_URL || import.meta.env.BASE_URL || "").replace(/\/+$/, "");
  const iframeBasePath = `${normalizedBaseUrl}/linkxDS2026/temp_placeholders`;
  const iframeVersion = "20260704-sourceplaceholder1";
  const parentOriginParam = encodeURIComponent(getTrustedMessageOrigin());
  const strictSandbox = "allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox";
  const relaxedSandbox = "allow-scripts allow-same-origin allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox";
  const frameIdentity = String(activeGraph || id || "").toLowerCase();
  const isPlaceholderFrame = frameIdentity.includes("placeholder");
  const shouldShowFitGraphControl = frameIdentity.includes("graph") && !isPlaceholderFrame;
  const graphOptionControl = (setting, iconType, titleText, extraClass = "") => (
    <i
      className={`iframe_option_icon ${extraClass}`.trim()}
      title={titleText}
      onClick={() => {graphAction(wId, "iframe_options", "settings",
        {
          iframe: iframeRef,
          settings: setting,
        })}}
    >
      <Icons id="window_graph_option" type={iconType} condition="True" />
    </i>
  );
  const fitGraphControl = (
    <span className="iframe_options_layer">
      {graphOptionControl("undo_graph", "undo", "Undo", "iframe_option_undo")}
      {graphOptionControl("fit_graph", "fieldview", "Fit Graph")}
      {graphOptionControl("redo_graph", "redo", "Redo", "iframe_option_redo")}
    </span>
  );

  if (id === "source_placeholder"){
    return (
      <div className="iframe_graph">
        <iframe
          ref={iframeRef}
          sandbox={strictSandbox}
          src={`${iframeBasePath}/source_placeholder.html?v=${iframeVersion}&theme=${encodeURIComponent(themeMode)}&parent_origin=${parentOriginParam}`}
          width="100%"
          height="98%"
          style={{ border: 'none' }}
          title="Network Graph"
        />          
      </div>
    );
  }
  if (id == "graph_placeholder"){//graphs_basic
    return (
      <div className="iframe_graph">
        <iframe
          ref={iframeRef}
          sandbox={strictSandbox}
          src={`${iframeBasePath}/graph_placeholder.html?v=${iframeVersion}&parent_origin=${parentOriginParam}`}
          width="100%"
          height="98%"
          style={{ border: 'none' }}
          title={`${title}`}
        /> 
      </div>
    );
  }
  if (id == "chart_placeholder"){//charts_basic
    return (
      <div className="iframe_graph">
        <iframe
          ref={iframeRef}
          sandbox={relaxedSandbox}
          src={`${iframeBasePath}/charts_basic.html?v=${iframeVersion}&parent_origin=${parentOriginParam}`}
          width="100%"
          height="98%"
          style={{ border: 'none' }}
          title={`${title}`}
        />        
      </div>
    );
  }
  else {
    const iframeFile = fileName || activeGraph;
    return (
      <div className="iframe_graph">
        <iframe
          ref={iframeRef}
          sandbox={strictSandbox}
          src={`${iframeBasePath}/${iframeFile}.html?v=${iframeVersion}&parent_origin=${parentOriginParam}`}
          width="100%"
          height="98%"
          style={{ border: "none" }}
          title={title}
          onLoad={(e) => {
             if (iframeFile.includes("graphs_basic")) {
               window.dispatchEvent(new CustomEvent("linkx_iframe_load_event", { 
                 detail: { wId } 
               }));
             }
          }}
        />
        {shouldShowFitGraphControl ? fitGraphControl : null}
      </div>
    );
  }
}
function DraggableWindow({ children, initialPos = { top: 0, left: 0 }, orientation, onDragStart, onFocus, zIndex, covered }) {
  const [pos, setPos] = useState(initialPos);
  const [isDragging, setIsDragging] = useState(false); // Add this line
  const windowRef = useRef(null);
  const dragging = useRef(false);
  const offset = useRef({ x: 0, y: 0 });
  const onMouseDown = (e) => {
    dragging.current = true;
    setIsDragging(true); // set dragging state

    if (windowRef.current) {
      windowRef.current.classList.add("dragging");
    }

    offset.current = {
      x: e.clientX - pos.left,
      y: e.clientY - pos.top,
    };

    document.body.style.userSelect = "none";
    windowRef.current.style.cursor = "grabbing";

    if (onFocus) onFocus();
    if (onDragStart) onDragStart(true);
  };

  const onMouseMove = (e) => {
    if (!dragging.current) return;
    setPos({
      left: e.clientX - offset.current.x,
      top: e.clientY - offset.current.y,
    });
  };

  const onMouseUp = () => {
    dragging.current = false;
    setIsDragging(false); // reset dragging state
    if (windowRef.current) {
      windowRef.current.classList.remove("dragging");
      windowRef.current.style.cursor = "grab";
    }
    document.body.style.userSelect = "auto";
    if (onDragStart) onDragStart(false);
  };

  useEffect(() => {
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = "auto";
    };
  }, []);
  return (    
    <div
      ref={windowRef}
      className={`window ${orientation === "windows" ? "" : "tab_mode"}`}
      style={{
        ...(orientation === "windows" && {
          top: pos.top,
          left: pos.left,
          position: "absolute",
          zIndex: zIndex
        }),
        userSelect: 'none',
      }}
    >
    {children({ onBarMouseDown: onMouseDown,isDragging:isDragging })}
    </div>
  );
}
function Windows({ id, type, isMaximized, isDragging, sessionId, loadscreenText, loadscreenState, isSideBarMenuOpen, orientation, configurations, windowAction, handleOpenWindows, graphAction, chartAction, selectedContent, selectedSubContent, selectedNodes, selectedEdges,windowResponseI,windowResponseII,windowRealtimeResponseI,formToolResponse,formRealtimeToolResponse,sourceAddressType,sourceAddressText,sourceStorageText,sourceTopicText,sourceKind,sourceStatus,toolStatus,dataframeStatus,streamStatus,sourceStep,sourceRealtimeAddressType,sourceRealtimeAddressText,sourceRealtimeTopicText,toolUrl,toolUsername,toolPassword,toolDatabase,realtimeToolUrl,realtimeToolUsername,realtimeToolPassword,realtimeToolDatabase,realtimeNeo4jConnectedSessionId,realtimeConfigPersistStatus,realtimeConfigPersistedSessionId,realtimeConfigPersistMessage,realtimeStartGuardMessage,batchFilesSearchHybrid,batchFilesSearchHybridQuery,batchFilesSearchStrict,searchText,batchFilesSearchLimit,batchFilesSearchResults,batchFilesSearchMoreFiles,searchResultsVisible,searchPlaceholder,batchFilesCollection, batchFilesDataframeInfoI, batchFilesDataframeInfoII, batchFilesDataframeActionValue, batchFilesDataframeSourceValue, batchFilesDataframeTargetValue, batchFilesDataframeRelationshipValue, batchFilesDataframeRuleValue, sourceSessionLog, sourceStreams , sourceStreamListener, fileInputRef, textareaRefs, onClose, onMove, zIndex, onFocus, covered, graphLink, graphLinkId, graphLinkSource, graphStatus, graphStatusBySession, graphRenderStats, activeGraph, chartLink, chartLinkId, activechart, iframeRef, iframeFilters, iframeSettings, iframeSearch, iframePerformanceMood, selectedPropertyTab, filterPropertyKeys, filterResults, nodeProperties, BASE_URL, searchButtonRef, resultContainerRef, requestConfirmation, themeMode, isWorkspaceLocked }) {
  const canCancelGraphStaging = type === "graph" && typeof loadscreenText === "string" && (
    loadscreenText.toLowerCase().startsWith("staging graph") ||
    loadscreenText.toLowerCase().startsWith("fetching graph")
  );
  const isRealtimeSourceWorkflow = selectedContent === "real_time_input";
  const isSharedSourceWorkflowPage = selectedContent === "batch_input" || (isRealtimeSourceWorkflow && String(selectedSubContent || "").startsWith("batch_input_form_page"));
  const batchSourceFlow = getSourceFlowState({
    sourceKind,
    sourceStatus,
    toolStatus,
    dataframeStatus,
    streamStatus,
    sourceStep,
    selectedSubContent,
    sourceAddressType,
    windowResponseI,
    formToolResponse,
    batchFilesDataframeInfoI,
    sourceStreamListener,
  });
  const isBatchSourceConnected = isSourceConnectedState(batchSourceFlow);
  const isBatchSourceUploaded = isSourceUploadedState(batchSourceFlow);
  const isBatchToolConnected = isToolConnectedState(batchSourceFlow);
  const isBatchSourceBusy = batchSourceFlow.sourceStatus === SOURCE_STATUSES.CONNECTING || batchSourceFlow.sourceStatus === SOURCE_STATUSES.DISCONNECTING;
  const hasRealtimeNeo4jConnection = String(realtimeNeo4jConnectedSessionId || "") === String(id) && formRealtimeToolResponse === "Connected!";
  const hasRealtimePersistedToolConfig = realtimeConfigPersistStatus === "saved" && String(realtimeConfigPersistedSessionId || "") === String(id);
  const realtimeStartBlockedMessage = realtimeStartGuardMessage || (
    !hasRealtimeNeo4jConnection
      ? `Connect Neo4j successfully for session ${id} before starting realtime.`
      : !hasRealtimePersistedToolConfig
        ? `Save Neo4j credentials for session ${id} before starting realtime.`
        : ""
  );
  const canStartRealtimeStream = !isRealtimeSourceWorkflow || (hasRealtimeNeo4jConnection && hasRealtimePersistedToolConfig);
  const showLockedSourceHint = isWorkspaceLocked && type === "source";
  if (type === "source") {
    return (
      <DraggableWindow initialPos={{ top: 0, left: 0}} zIndex={zIndex} orientation={orientation}>
        {(dragProps) => (
          <div id={`window_${type}_${id}`} style={{ zIndex }} 
            className={
              orientation === "tabs"
                ? `window tab_mode ${covered ? '' : 'focused'} ${dragProps.isDragging ? 'dragging' : ''}`
                : `window ${covered ? '' : 'focused'} ${dragProps.isDragging ? 'dragging' : ''}`
            }
            onMouseDown={() => onFocus(id)}>
            <div id={`window_loadscreen_${type}_${id}`} className="windows_loadscreen" style={{ display: loadscreenState ? "block" : "none" }}>
              <Loadscreen loadingText={loadscreenText} />
            </div>
            {(covered || dragProps.isDragging) && <div className="window_cover" />}  
            <div id={`window_bar_${type}_${id}`} className="window_bar"
              onMouseDown={isMaximized ? undefined : dragProps.onBarMouseDown} onDoubleClick={() => windowAction(id,"window_change_view", "",iframeRef)}>
              <div className="window_bar_title_container">Source Window{showLockedSourceHint && <span className="window_lock_state_badge">Source actions available. Graphs and settings stay locked.</span>}<input placeholder="Add custom title" type="text"/></div>
              <div className="window_bar_btns_container">
                <span onClick={() => onClose(id)}>x</span>
                <span onClick={() => windowAction(id,"window_change_view", "",iframeRef)}>                 
                  {isMaximized ? <Icons id="window_bar" type="maximize" condition="True" /> : <Icons id="window_bar" type="maximize" condition="True" />}
                </span>
                <span>-</span>
              </div>
            </div>
            {/* Sidebar */}
            <div id={`window_side_bar_${type}_${id}`} className="side_bar">
              {/* New Source */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `new_source_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `new_source_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`new_source_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `new_source_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `new_source_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="new" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `new_source_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li onClick={() => windowAction(id, 'live_source_options', `new_source_options_${type}_${id}`, 'update')}>
                      <span>Direct Source</span>
                    </li>
                    <li onClick={() => windowAction(id, 'upload_source_options', `new_source_options_${type}_${id}`, 'update')}>
                      <span>File Upload</span>
                    </li>
                    <li onClick={() => windowAction(id, 'load_source_options', `new_source_options_${type}_${id}`, 'update')}>
                      <span>Load Session</span>
                    </li>
                  </ul>
                </div>
              </div> 
            </div>
            <div id={`window_content_${type}_${id}`}  className='content_container'>
                {selectedContent === null && (
                  <div className="placeholder">
                    <IframeEmbed wId={id} id="source_placeholder" fileName="source_placeholder" activeGraph={activeGraph} graphAction={graphAction} iframeRef={iframeRef} BASE_URL={BASE_URL} themeMode={themeMode}/>
                  </div>
                )}
                {selectedContent === "live_source_options" && (
                  <div className="live_source_options_container">
                    <div className="source_window_section_heading">Pick a source input</div>
                    <div className="live_source_option" onClick={() => { windowAction(id,"real_time_input","update"); setTimeout(() => windowAction(id,"real_time_input_form","auto_connect"), 50); }}>
                      <span className="live_source_option_icon">
                        <Icons id="window_live_source_option" type="realTime_input" condition="True"/> 
                      </span>
                      <span className="live_source_option_details">
                        <label style={sourceOptionTitleStyle}>Real-time input</label>
                        <p style={sourceOptionBodyStyle}>Connect to a Broker/API and consume data as a Real-time messages.</p>
                      </span>
                    </div>
                    <div className="live_source_option" onClick={() => { windowAction(id,"batch_input","update"); setTimeout(() => windowAction(id,"batch_input_form","auto_connect"), 50); }}>
                      <span className="live_source_option_icon">
                        <Icons id="window_live_source_option" type="batch_input" condition="True"/> 
                      </span>
                      <span className="live_source_option_details">
                        <label style={sourceOptionTitleStyle}>Batch input</label>
                        <p style={sourceOptionBodyStyle}>Connect to a Broker/API and fetch for datas as a batch query.</p>
                      </span>
                    </div>
                  </div>
                )}
                {selectedContent === "real_time_input" && selectedSubContent === "real_time_input_form_pageI" && (
                  <div className="live_source_options_container">
                    <div className="source_window_section_heading source_window_section_heading--compact">Pick a source input</div>
                    <div className="live_source_option_passive" style={{position:'absolute',top:'calc( 3vh - 3vw)',left:'0vw'}}>
                      <span className="live_source_option_icon">
                        <Icons id="window_live_source_option" type="realTime_input" condition="True"/> 
                      </span>
                      <span className="live_source_option_details">
                        <label style={sourceOptionTitleStyle}>Real-time input</label>
                        <p style={sourceOptionBodyStyle}>Connect to a Broker/API and consume data as a Real-time messages.</p>
                      </span>
                    </div>
                    <div className="batch_connection_form_container">
                      {selectedSubContent === "real_time_input_form_pageI" && (
                        <div>
                          <div id="real_time_input_form_response" className="form_response_container"
                            style={getStatusToneStyle(windowRealtimeResponseI)}>
                            <span>
                              <Icons
                                id="window_live_source_option"
                                type={
                                  windowRealtimeResponseI === "Connecting..." ? "loadingx" :
                                  windowRealtimeResponseI === "Connection established!" ? "correctx" : "errorx"
                                }
                                condition="True"
                              />
                            </span>
                            <span>{windowRealtimeResponseI || "Not connected."}</span>
                          </div>
                          <form onSubmit={(e) => { e.preventDefault();
                            if (windowRealtimeResponseI === "Connection established!") {
                              windowAction(id, "real_time_input_form", "disconnect", {
                                addressType: sourceRealtimeAddressType,
                                address: sourceRealtimeAddressText,
                                topic: sourceRealtimeAddressType === "broker" ? sourceRealtimeTopicText : null,
                                session_id:id
                              });
                            }
                            else if (windowRealtimeResponseI === "Disconnecting failed!") {
                              windowAction(id, "real_time_input_form", "disconnect", {
                                addressType: sourceRealtimeAddressType,
                                address: sourceRealtimeAddressText,
                                topic: sourceRealtimeAddressType === "broker" ? sourceRealtimeTopicText : null,
                                session_id:id
                              });
                            }
                            else {
                              windowAction(id, "real_time_input_form", "connect", {
                                addressType: sourceRealtimeAddressType,
                                address: sourceRealtimeAddressText,
                                topic: sourceRealtimeAddressType === "broker" ? sourceRealtimeTopicText : null,
                                session_id:id
                              });
                            }
                            }}>
                            <fieldset>
                              <legend><b>Broker/API</b> Connection</legend>
                              <div className="box_inputs_container">
                                <input id="realtime_broker_address_radio" className="radioinput" type="radio" name="realtime_source_input_address_type" value="broker" checked={sourceRealtimeAddressType === "broker"}
                                  onChange={(e) => windowAction(id,"real_time_input_form_address","change",e.target.value)}
                                  disabled={
                                    windowRealtimeResponseI === "Connecting..." ? 'True' :
                                    windowRealtimeResponseI === "Connection established!" ? 'True': ''
                                  }/>
                                <label htmlFor="realtime_broker_address_radio">Kafka Broker</label>
                                <input id="realtime_api_address_radio" className="radioinput" type="radio" name="realtime_source_input_address_type" value="api" checked={sourceRealtimeAddressType === "api"} onChange={(e) => windowAction(id,"real_time_input_form_address","change",e.target.value)}
                                  disabled={
                                    windowRealtimeResponseI === "Connecting..." ? 'True' :
                                    windowRealtimeResponseI === "Connection established!" ? 'True': ''
                                  }/>
                                <label htmlFor="realtime_api_address_radio">REST API</label>
                              </div>
                              <input id="realtime_source_input_address_text" placeholder="Enter Broker/API Address" value={sourceRealtimeAddressText ?? ''} className="textinput" type="text"
                              disabled={
                                windowRealtimeResponseI === "Connecting..." ? 'True' :
                                windowRealtimeResponseI === "Connection established!" ? 'True': ''
                              }
                              onChange={(e) => windowAction(id,"real_time_source_address_text","change",e.target.value)}
                              style={{
                                color: windowRealtimeResponseI === "Connection established!" ? "var(--muted-text)" : "",
                                backgroundColor: windowRealtimeResponseI === "Connection established!" ? "var(--disabled-bg)" : "",
                                borderColor: windowRealtimeResponseI === "Connection established!" ? "var(--disabled-border)" : ""
                              }}/>
                              {sourceRealtimeAddressType === "broker" && (
                                <input id="realtime_source_kafka_topic_text" placeholder="Enter Kafka topic" value={sourceRealtimeTopicText ?? ''} className="textinput" type="text"
                                required={sourceRealtimeAddressType === "broker"}
                                disabled={
                                  windowRealtimeResponseI === "Connecting..." ? 'True' :
                                  windowRealtimeResponseI === "Connection established!" ? 'True': ''
                                }
                                onChange={(e) => windowAction(id,"real_time_source_topic_text","change",e.target.value)}
                                style={{
                                  color: windowRealtimeResponseI === "Connection established!" ? "var(--muted-text)" : "",
                                  backgroundColor: windowRealtimeResponseI === "Connection established!" ? "var(--disabled-bg)" : "",
                                  borderColor: windowRealtimeResponseI === "Connection established!" ? "var(--disabled-border)" : ""
                                }}/>
                              )}
                            </fieldset>
                            <button type="submit"><span><Icons id="window_live_source_option" type="connect" condition="True"/></span>
                              <span>
                                {
                                  windowRealtimeResponseI === null
                                    ? "Connect":
                                  windowRealtimeResponseI === "Not connected."
                                    ? "Connect":
                                  windowRealtimeResponseI === "Disconnecting..."
                                    ? "Disconnecting...":
                                  windowRealtimeResponseI === "Disconnected!"
                                    ? "Connect":
                                  windowRealtimeResponseI === "Connecting..."
                                    ? "Connecting...":
                                  windowRealtimeResponseI === "Connection established!"
                                    ? "Disconnect":
                                  windowRealtimeResponseI === "Connection failed!"
                                    ? "Connect":
                                  windowRealtimeResponseI === "Disconnecting failed!"
                                    ? "Retry": ""
                                }
                              </span>
                             </button>
                          </form>
                          <form onSubmit={(e) => { e.preventDefault();
                            if (windowRealtimeResponseI === "Connection established!" && formRealtimeToolResponse !== "Connected!" ) {
                              const toolUrl = sanitizeConnectionValue(realtimeToolUrl, { maxLength: 300 });
                              const toolUsername = sanitizeIdentifier(realtimeToolUsername, { maxLength: 120 });
                              const toolPassword = sanitizeSecret(realtimeToolPassword, { maxLength: 256 });
                              const toolDatabase = sanitizeIdentifier(realtimeToolDatabase, { maxLength: 120 });
                              windowAction(id, "real_time_tool_integration_form", "connect", {
                                tool_name: 'neo4j',
                                url: toolUrl,
                                username: toolUsername,
                                password: toolPassword,
                                database: toolDatabase,
                                source_id:id
                              });
                            }
                            else{
                              windowAction(id, "real_time_tool_integration_form", "disconnect", {
                                tool_name: 'neo4j',
                                source_id:id
                              });
                            }
                            }}>
                            <fieldset>
                              <legend><b>Tool/Database</b> Integration</legend>
                              <div className="box_inputs_container">
                                <input id="realtime_tool_neo4j_radio" className="radioinput" type="radio" name="realtime_analysis_tool_type" defaultChecked />
                                <label htmlFor="realtime_tool_neo4j_radio">Neo4j</label>
                              </div>
                              <input id="realtime_tool_url" placeholder="Url" className="textinput" type="text" value={realtimeToolUrl ?? ""} onChange={(e) => windowAction(id,"realtime_tool_url","change",e.target.value)}
                                disabled={
                                formRealtimeToolResponse === "Connected!" ? 'False': ''
                              }/>
                              <input id="realtime_tool_username" placeholder="Username" className="textinput" type="text" value={realtimeToolUsername ?? ""} onChange={(e) => windowAction(id,"realtime_tool_username","change",e.target.value)}
                                disabled={
                                formRealtimeToolResponse === "Connected!" ? 'False': ''
                              }/>
                              <input id="realtime_tool_password" placeholder="Password" className="textinput" type="password" value={realtimeToolPassword ?? ""} onChange={(e) => windowAction(id,"realtime_tool_password","change",e.target.value)}
                                disabled={
                                formRealtimeToolResponse === "Connected!" ? 'False': ''
                              }/>
                              <input id="realtime_tool_database" placeholder="Database name" className="textinput" type="text" value={realtimeToolDatabase ?? ""} onChange={(e) => windowAction(id,"realtime_tool_database","change",e.target.value)} disabled/>
                              <div className="tool_form_response">
                                <Icons
                                  id="window_live_source_option"
                                  type={
                                    formRealtimeToolResponse === null ? "warningx" :
                                    formRealtimeToolResponse === "Not connected!" ? "warningx" :
                                    formRealtimeToolResponse === "Connecting..." ? "loadingx" :
                                    formRealtimeToolResponse === "Connected!" ? "correctx" : "errorx"
                                  }
                                  condition="True"
                                />
                                <span
                                  style={getToolStatusTextStyle(formRealtimeToolResponse)}>
                                  {
                                    formRealtimeToolResponse === null
                                      ? "Not connected!":
                                    formRealtimeToolResponse === "Not connected!"
                                      ? "Not connected!":
                                    formRealtimeToolResponse === "Disconnecting..."
                                      ? "Disconnecting...":
                                    formRealtimeToolResponse === "Disconnected!"
                                      ? "Disconnected!":
                                    formRealtimeToolResponse === "Connecting..."
                                      ? "Connecting...":
                                    formRealtimeToolResponse === "Connected!"
                                      ? "Connected!":
                                    formRealtimeToolResponse === "Connection failed!"
                                      ? "Connection failed!":
                                    formRealtimeToolResponse === "Disconnecting failed!"
                                      ? "Disconnecting failed!"
                                      : ""
                                  }
                                </span>
                              </div>
                              <button
                                disabled={
                                windowRealtimeResponseI === "Connection established!" ? '':
                                windowRealtimeResponseI !== "Connection established!" && formRealtimeToolResponse === "Connected!" ? '': 'False'
                              }>
                                {
                                  formRealtimeToolResponse === null ? "Connect":
                                  formRealtimeToolResponse === "Not connected!" ? "Connect":
                                  formRealtimeToolResponse === "Connected!" ? "Disconnect" :
                                  formRealtimeToolResponse === "Disconnected!" ? "Connect" :
                                  formRealtimeToolResponse === "Connecting..." ? "Connecting..." : "Disconnecting..."
                                }
                              </button>
                              {isRealtimeSourceWorkflow && realtimeConfigPersistMessage ? (
                                <div className="tool_form_response">
                                  <Icons
                                    id="window_live_source_option"
                                    type={realtimeConfigPersistStatus === "saved" ? "correctx" : realtimeConfigPersistStatus === "saving" ? "loadingx" : "warningx"}
                                    condition="True"
                                  />
                                  <span style={getToolStatusTextStyle(realtimeConfigPersistStatus === "saved" ? "Connected!" : realtimeConfigPersistStatus === "saving" ? "Connecting..." : "Not connected!")}>{realtimeConfigPersistMessage}</span>
                                </div>
                              ) : null}
                            </fieldset>
                          </form>
                        </div>
                      )}
                    </div>
                    <div className="batch_connection_form_pager_container">
                      <button disabled={'True'}>
                        {"Back"}
                      </button>
                      <button
                        disabled={
                          windowRealtimeResponseI === "Connection established!" && formRealtimeToolResponse === "Connected!" ? '' : 'True'
                        }
                        onClick={() => { const sourceAddress = sourceRealtimeAddressText || ""; const sourceTopic = sourceRealtimeAddressType === "broker" ? (sourceRealtimeTopicText || "") : null; windowAction(id, "batch_input_form_swap", "page_II", {"addressType":sourceRealtimeAddressType,"address":sourceAddress,"topic":sourceTopic,"mode":"realtime"}); }}>
                        {"Next"}
                      </button>
                    </div>
                  </div>
                )}
                {selectedContent === "upload_source_options" && (
                  <div className="upload_source_options_container">
                    <div className="upload_source_options_header">Upload a dataset</div>
                    <div className="upload_source_option">
                      <span className="upload_source_option_icon">
                        <Icons id="window_upload_source_option" type="upload_input" condition="True"/> 
                      </span>
                      <div className="upload_source_option_details">
                        <label style={sourceOptionTitleStyle}>Upload files or Drag and drop here.</label>
                        <p style={sourceOptionBodyStyle}>
                          <i><b>Note: </b>Only csv, parquet, json and xlsx file types are allowed.</i>
                        </p>
                      </div>
                      <input id="upload_source_option_input" multiple accept=".csv,.json,.parquet,.xlsx" type="file" ref={fileInputRef} onChange={(e) => windowAction(id, "upload_source_files", "upload", { files: e.target.files})}/>
                      <button onClick={() => fileInputRef.current.click()}>Choose files</button>
                    </div>
                  </div>
                )}
                {isSharedSourceWorkflowPage && (
                  <div className="live_source_options_container">
                    <div className="source_window_section_heading source_window_section_heading--compact">Pick a source input</div>
                    <div className="live_source_option_passive" style={{position:'absolute',top:'calc( 3vh - 3vw)',left:'0vw'}}>
                      <span className="live_source_option_icon">
                        <Icons id="window_live_source_option" type={isRealtimeSourceWorkflow ? "realTime_input" : "batch_input"} condition="True"/> 
                      </span>
                      <span className="live_source_option_details">
                        <label style={sourceOptionTitleStyle}>{isRealtimeSourceWorkflow ? "Real-time input" : "Batch input"}</label>
                        <p style={sourceOptionBodyStyle}>{isRealtimeSourceWorkflow ? "Connect to a Broker/API and consume data as Real-time messages." : "Connect to a Broker/API or upload datasets and fetch for data in batch."}</p>
                      </span>
                    </div>
                    <div className="batch_connection_form_container">
                      {selectedSubContent === "batch_input_form_pageI" && (
                        <div>
                          <div id="batch_input_form_response" className="form_response_container"
                            style={getStatusToneStyle(windowResponseI)}>
                            <span>
                              <Icons
                                id="window_live_source_option"
                                type={
                                  windowResponseI === "Connecting..." ? "loadingx" :
                                  windowResponseI === "Connection established!" ? "correctx" :
                                  windowResponseI === "Dataset uploaded!" ? "correctx" : "errorx"
                                }
                                condition="True"
                              />
                            </span>
                            <span>{windowResponseI || "Not connected."}</span>
                          </div>
                          <form onSubmit={(e) => { e.preventDefault();
                            const brokerAddress = sourceAddressText || "";
                            const storageAddress = sourceStorageText || "";
                            const topicAddress = sourceAddressType === "broker" ? (sourceTopicText || "") : null;
                            const sourcePayload = {
                              addressType: sourceAddressType,
                              address: brokerAddress,
                              broker: brokerAddress,
                              storage: storageAddress,
                              hdfs: storageAddress,
                              topic: topicAddress,
                              session_id:id
                            };
                            if (isBatchSourceConnected || windowResponseI === "Disconnecting failed!") {
                              windowAction(id, "batch_input_form", "disconnect", sourcePayload);
                            }
                            else {
                              windowAction(id, "batch_input_form", "connect", sourcePayload);
                            }
                            }}
                            style={{
                              pointerEvents: isBatchSourceUploaded ? 'none' : 'auto',
                              opacity: isBatchSourceUploaded ? 0.5 : 1 
                            }}>
                            <fieldset>
                              <legend><b>Broker/API</b> Connection</legend>
                              <div className="box_inputs_container">
                                <input id="broker_address_radio" className="radioinput" type="radio" name="source_input_address_type" value="broker" checked={sourceAddressType === "broker"} 
                                  onChange={(e) => windowAction(id,"batch_input_form_address","change",e.target.value)}
                                  disabled={
                                    isBatchSourceBusy ? 'True' : 
                                    isBatchSourceConnected ? 'True': ''
                                  }/>
                                <label htmlFor="broker_address_radio">Kafka Broker</label>
                                <input id="api_address_radio" className="radioinput" type="radio" name="source_input_address_type" value="api" checked={sourceAddressType === "api"} onChange={(e) => windowAction(id,"batch_input_form_address","change",e.target.value)}
                                  disabled={
                                    isBatchSourceBusy ? 'True' : 
                                    isBatchSourceConnected ? 'True': ''
                                  }/>
                                <label htmlFor="api_address_radio">REST API</label>
                              </div>
                              <input id="source_input_address_text" placeholder="Enter Broker/API Address" value={sourceAddressText ?? ''} className="textinput" type="text"
                              disabled={
                                isBatchSourceBusy ? 'True' : 
                                isBatchSourceConnected ? 'True': ''
                              }
                              onChange={(e) => windowAction(id,"source_input_address_text","change",e.target.value)}
                              style={{
                                color: windowResponseI === "Connection established!" ? "var(--muted-text)" : "",
                                backgroundColor: windowResponseI === "Connection established!" ? "var(--disabled-bg)" : "",
                                borderColor: windowResponseI === "Connection established!" ? "var(--disabled-border)" : ""
                              }}/>{sourceAddressType === "broker" && (
                              <input id="source_topic_text" placeholder="Enter Kafka topic" value={sourceTopicText ?? ''} className="textinput" type="text"
                              required={sourceAddressType === "broker"}
                              disabled={
                                isBatchSourceBusy ? 'True' :
                                isBatchSourceConnected ? 'True': ''
                              }
                              onChange={(e) => windowAction(id,"source_topic_text","change",e.target.value)}
                              style={{
                                color: windowResponseI === "Connection established!" ? "var(--muted-text)" : "",
                                backgroundColor: windowResponseI === "Connection established!" ? "var(--disabled-bg)" : "",
                                borderColor: windowResponseI === "Connection established!" ? "var(--disabled-border)" : ""
                              }}/>) }
                            </fieldset>
                            <fieldset>
                              <legend><b>HDFS</b> Connection</legend>
                              <div className="box_inputs_container">
                                <input id="hadoop_address_radio" className="radioinput" type="radio" name="source_storage_address_type" value="storage" checked={sourceAddressType === "storage"} onChange={(e) => windowAction(id,"batch_input_form_address","change",e.target.value)} 
                                  disabled={
                                    isBatchSourceBusy ? 'True' : 
                                    isBatchSourceConnected ? 'True': ''
                                  }/>
                                <label htmlFor="hadoop_address_radio">Hadoop Cluster</label>
                              </div>                            
                                <input id="source_storage_address_text" placeholder="Enter HDFS Address" value={sourceStorageText ?? ''} className="textinput" type="text"
                                disabled={
                                  isBatchSourceBusy ? 'True' : 
                                  isBatchSourceConnected ? 'True': ''
                                }
                                onChange={(e) => windowAction(id,"source_storage_address_text","change",e.target.value)}
                                style={{
                                  color: windowResponseI === "Connection established!" ? "var(--muted-text)" : "",
                                  backgroundColor: windowResponseI === "Connection established!" ? "var(--disabled-bg)" : "",
                                  borderColor: windowResponseI === "Connection established!" ? "var(--disabled-border)" : ""
                                }}/>                            
                            </fieldset>                        
                            <button type="submit"><span><Icons id="window_live_source_option" type="connect" condition="True"/></span>
                              <span>
                                {
                                  windowResponseI === null
                                    ? "Connect":
                                  windowResponseI === "Not connected."
                                    ? "Connect":
                                  windowResponseI === "Disconnecting..."
                                    ? "Disconnecting...":
                                  windowResponseI === "Disconnected!"
                                    ? "Connect":
                                  windowResponseI === "Connecting..."
                                    ? "Connecting...": 
                                  windowResponseI === "Connection established!"
                                    ? "Disconnect":
                                  windowResponseI === "Connection failed!"
                                    ? "Connect":
                                  windowResponseI === "Connection failed! No storage found."
                                    ? "Connect":
                                  windowResponseI === "Disconnecting failed!"
                                    ? "Retry":
                                  windowResponseI === "Dataset uploaded!"
                                    ? "Connect":""
                                }
                              </span>
                             </button>
                          </form>
                          <form onSubmit={(e) => { e.preventDefault();
                            if ((isBatchSourceConnected || isBatchSourceUploaded) && !isBatchToolConnected) {
                              // Disconnect logic
                              const sanitizedToolUrl = sanitizeConnectionValue(toolUrl, { maxLength: 300 });
                              const sanitizedToolUsername = sanitizeIdentifier(toolUsername, { maxLength: 120 });
                              const sanitizedToolPassword = sanitizeSecret(toolPassword, { maxLength: 256 });
                              const sanitizedToolDatabase = sanitizeIdentifier(toolDatabase, { maxLength: 120 });
                              windowAction(id, "tool_integration_form", "connect", {
                                tool_name: 'neo4j',
                                url: sanitizedToolUrl,
                                username: sanitizedToolUsername,
                                password: sanitizedToolPassword,
                                database: sanitizedToolDatabase,
                                source_id:id                                                                
                              });
                            }
                            else{
                              windowAction(id, "tool_integration_form", "disconnect", {
                                tool_name: 'neo4j',
                                source_id:id
                              });
                            }
                            }}>
                            <fieldset>
                              <legend><b>Tool/Database</b> Integration</legend>
                              <div className="box_inputs_container">
                                <input id="tool_neo4j_radio" className="radioinput" type="radio" name="analysis_tool_type" defaultChecked />
                                <label htmlFor="tool_neo4j_radio">Neo4j</label>
                              </div>
                              <input id="tool_url" placeholder="Url" className="textinput" type="text" value={toolUrl ?? ""} onChange={(e) => windowAction(id,"tool_url","change",e.target.value)}
                                disabled={
                                formToolResponse === "Connected!" ? 'False': ''
                              }/>
                              <input id="tool_username" placeholder="Username" className="textinput" type="text" value={toolUsername ?? ""} onChange={(e) => windowAction(id,"tool_username","change",e.target.value)}
                                disabled={
                                formToolResponse === "Connected!" ? 'False': ''
                              }/>
                              <input id="tool_password" placeholder="Password" className="textinput" type="password" value={toolPassword ?? ""} onChange={(e) => windowAction(id,"tool_password","change",e.target.value)}
                                disabled={
                                formToolResponse === "Connected!" ? 'False': ''
                              }/>
                              <input id="tool_database" placeholder="Database name" className="textinput" type="text" value={toolDatabase ?? ""} onChange={(e) => windowAction(id,"tool_database","change",e.target.value)} disabled/>
                              <div className="tool_form_response">
                                <Icons
                                  id="window_live_source_option"
                                  type={
                                    formToolResponse === null ? "warningx" :
                                    formToolResponse === "Not connected!" ? "warningx" :
                                    formToolResponse === "Connecting..." ? "loadingx" :
                                    formToolResponse === "Connected!" ? "correctx" : "errorx"
                                  }
                                  condition="True"
                                />
                                <span 
                                  style={getToolStatusTextStyle(formToolResponse)}>
                                  {
                                    formToolResponse === null
                                      ? "Not connected!":
                                    formToolResponse === "Not connected!"
                                      ? "Not connected!":
                                    formToolResponse === "Disconnecting..."
                                      ? "Disconnecting...":
                                    formToolResponse === "Disconnected!"
                                      ? "Disconnected!":
                                    formToolResponse === "Connecting..."
                                      ? "Connecting...": 
                                    formToolResponse === "Connected!"
                                      ? "Connected!":
                                    formToolResponse === "Connection failed!"
                                      ? "Connection failed!":
                                    formToolResponse === "Disconnecting failed!"
                                      ? "Disconnecting failed!"
                                      : ""
                                  }
                                </span>
                              </div>
                              <button 
                                disabled={
                                windowResponseI === "Connection established!" ? '':
                                windowResponseI !== "Connection established!" && formToolResponse === "Connected!" ? '':
                                windowResponseI === "Dataset uploaded!" ? '': 'False'
                              }>
                                {
                                  formToolResponse === null ? "Connect":
                                  formToolResponse === "Not connected!" ? "Connect":
                                  formToolResponse === "Connected!" ? "Disconnect" :
                                  formToolResponse === "Disconnected!" ? "Connect" :
                                  formToolResponse === "Connecting..." ? "Connecting..." : "Disconnecting..."                           
                                }
                              </button>
                            </fieldset>
                          </form>
                        </div>
                      )}
                      {selectedSubContent === "batch_input_form_pageII" && (
                        <div>
                          <div id="batch_input_form_response" className="form_response_container"
                            style={getStatusToneStyle(windowResponseI)}>
                            <span>
                              <Icons
                                id="window_live_source_option"
                                type={
                                  windowResponseI === "Connecting..." ? "loadingx" :
                                  windowResponseI === "Connection established!" ? "correctx" : "errorx"
                                }
                                condition="True"
                              />
                            </span>
                            <span>{windowResponseI || "Not connected."}</span>
                          </div>
                          <form className="batch_files_search_form" onSubmit={(e) => { e.preventDefault()}}>
                            <fieldset className="batch_files_search_form_fieldset">
                              <legend><b>Search</b> from storage</legend>
                              <div className="batch_files_search_form" onSubmit={(e) => { e.preventDefault()}}>
                                <div id={`batch_files_search_container_${id}`} className="batch_files_search_container">
                                  <input id={`batch_files_search_input_${id}`} className="batch_files_search_text_input" type="text" placeholder="Type here to seach" required/>
                                  <input id={`batch_files_search_date_${id}`} className="batch_files_search_date_input" type="date"/>
                                  <button ref={searchButtonRef} id={`batch_files_search_button_${id}`} title="Search" onClick={() => windowAction(id,"batch_files_search_input","search",[document.getElementById(`batch_files_search_input_${id}`).value,document.getElementById(`batch_files_search_date_${id}`).value,batchFilesSearchHybrid,document.getElementById(`batch_files_search_column_${id}`).value,document.getElementById(`batch_files_search_strict_${id}`).checked])}>
                                   <Icons id="window_live_source_option" type="search" condition="True"/>
                                  </button>
                                  <button title="Search"><Icons id="window_live_source_option" type="inbox-files" condition="True"/></button>
                                </div>
                                <div id={`batch_files_search_options_container_${id}`} className="batch_files_search_options_container">
                                  <input id={`batch_files_search_files_${id}`} title="Raw files search" defaultChecked type="radio" name={`useSearch_${id}`} onClick={() =>windowAction(id,"batch_files_search_useSearch","files","")}/>
                                  <label htmlFor={`batch_files_search_files_${id}`} title="Raw files search">Files</label>
                                  <input id={`batch_files_search_es_${id}`} title="Elastic keyword search" type="radio" name={`useSearch_${id}`} onClick={() =>windowAction(id,"batch_files_search_useSearch","hybrid","")}/>
                                  <label htmlFor={`batch_files_search_es_${id}`} title="Elastic keyword search">Hybrid (Elastic + Hive search)</label>                                                             
                                </div>
                                <div className='batch_files_search_options_containerI' style={{ opacity: !batchFilesSearchHybrid ? 0.5 : 1 }}>                                                                    
                                   <select id={`batch_files_search_column_${id}`} className="col_select_option" name="" disabled={!batchFilesSearchHybrid} required={batchFilesSearchHybrid && batchFilesSearchStrict}>
                                    <option value="">{batchFilesSearchStrict ? "Select strict column" : "All columns (auto)"}</option>
                                    {(batchFilesSearchStrict ? configurations.search_columns_strict : configurations.search_columns_fuzzy).map((col) => (
                                      <option key={col} value={col}>{col.replace(/_/g, " ")}</option>
                                    ))}                                    
                                   </select>
                                   <div className='batch_files_search_options_containerII' style={{ opacity: !batchFilesSearchHybrid ? 0.5 : 1 }}>
                                    <input id={`batch_files_search_strict_${id}`} title="Elastic keyword search" type="checkbox" disabled={!batchFilesSearchHybrid} name="useSearch" onClick={() =>windowAction(id,"batch_files_search_strict","","")}/>
                                    <label htmlFor={`batch_files_search_strict_${id}`} title="Elastic keyword search">Strict Match</label>                                                                   
                                   </div>                                
                                </div>
                                <div ref={resultContainerRef} id={`batch_files_search_result_container_${id}`}
                                    className="batch_files_search_result_container"
                                    style={{
                                      '--searching-text': `'${searchPlaceholder}'`,
                                      display: searchResultsVisible ? "block" : "none"
                                    }}
                                  >
                                  <ul
                                    key={batchFilesSearchHybrid ? "hive-list" : "nonhive-list"}
                                    className="batch_files_search_results"
                                  >
                                    {searchText ? (
                                      // show empty UL to trigger CSS :empty::before
                                      null
                                    ) : (
                                      <>
                                        {Array.isArray(batchFilesSearchResults) &&
                                        batchFilesSearchResults.length > 0 ? (                                          
                                          batchFilesSearchHybrid ? (
                                            // =============================
                                            // ===== Hybrid RESULTS LIST =====
                                            // =============================
                                            <>
                                              {batchFilesSearchResults.map((file, index) => {
                                                const name = file?.name || "";
                                                const size = file?.size || "";
                                                console.log("batchFilesSearchResults:",batchFilesSearchResults)
                                                return (
                                                  <li
                                                    key={`hive-${name}-${index}`}
                                                    style={{
                                                      backgroundColor: batchFilesCollection.some(
                                                        (selectedFile) => selectedFile.name === name
                                                      )
                                                        ? "var(--disabled-bg)"
                                                        : "",
                                                      color: batchFilesCollection.some(
                                                        (selectedFile) => selectedFile.name === name
                                                      )
                                                        ? "var(--muted-text)"
                                                        : "",
                                                    }}
                                                    onClick={() => {
                                                      windowAction(id, "batch_files_select_file", "toggle_select", {
                                                          name,
                                                          keyword: file.keyword,
                                                          size: file.size,
                                                          strict: file.strict,
                                                          type: file.type,
                                                          column: file.column
                                                        });
                                                      }}                                                                                                        
                                                  >
                                                    <span title={name}>{name}</span>
                                                    <span>{file.size} Rows</span>                                                    
                                                  </li>
                                                );
                                              })}
                                            </>
                                          ) : (
                                            // =============================
                                            // === Files RESULTS LIST ===
                                            // =============================
                                            <>
                                              {batchFilesSearchResults.map((file, index) => {
                                                const name = file?.name || "";
                                                const size = file?.size || "";
                                                return (
                                                  <li
                                                    key={`nonhive-${name}-${index}`}
                                                    style={{
                                                      backgroundColor: batchFilesCollection.some(
                                                        (selectedFile) => selectedFile.name === name && selectedFile.size === size
                                                      )
                                                        ? "var(--disabled-bg)"
                                                        : "",
                                                      color: batchFilesCollection.some(
                                                        (selectedFile) => selectedFile.name === name && selectedFile.size === size
                                                      )
                                                        ? "var(--muted-text)"
                                                        : "",
                                                    }}
                                                    onClick={() => {
                                                      windowAction(id, "batch_files_select_file", "toggle_select", {
                                                        name,
                                                        size: file.size,
                                                        date: file.date,                                                        
                                                        path: file.path,
                                                        type: file.type                                                        
                                                      });
                                                    }}
                                                  >
                                                    <span title={name}>{name}</span>
                                                    <span>{file.date}</span>
                                                    <span>{file.size} Kb</span>
                                                  </li>
                                                );
                                              })}

                                              {/* ===========================
                                                  ===== LOAD MORE BUTTON =====
                                                  =========================== */}
                                              {batchFilesSearchMoreFiles && (
                                                <li
                                                  style={{
                                                    backgroundColor:
                                                      searchPlaceholder === "Load more" ? "var(--panel-bg)" : "",
                                                    color:
                                                      searchPlaceholder === "No more files" ? "var(--muted-text)" : "",
                                                  }}
                                                  className="batch_files_search_results_load_more"
                                                  onClick={() =>
                                                    windowAction(
                                                      id,
                                                      "batch_files_search_input",
                                                      "load_more",
                                                      [
                                                        document.getElementById(`batch_files_search_input_${id}`).value,
                                                        document.getElementById(`batch_files_search_date_${id}`)?.value || "",
                                                        batchFilesSearchHybrid,
                                                        document.getElementById(`batch_files_search_column_${id}`)?.value || "",
                                                        document.getElementById(`batch_files_search_strict_${id}`)?.checked || false,
                                                      ]
                                                    )
                                                  }
                                                >
                                                  {searchPlaceholder}
                                                </li>
                                              )}
                                            </>
                                          )
                                        ) : (
                                          // No results
                                          <li style={{ backgroundColor: "var(--disabled-bg)", color: "var(--muted-text)" }}>
                                            No results Found!
                                          </li>
                                        )}
                                      </>
                                    )}
                                  </ul>
                                </div>
                              </div>
                            </fieldset>
                            <fieldset className="batch_files_table_form_fieldset">
                              <legend><b>Selected Files</b></legend>
                              <table>
                                <thead>
                                  <tr>
                                    <th>ID</th>
                                    <th>File name</th>
                                    <th>Date</th>
                                    <th>Size / Rows</th>
                                    <th></th>
                                  </tr>
                                </thead>
                                <tbody>
                                    {batchFilesCollection.length > 0 ? (
                                      console.log("hey:",batchFilesCollection),
                                        batchFilesCollection.map((file, index) => (
                                          <tr key={index}>
                                            <td>{index + 1}</td>
                                            <td>{file.name || file.response}</td>
                                            <td>{file.date || '*'}</td>
                                            <td>{file.size || '*'}</td>
                                            <td
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const name=file.name || file.response;
                                                const date=file.last || null;
                                                const size=file.size || null;

                                                const payload = {
                                                  name: name,
                                                  date: date,
                                                  size: size,
                                                };
                                                console.log("batchFilesCollection:",batchFilesCollection)
                                                windowAction(id, "batch_files_select_file", "toggle_select", payload);
                                              }}
                                          >                                            
                                            <Icons
                                              id="window_live_source_option"
                                              type="minus"
                                              condition="True"
                                              onClick={() => handleRemoveFile(index)} // Logic to remove the file
                                            />
                                          </td>
                                        </tr>
                                      ))
                                    ) : null}
                                  {batchFilesCollection.length === 0 && (
                                    <tr>
                                      <td colSpan="5" style={{ textAlign: "center" }}>
                                        No files selected
                                      </td>
                                    </tr>
                                  )}
                                </tbody>
                              </table>
                            </fieldset>
                          </form>
                        </div>
                      )}
                      {selectedSubContent === "batch_input_form_pageIII" && (
                        <div>
                          <div id="batch_input_form_response" className="form_response_container"
                            style={getStatusToneStyle(windowResponseI)}>
                            <span>
                              <Icons
                                id="window_live_source_option"
                                type={
                                  windowResponseI === null ? "loadingx" :
                                  windowResponseI === "Connecting..." ? "loadingx" :
                                  windowResponseI === "..." ? "loadingx" :
                                  windowResponseI === "Connection established!" ? "correctx" :
                                  windowResponseI === "Dataset uploaded!" ? "correctx" : "errorx"
                                }
                                condition="True"
                              />
                            </span>
                            <span>{windowResponseI || "..."}</span>
                          </div>
                          <form className="batch_files_dataframe_form" onSubmit={(e) => { e.preventDefault()}}>
                            <fieldset className="batch_files_dataframe_form_fieldset">
                              <legend><b>Dataframe</b> Infomation</legend>
                              <div className="batch_files_dataframe_infos">
                               <div id="batch_files_dataframe_infos_left_container" className="dataframe_infos_left_container">
                                {batchFilesDataframeInfoI && batchFilesDataframeInfoI.length > 0 && (
                                  <table id="batch_files_dataframe_infos_left_table" cellPadding='0'>
                                    <tbody>
                                      <tr>
                                        <td>Source files</td>
                                        <td>
                                          <ul>
                                            {batchFilesCollection.map((file, index) => {
                                              return <li key={index}>{file.name || JSON.stringify(file)}</li>;
                                            })}
                                          </ul>
                                        </td>
                                      </tr>
                                      <tr>
                                        <td>Total rows</td>
                                        <td>{batchFilesDataframeInfoI[4]}</td>
                                      </tr>
                                      <tr>
                                        <td>Total columns</td>
                                        <td>{batchFilesDataframeInfoI[3]}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                )}
                               </div>
                               <div id="batch_files_dataframe_infos_right_container" className="dataframe_infos_right_container">
                                {batchFilesDataframeInfoI && batchFilesDataframeInfoI.length > 0 && (
                                  <table id="batch_files_dataframe_infos_right_table" cellPadding='0'>
                                    <tbody>
                                      <tr>
                                        <td>Broker/API</td>
                                        <td>{batchFilesDataframeInfoI[1]}</td>
                                      </tr>
                                      <tr>
                                        <td>Storage</td>
                                        <td>{batchFilesDataframeInfoI[6]}</td>
                                      </tr>
                                      <tr>
                                        <td>Tool</td>
                                        <td>{batchFilesDataframeInfoI[7]}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                )}
                               </div>
                              </div>
                            </fieldset>
                            <fieldset className="batch_files_dataframe_filter_and_actions">
                              <legend><b> Filters & Actions </b></legend>
                              <div className="batch_files_dataframe_filter_and_actions_container">
                                <div className="batch_files_dataframe_action_inputs">
                                  <label className="actions_label"><i><b>Note :</b> This fields are mandatory.</i></label>
                                  <div className="actions_partition">
                                    <label>Dataframe Action</label>
                                    <select id={`batch_files_dataframe_action_select_${type}_${id}`} value={batchFilesDataframeActionValue ? batchFilesDataframeActionValue:''} disabled={batchFilesDataframeInfoI[0] ? false:true} onChange={(e) => windowAction(id,"batch_files_actions_select","change",e.target.value)} className="actions_select_options">
                                      <option value="" disabled>Select Action</option>
                                      {batchFilesDataframeInfoI && batchFilesDataframeInfoI[0] ? (
                                        batchFilesDataframeInfoI[0].map((item, index) => (
                                            <option key={index} value={item}>{item}</option>
                                          ))
                                        ) : (
                                          <option>No actions</option>
                                      )}
                                    </select>
                                  </div>
                                  <div className="actions_partition">
                                    <label>Source/Target</label>                                    
                                    <select id={`batch_files_dataframe_source_select_${type}_${id}`} value={batchFilesDataframeSourceValue ? batchFilesDataframeSourceValue:''} disabled={batchFilesDataframeInfoI[2]  && batchFilesDataframeActionValue === "Source / Target Relationship" ? false:true} onChange={(e) => windowAction(id,"batch_files_source_select","change",e.target.value)} style={{float:'left',position:'relative',width:'32.5%',borderRight:'0.1vh dashed var(--input-border)',marginRight:'0.1vw'}}>
                                      <option value="" disabled>Select Source</option>
                                      {batchFilesDataframeInfoI[2] ? (
                                        batchFilesDataframeInfoI[2].map((item, index) => (
                                            <option key={index} value={item}>{item}</option>
                                          ))
                                        ) : (
                                          <option>No columns</option>
                                      )}
                                    </select>
                                    <select id={`batch_files_dataframe_target_select_${type}_${id}`} value={batchFilesDataframeTargetValue ? batchFilesDataframeTargetValue:''} disabled={batchFilesDataframeInfoI[2] && batchFilesDataframeActionValue === "Source / Target Relationship" ? false:true} onChange={(e) => windowAction(id,"batch_files_target_select","change",e.target.value)} style={{float:'left',position:'relative',width:'32%',borderRight:'0.1vh dashed var(--input-border)',marginRight:'0.1vw'}}>
                                      <option value="" disabled>Select Target</option>
                                      {batchFilesDataframeInfoI[2] ? (
                                        batchFilesDataframeInfoI[2].map((item, index) => (
                                            <option key={index} value={item}>{item}</option>
                                          ))
                                        ) : (
                                          <option>No columns</option>
                                      )}
                                    </select>
                                  </div>
                                  <div className="actions_partition">
                                    <label>Relationship label</label>                                    
                                    <input placeholder="HAS_RELATIONSHIP" value={batchFilesDataframeRelationshipValue ? batchFilesDataframeRelationshipValue:''} disabled={batchFilesDataframeActionValue === "Source / Target Relationship" && batchFilesDataframeSourceValue && batchFilesDataframeTargetValue ? false:true} onChange={(e) => windowAction(id,"batch_files_relationship_select","change",e.target.value)}
                                     type='text'/>
                                  </div>
                                  <div className="actions_partition">
                                    <label>Rule to apply</label>                                    
                                    <select id={`batch_files_dataframe_rule_select_${type}_${id}`} value={batchFilesDataframeRuleValue ? batchFilesDataframeRuleValue:''} disabled={batchFilesDataframeInfoI[5] && batchFilesDataframeActionValue === "Link Analysis" ? false:true} onChange={(e) => windowAction(id,"batch_files_rule_select","change",e.target.value)}>
                                      <option value="" disabled>Select Analysis rule</option>
                                      {batchFilesDataframeInfoI[5] ? (
                                        batchFilesDataframeInfoI[5].map((item, index) => (
                                            <option key={index} value={item}>{item}</option>
                                          ))
                                        ) : (
                                          <option>No Rules</option>
                                      )}
                                    </select>
                                  </div>                                                                                                      
                                </div>
                                <div className="batch_files_dataframe_filter_inputs">
                                  <label className="filters_label"><i><b>Note :</b> Changes require applying inorder to take effect.</i></label>
                                  <div className="filters_partition">
                                    <select id={`batch_files_dataframe_filter_selectI_${type}_${id}`} disabled={batchFilesDataframeInfoI[2] ? false:true} onChange={(e) => windowAction(id,"batch_files_target_select","change",e.target.value)} defaultValue="">
                                      <option value="" disabled>Select column</option>
                                      {batchFilesDataframeInfoI[2] ? (
                                        batchFilesDataframeInfoI[2].map((item, index) => (
                                            <option key={index} value={item}>{item}</option>
                                          ))
                                        ) : (
                                          <option>No columns</option>
                                      )}
                                    </select>
                                    <input type='text'/>
                                  </div>
                                  <div className="filters_partition">
                                    <select id={`batch_files_dataframe_filter_selectII_${type}_${id}`} disabled={batchFilesDataframeInfoI[2] ? false:true} onChange={(e) => windowAction(id,"batch_files_target_select","change",e.target.value)} defaultValue="">
                                      <option value="" disabled>Select column</option>
                                      {batchFilesDataframeInfoI[2] ? (
                                        batchFilesDataframeInfoI[2].map((item, index) => (
                                            <option key={index} value={item}>{item}</option>
                                          ))
                                        ) : (
                                          <option>No columns</option>
                                      )}
                                    </select>
                                    <input type='text'/>
                                  </div>
                                  <div className="filters_query_partition">
                                    <label>Query area</label>
                                    <textarea placeholder="Type a query to filter with."></textarea>
                                  </div>
                                </div>
                              </div>
                              <div className="batch_files_dataframe_filter_menu">
                                <span className="batch_files_dataframe_filter_menu_rows">{batchFilesDataframeInfoI[4]} Data rows</span>
                                <span className="batch_files_dataframe_filter_menu_add_btn">
                                  <button>Apply filter</button>
                                </span>
                              </div>
                            </fieldset>
                          </form>
                        </div>
                      )}
                      {selectedSubContent === "batch_input_form_pageIV" && (
                        <div>
                          <div id="batch_input_form_response" className="form_response_container"
                            style={getStatusToneStyle(windowResponseI)}>
                            <span>
                              <Icons
                                id="window_live_source_option"
                                type={
                                  windowResponseI === null ? "loadingx" :
                                  windowResponseI === "Connecting..." ? "loadingx" :
                                  windowResponseI === "..." ? "loadingx" :
                                  windowResponseI === "Streaming..." ? "streamx" :
                                  windowResponseI === "Connection established!" ? "correctx" : "errorx"
                                }
                                condition="True"
                              />
                            </span>
                            <span>{windowResponseI || "..."}</span>
                          </div>
                          <form className="batch_files_dataframe_form" onSubmit={(e) => { e.preventDefault()}}>
                            <fieldset className="batch_files_dataframe_form_fieldset">
                              <legend><b>Dataframe</b> Infomation</legend>
                              <div className="batch_files_dataframe_infos">
                               <div id="batch_files_dataframe_infos_left_container" className="dataframe_infos_left_container">
                                {batchFilesDataframeInfoI && batchFilesDataframeInfoI.length > 0 && (
                                  <table id="batch_files_dataframe_infos_left_table" cellPadding='0'>
                                    <tbody>
                                      <tr>
                                        <td>Source files</td>
                                        <td>
                                          <ul>
                                            {batchFilesCollection.map((file, index) => {
                                              return <li key={index}>{file.name || JSON.stringify(file)}</li>;
                                            })}
                                          </ul>
                                        </td>
                                      </tr>
                                      <tr>
                                        <td>Total rows</td>
                                        <td>{batchFilesDataframeInfoI[4]}</td>
                                      </tr>
                                      <tr>
                                        <td>Total columns</td>
                                        <td>{batchFilesDataframeInfoI[3]}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                )}
                               </div>
                               <div id="batch_files_dataframe_infos_right_container" className="dataframe_infos_right_container">
                                {batchFilesDataframeInfoI && batchFilesDataframeInfoI.length > 0 && (
                                  <table id="batch_files_dataframe_infos_right_table" cellPadding='0'>
                                    <tbody>
                                      <tr>
                                        <td>Broker/API</td>
                                        <td>{batchFilesDataframeInfoI[1]}</td>
                                      </tr>
                                      <tr>
                                        <td>Storage</td>
                                        <td>{batchFilesDataframeInfoI[6]}</td>
                                      </tr>
                                      <tr>
                                        <td>Tool</td>
                                        <td>{batchFilesDataframeInfoI[7]}</td>
                                      </tr>
                                    </tbody>
                                  </table>
                                )}
                               </div>
                              </div>
                            </fieldset>
                            <fieldset className="batch_files_dataframe_form_fieldset">
                              <legend><b> Session log </b></legend>
                              <textarea ref={el => (textareaRefs.current[id] = el)} className="batch_files_dataframe_filter_log_textarea" readOnly value={sourceSessionLog || ''}></textarea>
                            </fieldset>
                          </form>
                        </div>
                      )}
                    </div>
                    <div className="batch_connection_form_pager_container">
                      {isRealtimeSourceWorkflow && selectedSubContent === "batch_input_form_pageIII" && !canStartRealtimeStream ? (
                        <div className="tool_form_response">
                          <Icons id="window_live_source_option" type="warningx" condition="True" />
                          <span style={getToolStatusTextStyle("Not connected!")}>{realtimeStartBlockedMessage}</span>
                        </div>
                      ) : null}
                      <button onClick={() => {
                          const previousStep = getPreviousBatchSourceStep(batchSourceFlow);
                          if (isRealtimeSourceWorkflow && selectedSubContent === "batch_input_form_pageIII") {
                            windowAction(id, "batch_input_form_swap_passive", "page_I", { mode: "realtime" });
                          }
                          else if (previousStep === SOURCE_FLOW_STEPS.CONNECT) {
                            windowAction(id, "batch_input_form_swap_passive", "page_I", isRealtimeSourceWorkflow ? { mode: "realtime" } : null);
                          }
                          else if (previousStep === SOURCE_FLOW_STEPS.SEARCH) {
                            windowAction(id, "batch_input_form_swap_passive", "page_II", isRealtimeSourceWorkflow ? { mode: "realtime" } : null);
                          }
                          else if (previousStep === SOURCE_FLOW_STEPS.DATAFRAME) {
                            windowAction(id, "batch_input_form_swap_passive", "page_III", isRealtimeSourceWorkflow ? { mode: "realtime" } : null);
                          }
                          else{
                            return null;
                          }
                        }}
                        disabled={
                          (isRealtimeSourceWorkflow && selectedSubContent === "batch_input_form_pageIII") ||
                          getPreviousBatchSourceStep(batchSourceFlow) === SOURCE_FLOW_STEPS.CONNECT ||
                          !(
                            (selectedSubContent !== "batch_input_form_pageI" && selectedSubContent !== "batch_input_form_pageIV") ||
                            (selectedSubContent === "batch_input_form_pageIV" && !sourceStreamListener)
                          ) ? 'True' : ''
                        }>
                        {"Back"}    
                      </button>
                      <button onClick={() => {
                          if (selectedSubContent === "batch_input_form_pageI" && isBatchSourceConnected){
                            const sourceAddress = sourceAddressText || "";
                            const sourceTopic = sourceAddressType === "broker" ? (sourceTopicText || "") : null;
                            if (sourceAddressType === "broker" && !String(sourceTopic || "").trim()) {
                              alert("Kafka topic is required.");
                              return null;
                            }
                            windowAction(id, "batch_input_form_swap", "page_II",{"addressType":sourceAddressType,"address":sourceAddress,"topic":sourceTopic,"mode":"batch"});
                          }
                          else if (selectedSubContent === "batch_input_form_pageI" && isBatchSourceUploaded){
                            windowAction(id, "batch_input_form_swap", "page_III",null);
                          }
                          else if (selectedSubContent === "batch_input_form_pageII"){
                            windowAction(id, "batch_input_form_swap", "page_III",null);
                          }
                          else if (selectedSubContent === "batch_input_form_pageIII"){
                            if (isRealtimeSourceWorkflow && !canStartRealtimeStream) {
                              alert(realtimeStartBlockedMessage);
                              return null;
                            }
                            windowAction(id, "batch_input_form_swap", "page_IV",null);
                          }
                          else if (selectedSubContent === "batch_input_form_pageIV" && sourceStreamListener){
                            windowAction(id, "batch_input_stream_terminate", "page_IV",null);
                          }
                          else if (selectedSubContent === "batch_input_form_pageIV" && !sourceStreamListener){
                            if (isRealtimeSourceWorkflow && !canStartRealtimeStream) {
                              alert(realtimeStartBlockedMessage);
                              return null;
                            }
                            windowAction(id, "batch_input_form_swap", "page_IV",null);
                          }
                          else{
                            console.log("NoPage to swap")
                            return null;
                          }
                        }}
                        disabled={
                          selectedSubContent === "batch_input_form_pageI" && isBatchSourceConnected && isBatchToolConnected ||
                          selectedSubContent === "batch_input_form_pageI" && isBatchSourceUploaded && isBatchToolConnected ||
                          selectedSubContent === "batch_input_form_pageII" && isBatchSourceUploaded && isBatchToolConnected ||
                          selectedSubContent === "batch_input_form_pageII" && batchFilesCollection.length> 0  || 
                          selectedSubContent === "batch_input_form_pageIII" && isRealtimeSourceWorkflow && !canStartRealtimeStream ||
                          selectedSubContent !== "batch_input_form_pageIV" && batchFilesDataframeActionValue === "Store data" || 
                          selectedSubContent !== "batch_input_form_pageIV" && batchFilesDataframeActionValue === "Source / Target Relationship" && batchFilesDataframeSourceValue && batchFilesDataframeTargetValue ||
                          selectedSubContent !== "batch_input_form_pageIV" && batchFilesDataframeActionValue === "Link Analysis" && batchFilesDataframeRuleValue || 
                          selectedSubContent === "batch_input_form_pageIV" && sourceStreamListener? '': 'True' 
                        }>
                        {selectedSubContent === "batch_input_form_pageIII" || selectedSubContent === "batch_input_form_pageIV" && !sourceStreamListener ? "Stream Graph":
                        selectedSubContent === "batch_input_form_pageIV" ? "Terminate"  : "Next"}
                      </button>
                      {selectedSubContent === "batch_input_form_pageIV" && sourceStreamListener && (
                        <button
                          onClick={() => {
                            if (!handleOpenWindows) return;
                            const newGraphId = handleOpenWindows("graph", "");
                            if (newGraphId) {
                              setTimeout(() => {
                                windowAction(newGraphId, "graph_link_form", "link", {
                                  sourceId: id,
                                  graphId: newGraphId
                                });
                              }, 150);
                            }
                          }}
                        >
                          Open Graph
                        </button>
                      )}
                    </div>
                  </div>
                )}
            </div>
            <div id={`window_properties_${type}_${id}`}  className="properties_container">
              {selectedContent === "null1" && (
                <div className="live_source_options_properties">
                  prop
                </div>
              )}
              {selectedContent === "null2" && (
                <div className="placeholder">
                  <IframeEmbed wId={id} id="source_placeholder" fileName="source_placeholder" activeGraph={activeGraph} graphAction={graphAction} iframeRef={iframeRef} BASE_URL={BASE_URL} themeMode={themeMode}/>
                </div>
              )}
            </div>
            <div id={`window_footer_${type}_${id}`}  className='window_footer'>
              <span>
                <b>window Id : </b>
                <i>{id}</i>
              </span>
            </div>
          </div>
        )}
      </DraggableWindow>
    )
  }
  if (type === "graph"){ //Graph window
    return (
      <DraggableWindow initialPos={{ top: 0, left: 0}} zIndex={zIndex} orientation={orientation}>
        {(dragProps) => (
          <div id={`window_${type}_${id}`} style={{ zIndex }} 
            className={
              orientation === "tabs"
                ? `window tab_mode ${covered ? '' : 'focused'} ${dragProps.isDragging ? 'dragging' : ''}`
                : `window ${covered ? '' : 'focused'} ${dragProps.isDragging ? 'dragging' : ''}`
            }
            onMouseDown={() => onFocus(id)}>
            <div id={`window_loadscreen_${type}_${id}`} className="windows_loadscreen" style={{ display: loadscreenState ? "block" : "none" }}>
              <Loadscreen loadingText={loadscreenText} showCancel={canCancelGraphStaging} onCancel={() => windowAction(id, "cancel_graph_staging")} />
            </div>
            {(covered || dragProps.isDragging) && <div className="window_cover" />}  
            <div id={`window_bar_${type}_${id}`} className="window_bar"
              onMouseDown={isMaximized ? undefined : dragProps.onBarMouseDown} onDoubleClick={() => windowAction(id,"window_change_view", "",iframeRef)}>
              <div className="window_bar_title_container">Graph Window<input placeholder="Add custom title" type="text"/></div>
              <div className="window_bar_btns_container">
                <span onClick={() => onClose(id)}>x</span>
                <span onClick={() => windowAction(id,"window_change_view", "",iframeRef)}>                 
                  {isMaximized ? <Icons id="window_bar" type="maximize" condition="True" /> : <Icons id="window_bar" type="maximize" condition="True" />}
                </span>
                <span>-</span>
              </div>
            </div>
            <div id={`window_side_bar_${type}_${id}`} className='side_bar'>
              {/* New Graph */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `new_graph_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `new_graph_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`new_graph_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `new_graph_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `new_graph_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="newGraph" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `new_graph_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li onClick={() => windowAction(id,"new_graph",`new_graph_options_${type}_${id}`, iframeRef)}>
                      <div className="window_side_bar_menu_list_I">
                        <span>Empty Graph</span>
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div>             
              {/* Link Graph Options */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `link_graph_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `link_graph_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`link_graph_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `link_graph_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `link_graph_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="link" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `link_graph_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <div className="window_side_bar_menu_list_I">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (graphLink) {
                              // unlink logic
                              windowAction(id, "graph_link_form", "unlink", {
                                sourceId: graphLinkId,
                                graphId: id
                              });
                            } else {
                              const newGraphLinkId = sanitizeGraphEndpointId(document.getElementById(`graph_link_id_input_${id}`).value, { maxLength: 128 });
                              windowAction(id, "graph_link_form", "link", {
                                sourceId: newGraphLinkId,
                                graphId: id,
                                iframe: iframeRef
                              });
                            }
                          }}
                         > 
                        <input
                          id={`graph_link_id_input_${id}`}
                          type="text"
                          placeholder={graphLink ? graphLinkId : 'Enter window ID'}
                          disabled={Boolean(graphLink)}                          
                        />
                        <button type="submit">
                          {graphLink ? 'Unlink' : 'Link'}
                        </button>
                      </form>
                      </div>                                        
                  </ul>
                </div>
              </div> 
              {/* Upload Graph */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `upload_graph_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `upload_graph_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`upload_graph_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `upload_graph_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `upload_graph_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="upload" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `upload_graph_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li onClick={() => windowAction(`upload_graph_options_${type}_${id}`, "upload")}>
                      <div className="window_side_bar_menu_list_I">
                        <span onClick={() => {
                            const input = document.createElement("input");
                            input.type = "file";
                            input.accept = ".json,.html";

                            input.onchange = (e) => {
                              const file = e.target.files[0];
                              if (!file) return;
                              const applyUpload = () => windowAction(id, "load_graph_url", file, iframeRef);
                              if (typeof requestConfirmation === "function") {
                                requestConfirmation({
                                  title: "Confirm Replace",
                                  message: "Any unsaved progress will be lost. Continue?",
                                  source: "Graph",
                                  level: "warning",
                                  confirmText: "Continue",
                                  cancelText: "Cancel"
                                }).then((shouldProceed) => {
                                  if (shouldProceed) applyUpload();
                                });
                                return;
                              }
                              const shouldProceed = window.confirm("Any unsaved progress will be lost. Continue?");
                              if (!shouldProceed) return;
                              applyUpload();
                            };

                            input.click();
                        }}>Upload Graph</span>
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div>
              {/* Save Graph */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `save_graph_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `save_graph_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`save_graph_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `save_graph_options_${type}_${id}` || false === false ? 'sbicon_disabled' : 'sbicon'}`} 
                  onClick={false !== false ? () => windowAction("side_bar_menu_list", `save_graph_options_${type}_${id}`, "") : null}>
                  <Icons id="window_side_bar" type="save" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `save_graph_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li onClick={() => windowAction(`save_graph_options_${type}_${id}`, "update")}>
                      <div className="window_side_bar_menu_list_I">
                        <span>Save Graph</span>
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div>
              {/* Snap Graph */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `snap_graph_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `snap_graph_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`snap_graph_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `snap_graph_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `snap_graph_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="capture" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `snap_graph_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li onClick={() => windowAction(id,"graph_snapshot", "",iframeRef)}>
                      <div className="window_side_bar_menu_list_I">
                        <span>Take a snap</span>
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div> 
              {/* Print Graph */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `print_graph_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `print_graph_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`print_graph_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `print_graph_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `print_graph_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="print" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `print_graph_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li onClick={() => windowAction(id,"graph_print", "",iframeRef)}>
                      <div className="window_side_bar_menu_list_I">
                        <span>Print Graph</span>
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div> 
              {/* Reset Graph */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `reset_graph_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `reset_graph_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`reset_graph_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `reset_graph_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `reset_graph_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="reset" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `reset_graph_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li onClick={() => windowAction(id,"reset_graph",`reset_graph_options_${type}_${id}`, iframeRef)}>
                      <div className="window_side_bar_menu_list_I">
                        <span>Reset Graph</span>
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div> 
              {/* Export JSON */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `export_graph_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `export_graph_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`export_graph_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `export_graph_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `export_graph_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="export" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `export_graph_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li onClick={() => windowAction(`export_graph_options_${type}_${id}`, "update")}>
                      <div className="window_side_bar_menu_list_I">
                        <span onClick={() => {windowAction(id, "export_graph", "html", iframeRef);}}>Export HTML</span>
                      </div>                      
                    </li>
                    <li onClick={() => windowAction(`export_graph_options_${type}_${id}`, "update")}>
                      <div className="window_side_bar_menu_list_I">
                        <span onClick={() => {windowAction(id, "export_graph", "json", iframeRef);}}>Export JSON</span>
                      </div>                      
                    </li>
                    <li onClick={() => windowAction(`export_graph_options_${type}_${id}`, "update")}>
                      <div className="window_side_bar_menu_list_I">
                        <span onClick={() => {windowAction(id, "graph_report", "html", iframeRef);}}>Generate Report</span>
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div> 
            </div>
            <div id={`window_content_${type}_${id}`} className="content_container">
           {/* Graph iframe: show placeholder or actual graph */}
            {(selectedContent === "graph_content" || selectedContent === null) && (
              <div className="placeholder">
                <IframeEmbed
                  wId={id}
                  id={selectedContent === null ? "graph_placeholder" : activeGraph}
                  fileName={selectedContent === null ? "graph_placeholder" : activeGraph}
                  activeGraph={selectedContent === null ? null : activeGraph}
                  graphAction={graphAction}
                  iframeRef={iframeRef}
                  BASE_URL={BASE_URL}
                />
              </div>
            )}
          </div>
          <div id={`window_properties_${type}_${id}`} className="properties_container">
            {/* Settings panel: only show when a graph iframe is present */}
            {(selectedContent === "graph_content" || selectedContent === null) && 
            (
              <WindowVerticalSplitPanels
                id={id}
                type={type}
                sourceId={graphLinkSource}
                initialTopHeight="75%"
                minTopHeight="5%"
                maxTopHeight="90%"
                graphStatus={graphStatus}
                graphStatusBySession={graphStatusBySession}
                graphRenderStats={graphRenderStats}
                activeGraph={activeGraph}
                graphAction={graphAction}
                iframeRef={iframeRef}  // same ref as iframe
                iframeFilters={iframeFilters}
                iframeSettings={iframeSettings}
                iframeSearch={iframeSearch}
                performanceMood={iframePerformanceMood?.[id] ?? true}
                selectedPropertyTab={selectedPropertyTab}
                nodeProperties={nodeProperties}
                filterPropertyKeys={filterPropertyKeys}
                filterResults={filterResults}
              />
              )}
            </div>
            <div id={`window_footer_${type}_${id}`}  className='window_footer'>
              <div className='window_footer'>
                <span>
                  <b>Window Id : </b>
                  <i>{id}</i>
                </span>
              </div>
            </div>
          </div>
        )}
      </DraggableWindow>
    )
  }
  if (type === "chart"){ //Graph window
    return (
      <DraggableWindow initialPos={{ top: 0, left: 0}} zIndex={zIndex} orientation={orientation}>
        {(dragProps) => (
          <div id={`window_${type}_${id}`} style={{ zIndex }} 
            className={
              orientation === "tabs"
                ? `window tab_mode ${covered ? '' : 'focused'} ${dragProps.isDragging ? 'dragging' : ''}`
                : `window ${covered ? '' : 'focused'} ${dragProps.isDragging ? 'dragging' : ''}`
            }
            onMouseDown={() => onFocus(id)}>
            <div id={`window_loadscreen_${type}_${id}`} className="windows_loadscreen" style={{ display: loadscreenState ? "block" : "none" }}>
              <Loadscreen loadingText={loadscreenText} />
            </div>
            {(covered || dragProps.isDragging) && <div className="window_cover" />}  
            <div id={`window_bar_${type}_${id}`} className="window_bar"
              onMouseDown={isMaximized ? undefined : dragProps.onBarMouseDown} onDoubleClick={() => windowAction(id,"window_change_view", "",iframeRef)}>
              <div className="window_bar_title_container">Chart Window<input placeholder="Add custom title" type="text"/></div>
              <div className="window_bar_btns_container">
                <span onClick={() => onClose(id)}>x</span>
                <span onClick={() => windowAction(id,"window_change_view", "",iframeRef)}>                 
                  {isMaximized ? <Icons id="window_bar" type="maximize" condition="True" /> : <Icons id="window_bar" type="maximize" condition="True" />}
                </span>
                <span>-</span>
              </div>
            </div>
            <div id={`window_side_bar_${type}_${id}`} className='side_bar'>
              {/* Add chart Options */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `new_chart_options_${type}_${id}` && chartLink !== false ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `new_chart_options_${type}_${id}` && chartLink !== false 
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}
                >
                <i
                  className={`${
                  isSideBarMenuOpen === `new_chart_options_${type}_${id}` || chartLink === false ? 'sbicon_toggled' : 'sbicon'
                  }`}
                  onClick={chartLink !== false ? () =>
                    windowAction('side_bar_menu_list', `new_chart_options_${type}_${id}`, '') : null
                  }>
                  <Icons id="window_side_bar" type="newChart" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `new_chart_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li>
                      <div className="window_side_bar_menu_list_I">
                        <span>Global-Level Charts</span>
                        <ul className="window_side_bar_menu_list_II">
                        <li onClick={() => windowAction(id, "create_chart", "Assortativity", {iframe:iframeRef})}>Assortativity</li>
                        <li onClick={() => windowAction(id, "create_chart", "Reciprocity", {iframe:iframeRef})}>Reciprocity</li>
                        <li onClick={() => windowAction(id, "create_chart", "Global Metrics", {iframe:iframeRef})}>Global Metrics</li>
                        <li onClick={() => windowAction(id, "create_chart", "Cohesion Metrics", {iframe:iframeRef})}>Cohesion Metrics</li>
                        <li onClick={() => windowAction(id, "create_chart", "Temporal Metrics", {iframe:iframeRef})}>Temporal Metrics</li>                        
                      </ul>
                      </div>                      
                    </li>
                    <li>
                      <div className="window_side_bar_menu_list_I">
                        <span>Node-Level Charts</span>
                        <ul className="window_side_bar_menu_list_II">
                        <li onClick={() => windowAction(id, "create_chart", "Degree Centrality", {iframe:iframeRef})}>Degree Centrality</li>
                        <li onClick={() => windowAction(id, "create_chart", "In / Out Degree", {iframe:iframeRef})}>In / Out Degree</li>
                        <li onClick={() => windowAction(id, "create_chart", "Betweenness Centrality", {iframe:iframeRef})}>Betweenness Centrality</li>
                        <li onClick={() => windowAction(id, "create_chart", "Closeness Centrality", {iframe:iframeRef})}>Closeness Centrality</li>
                        <li onClick={() => windowAction(id, "create_chart", "Eigenvector Centrality", {iframe:iframeRef})}>Eigenvector Centrality</li>
                        <li onClick={() => windowAction(id, "create_chart", "Katz Centrality", {iframe:iframeRef})}>Katz Centrality</li>
                        <li onClick={() => windowAction(id, "create_chart", "PageRank", {iframe:iframeRef})}>PageRank</li>
                        <li onClick={() => windowAction(id, "create_chart", "Clustering Coefficient", {iframe:iframeRef})}>Clustering Coefficient</li>
                        <li onClick={() => windowAction(id, "create_chart", "Local Eccentricity", {iframe:iframeRef})}>Local Eccentricity</li>
                        <li onClick={() => windowAction(id, "create_chart", "HITS (Authority / Hub Scores)", {iframe:iframeRef})}>HITS (Authority / Hub Scores)</li>
                        <li onClick={() => windowAction(id, "create_chart", "Constraint (Structural Holes)", {iframe:iframeRef})}>Constraint (Structural Holes)</li>
                        <li onClick={() => windowAction(id, "create_chart", "Ego Network Size / Density", {iframe:iframeRef})}>Ego Network Size / Density</li>
                      </ul>
                      </div>                      
                    </li>
                    <li>
                      <div className="window_side_bar_menu_list_I">
                        <span>Edge-Level Charts</span>
                        <ul className="window_side_bar_menu_list_II">
                        <li onClick={() => windowAction(id, "create_chart", "Edge Betweenness", {iframe:iframeRef})}>Edge Betweenness</li>
                        <li onClick={() => windowAction(id, "create_chart", "Edge Weight", {iframe:iframeRef})}>Edge Weight</li>
                        <li onClick={() => windowAction(id, "create_chart", "Edge Embeddedness", {iframe:iframeRef})}>Edge Embeddedness</li>
                        <li onClick={() => windowAction(id, "create_chart", "Edge Similarity (Jaccard, Cosine)", {iframe:iframeRef})}>Edge Similarity (Jaccard, Cosine)</li>                        
                      </ul>
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div>
              {/* Link chart Options */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `link_chart_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `link_chart_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i id={`link_chart_options_${type}_${id}`} className={`${
                  isSideBarMenuOpen === `link_chart_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`} onClick={() => windowAction("side_bar_menu_list", `link_chart_options_${type}_${id}`, "")}>
                  <Icons id="window_side_bar" type="link" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `link_chart_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <div className="window_side_bar_menu_list_I">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (chartLink) {
                              // unlink logic
                              windowAction(id, "chart_link_form", "unlink", {
                                graphId: chartLinkId,
                                chartId: id
                              });
                            } else {
                              const newChartLinkId = sanitizeIdentifier(document.getElementById(`chart_link_id_input_${id}`).value, { maxLength: 120 });
                              windowAction(id, "chart_link_form", "link", {
                                graphId: newChartLinkId,
                                chartId: id
                              });
                            }
                          }}
                        >
                          <input
                            id={`chart_link_id_input_${id}`}
                            type="text"
                            placeholder={chartLink ? chartLinkId : 'Enter window ID'}
                            disabled={Boolean(chartLink)}
                          />
                          <button type="submit">
                            {chartLink ? 'Unlink' : 'Link'}
                          </button>
                        </form>
                      </div>                                        
                  </ul>
                </div>
              </div> 
              {/* Snap chart */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `snap_chart_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `snap_chart_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i
                  className={`${
                  isSideBarMenuOpen === `snap_chart_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`}
                  onClick={() =>
                    windowAction('side_bar_menu_list', `snap_chart_options_${type}_${id}`, '')
                  }>
                  <Icons id="window_side_bar" type="capture" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `snap_chart_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li>
                      <div className="window_side_bar_menu_list_I">
                        <span onClick={() => windowAction(id,"chart_snapshot", "",iframeRef)}>Take snaps</span>                        
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div>
              {/* Print chart */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `print_chart_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `print_chart_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i
                  className={`${
                  isSideBarMenuOpen === `print_chart_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`}
                  onClick={() =>
                    windowAction('side_bar_menu_list', `print_chart_options_${type}_${id}`, '')
                  }>
                  <Icons id="window_side_bar" type="print" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `print_chart_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li>
                      <div className="window_side_bar_menu_list_I">
                        <span onClick={() => windowAction(id,"chart_print", "",iframeRef)}>Print Charts</span>                        
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div>
              {/* Reset Chart */}
              <div
                className={`side_bar_menu ${
                  isSideBarMenuOpen === `reset_chart_options_${type}_${id}` ? 'show' : ''
                }`}
                style={{
                  backgroundColor:
                    isSideBarMenuOpen === `reset_chart_options_${type}_${id}`
                      ? ''
                      : 'rgba(0,0,0,0)',
                  borderRadius: '5px',
                }}>
                <i
                  className={`${
                  isSideBarMenuOpen === `reset_chart_options_${type}_${id}` ? 'sbicon_toggled' : 'sbicon'
                }`}
                  onClick={() =>
                    windowAction('side_bar_menu_list', `reset_chart_options_${type}_${id}`, '')
                  }>
                  <Icons id="window_side_bar" type="reset" condition="True" />
                </i>
                <div
                  className={`side_bar_btn_options ${
                    isSideBarMenuOpen === `reset_chart_options_${type}_${id}` ? 'show' : ''
                  }`}>
                  <ul>
                    <li>
                      <div className="window_side_bar_menu_list_I">
                        <span onClick={() => windowAction(id,"chart_reset", "",iframeRef)}>Reset Charts</span>                        
                      </div>                      
                    </li>
                  </ul>
                </div>
              </div>
            </div>
            <div id={`window_content_${type}_${id}`} className="content_container">
            {/* Graph iframe: show placeholder or actual graph */}
              {(selectedContent === "graph_content" || selectedContent === null) && (
                <div className="placeholder">
                  <IframeEmbed
                    wId={id}
                    id={selectedContent === null ? "graph_placeholder" : activeGraph}
                    fileName={selectedContent === null ? "graph_placeholder" : activeGraph}
                    activeGraph={selectedContent === null ? null : activeGraph}
                    graphAction={graphAction}
                    iframeRef={iframeRef}
                    BASE_URL={BASE_URL}
                  />
                </div>
              )}
          </div>
          <div id={`window_properties_${type}_${id}`} className="properties_container">
            {/* Settings panel: only show when a chart iframe is present */}
            {(selectedContent === "chart_content" || selectedContent === null) && 
            (
              <div></div>
              )}
            </div>
            <div id={`window_footer_${type}_${id}`}  className='window_footer'>
              <div className='window_footer'>
                <span>
                  <b>Window Id : </b>
                  <i>{id}</i>
                </span>
              </div>
            </div>
          </div>
        )}
      </DraggableWindow>
    )
  }
}
const workspaceBackgroundVideo = import.meta.env.BASE_URL + "site_videos/background.mp4";
const fallbackWorkspaceBackgroundVideo = "/site_videos/background.mp4";
const workspaceBackgroundImage = import.meta.env.BASE_URL + "site_images/Linkx_background_basic.webp";
const fallbackWorkspaceBackgroundImage = "/site_images/Linkx_background_basic.webp";

function Main({userName,setSessionId, API_URL,debounceRef,setConfigurations, configurations,windows, setWindows, openWindows, themeMode, areBackgroundAnimationsEnabled }) {
  const hasRunRef = useRef(false);
  const iframeRef = useRef(null);
  const backgroundVideoRef = useRef(null);
  const [backgroundVideoSrc, setBackgroundVideoSrc] = useState(workspaceBackgroundVideo);
  const [isBackgroundVideoUnavailable, setIsBackgroundVideoUnavailable] = useState(false);
  const [backgroundImageSrc, setBackgroundImageSrc] = useState(workspaceBackgroundImage);
  const [isBackgroundImageLoaded, setIsBackgroundImageLoaded] = useState(false);

  const playBackgroundVideo = (videoElement = backgroundVideoRef.current) => {
    if (!videoElement) return;
    videoElement.play?.().catch(() => {});
  };

  const handleBackgroundVideoError = () => {
    if (backgroundVideoSrc === workspaceBackgroundVideo) {
      setBackgroundVideoSrc(fallbackWorkspaceBackgroundVideo);
      return;
    }
    setIsBackgroundVideoUnavailable(true);
  };

  const handleBackgroundImageError = () => {
    if (backgroundImageSrc === workspaceBackgroundImage) {
      setIsBackgroundImageLoaded(false);
      setBackgroundImageSrc(fallbackWorkspaceBackgroundImage);
    }
  };

  const handleBackgroundImageLoad = () => {
    setIsBackgroundImageLoaded(true);
  };
  useEffect(() => {
    if (!areBackgroundAnimationsEnabled) return;
    setIsBackgroundVideoUnavailable(false);
    setBackgroundVideoSrc(workspaceBackgroundVideo);
    backgroundVideoRef.current?.load?.();
    playBackgroundVideo();
  }, [areBackgroundAnimationsEnabled]);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;
    //openWindows('source', '',iframeRef);
    //openWindows('graph', '',iframeRef);

    // openWindows('chart', '',iframeRef);
  }, []);
  const shouldUseBackgroundVideo = areBackgroundAnimationsEnabled && !isBackgroundVideoUnavailable;

  return (
    <main
      id="main"
      className={`linkx_workspace_scene linkx_workspace_scene--${themeMode}`}
    >
      {themeMode === "dark" ? (
        <>
          {shouldUseBackgroundVideo ? (
            <video
              key={backgroundVideoSrc}
              ref={backgroundVideoRef}
              className="linkx_workspace_scene_video"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
              onCanPlay={(event) => playBackgroundVideo(event.currentTarget)}
              onError={handleBackgroundVideoError}
            >
              <source src={backgroundVideoSrc} type="video/mp4" />
            </video>
          ) : (
            <img
              key={backgroundImageSrc}
              className={`linkx_workspace_scene_image${isBackgroundImageLoaded ? " is-loaded" : ""}`}
              src={backgroundImageSrc}
              alt=""
              aria-hidden="true"
              decoding="async"
              fetchPriority="high"
              loading="eager"
              onLoad={handleBackgroundImageLoad}
              onError={handleBackgroundImageError}
            />
          )}
          <div className="linkx_workspace_scene_overlay" aria-hidden="true" />
        </>
      ) : (
        <div className="linkx_workspace_scene_light_plane" aria-hidden="true" />
      )}
    </main>
  );
}
const Loadscreen = ({ loadingText, showCancel = false, onCancel = null }) => {
    const [dotCount, setDotCount] = useState(0);

    useEffect(() => {
      const interval = setInterval(() => {
        setDotCount(prev => (prev + 1) % 4);
      }, 500);
      return () => clearInterval(interval);
    }, []);

    return (
      <div className="loadscreen">
        <div className="loadscreen_text">{loadingText}{'.'.repeat(dotCount)}</div>
        {showCancel && typeof onCancel === "function" && (
          <button className="loadscreen_cancel_btn" type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
	    );
}
function NotificationStack({ items, onDismiss }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (typeof document === "undefined" || !document.body) return null;

  return createPortal(
    (
      <div className="linkx_notice_stack">
        {items.map((item) => (
          <div key={item.id} className={`linkx_notice linkx_notice_${item.level || "info"}`}>
            <div className="linkx_notice_head">
              <span className="linkx_notice_title">{item.title || "Notification"}</span>
              <button className="linkx_notice_close" onClick={() => onDismiss(item.id)} title="Dismiss">
                x
              </button>
            </div>
            <div className="linkx_notice_body">{item.message}</div>
            <div className="linkx_notice_meta">{item.source || "Linkx"}</div>
          </div>
        ))}
      </div>
    ),
    document.body
  );
}
function ConfirmationDialog({ items, onResolve }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  if (typeof document === "undefined" || !document.body) return null;

  const active = items[0];
  if (!active) return null;

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onResolve(active.id, false);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        onResolve(active.id, true);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [active.id, onResolve]);

  return createPortal(
    (
      <div
        className="linkx_interaction_overlay_react"
        onClick={(event) => {
          if (event.target === event.currentTarget) onResolve(active.id, false);
        }}
      >
        <div className="linkx_interaction_panel_react">
          <div className="linkx_interaction_title">{active.title || "Confirm Action"}</div>
          <div className="linkx_interaction_message">{active.message}</div>
          <div className="linkx_interaction_actions">
            <button
              className="linkx_interaction_btn"
              type="button"
              onClick={() => onResolve(active.id, false)}
            >
              {active.cancelText || "Cancel"}
            </button>
            <button
              id="linkx_interaction_ok"
              className="linkx_interaction_btn"
              type="button"
              autoFocus
              onClick={() => onResolve(active.id, true)}
            >
              {active.confirmText || "Continue"}
            </button>
          </div>
        </div>
      </div>
    ),
    document.body
  );
}
function LinkxWorkspace() {
  const auth = useAuth();
  const { token, user, actor, roles, permissions, logout, verifyToken, hasPermission, hasRole } = auth;
  const [windows, setWindows] = useState([]);
  const [orientation, setOrientation] = useState(() => {
    if (typeof window === "undefined") return "tabs";
    const storedOrientation = window.localStorage.getItem("linkx_orientation_mode");
    return storedOrientation === "windows" ? "windows" : "tabs";
  }); // "windows" | "tabs"
  const [activeWindowId, setActiveWindowId] = useState(null);
  const [activeTabId, setActiveTabId] = useState(null);
  const windowIdRef = useRef(null);    // stores currently selected/active window
  const windowsRef = useRef([]);       // always mirrors latest windows[]
  const [isMaximized, setIsMaximized] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [zIndexCounter, setZIndexCounter] = useState(1); // zIndex counter
  const [sessionId, setSessionId] = useState(null);
  const [isToggleMenuOpen, setIsToggleMenuOpen] = useState(false);
  const [isTaskBarOpen, setIsTaskBarOpen] = useState(false);
  const [themeMode, setThemeMode] = useState("light");
  const { areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const [configurations, setConfigurations] = useState({});
  const [isConfigurationsOpen, setIsConfigurationsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReportsOpen, setIsReportsOpen] = useState(false);
  const [isWorkspaceLocked, setIsWorkspaceLocked] = useState(false);
  const [isUnlockingWorkspace, setIsUnlockingWorkspace] = useState(false);
  const [idleResetSeq, setIdleResetSeq] = useState(0);
  const [loadscreenState, setloadscreenState] = useState(false);
  const [loadscreenText, setloadscreenText] = useState('');
  const [isSideBarMenuOpen, setIsSideBarMenuOpen] = useState(false);
  const [selectedContent, setSelectedContent] = useState(null); // content to show inside the windows
  const [batchFilesSearchHybrid, setBatchFilesSearchHybrid] = useState(false);
  const [batchFilesSearchHiveQuery, setbatchFilesSearchHiveQuery] = useState(false);
  const [batchFilesSearchStrict, setBatchFilesSearchStrict] = useState(true);
  const [searchText, setSearchText] = useState(false);
  const searchButtonRef = useRef(null)
  const resultContainerRef = useRef(null);
  const [batchFilesSearchOffset, setBatchFilesSearchOffset] = useState(0);
  const [batchFilesSearchLimit, setBatchFilesSearchLimit] = useState(50);
  const [batchFilesSearchResults, setBatchFilesSearchResults] = useState([]);
  const [searchResultsVisible, setSearchResultsVisible] = useState(null);    
  const [batchFilesSearchMoreFiles, setBatchFilesSearchMoreFiles] = useState(true);
  const [searchPlaceholder, setSearchPlaceholder] = useState('');
  const [batchFilesDataframeInfoI, setBatchFilesDataframeInfoI] = useState([]);
  const [batchFilesDataframeInfoII, setBatchFilesDataframeInfoII] = useState([]);
  const [batchFilesDataframeActionValue, setBatchFilesDataframeActionValue] = useState(null);
  const [batchFilesDataframeRelationshipValue, setBatchFilesDataframeRelationshipValue] = useState(null);
  const [batchFilesDataframeSourceValue, setBatchFilesDataframeSourceValue] = useState(null);
  const [batchFilesDataframeTargetValue, setBatchFilesDataframeTargetValue] = useState(null);  
  const [batchFilesDataframeRuleValue, setBatchFilesDataframeRuleValue] = useState(null);
  const [sourceStreams, setSourceStreams] = useState({});  
  const [sourceStreamListener, setSourceStreamListener] = useState(false);
  const [sourceSessionLog, setSourceSessionLog] = useState('');
  const [sourceSessionLogFile, setSourceSessionLogFile] = useState(null);
  const [sourceSessionLogFiles, setSourceSessionLogFiles] = useState({});     
const fileInputRef = useRef(null);  
  const sourceRef = useRef(null);
  const socketRef = useRef(null);
  const strReportPendingRef = useRef(null);
  const strReportGraphByAnalysisRef = useRef({});
  const strReportOpenInFlightRef = useRef(new Set());
  const strReportSubscribedSessionsRef = useRef(new Set());
  const graphStatusSubscribedSessionsRef = useRef(new Set());
  const graphStatusErrorNoticeRef = useRef({});
  const graphInfoPayloadBySessionRef = useRef({});
  const openStrReportGraphAndBindRef = useRef(null);
  const pushNotificationRef = useRef(null);
  const sessionIdRef = useRef(null);
  const lockedSessionIdRef = useRef("");
  const terminalUnlockFailureRef = useRef(false);
  const logRef = useRef(''); // for accumulating logs
  const logBuffersRef = useRef({});
  const activeLogStreamsRef = useRef({});
  const activeStreamJobsRef = useRef({});
  const activeGraphJobsRef = useRef({});
  const graphProgressRenderedRef = useRef({});
  const activeDataframeJobsRef = useRef({});
  const activeSearchJobsRef = useRef({});
  const idlePolicyPatchTimerRef = useRef(null);
  const idlePolicyRequestSeqRef = useRef(0);
  const graphAutoRequestedRef = useRef({});
  const streamTerminateRequestedRef = useRef({});
  const textareaRefs = useRef({});
  const debounceRef = useRef(null);
  const graphActionDebounceRef = useRef({});
  const windowGraphActionDebounceRef = useRef({});
  const [isDragging, setIsDragging] = useState(false);
  const [graphLinkstate, setGraphLinkState] = useState(false);
  const [graphStatusListener, setGraphStatusListener] = useState(false);
  const [graphStatus, setGraphStatus] = useState({});
  const graphStatusRef = useRef({});
  const [graphLinkSource, setGraphLinkSource] = useState(null);   
  const [activeGraph, setActiveGraph] = useState(''); 
  const iframeRefs = useRef({}); //to communicate across the iframe boundary  
  const [iframeSettings, setIframeSettings] = useState({}); // object instead of array
  const [iframeSearch, setIframeSearch] = useState({}); // object instead of array
  const [iframePerformanceMood, setIframePerformanceMood] = useState({});
  const [isCtrlHeld, setIsCtrlHeld] = useState(false);  
  const [userName, setUserName] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [confirmations, setConfirmations] = useState([]);
  const noticeSeqRef = useRef(1);
  const confirmSeqRef = useRef(1);
  const noticeTimersRef = useRef({});
  const confirmationsRef = useRef([]);
  const graphFetchAbortControllersRef = useRef({});
  const pendingWindowCreatesRef = useRef({ source: 0, graph: 0, chart: 0 });
  const toggleMenuRef = useRef(null);
  const tabsToggleButtonRef = useRef(null);
  const darkFloatMenuToggleRef = useRef(null);
  const API_URL = import.meta.env.VITE_API_URL
  const BASE_URL = import.meta.env.VITE_BASE_URL
  const defaultIdleSettings = useMemo(() => getDefaultIdleSettings(), []);
  const [idleSettings, setIdleSettings] = useState(defaultIdleSettings);
  const [idlePolicyMeta, setIdlePolicyMeta] = useState({
    sessionId: "",
    source: "",
    editableFields: ["idle_warning_ms", "idle_lock_ms", "max_idle_timeout_ms", "lock_requires_reauth"],
    authTokenSeconds: null,
    isLoading: false,
    isSaving: false,
    error: "",
    loaded: false,
  });
  const workspaceIdleLockMinutes = Math.max(1, Math.round((idleSettings?.lockMs || DEFAULT_IDLE_LOCK_MS) / 60000));
  const workspaceIdleLogoutMinutes = Math.max(1, Math.round((idleSettings?.timeoutMs || DEFAULT_IDLE_TIMEOUT_MS) / 60000));
  const HEADER_TRIGGER_ALLOWED_ORIGINS = String(import.meta.env.VITE_HEADER_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const activeParentSessionId = useMemo(() => {
    const activeWindow = windows.find((windowState) => String(windowState.id) === String(activeWindowId)) || null;
    const candidates = [
      activeWindow?.type === "source" ? activeWindow.id : "",
      activeWindow?.graphLinkSource || "",
      activeWindow?.sessionId || "",
      sessionId || sessionIdRef.current || readStoredSessionId(),
    ];
    return candidates.map((value) => extractParentSessionId(value)).find(Boolean) || "";
  }, [windows, activeWindowId, sessionId]);

  const runScopedDebounce = (bucketRef, scopedId, fn, delay = 300) => {
    const key = String(scopedId);
    if (bucketRef.current[key]) {
      clearTimeout(bucketRef.current[key]);
    }
    bucketRef.current[key] = setTimeout(() => {
      delete bucketRef.current[key];
      fn();
    }, delay);
  };

  const updateSourceWindowState = (targetWindowId, patch) => {
    const sessionKey = String(targetWindowId || "").trim();
    if (!sessionKey) return;
    setWindows((prev) =>
      prev.map((windowState) => {
        if (String(windowState.id) !== sessionKey) return windowState;
        const nextPatch = typeof patch === "function" ? patch(windowState) : patch;
        return nextPatch ? { ...windowState, ...nextPatch } : windowState;
      })
    );
  };

  const resolveConfigurationSessionId = (preferredWindowId = null) => {
    const preferredSessionId = extractParentSessionId(preferredWindowId);
    if (preferredSessionId) return preferredSessionId;

    const activeSourceWindow = windowsRef.current.find(
      (windowState) => windowState.type === "source" && String(windowState.id) === String(activeWindowId)
    );

    return extractParentSessionId(
      activeSourceWindow?.id || sessionId || sessionIdRef.current || readStoredSessionId()
    );
  };

  const fetchConfigurationForSession = (targetSessionId) => {
    const sessionKey = normalizeSessionId(targetSessionId);
    if (!sessionKey) {
      return Promise.resolve({ ok: false, message: "Session is still initializing." });
    }

    return apiFetch("/configuration", {
      method: "POST",
      body: { id: "load", session_id: sessionKey },
    }).then((data) => {
      const extracted = extractConfigurationPayload(data);
      const normalized = normalizeLoadedConfiguration(extracted);

      if (!isSuccessResponse(data)) {
        return {
          ok: false,
          sessionId: sessionKey,
          message: getConfigurationErrorMessage(data, "Could not load configuration. Try again."),
          data,
        };
      }

      return {
        ok: true,
        sessionId: sessionKey,
        configuration: normalized,
        data,
      };
    });
  };

  const resetConfigurationForSession = (targetSessionId) => {
    const sessionKey = normalizeSessionId(targetSessionId);
    if (!sessionKey) {
      return Promise.resolve({ ok: false, message: "Session is still initializing." });
    }

    return apiFetch("/configuration", {
      method: "POST",
      body: { id: "reset", session_id: sessionKey },
    }).then((data) => {
      if (!isSuccessResponse(data)) {
        return {
          ok: false,
          sessionId: sessionKey,
          message: getConfigurationErrorMessage(data, "Could not reset configuration. Try again."),
          data,
        };
      }

      return {
        ok: true,
        sessionId: sessionKey,
        configuration: normalizeLoadedConfiguration(extractConfigurationPayload(data)),
        data,
      };
    });
  };



  const persistRealtimeToolConfigurationForWindow = (targetSessionId, overrides = {}) => {
    const sessionKey = normalizeSessionId(targetSessionId);
    const targetWindow = windowsRef.current.find((windowState) => String(windowState.id) === sessionKey);

    if (!sessionKey || !targetWindow) {
      return Promise.resolve({
        ok: false,
        sessionId: sessionKey,
        message: "The realtime session is not available for configuration persistence.",
      });
    }

    const realtimeWindowState = { ...targetWindow, ...overrides, id: sessionKey };
    const configurationPayload = buildRealtimeToolConfigurationPayload(configurations, realtimeWindowState);
    const passwordRef = getConfigurationToolPasswordRef(configurationPayload);

    updateSourceWindowState(sessionKey, {
      realtimeConfigPersistStatus: "saving",
      realtimeConfigPersistedSessionId: null,
      realtimeConfigPersistMessage: "Saving Neo4j credentials for this session...",
      realtimeStartGuardMessage: null,
    });

    if (CLIENT_DEV_LOGS_ENABLED) {
      console.info("[realtime config save]", {
        session_id: sessionKey,
        has_password: Boolean(configurationPayload.active_tool_password),
        has_password_ref: Boolean(passwordRef),
      });
    }

    return apiFetch("/configuration", {
      method: "POST",
      body: {
        id: "save",
        session_id: sessionKey,
        configuration: configurationPayload,
      },
    })
      .then((data) => {
        if (!isSuccessResponse(data)) {
          const message = getConfigurationErrorMessage(data, "Neo4j credentials could not be saved for this session.");
          updateSourceWindowState(sessionKey, {
            realtimeConfigPersistStatus: "failed",
            realtimeConfigPersistedSessionId: null,
            realtimeConfigPersistMessage: message,
            realtimeStartGuardMessage: message,
          });
          return { ok: false, sessionId: sessionKey, message, data };
        }

        return fetchConfigurationForSession(sessionKey).then((loadResult) => {
          if (!loadResult.ok) {
            const message = loadResult.message || "Neo4j credentials were saved, but the session configuration could not be reloaded.";
            updateSourceWindowState(sessionKey, {
              realtimeConfigPersistStatus: "failed",
              realtimeConfigPersistedSessionId: null,
              realtimeConfigPersistMessage: message,
              realtimeStartGuardMessage: message,
            });
            return { ok: false, sessionId: sessionKey, message, data };
          }

          const loadedConfiguration = loadResult.configuration || {};
          const confirmedPasswordRef = getConfigurationToolPasswordRef(loadedConfiguration);
          const hasPersistedToolCredentials = Boolean(
            sanitizeConnectionValue(loadedConfiguration.active_tool_url, { maxLength: 300 }) &&
            sanitizeIdentifier(loadedConfiguration.active_tool_username, { maxLength: 120 }) &&
            (confirmedPasswordRef || loadedConfiguration.active_tool_password)
          );

          if (!hasPersistedToolCredentials) {
            const message = "Neo4j connected, but this session does not yet have confirmed persisted tool credentials.";
            updateSourceWindowState(sessionKey, {
              realtimeConfigPersistStatus: "failed",
              realtimeConfigPersistedSessionId: null,
              realtimeConfigPersistMessage: message,
              realtimeStartGuardMessage: message,
            });
            return { ok: false, sessionId: sessionKey, message, data };
          }

          updateSourceWindowState(sessionKey, {
            ...buildToolCredentialWindowPatch(loadedConfiguration),
            realtimeConfigPersistStatus: "saved",
            realtimeConfigPersistedSessionId: sessionKey,
            realtimeConfigPersistMessage: "Neo4j credentials saved for this session.",
            realtimeStartGuardMessage: null,
          });

          return {
            ok: true,
            sessionId: sessionKey,
            configuration: loadedConfiguration,
            data,
          };
        });
      })
      .catch((error) => {
        const message = error?.message || "Neo4j credentials could not be saved for this session.";
        updateSourceWindowState(sessionKey, {
          realtimeConfigPersistStatus: "failed",
          realtimeConfigPersistedSessionId: null,
          realtimeConfigPersistMessage: message,
          realtimeStartGuardMessage: message,
        });
        return { ok: false, sessionId: sessionKey, message, error };
      });
  };

  const graphStatusSessionIds = useMemo(() => {
    const sessionIds = new Set();

    windows.forEach((w) => {
      if (w.type === "graph" && w.graphLinkSource) {
        sessionIds.add(String(w.graphLinkSource));
      }
    });

    Object.entries(sourceStreams || {}).forEach(([sessionId, isStreaming]) => {
      if (isStreaming) {
        sessionIds.add(String(sessionId));
      }
    });

    return Array.from(sessionIds);
  }, [windows, sourceStreams]);

  const graphStatusSessionKey = useMemo(
    () => graphStatusSessionIds.join("|"),
    [graphStatusSessionIds]
  );
  const graphInfoReplayKey = useMemo(() => (
    windows
      .filter((w) => w.type === "graph")
      .map((w) => [w.id, w.activeGraph || "", w.graphLinkSource || w.sessionId || ""].join(":"))
      .sort()
      .join("|")
  ), [windows]);
  const sourceLogStreamKey = useMemo(() => (
    Object.entries(sourceSessionLogFiles || {})
      .map(([sessionId, entry]) => sessionId + ":" + resolveLogStreamFilename(entry))
      .sort()
      .join("|")
  ), [sourceSessionLogFiles]);
  const graphStatusCacheKey = useMemo(() => (
    Object.entries(graphStatus || {})
      .map(([sessionId, entry]) => {
        const relationships = normalizeGraphRelationships(entry?.relationships);
        return sessionId + ":" + relationships.map((item) => item.type).join(",");
      })
      .sort()
      .join("|")
  ), [graphStatus]);
  //const BASE_URL = "http://localhost:5173"
  //const API_URL = "http://localhost:5000";

  // useEffect(() => {  // Sync windowsRef on every update
  //   console.log("orientation:",orientation)
  // }, [orientation]);

  const hasOpenWindows = windows.length > 0;
  const hasVisibleWorkspacePanel = hasOpenWindows || isConfigurationsOpen || isSettingsOpen || isReportsOpen;
  const showHomeOverlay = !hasVisibleWorkspacePanel;
  const showDarkFloatingMenu = themeMode === "dark" && !isToggleMenuOpen && hasOpenWindows && orientation === "windows";

  useEffect(() => {
    if (showHomeOverlay) {
      setIsToggleMenuOpen(false);
    }
  }, [showHomeOverlay]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("linkx_orientation_mode", orientation);
  }, [orientation]);

  useEffect(() => {
    if (!isToggleMenuOpen) return;

    const handleOutsideToggleClick = (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toggleMenuRef.current?.contains(target)) return;
      if (tabsToggleButtonRef.current?.contains(target)) return;
      if (darkFloatMenuToggleRef.current?.contains(target)) return;
      setIsToggleMenuOpen(false);
    };

    document.addEventListener("pointerdown", handleOutsideToggleClick, true);
    document.addEventListener("touchstart", handleOutsideToggleClick, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideToggleClick, true);
      document.removeEventListener("touchstart", handleOutsideToggleClick, true);
    };
  }, [isToggleMenuOpen]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    localStorage.setItem("linkx_theme_mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const listeners = [];
    const sendThemeMode = (windowId, frameEl) => {
      const src = frameEl?.src;
      const attrSrc = frameEl?.getAttribute?.("src");
      try {
        postMessageToIframe(frameEl, { action: "theme_mode", payload: themeMode });

      } catch (e) {
        console.error("Applying THEME FAILED:");
      }
    };

    const replayGraphInfoToFrame = (windowId, frameEl) => {
      const windowState = windowsRef.current.find((w) => String(w.id) === String(windowId));
      if (!windowState) return;
      if (String(windowState.activeGraph || "") !== "graph_info_placeholder") return;

      const sessionKey = String(windowState.graphLinkSource || windowState.sessionId || "").trim();
      if (!sessionKey) return;

      const cachedPayload = graphInfoPayloadBySessionRef.current[sessionKey];
      if (!cachedPayload || typeof cachedPayload !== "object") return;

      postMessageToIframe(frameEl, { action: "informations", payload: cachedPayload });
    };

    Object.entries(iframeRefs.current || {}).forEach(([windowId, frameRef]) => {
      const frameEl = frameRef?.current;
      if (!frameEl) return;
      const onLoad = () => {
        console.log("IFRAME LOADED:", {
          windowId,
          src: frameEl.src,
          attrSrc: frameEl.getAttribute("src"),
        });

        sendThemeMode(windowId, frameEl);
        replayGraphInfoToFrame(windowId, frameEl);
      };
      frameEl.addEventListener("load", onLoad);
      listeners.push(() => frameEl.removeEventListener("load", onLoad));
      sendThemeMode(windowId, frameEl);
      replayGraphInfoToFrame(windowId, frameEl);
    });

    return () => {
      listeners.forEach((dispose) => dispose());
    };
  }, [themeMode, graphInfoReplayKey]);

  useEffect(() => {
    setWindows((prev) => {
      let changed = false;
      const next = prev.map((w) => {
        if (w.type !== "graph") return w;
        const sessionKey = String(w.graphLinkSource || w.sessionId || "").trim();
        if (!sessionKey) return w;
        const cachedEntry = graphStatusRef.current?.[sessionKey];
        if (!cachedEntry || !Object.prototype.hasOwnProperty.call(cachedEntry, "relationships")) return w;
        const cachedRelationships = normalizeGraphRelationships(cachedEntry.relationships);
        const currentRelationships = normalizeGraphRelationships(w.graphStatus);
        const cachedHash = JSON.stringify(cachedRelationships.map((item) => [item.id, item.type, item.textcolor, item.bgcolor]));
        const currentHash = JSON.stringify(currentRelationships.map((item) => [item.id, item.type, item.textcolor, item.bgcolor]));
        if (cachedHash === currentHash) return w;
        changed = true;
        console.log("[graph relationships cache applied]", { session_id: sessionKey, graph_window_id: w.id, count: cachedRelationships.length });
        return { ...w, graphStatus: cachedRelationships };
      });
      return changed ? next : prev;
    });
  }, [graphInfoReplayKey, graphStatusCacheKey]);

  const removeNotification = useCallback((id) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
    if (noticeTimersRef.current[id]) {
      clearTimeout(noticeTimersRef.current[id]);
      delete noticeTimersRef.current[id];
    }
  }, []);

  const sanitizeNotificationMessage = useCallback((value) => {
    let text = String(value ?? "").trim();
    if (!text) return "";
    text = text.replace(/\s+/g, " ");
    text = text.replace(/^\s*(message(?:\s+alert)?|alert|warning|notice|message\s*box)\s*[:\-]\s*/i, "");
    text = text.replace(/^\s*message\s*box\s*/i, "");
    return text.trim();
  }, []);

  const pushNotification = useCallback((payload = {}) => {
    const rawLevel = String(payload.level || payload.severity || "info").toLowerCase();
    const level = ["success", "warning", "error", "info"].includes(rawLevel) ? rawLevel : "info";
    const rawMessage = payload.message ?? payload.text ?? payload.detail ?? "";
    const baseMessage = typeof rawMessage === "string" ? rawMessage : JSON.stringify(rawMessage);
    const message = sanitizeNotificationMessage(baseMessage);
    if (!message || !String(message).trim()) return null;

    const id = `notice_${Date.now()}_${noticeSeqRef.current++}`;
    const rawTitle = String(payload.title || "").trim();
    const title = rawTitle && !/^(alert|message|message alert)$/i.test(rawTitle)
      ? rawTitle
      : (level === "error" ? "Error" : level === "warning" ? "Warning" : level === "success" ? "Success" : "Notice");
    const source = payload.source || "Linkx";
    const durationMs = Number.isFinite(payload.durationMs) ? Number(payload.durationMs) : 5400;

    setNotifications((prev) => [
      ...prev,
      { id, title, message: String(message), source: String(source), level }
    ]);

    if (durationMs > 0) {
      noticeTimersRef.current[id] = setTimeout(() => removeNotification(id), durationMs);
    }
    return id;
  }, [removeNotification, sanitizeNotificationMessage]);

  const apiFetch = useMemo(() => createApiClient({
    baseUrl: API_URL,
    getToken: () => token,
    onUnauthorized: (data, requestMeta) => {
      if (shouldLogoutOnUnauthorized(requestMeta?.path)) {
        pushNotification({
          title: "Session expired",
          message: "Your session expired. Please sign in again.",
          source: "Auth",
          level: "warning",
        });
        logout();
        return;
      }

      pushNotification({
        title: "Request unauthorized",
        message: data?.message || data?.error || "That request was rejected, but your saved login was kept.",
        source: "Auth",
        level: "warning",
        durationMs: 6000,
      });
    },
    onForbidden: () => {
      pushNotification({
        title: "Permission denied",
        message: "You do not have access to do that.",
        source: "RBAC",
        level: "warning",
      });
    },
    onSecurityPolicyBlocked: (data) => {
      const detail = String(data?.detail || "").replace(/_/g, " ");
      pushNotification({
        title: "Connection blocked",
        message: detail ? "The connection target was blocked: " + detail + "." : "The connection target was blocked by security policy.",
        source: "Security",
        level: "warning",
        durationMs: 8000,
      });
    },
    onRateLimited: (data) => {
      const retryAfter = Number(data?.retry_after || 0);
      pushNotification({
        title: "Rate limited",
        message: "Too many requests." + (retryAfter ? " Retry after " + retryAfter + " seconds." : " Please try again shortly."),
        source: "Security",
        level: "warning",
        durationMs: 8000,
      });
    },
    onPayloadTooLarge: () => {
      pushNotification({
        title: "Request too large",
        message: "The request was too large. Reduce file size or payload size and try again.",
        source: "Linkx",
        level: "warning",
        durationMs: 8000,
      });
    },
    onLocked: (data) => {
      lockedSessionIdRef.current = activeParentSessionId || sessionIdRef.current || readStoredSessionId();
      setIsWorkspaceLocked(true);
      pushNotification({
        title: "Workspace locked",
        message: data?.message || data?.error || "Unlock required before continuing.",
        source: "Auth",
        level: "warning",
        durationMs: 8000,
      });
    },
  }), [API_URL, activeParentSessionId, token, logout, pushNotification]);

  const logConnectToToolRequest = (body, { method = "POST", path = "/connect_to_tool" } = {}) => {
    const url = `${String(API_URL || "").replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers({ "Content-Type": "application/json" });
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    const sessionKey = normalizeSessionId(body?.session_id || body?.source_id);
    console.info("[connect_to_tool request]", {
      method,
      url,
      headers: redactRequestHeadersForLog(headers),
      body,
      session_id: sessionKey,
    });
  };

  const logGraphWindowDebug = (label, payload) => {
    if (!CLIENT_DEV_LOGS_ENABLED) return;
    console.info(`[graph debug] ${label}`, payload);
  };

  const logStreamFailureResponse = (label, payload) => {
    console.error(`[stream failure] ${label}`, payload);
  };

  const canAccess = useCallback((permission) => (
    hasRole("admin") || hasPermission(permission)
  ), [hasRole, hasPermission]);

  const applySessionPolicy = useCallback((policyPayload, { fromCache = false } = {}) => {
    const normalized = normalizeSessionPolicyResponse(policyPayload, activeParentSessionId || sessionIdRef.current || readStoredSessionId());
    if (!normalized.sessionId) return null;
    setIdleSettings(normalized.policy);
    setIdlePolicyMeta((previous) => ({
      ...previous,
      sessionId: normalized.sessionId,
      source: normalized.source || previous.source,
      editableFields: normalized.editableFields,
      authTokenSeconds: normalized.authTokenSeconds,
      isLoading: false,
      isSaving: false,
      error: "",
      loaded: true,
      fromCache,
    }));
    persistSessionPolicyCache(normalized.sessionId, normalized);
    return normalized;
  }, [activeParentSessionId]);

  const fetchSessionPolicy = useCallback(async (targetSessionId, { preferCache = true } = {}) => {
    const sessionKey = normalizeSessionId(targetSessionId);
    if (!sessionKey || !token) return null;

    const requestId = ++idlePolicyRequestSeqRef.current;
    const cachedPolicy = preferCache ? readCachedSessionPolicy(sessionKey) : null;
    if (cachedPolicy) {
      setIdleSettings(cachedPolicy.policy);
      setIdlePolicyMeta((previous) => ({
        ...previous,
        sessionId: sessionKey,
        source: cachedPolicy.source || previous.source,
        editableFields: cachedPolicy.editableFields,
        authTokenSeconds: cachedPolicy.authTokenSeconds,
        isLoading: true,
        isSaving: false,
        error: "",
        loaded: true,
        fromCache: true,
      }));
    } else {
      setIdlePolicyMeta((previous) => ({
        ...previous,
        sessionId: sessionKey,
        isLoading: true,
        error: "",
      }));
    }

    try {
      const data = await apiFetch("/auth/session-policy?session_id=" + encodeURIComponent(sessionKey), {
        method: "GET",
      });
      if (requestId !== idlePolicyRequestSeqRef.current) return null;
      return applySessionPolicy(data, { fromCache: false });
    } catch (error) {
      if (requestId !== idlePolicyRequestSeqRef.current) return null;
      const message = error?.message || "Could not refresh the backend session policy.";
      setIdlePolicyMeta((previous) => ({
        ...previous,
        sessionId: sessionKey,
        isLoading: false,
        error: message,
        loaded: previous.loaded || Boolean(cachedPolicy),
      }));
      if (!cachedPolicy && Number(error?.status) !== 423) {
        pushNotification({
          title: "Session policy unavailable",
          message,
          source: "Auth",
          level: "warning",
          durationMs: 7000,
        });
      }
      return null;
    }
  }, [apiFetch, applySessionPolicy, pushNotification, token]);

  const updateIdleSettings = useCallback((nextSettings) => {
    const sessionKey = normalizeSessionId(idlePolicyMeta.sessionId || activeParentSessionId || sessionIdRef.current || readStoredSessionId());
    setIdleSettings((previous) => {
      const normalized = normalizeIdleSettings(
        typeof nextSettings === "function" ? nextSettings(previous) : nextSettings,
        defaultIdleSettings
      );

      if (idlePolicyPatchTimerRef.current) {
        clearTimeout(idlePolicyPatchTimerRef.current);
      }

      if (sessionKey && token) {
        setIdlePolicyMeta((current) => ({ ...current, isSaving: true, error: "" }));
        idlePolicyPatchTimerRef.current = setTimeout(async () => {
          try {
            const data = await apiFetch("/auth/session-policy", {
              method: "PATCH",
              body: buildSessionPolicyPatchBody(sessionKey, normalized),
            });
            applySessionPolicy(
              data?.results
                ? data
                : {
                    results: {
                      session_id: sessionKey,
                      policy: buildSessionPolicyPatchBody(sessionKey, normalized).policy,
                      editable_fields: idlePolicyMeta.editableFields,
                      source: idlePolicyMeta.source,
                      auth_token_seconds: idlePolicyMeta.authTokenSeconds,
                    },
                  },
              { fromCache: false }
            );
          } catch (error) {
            const message = error?.message || "Could not save the backend session policy.";
            setIdlePolicyMeta((current) => ({ ...current, isSaving: false, error: message }));
            pushNotification({
              title: "Session policy save failed",
              message,
              source: "Auth",
              level: "warning",
              durationMs: 7000,
            });
            fetchSessionPolicy(sessionKey, { preferCache: true });
          }
        }, 450);
      }

      return normalized;
    });
  }, [activeParentSessionId, apiFetch, applySessionPolicy, defaultIdleSettings, fetchSessionPolicy, idlePolicyMeta.authTokenSeconds, idlePolicyMeta.editableFields, idlePolicyMeta.sessionId, idlePolicyMeta.source, pushNotification, token]);

  useEffect(() => {
    if (idlePolicyPatchTimerRef.current) {
      return () => clearTimeout(idlePolicyPatchTimerRef.current);
    }
    return undefined;
  }, []);

  useEffect(() => {
    if (!token || !activeParentSessionId) {
      setIdlePolicyMeta((previous) => ({ ...previous, sessionId: "", isLoading: false, isSaving: false, loaded: false }));
      return;
    }
    fetchSessionPolicy(activeParentSessionId, { preferCache: true });
  }, [activeParentSessionId, fetchSessionPolicy, token]);

  const requirePermission = useCallback((permission, actionName = "this action") => {
    if (canAccess(permission)) return true;
    pushNotification({
      title: "Permission denied",
      message: "You need " + permission + " to use " + actionName + ".",
      source: "RBAC",
      level: "warning",
    });
    return false;
  }, [canAccess, pushNotification]);

  const unlockBackendSession = useCallback(async ({ fallbackVerify = false } = {}) => {
    const previousSessionId = normalizeSessionId(sessionIdRef.current || lockedSessionIdRef.current || readStoredSessionId());
    const payload = {
      id: "unlock_session",
      reason: "idle_lock",
    };
    console.log("[unlock request]", payload);

    try {
      const data = await apiFetch("/auth/unlock", {
        method: "POST",
        body: payload,
        suppressUnauthorizedHandler: true,
        suppressLockedHandler: true,
      });
      const refreshedToken = data?.results?.token || data?.token || data?.access_token || "";
      if (refreshedToken) await verifyToken(refreshedToken);
      lockedSessionIdRef.current = "";
      if (previousSessionId) {
        localStorage.setItem("session", previousSessionId);
        setSessionId(previousSessionId);
      }

      const initPayload = {
        id: "init",
        existing_session: previousSessionId || null,
        socket_id: socketRef.current?.id || null,
      };
      console.log("[post-unlock init request]", initPayload);
      try {
        const initData = await apiFetch("/init", {
          method: "POST",
          body: initPayload,
          suppressLockedHandler: true,
        });
        if (isSuccessResponse(initData)) {
          const nextSession = extractMainSessionId(initData) || previousSessionId;
          setConfigurations(extractInitConfiguration(initData));
          setSessionId(nextSession);
          sessionIdRef.current = nextSession;
          if (nextSession) {
            localStorage.setItem("session", nextSession);
          }
          fetchSessionPolicy(extractParentSessionId(nextSession || previousSessionId), { preferCache: true });
        }
      } catch (initErr) {
        console.warn("Post-unlock init failed", initErr);
      }

      return data;
    } catch (unlockErr) {
      if (fallbackVerify && [404, 405].includes(Number(unlockErr?.status))) {
        await verifyToken();
        return null;
      }
      throw unlockErr;
    }
  }, [apiFetch, fetchSessionPolicy, verifyToken]);

  pushNotificationRef.current = pushNotification;
  sessionIdRef.current = sessionId;

  useEffect(() => {
    setUserName(user?.display_name || user?.username || null);
  }, [user]);

  const registerStrReportSocketReceiver = (browserSession) => {
    const socket = socketRef.current;
    const resolvedSession = String(browserSession || "").trim();
    if (!socket?.connected || !resolvedSession) {
      return;
    }
    const payload = { session_id: resolvedSession, socket_id: socket.id };
    socket.emit("notification_subscribe", { session_id: resolvedSession });
    socket.emit(STR_REPORT_SOCKET_EMIT_REGISTER_RECEIVER, payload);
  };

  const resolveConfirmation = useCallback((id, accepted) => {
    setConfirmations((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target && typeof target.resolve === "function") {
        target.resolve(Boolean(accepted));
      }
      if (target && accepted) {
        pushNotification({
          title: "Confirmed",
          message: "Action confirmed.",
          source: target.source || "Linkx",
          level: "success",
          durationMs: 2600
        });
      }
      return prev.filter((item) => item.id !== id);
    });
  }, [pushNotification]);

  const requestConfirmation = useCallback((payload = {}) => (
    new Promise((resolve) => {
      const id = `confirm_${Date.now()}_${confirmSeqRef.current++}`;
      const rawMessage = payload.message ?? payload.text ?? payload.detail ?? "";
      const message = sanitizeNotificationMessage(rawMessage) || "Are you sure you want to continue?";
      const rawTitle = String(payload.title || "").trim();
      const title = rawTitle && !/^(alert|message|message alert)$/i.test(rawTitle) ? rawTitle : "Confirm Action";
      const source = payload.source || "Linkx";
      const rawLevel = String(payload.level || payload.severity || "warning").toLowerCase();
      const level = ["success", "warning", "error", "info"].includes(rawLevel) ? rawLevel : "warning";
      setConfirmations((prev) => ([
        ...prev,
        {
          id,
          title,
          message: String(message),
          source: String(source),
          level,
          confirmText: payload.confirmText || "Continue",
          cancelText: payload.cancelText || "Cancel",
          resolve
        }
      ]));
    })
  ), [sanitizeNotificationMessage]);

  useEffect(() => {
    return () => {
      Object.values(noticeTimersRef.current).forEach((timerId) => clearTimeout(timerId));
      noticeTimersRef.current = {};
    };
  }, []);

  useEffect(() => {
    confirmationsRef.current = confirmations;
  }, [confirmations]);

  useEffect(() => {
    return () => {
      confirmationsRef.current.forEach((item) => {
        if (typeof item.resolve === "function") {
          item.resolve(false);
        }
      });
      confirmationsRef.current = [];
    };
  }, []);
  // ---------------------------------------------------------------------------- Basic useEffects ---
  // ---------------------------------------------------------------------------- Main session initializer ---
  useEffect(() => {
    const oldSession = readStoredSessionId() || null;
    if (oldSession) {
      sessionIdRef.current = oldSession;
      setSessionId(oldSession);
    }
    debounceRef.current = setTimeout(() => {
        const payload = {
          id: "init",
          existing_session: oldSession,
          socket_id: socketRef.current?.id || null,
        };
        apiFetch("/init", {
          method: "POST",
          body: payload,
        })
          .then(data => {
            if (isSuccessResponse(data)) {
              const session = extractMainSessionId(data) || oldSession || "";
              const configs = extractInitConfiguration(data);
              setConfigurations(configs)
              setSessionId(session || null);
              sessionIdRef.current = session || null;
              const sourceAutofillPatch = buildSourceWindowAutofillPatch(configs || {});
              setWindows((prev) => prev.map((windowState) => (
                windowState.type === "source"
                  ? { ...windowState, ...sourceAutofillPatch }
                  : windowState
              )));
              if (session) {
                localStorage.setItem('session', session);
              }
              const registerAfterInit = () => registerStrReportSocketReceiver(session);
              const socket = socketRef.current;
              if (socket?.connected) {
                registerAfterInit();
              } else if (socket) {
                socket.once("connect", registerAfterInit);
              }
            } else {
              alert("Could not initialize!");
            }
          })
          .catch(console.error);
      }, 300);
  }, []);
  useEffect(() => {
    const nativeAlert = window.alert;
    window.alert = (message) => {
      pushNotification({
        title: "Notice",
        message: String(message ?? ""),
        source: "Linkx",
        level: "warning"
      });
    };
    return () => {
      window.alert = nativeAlert;
    };
  }, [pushNotification]);
  // ---------------------------------------------------------------------------- sockets ---

  useEffect(() => {  // Sync windowsRef on every update
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    graphStatusRef.current = graphStatus;
  }, [graphStatus]);
  useEffect(() => {
    if (!isConfigAutoFillEnabled(configurations)) return;
    const defaults = getSourceWindowAutofillDefaults(configurations);
    setWindows((prev) => prev.map((win) => {
      if (win.type !== "source") return win;
      const batchUnlocked = !["Connecting...", "Connection established!", "Dataset uploaded!"].includes(win.windowResponseI);
      const realtimeUnlocked = !["Connecting...", "Connection established!"].includes(win.windowRealtimeResponseI);
      const updates = {};

      if (batchUnlocked) {
        if (!win.sourceAddressText && defaults.sourceAddressText) updates.sourceAddressText = defaults.sourceAddressText;
        if (!win.sourceStorageText && defaults.sourceStorageText) updates.sourceStorageText = defaults.sourceStorageText;
        if (!win.sourceTopicText && defaults.sourceTopicText) updates.sourceTopicText = defaults.sourceTopicText;
        if (!win.sourceAddressType) updates.sourceAddressType = defaults.sourceAddressType;
        if (!win.toolUrl && defaults.toolUrl) updates.toolUrl = defaults.toolUrl;
        if (!win.toolUsername && defaults.toolUsername) updates.toolUsername = defaults.toolUsername;
        if (!win.toolDatabase && defaults.toolDatabase) updates.toolDatabase = defaults.toolDatabase;
      }

      if (realtimeUnlocked) {
        if (!win.sourceRealtimeAddressText && defaults.sourceRealtimeAddressText) updates.sourceRealtimeAddressText = defaults.sourceRealtimeAddressText;
        if (!win.sourceRealtimeTopicText && defaults.sourceRealtimeTopicText) updates.sourceRealtimeTopicText = defaults.sourceRealtimeTopicText;
        if (!win.sourceRealtimeAddressType) updates.sourceRealtimeAddressType = defaults.sourceRealtimeAddressType;
        if (!win.realtimeToolUrl && defaults.realtimeToolUrl) updates.realtimeToolUrl = defaults.realtimeToolUrl;
        if (!win.realtimeToolUsername && defaults.realtimeToolUsername) updates.realtimeToolUsername = defaults.realtimeToolUsername;
        if (!win.realtimeToolDatabase && defaults.realtimeToolDatabase) updates.realtimeToolDatabase = defaults.realtimeToolDatabase;
      }

      return Object.keys(updates).length ? { ...win, ...updates } : win;
    }));
  }, [configurations]);

  useEffect(() => {
    const activeToken = token || localStorage.getItem("linkx_auth_token") || "";
    const socket = io(API_URL, {
      auth: activeToken ? { token: activeToken } : {},
    });
    socketRef.current = socket;

    const resolveAnalysisSessionId = (payload = {}) => {
      return String(
        payload.session_id ??
        payload.analysis_session_id ??
        payload.analysisSessionId ??
        ""
      ).trim();
    };

    const resolveSocketEmitFromPayload = (payload = {}) => {
      return payload.socket?.emit ?? payload.socket_emit ?? payload.socketEmit ?? null;
    };
    const handleStrReportLinkAnalysis = (payload = {}) => {
      const analysisSessionId = resolveAnalysisSessionId(payload);
      if (!analysisSessionId) {
        return;
      }

      const socketEmit = resolveSocketEmitFromPayload(payload);
      strReportPendingRef.current = { analysisSessionId, socketEmit };

      const waitForPrepare =
        payload.wait_for_prepare === true || payload.defer_graph_open === true;

      if (waitForPrepare) {
        pushNotificationRef.current?.({
          title: "STR Report Analysis",
          message: `Analysis session ${analysisSessionId} is ready. Waiting for graph receiver.`,
          source: "Socket",
          level: "info",
          durationMs: 6000,
        });
        return;
      }

      if (!openStrReportGraphAndBindRef.current) {
        setTimeout(() => {
          openStrReportGraphAndBindRef.current?.(analysisSessionId, socketEmit);
        }, 0);
        return;
      }

      openStrReportGraphAndBindRef.current(analysisSessionId, socketEmit);
    };

    const handleStrReportNotification = (payload = {}) => {
      const code = String(payload.code || "").trim();      if (code !== STR_REPORT_NOTIFICATION_CODE_PREPARE_RECEIVER) return;

      const pendingAnalysisSessionId = String(strReportPendingRef.current?.analysisSessionId || "").trim();
      const payloadSessionId = resolveAnalysisSessionId(payload);
      const analysisSessionId =
        pendingAnalysisSessionId ||
        (isStrReportAnalysisSession(payloadSessionId) ? payloadSessionId : "");

      if (!analysisSessionId) {
        return;
      }

      const socketEmit =
        resolveSocketEmitFromPayload(payload) ??
        strReportPendingRef.current?.socketEmit ??
        null;

      openStrReportGraphAndBindRef.current?.(analysisSessionId, socketEmit);
    };

    socket.on(STR_REPORT_SOCKET_EVENT_LINK_ANALYSIS, handleStrReportLinkAnalysis);
    socket.on("notification", handleStrReportNotification);
    const handleSocketConnect = () => {
      const browserSession =
        sessionIdRef.current || localStorage.getItem("session") || "";registerStrReportSocketReceiver(browserSession);    };
    const handleSocketDisconnect = () => {};
    const handleSocketConnectError = () => {};

    socket.on("connect", handleSocketConnect);
    socket.on("disconnect", handleSocketDisconnect);
    socket.on("connect_error", handleSocketConnectError);

    return () => {      socket.off(STR_REPORT_SOCKET_EVENT_LINK_ANALYSIS, handleStrReportLinkAnalysis);
      socket.off("notification", handleStrReportNotification);
      socket.off("connect", handleSocketConnect);
      socket.off("disconnect", handleSocketDisconnect);
      socket.off("connect_error", handleSocketConnectError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [API_URL, token]);
  // ------------------------------------------------------- backend notifications socket ---
  const sourceNotificationIds = useMemo(() => {
    return windows
      .filter((w) => w.type === "source" && w.id != null)
      .map((w) => String(w.id))
      .sort();
  }, [windows]);
  const sourceNotificationKey = useMemo(
    () => sourceNotificationIds.join("|"),
    [sourceNotificationIds]
  );

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !sourceNotificationKey) return;

    const sourceIds = sourceNotificationKey.split("|").filter(Boolean);
    if (sourceIds.length === 0) return;

    const subscribedIds = new Set(sourceIds);
    sourceIds.forEach((sid) => {
      socket.emit("notification_subscribe", { session_id: sid });
      socket.emit(STR_REPORT_SOCKET_EMIT_REGISTER_RECEIVER, { session_id: sid, socket_id: socket.id });
    });

    const formatBackendNotificationMessage = (payload = {}) => {
      const base = sanitizeNotificationMessage(payload.message || payload.text || "");
      const code = String(payload.code || "").trim();
      if (code && base) return `[${code}] ${base}`;
      return base || (code ? `[${code}]` : "Notification received.");
    };

    const handleNotification = (payload = {}) => {
      const code = String(payload.code || "").trim();
      if (code === STR_REPORT_NOTIFICATION_CODE_PREPARE_RECEIVER) return;

      const sid = String(payload.session_id ?? "");
      if (!sid || !subscribedIds.has(sid)) return;

      setWindows((prev) =>
        prev.map((w) =>
          String(w.id) === sid
            ? {
                ...w,
                notifications: [...(Array.isArray(w.notifications) ? w.notifications : []), payload]
              }
            : w
        )
      );

      pushNotification({
        title: payload.code ? String(payload.code) : "Backend Notice",
        message: formatBackendNotificationMessage(payload),
        source: payload.source || `Session ${sid}`,
        level: payload.level || "info",
        durationMs: 7000
      });
    };

    socket.on("notification", handleNotification);

    return () => {
      sourceIds.forEach((sid) => {
        socket.emit("notification_unsubscribe", { session_id: sid });
      });
      socket.off("notification", handleNotification);
    };
  }, [sourceNotificationKey, token, pushNotification, sanitizeNotificationMessage]);
  // ------------------------------------------------------------------ logger ---
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const handleLogs = (payload = {}) => {
      const id = String(payload.session_id ?? "").trim();
      if (!id || !activeLogStreamsRef.current[id]) return;

      if (payload.error) {
        console.warn("[stream log error]", { session_id: id, error: payload.error });
        return;
      }

      const line = payload.data == null ? "" : String(payload.data);
      logBuffersRef.current[id] = (logBuffersRef.current[id] || "") + "\n" + line;
      setWindows(prev =>
        prev.map(w =>
          String(w.id) === id
            ? { ...w, sourceSessionLog: logBuffersRef.current[id] }
            : w
        )
      );
      requestAnimationFrame(() => {
        const textarea = textareaRefs.current[id];
        if (textarea) {
          textarea.scrollTop = textarea.scrollHeight;
        }
      });
    };

    socket.on("stream_logs", handleLogs);
    return () => {
      socket.off("stream_logs", handleLogs);
    };
  }, [token]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const desiredStreams = {};
    Object.entries(sourceSessionLogFiles || {}).forEach(([sessionId, entry]) => {
      const filename = resolveLogStreamFilename(entry);
      const normalizedSessionId = String(sessionId || entry?.session_id || "").trim();
      if (normalizedSessionId && filename) {
        desiredStreams[normalizedSessionId] = filename;
      }
    });

    Object.entries(desiredStreams).forEach(([sessionId, filename]) => {
      const activeFilename = activeLogStreamsRef.current[sessionId];
      if (activeFilename === filename) return;
      if (activeFilename) {
        console.log("[log stream unplug]", { session_id: sessionId, filename: activeFilename });
        socket.emit("log_stream_unplug", { session_id: sessionId, filename: activeFilename });
      }
      logBuffersRef.current[sessionId] = "";
      console.log("[log stream plug]", { session_id: sessionId, filename });
      socket.emit("log_stream_plug", { session_id: sessionId, filename });
      activeLogStreamsRef.current[sessionId] = filename;
    });

    Object.entries(activeLogStreamsRef.current).forEach(([sessionId, filename]) => {
      if (desiredStreams[sessionId]) return;
      console.log("[log stream unplug]", { session_id: sessionId, filename });
      socket.emit("log_stream_unplug", { session_id: sessionId, filename });
      delete activeLogStreamsRef.current[sessionId];
      delete logBuffersRef.current[sessionId];
    });
  }, [sourceLogStreamKey, token]);

// ------------------------------------------------------- graph status socket ---
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    let lastHashBySession = {};
    const handleGraphStatus = (payload) => {
      logGraphWindowDebug("graph status event", payload);
      const { type, data, error, session_id } = payload;
      const sessionKey = String(session_id || "").trim();
      if (!sessionKey) {
        console.warn("[graph status ignored] missing session_id", payload);
        return;
      }

      const isGraphInfoPlaceholderPath = (pathname) => {
        const normalizedPath = String(pathname || "");
        return normalizedPath.endsWith("/temp_placeholders/graph_info_placeholder.html");
      };

      const buildGraphInfoPayload = (metadata, currentSessionKey, relationships = [], summaryOverride = null) => {
        const base = metadata && typeof metadata === "object" ? metadata : {};
        const summary = summaryOverride && typeof summaryOverride === "object" ? summaryOverride : (base.summary && typeof base.summary === "object" ? base.summary : {});
        const graph = base.graph && typeof base.graph === "object" ? base.graph : {};
        const pickFirst = (...values) => values.find((value) => value !== undefined && value !== null && value !== "");
        const relationshipList = Array.isArray(relationships) ? relationships : [];
        const relationshipLabels = relationshipList
          .map((item) => item?.type)
          .filter((item) => item != null && String(item).trim() !== "");
        const totalNodes = pickFirst(
          base.total_nodes,
          base.totalNodes,
          base.available_nodes,
          base.availableNodes,
          base.node_count,
          base.nodeCount,
          base.nodes_count,
          base.nodesCount,
          base.number_of_nodes,
          base.nodes_total,
          summary.total_nodes,
          summary.totalNodes,
          summary.available_nodes,
          summary.availableNodes,
          summary.node_count,
          summary.nodeCount,
          summary.nodes_count,
          summary.nodesCount,
          Array.isArray(base.nodes) ? base.nodes.length : undefined,
          Array.isArray(graph.nodes) ? graph.nodes.length : undefined,
          (summary.clean_nodes != null && summary.flagged_nodes != null)
            ? Number(summary.clean_nodes) + Number(summary.flagged_nodes)
            : undefined
        );
        const totalRelationships = pickFirst(
          base.total_relationships,
          base.totalRelationships,
          base.all_relationships,
          base.allRelationships,
          base.relationship_count,
          base.relationshipCount,
          base.relationships_count,
          base.relationshipsCount,
          base.edges_count,
          base.edge_count,
          summary.total_relationships,
          summary.totalRelationships,
          summary.all_relationships,
          summary.allRelationships,
          summary.relationship_count,
          summary.relationshipCount,
          summary.relationships_count,
          summary.relationshipsCount,
          Array.isArray(base.relationships) ? base.relationships.length : undefined,
          Array.isArray(base.edges) ? base.edges.length : undefined,
          Array.isArray(graph.edges) ? graph.edges.length : undefined,
          Array.isArray(graph.relationships) ? graph.relationships.length : undefined,
          relationshipList.length
        );
        const normalizedStatus = pickFirst(
          base.status,
          base.session_status,
          summary.status,
          summary.session_status
        );
        const normalizedRunId = pickFirst(
          base.run_id,
          summary.run_id
        );
        return {
          ...base,
          session_id: String(currentSessionKey || ""),
          analysisSessionId: String(currentSessionKey || ""),
          status: normalizedStatus,
          session_status: pickFirst(base.session_status, normalizedStatus),
          run_id: normalizedRunId,
          relationship_labels: relationshipLabels,
          total_nodes: totalNodes,
          total_relationships: totalRelationships,
          summary: {
            ...summary,
            status: pickFirst(summary.status, normalizedStatus),
            session_status: pickFirst(summary.session_status, normalizedStatus),
            run_id: pickFirst(summary.run_id, normalizedRunId),
            total_nodes: pickFirst(summary.total_nodes, totalNodes),
            total_relationships: pickFirst(summary.total_relationships, totalRelationships),
          },
        };
      };

      if (error) {
        const hasLinkedTarget = windowsRef.current.some(
          (w) => String(w.graphLinkSource || "") === sessionKey
        );
        if (!hasLinkedTarget) return;

        const errorText = typeof error === "string" ? error : JSON.stringify(error);
        const dedupeKey = `${sessionKey}::${errorText}`;
        const now = Date.now();
        const lastSeen = Number(graphStatusErrorNoticeRef.current[dedupeKey] || 0);
        if (now - lastSeen < 60000) return;
        graphStatusErrorNoticeRef.current[dedupeKey] = now;

        console.error("Graph status error:", error);
        pushNotificationRef.current?.({
          title: "Graph status update",
          message: "Graph status is temporarily unavailable for this source.",
          source: `Session ${sessionKey}`,
          level: "warning",
          durationMs: 6000,
        });
        return;
      }

      const targetWindows = windowsRef.current.filter(
        w => String(w.graphLinkSource || "") === sessionKey
      );

      if (targetWindows.length === 0) {
        console.warn("[graph status cached] no linked graph window yet", { sessionKey, payload });
      }

      if (type === "session_status") {
        const sessionStatus = data && typeof data === "object" ? data : {};
        const previousEntry = graphStatusRef.current?.[sessionKey] || {};
        const previousMetadata = previousEntry.status && typeof previousEntry.status === "object" ? previousEntry.status : {};
        const previousRelationships = normalizeGraphRelationships(previousEntry.relationships);
        const nextMetadata = {
          ...previousMetadata,
          session_id: sessionKey,
          analysisSessionId: sessionKey,
          status: sessionStatus.status ?? previousMetadata.status ?? previousMetadata.session_status,
          session_status: sessionStatus.status ?? previousMetadata.session_status ?? previousMetadata.status,
          run_id: sessionStatus.run_id ?? previousMetadata.run_id,
        };
        const infoPayload = buildGraphInfoPayload(nextMetadata, sessionKey, previousRelationships, previousEntry.summary ?? null);
        graphInfoPayloadBySessionRef.current[sessionKey] = infoPayload;
        graphStatusRef.current = {
          ...graphStatusRef.current,
          [sessionKey]: {
            ...previousEntry,
            status: nextMetadata,
          }
        };

        setGraphStatus(prev => ({
          ...prev,
          [sessionKey]: {
            ...prev[sessionKey],
            status: nextMetadata,
          }
        }));

        targetWindows.forEach((w) => {
          const iframe = iframeRefs.current[w.id];
          if (iframe?.current?.contentWindow && isGraphInfoPlaceholderPath(getIframePathname(iframe))) {
            postMessageToIframe(iframe, { action: "informations", payload: infoPayload });
          }
        });

        return;
      }

      if (type === "metadata") {
        const metadata = data?.metadata ?? data?.results?.metadata ?? data?.result?.metadata ?? data?.status ?? data;
        const previousRelationships = normalizeGraphRelationships(graphStatusRef.current?.[sessionKey]?.relationships);
        const infoPayload = buildGraphInfoPayload(metadata, sessionKey, previousRelationships, data?.summary ?? data?.results?.summary ?? data?.result?.summary ?? null);
        graphInfoPayloadBySessionRef.current[sessionKey] = infoPayload;
        graphStatusRef.current = {
          ...graphStatusRef.current,
          [sessionKey]: {
            ...graphStatusRef.current[sessionKey],
            status: metadata,
            summary: data?.summary ?? data?.results?.summary ?? data?.result?.summary ?? graphStatusRef.current?.[sessionKey]?.summary ?? null,
          }
        };

        setGraphStatus(prev => ({
          ...prev,
          [sessionKey]: {
            ...prev[sessionKey],
            status: metadata,
            summary: data?.summary ?? data?.results?.summary ?? data?.result?.summary ?? prev[sessionKey]?.summary ?? null,
          }
        }));

        targetWindows.forEach(w => {
          const iframe = iframeRefs.current[w.id];
          if (iframe?.current?.contentWindow) {
            if (isGraphInfoPlaceholderPath(getIframePathname(iframe))) {
              postMessageToIframe(iframe, { action: "informations", payload: infoPayload });
            }
          }
        });

        return;
      }

      if (type === "relationships") {
        const relationships = normalizeGraphRelationships(data);
        const hash = JSON.stringify(relationships.map(r => [r.id, r.type, r.textcolor, r.bgcolor]));
        if (lastHashBySession[sessionKey] === hash) return;
        lastHashBySession[sessionKey] = hash;

        graphStatusRef.current = {
          ...graphStatusRef.current,
          [sessionKey]: {
            ...graphStatusRef.current[sessionKey],
            relationships
          }
        };
        logGraphWindowDebug("graph relationships updated", {
          session_id: sessionKey,
          relationship_count: relationships.length,
          target_window_ids: targetWindows.map((windowState) => windowState.id),
        });

        setGraphStatus(prev => ({
          ...prev,
          [sessionKey]: {
            ...prev[sessionKey],
            relationships
          }
        }));

        setWindows(prev =>
          prev.map(w =>
            targetWindows.find(tw => tw.id === w.id) && String(w.graphLinkSource || "") === sessionKey
              ? { ...w, graphStatus: relationships }
              : w
          )
        );

        const metadataPayload = graphStatusRef.current?.[sessionKey]?.status;
        const summaryPayload = graphStatusRef.current?.[sessionKey]?.summary;
        if (metadataPayload && typeof metadataPayload === "object") {
          const infoPayload = buildGraphInfoPayload(metadataPayload, sessionKey, relationships, summaryPayload);
          graphInfoPayloadBySessionRef.current[sessionKey] = infoPayload;
          targetWindows.forEach((w) => {
            const iframe = iframeRefs.current[w.id];
            if (iframe?.current?.contentWindow && isGraphInfoPlaceholderPath(getIframePathname(iframe))) {
              postMessageToIframe(iframe, { action: "informations", payload: infoPayload });
            }
          });
        }

      }
    };

    socket.on("status", handleGraphStatus);

    const subscribeGraphStatusSession = (sessionId, reason = "effect") => {
      const normalizedSession = String(sessionId || "").trim();
      if (!normalizedSession) return;
      if (graphStatusSubscribedSessionsRef.current.has(normalizedSession)) {
        logGraphWindowDebug("graph status subscribe skipped", { session_id: normalizedSession, reason });
        return;
      }
      logGraphWindowDebug("graph status subscribe", { session_id: normalizedSession, reason });
      socket.emit("graph_status_subscribe", { session_id: normalizedSession });
      graphStatusSubscribedSessionsRef.current.add(normalizedSession);
    };

    graphStatusSessionIds.forEach((currentSessionId) => {
      subscribeGraphStatusSession(currentSessionId, "effect");
    });

    return () => {
      graphStatusSessionIds.forEach((currentSessionId) => {
        const normalizedSession = String(currentSessionId || "").trim();
        if (!normalizedSession) return;
        socket.emit("graph_status_unsubscribe", { session_id: normalizedSession });
        graphStatusSubscribedSessionsRef.current.delete(normalizedSession);
      });
      socket.off("status", handleGraphStatus);
      lastHashBySession = {};
    };
  }, [graphStatusSessionKey, token]); // depend on linked session ids and socket auth
  // ---------------------------------------------------------------------------- layout orientation ---
  useEffect(() => {
    if (orientation === "tabs" && windows.length > 0) {
      if (!activeWindowId || !windows.some(w => w.id === activeWindowId)) {
        setActiveWindowId(windows[0].id);
      }
    }
  }, [orientation, windows]);
  // ---------------------------------------------------------------------------- ctl button ---
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Control') {
        setIsCtrlHeld(true);
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === 'Control') {
        setIsCtrlHeld(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);
  //------------------------------------------------------------------------------ Storage search result container visiblity
  useEffect(() => {
  }, [batchFilesSearchHybrid]);
  useEffect(() => {
  }, [batchFilesSearchHiveQuery]);
  useEffect(() => {
    if (searchResultsVisible) {
      const handleClickOutside = (event) => {
        if (
          searchButtonRef.current &&
          resultContainerRef.current &&
          !searchButtonRef.current.contains(event.target) &&
          !resultContainerRef.current.contains(event.target)
        ) {
          resultContainerRef.current.style.display = 'none';
          setSearchResultsVisible(false);
        }
      };

      document.addEventListener('click', handleClickOutside);

      // Cleanup function
      return () => {
        document.removeEventListener('click', handleClickOutside);
      };
    }
  }, [searchResultsVisible]);

  //-------------------------------------------------------------------------------- Debounce
  useEffect(() => {
    // Cleanup function to clear the debounce timer when component unmounts or dependencies change
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      Object.values(graphActionDebounceRef.current || {}).forEach((timerId) => clearTimeout(timerId));
      Object.values(windowGraphActionDebounceRef.current || {}).forEach((timerId) => clearTimeout(timerId));
      graphActionDebounceRef.current = {};
      windowGraphActionDebounceRef.current = {};
    };
  }, []);

  //-------------------------------------------------------------------------------- messages listner
  useEffect(() => {
    const handleIframeMessage = (event) => {
      const sourceWindow = event?.source || null;
      const resolvedSourceWindowId = Object.keys(iframeRefs.current || {}).find((windowId) => {
        const frameRef = iframeRefs.current[windowId];
        return frameRef?.current?.contentWindow === sourceWindow;
      });
      const iframeAction = getIframeMessageAction(event.data);
      const isKnownIframeMessage = TRUSTED_IFRAME_MESSAGE_TYPES.has(iframeAction) || event.data?.action === "notify";
      const isRegisteredSandboxedIframe = String(event.origin || "") === "null" && !!resolvedSourceWindowId;
      if (isKnownIframeMessage && ((!isTrustedMessageOrigin(event) && !isRegisteredSandboxedIframe) || !resolvedSourceWindowId)) {
        console.warn("[iframe-message] blocked", { origin: event.origin, action: iframeAction, hasFrame: !!resolvedSourceWindowId });
        return;
      }

      // ---------------- Header trigger (revertable block) ----------------
      // Contract:
      // event.data = {
      //   type: "linkx_header_trigger",
      //   command: "open_graph_window",
      //   payload?: { analysisSessionId?: "str_report_...", socketEmit?: any }
      // }
      if (event.data?.type === "linkx_header_trigger") {
        const origin = String(event.origin || "");
        const sameOrigin = origin === window.location.origin;
        const allowedOrigin = HEADER_TRIGGER_ALLOWED_ORIGINS.includes(origin);
        if (!sameOrigin && !allowedOrigin) {
          console.warn("[header-trigger] blocked origin:", origin || null);
          return;
        }

        const triggerPayload = event.data?.payload && typeof event.data.payload === "object"
          ? event.data.payload
          : {};
        const command = String(event.data?.command || triggerPayload.command || "").trim().toLowerCase();

        if (command !== "open_graph_window") {
          event.source?.postMessage(
            {
              type: "linkx_header_trigger_result",
              payload: { ok: false, reason: `Unsupported command: ${command || "empty"}` }
            },
            event.origin
          );
          return;
        }

        let windowId = null;
        const analysisSessionId = String(triggerPayload.analysisSessionId || "").trim();
        if (analysisSessionId && openStrReportGraphAndBindRef.current) {
          windowId = openStrReportGraphAndBindRef.current(
            analysisSessionId,
            triggerPayload.socketEmit ?? null
          );
        } else {
          const resolvedSession =
            String(triggerPayload.sessionId || sessionIdRef.current || localStorage.getItem("session") || "").trim();
          windowId = handleCreateWindows(resolvedSession, "graph");
          if (windowId != null) {
            handleFocusWindow(windowId);
          }
        }

        event.source?.postMessage(
          {
            type: "linkx_header_trigger_result",
            payload: {
              ok: windowId != null,
              command: "open_graph_window",
              windowId,
              mode: analysisSessionId ? "analysis_linked" : "blank_graph"
            }
          },
          event.origin
        );
        return;
      }

      if (
        event.data?.type === "app_notification" ||
        event.data?.type === "notification" ||
        event.data?.action === "notify"
      ) {
        const payload = event.data?.payload || event.data || {};
        pushNotification({
          title: payload.title || "Notification",
          message: payload.message || payload.text || "",
          source: payload.source || "Iframe",
          level: payload.level || payload.severity || "info",
          durationMs: payload.durationMs
        });
        return;
      }
      if (event.data?.type === "nodeProperties") {
        const rawProperties = event.data?.payload;
        const normalizedProperties = rawProperties && typeof rawProperties === "object" && !Array.isArray(rawProperties)
          ? (Object.keys(rawProperties).length > 0 ? rawProperties : null)
          : null;
        const targetGraphWindowId = event.data?.payload?.windowId ?? resolvedSourceWindowId;
        if (!targetGraphWindowId) return;

        setWindows(prev =>
          prev.map(w =>
            w.type === "graph" && String(w.id) === String(targetGraphWindowId)
              ? { ...w, nodeProperties: normalizedProperties }
              : w
          )
        );
        return;
      }
      if (event.data?.type === "all_property_keys_response") {
        const payload = event.data?.payload || {};
        const targetGraphWindowId = payload.id ?? resolvedSourceWindowId;
        if (!targetGraphWindowId) return;

        const normalizedKeys = Array.isArray(payload.keys)
          ? Array.from(new Set(payload.keys.map((key) => String(key || "").trim()).filter(Boolean)))
          : [];
        const applyPropertyKeyDefaults = (rawSettings) => {
          const nextSettings = normalizeGraphIframeSettings(rawSettings);
          const defaultKey = normalizedKeys[0] || "";
          if (!defaultKey) return nextSettings;
          if (!nextSettings[0]) nextSettings[0] = defaultKey;
          if (!nextSettings[4]) nextSettings[4] = defaultKey;
          if (nextSettings[13] === "property_value" && !nextSettings[14]) nextSettings[14] = defaultKey;
          return nextSettings;
        };

        setWindows(prev =>
          prev.map(w => {
            if (w.type !== "graph" || String(w.id) !== String(targetGraphWindowId)) return w;
            return {
              ...w,
              filterPropertyKeys: normalizedKeys,
              iframeSettings: applyPropertyKeyDefaults(w.iframeSettings),
            };
          })
        );
        setIframeSettings(prev => {
          const currentWindow = windowsRef.current.find((w) => w.type === "graph" && String(w.id) === String(targetGraphWindowId));
          const baseSettings = prev[targetGraphWindowId] ?? currentWindow?.iframeSettings;
          return {
            ...prev,
            [targetGraphWindowId]: applyPropertyKeyDefaults(baseSettings),
          };
        });
        return;
      }
      if (event.data?.type === "graph_render_stats") {
        const payload = event.data?.payload || {};
        const targetGraphWindowId = payload.id ?? resolvedSourceWindowId;
        const visibleNodes = Number(payload.visible_nodes ?? payload.nodes ?? payload.total_nodes ?? 0) || 0;
        const visibleEdges = Number(payload.visible_edges ?? payload.edges ?? payload.total_edges ?? 0) || 0;
        const graphIsLarge = visibleNodes >= 300;
        const currentGraphWindow = windowsRef.current.find((w) => w.type === "graph" && String(w.id) === String(targetGraphWindowId));
        const previousVisibleNodes = Number(currentGraphWindow?.graphRenderStats?.visible_nodes ?? currentGraphWindow?.graphRenderStats?.total_nodes ?? 0) || 0;
        const enteredPerformanceMode = previousVisibleNodes < 300 && graphIsLarge;
        setWindows(prev =>
          prev.map(w => {
            if (w.type !== "graph" || String(w.id) !== String(targetGraphWindowId)) return w;
            const nextSettings = normalizeGraphIframeSettings(w.iframeSettings);
            if (enteredPerformanceMode) {
              nextSettings[9] = false;
              if (nextSettings[10] === "hierarchical") {
                nextSettings[10] = "layered";
              }
            }
            return { ...w, graphRenderStats: { visible_nodes: visibleNodes, visible_edges: visibleEdges, total_nodes: visibleNodes, total_edges: visibleEdges, reason: payload.reason || "iframe" }, iframeSettings: nextSettings };
          })
        );
        if (enteredPerformanceMode) {
          setIframeSettings(prev => {
            const nextSettings = normalizeGraphIframeSettings(prev[targetGraphWindowId]);
            nextSettings[9] = false;
            if (nextSettings[10] === "hierarchical") {
              nextSettings[10] = "layered";
            }
            return { ...prev, [targetGraphWindowId]: nextSettings };
          });
        }
      }
      if (event.data?.type === "graph_search_results") {        
        const { id, nodes, edges } = event.data.payload; // unpack the payload
        const targetGraphWindowId = id ?? resolvedSourceWindowId;
        console.log("graph_search_results:",id,nodes, edges)
        setWindows(prev =>
          prev.map(w => {
            if (w.type !== "graph" || w.id !== targetGraphWindowId) return w;
            const oldSearch = Array.isArray(w.iframeSearch) ? w.iframeSearch : ["", false, {}, { nodes: 0, edges: 0 }];
            const newSearch = [...oldSearch];
            newSearch[3] = {
              nodes: nodes ?? 0,
              edges: edges ?? 0
            };
            return { ...w, iframeSearch: newSearch };
          })
        );
        setIframeSearch(prev => {
          const oldSearch = Array.isArray(prev[targetGraphWindowId]) ? prev[targetGraphWindowId] : ["", false, {}, { nodes: 0, edges: 0 }];
          const newSearch = [...oldSearch];
          newSearch[3] = {
            nodes: nodes ?? 0,
            edges: edges ?? 0
          };
          return {
            ...prev,
            [targetGraphWindowId]: newSearch
          };
        });
      }
      if (event.data?.type === "network_components") {
        console.log(5)
        const { id, nodes, edges } = event.data.payload; // unpack the payload
        //Store components
        handleChartActions(id,"storeNetwork","components",event.data.payload);//id the chart window id
        console.log(5.5,id)
      }
      if (event.data?.type === "entity_selection") {
        console.log(22)
        //Note: this id is not a chart window id but the sourse graph window id 
        const selectionPayload = event.data?.payload || {};
        const sourceGraphId = selectionPayload.id ?? resolvedSourceWindowId;
        const selectedNodes = selectionPayload.selectedNodes ?? selectionPayload.nodes ?? [];
        const selectedEdges = selectionPayload.selectedEdges ?? selectionPayload.edges ?? [];
        //set selected entities for alllinked chart window to the top graph window
        handleChartActions(sourceGraphId,"updateNetwork","selection", { ...selectionPayload, id: sourceGraphId, selectedNodes, selectedEdges });
        console.log(23)
      }
      //1 Listen what is selected from the graph window
      //2 update the selected node and edges in each window that are chart type and linkd to that specific graph window
      //3 listen fro the nodes selection change and update the graphs that are already created
    };

      window.addEventListener("message", handleIframeMessage);
      return () => window.removeEventListener("message", handleIframeMessage);
  }, [pushNotification, verifyToken]);

  // ---------------------------------------------------------------------------- Windows management ---
  const countOpenWindowsByType = useCallback((windowType) => (
    windowsRef.current.filter((windowState) => windowState.type === windowType).length
  ), []);

  const releasePendingWindowCreate = useCallback((windowType) => {
    if (!Object.prototype.hasOwnProperty.call(pendingWindowCreatesRef.current, windowType)) return;
    pendingWindowCreatesRef.current[windowType] = Math.max(0, Number(pendingWindowCreatesRef.current[windowType] || 0) - 1);
  }, []);

  const guardWindowCreation = useCallback((windowType) => {
    const cap = WINDOW_CAPS[windowType];
    if (!cap) return { ok: true };

    const currentCount = countOpenWindowsByType(windowType);
    const pendingCount = Number(pendingWindowCreatesRef.current[windowType] || 0);
    const totalCount = currentCount + pendingCount;

    if (totalCount >= cap.hard) {
      pushNotification({
        title: "Window limit reached",
        message: "Maximum of " + cap.hard + " " + cap.label + " reached. Close one before opening another.",
        source: "Linkx",
        level: "warning",
        durationMs: 7000,
      });
      return { ok: false };
    }

    if (totalCount >= cap.soft) {
      pushNotification({
        title: "Window count warning",
        message: "You already have " + totalCount + " " + cap.label + " open. Performance may degrade if you open more.",
        source: "Linkx",
        level: "warning",
        durationMs: 5000,
      });
    }

    pendingWindowCreatesRef.current[windowType] = pendingCount + 1;
    return { ok: true };
  }, [countOpenWindowsByType, pushNotification]);

  const handleFocusWindow = (id) => {
    console.log("focused_on:", id, "type:", typeof id);
    setWindows((prev) => {
      const maxZ = Math.max(...prev.map((w) => w.zIndex), 0);
      return prev.map((w) =>
        w.id === id
          ? { ...w, zIndex: maxZ + 1, covered: false }
          : { ...w, covered: true}
      );
    });
    windowIdRef.current = id;
    setActiveWindowId(id)
  };
  const generateWindowId = () => {
    let maxId = 0;
    // Iterate over all windows to find the absolute highest numeric ID in use
    windowsRef.current.forEach(w => {
      const parts = String(w.id).split('_');
      const num = parseInt(parts[0], 10);
      if (!isNaN(num) && num > maxId) {
        maxId = num;
      }
    });
    // Protect against rapid clicks before React flushes state
    if (typeof windowIdRef.current === "number" && windowIdRef.current > maxId) {
      maxId = windowIdRef.current;
    }
    const nextId = maxId + 1;
    windowIdRef.current = nextId; // keep ref in sync just in case
    return nextId;
  };
  const handleCreateWindows = (sessionId, type, iframeRef, initialContent = null) => {
    if (type === "source" && !requirePermission(PERMISSIONS.SOURCE_CREATE, "source windows")) return null;
    if (type === "graph" && !requirePermission(PERMISSIONS.GRAPH_CREATE, "graph windows")) return null;
    if (isWorkspaceLocked && ["graph", "chart"].includes(type)) {
      notifyLockedSensitiveAction(type + " windows");
      return null;
    }
    const guardedTypes = new Set(["source", "graph", "chart"]);
    if (guardedTypes.has(type)) {
      const guardResult = guardWindowCreation(type);
      if (!guardResult.ok) return null;
    }
    const id = generateWindowId();
    // if (windowIdRef[id]){
    //   const id = generateWindowId();
    // }
    if (type === "source") {
      const sourceAutofillDefaults = getSourceWindowAutofillDefaults(configurations);
      debounceRef.current = setTimeout(() => {
          const payload = { id: "source_window", session_id: sessionId, window_id:id};
          apiFetch("/init_source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
            .then(data => {
              if (isSuccessResponse(data)) {
                const windowsId = extractSourceWindowSessionId(data, id, sessionId);
                const parentSessionId = extractParentSessionId(windowsId) || normalizeSessionId(sessionId);
                iframeRefs.current[windowsId] = React.createRef();
                setActiveWindowId(windowsId);
                setWindows(prev => {
                  const maxZ = prev.length
                    ? Math.max(...prev.map(w => w.zIndex))
                    : 0;
                  return [
                    ...prev,
                    {
                      id: windowsId,
                      type,
                      zIndex: maxZ + 1,
                      sessionId: parentSessionId,
                      selectedContent: initialContent,
                      selectedSubContent: null,
                      formData: {},
                      windowResponseI: null,
                      windowRealtimeResponseI: null,
                      sourceKind: sourceAutofillDefaults.sourceAddressType || SOURCE_KINDS.BROKER,
                      sourceStatus: SOURCE_STATUSES.IDLE,
                      toolStatus: TOOL_STATUSES.IDLE,
                      dataframeStatus: DATAFRAME_STATUSES.NONE,
                      streamStatus: STREAM_STATUSES.IDLE,
                      sourceStep: SOURCE_FLOW_STEPS.CONNECT,
                      sourceAddressType: sourceAutofillDefaults.sourceAddressType,
                      sourceAddressText: sourceAutofillDefaults.sourceAddressText,
                      sourceStorageText: sourceAutofillDefaults.sourceStorageText,
                      sourceTopicText: sourceAutofillDefaults.sourceTopicText,
                      sourceRealtimeAddressType: sourceAutofillDefaults.sourceRealtimeAddressType,
                      sourceRealtimeAddressText: sourceAutofillDefaults.sourceRealtimeAddressText,
                      sourceRealtimeTopicText: sourceAutofillDefaults.sourceRealtimeTopicText,
                      toolUrl: sourceAutofillDefaults.toolUrl,
                      toolUsername: sourceAutofillDefaults.toolUsername,
                      toolPassword: sourceAutofillDefaults.toolPassword,
                      toolPasswordRef: sourceAutofillDefaults.toolPasswordRef,
                      toolDatabase: sourceAutofillDefaults.toolDatabase,
                      realtimeToolUrl: sourceAutofillDefaults.realtimeToolUrl,
                      realtimeToolUsername: sourceAutofillDefaults.realtimeToolUsername,
                      realtimeToolPassword: sourceAutofillDefaults.realtimeToolPassword,
                      realtimeToolPasswordRef: sourceAutofillDefaults.realtimeToolPasswordRef,
                      realtimeToolDatabase: sourceAutofillDefaults.realtimeToolDatabase,
                      formToolResponse: null,
                      formRealtimeToolResponse: null,
                      fileInputRef: fileInputRef,
                      realtimeNeo4jConnectedSessionId: null,
                      realtimeConfigPersistStatus: "idle",
                      realtimeConfigPersistedSessionId: null,
                      realtimeConfigPersistMessage: null,
                      realtimeStartGuardMessage: null,
                      realtimeLastConnectSessionId: null,
                      batchFilesSearchResults: null,
                    },
                  ];
                });
                releasePendingWindowCreate("source");
                console.log("windowsId:",windowsId)
                handleFocusWindow(windowsId)
                setZIndexCounter(prev => prev + 1);
              } else {
                releasePendingWindowCreate("source");
                alert("Could not initialize source window!");
              }
            })
            .catch((error) => {
              releasePendingWindowCreate("source");
              console.error(error);
            });
        }, 300);
    } else if (type === "graph") {
      iframeRefs.current[id] = React.createRef();
      setActiveWindowId(id);
      const initialSettings = normalizeGraphIframeSettings(DEFAULT_GRAPH_IFRAME_SETTINGS);
      const initialSearch = ["","",{},{"nodes":0,"edges":0}]
      // set iframe search and settings the Window parmas
      setIframeSearch(prev => ({
        ...prev,
        [id]: initialSearch,
      }));
      setIframeSettings(prev => ({
        ...prev,
        [id]: initialSettings,
      }));
      setIframePerformanceMood(prev => ({
        ...prev,
        [id]: true,
      }));
      setWindows(prev => {
        const maxZ = prev.length ? Math.max(...prev.map(w => w.zIndex)) : 0;
        return [
          ...prev,
          {
            id,
            type,
            zIndex: maxZ + 1,
            sessionId,
            graphLinkSource: null,
            selectedContent: null,
            selectedSubContent: null,
            graphLink: null,
            graphStatus: null,
            graphRenderStats: null,
            activeGraph: null,
            iframeSearch: initialSearch,
            iframeSettings: initialSettings,
            covered: false,
          },
        ];
      });
      releasePendingWindowCreate("graph");
      handleFocusWindow(id)
      setZIndexCounter(prev => prev + 1);
      return id;
    } else if (type === "chart") {
      iframeRefs.current[id] = React.createRef();
      setActiveWindowId(id);
      setWindows(prev => {
        const maxZ = prev.length ? Math.max(...prev.map(w => w.zIndex)) : 0;
        return [
          ...prev,
          {
            id,
            type,
            zIndex: maxZ + 1,
            sessionId,
            selectedContent: null,
            selectedSubContent: null,
            chartLink: false,
            activechart: null,
            covered: false,
          },
        ];
      });
      releasePendingWindowCreate("chart");
      handleFocusWindow(id)
      setZIndexCounter(prev => prev + 1);
    } else if (type === "parent") {
      setWindows(prev => {
        const maxZ = prev.length ? Math.max(...prev.map(w => w.zIndex)) : 0;
        return [
          ...prev,
          {
            id,
            type,
            zIndex: maxZ + 1,
            sessionId,
            selectedContent: null,
            selectedSubContent: null,
            chartLink: false,
            activechart: null,
            covered: false,
          },
        ];
      });
      handleFocusWindow(id)
      setZIndexCounter(prev => prev + 1);
    }    
  };
  const handleOpenWindows = (type, link, iframeRef, initialContent = null) => {
    const sessionId=localStorage.getItem('session'); //Already stored session
    if (type==="source"){
      if (link===""){
        //If theres no link just creates the window
        return handleCreateWindows(sessionId,type,iframeRef,initialContent);
      }
      else{
        return null;
      }
    }
    if (type==="graph"){
      if (link===""){
        //If theres no link just creates the window
        return handleCreateWindows(sessionId,type,iframeRef);
      }
      else{
        return null;
      }
    }
    if (type==="chart"){
      if (link===""){
        //If theres no link just creates the window
        return handleCreateWindows(sessionId,type,iframeRef);
      }
      else{
        return null;
      }
    }
    if (type==="parent"){
      return handleCreateWindows(type);
    }
    return null;
  };
  // ------------------------------------------------------- str report link analysis (backend-driven graph) ---
  const bindStrReportGraphWindow = (graphWindowId, analysisSessionId, socketEmit) => {
    const socket = socketRef.current;
    if (!socket || graphWindowId == null || !analysisSessionId) return;
    setGraphLinkState(true);
    setGraphLinkSource(analysisSessionId);
    sourceRef.current = analysisSessionId;
    setGraphStatusListener(true);
    setSourceStreamListener(true);
    setSourceStreams((prev) => ({ ...prev, [analysisSessionId]: true }));

    if (!strReportSubscribedSessionsRef.current.has(analysisSessionId)) {
      applyStrReportSocketEmitList(socket, analysisSessionId, socketEmit);
      console.log("[str report receiver registered]", { session_id: analysisSessionId });
      strReportSubscribedSessionsRef.current.add(analysisSessionId);
    }

    setWindows((prev) =>
      prev.map((w) =>
        w.id === graphWindowId
          ? {
              ...w,
              sessionId: analysisSessionId,
              graphLinkSource: analysisSessionId,
              selectedContent: "graph_content",
              activeGraph: "graph_info_placeholder",
              graphLink: true,
              loadscreenState: false,
              loadscreenText: "",
            }
          : w
      )
    );

    strReportGraphByAnalysisRef.current[analysisSessionId] = graphWindowId;
  };

  const openStrReportGraphAndBind = (analysisSessionId, socketEmit) => {
    if (!analysisSessionId) return null;

    const analysisKey = String(analysisSessionId).trim();
    if (!isStrReportAnalysisSession(analysisKey)) {
      return null;
    }

    const pendingSocketEmit = socketEmit ?? strReportPendingRef.current?.socketEmit ?? null;

    const existingGraphWindowId =
      strReportGraphByAnalysisRef.current[analysisKey] ??
      windowsRef.current.find(
        (w) => w.type === "graph" && String(w.graphLinkSource) === analysisKey
      )?.id;

    if (existingGraphWindowId != null) {
      bindStrReportGraphWindow(existingGraphWindowId, analysisKey, pendingSocketEmit);
      handleFocusWindow(existingGraphWindowId);
      strReportPendingRef.current = null;
      return existingGraphWindowId;
    }

    if (strReportOpenInFlightRef.current.has(analysisKey)) {
      return null;
    }

    strReportOpenInFlightRef.current.add(analysisKey);

    const graphWindowId = handleCreateWindows(analysisKey, "graph");
    if (graphWindowId == null) {
      strReportOpenInFlightRef.current.delete(analysisKey);
      return null;
    }

    setWindows((prev) =>
      prev.map((w) =>
        w.id === graphWindowId
          ? { ...w, loadscreenState: true, loadscreenText: "Linking STR report graph " }
          : w
      )
    );

    const linkPayload = { id: "link", source_id: sanitizeGraphEndpointId(analysisKey), graph_window_id: sanitizeGraphEndpointId(graphWindowId) };
    console.log("[graph link request]", linkPayload);
    apiFetch("/graph_link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(linkPayload),
    })
      .then((data) => {
        console.log("[graph link response]", { payload: linkPayload, response: data });
        if (!isSuccessResponse(data)) {
          console.warn("str_report graph_link:", data?.message || data);
        }
        bindStrReportGraphWindow(graphWindowId, analysisKey, pendingSocketEmit);
        handleFocusWindow(graphWindowId);
        strReportPendingRef.current = null;
      })
      .catch((err) => {
        console.error("str_report graph_link failed:", err);
        bindStrReportGraphWindow(graphWindowId, analysisKey, pendingSocketEmit);
        handleFocusWindow(graphWindowId);
        strReportPendingRef.current = null;
      })
      .finally(() => {
        strReportOpenInFlightRef.current.delete(analysisKey);
      });

    return graphWindowId;
  };

  openStrReportGraphAndBindRef.current = openStrReportGraphAndBind;

  const resolveSourceWindowClosePayload = (windowState, id) => {
    if (windowState?.type !== "source") return null;

    const rawId = String(id ?? windowState.id ?? "");
    const [rawWindowId, ...sessionParts] = rawId.split("_");
    const parsedWindowId = Number.parseInt(rawWindowId, 10);
    const resolvedSessionId = String(windowState.sessionId ?? sessionParts.join("_") ?? "").trim();

    if (!Number.isFinite(parsedWindowId) || !resolvedSessionId) return null;

    return {
      id: "close_source_window",
      session_id: resolvedSessionId,
      window_id: parsedWindowId,
      reason: "user_closed_window",
    };
  };

  const requestSourceWindowCleanup = (windowState, id) => {
    const payload = resolveSourceWindowClosePayload(windowState, id);
    if (!payload) return;

    apiFetch("/close_source_window", {
      method: "POST",
      body: payload,
    }).catch((err) => {
      console.error("close_source_window failed:", err, "payload:", payload);
    });
  };

    // --- Bring window to front ---
  const handleCloseWindow = (id) => {
    const closingWindowSnapshot = windowsRef.current.find(w => w.id === id);
    requestSourceWindowCleanup(closingWindowSnapshot, id);

    setWindows(prev => {
      const closingWindow = prev.find(w => w.id === id);
      const newWindows = prev.filter(w => w.id !== id);
      const nextId = newWindows.length
        ? newWindows[newWindows.length - 1].id
        : null;
      setTimeout(() => {
        if (nextId !== null) handleFocusWindow(nextId);
      }, 0);
      if (newWindows.length === 0) {
        const persistedOrientation = typeof window !== "undefined"
          ? window.localStorage.getItem("linkx_orientation_mode")
          : null;
        setOrientation(persistedOrientation === "windows" ? "windows" : "tabs");
      }
      console.log("closingWindow:",closingWindow, "id:",id)
      const socket = socketRef.current;
      if (closingWindow?.type === "graph" && closingWindow.graphLinkSource) {
        const analysisKey = String(closingWindow.graphLinkSource);
        const hasSiblingLinkedGraph = newWindows.some((w) =>
          w.type === "graph" && String(w.graphLinkSource || "") === analysisKey
        );

        if (!hasSiblingLinkedGraph) {
          if (strReportGraphByAnalysisRef.current[analysisKey] === id) {
            delete strReportGraphByAnalysisRef.current[analysisKey];
          }
          strReportOpenInFlightRef.current.delete(analysisKey);
          strReportSubscribedSessionsRef.current.delete(analysisKey);
          graphStatusSubscribedSessionsRef.current.delete(analysisKey);
          if (socket && socket.connected) {
            socket.emit("graph_status_unsubscribe", { session_id: analysisKey });
          }
        }
      }
      if (socket && socket.connected && closingWindow?.type == "source") {
        const sessionKey = String(id);
        const filename = activeLogStreamsRef.current[sessionKey] || resolveLogStreamFilename(closingWindow.sourceSessionLogFile);
        if (filename) {
          socket.emit("log_stream_unplug", { session_id: sessionKey, filename });
        }
        delete activeLogStreamsRef.current[sessionKey];
        delete logBuffersRef.current[sessionKey];
        setSourceSessionLogFiles(prevStreams => {
          const nextStreams = { ...prevStreams };
          delete nextStreams[sessionKey];
          return nextStreams;
        });
        socket.emit("graph_status_unsubscribe", { session_id: id });
        graphStatusSubscribedSessionsRef.current.delete(String(id));
        
        return newWindows.map(w => 
          w.type === "graph" && String(w.graphLinkSource) === sessionKey
            ? {
                ...w,
                activeGraph: "graph_placeholder",
                graphStatus: null,
                graphRenderStats: null,
                graphLinkSource: null,
                filterPropertyKeys: null,
                selectedContent: null,
                graphLink: false,
                loadscreenState: false
              }
            : w
        );
      }
      return newWindows;
    });
    setIframePerformanceMood(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };
  const handleMoveWindow = (id, newPos) => {
    setWindows(prev =>
      prev.map(w => (w.id === id ? { ...w, position: newPos } : w))
    );
  };
  // ---------------------------------------------------------------------------- Windows functions ---
  // --- Basic Graph actions ---
  const updateIframeSettings = (windowId, key, value) => {
    console.log("settings to update:",windowId, key, value)
    setIframeSettings(prev => {
      const current = normalizeGraphIframeSettings(prev[windowId]);
      const next = [...current];
      next[key] = key === 2 ? normalizeGraphLimitRange(value, current[2]?.max || 25) : value;
      return {
        ...prev,
        [windowId]: next
      };
    });
  }
  const sendGraphMessageToIframe = (iframe, msgAction, msgPayload) => {
    if (!iframe?.current) {
      console.warn("Iframe not found!");
      return;
    }

    const send = () => {
      postMessageToIframe(iframe, { action: msgAction, payload: msgPayload });
    };

    const iframeSrc = iframe.current.src || "";
    const windowId = msgPayload?.id;
    
    // If it's already on the graphs_basic page, send immediately
    if (iframeSrc.includes("graphs_basic")) {
      send();
    } else {
      // Otherwise, wait for the global ready event
      const handleIframeReady = (e) => {
        if (iframe.current && e.detail.source === iframe.current.contentWindow) {
          send();
          window.removeEventListener("linkx_iframe_ready", handleIframeReady);
        }
      };
      window.addEventListener("linkx_iframe_ready", handleIframeReady);
      
      // Cleanup after 30s
      setTimeout(() => {
        window.removeEventListener("linkx_iframe_ready", handleIframeReady);
      }, 30000);
    }
  };
  const requestEvidenceGraph = (windowId, payload, options = {}) => {
    const iframe = payload?.iframe || null;
    const traceId = String(payload?.traceId || "").trim();
    const requestOrigin = options.requestOrigin || "manual";
    const graphWindowId = String(windowId || "").trim();

    if (!graphWindowId || !traceId) {
      logGraphWindowDebug("graph fetch skipped", {
        reason: "missing_required_payload",
        graph_window_id: graphWindowId,
        trace_id: traceId,
        request_origin: requestOrigin,
      });
      return;
    }

    const newPayload = {
      id: "evidence",
      trace_id: traceId,
    };

    if (graphFetchAbortControllersRef.current[graphWindowId]) {
      graphFetchAbortControllersRef.current[graphWindowId].abort();
      delete graphFetchAbortControllersRef.current[graphWindowId];
    }
    const controller = new AbortController();
    graphFetchAbortControllersRef.current[graphWindowId] = controller;
    delete graphProgressRenderedRef.current[graphWindowId];
    graphAutoRequestedRef.current[graphWindowId] = requestOrigin === "auto_relationships";

    logGraphWindowDebug("graph fetch request", {
      graph_window_id: graphWindowId,
      trace_id: traceId,
      request_origin: requestOrigin,
    });

    const buildGraphProgressPayload = (response, complete = false) => {
      const responseResults = response?.results && typeof response.results === "object" ? response.results : {};
      const summary = responseResults?.result && typeof responseResults.result === "object" ? responseResults.result : {};
      const currentNodes = Array.isArray(responseResults.nodes) ? responseResults.nodes.length : 0;
      const currentEdges = Array.isArray(responseResults.edges) ? responseResults.edges.length : 0;
      const totalNodes = Number(summary.total_nodes);
      const totalEdges = Number(summary.total_edges);
      const total = Number.isFinite(totalNodes) && Number.isFinite(totalEdges)
        ? Math.max(1, totalNodes + totalEdges)
        : null;
      return {
        title: "Fetching graph data...",
        current: currentNodes + currentEdges,
        total,
        status: complete ? "done" : (response?.status || "fetching"),
        trace_id: traceId,
        complete,
      };
    };

    const processFinalData = (data) => {
        console.log("[graph evidence fetch received raw]", {
          graph_window_id: graphWindowId,
          trace_id: traceId,
          request_origin: requestOrigin,
          data,
        });
        if (!graphFetchAbortControllersRef.current[graphWindowId] || graphFetchAbortControllersRef.current[graphWindowId] !== controller) return;
        const normalizedResults = data?.results || {};
        const nodes = Array.isArray(normalizedResults.nodes) ? normalizedResults.nodes : [];
        const edges = Array.isArray(normalizedResults.edges) ? normalizedResults.edges : [];

        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? {
                  ...windowState,
                  loadscreenState: false,
                  loadscreenText: null,
                  activeGraph: isSuccessResponse(data) ? "graphs_basic" : null,
                  selectedContent: isSuccessResponse(data) ? "graph_content" : windowState.selectedContent
                }
              : windowState
          )
        );

        const progress = buildGraphProgressPayload(data, true);
        console.log("[graph debug] graph fetch response", {
          graph_window_id: graphWindowId,
          trace_id: traceId,
          request_origin: requestOrigin,
          node_count: nodes.length,
          edge_count: edges.length,
          ok: isSuccessResponse(data),
        });

        if (isSuccessResponse(data)) {
          delete activeGraphJobsRef.current[graphWindowId];
          const hasRenderedGraph = graphProgressRenderedRef.current[graphWindowId] === true;
          const messageAction = hasRenderedGraph ? "graph_chunk_update" : "new_graph";
          const sourceWindowState = windowsRef.current.find((windowState) => String(windowState.id) === graphWindowId);
          const settingsToApply = normalizeGraphIframeSettings(iframeSettings[graphWindowId] || sourceWindowState?.iframeSettings);
          if (!hasRenderedGraph) {
            settingsToApply[2] = normalizeGraphLimitRange({ min: 0, max: 25 }, 25);
            updateIframeSettings(graphWindowId, 2, { min: 0, max: 25 });
          }
          const targetIframe = iframe || iframeRefs.current[graphWindowId];
          console.log("[evidence debug iframe]", { graphWindowId, iframePassed: !!iframe, targetIframe, targetIframeCurrent: targetIframe?.current, iframeRefsKeys: Object.keys(iframeRefs.current || {}) });
        sendGraphMessageToIframe(targetIframe, messageAction, {
            id: graphWindowId,
            nodes,
            edges,
            settings: settingsToApply,
            progress: buildGraphProgressPayload(data, true),
          });
          graphProgressRenderedRef.current[graphWindowId] = true;
          
          if (!hasRenderedGraph) {
            setTimeout(() => {
              postMessageToIframe(targetIframe, { action: "graph_physics", payload: { enabled: true } });
            }, 100);
          }
        }
    };
    
    if (options.initialData) {
      processFinalData(options.initialData);
      return;
    }

    requestGraphFetch(apiFetch, newPayload, controller.signal, {
      onQueued: (queuedData) => {
        const jobId = getQueuedJobId(queuedData);
        const status = getJobStatus(queuedData);
        if (jobId) {
          activeGraphJobsRef.current[graphWindowId] = jobId;
        }
        logGraphWindowDebug("graph fetch queued", {
          graph_window_id: graphWindowId,
          trace_id: traceId,
          request_origin: requestOrigin,
          job_id: jobId || null,
          status: status || null,
        });
      },
      onProgress: (partialData, progressMeta) => {
        if (!graphFetchAbortControllersRef.current[graphWindowId] || graphFetchAbortControllersRef.current[graphWindowId] !== controller) return;
        const partialResults = partialData?.results || {};
        const nodes = Array.isArray(partialResults.nodes) ? partialResults.nodes : [];
        const edges = Array.isArray(partialResults.edges) ? partialResults.edges : [];
        console.log('[graph fetch progress]', {
          graph_window_id: graphWindowId,
          trace_id: traceId,
          request_origin: requestOrigin,
          status: progressMeta?.status || null,
          after_event_id: progressMeta?.afterEventId ?? null,
          chunk_count: progressMeta?.chunkCount ?? null,
          node_count: nodes.length,
          edge_count: edges.length,
          data: partialData,
        });
        if (nodes.length === 0 && edges.length === 0) return;

        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? { ...windowState, loadscreenState: false, loadscreenText: null, activeGraph: 'graphs_basic', selectedContent: 'graph_content' }
              : windowState
          )
        );

        const progress = buildGraphProgressPayload(partialData, false);

        const hasRenderedGraph = graphProgressRenderedRef.current[graphWindowId] === true;
        const messageAction = hasRenderedGraph ? "graph_chunk_update" : "new_graph";
        const sourceWindowState = windowsRef.current.find((windowState) => String(windowState.id) === graphWindowId);
        const settingsToApply = normalizeGraphIframeSettings(iframeSettings[graphWindowId] || sourceWindowState?.iframeSettings);
        if (!hasRenderedGraph) {
          settingsToApply[2] = normalizeGraphLimitRange({ min: 0, max: 25 }, 25);
          updateIframeSettings(graphWindowId, 2, { min: 0, max: 25 });
        }
        const targetIframe = iframe || iframeRefs.current[graphWindowId];
        sendGraphMessageToIframe(targetIframe, messageAction, {
          id: graphWindowId,
          nodes,
          edges,
          settings: settingsToApply,
          progress,
        });
        graphProgressRenderedRef.current[graphWindowId] = true;
      }
    })
      .then((data) => {
        console.log("[graph evidence fetch received raw]", {
          graph_window_id: graphWindowId,
          trace_id: traceId,
          request_origin: requestOrigin,
          data,
        });
        if (!graphFetchAbortControllersRef.current[graphWindowId] || graphFetchAbortControllersRef.current[graphWindowId] !== controller) return;
        const normalizedResults = data?.results || {};
        const nodes = Array.isArray(normalizedResults.nodes) ? normalizedResults.nodes : [];
        const edges = Array.isArray(normalizedResults.edges) ? normalizedResults.edges : [];

        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? {
                  ...windowState,
                  loadscreenState: false,
                  loadscreenText: null,
                  activeGraph: isSuccessResponse(data) ? "graphs_basic" : null,
                  selectedContent: isSuccessResponse(data) ? "graph_content" : windowState.selectedContent
                }
              : windowState
          )
        );

        logGraphWindowDebug("graph fetch response", {
          graph_window_id: graphWindowId,
          trace_id: traceId,
          request_origin: requestOrigin,
          node_count: nodes.length,
          edge_count: edges.length,
          ok: isSuccessResponse(data),
        });

        if (isSuccessResponse(data)) {
          delete activeGraphJobsRef.current[graphWindowId];
          if (nodes.length === 0 && edges.length === 0) {
            pushNotification({ title: "Graph Empty", message: "No graph data found for this evidence.", level: "info" });
            handleCloseWindow(graphWindowId);
            return;
          }
          const hasRenderedGraph = graphProgressRenderedRef.current[graphWindowId] === true;
          const messageAction = hasRenderedGraph ? "graph_chunk_update" : "new_graph";
          const sourceWindowState = windowsRef.current.find((windowState) => String(windowState.id) === graphWindowId);
          const settingsToApply = normalizeGraphIframeSettings(iframeSettings[graphWindowId] || sourceWindowState?.iframeSettings);
          if (!hasRenderedGraph) {
            settingsToApply[2] = normalizeGraphLimitRange({ min: 0, max: 25 }, 25);
            updateIframeSettings(graphWindowId, 2, { min: 0, max: 25 });
          }
          const targetIframe = iframe || iframeRefs.current[graphWindowId];
          console.log("[evidence debug iframe]", { graphWindowId, iframePassed: !!iframe, targetIframe, targetIframeCurrent: targetIframe?.current, iframeRefsKeys: Object.keys(iframeRefs.current || {}) });
        sendGraphMessageToIframe(targetIframe, messageAction, {
            id: graphWindowId,
            nodes,
            edges,
            settings: settingsToApply,
            progress: buildGraphProgressPayload(data, true),
          });
          graphProgressRenderedRef.current[graphWindowId] = true;
        } else {
          delete graphAutoRequestedRef.current[graphWindowId];
          alert(getGraphFetchErrorMessage(data));
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        delete activeGraphJobsRef.current[graphWindowId];
        delete graphProgressRenderedRef.current[graphWindowId];
        delete graphAutoRequestedRef.current[graphWindowId];
        console.error("[evidence graph request catch]", {
          graph_window_id: graphWindowId,
          trace_id: traceId,
          request_origin: requestOrigin,
          error: err,
        });
        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? { ...windowState, loadscreenState: false, loadscreenText: null }
              : windowState
          )
        );
        pushNotification({ title: "Graph Fetch Failed", message: err?.message || "An error occurred fetching the graph.", level: "error" });
      });
  };

  const requestRelationshipGraph = (windowId, payload, options = {}) => {
    const iframe = payload?.iframe || null;
    const relationship = sanitizeGraphRelationshipValue(payload?.relationship, { maxLength: 128 });
    const sourceId = String(payload?.sourceId || "").trim();
    const requestOrigin = options.requestOrigin || "manual";
    const graphWindowId = String(windowId || "").trim();

    if (!graphWindowId || !sourceId || !relationship) {
      logGraphWindowDebug("graph fetch skipped", {
        reason: "missing_required_payload",
        graph_window_id: graphWindowId,
        session_id: sourceId,
        relationship,
        request_origin: requestOrigin,
      });
      return;
    }

    const newPayload = {
      id: "relationship",
      source_id: sourceId,
      relationship,
    };

    if (graphFetchAbortControllersRef.current[graphWindowId]) {
      graphFetchAbortControllersRef.current[graphWindowId].abort();
      delete graphFetchAbortControllersRef.current[graphWindowId];
    }
    const controller = new AbortController();
    graphFetchAbortControllersRef.current[graphWindowId] = controller;
    delete graphProgressRenderedRef.current[graphWindowId];
    graphAutoRequestedRef.current[graphWindowId] = requestOrigin === "auto_relationships";

    setWindows((prev) =>
      prev.map((windowState) =>
        String(windowState.id) === graphWindowId
          ? { ...windowState, loadscreenState: true, loadscreenText: "Fetching graph..." }
          : windowState
      )
    );

    logGraphWindowDebug("graph fetch request", {
      graph_window_id: graphWindowId,
      session_id: sourceId,
      request_origin: requestOrigin,
      payload: newPayload,
    });

    const buildGraphProgressPayload = (response, complete = false) => {
      const responseResults = response?.results && typeof response.results === "object" ? response.results : {};
      const summary = responseResults?.result && typeof responseResults.result === "object" ? responseResults.result : {};
      const currentNodes = Array.isArray(responseResults.nodes) ? responseResults.nodes.length : 0;
      const currentEdges = Array.isArray(responseResults.edges) ? responseResults.edges.length : 0;
      const totalNodes = Number(summary.total_nodes);
      const totalEdges = Number(summary.total_edges);
      const total = Number.isFinite(totalNodes) && Number.isFinite(totalEdges)
        ? Math.max(1, totalNodes + totalEdges)
        : null;
      return {
        title: "Fetching graph data...",
        current: currentNodes + currentEdges,
        total,
        complete,
      };
    };

    requestGraphFetch(apiFetch, newPayload, controller.signal, {
      onQueued: (queuedData) => {
        const jobId = getQueuedJobId(queuedData);
        const status = getJobStatus(queuedData);
        if (jobId) {
          activeGraphJobsRef.current[graphWindowId] = jobId;
        }
        logGraphWindowDebug("graph fetch queued", {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          request_origin: requestOrigin,
          job_id: jobId || null,
          status: status || null,
        });
      },
      onProgress: (partialData, progressMeta) => {
        if (!graphFetchAbortControllersRef.current[graphWindowId] || graphFetchAbortControllersRef.current[graphWindowId] !== controller) return;
        const partialResults = partialData?.results || {};
        const nodes = Array.isArray(partialResults.nodes) ? partialResults.nodes : [];
        const edges = Array.isArray(partialResults.edges) ? partialResults.edges : [];
        console.log('[graph fetch progress]', {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          relationship,
          request_origin: requestOrigin,
          status: progressMeta?.status || null,
          after_event_id: progressMeta?.afterEventId ?? null,
          chunk_count: progressMeta?.chunkCount ?? null,
          node_count: nodes.length,
          edge_count: edges.length,
          data: partialData,
        });
        if (nodes.length === 0 && edges.length === 0) return;

        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? { ...windowState, loadscreenState: false, loadscreenText: null, activeGraph: 'graphs_basic', selectedContent: 'graph_content' }
              : windowState
          )
        );

        const progress = buildGraphProgressPayload(partialData, false);

        const hasRenderedGraph = graphProgressRenderedRef.current[graphWindowId] === true;
        const messageAction = hasRenderedGraph ? "graph_chunk_update" : "new_graph";
        const sourceWindowState = windowsRef.current.find((windowState) => String(windowState.id) === graphWindowId);
        const settingsToApply = normalizeGraphIframeSettings(iframeSettings[graphWindowId] || sourceWindowState?.iframeSettings);
        if (!hasRenderedGraph) {
          settingsToApply[2] = normalizeGraphLimitRange({ min: 0, max: 25 }, 25);
          updateIframeSettings(graphWindowId, 2, { min: 0, max: 25 });
        }
        const targetIframe = iframe || iframeRefs.current[graphWindowId];
        sendGraphMessageToIframe(targetIframe, messageAction, {
          id: graphWindowId,
          nodes,
          edges,
          settings: settingsToApply,
          progress,
        });
        graphProgressRenderedRef.current[graphWindowId] = true;
      }
    })
      .then((data) => {
        console.log("[graph relationship fetch received raw]", {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          relationship,
          request_origin: requestOrigin,
          data,
        });
        if (!graphFetchAbortControllersRef.current[graphWindowId] || graphFetchAbortControllersRef.current[graphWindowId] !== controller) return;
        const normalizedResults = data?.results || {};
        const nodes = Array.isArray(normalizedResults.nodes) ? normalizedResults.nodes : [];
        const edges = Array.isArray(normalizedResults.edges) ? normalizedResults.edges : [];

        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? {
                  ...windowState,
                  loadscreenState: false,
                  loadscreenText: null,
                  activeGraph: isSuccessResponse(data) ? "graphs_basic" : null,
                  selectedContent: isSuccessResponse(data) ? "graph_content" : windowState.selectedContent
                }
              : windowState
          )
        );

        logGraphWindowDebug("graph fetch response", {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          request_origin: requestOrigin,
          node_count: nodes.length,
          edge_count: edges.length,
          ok: isSuccessResponse(data),
        });

        if (isSuccessResponse(data)) {
          delete activeGraphJobsRef.current[graphWindowId];
          if (nodes.length === 0 && edges.length === 0) {
            pushNotification({ title: "Graph Empty", message: "No graph data found for this evidence.", level: "info" });
            handleCloseWindow(graphWindowId);
            return;
          }
          const hasRenderedGraph = graphProgressRenderedRef.current[graphWindowId] === true;
          const messageAction = hasRenderedGraph ? "graph_chunk_update" : "new_graph";
          const sourceWindowState = windowsRef.current.find((windowState) => String(windowState.id) === graphWindowId);
          const settingsToApply = normalizeGraphIframeSettings(iframeSettings[graphWindowId] || sourceWindowState?.iframeSettings);
          if (!hasRenderedGraph) {
            settingsToApply[2] = normalizeGraphLimitRange({ min: 0, max: 25 }, 25);
            updateIframeSettings(graphWindowId, 2, { min: 0, max: 25 });
          }
          const targetIframe = iframe || iframeRefs.current[graphWindowId];
          console.log("[evidence debug iframe]", { graphWindowId, iframePassed: !!iframe, targetIframe, targetIframeCurrent: targetIframe?.current, iframeRefsKeys: Object.keys(iframeRefs.current || {}) });
        sendGraphMessageToIframe(targetIframe, messageAction, {
            id: graphWindowId,
            nodes,
            edges,
            settings: settingsToApply,
            progress: buildGraphProgressPayload(data, true),
          });
          graphProgressRenderedRef.current[graphWindowId] = true;
        } else {
          delete graphAutoRequestedRef.current[graphWindowId];
          alert(getGraphFetchErrorMessage(data));
        }
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        delete activeGraphJobsRef.current[graphWindowId];
        delete graphProgressRenderedRef.current[graphWindowId];
        delete graphAutoRequestedRef.current[graphWindowId];
        console.error("[relationship graph request catch]", {
          graph_window_id: graphWindowId,
          session_id: sourceId,
          relationship,
          request_origin: requestOrigin,
          error: err,
        });
        setWindows((prev) =>
          prev.map((windowState) =>
            String(windowState.id) === graphWindowId
              ? { ...windowState, windowResponseI: "Connection failed!", loadscreenState: false, loadscreenText: null }
              : windowState
          )
        );
        alert(getGraphFetchErrorMessage(err, getJobFailureMessage(err, "Graph fetch failed. Please retry.")));
      })
      .finally(() => {
        if (graphFetchAbortControllersRef.current[graphWindowId] === controller) {
          delete graphFetchAbortControllersRef.current[graphWindowId];
          delete activeGraphJobsRef.current[graphWindowId];
        }
      });
  };
  const handleChartActions = (id, menuId, action, payload) => {
    console.log(6,id, menuId, action, payload)
    setWindows(prev =>
    prev.map(w => {
      if (w.id !== id) return w;
      let loadscreenState = w.loadscreenState;
      let newContent = w.selectedContent;
      let newSubContent = w.selectedSubContent;

      if(menuId === "new_instance"){
        alert("new:",id)
      }
      if(menuId === "getNetwork" && action === "components"){
        console.log(11,payload)
        const iframe = payload;
        if (iframe?.current?.contentWindow) {
          postMessageToIframe(iframe, { action: "network_components", payload: id}); // Requesting for the nodes and egdes of that specific graph (request is sent to the graph window itself), #id is the graph window id
        }
        else{
          alert(0)
        }
      }    
      if (menuId === "storeNetwork" && action === "components") {
        console.log(7);
        let iframe; // define outside
        const { id, nodes, edges } = payload; //id is chart window id
        console.log(id, nodes, edges);

        const targetWindow = windowsRef.current.find(w => w.id === String(id) || w.id === Number(id));
        if (targetWindow && targetWindow.type === "chart") {
          iframe = iframeRefs.current[targetWindow.id]; // assign here
          console.log(8, iframe);
        }

        if (iframe?.current?.contentWindow) {
          console.log(9);
          postMessageToIframe(iframe, { action: "network_components", payload: { nodes, edges } });
        } else {
          console.log(10, iframe?.current);
        }
      }    
      if (menuId === "updateNetwork" && action === "selection") {
        console.log(24);
        const {id, nodes: selectedNodes = [], edges: selectedEdges = [] } = payload;
        const targetWindow = windowsRef.current.find(w => w.id === String(id) || w.id === Number(id));
        if (targetWindow && targetWindow.type === "graph") {
          //Identify all the windows linked to the received window id
          const linkedCharts = windowsRef.current.filter(
            w => w.type === "chart" && (w.chartLink === id || w.chartLink === String(id))
          );
          console.log(26,selectedNodes,selectedEdges,payload);
          if(linkedCharts.length>0){
            //loop over them and send updates
            linkedCharts.forEach(chartWindow => {
              const chartIframeRef = iframeRefs.current[chartWindow.id];
              if (chartIframeRef?.current) {
                // Example: send message or trigger chart update
                postMessageToIframe(chartIframeRef, { action: "updateSelection", payload:{selectedNodes, selectedEdges} });
              }
            });
          }            
        }
        else {
          console.log(25);
        }
      }               
    return { ...w
        }
      })
    )
  }
  const clearLinkedGraphStatusForSession = (sessionId, reason = "source_status_cleared") => {
    const sessionKey = String(sessionId || "").trim();
    if (!sessionKey) return;

    const clearedPayload = {
      session_id: sessionKey,
      analysisSessionId: sessionKey,
      status: "terminated",
      relationship_labels: [],
      total_relationships: 0,
      summary: {
        total_relationships: 0,
      },
    };

    delete graphInfoPayloadBySessionRef.current[sessionKey];
    Object.keys(graphAutoRequestedRef.current).forEach((windowId) => {
      const linkedWindow = windowsRef.current.find((windowState) => String(windowState.id) === String(windowId));
      if (String(linkedWindow?.graphLinkSource || "") === sessionKey) {
        delete graphAutoRequestedRef.current[windowId];
      }
    });
    graphStatusSubscribedSessionsRef.current.delete(sessionKey);
    graphStatusRef.current = {
      ...graphStatusRef.current,
      [sessionKey]: {
        status: clearedPayload,
        relationships: [],
      },
    };

    setGraphStatus((prev) => ({
      ...prev,
      [sessionKey]: {
        status: clearedPayload,
        relationships: [],
      },
    }));

    setWindows((prev) => prev.map((w) => {
      if (String(w.graphLinkSource || "") !== sessionKey) return w;
      const iframe = iframeRefs.current[w.id];
      postMessageToIframe(iframe, { action: "informations", payload: clearedPayload });
      return {
        ...w,
        graphLink: false,
        graphLinkSource: null,
        sessionId: null,
        graphStatus: [],
        nodeProperties: null,
        filterPropertyKeys: null,
        filterResults: null,
        selectedNodes: [],
        selectedEdges: [],
      };
    }));

    console.log("[graph status cleared for terminated source]", { session_id: sessionKey, reason });
  };

  const handleGraphActions = (id, menuId, action, payload, options = {}) => {
    console.log("GraphAction:", id, menuId, action, payload);
    if (isWorkspaceLocked) {
      notifyLockedSensitiveAction("graph actions");
      return;
    }
    if (menuId === "get_graph" && !requirePermission(PERMISSIONS.GRAPH_READ, "graph data")) return;

    // Debounce wrapper for actions that need delay
    runScopedDebounce(graphActionDebounceRef, `${id}_${menuId}`, () => {
      setWindows(prev =>
        prev.map(w => {
          if (w.id !== id) return w;

          const iframe = payload?.iframe || null;
          const updates = {};

          // ------------------ Graph generation ------------------
          if (menuId === "get_graph" && action === "relationship") {
            requestRelationshipGraph(id, payload, { requestOrigin: "manual" });
            updates.loadscreenState = true;
            updates.loadscreenText = "Fetching graph...";
          }
          if (menuId === "get_graph" && action === "evidence") {
            requestEvidenceGraph(id, payload, { requestOrigin: "manual", ...options });
            if (!options.initialData) {
              updates.loadscreenState = true;
              updates.loadscreenText = "Fetching evidence graph...";
            }
          }

          // ------------------ Property tabs ------------------
          if (menuId === "properties_tab") {
            if (action === "switch_tab") {
              updates.selectedPropertyTab = payload;
            }
            if (action === "settings") { // When Graph settings change
              const performanceManagedSettings = new Set(["weight_edges", "show_title", "show_label", "graph_physics"]);

              if (payload.settings === "performance_mode") {
                const isEnabled = payload.state === true || payload.state === "true";
                setIframePerformanceMood(prev => ({
                  ...prev,
                  [id]: isEnabled
                }));

                if (isEnabled) {
                  const performanceUpdates = [
                    { index: 5, setting: "weight_edges", value: "" },
                    { index: 6, setting: "show_title", value: false },
                    { index: 7, setting: "show_label", value: false },
                    { index: 9, setting: "graph_physics", value: false },
                  ];

                  performanceUpdates.forEach(({ index, setting, value }) => {
                    updateIframeSettings(id, index, value);
                    sendGraphMessageToIframe(iframe, setting, value);
                  });
                }
                return { ...w, ...updates };
              }

              const settingsMap = {
                limit_nodes_key: [0, "key"],
                limit_nodes_sort: [1, "sort"],
                limit_nodes_amount: [2, "amount"],
                label_nodes_group: [3, null] , 
                label_nodes_by: [4, null],
                weight_edges: [5, null],
                show_title: [6, null],
                show_label: [7, null],
                edit_infos: [8, null],
                graph_physics: [9, null],
                layout_type: [10, null],
                layout_direction: [11, null],
                sort_method: [12, null],
                layer_mode: [13, null],
                layer_key: [14, null],
              };
              // Organizing settings (to have a concurent/ Multi settings for batch)
              const [index, key] = settingsMap[payload.settings] || [];
              const normalizedSettingState = payload.settings === "layout_type" && payload.state === "default"
                ? "concentric"
                : payload.state;
              if (index !== undefined) { // If setting really exists 
                console.log("passing_setting_update_state:",id, index, key,payload.state)
                updateIframeSettings(id, index, key ? normalizedSettingState[key] : normalizedSettingState);
                // Concurrent settings
                //------------------ Labe nodes by
                if (payload.settings === "label_nodes_by") {//Changing a lable by always activates the show label
                  updateIframeSettings(id, 7, true);
                  updateIframeSettings(id, 4, payload.state.labelkey)
                }
                //------------------ Layout type
                if (payload.settings === "layout_type" && normalizedSettingState === "hierarchical") {
                  updateIframeSettings(id, 11, "UD");
                  updateIframeSettings(id, 12, "directed");
                }
                if (payload.settings === "layout_type" && normalizedSettingState === "layered") {
                  const existingSettings = normalizeGraphIframeSettings(iframeSettings[id] || w.iframeSettings);
                  updateIframeSettings(id, 11, existingSettings[11] || "UD");
                  updateIframeSettings(id, 13, existingSettings[13] || "hop_distance");
                  updateIframeSettings(id, 14, existingSettings[14] || "");
                }
              }
              if (performanceManagedSettings.has(payload.settings)) {
                setIframePerformanceMood(prev => ({
                  ...prev,
                  [id]: false
                }));
              }
              //Pass the setting change to the child iframe
              sendGraphMessageToIframe(iframe, payload.settings, normalizedSettingState);
}
            if (action === "search") {
              const { option, keyword, keys, settings } = payload;
              sendGraphMessageToIframe(iframe, "graph_search", { id, option, keyword, keys, settings });
            }
            if (action === "search_change") {
              const { componentId, value } = payload;   
              console.log("here1:",componentId,value)           
              console.log("here2:",id,componentId,value)
              setIframeSearch(prev => {
                const prevSearch = Array.isArray(prev[id]) ? prev[id] : ["", false, {}, { nodes: 0, edges: 0 }];
                const nextSearch = [...prevSearch];

                if (componentId === 2) {
                  const prevObj = prevSearch[2] && typeof prevSearch[2] === "object" ? prevSearch[2] : {};
                  const nextObj = value === "__reset__" ? {} : { ...prevObj };
                  if (value !== "__reset__") {
                    if (nextObj[value]) delete nextObj[value];
                    else nextObj[value] = true;
                  }
                  nextSearch[2] = nextObj;
                } else if (componentId === 1) {
                  nextSearch[1] = !!value;
                } else if (componentId === 0) {
                  nextSearch[0] = value;
                } else if (componentId === 3) {
                  nextSearch[3] = value;
                }

                return {
                  ...prev,
                  [id]: nextSearch
                };
              });
            }
            if (action === "filter_keys" && payload.filter === "all_property_keys") {
              sendGraphMessageToIframe(iframe, "all_property_keys", { id });
            }            
          }

          // ------------------ Iframe options ------------------
          if (menuId === "iframe_options" && action === "settings") {
            const nextAction = payload?.settings || "fit_graph";
            const allowedActions = new Set(["fit_graph", "undo_graph", "redo_graph"]);
            if (allowedActions.has(nextAction)) {
              sendGraphMessageToIframe(iframe, nextAction, nextAction);
            }
          }

          return { ...w, ...updates };
        })
      );
    }, 300); // debounce delay
  };

  // --- Basic Windows actions ---
  const handleWindowActions = (id, menuId, action, payload, options = {}) => {
    const requiredPermission = getWindowActionPermission(menuId, action);
    if (requiredPermission && !requirePermission(requiredPermission, menuId)) return;
    //console.log("id:",id," Menuid:", menuId," action:", action," payload:", payload)
    // --- Handling sidebar menus
    if (!options?.skipSideBarToggle && menuId !== "cancel_graph_staging") {
      setIsSideBarMenuOpen(prev => prev === menuId ? null : menuId); // Toggle open/close
    }
    // --------------------------
    setWindows(prev =>
      prev.map(w => {
        if (w.id !== id) return w;
        let loadscreenState = w.loadscreenState;
        let newContent = w.selectedContent;
        let newSubContent = w.selectedSubContent;
        let newBatchSearchResult = w.batchFilesSearchResults;
        let newBatchFilesCollection = w.batchFilesCollection || []; // Makes Ensure selectedFiles is initialized
        let windowResponseI = w.windowResponseI 
        let windowRealtimeResponseI = w.windowRealtimeResponseI 
        let formRealtimeToolResponse = w.formRealtimeToolResponse 
        const sourceWorkflowContent = payload?.mode === "realtime" || w.selectedContent === "real_time_input" ? "real_time_input" : "batch_input";
        const sourceWorkflowReadyResponse = sourceWorkflowContent === "real_time_input"
          ? "Connection established!"
          : w.windowResponseI === "Dataset uploaded!"
            ? "Dataset uploaded!"
            : "Connection established!";
        if (menuId === "cancel_graph_staging") {
          const controller = graphFetchAbortControllersRef.current[id];
          if (controller) {
            controller.abort();
            delete graphFetchAbortControllersRef.current[id];
          }
          return { ...w, loadscreenState: false, loadscreenText: null };
        }
        // ------------------------------------------------------------------- Source window contents handling
        if (menuId === "live_source_options") {
          newContent = "live_source_options"; // This will show live source UI
        }
        if (menuId === "upload_source_options") {
          newContent = "upload_source_options"; // This will show upload source UI
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, fileInputRef:fileInputRef} : w
            )
          );
        }
        if (menuId === "upload_source_files") {
          // Set new timeout for debounce
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            const newLoadscreenText="Uploading Dataset "
            setloadscreenState(true)
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w,loadscreenState: true,loadscreenText:newLoadscreenText} : w
              )
            );
            const uploadedFiles = Array.from(payload?.files || []);
            const invalidFiles = [];
            const oversizedFiles = [];
            const validFiles = [];
            const sessionId = id //That specific source window id
            const totalUploadBytes = uploadedFiles.reduce((sum, file) => sum + Number(file?.size || 0), 0);
            for (const file of uploadedFiles) {
              const fileName = String(file?.name || "").toLowerCase();
              const isValid = UPLOAD_ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
              if (!isValid) {
                invalidFiles.push(file.name);
                continue;
              }
              if (Number(file?.size || 0) > MAX_UPLOAD_BYTES) {
                oversizedFiles.push(file.name);
                continue;
              }
              validFiles.push(file);
            }
            const uploadValidationMessages = [];
            if (uploadedFiles.length > MAX_UPLOAD_FILE_COUNT) {
              uploadValidationMessages.push(`Select up to ${MAX_UPLOAD_FILE_COUNT} files per upload.`);
            }
            if (totalUploadBytes > MAX_UPLOAD_TOTAL_BYTES) {
              uploadValidationMessages.push(`The selected files are too large for one upload.`);
            }
            if (invalidFiles.length > 0) {
              uploadValidationMessages.push(`Unsupported file types:\n${invalidFiles.join("\n")}`);
            }
            if (oversizedFiles.length > 0) {
              uploadValidationMessages.push(`Files exceed the upload size limit:\n${oversizedFiles.join("\n")}`);
            }
            if (validFiles.length === 0 && uploadValidationMessages.length === 0) {
              uploadValidationMessages.push("Choose at least one dataset file to upload.");
            }
            if (uploadValidationMessages.length > 0) {
              alert(`Upload blocked:\n\n${uploadValidationMessages.join("\n\n")}\n\nAllowed types: CSV, JSON, Parquet, XLSX.`);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w,loadscreenState: false ,loadscreenText:null} : w
                )
              );
            }
            else{// Proceed with the uploading
              //Passing files
              const formData = new FormData();
              for (let i = 0; i < validFiles.length; i++) {
                formData.append("file", validFiles[i]);
              }   
              formData.append("session_id",sessionId)
              apiFetch("/upload_batch_files", {
                method: "POST",
                body: formData,
              })
              .then((data) => {
                if (isSuccessResponse(data)) {
                  alert("Dataset uploaded!")
                  //calling the tool integration
                  newContent = "batch_input";
                  newSubContent = "batch_input_form_pageI";
                  newBatchFilesCollection = validFiles.map(file => file.name);
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id ? { ...w,loadscreenState: false ,loadscreenText:null,selectedContent:newContent,selectedSubContent:newSubContent,windowResponseI:"Dataset uploaded!",sourceKind:SOURCE_KINDS.UPLOAD,sourceStatus:SOURCE_STATUSES.UPLOADED,sourceStep:SOURCE_FLOW_STEPS.CONNECT,batchFilesCollection:newBatchFilesCollection} : w
                    )
                  );
                  setTimeout(() => handleWindowActions(id, "upload_form", "auto_connect"), 50);
                } 
                else {
                  alert(getConfigurationErrorMessage(data))
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id ? { ...w,loadscreenState: false ,loadscreenText:null} : w
                    )
                  );
                }
              })
              .catch((err) => {
                console.error("err",err);
                setWindows(prev =>
                  prev.map(w =>
                    w.id === id ? { ...w,loadscreenState: false ,loadscreenText:null} : w
                  )
                );
              });
            } 
          }, 300); // debounce delay
        }
        if (menuId === "live_source_options_passive" && action === "update") {
          newContent = "live_source_options";
        }
        if (menuId === "real_time_input" && action === "update") {
          newContent = "real_time_input";
          newSubContent = "real_time_input_form_pageI";
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w,loadscreenState: false,loadscreenText:null,selectedContent:newContent,selectedSubContent:newSubContent,windowRealtimeResponseI:windowRealtimeResponseI,formRealtimeToolResponse:formRealtimeToolResponse} : w
            )
          );
        }
        if (menuId === "batch_input" && action === "update") {
          newContent = "batch_input";
          newSubContent = "batch_input_form_pageI";
          const isSwitchingFromRealtime = w.selectedContent === "real_time_input";
          const sourceAutofillDefaults = getSourceWindowAutofillDefaults(configurations);

          if (isSwitchingFromRealtime) {
            return {
              ...w,
              loadscreenState: false,
              loadscreenText: null,
              selectedContent: newContent,
              selectedSubContent: newSubContent,
              windowResponseI: null,
              formToolResponse: null,
              sourceKind: sourceAutofillDefaults.sourceAddressType || SOURCE_KINDS.BROKER,
              sourceStatus: SOURCE_STATUSES.IDLE,
              toolStatus: TOOL_STATUSES.IDLE,
              dataframeStatus: DATAFRAME_STATUSES.NONE,
              streamStatus: STREAM_STATUSES.IDLE,
              sourceStep: SOURCE_FLOW_STEPS.CONNECT,
              sourceAddressType: sourceAutofillDefaults.sourceAddressType,
              sourceAddressText: sourceAutofillDefaults.sourceAddressText,
              sourceStorageText: sourceAutofillDefaults.sourceStorageText,
              sourceTopicText: sourceAutofillDefaults.sourceTopicText,
              toolUrl: sourceAutofillDefaults.toolUrl,
              toolUsername: sourceAutofillDefaults.toolUsername,
              toolPassword: sourceAutofillDefaults.toolPassword,
              toolPasswordRef: sourceAutofillDefaults.toolPasswordRef,
              toolDatabase: sourceAutofillDefaults.toolDatabase,
              batchFilesCollection: [],
              batchFilesSearchResults: null,
              batchFilesSearchMoreFiles: true,
              searchResultsVisible: null,
              searchPlaceholder: "",
              batchFilesDataframeInfoI: null,
              batchFilesDataframeInfoII: null,
              batchFilesDataframeActionValue: null,
              batchFilesDataframeSourceValue: null,
              batchFilesDataframeTargetValue: null,
              batchFilesDataframeRelationshipValue: null,
              batchFilesDataframeRuleValue: null,
            };
          }

          //setting page for batch (default)
          if (windowResponseI === "Dataset uploaded!"){
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w,loadscreenState: false ,loadscreenText:null,selectedContent:newContent,selectedSubContent:newSubContent,windowResponseI:null,batchFilesCollection:newBatchFilesCollection} : w
              )
            );
          }
          else{
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w,loadscreenState: false ,loadscreenText:null,selectedContent:newContent,selectedSubContent:newSubContent,windowResponseI:windowResponseI,batchFilesCollection:newBatchFilesCollection} : w
              )
            );
          }        
        }
        if (menuId === "batch_input_form_address" && action === "change" && payload) {
          console.log("address_change:",payload);
          //setSourceAddressType(payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceAddressType: payload, sourceKind: payload } : w
            )
          );
        }
        if (menuId === "source_input_address_text" && action === "change") {
          console.log("address_change:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceAddressText: sanitizeConnectionValue(payload, { maxLength: 300 }) } : w
            )
          );
        }
        if (menuId === "source_storage_address_text" && action === "change") {
          console.log("storage_change:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceStorageText: sanitizeConnectionValue(payload, { maxLength: 300 }) } : w
            )
          );
        }
        if (menuId === "source_topic_text" && action === "change") {
          console.log("topic_change:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceTopicText: sanitizeKafkaTopic(payload) } : w
            )
          );
        }
        if (menuId === "real_time_input_form_address" && action === "change" && payload) {
          console.log("address_change:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceRealtimeAddressType: payload, realtimeStartGuardMessage: null } : w
            )
          );
        }
        if (menuId === "real_time_source_address_text" && action === "change") {
          console.log("address_change:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceRealtimeAddressText: sanitizeConnectionValue(payload, { maxLength: 300 }), realtimeStartGuardMessage: null } : w
            )
          );
        }
        if (menuId === "real_time_source_topic_text" && action === "change") {
          console.log("topic_change:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceRealtimeTopicText: sanitizeKafkaTopic(payload), realtimeStartGuardMessage: null } : w
            )
          );
        }
        const toolFieldMap = {
          tool_url: ["toolUrl", (value) => sanitizeConnectionValue(value, { maxLength: 300 })],
          tool_username: ["toolUsername", (value) => sanitizeIdentifier(value, { maxLength: 120 })],
          tool_password: ["toolPassword", (value) => sanitizeSecret(value, { maxLength: 256 })],
          tool_database: ["toolDatabase", (value) => sanitizeIdentifier(value, { maxLength: 120 })],
          realtime_tool_url: ["realtimeToolUrl", (value) => sanitizeConnectionValue(value, { maxLength: 300 })],
          realtime_tool_username: ["realtimeToolUsername", (value) => sanitizeIdentifier(value, { maxLength: 120 })],
          realtime_tool_password: ["realtimeToolPassword", (value) => sanitizeSecret(value, { maxLength: 256 })],
          realtime_tool_database: ["realtimeToolDatabase", (value) => sanitizeIdentifier(value, { maxLength: 120 })],
        };
        if (action === "change" && toolFieldMap[menuId]) {
          const [fieldName, normalizeValue] = toolFieldMap[menuId];
          const isRealtimeToolField = fieldName.startsWith("realtimeTool");
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? {
                ...w,
                [fieldName]: normalizeValue(payload),
                ...(fieldName === "toolPassword" ? {
                  toolPasswordRef: CONFIG_SECRET_MASK_PATTERN.test(String(normalizeValue(payload) || "").trim()) ? w.toolPasswordRef : "",
                } : {}),
                ...(isRealtimeToolField ? {
                  realtimeNeo4jConnectedSessionId: null,
                  realtimeConfigPersistStatus: "idle",
                  realtimeConfigPersistedSessionId: null,
                  realtimeConfigPersistMessage: null,
                  realtimeStartGuardMessage: null,
                  realtimeLastConnectSessionId: null,
                  ...(fieldName === "realtimeToolPassword" ? {
                    realtimeToolPasswordRef: CONFIG_SECRET_MASK_PATTERN.test(String(normalizeValue(payload) || "").trim()) ? w.realtimeToolPasswordRef : "",
                  } : {}),
                } : {}),
              } : w
            )
          );
        }
        if (menuId === "real_time_input_form" && action === "connect" && payload) {
          const sourceValidation = validateSchema(payload, sourceConnectionSchema);
          if (!sourceValidation.ok) {
            return { ...w, windowRealtimeResponseI: sourceValidation.message || "Connection details are invalid." };
          }
          const connectPayload = { ...payload, ...sourceValidation.value, session_id: normalizeSessionId(id) };
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? {
                ...w,
                windowRealtimeResponseI: "Connecting...",
                realtimeStartGuardMessage: null,
              } : w
            )
          );
          apiFetch("/connect_to_source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(connectPayload),
          })
          .then((data) => {
            const backendMessage = getConnectSourceErrorMessage(data, data?.message || "Connection failed!");
            console.warn("[connect_to_source backend message]", backendMessage);
            console.warn("[connect_to_source backend response]", {
              source_window_id: id,
              menu_id: menuId,
              address_type: connectPayload?.addressType,
              backend_message: backendMessage,
              response: data,
            });
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, windowRealtimeResponseI: backendMessage, realtimeStartGuardMessage: isSuccessResponse(data) ? null : (backendMessage || w.realtimeStartGuardMessage) } : w
              )
            );
          })
          .catch((err) => {
            const backendMessage = getConnectSourceErrorMessage(err);
            console.error("[connect_to_source backend message]", backendMessage);
            console.error("[connect_to_source backend error]", {
              source_window_id: id,
              menu_id: menuId,
              address_type: connectPayload?.addressType,
              backend_message: backendMessage,
              status: err?.status,
              data: err?.data,
              error: err,
            });
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, windowRealtimeResponseI: backendMessage } : w
              )
            );
          });
        }
        if (menuId === "real_time_input_form" && action === "disconnect" && payload) {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? {
                ...w,
                windowRealtimeResponseI: "Disconnecting...",
                realtimeNeo4jConnectedSessionId: null,
                realtimeConfigPersistStatus: "idle",
                realtimeConfigPersistedSessionId: null,
                realtimeConfigPersistMessage: null,
                realtimeStartGuardMessage: null,
                realtimeLastConnectSessionId: null,
              } : w
            )
          );
          const disconnectPayload = {
            ...payload,
            broker: payload?.broker ?? payload?.address ?? "",
            hdfs: payload?.hdfs ?? payload?.storage ?? "",
            session_id: normalizeSessionId(id),
          };
          apiFetch("/disconnect_source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(disconnectPayload),
          })
            .then((data) => {
              const failed = String(data?.status || "").toLowerCase() === "error";
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, windowRealtimeResponseI: failed ? getDisconnectSourceErrorMessage(data) : data.message } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, windowRealtimeResponseI: getDisconnectSourceErrorMessage(err) } : w
                )
              );
            });
        }
        if (menuId === "real_time_tool_integration_form" && action === "connect" && payload) {
          const toolValidation = validateSchema(payload, toolConnectionSchema);
          if (!toolValidation.ok) {
            return { ...w, formRealtimeToolResponse: toolValidation.message || "Tool connection details are invalid." };
          }
          const sessionKey = normalizeSessionId(id);
          const connectPayloadResult = buildConnectToToolPayload({
            payload,
            validatedValues: toolValidation.value,
            sessionKey,
            passwordRef: w.realtimeToolPasswordRef,
          });
          if (!connectPayloadResult.ok) {
            return { ...w, formRealtimeToolResponse: connectPayloadResult.message, realtimeStartGuardMessage: connectPayloadResult.message };
          }
          const toolPayload = connectPayloadResult.payload;
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? {
                ...w,
                formRealtimeToolResponse: "Connecting...",
                realtimeToolPassword: CONFIG_SECRET_MASK_PATTERN.test(String(toolPayload.password || "").trim()) ? "***" : "",
                realtimeToolPasswordRef: normalizeSecretRefValue(toolPayload.password_ref || w.realtimeToolPasswordRef),
                realtimeNeo4jConnectedSessionId: null,
                realtimeConfigPersistStatus: "idle",
                realtimeConfigPersistedSessionId: null,
                realtimeConfigPersistMessage: null,
                realtimeStartGuardMessage: null,
                realtimeLastConnectSessionId: sessionKey,
              } : w
            )
          );
          if (CLIENT_DEV_LOGS_ENABLED) {
            console.info("[realtime tool connect]", {
              session_id: sessionKey,
              source_id: toolPayload.source_id,
              matches: sessionKey === String(toolPayload.source_id || "") && sessionKey === String(toolPayload.session_id || ""),
            });
            logConnectToToolRequest(toolPayload);
          }
          apiFetch("/connect_to_tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toolPayload),
          })
            .then((data) => {
              const connected = toolStatusFromResponse(data?.message) === TOOL_STATUSES.CONNECTED;
              const failureMessage = getConnectToolErrorMessage(data);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? {
                    ...w,
                    formRealtimeToolResponse: connected ? data.message : failureMessage,
                    realtimeToolPassword: connected && normalizeSecretRefValue(w.realtimeToolPasswordRef || toolPayload.password_ref) ? "***" : w.realtimeToolPassword,
                    realtimeToolPasswordRef: connected ? normalizeSecretRefValue(w.realtimeToolPasswordRef || toolPayload.password_ref) : w.realtimeToolPasswordRef,
                    realtimeNeo4jConnectedSessionId: connected ? sessionKey : null,
                    realtimeStartGuardMessage: connected ? null : failureMessage,
                  } : w
                )
              );
              if (connected) {
                persistRealtimeToolConfigurationForWindow(sessionKey).then((persistResult) => {
                  if (!persistResult.ok) {
                    console.warn("[realtime config save failed]", {
                      session_id: sessionKey,
                      message: persistResult.message,
                    });
                  }
                });
              }
            })
            .catch((err) => {
              console.error("[realtime connect_to_tool failed]", {
                message: err?.message,
                status: err?.status,
                data: err?.data,
                error: err,
              });
              const backendMessage = getConnectToolErrorMessage(
                err,
                "Neo4j connection failed for this session."
              );
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formRealtimeToolResponse: backendMessage, realtimeStartGuardMessage: backendMessage } : w
                )
              );
            });
        }
        if (menuId === "real_time_tool_integration_form" && action === "disconnect" && payload) {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? {
                ...w,
                formRealtimeToolResponse: "Disconnecting...",
                realtimeNeo4jConnectedSessionId: null,
                realtimeConfigPersistStatus: "idle",
                realtimeConfigPersistedSessionId: null,
                realtimeConfigPersistMessage: null,
                realtimeStartGuardMessage: null,
              } : w
            )
          );
          apiFetch("/disconnect_tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, source_id: normalizeSessionId(id), session_id: normalizeSessionId(id) }),
          })
            .then((data) => {
              const failed = String(data?.status || "").toLowerCase() === "error";
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formRealtimeToolResponse: failed ? getDisconnectToolErrorMessage(data) : data.message } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formRealtimeToolResponse: getDisconnectToolErrorMessage(err) } : w
                )
              );
            });
        }
        if (menuId === "batch_input_form" && action === "connect" && payload) {
          const sourceValidation = validateSchema(payload, sourceConnectionSchema);
          if (!sourceValidation.ok) {
            return { ...w, windowResponseI: sourceValidation.message || "Connection details are invalid.", sourceStatus: SOURCE_STATUSES.FAILED };
          }
          const connectPayload = { ...payload, ...sourceValidation.value, session_id: normalizeSessionId(id) };
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, windowResponseI: "Connecting...", sourceStatus: SOURCE_STATUSES.CONNECTING, sourceKind: connectPayload?.addressType || w.sourceAddressType || SOURCE_KINDS.BROKER } : w
            )
          );
          
          apiFetch("/connect_to_source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(connectPayload),
          })
          .then((data) => {            
            const backendMessage = getConnectSourceErrorMessage(data, data?.message || "Connection failed!");
            console.warn("[connect_to_source backend message]", backendMessage);
            console.warn("[connect_to_source backend response]", {
              source_window_id: id,
              menu_id: menuId,
              address_type: connectPayload?.addressType,
              backend_message: backendMessage,
              response: data,
            });
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, windowResponseI: backendMessage, sourceStatus: sourceStatusFromResponse(backendMessage), sourceKind: connectPayload?.addressType || w.sourceKind || w.sourceAddressType || SOURCE_KINDS.BROKER } : w
              )
            );
          })
          .catch((err) => {          
            const backendMessage = getConnectSourceErrorMessage(err);
            console.error("[connect_to_source backend error]", {
              source_window_id: id,
              menu_id: menuId,
              address_type: connectPayload?.addressType,
              backend_message: backendMessage,
              status: err?.status,
              data: err?.data,
              error: err,
            });
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, windowResponseI: backendMessage, sourceStatus: SOURCE_STATUSES.FAILED } : w
              )
            );
          });        
        }
        if (menuId === "batch_input_form" && action === "disconnect" && payload) {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, windowResponseI: "Disconnecting...", sourceStatus: SOURCE_STATUSES.DISCONNECTING } : w
            )
          );
          apiFetch("/disconnect_source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
            .then((data) => {
              const failed = String(data?.status || "").toLowerCase() === "error";
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, windowResponseI: failed ? getDisconnectSourceErrorMessage(data) : data.message, sourceStatus: failed ? SOURCE_STATUSES.FAILED : sourceStatusFromResponse(data.message) } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, windowResponseI: getDisconnectSourceErrorMessage(err), sourceStatus: SOURCE_STATUSES.FAILED } : w
                )
              );
            });        
        }
        if (menuId === "tool_integration_form" && action === "connect" && payload) {
          const toolValidation = validateSchema(payload, toolConnectionSchema);
          if (!toolValidation.ok) {
            return { ...w, formToolResponse: toolValidation.message || "Tool connection details are invalid.", toolStatus: TOOL_STATUSES.FAILED };
          }
          const sessionKey = normalizeSessionId(id);
          const connectPayloadResult = buildConnectToToolPayload({
            payload,
            validatedValues: toolValidation.value,
            sessionKey,
            passwordRef: w.toolPasswordRef,
          });
          if (!connectPayloadResult.ok) {
            return { ...w, formToolResponse: connectPayloadResult.message, toolStatus: TOOL_STATUSES.FAILED };
          }
          const toolPayload = connectPayloadResult.payload;
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, formToolResponse: "Connecting...", toolStatus: TOOL_STATUSES.CONNECTING, toolPassword: CONFIG_SECRET_MASK_PATTERN.test(String(toolPayload.password || "").trim()) ? "***" : "", toolPasswordRef: normalizeSecretRefValue(toolPayload.password_ref || w.toolPasswordRef) } : w
            )
          );
          if (CLIENT_DEV_LOGS_ENABLED) {
            logConnectToToolRequest(toolPayload);
          }
          apiFetch("/connect_to_tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(toolPayload),
          })
            .then((data) => {              
              const connected = toolStatusFromResponse(data?.message) === TOOL_STATUSES.CONNECTED;
              const failureMessage = getConnectToolErrorMessage(data);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formToolResponse: connected ? data.message : failureMessage, toolStatus: toolStatusFromResponse(data.message), toolPassword: connected && normalizeSecretRefValue(w.toolPasswordRef || toolPayload.password_ref) ? "***" : w.toolPassword, toolPasswordRef: connected ? normalizeSecretRefValue(w.toolPasswordRef || toolPayload.password_ref) : w.toolPasswordRef } : w
                )
              );
            })
            .catch((err) => {
              console.error("[connect_to_tool failed]", {
                message: err?.message,
                status: err?.status,
                data: err?.data,
                error: err,
              });
              const backendMessage = getConnectToolErrorMessage(
                err,
                "Could not connect to Neo4j. Check the connection details and try again."
              );
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formToolResponse: backendMessage, toolStatus: TOOL_STATUSES.FAILED } : w
                )
              );
            });        
        }
        if (menuId === "tool_integration_form" && action === "disconnect" && payload) {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, formToolResponse: "Disconnecting...", toolStatus: TOOL_STATUSES.DISCONNECTING } : w
            )
          );
          apiFetch("/disconnect_tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, source_id: normalizeSessionId(id), session_id: normalizeSessionId(id) }),
          })
            .then((data) => {              
              const failed = String(data?.status || "").toLowerCase() === "error";
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formToolResponse: failed ? getDisconnectToolErrorMessage(data) : data.message, toolStatus: failed ? TOOL_STATUSES.FAILED : toolStatusFromResponse(data.message) } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formToolResponse: getDisconnectToolErrorMessage(err), toolStatus: TOOL_STATUSES.FAILED } : w
                )
              );
            });        
        }
        if ((menuId === "batch_input_form" || menuId === "real_time_input_form") && action === "auto_connect") {
            const mode = menuId === "batch_input_form" ? "batch" : "realtime";
            const sourceAutofillDefaults = getSourceWindowAutofillDefaults(configurations);
            const sessionKey = normalizeSessionId(id);
            
            const sourcePayload = {
               addressType: mode === "batch" ? "storage" : "broker",
               address: mode === "batch" ? sourceAutofillDefaults.sourceAddressText : sourceAutofillDefaults.sourceRealtimeAddressText,
               broker: mode === "batch" ? sourceAutofillDefaults.sourceAddressText : sourceAutofillDefaults.sourceRealtimeAddressText,
               storage: sourceAutofillDefaults.sourceStorageText,
               hdfs: sourceAutofillDefaults.sourceStorageText,
               topic: mode === "batch" ? sourceAutofillDefaults.sourceTopicText : sourceAutofillDefaults.sourceRealtimeTopicText,
               mode: mode,
               session_id: sessionKey
            };
            
            const sourceValidation = validateSchema(sourcePayload, sourceConnectionSchema);
            const connectSourcePayload = sourceValidation.ok 
                ? { ...sourcePayload, ...sourceValidation.value, session_id: sessionKey }
                : sourcePayload;
            
            const initialToolPayload = {
               tool_name: 'neo4j',
               url: mode === "batch" ? sourceAutofillDefaults.toolUrl : sourceAutofillDefaults.realtimeToolUrl,
               username: mode === "batch" ? sourceAutofillDefaults.toolUsername : sourceAutofillDefaults.realtimeToolUsername,
               password: mode === "batch" ? sourceAutofillDefaults.toolPassword : sourceAutofillDefaults.realtimeToolPassword,
               database: mode === "batch" ? sourceAutofillDefaults.toolDatabase : sourceAutofillDefaults.realtimeToolDatabase,
               source_id: sessionKey
            };
            
            const passwordRef = mode === "batch" ? sourceAutofillDefaults.toolPasswordRef : sourceAutofillDefaults.realtimeToolPasswordRef;
            const connectPayloadResult = buildConnectToToolPayload({
               payload: initialToolPayload,
               validatedValues: initialToolPayload,
               sessionKey: sessionKey,
               passwordRef: passwordRef
            });
            
            const toolPayload = connectPayloadResult.ok ? connectPayloadResult.payload : initialToolPayload;

            setWindows(prev => prev.map(win => win.id === id ? {
               ...win,
               sourceStatus: SOURCE_STATUSES.CONNECTING,
               toolStatus: TOOL_STATUSES.CONNECTING,
               ...(mode === "realtime" ? {
                   windowRealtimeResponseI: "Connecting...",
                   formRealtimeToolResponse: "Connecting..."
               } : {
                   windowResponseI: "Connecting...",
                   formToolResponse: "Connecting..."
               })
            } : win));

            Promise.all([
               apiFetch("/connect_to_source", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(connectSourcePayload) }).catch(err => err),
               apiFetch("/connect_to_tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toolPayload) }).catch(err => err)
            ]).then(([sourceData, toolData]) => {
               const sourceBackendMsg = getConnectSourceErrorMessage(sourceData, sourceData?.message || "Connection failed!");
               const isSourceSuccess = isSuccessResponse(sourceData) || sourceBackendMsg.includes("successful") || sourceBackendMsg.includes("established");
               
               const toolBackendMsg = getConnectToolErrorMessage(toolData, toolData?.message || "Connection failed!");
               const isToolSuccess = toolStatusFromResponse(toolData?.message) === TOOL_STATUSES.CONNECTED;

               if (isSourceSuccess && isToolSuccess) {
                  handleWindowActions(id, "batch_input_form_swap", "page_II", { addressType: sourcePayload.addressType, address: sourcePayload.address, topic: sourcePayload.topic, mode }, { skipSideBarToggle: true });
                  
                  setWindows(prev => prev.map(win => win.id === id ? {
                     ...win,
                     ...(mode === "realtime" ? {
                         windowRealtimeResponseI: "Connection established!",
                         formRealtimeToolResponse: "Connected!",
                         realtimeNeo4jConnectedSessionId: id,
                         realtimeLastConnectSessionId: id,
                         realtimeConfigPersistStatus: "saved",
                         realtimeConfigPersistedSessionId: id,
                         realtimeConfigPersistMessage: "Auto-connected from saved configuration."
                     } : {
                         windowResponseI: sourceBackendMsg,
                         formToolResponse: toolData?.message || toolBackendMsg,
                     }),
                     sourceStatus: SOURCE_STATUSES.CONNECTED,
                     sourceKind: sourcePayload.addressType,
                     toolStatus: TOOL_STATUSES.CONNECTED
                  } : win));
               } else {
                  setWindows(prev => prev.map(win => win.id === id ? {
                     ...win,
                     ...(mode === "realtime" ? {
                         windowRealtimeResponseI: sourceBackendMsg,
                         formRealtimeToolResponse: isToolSuccess ? "Connected!" : "Connection failed!",
                         realtimeNeo4jConnectedSessionId: isToolSuccess ? id : null,
                         realtimeLastConnectSessionId: isToolSuccess ? id : null,
                         realtimeConfigPersistStatus: isToolSuccess ? "saved" : "idle",
                         realtimeConfigPersistedSessionId: isToolSuccess ? id : null,
                         realtimeConfigPersistMessage: isToolSuccess ? "Auto-connected from saved configuration." : ""
                     } : {
                         windowResponseI: sourceBackendMsg,
                         formToolResponse: toolData?.message || toolBackendMsg,
                     }),
                     sourceStatus: isSourceSuccess ? SOURCE_STATUSES.CONNECTED : SOURCE_STATUSES.FAILED,
                     sourceKind: sourcePayload.addressType,
                     toolStatus: isToolSuccess ? TOOL_STATUSES.CONNECTED : TOOL_STATUSES.FAILED
                  } : win));
               }
            });
            return { ...w };
        }
        if (menuId === "upload_form" && action === "auto_connect") {
            const sourceAutofillDefaults = getSourceWindowAutofillDefaults(configurations);
            const sessionKey = normalizeSessionId(id);
            
            const initialToolPayload = {
               tool_name: 'neo4j',
               url: sourceAutofillDefaults.toolUrl,
               username: sourceAutofillDefaults.toolUsername,
               password: sourceAutofillDefaults.toolPassword,
               database: sourceAutofillDefaults.toolDatabase,
               source_id: sessionKey
            };
            
            const connectPayloadResult = buildConnectToToolPayload({
               payload: initialToolPayload,
               validatedValues: initialToolPayload,
               sessionKey: sessionKey,
               passwordRef: sourceAutofillDefaults.toolPasswordRef
            });
            
            const toolPayload = connectPayloadResult.ok ? connectPayloadResult.payload : initialToolPayload;

            setWindows(prev => prev.map(win => win.id === id ? {
               ...win,
               toolStatus: TOOL_STATUSES.CONNECTING,
               formToolResponse: "Connecting..."
            } : win));

            apiFetch("/connect_to_tool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(toolPayload) })
            .then(toolData => {
               const toolBackendMsg = getConnectToolErrorMessage(toolData, toolData?.message || "Connection failed!");
               const isToolSuccess = toolStatusFromResponse(toolData?.message) === TOOL_STATUSES.CONNECTED;

               if (isToolSuccess) {
                  handleWindowActions(id, "batch_input_form_swap", "page_III", null, { skipSideBarToggle: true });
                  
                  setWindows(prev => prev.map(win => win.id === id ? {
                     ...win,
                     formToolResponse: toolData?.message || toolBackendMsg,
                     toolStatus: TOOL_STATUSES.CONNECTED
                  } : win));
               } else {
                  setWindows(prev => prev.map(win => win.id === id ? {
                     ...win,
                     formToolResponse: toolData?.message || toolBackendMsg,
                     toolStatus: TOOL_STATUSES.FAILED
                  } : win));
               }
            }).catch(err => {
               setWindows(prev => prev.map(win => win.id === id ? {
                  ...win,
                  formToolResponse: "Connection failed!",
                  toolStatus: TOOL_STATUSES.FAILED
               } : win));
            });
            return { ...w };
        }
        if (menuId === "batch_input_form_swap" && action === "page_I") {
          newContent = sourceWorkflowContent;
          newSubContent = sourceWorkflowContent === "real_time_input" ? "real_time_input_form_pageI" : "batch_input_form_pageI";
          //console.log("here", newSubContent); // Debugging
        }
        if (menuId === "batch_input_form_swap_passive" && action === "page_I") {
          newContent = sourceWorkflowContent;
          newSubContent = sourceWorkflowContent === "real_time_input" ? "real_time_input_form_pageI" : "batch_input_form_pageI";
        }
        if (menuId === "batch_input_form_swap" && action === "page_II") {
          if (payload){ //For Broker and API jumps to dataframe creation
            if (payload["addressType"] === "broker" || payload["addressType"] === "api"){ //For kafka broker and API                          
              //Request a dataframe creation from the api address           
              // Set new timeout for debounce
              debounceRef.current = setTimeout(() => {
                const newLoadscreenText="Creating Dataframe "
                setWindows(prev =>
                  prev.map(w =>
                  w.id === id ? { ...w, batchFilesDataframeInfoI:[],batchFilesDataframeActionValue,loadscreenState: true,loadscreenText:newLoadscreenText,dataframeStatus: DATAFRAME_STATUSES.CREATING,sourceStep: SOURCE_FLOW_STEPS.DATAFRAME} : w
                  )
                );
                //Requesting dataframe creation
                let dataSourceKind="address";
                const payloadAddress = String(payload["address"] || "").trim();
                const payloadTopic = payload["topic"] == null ? null : String(payload["topic"]).trim();
                const payload1 = {
                    id: "create_DF",
                    type: payload["addressType"],
                    kind: dataSourceKind,
                    session_id: id,//Source window id
                    value: payloadAddress,
                    address: payloadAddress,
                    broker: payloadAddress,
                    broker_url: payloadAddress,
                    topic: payloadTopic,
                  };
                requestDataframeCreation(apiFetch, payload1, {
                  label: "dataframe",
                  onQueued: (queuedData) => {
                    const jobId = getQueuedJobId(queuedData);
                    if (jobId) activeDataframeJobsRef.current[String(id)] = jobId;
                  }
                })
                .then((data) => { 
                    console.log("public source data:",data, "payload:", payload1, "api:", `${API_URL}/live_batch_files`)   
                    var arrayData=normalizeDataframeInfoList(data.results)
                    if (payload["addressType"] === "broker" && payload["mode"] === "realtime") {
                      arrayData[4] = "Live";
                    }
                    if (isSuccessResponse(data)){
                      //Changing window content
                      alert("Dataframe created")
                      console.log("arrayData:",arrayData)
                      newContent = sourceWorkflowContent;
                      newSubContent = "batch_input_form_pageIII";
                      //Setting DataframeInfoI        
                      setWindows(prev =>
                        prev.map(w =>
                          w.id === id ? { ...w, batchFilesDataframeInfoI:arrayData,loadscreenState: false, loadscreenText:null, selectedContent:newContent,selectedSubContent:newSubContent,windowResponseI:sourceWorkflowReadyResponse,sourceStatus: sourceStatusFromResponse(sourceWorkflowReadyResponse),dataframeStatus: DATAFRAME_STATUSES.READY,sourceStep: SOURCE_FLOW_STEPS.DATAFRAME,batchFilesDataframeActionValue:null } : w
                        )
                      );
                    }
                    else {
                      console.warn("Dataframe creation rejected", data);
                      alert(formatDataframeFailureMessage(data, "We could not create the dataframe right now. Please check the selected source and try again."))
                      setWindows(prev =>
                        prev.map(w =>
                          w.id === id ? { ...w, batchFilesDataframeInfoI:[],loadscreenState: false,dataframeStatus: DATAFRAME_STATUSES.FAILED } : w
                        )
                      );
                    }
                  })
                .catch((err) => {
                  console.error("create_DF error:", err, "payload:", payload1, "api:", `${API_URL}/live_batch_files`, "jobResponse:", err?.jobResponse);
                  alert(formatDataframeFailureMessage(err, "We could not create the dataframe from this source. Please verify the source is reachable and try again."));
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id ? { ...w, batchFilesDataframeInfoI: null, loadscreenState: false,dataframeStatus: DATAFRAME_STATUSES.FAILED} : w
                    )
                  );
                });
              }, 300); // debounce delay   
            }
            else{ //For storage goes to searching and filtering datas
              newContent = sourceWorkflowContent;
              newSubContent = "batch_input_form_pageII";
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, batchFilesCollection: [], sourceStep: SOURCE_FLOW_STEPS.SEARCH } : w
                )
              );
            } 
          }
          else{ //If no payload is passed it takes nochange 
            newContent = sourceWorkflowContent;
            newSubContent = sourceWorkflowContent === "real_time_input" ? "real_time_input_form_pageI" : "batch_input_form_pageI";
            setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, batchFilesCollection: [] } : w
            )
          );
          }              
        }
        if (menuId === "batch_input_form_swap_passive" && action === "page_II") {
          newContent = sourceWorkflowContent;
          const targetWindow = windowsRef.current.find(w => w.id === String(id) || w.id === Number(id));        
          if (targetWindow.sourceAddressType === "api" || targetWindow.sourceAddressType === "broker"){
            newSubContent = "batch_input_form_pageI";  
          }
          else{
            newSubContent = "batch_input_form_pageII";
          }           
        }
        if (menuId === "batch_files_search_useSearch") {
          setBatchFilesSearchResults({ results: [], message: "" });        
          if (action === "files"){
            setBatchFilesSearchHybrid(false)            
            setWindows(prev => prev.map(w =>
              w.id === id
                ? { ...w, batchFilesSearchHybrid: false, batchFilesSearchResults: { results: [], message: "" } }
                : w
            ));            
          }
          else {
            setBatchFilesSearchHybrid(true)            
            setWindows(prev => prev.map(w =>
              w.id === id
                ? { ...w, batchFilesSearchHybrid: true, batchFilesSearchResults: { results: [], message: "" } }
                : w
            ));
          }        
        }
        if (menuId === "batch_files_search_hive_query") {
          setbatchFilesSearchHybridQuery(prev => !prev);
          setBatchFilesSearchResults({ results: [], message: "" });
            setWindows(prev => prev.map(w =>
              w.id === id
                ? { ...w, batchFilesSearchHybridQuery: !batchFilesSearchHybridQuery, batchFilesSearchResults: { results: [], message: "" } }
                : w
            ));
        }
        if (menuId === "batch_files_search_strict") {
          console.log("batchFilesSearchStrict:",batchFilesSearchStrict)
            setBatchFilesSearchStrict(prev => !prev);
            setWindows(prev => prev.map(w =>
              w.id === id
                ? { ...w, batchFilesSearchStrict: !w.batchFilesSearchStrict, batchFilesSearchResults: { results: [], message: "" } }
                : w
            ));
        }
        if (menuId === "batch_files_search_input") {
            const keyword = sanitizeText(payload?.[0] || "", { maxLength: 500 }).trim();
            const selectedDateRaw = String(payload?.[1] || "").trim();
            const selectedDate = selectedDateRaw || null;
            const hybrid = !!payload?.[2];
            const search_column = sanitizeText(payload?.[3] || "", { maxLength: 120 }).trim();
            const strict_mood = !!payload?.[4];
            const isStrictHybridSearch = hybrid && strict_mood;
            const searchValidation = validateSchema({ keyword, date: selectedDate || "", search_column }, searchRequestSchema);
            if (!searchValidation.ok) {
              showValidationFailure(searchValidation.message || "Search input is invalid.");
              return { ...w };
            }

            const buildPayload = (offset) => {
              const value = {
                keyword,
                date: selectedDate,
                hybrid,
                offset,
                limit: batchFilesSearchLimit
              };

              if (hybrid) {
                value.strict_mood = isStrictHybridSearch;
                if (isStrictHybridSearch) {
                  value.search_column = search_column;
                } else if (search_column) {
                  value.search_column = search_column;
                }
              }

              return {
                id: "search",
                value,
                session_id: id
              };
            };

            const logSearchRequest = (offset, requestBody) => {
              console.log("[batch search request]", {
                endpoint: `${API_URL}/live_batch_files`,
                mode: action,
                hybrid,
                strict_mood: isStrictHybridSearch,
                offset,
                payload: requestBody,
              });
            };

            const logSearchResponse = (offset, requestBody, rawResponse, normalizedResponse) => {
              console.log("[batch search response]", {
                endpoint: `${API_URL}/live_batch_files`,
                mode: action,
                hybrid,
                strict_mood: isStrictHybridSearch,
                offset,
                payload: requestBody,
                rawResponse,
                normalizedResponse,
              });
            };

            const logSearchError = (offset, requestBody, error) => {
              console.error("[batch search error]", {
                endpoint: `${API_URL}/live_batch_files`,
                mode: action,
                hybrid,
                strict_mood: isStrictHybridSearch,
                offset,
                payload: requestBody,
                error,
              });
            };

            const handleRawSearchDiagnostics = (data, results) => {
              if (hybrid || results.length !== 0) return;

              const diagnosticsSource = data?.data && typeof data.data === "object" ? data.data : data;
              const diagnostics = {
                base_path: diagnosticsSource?.base_path ?? null,
                storage: diagnosticsSource?.storage ?? null,
                errors: diagnosticsSource?.errors ?? null,
                message: diagnosticsSource?.message ?? data?.message ?? null,
              };

              console.warn("Raw search returned no results", diagnostics);

              const lines = [];
              if (diagnostics.base_path) lines.push("base_path: " + diagnostics.base_path);
              if (diagnostics.storage) lines.push("storage: " + diagnostics.storage);
              if (diagnostics.message) lines.push("message: " + diagnostics.message);
              if (diagnostics.errors) {
                const errorsText = Array.isArray(diagnostics.errors)
                  ? diagnostics.errors.join(" | ")
                  : String(diagnostics.errors);
                lines.push("errors: " + errorsText);
              }
              if (lines.length > 0) {
                alert("No raw files found.\n" + lines.join("\n"));
              }
            };

            // ============================
            //       FIRST SEARCH
            // ============================
            if (action === "search" && keyword) {
              if (isStrictHybridSearch && !search_column) {
                alert("Strict Elastic search requires selecting a search column.");
                return { ...w };
              }

              clearTimeout(debounceRef.current);

              debounceRef.current = setTimeout(() => {
                setBatchFilesSearchOffset(0);
                setBatchFilesSearchResults([]);
                setSearchPlaceholder("Searching...");

                // UI reset
                setWindows(prev =>
                  prev.map(w =>
                    String(w.id) === String(id)
                      ? {
                          ...w,
                          searchText: true,
                          searchResultsVisible: true,
                          searchPlaceholder: "Searching..."
                        }
                      : w
                  )
                );

                const requestBody = buildPayload(0);
                logSearchRequest(0, requestBody);

                fetchMaybeQueued(apiFetch, "/live_batch_files", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(requestBody)
                }, {
                  label: "search",
                  onQueued: (queuedData) => {
                    const jobId = getQueuedJobId(queuedData);
                    if (jobId) activeSearchJobsRef.current[String(id)] = jobId;
                  }
                })
                  .then(data => {
                    const searchResponse = normalizeSearchResponse(data);
                    const results = searchResponse.results;
                    const hasMore = searchResponse.has_more;
                    logSearchResponse(0, requestBody, data, searchResponse);
                    console.log("[search response normalized]", { response: searchResponse, results, hasMore, payload: requestBody });

                    handleRawSearchDiagnostics(searchResponse, results);

                    setBatchFilesSearchResults(results);
                    setBatchFilesSearchMoreFiles(hasMore);
                    setBatchFilesSearchOffset(results.length);

                    setWindows(prev =>
                      prev.map(w =>
                        w.id === id
                          ? {
                              ...w,
                              searchText: false,
                              batchFilesSearchResults: results,
                              batchFilesSearchMoreFiles: hasMore,
                              searchResultsVisible: true,
                              searchPlaceholder: hasMore ? "Load more" : "No more files"
                            }
                          : w
                      )
                    );

                    if (searchResponse?.message === "Result out of bound!") {
                      alert(searchResponse.message);
                    }
                  })
                  .catch((err) => {
                  logSearchError(0, requestBody, err);
                  setWindows(prev =>
                    prev.map(w =>
                      String(w.id) === String(id)
                        ? { ...w, searchText: false, searchPlaceholder: "Search failed" }
                        : w
                    )
                  );
                });
              }, 300);
            }

            // ============================
            //         LOAD MORE
            // ============================
            if (action === "load_more") {
              if (isStrictHybridSearch && !search_column) {
                alert("Strict Elastic search requires selecting a search column.");
                return { ...w };
              }

              const offset = batchFilesSearchOffset;
              const requestBody = buildPayload(offset);

              setWindows(prev =>
                prev.map(w =>
                  w.id === id
                    ? {
                        ...w,
                        searchText: true,
                        searchResultsVisible: true,
                        searchPlaceholder: "Loading more..."
                      }
                    : w
                )
              );

              logSearchRequest(offset, requestBody);

              fetchMaybeQueued(apiFetch, "/live_batch_files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(requestBody)
              }, {
                label: "search",
                onQueued: (queuedData) => {
                  const jobId = getQueuedJobId(queuedData);
                  if (jobId) activeSearchJobsRef.current[String(id)] = jobId;
                }
              })
                .then(data => {
                  const searchResponse = normalizeSearchResponse(data);
                  const results = searchResponse.results;
                  const hasMore = searchResponse.has_more;
                  logSearchResponse(offset, requestBody, data, searchResponse);
                  console.log("[search response normalized]", { response: searchResponse, results, hasMore, payload: requestBody });

                  setBatchFilesSearchResults(prev => [...prev, ...results]);
                  setBatchFilesSearchMoreFiles(hasMore);
                  setBatchFilesSearchOffset(offset + results.length);

                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id
                        ? {
                            ...w,
                            searchText: false,
                            batchFilesSearchResults: [ ...(w.batchFilesSearchResults || []), ...results ],
                            batchFilesSearchMoreFiles: hasMore,
                            searchPlaceholder: hasMore ? "Load more" : "No more files"
                          }
                        : w
                    )
                  );
                })
                .catch((err) => {
                  logSearchError(offset, requestBody, err);
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id
                        ? { ...w, searchText: false, searchPlaceholder: "Search failed" }
                        : w
                    )
                  );
                });
            }
        }
        if (menuId === "batch_files_select_file" && action === "toggle_select") {

          var filename=payload["name"];
          var filesize=payload["size"];

          console.log("newBatchFilesCollection:",newBatchFilesCollection);
          console.log("gotPayload:",payload);
          console.log("gotfilename:",filename);
          console.log("gotfilesize:",filesize);
          const isAlreadySelected = newBatchFilesCollection.some(
            (file) => (file.name === filename && file.size === filesize)
          );
          if (isAlreadySelected) {
              // File is already selected, remove it
              console.log(`deSelecting file: ${filename}`,filesize);
              newBatchFilesCollection = newBatchFilesCollection.filter(
              (file) => !(file.name === filename && file.size === filesize));
            } else {
              // File is not selected, add it
              console.log(`Selecting file: ${filename}`,filesize);
              newBatchFilesCollection = [...newBatchFilesCollection, payload];
            }
            console.log("Updated batchFilesCollection:", newBatchFilesCollection);
            return { ...w, batchFilesCollection: newBatchFilesCollection};
        }
        if (menuId === "batch_input_form_swap" && action === "page_III") {
          //Request a dataframe creation with the selected file           
          // Set new timeout for debounce
          debounceRef.current = setTimeout(() => {
            const newLoadscreenText="Creating Dataframe "
            setWindows(prev =>
              prev.map(w =>
               w.id === id ? { ...w, batchFilesDataframeInfoI:[],batchFilesDataframeActionValue,loadscreenState: true,loadscreenText:newLoadscreenText,dataframeStatus: DATAFRAME_STATUSES.CREATING,sourceStep: SOURCE_FLOW_STEPS.DATAFRAME} : w
              )
            );
            //Requesting dataframe creation
            let dataSourceKind="";
            if (windowResponseI == "Dataset uploaded!"){
              console.log("16/03/2026",1)
              dataSourceKind = "files"
            }
            if (windowResponseI == "Connection established!"){
              if (batchFilesSearchHybrid == true) {
                console.log("16/03/2026",2)
                dataSourceKind = "hybrid"
              }
              else {
                dataSourceKind = "hdfs"
              }
            }

            const payload = {
                id: "create_DF",
                type: "array",
                kind:dataSourceKind,
                session_id: id,//Source window id
                value: newBatchFilesCollection, //Explodes at back end
              };
            requestDataframeCreation(apiFetch, payload, {
              label: "dataframe",
              onQueued: (queuedData) => {
                const jobId = getQueuedJobId(queuedData);
                if (jobId) activeDataframeJobsRef.current[String(id)] = jobId;
              }
            })
            .then((data) => { 
                console.log("searchdata:",data)   
                var arrayData=normalizeDataframeInfoList(data.results)
                if (isSuccessResponse(data)){
                  //Changing window content
                  alert("Dataframe created")
                  console.log("arrayData:",arrayData)
                  newContent = "batch_input";
                  newSubContent = "batch_input_form_pageIII";
                  //Setting DataframeInfoI        
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id ? { ...w, batchFilesDataframeInfoI:arrayData,loadscreenState: false, loadscreenText:null, selectedContent:newContent,selectedSubContent:newSubContent,dataframeStatus: DATAFRAME_STATUSES.READY,sourceStep: SOURCE_FLOW_STEPS.DATAFRAME,batchFilesDataframeActionValue:null } : w
                    )
                  );
                }
                else {
                  console.warn("Dataframe creation rejected", data);
                  alert(formatDataframeFailureMessage(data, "We could not create the dataframe from the selected files. Please review your selection and try again."))
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id ? { ...w, batchFilesDataframeInfoI:[],loadscreenState: false,dataframeStatus: DATAFRAME_STATUSES.FAILED } : w
                    )
                  );
                }
              })
            .catch((err) => {
              console.error("create_DF error:", err, "jobResponse:", err?.jobResponse);
              alert(formatDataframeFailureMessage(err, "We could not create the dataframe from the selected files. Please try again in a moment."));
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, batchFilesDataframeInfoI: null, loadscreenState: false,dataframeStatus: DATAFRAME_STATUSES.FAILED} : w
                )
              );
            });
          }, 300); // debounce delay       
        }
        if (menuId === "batch_input_form_swap_passive" && action === "page_III") {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, batchFilesDataframeActionValue:null,batchFilesDataframeSourceValue:null,batchFilesDataframeTargetValue:null,batchFilesDataframeRelationshipValue:null,batchFilesDataframeRuleValue:null,sourceStep: SOURCE_FLOW_STEPS.DATAFRAME} : w
            ))
          newContent = sourceWorkflowContent;
          newSubContent = "batch_input_form_pageIII";
        }
        if (menuId === "batch_files_actions_select" && action === "change") {
          debounceRef.current = setTimeout(() => {
            setWindows(prev =>
              prev.map(w =>
                w.id === id
                  ? {
                      ...w,
                      batchFilesDataframeInfoI:w.batchFilesDataframeInfoI,
                      batchFilesDataframeActionValue: payload,
                      loadscreenState: false,
                    }
                  : w
              )
            );
            //setBatchFilesDataframeActionValue(payload);
          }, 300);
        } 
        if (menuId === "batch_files_source_select" && action === "change") {
          debounceRef.current = setTimeout(() => {
            setWindows(prev =>
              prev.map(w =>
                w.id === id
                  ? {
                      ...w,
                      batchFilesDataframeInfoI:w.batchFilesDataframeInfoI,
                      batchFilesDataframeSourceValue: payload,
                      loadscreenState: false,
                    }
                  : w
              )
            );
            //setBatchFilesDataframeSourceValue(payload);
          }, 300);
        }
        if (menuId === "batch_files_target_select" && action === "change") {
          debounceRef.current = setTimeout(() => {
            setWindows(prev =>
              prev.map(w =>
                w.id === id
                  ? {
                      ...w,
                      batchFilesDataframeInfoI:w.batchFilesDataframeInfoI,
                      batchFilesDataframeTargetValue: payload,
                      loadscreenState: false,
                    }
                  : w
              )
            );
            //setBatchFilesDataframeTargetValue(payload);
          }, 300);
        }
        if (menuId === "batch_files_relationship_select" && action === "change") {
          // No debounce or loadscreen needed
          setWindows(prev =>
            prev.map(w =>
              w.id === id
                ? { ...w,                       
                  batchFilesDataframeInfoI:w.batchFilesDataframeInfoI,
                  batchFilesDataframeRelationshipValue: sanitizeRelationshipName(payload) }
                : w
            )
          );
          //setBatchFilesDataframeRelationshipValue(payload);
        }
        if (menuId === "batch_files_rule_select" && action === "change") {
          debounceRef.current = setTimeout(() => {
            setWindows(prev =>
              prev.map(w =>
                w.id === id
                  ? {
                      ...w,
                      batchFilesDataframeInfoI:w.batchFilesDataframeInfoI,
                      batchFilesDataframeRuleValue: payload,
                      loadscreenState: false,
                    }
                  : w
              )
            );
            //setBatchFilesDataframeRuleValue(payload);
          }, 300);
        }        
if (menuId === "batch_input_form_swap" && action === "page_IV") {
  console.log("streaming:", batchFilesDataframeInfoI);

  debounceRef.current = setTimeout(() => {
    const newLoadscreenText = "Initalizing ";
    const sessionKey = normalizeSessionId(id);
    const targetWindow = windowsRef.current.find((windowState) => String(windowState.id) === sessionKey);

    if (!targetWindow) {
      console.warn("Window not found:", id);
      setWindows(prev =>
        prev.map(current =>
          String(current.id) === String(id)
            ? {
                ...current,
                streamStatus: STREAM_STATUSES.FAILED,
                loadscreenState: false,
                sourceStreamListener: false,
                windowResponseI: "Window not found.",
              }
            : current
        )
      );
      return;
    }

    const isRealtimeMode = targetWindow.selectedContent === "real_time_input";
    const hasRealtimeMatchingConnectSession = String(targetWindow.realtimeLastConnectSessionId || "") === sessionKey;
    const hasRealtimeNeo4jConnection = String(targetWindow.realtimeNeo4jConnectedSessionId || "") === sessionKey;
    const hasRealtimePersistedToolConfig = targetWindow.realtimeConfigPersistStatus === "saved" && String(targetWindow.realtimeConfigPersistedSessionId || "") === sessionKey;
    const realtimeBlockedMessage =
      targetWindow.realtimeStartGuardMessage ||
      (!hasRealtimeMatchingConnectSession
        ? `Reconnect Neo4j for session ${sessionKey} before starting realtime.`
        : !hasRealtimeNeo4jConnection
          ? `Connect Neo4j successfully for session ${sessionKey} before starting realtime.`
          : `Save Neo4j credentials for session ${sessionKey} before starting realtime.`);

    if (isRealtimeMode && (!hasRealtimeMatchingConnectSession || !hasRealtimeNeo4jConnection || !hasRealtimePersistedToolConfig)) {
      alert(realtimeBlockedMessage);
      updateSourceWindowState(sessionKey, {
        sourceStreamListener: false,
        streamStatus: STREAM_STATUSES.FAILED,
        loadscreenState: false,
        realtimeStartGuardMessage: realtimeBlockedMessage,
        windowResponseI: realtimeBlockedMessage,
      });
      return;
    }

    setSourceStreams(prev => ({ ...prev, [sessionKey]: false }));

    setWindows(prev =>
      prev.map(w =>
        w.id === id
          ? {
              ...w,
              windowResponseI: null,
              sourceSessionLog: null,
              sourceStreamListener: true,
              loadscreenState: false,
              loadscreenText: newLoadscreenText,
              streamStatus: STREAM_STATUSES.STARTING,
              sourceStep: SOURCE_FLOW_STEPS.STREAM,
              realtimeStartGuardMessage: null,
            }
          : w
      )
    );

    let selectedAction = targetWindow.batchFilesDataframeActionValue;
    const needsSourceTarget = selectedAction === "Source / Target Relationship";

    let source = needsSourceTarget ? targetWindow.batchFilesDataframeSourceValue : "";
    let target = needsSourceTarget ? targetWindow.batchFilesDataframeTargetValue : "";
    let relationship =
      needsSourceTarget &&
      targetWindow.batchFilesDataframeRelationshipValue &&
      targetWindow.batchFilesDataframeRelationshipValue !== "" &&
      targetWindow.batchFilesDataframeRelationshipValue !== true
        ? targetWindow.batchFilesDataframeRelationshipValue
        : "HAS_RELATIONSHIP";

    let tool = targetWindow.batchFilesDataframeInfoI?.[7];
    let rule = targetWindow.batchFilesDataframeRuleValue;

    const validationPayload = needsSourceTarget
      ? {
          action: selectedAction,
          source,
          target,
          relationship,
          tool,
          rule,
        }
      : {
          action: selectedAction,
          source: "RULE_DEFINED",
          target: "RULE_DEFINED",
          relationship: "HAS_RELATIONSHIP",
          tool,
          rule,
        };

    const streamValidation = validateSchema(validationPayload, streamRequestSchema);

    if (!streamValidation.ok) {
      showValidationFailure(streamValidation.message || "Stream configuration is invalid.");
      setWindows(prev =>
        prev.map(current =>
          String(current.id) === String(id)
            ? {
                ...current,
                streamStatus: STREAM_STATUSES.FAILED,
                loadscreenState: false,
                sourceStreamListener: false,
                windowResponseI: streamValidation.message,
              }
            : current
        )
      );
      return;
    }

    selectedAction = streamValidation.value.action;
    tool = streamValidation.value.tool;
    rule = streamValidation.value.rule;

    if (needsSourceTarget) {
      source = streamValidation.value.source;
      target = streamValidation.value.target;
      relationship = streamValidation.value.relationship;
    } else {
      source = "";
      target = "";
      relationship = "";
    }

    newContent = sourceWorkflowContent;
    newSubContent = "batch_input_form_pageIII";

    const sourceMode = sourceWorkflowContent === "real_time_input" ? "realtime" : "batch";

    const payload = {
      id: "stream",
      session_id: id,
      mode: sourceMode,
      source_mode: sourceMode,
      value: {
        window_id: id,
        session_id: id,
        mode: sourceMode,
        source_mode: sourceMode,
        tool,
        action: selectedAction,
        rule,
        ...(needsSourceTarget ? { source, target, relationship } : {}),
      },
    };

    console.log("[stream request]", {
      sourceMode,
      session_id: sessionKey,
      last_tool_connect_session_id: targetWindow.realtimeLastConnectSessionId || null,
      same_session: !isRealtimeMode || String(targetWindow.realtimeLastConnectSessionId || "") === sessionKey,
      action: selectedAction,
      source,
      target,
      relationship,
      rule,
      needsSourceTarget,
      payload,
    });

    if (CLIENT_DEV_LOGS_ENABLED && isRealtimeMode) {
      console.info("[realtime stream start]", {
        session_id: sessionKey,
        connect_session_id: targetWindow.realtimeLastConnectSessionId || null,
        same_session: String(targetWindow.realtimeLastConnectSessionId || "") === sessionKey,
      });
    }

    apiFetch("/live_batch_files", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async data => {
        if (data == null) return;

        const applyStreamState = (logFile, response, streamStatus = STREAM_STATUSES.RUNNING) => {
          if (!logFile) return;

          console.log("[stream log file]", {
            session_id: sessionKey,
            filename: logFile,
            response,
          });

          setSourceStreamListener(true);
          setSourceSessionLogFile({ logFile, session_id: sessionKey });
          setSourceSessionLogFiles(prev => ({
            ...prev,
            [sessionKey]: { logFile, session_id: sessionKey },
          }));
          setSourceStreams(prev => ({ ...prev, [sessionKey]: true }));

          newContent = sourceWorkflowContent;
          newSubContent = "batch_input_form_pageIV";

          setWindows(prev =>
            prev.map(w =>
              String(w.id) === sessionKey
                ? {
                    ...w,
                    windowResponseI: "Streaming...",
                    streamStatus,
                    sourceStep: SOURCE_FLOW_STEPS.STREAM,
                    batchFilesDataframeInfoI: w.batchFilesDataframeInfoI,
                    loadscreenState: false,
                    selectedContent: newContent,
                    selectedSubContent: newSubContent,
                    sourceStreamListener: true,
                    sourceSessionLogFile: logFile,
                  }
                : w
            )
          );
        };

        const initialLogFile = resolveStreamResponseLogFilename(data);
        const streamJobId = getQueuedJobId(data);

        if (streamJobId) {
          activeStreamJobsRef.current[sessionKey] = streamJobId;
          streamTerminateRequestedRef.current[sessionKey] = false;
          console.log("[stream job active]", {
            session_id: sessionKey,
            job_id: streamJobId,
          });
        }

        const queued =
          isQueuedJobResponse(data) ||
          data?.queued === true ||
          String(data?.status || "").toLowerCase() === "queued";

        const accepted = isSuccessResponse(data) || queued;

        if (!accepted) {
          logStreamFailureResponse("initialization rejected", data);
          pushNotification({
            title: "Streaming could not start",
            message: getStreamingErrorMessage(
              data,
              "The request was received, but the stream did not initialize. Please check the selected action and try again."
            ),
            source: "Linkx",
            level: "error",
          });

          console.warn("Stream initialization rejected", {
            message: data?.message,
            status: data?.status,
            hasException: Boolean(data?.exception),
            response: data,
          });

          setSourceStreams(prev => ({ ...prev, [sessionKey]: false }));
          setSourceStreamListener(true);

          setSourceSessionLogFiles(prev => {
            const nextStreams = { ...prev };
            delete nextStreams[sessionKey];
            return nextStreams;
          });

          setWindows(prev =>
            prev.map(w =>
              String(w.id) === sessionKey
                ? {
                    ...w,
                    batchFilesDataframeInfoI: w.batchFilesDataframeInfoI,
                    windowResponseI: sourceWorkflowReadyResponse,
                    loadscreenState: false,
                    sourceStreamListener: false,
                    streamStatus: STREAM_STATUSES.FAILED,
                  }
                : w
            )
          );
          return;
        }

        if (initialLogFile) {
          applyStreamState(
            initialLogFile,
            data,
            queued ? STREAM_STATUSES.STARTING : STREAM_STATUSES.RUNNING
          );
        }

        if (queued && getQueuedPollPath(data)) {
          try {
            const jobResult = await pollJob(apiFetch, getQueuedPollPath(data), {
              intervalMs: 1000,
              label: "ingestion",
            });

            if (streamTerminateRequestedRef.current[sessionKey] === true) {
              console.info("Stream job completed after terminate request; keeping stopped state", {
                session_id: sessionKey,
                job_id: activeStreamJobsRef.current[sessionKey],
                jobResult,
              });
              delete activeStreamJobsRef.current[sessionKey];
              return;
            }

            const completedLogFile =
              resolveStreamResponseLogFilename(jobResult) || initialLogFile;

            delete activeStreamJobsRef.current[sessionKey];
            streamTerminateRequestedRef.current[sessionKey] = false;

            if (completedLogFile) {
              applyStreamState(completedLogFile, jobResult, STREAM_STATUSES.RUNNING);
            }
          } catch (err) {
            const wasTerminateRequested =
              streamTerminateRequestedRef.current[sessionKey] === true;
            const wasCancelled = JOB_CANCEL_STATUSES.has(
              String(err?.jobStatus || "").toLowerCase()
            );

            if (wasTerminateRequested && wasCancelled) {
              console.info("Stream stopped after terminate request", {
                session_id: sessionKey,
                job_id: activeStreamJobsRef.current[sessionKey],
                status: err?.jobStatus,
                jobResponse: err?.jobResponse,
              });

              delete activeStreamJobsRef.current[sessionKey];
              streamTerminateRequestedRef.current[sessionKey] = false;
              setSourceStreams(prev => ({ ...prev, [sessionKey]: false }));

              setWindows(prev =>
                prev.map(w =>
                  String(w.id) === sessionKey
                    ? {
                        ...w,
                        windowResponseI: "Stream stopped",
                        sourceStreamListener: false,
                        streamStatus: STREAM_STATUSES.TERMINATED,
                        loadscreenState: false,
                      }
                    : String(w.graphLinkSource) === sessionKey 
                      ? {
                          ...w,
                          activeGraph:"graph_placeholder",
                          graphStatus:null,
                          graphRenderStats:null,
                          graphLinkSource:null,
                          filterPropertyKeys:null,
                          selectedContent:null,
                          graphLink:false,
                          loadscreenState: false
                        }
                      : w
                )
              );
              return;
            }

            console.error("Stream job failed", {
              message: err?.message,
              status: err?.jobStatus,
              pollPath: err?.pollPath,
              jobResult: err?.jobResult,
              jobResponse: err?.jobResponse,
              error: err,
            });
            logStreamFailureResponse("queued job failed", {
              message: err?.message,
              status: err?.jobStatus,
              pollPath: err?.pollPath,
              jobResult: err?.jobResult,
              jobResponse: err?.jobResponse,
            });

            const streamErrorMessage = getStreamingErrorMessage(
              { ...err, message: getJobFailureMessage(err, err?.message || "The stream job failed before it started.") },
              "The stream job failed before it started. Check the console for the job response."
            );

            pushNotification({
              title: "Streaming could not start",
              message: streamErrorMessage,
              source: "Linkx",
              level: "error",
            });

            delete activeStreamJobsRef.current[sessionKey];
            streamTerminateRequestedRef.current[sessionKey] = false;
            setSourceStreams(prev => ({ ...prev, [sessionKey]: false }));

            setSourceSessionLogFiles(prev => {
              const nextStreams = { ...prev };
              delete nextStreams[sessionKey];
              return nextStreams;
            });

            setWindows(prev =>
              prev.map(w =>
                String(w.id) === sessionKey
                  ? {
                      ...w,
                      sourceStreamListener: false,
                      streamStatus: STREAM_STATUSES.FAILED,
                      loadscreenState: false,
                    }
                  : String(w.graphLinkSource) === sessionKey 
                    ? {
                        ...w,
                        activeGraph:"graph_placeholder",
                        graphStatus:null,
                        graphRenderStats:null,
                        graphLinkSource:null,
                        filterPropertyKeys:null,
                        selectedContent:null,
                        graphLink:false,
                        loadscreenState: false
                      }
                    : w
              )
            );
          }
        }
      })
      .catch(err => {
        console.error("Stream initialization request failed", err);
        logStreamFailureResponse("request failed", err);

        pushNotification({
          title: "Streaming could not start",
          message: getStreamingErrorMessage(
            err,
            "The streaming request failed. Please check the backend response and try again."
          ),
          source: "Linkx",
          level: "error",
        });

        setWindows(prev =>
          prev.map(w =>
            w.id === id
              ? {
                  ...w,
                  batchFilesDataframeInfoI: w.batchFilesDataframeInfoI,
                  loadscreenState: false,
                }
              : w
          )
        );
      });
  }, 300);
}
        if (menuId === "batch_input_stream_terminate" && action === "page_IV") {
          // Set new timeout for debounce
          debounceRef.current = setTimeout(() => {
            const newLoadscreenText="Terminating "
            setWindows(prev =>
              prev.map(w =>
               w.id === id ? { ...w, windowResponseI:null, sourceSessionLog:null,loadscreenState: true, loadscreenText:newLoadscreenText,streamStatus: STREAM_STATUSES.TERMINATING } : w
              )
            );
            // Unpluging sockets
            const socket = socketRef.current;
            const sessionKey = String(id);
            streamTerminateRequestedRef.current[sessionKey] = true;
            const activeFilename = activeLogStreamsRef.current[sessionKey] || resolveLogStreamFilename(sourceSessionLogFiles[sessionKey]);
            if (socket && socket.connected) {
              if (activeFilename) {
                socket.emit("log_stream_unplug", { session_id: sessionKey, filename: activeFilename });
              }
              socket.emit("graph_status_unsubscribe", { session_id: id })
            }
            clearLinkedGraphStatusForSession(sessionKey, "source_terminate_requested");
            delete activeLogStreamsRef.current[sessionKey];
            delete logBuffersRef.current[sessionKey];
            setSourceSessionLogFiles(prev => {
              const nextStreams = { ...prev };
              delete nextStreams[sessionKey];
              return nextStreams;
            });
            //Refresh the options (the previous content options)
            let oldBatchFilesDataframeInfoI=batchFilesDataframeInfoI
            //setBatchFilesDataframeInfoI(null)
            console.log("termination:",batchFilesDataframeInfoI)
            const payload = {
                id: "end_session",
                  session_id: id,
                value:{"window_id":id,"session_id":id,"log_file":activeFilename}
              };
            apiFetch("/live_batch_files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }) 
            .then((data) => { 
              if (data!=null){
                if (data.message==="success"){
                  console.info("Stream termination accepted", { session_id: String(id), response: data });
                  setSourceStreamListener(false);
                  setSourceSessionLogFile(null);
                  setSourceSessionLog(null);
                  setSourceStreams(prev => ({ ...prev, [id]: false }));
                  delete activeStreamJobsRef.current[String(id)];
                  //setBatchFilesDataframeInfoI(oldBatchFilesDataframeInfoI)
                  // unsubscribe sockets
                  socketRef.current?.emit("graph_status_unsubscribe", { session_id: id });
                  clearLinkedGraphStatusForSession(String(id), "source_terminate_success");
                  setWindows(prev => prev.map(w =>
                    w.id === id
                    ? { ...w,windowResponseI:null,loadscreenState: false,sourceStreamListener: false,batchFilesDataframeInfoI:w.batchFilesDataframeInfoI, sourceSessionLog: null, setSourceSessionLogFile:null}
                      : w
                  ));
                  //alert("alert_message:",data.message)
                }
                else{
                  setWindows(prev => prev.map(w =>
                    w.id === id
                    ? { ...w,loadscreenState: false}
                      : w
                  ));
                  alert("No streaming found!",data.results)
                }
                //Return to back page
                newContent = sourceWorkflowContent;
                newSubContent = "batch_input_form_pageIII";
              }
              let newWindowResponseI
              if (setBatchFilesDataframeInfoI){
                newWindowResponseI=sourceWorkflowReadyResponse
              }
              else{
                newWindowResponseI="The dataset was lost. Please try with a new source window."
              }
              console.log("newWindowResponseI:",newWindowResponseI)
              setWindows(prev =>
                prev.map(w =>
                  w.id === id
                    ? {
                        ...w,
                        windowResponseI:newWindowResponseI,
                        sourceStatus: sourceStatusFromResponse(newWindowResponseI),
                        streamStatus: STREAM_STATUSES.TERMINATED,
                        sourceStep: SOURCE_FLOW_STEPS.DATAFRAME,
                        loadscreenState: false,
                        selectedContent: newContent,
                        selectedSubContent: newSubContent
                      }
                    : w
                )
              );
            })
            .catch((err) => {
              console.error("err",err);
              alert("We could not update the stream state. Returning to the previous step.");
              const fallbackContent = sourceWorkflowContent;
              const fallbackSubContent = "batch_input_form_pageIII";
              setSourceStreamListener(false);
              setSourceSessionLogFile(null);
              setSourceSessionLog(null);
              setSourceStreams(prev => ({ ...prev, [id]: false }));
              setWindows(prev =>
                prev.map(w =>
                  String(w.id) === String(id)
                    ? {
                        ...w,
                        windowResponseI: sourceWorkflowReadyResponse,
                        sourceStatus: sourceStatusFromResponse(sourceWorkflowReadyResponse),
                        batchFilesDataframeInfoI:w.batchFilesDataframeInfoI,
                        loadscreenState: false,
                        loadscreenText: null,
                        sourceStreamListener: false,
                        streamStatus: STREAM_STATUSES.TERMINATED,
                        sourceStep: SOURCE_FLOW_STEPS.DATAFRAME,
                        selectedContent: fallbackContent,
                        selectedSubContent: fallbackSubContent,
                        sourceSessionLog: null
                      }
                    : w
                )
              );
            });
          }, 300); // debounce delay   
        }
        // ------------------------------------------------------------------- Graph window contents handling
        if (menuId === "new_graph") {
          const iframe=payload;
          const targetWindow = windows.find(w => w.id === id);
          if (targetWindow?.graphLink === true) {
            alert("Please unlink the graph first!");            
          }

          else{
            if (action !== "__confirmed") {
              requestConfirmation({
                title: "Confirm Replace",
                message: "Any unsaved progress will be lost. Continue?",
                source: "Graph",
                level: "warning",
                confirmText: "Continue",
                cancelText: "Cancel"
              }).then((shouldProceed) => {
                if (!shouldProceed) return;
                handleWindowActions(id, menuId, "__confirmed", payload, { skipSideBarToggle: true });
              });
              return w;
            }
            if (iframe?.current && iframe.current.contentWindow) {
              const settingsToApply = normalizeGraphIframeSettings(iframeSettings[id] || targetWindow?.iframeSettings);
              postMessageToIframe(iframe, { action: menuId, payload: { id, settings: settingsToApply } });
              // Store the link in the target window
              setWindows(prev =>
                prev.map(w =>
                  w.id === id
                  ? {
                      ...w,
                      activeGraph: "graphs_basic",
                      selectedContent: "graph_content",
                      graphStatus: null,
                      graphLink: false,
                      graphLinkSource: null,
                      loadscreenState: false,
                      nodeProperties: null,
                      filterPropertyKeys: null,
                      filterResults: null,
                    }
                  : w
                )
              );
            } 
          }
        }
        if (menuId === "graph_link_form" && action === "link") {
          runScopedDebounce(windowGraphActionDebounceRef, id, () => {
            const newLoadscreenText = "Linking window ";

            // Show loadscreen for the window being linked
            setWindows(prev =>
              prev.map(w =>
                w.id === id
                  ? { ...w, loadscreenState: true, loadscreenText: newLoadscreenText }
                  : w
              )
            );

            const sourceId = payload["sourceId"];
            const iframe = payload["iframe"];
            delete graphAutoRequestedRef.current[String(id)];
            const sessionKey = sanitizeGraphEndpointId(sourceId);
            const graphWindowId = sanitizeGraphEndpointId(id);
            const sourceWindow = windowsRef.current.find((windowState) => String(windowState.id) === sessionKey || String(windowState.sessionId) === sessionKey);
            if (!sourceWindow || !isSourceActiveForGraphLink(sourceWindow)) {
              const linkBlockedMessage = !sourceWindow
                ? "The selected source window could not be found."
                : "The selected source window is not actively ingesting or streaming. Start ingestion or streaming first, then try again.";
              pushNotification({
                title: "Graph link blocked",
                message: linkBlockedMessage,
                source: "Linkx",
                level: "warning",
              });
              setGraphLinkState(false);
              setGraphLinkSource(null);
              setGraphStatusListener(false);
              setIsSideBarMenuOpen("link_graph_options");
              setWindows(prev =>
                prev.map(w =>
                  w.id === id
                    ? {
                        ...w,
                        selectedContent: selectedContent,
                        graphStatus: null,
                        graphRenderStats: null,
                        graphLink: false,
                        graphLinkSource: null,
                        loadscreenState: false,
                        loadscreenText: null,
                      }
                    : w
                )
              );
              return;
            }
            const newPayload = { id: "link", source_id: sessionKey, graph_window_id: graphWindowId };
            console.log("[graph link request]", { sourceId, graphWindowId: id, payload: newPayload });

            // Send link request to backend
            apiFetch("/graph_link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newPayload),
            })
              .then(data => {
                console.log("[graph link response]", { payload: newPayload, response: data });
                if (isSuccessResponse(data)) {
                  // Link succeeded
                  setGraphLinkState(true);
                  setGraphLinkSource(sourceId);
                  sourceRef.current = sourceId;
                  setGraphStatusListener(true);
                  alert(`Linked to ${sessionKey}`);
                  // -----------------------------
                  // 1️⃣ Determine relationships to send
                  // -----------------------------
                  const targetWindows = windowsRef.current.filter(
                    w => String(w.graphLinkSource || "") === sessionKey
                  );

                  let existingRelationships = null;
                  // clone relationships from existing linked graph siblings only when they have real items
                  if (targetWindows.length > 0) {
                    const siblingRelationships = targetWindows.find(w => Array.isArray(w.graphStatus) && w.graphStatus.length > 0)?.graphStatus;
                    existingRelationships = siblingRelationships || null;
                  }
                  console.log("[graph link sibling cache]", { sessionKey, linkedSiblingCount: targetWindows.length, existingRelationships });

                  if (!existingRelationships) {
                    const relationships = normalizeGraphRelationships(graphStatusRef.current?.[sessionKey]?.relationships);
                    console.log("[graph link cached relationships]", { sessionKey, graphStatus: graphStatus[sessionKey], relationships });
                    existingRelationships = relationships.length > 0 ? relationships : null;
                  }

                  // -----------------------------
                  // 2️⃣ Send relationships to the new window
                  // -----------------------------
                  if (existingRelationships) {
                    console.log("[graph link applying cached relationships]", { sessionKey, count: existingRelationships.length });
                    setWindows(prev =>
                      prev.map(w =>
                        String(w.id) === String(id)
                          ? { ...w, graphStatus: existingRelationships}
                          : w
                      )
                    );
                  } else {
                    console.log("[graph link waiting for socket relationships]", { sessionKey, status_available: data?.results?.status_available });
                  }
                  
                  // -----------------------------
                  // 3️⃣ Subscribe socket for streaming (doesnt over lap or duplicates)
                  // -----------------------------
                  if (sessionKey && socketRef.current) {
                    console.log("[graph link ready for status subscription]", {
                      session_id: sessionKey,
                      graph_window_id: graphWindowId,
                      status_available: data?.results?.status_available,
                      socket_connected: socketRef.current.connected,
                    });
                    if (!graphStatusSubscribedSessionsRef.current.has(sessionKey)) {
                      console.log("[graph status subscribe emit]", { session_id: sessionKey, source: "graph_link_success" });
                      socketRef.current.emit("graph_status_subscribe", { session_id: sessionKey });
                      graphStatusSubscribedSessionsRef.current.add(sessionKey);
                    } else {
                      console.log("[graph status subscribe skipped] already subscribed", {
                        session_id: sessionKey,
                        source: "graph_link_success",
                      });
                    }
                  }
                  // -----------------------------
                  // 4️⃣ Update new window state
                  // -----------------------------
                  setWindows(prev => {
                    const matchedWindow = prev.some(w => String(w.id) === String(id));
                    console.log("[graph link committing window state]", { session_id: sessionKey, graph_window_id: graphWindowId, matchedWindow, action_id: id, window_ids: prev.map(w => w.id) });
                    return prev.map(w =>
                      String(w.id) === String(id)
                        ? {
                            ...w,
                            sessionId: sessionKey,
                            graphLinkSource: sessionKey,
                            selectedContent: "graph_content",
                            activeGraph: "graph_info_placeholder",                            
                            graphRenderStats: null,
                            graphLink: true,
                            loadscreenState: false
                          }
                        : w
                    );
                  });
                } else {
                  // Linking failed
                  setGraphLinkState(false);
                  setGraphLinkSource(null);
                  setGraphStatusListener(false);
                  setIsSideBarMenuOpen("link_graph_options");
                  pushNotification({
                    title: "Graph link failed",
                    message: "The selected source window could not be linked. Please check the source window id and try again.",
                    source: "Linkx",
                    level: "error",
                  });
                  console.warn("Graph link rejected", { message: data?.message, field: data?.field, hasDetail: Boolean(data?.detail) });

                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id
                        ? {
                            ...w,
                            selectedContent: selectedContent,
                            graphStatus: null,
                            graphRenderStats: null,
                            graphLink: false,
                            loadscreenState: false
                          }
                        : w
                    )
                  );
                }
              })
              .catch(err => {
                setGraphLinkState(false);
                setGraphLinkSource(null);
                setGraphStatusListener(false);
                setIsSideBarMenuOpen("link_graph_options");
                pushNotification({
                  title: "Graph link failed",
                  message: "The selected source window could not be linked. Please check the source window id and try again.",
                  source: "Linkx",
                  level: "error",
                });
                console.warn("Graph link request failed", { message: err?.message, field: err?.data?.field, hasData: Boolean(err?.data) });

                setWindows(prev =>
                  prev.map(w =>
                    w.id === id
                      ? {
                          ...w,
                          selectedContent: selectedContent,
                          graphStatus: null,
                          graphRenderStats: null,
                          graphLink: false,
                          loadscreenState: false
                        }
                      : w
                  )
                );
              });
          }, 300);
        }
        if (menuId === "graph_link_form" && action === "unlink") {
          runScopedDebounce(windowGraphActionDebounceRef, id, () => {
            const sourceId = payload?.sourceId;
            const unlinkPayload = {
              id: "unlink",
              source_id: sanitizeGraphEndpointId(sourceId),
              graph_window_id: sanitizeGraphEndpointId(id),
            };

            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, loadscreenState: true, loadscreenText: "Unlinking graph " } : w
              )
            );

            apiFetch("/graph_link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(unlinkPayload),
            })
              .catch((err) => {
                console.warn("Graph unlink request failed", { message: err?.message, field: err?.data?.field, hasData: Boolean(err?.data) });
              })
              .finally(() => {
                delete graphAutoRequestedRef.current[String(id)];
                setGraphLinkState(false);
                setGraphLinkSource(null);
                setGraphStatusListener(false);
                setWindows(prev =>
                  prev.map(w =>
                    w.id === id ? { ...w, activeGraph:"graph_placeholder",graphStatus:null,graphRenderStats:null,graphLinkSource:null,filterPropertyKeys:null,selectedContent:null,graphLink:false,loadscreenState: false} : w
                  )
                );
              });
          }, 300);
        }
        if (menuId === "load_graph_url") {
          const iframe=payload
          runScopedDebounce(windowGraphActionDebounceRef, id, () => {
            const file = action;
            const targetWindow = windows.find(w => w.id === id);
            const settingsToApply = normalizeGraphIframeSettings(iframeSettings[id] || targetWindow?.iframeSettings);
            if (!file || !(file instanceof File)) {
              alert("Selected file is not valid. Please choose a proper .json or .html file.");
              return;
            }

            // Show the loadscreen immediately
            const newLoadscreenText = "Staging File...";
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, loadscreenState: true, loadscreenText: newLoadscreenText } : w
              )
            );

            const ext = file.name.split(".").pop().toLowerCase();
            if (ext !== "json" && ext !== "html") {
              alert("Unsupported file type. Only .json or .html files are allowed.");
              setTimeout(() => {
                setWindows(prev =>
                  prev.map(w =>
                    w.id === id ? { ...w, loadscreenState: false, loadscreenText: "" } : w
                  )
                );
              }, 500);
              return; // <--- missing in original
            }

            const reader = new FileReader();
            reader.onload = (event) => {
              const content = event.target.result;

              const hideLoadscreen = () => {
                setWindows(prev =>
                  prev.map(w =>
                    w.id === id ? { ...w, loadscreenState: false, loadscreenText: "" } : w
                  )
                );
              };

              try {
                if (ext === "json") {
                  const parsed = JSON.parse(content);
                  let graphData, networkOptions;

                  if (parsed.graphData && Array.isArray(parsed.graphData.nodes) && Array.isArray(parsed.graphData.edges)) {
                    graphData = parsed.graphData;
                    networkOptions = parsed.networkOptions || {};
                  } else if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
                    graphData = parsed;
                    networkOptions = parsed.networkOptions || {};
                  } else {
                    alert("This JSON file does not contain a valid graph.");
                    hideLoadscreen();
                    return;
                  }

                  if (payload?.current && payload.current.contentWindow) {
                    // reset window state
                    setWindows(prev =>
                      prev.map(w =>
                        w.id === id
                          ? {
                              ...w,
                              activeGraph: "graphs_basic",
                              selectedContent: "graph_content",
                              graphStatus: null,
                              graphLink: false,
                              graphLinkSource: null,
                              loadscreenState: false,
                              nodeProperties: null,
                              filterPropertyKeys: null,
                              filterResults: null,
                            }
                          : w
                      )
                    );

                    if (!iframe?.current) {
                      alert("Iframe not found!");
                      hideLoadscreen();
                      return;
                    }

                    const sendGraphMessage = () => {
                      postMessageToIframe(iframe, {
                        action: menuId,
                        payload: { id, file, settings: settingsToApply },
                      });
                    };

                    const iframeSrc = iframe.current.src;
                    if (iframeSrc.includes("graphs_basic")) {
                      sendGraphMessage();
                    } else {
                      iframe.current.onload = () => {
                        console.log("graphs_basic iframe loaded");
                        sendGraphMessage();
                      };
                    }

                    setTimeout(hideLoadscreen, 700);
                  }

                } else if (ext === "html") {
                  // reset window state
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id
                        ? {
                            ...w,
                            activeGraph: "graphs_basic",
                            selectedContent: "graph_content",
                            graphStatus: null,
                            graphLink: false,
                            graphLinkSource: null,
                            loadscreenState: false,
                            nodeProperties: null,
                            filterPropertyKeys: null,
                            filterResults: null,
                          }
                        : w
                    )
                  );

                  setTimeout(hideLoadscreen, 700);

                  if (!content.includes("new vis.DataSet")) {
                    alert("This HTML file does not contain a valid graph.");
                    hideLoadscreen();
                    return;
                  }

                  if (!iframe?.current) {
                    alert("Iframe not found!");
                    hideLoadscreen();
                    return;
                  }

                  const sendGraphMessage = () => {
                    postMessageToIframe(iframe, {
                      action: menuId,
                      payload: { id, file, settings: settingsToApply },
                    });
                  };

                  const iframeSrc = iframe.current.src;
                  if (iframeSrc.includes("graphs_basic")) {
                    sendGraphMessage();
                  } else {
                    iframe.current.onload = () => {
                      console.log("graphs_basic iframe loaded");
                      sendGraphMessage();
                    };
                  }

                  setTimeout(hideLoadscreen, 700);
                }
              } catch (err) {
                alert("Error reading graph file: " + err.message);
                hideLoadscreen();
              }
            };

            reader.onerror = () => {
              alert("Error reading file.");
              setTimeout(() => {
                setWindows(prev =>
                  prev.map(w =>
                    w.id === id ? { ...w, loadscreenState: false, loadscreenText: "" } : w
                  )
                );
              }, 500);
            };

            reader.readAsText(file);
          }, 300);
        }
        if (menuId === "graph_snapshot") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            postMessageToIframe(iframe, { action: menuId, payload: "" });
          }          
        }
        if (menuId === "graph_print") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            postMessageToIframe(iframe, { action: menuId, payload: "" });
          }          
        }
        if (menuId === "graph_report") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            postMessageToIframe(iframe, { action: menuId, payload: { id, format: action || "html" } });
          }          
        }
        if (menuId === "window_change_view") {
          const iframe=payload;  
          setIsMaximized(prev => !prev);
          setWindows(prev =>
            prev.map(w =>
              w.id === id
                ? { 
                    ...w,
                    isMaximized: !w.isMaximized // toggle true ↔ false
                  }
                : w
            )
          );                   
        }
        if (menuId === "reset_graph") {
          const iframe=payload;     
          const newSettings = normalizeGraphIframeSettings(DEFAULT_GRAPH_IFRAME_SETTINGS);
          setIframeSettings(prev => ({
            ...prev,        // spread existing entries
            [id]: newSettings // update specific id
          }));

          if (iframe?.current && iframe.current.contentWindow) {
            postMessageToIframe(iframe, { action: menuId, payload: newSettings});
          }   
        }
        if (menuId === "export_graph") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            postMessageToIframe(iframe, { action: menuId, payload: action });
          }          
        }
        // ------------------------------------------------------------------- Graph window contents handling
        if (menuId === "create_chart") {
          const { iframe } = payload;
          console.log("here:",iframe)
            if (iframe?.current && iframe.current.contentWindow) {
              postMessageToIframe(iframe, { action: menuId, payload: action });
            }
        }      
        if (menuId === "chart_link_form" && action === "link") {
          console.log("chart_linking...")
          const graphId = payload["graphId"];
          const newLoadscreenText = "Linking window ";
          // Show loadscreen for the window being linked
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, loadscreenState: true, loadscreenText: newLoadscreenText } : w
            )
          );
          //Finding the window
          const targetWindow = windowsRef.current.find(w => w.id === String(graphId) || w.id === Number(graphId));
          if (targetWindow && targetWindow.type==="graph") {
            setWindows(prev =>
              prev.map(w =>
                w.id === id
                  ? { ...w, 
                    activechart: "charts_basic",
                    loadscreenState: false, 
                    chartLink: graphId }
                  : w
              )
            );
            //iframe of the found window
            const iframeRef = iframeRefs.current[targetWindow.id];
            //Transfring the action to HandelChartActions
            handleChartActions(id, "getNetwork", "components", iframeRef);
            handleChartActions(id, "new_instance")
          } else {
            alert(`No graph window found with id: ${graphId}`);
            setWindows(prev =>
              prev.map(w =>
                w.id === id
                  ? { ...w, loadscreenState: false, chartLink: false }
                  : w
              )
            );
          }
        }
        if (menuId === "chart_link_form" && action === "unlink") {            
            if (!payload || payload.__confirmed !== true) {
              requestConfirmation({
                title: "Confirm Unlink",
                message: "Any unsaved progress will be lost. Continue?",
                source: "Chart",
                level: "warning",
                confirmText: "Continue",
                cancelText: "Cancel"
              }).then((shouldProceed) => {
                if (!shouldProceed) return;
                const confirmedPayload = payload && typeof payload === "object"
                  ? { ...payload, __confirmed: true }
                  : { __confirmed: true };
                handleWindowActions(id, menuId, action, confirmedPayload, { skipSideBarToggle: true });
              });
              return w;
            }
            setWindows(prev =>
              prev.map(w =>
               w.id === id ? { ...w, selectedContent:null,chartLink:false,loadscreenState: false} : w
              )
            );
        }
        if (menuId === "chart_snapshot") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            postMessageToIframe(iframe, { action: menuId, payload: "" });
          }          
        }
        if (menuId === "chart_print") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            postMessageToIframe(iframe, { action: menuId, payload: "" });
          }          
        }
        if (menuId === "chart_reset") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            postMessageToIframe(iframe, { action: menuId, payload: "" });
          }          
        }
        console.log("batchFilesDataframeInfoI:",batchFilesDataframeInfoI)
        const nextSourceStep = w.type === "source" ? sourceStepFromSubContent(newSubContent) : w.sourceStep;
        return { ...w, 
          selectedContent: newContent, 
          selectedSubContent: newSubContent,
          sourceStep: nextSourceStep,
          batchFilesSearchHybrid: w.batchFilesSearchHybrid,
          batchFilesSearchHiveQuery: w.batchFilesSearchHiveQuery,
          batchFilesSearchResults: newBatchSearchResult, 
          searchResultsVisible: w.searchResultsVisible,
          batchFilesCollection : newBatchFilesCollection,
          searchPlaceholder: w.searchPlaceholder,
          batchFilesDataframeInfoI: w.batchFilesDataframeInfoI,
          batchFilesDataframeInfoII: w.batchFilesDataframeInfoII,
          loadscreenState: loadscreenState,
          sourceStreams: sourceStreams,
          textareaRefs: textareaRefs,
          isMaximized: w.isMaximized
        };
      })
    );
  };
  const finalizeFrontendLogout = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setWindows([]);
    setIsConfigurationsOpen(false);
    setIsSettingsOpen(false);
    setIsToggleMenuOpen(false);
    setIsWorkspaceLocked(false);
    setUserName(null);
    setSessionId(null);
    sessionIdRef.current = null;
    lockedSessionIdRef.current = "";
    terminalUnlockFailureRef.current = false;
    localStorage.removeItem("session");
    logout();
  }, [logout]);

  const notifyBackendLogout = useCallback(async (reason = "user_logout") => {
    const body = { id: "logout", reason };

    try {
      console.log("[logout request]", body);
      await apiFetch("/auth/logout", {
        method: "POST",
        body,
        suppressUnauthorizedHandler: true,
        suppressLockedHandler: true,
      });
    } catch (err) {
      if (![404, 405].includes(Number(err?.status))) {
        console.warn("Backend logout notification failed", err);
      }
    }
  }, [apiFetch]);

  const performLogout = useCallback(async (reason = "user_logout") => {
    await notifyBackendLogout(reason);
    finalizeFrontendLogout();
  }, [finalizeFrontendLogout, notifyBackendLogout]);

  const handleNavAction = (action) => {
    if (action !== "logout") return;
    performLogout("user_logout");
  };

  const handleUnlockWorkspace = async () => {
    if (isUnlockingWorkspace || terminalUnlockFailureRef.current) return;
    setIdleResetSeq((value) => value + 1);
    setIsUnlockingWorkspace(true);
    try {
      await unlockBackendSession({ fallbackVerify: true });
      setIsWorkspaceLocked(false);
      setIdleResetSeq((value) => value + 1);
      pushNotification({
        title: "Session unlocked",
        message: "Your workspace is ready.",
        source: "Auth",
        level: "success",
        durationMs: 3500,
      });
    } catch (err) {
      console.warn("Unlock failed; logging out", err);
      terminalUnlockFailureRef.current = true;
      pushNotification({
        title: "Unlock failed",
        message: "Unlock failed. Signing out for a fresh session.",
        source: "Auth",
        level: "warning",
        durationMs: 2500,
      });
      await performLogout("unlock_failed");
    } finally {
      setIsUnlockingWorkspace(false);
    }
  };

  useEffect(() => {
    if (!token) setIsWorkspaceLocked(false);
  }, [token]);

  const notifyLockedSensitiveAction = useCallback((actionName = "this action") => {
    pushNotification({
      title: "Workspace locked",
      message: "Unlock the workspace to continue with " + actionName + ".",
      source: "Auth",
      level: "warning",
      durationMs: 6000,
    });
  }, [pushNotification]);

  useIdleTimeout({
    enabled: Boolean(token) && idleSettings.enabled && idlePolicyMeta.loaded,
    warningMs: idleSettings.warningMs,
    lockMs: idleSettings.lockMs,
    timeoutMs: idleSettings.timeoutMs,
    isLocked: isWorkspaceLocked,
    resetKey: idleResetSeq,
    onWarn: () => {
      const minutesUntilLock = Math.max(1, Math.ceil((idleSettings.lockMs - idleSettings.warningMs) / 60000));
      pushNotification({
        title: "Inactivity warning",
        message: "Your session will lock in about " + minutesUntilLock + " minute" + (minutesUntilLock === 1 ? "" : "s") + " if it stays inactive.",
        source: "Auth",
        level: "warning",
        durationMs: 9000,
      });
    },
    onLock: () => {
      setIsWorkspaceLocked(true);
      apiFetch("/auth/lock", {
        method: "POST",
        body: {
          id: "lock_session",
          reason: "idle_lock",
        },
      }).catch((err) => {
        if (![404, 405].includes(Number(err?.status))) {
          console.warn("Idle lock notification failed", err);
        }
      });
      const minutesRemaining = Math.max(1, Math.ceil((idleSettings.timeoutMs - idleSettings.lockMs) / 60000));
      pushNotification({
        title: "Workspace locked",
        message: "Your workspace is preserved. It will sign out in about " + minutesRemaining + " minute" + (minutesRemaining === 1 ? "" : "s") + " if it remains locked.",
        source: "Auth",
        level: "warning",
        durationMs: 10000,
      });
    },
    onTimeout: async () => {
      try {
        await apiFetch("/auth/idle-timeout", {
          method: "POST",
          body: {
            id: "idle_timeout",
            reason: "max_idle_expired",
            cleanup: true,
          },
        });
      } catch (err) {
        console.warn("Idle timeout notification failed", err);
      }
      pushNotification({
        title: "Signed out",
        message: "You were signed out after inactivity.",
        source: "Auth",
        level: "warning",
        durationMs: 8000,
      });
      performLogout("idle_timeout");
    },
  });
    // --- Configuration Actions ---
  const handleConfigurationActions = (id,payload) => {
    const resolvedSessionId = resolveConfigurationSessionId();
    if (isWorkspaceLocked) {
      notifyLockedSensitiveAction("configuration controls");
      return;
    }
    if (["save", "remove", "upload"].includes(id) && !requirePermission(PERMISSIONS.CONFIG_WRITE, "configuration changes")) return;
    if (id === "load_default" && !requirePermission(PERMISSIONS.CONFIG_READ, "configuration loading")) return;
    if (id === "change"){
      const { name, value } = payload;
      setConfigurations(prev => normalizeConfigurationStatePatch(prev, name, value));
    }
    else if (id === "save"){
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const formData = payload instanceof FormData
          ? payload
          : new FormData(document.getElementById("configurations_form"));
        const uploadedRuleFile = formData.get("rule_file");
        const hasRuleUpload =
          uploadedRuleFile instanceof File && !!uploadedRuleFile.name;
        if (!resolvedSessionId) {
          alert("Session is still initializing. Please try again in a moment.");
          return;
        }
        setloadscreenState(true);
        const saveBody = hasRuleUpload
          ? formData
          : {
              id: "save",
              session_id: resolvedSessionId,
              configuration: buildConfigurationSavePayload(configurations),
            };
        if (hasRuleUpload) {
          formData.set("id", "save");
          formData.set("session_id", resolvedSessionId);
        }
        apiFetch("/configuration", {
          method: "POST",
          body: saveBody,
        })
        .then((data) => {
          if (isSuccessResponse(data)) {
            if (windowsRef.current.some((windowState) => windowState.type === "source" && String(windowState.id) === String(resolvedSessionId))) {
              updateSourceWindowState(resolvedSessionId, {
                realtimeConfigPersistStatus: "saved",
                realtimeConfigPersistedSessionId: resolvedSessionId,
                realtimeConfigPersistMessage: "Session configuration saved.",
                realtimeStartGuardMessage: null,
              });
            }
            if (hasRuleUpload) {
              const ruleUploadInput = document.getElementById("rule_to_upload");
              const ruleNameInput = document.querySelector('#configurations_form input[name="rule_name"]');
              if (ruleUploadInput) ruleUploadInput.value = "";
              if (ruleNameInput) ruleNameInput.value = "";
              setConfigurations((prev) => ({ ...prev, rule_name: "" }));
              alert("Rule uploaded!");
            } else {
              alert("Configuration saved!");
            }
            fetchConfigurationForSession(resolvedSessionId).then((res) => { if (res.ok) setConfigurations(res.configuration); }).finally(() => setloadscreenState(false));
          } 
          else {
            alert(getConfigurationErrorMessage(data))
            setloadscreenState(false);
          }
        })
        .catch((err) => {
          console.error("err",err);
          alert(getConfigurationErrorMessage(err));
          setloadscreenState(false);
        });    
      }, 300);
    }
    else if (id === "remove"){
      const activeRuleName = payload?.rule || payload?.rule_name || "";
      if (!activeRuleName) {
        alert("Select a rule before removing.");
        return;
      }
      const formData = new FormData();
      formData.append("id", "remove_rule");
      if (!resolvedSessionId) {
        alert("Session is still initializing. Please try again in a moment.");
        return;
      }
      formData.append("session_id", resolvedSessionId);
      formData.append("rule_name", activeRuleName);
      setloadscreenState(true);
      apiFetch("/configuration", {
        method: "POST",
        body: formData,
      })
      .then((data) => {
        if (isSuccessResponse(data)) {
          alert("Rule removed!");
          fetchConfigurationForSession(resolvedSessionId).then((res) => { if (res.ok) setConfigurations(res.configuration); }).finally(() => setloadscreenState(false));
        } else {
          alert(getConfigurationErrorMessage(data, "Could not remove the selected rule. Try again."));
          setloadscreenState(false);
        }
      })
      .catch((err) => {
        console.error("ConfigRemoveErr", err);
        alert(getConfigurationErrorMessage(err, "Could not remove the selected rule. Try again."));
        setloadscreenState(false);
      });
    }
    else if (id === "upload"){
      const importInput = document.getElementById("import_config_file");
      const importFile = importInput?.files?.[0];
      if (!importFile) {
        alert("Select a configuration file first.");
        return;
      }
      const formData = new FormData();
      if (!resolvedSessionId) {
        alert("Session is still initializing. Please try again in a moment.");
        return;
      }
      formData.append("id", "upload");
      formData.append("session_id", resolvedSessionId);
      formData.append("import_config_file", importFile);
      setloadscreenState(true);
      apiFetch("/configuration", {
        method: "POST",
        body: formData,
      })
      .then((data) => {
        if (isSuccessResponse(data)) {
          alert("Configuration uploaded!");
          fetchConfigurationForSession(resolvedSessionId).then((res) => { if (res.ok) setConfigurations(res.configuration); }).finally(() => setloadscreenState(false));
        } else {
          alert(getGraphFetchErrorMessage(data));
          setloadscreenState(false);
        }
        if (importInput) importInput.value = "";
      })
      .catch((err) => {
        console.error("ConfigUploadErr", err);
        alert(getConfigurationErrorMessage(err, "Could not upload configuration. Try again."));
        setloadscreenState(false);
      });
    }
    else if (id === "load_default"){
      const session = resolveConfigurationSessionId();
      if (!session) {
        setloadscreenState(false);
        return;
      }
      debounceRef.current = setTimeout(() => {  
        setloadscreenState(true);
        resetConfigurationForSession(session)
          .then((result) => {
            if (!result.ok) {
              alert(getConfigurationErrorMessage(result, result.message));
              setloadscreenState(false);
              return;
            }
            console.log("defaultConfig:", result.configuration);
            setConfigurations(result.configuration);
            const sourceAutofillPatch = buildSourceWindowAutofillPatch(result.configuration || {});
            if (windowsRef.current.some((windowState) => windowState.type === "source" && String(windowState.id) === String(session))) {
              updateSourceWindowState(session, {
                ...sourceAutofillPatch,
                ...buildToolCredentialWindowPatch(result.configuration || {}),
              });
            }
            setloadscreenState(false);
          })
          .catch((err) => {
            console.error("ConfigErr",err);
            setloadscreenState(false);
          });
      }, 300);
    }
  };
  // --- Toggle Menu Actions ---
  const handleToggleMenu = (id) => {
    if (["toggle_menu_new_source_window", "toggle_menu_upload_source_window"].includes(id) && !requirePermission(PERMISSIONS.SOURCE_CREATE, "source windows")) return;
    if (id === "toggle_menu_new_graph_window" && !requirePermission(PERMISSIONS.GRAPH_CREATE, "graph windows")) return;
    if (id === "configurations" && !requirePermission(PERMISSIONS.CONFIG_READ, "configurations")) return;
    if (isWorkspaceLocked && ["configurations", "toggle_menu_new_graph_window", "toggle_menu_new_chart_window"].includes(id)) {
      notifyLockedSensitiveAction(id === "configurations" ? "configuration controls" : "graph controls");
      return;
    }
    if(id=="toggle_menu_upload_source_window"){
      handleOpenWindows("source", "", null, "upload_source_options");
      setIsToggleMenuOpen(false)
    }
    else if(id=="toggle_menu_new_source_window"){
      handleOpenWindows("source","");
      setIsToggleMenuOpen(false)
    }
    else if(id=="toggle_menu_new_graph_window"){
      handleOpenWindows("graph","");
      setIsToggleMenuOpen(false)      
    }
    else if(id=="toggle_menu_new_chart_window"){
      handleOpenWindows("chart","");
      setIsToggleMenuOpen(false)      
    }
    else if(id=="toggle_menu_new_tabel_window"){
      handleOpenWindows("table","");
      setIsToggleMenuOpen(false)      
    }
    else if(id === "toggle_menu_orientation") {
        setOrientation(prev =>
            prev === "windows" ? "tabs" : "windows"
        );
        setIsToggleMenuOpen(true)
    }
    else if(id === "windows_taskbar") {
      setIsTaskBarOpen(prev => !prev);
    }
    else if(id === "configurations") {
      setIsConfigurationsOpen(prev => !prev);
      setIsSettingsOpen(false);
      setIsReportsOpen(false);
    }
    else if(id === "toggle_menu_new_report_window") {
      setIsReportsOpen(prev => !prev);
      setIsSettingsOpen(false);
      setIsConfigurationsOpen(false);
      setIsToggleMenuOpen(false);
    }
    else if(id === "settings") {
      setIsSettingsOpen(prev => !prev);
      setIsConfigurationsOpen(false);
      setIsReportsOpen(false);
    }
    else if (id === "toggle_menu_mood") {
      setThemeMode(prev => (prev === "light" ? "dark" : "light"));
      setIsToggleMenuOpen(true);
    }
    else{
      setIsToggleMenuOpen(prev => !prev);
    }
  };
  // --- Root Return ---
  // ------------------------
  // Rendering
  // ------------------------
  return (
    <div
      className={showHomeOverlay ? "linkx_app_shell linkx_app_shell--dark_home" : "linkx_app_shell"}
      style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden' }}
    >
      {/*<NetworkBackground />*/}
      <div
        className={isWorkspaceLocked ? "linkx_workspace_layer linkx_workspace_layer--locked" : "linkx_workspace_layer"}
        data-workspace-locked={isWorkspaceLocked ? "true" : "false"}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 1 }}
      >
        {themeMode !== "dark" && !showHomeOverlay && <NavBar onNavAction={handleNavAction} user={user} />}
        <ToggleMenu
            onToggle={handleToggleMenu}
            isToggleMenuOpen={isToggleMenuOpen}
            toggleAction={handleToggleMenu}
            isMaximized={isMaximized}
            windows={windows}
            orientation={orientation}
            menuRef={toggleMenuRef}
            themeMode={themeMode}
            canAccess={canAccess}
        />
        {showDarkFloatingMenu && (
            <div
              className="dark_float_menu_handle"
              ref={darkFloatMenuToggleRef}
              title="Menu"
            >
              <span className="dark_float_menu_handle__btn" onClick={() => handleToggleMenu()}>
                <i>
                  <a />
                </i>
              </span>
            </div>
          )}
        <Taskbar windows={windows} isTaskBarOpen={isTaskBarOpen} activeWindowId={activeWindowId} focusWindow={handleFocusWindow} toggleAction={handleToggleMenu} isCtrlHeld={isCtrlHeld}/>
        <Configurations sessionId={sessionId} actions={handleConfigurationActions} loadscreenState={loadscreenState} setloadscreenState={setloadscreenState} toggleAction={handleToggleMenu} configurations={configurations} isConfigurationsOpen={isConfigurationsOpen} apiFetch={apiFetch} canAccess={canAccess} idleSettings={idleSettings} idlePolicyMeta={idlePolicyMeta} onIdleSettingsChange={updateIdleSettings}/>
        <Settings isSettingsOpen={isSettingsOpen} toggleAction={handleToggleMenu} actor={actor || user} roles={roles} permissions={permissions} canAccess={canAccess} apiFetch={apiFetch} sessionId={sessionId} onNotice={pushNotification} onLogout={() => performLogout("user_logout")} areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled} onBackgroundAnimationsChange={setBackgroundAnimationsEnabled} />
        <Reports isReportsOpen={isReportsOpen} toggleAction={handleToggleMenu} handleOpenWindows={handleOpenWindows} graphAction={handleGraphActions} actor={actor || user} roles={roles} permissions={permissions} canAccess={canAccess} apiFetch={apiFetch} sessionId={sessionId} onNotice={pushNotification} removeNotification={removeNotification} onLogout={() => performLogout("user_logout")} areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled} onBackgroundAnimationsChange={setBackgroundAnimationsEnabled} />
        <Main userName={userName} setSessionId={setSessionId} API_URL={API_URL} debounceRef={debounceRef} setConfigurations={setConfigurations} configurations={configurations} windows={windows} setWindows={setWindows} openWindows={handleOpenWindows} themeMode={themeMode} areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled} />
        {isWorkspaceLocked && (
          <WorkspaceLockOverlay
            user={actor || user}
            isUnlocking={isUnlockingWorkspace}
            lockMinutes={workspaceIdleLockMinutes}
            logoutMinutes={workspaceIdleLogoutMinutes}
            lockRequiresReauth={idleSettings.lockRequiresReauth !== false}
            themeMode={themeMode}
            areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled}
            onUnlock={handleUnlockWorkspace}
            onLogout={() => performLogout("user_logout")}
          />
        )}
        {showHomeOverlay && (
          <HomeMenuOverlay
            orientation={orientation}
            themeMode={themeMode}
            toggleAction={handleToggleMenu}
            canAccess={canAccess}
            areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled}
          />
        )}
        {/* ----------------------
            Windows Container
        ---------------------- */}
          {windows.map(window => (
            <Windows
              {...window}
              key={window.id}
              onFocus={handleFocusWindow}
              // keep all your existing props intact
              id={window.id}
              type={window.type}
              isMaximized={window.isMaximized}
              orientation={orientation}
              configurations={configurations}
              isMinimized={window.isMinimized}
              isDragging={window.isDragging}
              sessionId={window.sessionId}
              isToggleMenuOpen={isToggleMenuOpen}
              isTaskBarOpen={isTaskBarOpen}
              isSideBarMenuOpen={isSideBarMenuOpen}
              loadscreenState={window.loadscreenState}
              loadscreenText={window.loadscreenText}
              windowAction={handleWindowActions}
              handleOpenWindows={handleOpenWindows}
              graphAction={handleGraphActions}
              chartAction={handleChartActions}
              selectedContent={window.selectedContent}
              selectedSubContent={window.selectedSubContent}
              windowResponseI={window.windowResponseI}
              windowResponseII={window.windowResponseII}
              windowRealtimeResponseI={window.windowRealtimeResponseI}
              formToolResponse={window.formToolResponse}
              formRealtimeToolResponse={window.formRealtimeToolResponse}
              sourceAddressType={window.sourceAddressType}// Local
              sourceAddressText={window.sourceAddressText}// Local
              sourceStorageText={window.sourceStorageText}// Local
              sourceTopicText={window.sourceTopicText}// Local
              sourceKind={window.sourceKind}
              sourceStatus={window.sourceStatus}
              toolStatus={window.toolStatus}
              dataframeStatus={window.dataframeStatus}
              streamStatus={window.streamStatus}
              sourceStep={window.sourceStep}
              sourceRealtimeAddressType={window.sourceRealtimeAddressType}// Local
              sourceRealtimeAddressText={window.sourceRealtimeAddressText}// Local
              sourceRealtimeTopicText={window.sourceRealtimeTopicText}// Local
              toolUrl={window.toolUrl}
              toolUsername={window.toolUsername}
              toolPassword={window.toolPassword}
              toolDatabase={window.toolDatabase}
              realtimeToolUrl={window.realtimeToolUrl}
              realtimeToolUsername={window.realtimeToolUsername}
              realtimeToolPassword={window.realtimeToolPassword}
              realtimeToolDatabase={window.realtimeToolDatabase}
              realtimeNeo4jConnectedSessionId={window.realtimeNeo4jConnectedSessionId}
              realtimeConfigPersistStatus={window.realtimeConfigPersistStatus}
              realtimeConfigPersistedSessionId={window.realtimeConfigPersistedSessionId}
              realtimeConfigPersistMessage={window.realtimeConfigPersistMessage}
              realtimeStartGuardMessage={window.realtimeStartGuardMessage}
              batchFilesSearchHybrid={window.batchFilesSearchHybrid}
              batchFilesSearchHiveQuery={window.batchFilesSearchHiveQuery}
              batchFilesSearchStrict={window.batchFilesSearchStrict}
              batchFilesSearchLimit={window.batchFilesSearchLimit}
              batchFilesSearchResults={window.batchFilesSearchResults}
              batchFilesSearchMoreFiles={window.batchFilesSearchMoreFiles}
              searchResultsVisible={window.searchResultsVisible}
              searchPlaceholder={window.searchPlaceholder}
              batchFilesCollection={window.batchFilesCollection}
              batchFilesDataframeInfoI={window.batchFilesDataframeInfoI}
              batchFilesDataframeInfoII={window.batchFilesDataframeInfoII}
              batchFilesDataframeActionValue={window.batchFilesDataframeActionValue}
              batchFilesDataframeRelationshipValue={window.batchFilesDataframeRelationshipValue}
              sourceSessionLog={window.sourceSessionLog}
              sourceStreams={window.sourceStreams}
              sourceStreamListener={window.sourceStreamListener}
              fileInputRef={window.fileInputRef}
              textareaRefs={window.textareaRefs}
              onClose={handleCloseWindow}
              onMove={orientation === 'windows' ? handleMoveWindow : null}
              zIndex={window.zIndex}
              covered={window.covered}
              graphLink={window.graphLink}
              graphStatus={window.graphStatus}
              graphStatusBySession={graphStatus}
              graphRenderStats={window.graphRenderStats}
              activeGraph={window.activeGraph}
              iframeRef={iframeRefs.current[window.id]}
              iframeSettings={iframeSettings}
              iframeSearch={iframeSearch}
              iframePerformanceMood={iframePerformanceMood}
              selectedPropertyTab={window.selectedPropertyTab}
              filterPropertyKeys={window.filterPropertyKeys}
              filterResults={window.filterResults}
              nodeProperties={window.nodeProperties}
              BASE_URL={BASE_URL}
              themeMode={themeMode}
              isWorkspaceLocked={isWorkspaceLocked}
              searchButtonRef={searchButtonRef}
              resultContainerRef={resultContainerRef}
              requestConfirmation={requestConfirmation}
            />
          ))}      

        {/* ----------------------
            Tabs Bar (only visible in tab mode)
        ---------------------- */}
        {orientation === 'tabs' && windows.length > 0 && (
          <div id="window_parent_tabs" className="window_parent_tabs">
            {/* Window bar with tab titles */}
            <div id="window_parent_bar" className="window_parent_bar">
              <div className="window_parent_bar_toggle_menu">
                <div className="toggle_menu_btn">
                  <span ref={tabsToggleButtonRef} onClick={handleToggleMenu}>
                    <i><a></a></i>
                  </span>
                  <label style={{display : isToggleMenuOpen ? 'none':''}}>Linkx | <i>Web Analyzer</i></label>
                </div>
              </div>
              <div className="window_parent_bar_title_container"></div>
            </div>
            <div className="window_parent_tabs_container">
              {windows.map(w => (
                <div
                  key={w.id}
                  className={`tab_title ${activeWindowId === w.id ? 'active' : ''}`}
                  onClick={() => handleFocusWindow(w.id)}
                >
                  {`${w.type.charAt(0).toUpperCase()}${w.type.slice(1)} Window ${w.id}` || `Window ${w.id}`}
                  <div className="tab_title_close_btn" onClick={() => handleCloseWindow(w.id)}>x</div>
                </div>
              ))}
            </div>          
          </div>
        )}
        <ConfirmationDialog items={confirmations} onResolve={resolveConfirmation} />
        <NotificationStack items={notifications} onDismiss={removeNotification} />
      </div>
    </div>
  );
}

function WorkspaceLockOverlay({ user, isUnlocking, lockMinutes, logoutMinutes, lockRequiresReauth, themeMode, areBackgroundAnimationsEnabled, onUnlock, onLogout }) {
  const displayName = user?.display_name || user?.username || user?.client_id || "User";
  const backgroundVideoRef = useRef(null);
  const [backgroundVideoSrc, setBackgroundVideoSrc] = useState(workspaceBackgroundVideo);
  const [isBackgroundVideoUnavailable, setIsBackgroundVideoUnavailable] = useState(false);
  const [backgroundImageSrc, setBackgroundImageSrc] = useState(workspaceBackgroundImage);
  const [isBackgroundImageLoaded, setIsBackgroundImageLoaded] = useState(false);
  const shouldUseBackgroundVideo = themeMode === "dark" && areBackgroundAnimationsEnabled && !isBackgroundVideoUnavailable;

  const playBackgroundVideo = (videoElement = backgroundVideoRef.current) => {
    if (!videoElement) return;
    videoElement.play?.().catch(() => {});
  };

  const handleBackgroundVideoError = () => {
    if (backgroundVideoSrc === workspaceBackgroundVideo) {
      setBackgroundVideoSrc(fallbackWorkspaceBackgroundVideo);
      return;
    }
    setIsBackgroundVideoUnavailable(true);
  };

  const handleBackgroundImageError = () => {
    if (backgroundImageSrc === workspaceBackgroundImage) {
      setIsBackgroundImageLoaded(false);
      setBackgroundImageSrc(fallbackWorkspaceBackgroundImage);
    }
  };

  useEffect(() => {
    if (!shouldUseBackgroundVideo) return;
    backgroundVideoRef.current?.load?.();
    playBackgroundVideo();
  }, [shouldUseBackgroundVideo, backgroundVideoSrc]);

  return (
    <div className="workspace_lock_overlay" role="dialog" aria-modal="true" aria-label="Workspace locked">
      {themeMode === "dark" ? (
        <>
          {shouldUseBackgroundVideo ? (
            <video
              key={backgroundVideoSrc}
              ref={backgroundVideoRef}
              className="workspace_lock_media workspace_lock_media_video"
              autoPlay
              muted
              loop
              playsInline
              preload="auto"
              aria-hidden="true"
              onCanPlay={(event) => playBackgroundVideo(event.currentTarget)}
              onError={handleBackgroundVideoError}
            >
              <source src={backgroundVideoSrc} type="video/mp4" />
            </video>
          ) : (
            <img
              key={backgroundImageSrc}
              className={
                "workspace_lock_media workspace_lock_media_image" +
                (isBackgroundImageLoaded ? " is-loaded" : "")
              }
              src={backgroundImageSrc}
              alt=""
              aria-hidden="true"
              decoding="async"
              loading="eager"
              onLoad={() => setIsBackgroundImageLoaded(true)}
              onError={handleBackgroundImageError}
            />
          )}
          <div className="workspace_lock_scene_overlay" aria-hidden="true" />
        </>
      ) : (
        <div className="workspace_lock_light_plane" aria-hidden="true" />
      )}
      <div className="workspace_lock_panel">
        <h2>Workspace locked</h2>
        <p>{displayName}, your windows and activity are still here.</p>
        <p className="workspace_lock_hint">Locked after {lockMinutes} minute{lockMinutes === 1 ? "" : "s"}. Automatic logout after {logoutMinutes} minute{logoutMinutes === 1 ? "" : "s"} of inactivity.</p>
        <p className="workspace_lock_hint">{lockRequiresReauth ? "Unlock requires re-authentication." : "Unlock keeps the current authenticated session."}</p>
        <div className="workspace_lock_actions">
          <button type="button" onClick={onUnlock} disabled={isUnlocking}>{isUnlocking ? "Unlocking..." : "Unlock"}</button>
          <button type="button" onClick={onLogout} disabled={isUnlocking}>Log out</button>
        </div>
      </div>
    </div>
  );
}

function formatJSON(json) {
  if (!json) return "";
  let str = JSON.stringify(json, null, 2);
  str = str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return str.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
    let cls = 'json_number';
    if (/^"/.test(match)) {
      if (/:$/.test(match)) {
        cls = 'json_key';
      } else {
        cls = 'json_string';
      }
    } else if (/true|false/.test(match)) {
      cls = 'json_boolean';
    } else if (/null/.test(match)) {
      cls = 'json_null';
    }
    return '<span class="' + cls + '">' + match + '</span>';
  });
}

function Reports({ isReportsOpen, toggleAction, handleOpenWindows, graphAction, actor, roles = [], permissions = [], canAccess, apiFetch, sessionId, onNotice, removeNotification, onLogout, areBackgroundAnimationsEnabled = true, onBackgroundAnimationsChange }) {
  const [activeReportsTab, setActiveReportsTab] = useState("parent");
  const [reportsData, setReportsData] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedReport, setSelectedReport] = useState(null);

  const limit = 50;

  const tabs = [
    { id: "parent", label: "Alert reports", endpoint: "/api/v1/reports/parent" },
    { id: "xvigilance", label: "System reports", endpoint: "/api/v1/reports/xvigilance" },
    { id: "evidence", label: "Service evedences", endpoint: "/api/v1/reports/evidence" },
  ];

  const handleDownloadReport = (report) => {
    onNotice({ title: "Coming Soon", message: "Download Report logic will be implemented here.", level: "info" });
  };

  const handleShowGraph = async (traceId) => {
    if (!traceId) {
      onNotice({ title: "Error", message: "No trace ID found for this report.", level: "error" });
      return;
    }

    const notificationId = `fetch-evidence-${traceId}`;
    onNotice({ id: notificationId, title: "Loading", message: "Checking evidence graph data...", level: "info" });
    
    try {
      const payload = { id: "evidence", trace_id: traceId };
      const controller = new AbortController();
      const data = await requestGraphFetch(apiFetch, payload, controller.signal, {
        onQueued: () => {
          onNotice({ id: notificationId, title: "Queued", message: "Evidence graph request is queued...", level: "info" });
        }
      });
      
      const nodes = Array.isArray(data?.results?.nodes) ? data.results.nodes : [];
      const edges = Array.isArray(data?.results?.edges) ? data.results.edges : [];
      
      if (nodes.length === 0 && edges.length === 0) {
        onNotice({ id: notificationId, title: "Archived", message: "This graph evidence is older and has been moved to archive. Please contact the system administrator.", level: "warning" });
        return;
      }
      
      removeNotification(notificationId);
      
      if (typeof handleOpenWindows === "function" && typeof graphAction === "function") {
        const newGraphId = handleOpenWindows("graph", "");
        if (newGraphId) {
          toggleAction("toggle_menu_new_report_window");
          setTimeout(() => {
            graphAction(newGraphId, "get_graph", "evidence", { fetchType: "evidence", traceId: traceId }, { initialData: data });
          }, 150);
        }
      } else {
        onNotice({ title: "Error", message: "Graph manager not available.", level: "error" });
      }
    } catch (e) {
      pushNotification({ id: notificationId, title: "Error", message: e.message || "Failed to fetch graph data.", level: "error" });
    }
  };

  useEffect(() => {
    if (isReportsOpen) {
      loadReports();
    }
  }, [isReportsOpen, activeReportsTab, offset]);

  const loadReports = async () => {
    try {
      setLoading(true);
      setError(null);
      const tabConf = tabs.find(t => t.id === activeReportsTab);
      const url = `${tabConf.endpoint}?limit=${limit}&offset=${offset}`;
      const data = await apiFetch(url, { suppressForbiddenHandler: true });
      setReportsData(data.data || []);
      setTotalCount(data.count || 0);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  const handleTabClick = (tabId) => {
    if (activeReportsTab !== tabId) {
      setActiveReportsTab(tabId);
      setOffset(0);
      setSelectedReport(null);
    }
  };

  const handleNext = () => {
    if (offset + limit < totalCount) {
      setOffset(prev => prev + limit);
      setSelectedReport(null);
    }
  };

  const handlePrev = () => {
    if (offset - limit >= 0) {
      setOffset(prev => prev - limit);
      setSelectedReport(null);
    }
  };



  const renderContent = () => {
    if (error && error.status === 403) {
      return (
        <div style={{ padding: "40px", textAlign: "center", color: "#e74c3c" }}>
          <h2>Access Denied</h2>
          <p>You do not have permission to view this report data.</p>
        </div>
      );
    }
    
    if (error) {
      return <div style={{ padding: "20px", color: "#e74c3c" }}>Error: {error.message}</div>;
    }

    if (loading && reportsData.length === 0) {
      return <div style={{ padding: "20px" }}>Loading reports...</div>;
    }

    return (
      <div className="cleanup_audit_table_wrap" style={{ height: "100%", maxHeight: "none", overflowY: "auto" }}>
          <table className="cleanup_audit_table" cellSpacing="0" cellPadding="0" style={{ width: "100%", height: reportsData.length === 0 ? "100%" : "auto", tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: "25%" }} />
            <col style={{ width: "30%" }} />
            <col style={{ width: "20%" }} />
            <col style={{ width: "25%" }} />
          </colgroup>
          <thead>
            <tr>
              <th>Type</th>
              <th>Source</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {reportsData.length === 0 ? (
              <tr>
                <td colSpan="4" style={{ textAlign: "center", padding: "40px 20px", color: "inherit", opacity: 0.6, borderBottom: "none", verticalAlign: "middle" }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "40px", height: "40px", marginBottom: "10px", opacity: 0.5 }}>
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <div style={{ fontSize: "14px", fontWeight: "500" }}>No reports found</div>
                  <div style={{ fontSize: "12px", marginTop: "4px" }}>Try adjusting your filters or date range.</div>
                </td>
              </tr>
            ) : (
              reportsData.map(report => {
                const s = (report.status || "").toLowerCase();
                let statusStyle = { background: "rgba(241, 196, 15, 0.15)", color: "#f39c12", border: "1px solid rgba(241, 196, 15, 0.4)" };
                if (s === "completed" || s === "success" || s === "new") statusStyle = { background: "rgba(46, 204, 113, 0.15)", color: "#27ae60", border: "1px solid rgba(46, 204, 113, 0.4)" };
                else if (s === "failed" || s === "error") statusStyle = { background: "rgba(231, 76, 60, 0.15)", color: "#c0392b", border: "1px solid rgba(231, 76, 60, 0.4)" };
                else if (s === "resolved") statusStyle = { background: "rgba(149, 165, 166, 0.15)", color: "#7f8c8d", border: "1px solid rgba(149, 165, 166, 0.4)" };
                
                const isArchived = (new Date() - new Date(report.created_at)) > 180 * 24 * 60 * 60 * 1000;

                return (
                  <tr 
                    key={report.id} 
                    onClick={() => setSelectedReport(report)}
                    className={selectedReport?.id === report.id ? "active_row" : ""}
                    title={isArchived ? "Archived (Older than 180 days)" : ""}
                    style={{ 
                      cursor: "pointer", 
                      transition: "background 0.2s",
                      opacity: isArchived ? 0.5 : 1,
                      filter: isArchived ? "grayscale(80%)" : "none"
                    }}
                  >
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "12px", height: "12px", opacity: 0.5 }}>
                          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                          <line x1="7" y1="7" x2="7.01" y2="7"></line>
                        </svg>
                        <b style={{ fontWeight: "600", fontSize: "12px" }}>{report.report_type}</b>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "12px", height: "12px", opacity: 0.5 }}>
                          <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                        </svg>
                        <span style={{ fontWeight: "500", fontSize: "12px", opacity: 0.9 }}>{report.source_system}</span>
                      </div>
                    </td>
                    <td>
                      <span style={{ 
                        background: statusStyle.background, 
                        color: statusStyle.color, 
                        border: statusStyle.border,
                        padding: "3px 8px", 
                        borderRadius: "12px", 
                        fontSize: "10px", 
                        fontWeight: "700",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px"
                      }}>
                        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: statusStyle.color }} />
                        {report.status}
                      </span>
                    </td>
                    <td style={{ opacity: 0.6, fontSize: "11px", fontWeight: "500" }}>
                      {new Date(report.created_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div id="configurations_container" style={{ display: isReportsOpen ? "block" : "none" }}>
      <div className="configurations_options_container settings_options_container" style={{ display: "flex", flexDirection: "row", width: "90%", maxWidth: "1200px" }}>
        
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div className="configurations_options_container_bar">
            <span onClick={() => toggleAction("toggle_menu_new_report_window")}>x</span>
            <label>Reports</label>
          </div>
          <div className="configurations_options" style={{ display: "flex", flexDirection: "column", height: "calc(100% - 30px)" }}>
            <div className="configurations_tabs">
              {tabs.map((tab) => (
                <button key={tab.id} type="button" className={activeReportsTab === tab.id ? "active" : ""} onClick={() => handleTabClick(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>
            <form className="configurations_tab_form" onSubmit={(event) => event.preventDefault()} style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
              <div className="configurations_options_panel" style={{ flex: 1, overflow: "hidden", padding: 0 }}>
                {renderContent()}
              </div>
            </form>
            <div className="cleanup_audit_actions">
              <span className="sublabel" style={{ fontWeight: "500", opacity: 0.8 }}>
                Showing {reportsData.length > 0 ? offset + 1 : 0} to {Math.min(offset + limit, totalCount)} of {totalCount}
              </span>
              <div style={{ display: "flex", gap: "12px" }}>
                <button type="button" onClick={() => loadReports()} disabled={loading} style={{ display: "flex", alignItems: "center", gap: "6px" }} title="Refresh reports">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "14px", height: "14px" }}>
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <polyline points="1 20 1 14 7 14"></polyline>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                  </svg>
                  Refresh
                </button>
                <button type="button" onClick={handlePrev} disabled={offset === 0 || loading}>Previous</button>
                <button type="button" onClick={handleNext} disabled={offset + limit >= totalCount || loading}>Next</button>
              </div>
            </div>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedReport && (() => {
          const s = (selectedReport.status || "").toLowerCase();
          let statusStyle = { background: "rgba(241, 196, 15, 0.15)", color: "#f39c12" };
          if (s === "completed" || s === "success" || s === "new") statusStyle = { background: "rgba(46, 204, 113, 0.15)", color: "#27ae60" };
          else if (s === "failed" || s === "error") statusStyle = { background: "rgba(231, 76, 60, 0.15)", color: "#c0392b" };
          else if (s === "resolved") statusStyle = { background: "rgba(149, 165, 166, 0.15)", color: "#7f8c8d" };
          
          return (
            <div id="report_detail_panel_wrap" style={{ width: "340px", display: "flex", flexDirection: "column", background: "rgb(255, 255, 255)", borderLeft: "1px dashed rgb(217, 197, 177)", zIndex: 2, animation: "slideInPanel 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards", overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "16px 30px", borderBottom: "1px solid rgba(128,128,128,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div style={{ 
                    width: "28px", 
                    height: "28px", 
                    borderRadius: "50%", 
                    background: "var(--window-parent-bar-bg-color, #131e2a)", 
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 2px 5px rgba(0,0,0,0.15)"
                  }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "13px", height: "13px" }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                  </div>
                  <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", letterSpacing: "0.5px", color: "var(--window-parent-bar-bg-color, #131e2a)" }}>Report Details</h3>
                </div>
                <button 
                  type="button" 
                  onClick={() => {
                    const panel = document.getElementById("report_detail_panel_wrap");
                    if(panel) {
                      panel.style.animation = "slideOutPanel 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards";
                      setTimeout(() => setSelectedReport(null), 280);
                    } else {
                      setSelectedReport(null);
                    }
                  }} 
                  style={{ 
                    background: "rgba(128,128,128,0.08)", 
                    border: "1px solid rgba(128,128,128,0.2)", 
                    cursor: "pointer", 
                    width: "26px", 
                    height: "26px", 
                    borderRadius: "6px", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center", 
                    color: "inherit", 
                    opacity: 0.7, 
                    transition: "opacity 0.2s" 
                  }} 
                  onMouseOver={(e) => e.target.style.opacity = 1} 
                  onMouseOut={(e) => e.target.style.opacity = 0.7}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: "14px", height: "14px" }}>
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                </button>
              </div>
              
              {/* Body */}
              <div style={{ flex: 1, overflowY: "auto", padding: "20px 30px" }}>
                
                {/* Top Pills / Cards */}
                <div style={{ display: "flex", gap: "8px", marginBottom: "25px", flexWrap: "wrap" }}>
                  
                  {/* Type Card */}
                  <div style={{ 
                    flex: "1 1 30%",
                    padding: "8px", 
                    borderRadius: "8px", 
                    background: "rgba(52, 152, 219, 0.06)", 
                    border: "1px solid rgba(52, 152, 219, 0.25)",
                    color: "#2980b9",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}>
                    <div style={{ background: "rgba(52, 152, 219, 0.15)", padding: "5px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "12px", height: "12px" }}>
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path>
                        <line x1="7" y1="7" x2="7.01" y2="7"></line>
                      </svg>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
                      <span style={{ opacity: 0.8, fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.5px", color: "inherit" }}>Type</span>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedReport.report_type}</span>
                    </div>
                  </div>
                  
                  {/* Source Card */}
                  <div style={{ 
                    flex: "1 1 30%",
                    padding: "8px", 
                    borderRadius: "8px", 
                    background: "rgba(155, 89, 182, 0.06)", 
                    border: "1px solid rgba(155, 89, 182, 0.25)",
                    color: "#8e44ad",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}>
                    <div style={{ background: "rgba(155, 89, 182, 0.15)", padding: "5px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "12px", height: "12px" }}>
                        <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                      </svg>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
                      <span style={{ opacity: 0.8, fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.5px", color: "inherit" }}>Source</span>
                      <span style={{ fontSize: "11px", fontWeight: "700", color: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedReport.source_system}</span>
                    </div>
                  </div>
                  
                  {/* Status Card */}
                  <div style={{ 
                    flex: "1 1 30%",
                    padding: "8px", 
                    borderRadius: "8px", 
                    background: statusStyle.background, 
                    border: `1px solid ${statusStyle.color}40`,
                    color: statusStyle.color,
                    display: "flex",
                    alignItems: "center",
                    gap: "8px"
                  }}>
                    <div style={{ background: `${statusStyle.color}25`, padding: "5px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: "12px", height: "12px" }}>
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                      </svg>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
                      <span style={{ opacity: 0.8, fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.5px", color: "inherit" }}>Status</span>
                      <span style={{ fontSize: "11px", fontWeight: "700", textTransform: "uppercase", color: "inherit", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedReport.status}</span>
                    </div>
                  </div>

                </div>

                {/* Main Grid */}
                <div className="profile_grid" style={{ border: "none", padding: "0" }}>
                  <span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <line x1="16" y1="13" x2="8" y2="13"></line>
                      <line x1="16" y1="17" x2="8" y2="17"></line>
                      <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    ID
                  </span>
                  <b>{selectedReport.id}</b>
                  
                  <span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                    </svg>
                    Ref ID
                  </span>
                  <b>{selectedReport.external_reference_id || "-"}</b>
                  
                  <span>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <polyline points="12 6 12 12 16 14"></polyline>
                    </svg>
                    Created
                  </span>
                  <b>{new Date(selectedReport.created_at).toLocaleString()}</b>
                </div>
                
                {/* Payload Section */}
                <div style={{ borderTop: "1px solid rgba(128,128,128,0.15)", paddingTop: "20px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                    <span style={{ display: "block", opacity: 0.7, fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Payload Data</span>
                    <button 
                      type="button" 
                      onClick={() => {
                        navigator.clipboard.writeText(JSON.stringify(selectedReport.payload, null, 2));
                        onNotice({ title: "Copied", message: "Payload copied to clipboard", level: "info" });
                      }}
                      style={{ background: "transparent", border: "1px solid rgba(128,128,128,0.3)", borderRadius: "4px", padding: "4px 8px", fontSize: "10px", cursor: "pointer", opacity: 0.8, color: "inherit", transition: "opacity 0.2s" }}
                      onMouseOver={(e) => e.target.style.opacity = 1}
                      onMouseOut={(e) => e.target.style.opacity = 0.8}
                    >
                      Copy JSON
                    </button>
                  </div>
                  <div style={{ padding: "12px", background: "rgba(128,128,128,0.05)", border: "1px solid rgba(128,128,128,0.1)", borderRadius: "6px" }}>
                    <pre 
                      style={{ margin: 0, fontSize: "inherit", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "inherit" }}
                      dangerouslySetInnerHTML={{ __html: formatJSON(selectedReport.payload) }}
                    />
                  </div>
                </div>
              </div>

              {/* Footer Action */}
              <div style={{ padding: "16px 30px", borderTop: "1px solid rgba(128,128,128,0.15)", background: "rgba(128,128,128,0.02)" }}>
                <button 
                  type="button"
                  className="report_tab_btn active"
                  style={{ 
                    width: "100%", 
                    padding: "10px", 
                    fontWeight: "600", 
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "opacity 0.2s, box-shadow 0.2s"
                  }}
                  onMouseOver={(e) => e.target.style.opacity = 0.85}
                  onMouseOut={(e) => e.target.style.opacity = 1}
                  onClick={() => handleShowGraph(selectedReport.external_reference_id || selectedReport.id)}
                >
                  Show Graph
                </button>
                <button 
                  type="button" 
                  className="report_tab_btn"
                  style={{ 
                    width: "100%", 
                    padding: "10px", 
                    fontWeight: "600", 
                    borderRadius: "6px",
                    cursor: "pointer",
                    background: "transparent",
                    color: "inherit",
                    border: "1px solid rgba(128,128,128,0.3)",
                    transition: "opacity 0.2s, background 0.2s"
                  }}
                  onMouseOver={(e) => { e.target.style.background = "rgba(128,128,128,0.1)"; }}
                  onMouseOut={(e) => { e.target.style.background = "transparent"; }}
                  onClick={() => handleDownloadReport(selectedReport)}
                >
                  Download Report
                </button>
              </div>
            </div>
          );
        })()}

      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const auth = useAuth();

  if (!auth.isAuthReady) {
    const isParentProjectCallback = typeof window !== "undefined" && window.location.pathname === "/auth/callback";
    const loadingText = isParentProjectCallback
      ? "Completing Parent project sign-in"
      : auth.isSsoAuthenticating
        ? "Completing single sign-on"
        : "Checking authentication";
    return <Loadscreen loadingText={loadingText} />;
  }

  return <LinkxWorkspace />;
}

function Root() {
  const API_URL = import.meta.env.VITE_API_URL;
  return (
    <AuthProvider apiUrl={API_URL}>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

export default Root;
