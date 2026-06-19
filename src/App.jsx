import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { io } from 'socket.io-client';
import { createPortal } from 'react-dom';

import './main.css'
import NetworkBackground from './networkAnimation.jsx'
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
const TRUSTED_IFRAME_MESSAGE_TYPES = new Set(["app_notification", "notification", "nodeProperties", "all_property_keys_response", "graph_search_results", "network_components", "entity_selection", "graph_alerts", "pinned_evidence_update", "clipboard_get", "clipboard_set"]);
const IDLE_TIMEOUT_STORAGE_KEY = "linkx_idle_timeout_settings";
const DEFAULT_IDLE_WARNING_MS = 14 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
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
  const fallbackWarning = clampMs(fallback.warningMs ?? DEFAULT_IDLE_WARNING_MS, 0, Math.max(0, timeoutMs - 1000));
  const warningMs = clampMs(value.warningMs ?? fallbackWarning, 0, Math.max(0, timeoutMs - 1000));

  return {
    enabled: value.enabled !== false,
    warningMs,
    timeoutMs,
  };
};

const getDefaultIdleSettings = () => normalizeIdleSettings({
  enabled: String(import.meta.env.VITE_IDLE_TIMEOUT_ENABLED || "true").toLowerCase() !== "false",
  warningMs: parsePositiveMs(import.meta.env.VITE_IDLE_WARNING_MS, DEFAULT_IDLE_WARNING_MS),
  timeoutMs: parsePositiveMs(import.meta.env.VITE_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS),
});

const readStoredIdleSettings = (fallback) => {
  try {
    const raw = localStorage.getItem(IDLE_TIMEOUT_STORAGE_KEY);
    if (!raw) return fallback;
    return normalizeIdleSettings(JSON.parse(raw), fallback);
  } catch {
    return fallback;
  }
};

const persistIdleSettings = (settings) => {
  try {
    localStorage.setItem(IDLE_TIMEOUT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage failures; the active session still uses the selected value.
  }
};

function useIdleTimeout({ enabled, warningMs, timeoutMs, isLocked = false, resetKey = 0, onWarn, onTimeout }) {
  const warningTimerRef = useRef(null);
  const timeoutTimerRef = useRef(null);
  const onWarnRef = useRef(onWarn);
  const onTimeoutRef = useRef(onTimeout);
  const isLockedRef = useRef(isLocked);

  useEffect(() => {
    onWarnRef.current = onWarn;
  }, [onWarn]);

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
    if (timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, []);

  const resetIdleTimers = useCallback(() => {
    clearIdleTimers();
    if (!enabled || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;

    if (Number.isFinite(warningMs) && warningMs > 0 && warningMs < timeoutMs) {
      warningTimerRef.current = setTimeout(() => {
        onWarnRef.current?.();
      }, warningMs);
    }

    timeoutTimerRef.current = setTimeout(() => {
      onTimeoutRef.current?.();
    }, timeoutMs);
  }, [clearIdleTimers, enabled, timeoutMs, warningMs]);

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

const extractMainSessionId = (data) => normalizeSessionId(
  data?.results?.session_id ??
  data?.results?.sessionId ??
  data?.results?.id ??
  data?.session_id ??
  data?.sessionId ??
  data?.configurations?.session_id ??
  data?.results
);


const sanitizeGraphEndpointId = (value = "", { maxLength = 128 } = {}) => (
  stripControlChars(value).replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, maxLength)
);

const getTrustedMessageOrigin = () => window.location.origin;
const buildIframeMessage = (action, payload = {}) => ({ channel: LINKX_IFRAME_CHANNEL, version: LINKX_IFRAME_VERSION, action, payload });
const getIframeMessageAction = (data) => data?.action || data?.type || "";
const isTrustedMessageOrigin = (event) => String(event?.origin || "") === getTrustedMessageOrigin();
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
  const emitList = normalizeStrReportSocketEmitList(socketEmit);
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
  const streamStatus = win.streamStatus || (win.sourceStreamListener || win.windowResponseI === "Session running..." ? STREAM_STATUSES.RUNNING : STREAM_STATUSES.IDLE);
  const sourceStep = win.sourceStep || sourceStepFromSubContent(win.selectedSubContent);

  return { sourceKind, sourceStatus, toolStatus, dataframeStatus, streamStatus, sourceStep };
};

const isSourceConnectedState = (flow) => flow.sourceStatus === SOURCE_STATUSES.CONNECTED;
const isSourceUploadedState = (flow) => flow.sourceStatus === SOURCE_STATUSES.UPLOADED || flow.sourceKind === SOURCE_KINDS.UPLOAD;
const isToolConnectedState = (flow) => flow.toolStatus === TOOL_STATUSES.CONNECTED;

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

  if (status === "Session running...") {
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
        getTrustedMessageOrigin()
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
    e.source?.postMessage(
      { type: "clipboard_data", payload },
      e.origin
    );
  }

  if (e.data?.type === "clipboard_set") {
    clipboard = normalizeClipboardPayload(e.data.payload);
    broadcastClipboard();
  }
});
/** Dark + zero windows: upload dropzone and quick actions over the workspace background. */
function DarkHomeMenuOverlay({ toggleAction, canAccess = () => true, areBackgroundAnimationsEnabled = false }) {
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
      icon: "+",
      action: "toggle_menu_new_source_window",
      permission: PERMISSIONS.SOURCE_CREATE,
    },
    {
      label: "New Graph",
      icon: "✣",
      action: "toggle_menu_new_graph_window",
      permission: PERMISSIONS.GRAPH_CREATE,
    },
    {
      label: "Saved Graphs",
      icon: "▣",
      action: "saved_graphs",
      disabled: true,
    },
    {
      label: "Settings",
      icon: "⚙",
      action: "settings",
    },
    {
      label: "Configurations",
      icon: "☷",
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
                  <li onClick={() => toggleAction("toggle_menu_new_source_window")}>    
                    {/*<i>
                      <Icons id="toggle_menu" type="source_window" condition="True"/>
                    </i> */}  
                    <span>&#10011; &nbsp;Source window</span>
                  </li>
                  )}
                  {canAccess(PERMISSIONS.GRAPH_CREATE) && (
                  <li onClick={() => toggleAction("toggle_menu_new_graph_window")}>    
                    {/*<i>
                      <Icons id="toggle_menu" type="garph_window" condition="True"/>
                    </i>  */}            
                    <span>&#10011; &nbsp;Graph window</span>
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
  const label = user?.display_name || user?.username || "User";
  return (
    <nav id="nav_bar">
      <span onClick={() => onNavAction("logout")}>Logout ({label})</span>
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
function Configurations({sessionId,actions,loadscreenState,setloadscreenState,toggleAction,configurations,isConfigurationsOpen,apiFetch,canAccess,idleSettings,onIdleSettingsChange}) {
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
  const largeSearchBackend = normalizeLargeSearchBackend(parsedConfig?.large_search_backend);
  const elasticScrollLimit = normalizeElasticScrollLimit(parsedConfig?.elastic_scroll_limit);
  const idleTimeoutMinutes = Math.max(1, Math.round((idleSettings?.timeoutMs || DEFAULT_IDLE_TIMEOUT_MS) / 60000));
  const idleWarningMinutes = Math.max(0, Math.round((idleSettings?.warningMs || DEFAULT_IDLE_WARNING_MS) / 60000));

  const updateIdleMinutes = (key, value) => {
    const minutes = Math.max(key === "warningMs" ? 0 : 1, Math.min(1440, Number.parseInt(value, 10) || 0));
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

                <label>API search Endpoint</label>
                <input
                  type="text"
                  name="search_api_endpoint"
                  className="input_text"
                  placeholder="API search Endpoint"
                  value={parsedConfig?.search_api_endpoint || ""}
                  onChange={(e) => actions("change", { name: e.target.name, value: e.target.value })}
                />

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
                  type="text"
                  name="active_tool_password"
                  className="input_text"
                  placeholder="Password"
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


              <fieldset style={{ display: activeConfigTab === "system" ? "block" : "none" }}>
                <legend>Interaction timeout</legend>
                <input
                  type="checkbox"
                  id="idle_timeout_enabled"
                  className="input_checkbox"
                  checked={idleSettings?.enabled !== false}
                  onChange={(event) => onIdleSettingsChange?.((previous) => ({ ...previous, enabled: event.target.checked }))}
                />
                <label htmlFor="idle_timeout_enabled" className="sublabel">Lock inactive users</label>

                <div className="idle_timeout_grid">
                  <label>Lock after
                    <input
                      type="number"
                      min="0"
                      max="1439"
                      value={idleWarningMinutes}
                      onChange={(event) => updateIdleMinutes("warningMs", event.target.value)}
                      disabled={idleSettings?.enabled === false}
                    />
                  </label>
                  <label>Logout after
                    <input
                      type="number"
                      min="1"
                      max="1440"
                      value={idleTimeoutMinutes}
                      onChange={(event) => updateIdleMinutes("timeoutMs", event.target.value)}
                      disabled={idleSettings?.enabled === false}
                    />
                  </label>
                </div>
                <label className="idle_timeout_hint">Lock preserves the workspace. Logout clears it only if the user stays away.</label>
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

const DATAFRAME_JOB_POLL_INTERVAL_MS = 2000;
const DATAFRAME_JOB_MAX_POLLS = 150;
const DATAFRAME_JOB_PENDING_STATUSES = new Set(["queued", "pending", "running", "started", "processing", "in_progress"]);
const DATAFRAME_JOB_SUCCESS_STATUSES = new Set(["succeeded", "success", "completed", "done"]);
const DATAFRAME_JOB_FAILURE_STATUSES = new Set(["failed", "failure", "error", "cancelled", "canceled"]);

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const getDataframeJobId = (data) => (
  data?.job_id ??
  data?.jobId ??
  data?.results?.job_id ??
  data?.results?.jobId ??
  data?.result?.job_id ??
  data?.result?.jobId ??
  null
);

const getDataframeJobStatus = (data) => String(
  data?.status ??
  data?.results?.status ??
  data?.result?.status ??
  ""
).trim().toLowerCase();

const isQueuedDataframeJobResponse = (data) => (
  Number(data?.__httpStatus) === 202 &&
  isSuccessResponse(data) &&
  data?.results?.accepted === true &&
  !!getDataframeJobId(data)
);

const getDataframeJobMessage = (data) => (
  data?.message ??
  data?.error ??
  data?.results?.message ??
  data?.results?.error ??
  data?.result?.message ??
  data?.result?.error ??
  "Dataframe job failed"
);

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

  if (data?.results && !DATAFRAME_JOB_SUCCESS_STATUSES.has(getDataframeJobStatus(data?.results))) {
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

const pollDataframeCreationJob = async (apiFetch, jobId) => {
  for (let attempt = 0; attempt < DATAFRAME_JOB_MAX_POLLS; attempt += 1) {
    const data = await apiFetch(`/jobs/${encodeURIComponent(jobId)}`, {
      method: "GET",
    });
    const status = getDataframeJobStatus(data);

    if (DATAFRAME_JOB_SUCCESS_STATUSES.has(status)) {
      return normalizeCompletedDataframeJob(data);
    }
    if (DATAFRAME_JOB_FAILURE_STATUSES.has(status)) {
      throw new Error(getDataframeJobMessage(data));
    }
    if (!DATAFRAME_JOB_PENDING_STATUSES.has(status) && isSuccessResponse(data)) {
      return data;
    }

    await delay(DATAFRAME_JOB_POLL_INTERVAL_MS);
  }

  throw new Error(`Dataframe job ${jobId} did not finish in time`);
};

const requestDataframeCreation = async (apiFetch, payload) => {
  const data = await apiFetch("/live_batch_files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const jobId = getDataframeJobId(data);
  const status = getDataframeJobStatus(data);

  if (isQueuedDataframeJobResponse(data) || (jobId && DATAFRAME_JOB_PENDING_STATUSES.has(status))) {
    return pollDataframeCreationJob(apiFetch, jobId);
  }

  return data;
};

const extractConfigurationPayload = (data) => (
  data?.results?.data ?? data?.results?.configuration ?? data?.configuration ?? data?.data ?? null
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

const normalizeLargeSearchBackend = (value) => (
  LARGE_SEARCH_BACKENDS.has(String(value || "")) ? String(value) : DEFAULT_LARGE_SEARCH_BACKEND
);

const normalizeConfigurationFieldValue = (name, value) => {
  if (name === "storage_tables" || name === "active_tool_tables") {
    return Array.isArray(value) ? value : String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
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
      toolDatabase: "",
      realtimeToolUrl: "",
      realtimeToolUsername: "",
      realtimeToolPassword: "",
      realtimeToolDatabase: "",
    };
  }

  const brokerAddress = getConfigValue(configurations, ["active_kafka_adress", "kafka_custom_address", "active_REST_API"]);
  const storageAddress = getConfigValue(configurations, ["active_storage_address", "storage_custom_address", "storage_address"]);

  const toolUrl = getConfigValue(configurations, ["active_tool_url", "active_tool_protocol"]);
  const toolUsername = getConfigValue(configurations, "active_tool_username");
  const toolPassword = getConfigValue(configurations, "active_tool_password");
  const toolDatabase = getConfigValue(configurations, ["active_tool_database", "custom_tool_database"]);

  return {
    sourceAddressType: "broker",
    sourceAddressText: brokerAddress,
    sourceStorageText: storageAddress,
    sourceTopicText: "",
    sourceRealtimeAddressType: "broker",
    sourceRealtimeAddressText: brokerAddress,
    sourceRealtimeTopicText: "",
    toolUrl,
    toolUsername,
    toolPassword,
    toolDatabase,
    realtimeToolUrl: toolUrl,
    realtimeToolUsername: toolUsername,
    realtimeToolPassword: toolPassword,
    realtimeToolDatabase: toolDatabase,
  };
};


const normalizeLoadedConfiguration = (payload) => {
  if (!payload) return {};
  if (payload.value) return payload;
  return payload;
};

const buildConfigurationSavePayload = (configuration) => {
  const parsed = parseConfigurationValue(configuration);
  const { value: _value, ...rest } = parsed;
  const largeSearchBackend = normalizeLargeSearchBackend(rest.large_search_backend);

  return {
    ...rest,
    large_search_backend: largeSearchBackend,
    elastic_scroll_enabled: largeSearchBackend === "elastic_scroll",
    elastic_scroll_limit: normalizeElasticScrollLimit(rest.elastic_scroll_limit),
  };
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
  const [audit, setAudit] = useState({ items: [], total: 0, limit: 20, offset: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const loadedRef = useRef(false);
  const canManageUsers = typeof canAccess === "function" && canAccess("users:manage");

  const updateFilter = (name, value) => {
    setFilters((prev) => ({ ...prev, [name]: sanitizeText(value, { maxLength: 120 }) }));
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
function WindowVerticalSplitPanels({id, type, sourceId, initialTopHeight, minTopHeight, maxTopHeight, graphStatus, activeGraph, graphAction, iframeRef, iframeSearch, iframeSettings, performanceMood, selectedPropertyTab, nodeProperties, filterPropertyKeys, filterResults}) {
  const containerRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(0);
  const [topHeightPx, setTopHeightPx] = useState(0);
  const isDragging = useRef(false);
  const minHeightPx = useRef(0);
  const maxHeightPx = useRef(0);

  const settings = normalizeGraphIframeSettings(iframeSettings[id]);
  const search = Array.isArray(iframeSearch[id]) ? iframeSearch[id] : ["", false, {}, { nodes: 0, edges: 0 }];
  const selectedSearchKeysCount = Object.values(search[2] || {}).filter(Boolean).length;
  console.log("search:",search,"activeGraph:",activeGraph)

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
                  disabled={!activeGraph}>
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
                  <option value="hierarchical">hierarchical</option>
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
            <input id="allrelationships" name="relationship" type="radio" />
            <label htmlFor="allrelationships">*</label>
          </li>
          {graphStatus && graphStatus.map((rel, index) => (
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
function IframeEmbed({wId,id,fileName,title,activeGraph,graphAction,iframeRef,BASE_URL}) {
  const normalizedBaseUrl = String(BASE_URL || import.meta.env.BASE_URL || "").replace(/\/+$/, "");
  const iframeBasePath = `${normalizedBaseUrl}/linkxDS2026/temp_placeholders`;
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
          sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
          src={`${iframeBasePath}/source_placeholder.html`}
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
          sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
          src={`${iframeBasePath}/graph_placeholder.html`}
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
          sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
          src={`${iframeBasePath}/charts_basic.html`}
          width="100%"
          height="98%"
          style={{ border: 'none' }}
          title={`${title}`}
        />        
      </div>
    );
  }
  else{
    return (
      <div className="iframe_graph">
        <iframe
          ref={iframeRef}
          sandbox="allow-scripts allow-same-origin allow-downloads allow-modals"
          src={`${iframeBasePath}/${activeGraph}.html`}
          width="100%"
          height="98%"
          style={{ border: 'none' }}
          title={`${title}`}
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
{console.log("isDragging:", isDragging)}
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
function Windows({ id, type, isMaximized, isDragging, sessionId, loadscreenText, loadscreenState, isSideBarMenuOpen, orientation, configurations, windowAction, graphAction, chartAction, selectedContent, selectedSubContent, selectedNodes, selectedEdges,windowResponseI,windowResponseII,windowRealtimeResponseI,formToolResponse,formRealtimeToolResponse,sourceAddressType,sourceAddressText,sourceStorageText,sourceTopicText,sourceKind,sourceStatus,toolStatus,dataframeStatus,streamStatus,sourceStep,sourceRealtimeAddressType,sourceRealtimeAddressText,sourceRealtimeTopicText,toolUrl,toolUsername,toolPassword,toolDatabase,realtimeToolUrl,realtimeToolUsername,realtimeToolPassword,realtimeToolDatabase,batchFilesSearchHybrid,batchFilesSearchHybridQuery,batchFilesSearchStrict,searchText,batchFilesSearchLimit,batchFilesSearchResults,batchFilesSearchMoreFiles,searchResultsVisible,searchPlaceholder,batchFilesCollection, batchFilesDataframeInfoI, batchFilesDataframeInfoII, batchFilesDataframeActionValue, batchFilesDataframeSourceValue, batchFilesDataframeTargetValue, batchFilesDataframeRelationshipValue, batchFilesDataframeRuleValue, sourceSessionLog, sourceStreams , sourceStreamListener, fileInputRef, textareaRefs, onClose, onMove, zIndex, onFocus, covered, graphLink, graphLinkId, graphLinkSource, graphStatus, activeGraph, chartLink, chartLinkId, activechart, iframeRef, iframeFilters, iframeSettings, iframeSearch, iframePerformanceMood, selectedPropertyTab, filterPropertyKeys, filterResults, nodeProperties, BASE_URL, searchButtonRef, resultContainerRef, requestConfirmation }) {
  const canCancelGraphStaging = type === "graph" && typeof loadscreenText === "string" && loadscreenText.toLowerCase().startsWith("staging graph");
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
              <div className="window_bar_title_container">Source Window<input placeholder="Add custom title" type="text"/></div>
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
                    <IframeEmbed wId={id} id="source_placeholder" fileName="source_placeholder" activeGraph={activeGraph} graphAction={graphAction} iframeRef={iframeRef} BASE_URL={BASE_URL}/>
                  </div>
                )}
                {selectedContent === "live_source_options" && (
                  <div className="live_source_options_container">
                    <div className="" style={{fontSize:'2.5vh',borderBottom:'1px solid var(--input-border)', color:'var(--app-text)', padding:'2vh',textAlign:'left',paddingLeft:'0vw',margin:'1.5vw'}}>Pick a source input</div>
                    <div className="live_source_option" onClick={() => windowAction(id,"real_time_input","update")}>
                      <span className="live_source_option_icon">
                        <Icons id="window_live_source_option" type="realTime_input" condition="True"/> 
                      </span>
                      <span className="live_source_option_details">
                        <label style={sourceOptionTitleStyle}>Real-time input</label>
                        <p style={sourceOptionBodyStyle}>Connect to a Broker/API and consume data as a Real-time messages.</p>
                      </span>
                    </div>
                    <div className="live_source_option" onClick={() => windowAction(id,"batch_input","update")}>
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
                    <div className="" style={{fontSize:'2.5vh',borderBottom:'1px solid var(--input-border)', color:'var(--app-text)', padding:'2vh',textAlign:'left',paddingLeft:'0vw',margin:'1.5vw',marginBottom:0}}>Pick a source input</div>
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
                    <div className="" style={{fontSize:'2.5vh',borderBottom:'1px solid var(--input-border)', color:'var(--app-text)', padding:'2vh',textAlign:'left',paddingLeft:'0vw',margin:'1.5vw',marginBottom:0}}>Pick a source input</div>
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
                              console.log("render sourceAddress:", brokerAddress);
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
                                <div id="batch_files_search_container" className="batch_files_search_container">
                                  <input id="batch_files_search_input" className="batch_files_search_text_input" type="text" placeholder="Type here to seach" required/>
                                  <input id="batch_files_search_date" className="batch_files_search_date_input" type="date"/>
                                  <button ref={searchButtonRef} id="batch_files_search_button" title="Search" onClick={() => windowAction(id,"batch_files_search_input","search",[document.getElementById("batch_files_search_input").value,document.getElementById("batch_files_search_date").value,batchFilesSearchHybrid,document.getElementById("batch_files_search_column").value,document.getElementById("batch_files_search_strict").checked])}>
                                   <Icons id="window_live_source_option" type="search" condition="True"/>
                                  </button>
                                  <button title="Search"><Icons id="window_live_source_option" type="inbox-files" condition="True"/></button>
                                </div>
                                <div id="batch_files_search_options_container" className="batch_files_search_options_container">
                                  <input id="batch_files_search_files" title="Raw files search" defaultChecked type="radio" name="useSearch" onClick={() =>windowAction(id,"batch_files_search_useSearch","files","")}/>
                                  <label htmlFor="batch_files_search_files" title="Raw files search">Files</label>
                                  <input id="batch_files_search_es" title="Elastic keyword search" type="radio" name="useSearch" onClick={() =>windowAction(id,"batch_files_search_useSearch","hybrid","")}/>
                                  <label htmlFor="batch_files_search_es" title="Elastic keyword search">Hybrid (Elastic + Hive search)</label>                                                             
                                </div>
                                <div className='batch_files_search_options_containerI' style={{ opacity: !batchFilesSearchHybrid ? 0.5 : 1 }}>                                                                    
                                   <select id="batch_files_search_column" className="col_select_option" name="" disabled={!batchFilesSearchHybrid} required={batchFilesSearchHybrid && batchFilesSearchStrict}>
                                    <option value="">{batchFilesSearchStrict ? "Select strict column" : "All columns (auto)"}</option>
                                    {(batchFilesSearchStrict ? configurations.search_columns_strict : configurations.search_columns_fuzzy).map((col) => (
                                      <option key={col} value={col}>{col}</option>
                                    ))}
                                  </select> 
                                    <label htmlFor="batch_files_search_column" title="Search in column">Search column {batchFilesSearchStrict}</label>                                      
                                    <input id='batch_files_search_strict' type='checkbox' checked={batchFilesSearchStrict ? true:false} style={{ opacity: !batchFilesSearchHybrid ? 0.5 : 1 }} disabled={!batchFilesSearchHybrid} onChange={() =>windowAction(id,"batch_files_search_strict","strict","")}/>
                                    <label htmlFor="batch_files_search_strict" title="Strict search">Strict mood</label>    
                                </div>
                                <div ref={resultContainerRef} id="batch_files_search_result_container"
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
                                                        document.getElementById("batch_files_search_input").value,
                                                        document.getElementById("batch_files_search_date")?.value || "",
                                                        batchFilesSearchHybrid,
                                                        document.getElementById("batch_files_search_column")?.value || "",
                                                        document.getElementById("batch_files_search_strict")?.checked || false,
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
                                  windowResponseI === "Session running..." ? "streamx" :
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
                          selectedSubContent !== "batch_input_form_pageI" && selectedSubContent !== "batch_input_form_pageIV" ||
                          selectedSubContent === "batch_input_form_pageIV" && !sourceStreamListener ? '': 'True' 
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
                            windowAction(id, "batch_input_form_swap", "page_IV",null);
                          }
                          else if (selectedSubContent === "batch_input_form_pageIV" && sourceStreamListener){
                            windowAction(id, "batch_input_stream_terminate", "page_IV",null);
                          }
                          else if (selectedSubContent === "batch_input_form_pageIV" && !sourceStreamListener){
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
                          selectedSubContent !== "batch_input_form_pageIV" && batchFilesDataframeActionValue === "Store data" || 
                          selectedSubContent !== "batch_input_form_pageIV" && batchFilesDataframeActionValue === "Source / Target Relationship" && batchFilesDataframeSourceValue && batchFilesDataframeTargetValue ||
                          selectedSubContent !== "batch_input_form_pageIV" && batchFilesDataframeActionValue === "Link Analysis" && batchFilesDataframeRuleValue || 
                          selectedSubContent === "batch_input_form_pageIV" && sourceStreamListener? '': 'True' 
                        }>
                        {selectedSubContent === "batch_input_form_pageIII" || selectedSubContent === "batch_input_form_pageIV" && !sourceStreamListener ? "Stream Graph":
                        selectedSubContent === "batch_input_form_pageIV" ? "Terminate"  : "Next"}
                      </button>
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
                  <IframeEmbed wId={id} id="source_placeholder" fileName="source_placeholder" activeGraph={activeGraph} graphAction={graphAction} iframeRef={iframeRef} BASE_URL={BASE_URL}/>
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
            {(selectedContent === "graph_content" || selectedContent === null) && 
            (
              <div className="placeholder">
                <IframeEmbed
                  wId={id} 
                  id={activeGraph || "graph_placeholder"}
                  fileName={activeGraph || "graph_placeholder"}
                  activeGraph={activeGraph}
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
                initialTopHeight="100%"
                minTopHeight="20%"
                maxTopHeight="100%"
                graphStatus={graphStatus}
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
            {(selectedContent === "chart_content" || selectedContent === null) && 
            (
              <div className="placeholder">
                <IframeEmbed
                  wId={id} 
                  id={activechart || "chart_placeholder"}
                  fileName={activechart || "chart_placeholder"}
                  activeGraph={activechart}
                  chartaction={chartAction} 
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
    <main id="main" className={themeMode === "dark" ? "linkx_workspace_scene" : undefined}>
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
        <NetworkBackground name={userName} themeMode={themeMode} />
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
  const [orientation, setOrientation] = useState("tabs"); // "windows" | "tabs"
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
  const [themeMode, setThemeMode] = useState(() => {
    const savedMode = localStorage.getItem("linkx_theme_mode");
    return savedMode === "dark" ? "dark" : "light";
  });
  const { areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const [configurations, setConfigurations] = useState({});
  const [isConfigurationsOpen, setIsConfigurationsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
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
  const textareaRefs = useRef({});
  const debounceRef = useRef(null);
  const graphActionDebounceRef = useRef({});
  const windowGraphActionDebounceRef = useRef({});
  const [isDragging, setIsDragging] = useState(false);
  const [graphLinkstate, setGraphLinkState] = useState(false);
  const [graphStatusListener, setGraphStatusListener] = useState(false);
  const [graphStatus, setGraphStatus] = useState({});
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
  const toggleMenuRef = useRef(null);
  const tabsToggleButtonRef = useRef(null);
  const darkFloatMenuToggleRef = useRef(null);
  const API_URL = import.meta.env.VITE_API_URL
  const BASE_URL = import.meta.env.VITE_BASE_URL
  const defaultIdleSettings = useMemo(() => getDefaultIdleSettings(), []);
  const [idleSettings, setIdleSettings] = useState(() => readStoredIdleSettings(defaultIdleSettings));
  const workspaceIdleLockMinutes = Math.max(1, Math.round((idleSettings?.warningMs || DEFAULT_IDLE_WARNING_MS) / 60000));
  const workspaceIdleLogoutMinutes = Math.max(1, Math.round((idleSettings?.timeoutMs || DEFAULT_IDLE_TIMEOUT_MS) / 60000));
  const HEADER_TRIGGER_ALLOWED_ORIGINS = String(import.meta.env.VITE_HEADER_ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

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
  //const BASE_URL = "http://localhost:5173"
  //const API_URL = "http://localhost:5000";

  // useEffect(() => {  // Sync windowsRef on every update
  //   console.log("orientation:",orientation)
  // }, [orientation]);

  const hasOpenWindows = windows.length > 0;
  const hasVisibleWorkspacePanel = hasOpenWindows || isConfigurationsOpen || isSettingsOpen;
  const showDarkHomeOverlay = themeMode === "dark" && !hasVisibleWorkspacePanel;
  const showDarkFloatingMenu = themeMode === "dark" && !isToggleMenuOpen && hasOpenWindows && orientation === "windows";

  useEffect(() => {
    if (showDarkHomeOverlay) {
      setIsToggleMenuOpen(false);
    }
  }, [showDarkHomeOverlay]);

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

    document.addEventListener("pointerdown", handleOutsideToggleClick);
    return () => {
      document.removeEventListener("pointerdown", handleOutsideToggleClick);
    };
  }, [isToggleMenuOpen]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    localStorage.setItem("linkx_theme_mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    const listeners = [];
    const sendThemeMode = (frameEl) => {
      frameEl?.contentWindow?.postMessage(
        { action: "theme_mode", payload: themeMode },
        getTrustedMessageOrigin()
      );
    };

    const replayGraphInfoToFrame = (windowId, frameEl) => {
      const windowState = windowsRef.current.find((w) => String(w.id) === String(windowId));
      if (!windowState) return;
      if (String(windowState.activeGraph || "") !== "graph_info_placeholder") return;

      const sessionKey = String(windowState.graphLinkSource || windowState.sessionId || "").trim();
      if (!sessionKey) return;

      const cachedPayload = graphInfoPayloadBySessionRef.current[sessionKey];
      if (!cachedPayload || typeof cachedPayload !== "object") return;

      frameEl?.contentWindow?.postMessage(
        { action: "informations", payload: cachedPayload },
        getTrustedMessageOrigin()
      );
    };

    Object.entries(iframeRefs.current || {}).forEach(([windowId, frameRef]) => {
      const frameEl = frameRef?.current;
      if (!frameEl) return;
      const onLoad = () => {
        sendThemeMode(frameEl);
        replayGraphInfoToFrame(windowId, frameEl);
      };
      frameEl.addEventListener("load", onLoad);
      listeners.push(() => frameEl.removeEventListener("load", onLoad));
      sendThemeMode(frameEl);
      replayGraphInfoToFrame(windowId, frameEl);
    });

    return () => {
      listeners.forEach((dispose) => dispose());
    };
  }, [themeMode, windows.length]);

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
    onUnauthorized: () => {
      pushNotification({
        title: "Session expired",
        message: "Please sign in again.",
        source: "Auth",
        level: "warning",
      });
      logout();
    },
    onForbidden: (data) => {
      pushNotification({
        title: "Permission denied",
        message: data?.message || data?.error || "You do not have permission for this action.",
        source: "RBAC",
        level: "warning",
      });
    },
    onLocked: (data) => {
      setIsWorkspaceLocked(true);
      pushNotification({
        title: "Workspace locked",
        message: data?.message || data?.error || "Unlock required before continuing.",
        source: "Auth",
        level: "warning",
        durationMs: 8000,
      });
    },
  }), [API_URL, token, logout, pushNotification]);

  const canAccess = useCallback((permission) => (
    hasRole("admin") || hasPermission(permission)
  ), [hasRole, hasPermission]);

  const updateIdleSettings = useCallback((nextSettings) => {
    setIdleSettings((previous) => normalizeIdleSettings(
      typeof nextSettings === "function" ? nextSettings(previous) : nextSettings,
      defaultIdleSettings
    ));
  }, [defaultIdleSettings]);

  useEffect(() => {
    persistIdleSettings(idleSettings);
  }, [idleSettings]);

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
          setConfigurations(initData.configurations || {});
          setSessionId(nextSession);
          sessionIdRef.current = nextSession;
          localStorage.setItem("session", nextSession);
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
  }, [apiFetch, verifyToken]);

  pushNotificationRef.current = pushNotification;
  sessionIdRef.current = sessionId;

  useEffect(() => {
    setUserName(user?.display_name || user?.username || null);
  }, [user]);

  const registerStrReportSocketReceiver = (browserSession) => {
    const socket = socketRef.current;
    const resolvedSession = String(browserSession || "").trim();
    if (!socket?.connected || !resolvedSession) {      return;
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
        console.log("[init request]", payload);
        apiFetch("/init", {
          method: "POST",
          body: payload,
        })
          .then(data => {
            if (isSuccessResponse(data)) {
              const session = extractMainSessionId(data);
              try{
                const configs= data.configurations;
                // const jsonString = configs.replace(/'/g, '"');
                // const parsedConfig = JSON.parse(jsonString);
                console.log("init_config:",configs)
                setConfigurations(configs)
                setSessionId(session);
              } 
              catch (error) {
                console.error('Error parsing configurations:', error);
              }
              if (session) {
                localStorage.setItem('session', session);
                setSessionId(session);
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
        if (!win.toolPassword && defaults.toolPassword) updates.toolPassword = defaults.toolPassword;
        if (!win.toolDatabase && defaults.toolDatabase) updates.toolDatabase = defaults.toolDatabase;
      }

      if (realtimeUnlocked) {
        if (!win.sourceRealtimeAddressText && defaults.sourceRealtimeAddressText) updates.sourceRealtimeAddressText = defaults.sourceRealtimeAddressText;
        if (!win.sourceRealtimeTopicText && defaults.sourceRealtimeTopicText) updates.sourceRealtimeTopicText = defaults.sourceRealtimeTopicText;
        if (!win.sourceRealtimeAddressType) updates.sourceRealtimeAddressType = defaults.sourceRealtimeAddressType;
        if (!win.realtimeToolUrl && defaults.realtimeToolUrl) updates.realtimeToolUrl = defaults.realtimeToolUrl;
        if (!win.realtimeToolUsername && defaults.realtimeToolUsername) updates.realtimeToolUsername = defaults.realtimeToolUsername;
        if (!win.realtimeToolPassword && defaults.realtimeToolPassword) updates.realtimeToolPassword = defaults.realtimeToolPassword;
        if (!win.realtimeToolDatabase && defaults.realtimeToolDatabase) updates.realtimeToolDatabase = defaults.realtimeToolDatabase;
      }

      return Object.keys(updates).length ? { ...win, ...updates } : win;
    }));
  }, [configurations]);

  useEffect(() => {
    if (!token) return;
    const socket = io(API_URL, {
      auth: { token },
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
  }, [sourceNotificationKey, pushNotification, sanitizeNotificationMessage]);
  // ------------------------------------------------------------------ logger ---
  useEffect(() => {
    if (!sourceSessionLogFile) return;
    const logFile = sourceSessionLogFile?.logFile;
    const logSessionId = sourceSessionLogFile?.session_id;
    if (!logFile || logSessionId == null || logSessionId === "") return;

    logRef.current = '';
    const socket = socketRef.current;
    if (!socket) return;

    const handleLogs = (data) => {
      const id = String(data.session_id);
      if (data.error) return;

      logRef.current += '\n' + data.data;
      setWindows(prev =>
        prev.map(w =>
          w.id === id
            ? { ...w, sourceSessionLog: logRef.current }
            : w
        )
      );
      // ⬇️ autoscroll AFTER React paints
      requestAnimationFrame(() => {
        const textarea = textareaRefs.current[id];
        if (textarea) {
          textarea.scrollTop = textarea.scrollHeight;
        }
      });
    };

    socket.on("stream_logs", handleLogs);
    socket.emit("log_stream_plug", { filename: logFile, session_id: logSessionId });

    return () => {
      socket.emit("log_stream_unplug", { filename: logFile, session_id: logSessionId });
      socket.off("stream_logs", handleLogs);
    };
  }, [sourceSessionLogFile]);

// ------------------------------------------------------- graph status socket ---
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || graphStatusSessionIds.length === 0) return;

    let lastHashBySession = {};
    const handleGraphStatus = (payload) => {
      const { type, data, error, session_id } = payload;
      const sessionKey = String(session_id || "").trim();
      if (!sessionKey) return;

      const isGraphInfoPlaceholderPath = (pathname) => {
        const normalizedPath = String(pathname || "");
        return normalizedPath.endsWith("/temp_placeholders/graph_info_placeholder.html");
      };

      const buildGraphInfoPayload = (metadata, currentSessionKey, relationships = []) => {
        const base = metadata && typeof metadata === "object" ? metadata : {};
        const relationshipList = Array.isArray(relationships) ? relationships : [];
        const relationshipLabels = relationshipList
          .map((item) => item?.type)
          .filter((item) => item != null && String(item).trim() !== "");
        return {
          ...base,
          session_id: String(currentSessionKey || ""),
          analysisSessionId: String(currentSessionKey || ""),
          relationship_labels: relationshipLabels,
          total_relationships:
            base?.summary?.total_relationships != null
              ? base.summary.total_relationships
              : relationshipList.length,
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
        return;
      }

      const targetWindows = windowsRef.current.filter(
        w => String(w.graphLinkSource || "") === sessionKey
      );

      if (targetWindows.length === 0) {
        return;
      }

      if (type === "metadata") {
        const previousRelationships = graphStatus?.[sessionKey]?.relationships;
        const infoPayload = buildGraphInfoPayload(data, sessionKey, previousRelationships);
        graphInfoPayloadBySessionRef.current[sessionKey] = infoPayload;

        setGraphStatus(prev => ({
          ...prev,
          [sessionKey]: {
            ...prev[sessionKey],
            status: data
          }
        }));

        targetWindows.forEach(w => {
          const iframe = iframeRefs.current[w.id];
          if (iframe?.current?.contentWindow) {
            if (isGraphInfoPlaceholderPath(iframe?.current?.contentWindow.location?.pathname)) {
              iframe.current.contentWindow.postMessage(
                { action: "informations", payload: infoPayload },
                getTrustedMessageOrigin()
              );
            }
          }
        });

        return;
      }

      if (type === "relationships") {
        const hash = JSON.stringify((Array.isArray(data) ? data : []).map(r => [r.id, r.type, r.textcolor, r.bgcolor]));
        if (lastHashBySession[sessionKey] === hash) return;
        lastHashBySession[sessionKey] = hash;

        setGraphStatus(prev => ({
          ...prev,
          [sessionKey]: {
            ...prev[sessionKey],
            relationships: data
          }
        }));

        setWindows(prev =>
          prev.map(w =>
            targetWindows.find(tw => tw.id === w.id)
              ? { ...w, graphStatus: data }
              : w
          )
        );

        const metadataPayload = graphStatus?.[sessionKey]?.status;
        if (metadataPayload && typeof metadataPayload === "object") {
          const infoPayload = buildGraphInfoPayload(metadataPayload, sessionKey, data);
          graphInfoPayloadBySessionRef.current[sessionKey] = infoPayload;
          targetWindows.forEach((w) => {
            const iframe = iframeRefs.current[w.id];
            if (iframe?.current?.contentWindow && isGraphInfoPlaceholderPath(iframe?.current?.contentWindow.location?.pathname)) {
              iframe.current.contentWindow.postMessage(
                { action: "informations", payload: infoPayload },
                getTrustedMessageOrigin()
              );
            }
          });
        }
      }
    };

    graphStatusSessionIds.forEach((currentSessionId) => {
      const normalizedSession = String(currentSessionId || "").trim();
      if (!normalizedSession) return;
      if (!graphStatusSubscribedSessionsRef.current.has(normalizedSession)) {
        socket.emit("graph_status_subscribe", { session_id: normalizedSession });
        graphStatusSubscribedSessionsRef.current.add(normalizedSession);
      }
    });

    socket.on("status", handleGraphStatus);

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
  }, [graphStatusSessionKey]); // depend on linked session ids
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
          console.log('Click outside container', event.target);
          resultContainerRef.current.style.display = 'none';
          setSearchResultsVisible(false);
        } else {
          console.log('Click inside container', event.target);
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
      console.log("event detected:",event)
      const sourceWindow = event?.source || null;
      const resolvedSourceWindowId = Object.keys(iframeRefs.current || {}).find((windowId) => {
        const frameRef = iframeRefs.current[windowId];
        return frameRef?.current?.contentWindow === sourceWindow;
      });
      const iframeAction = getIframeMessageAction(event.data);
      const isKnownIframeMessage = TRUSTED_IFRAME_MESSAGE_TYPES.has(iframeAction) || event.data?.action === "notify";
      if (isKnownIframeMessage && (!isTrustedMessageOrigin(event) || !resolvedSourceWindowId)) {
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
      if (event.data?.action === "authenticate") {
        const authOrigin = String(event.origin || "");
        const sameOrigin = authOrigin === window.location.origin;
        const allowedOrigin = HEADER_TRIGGER_ALLOWED_ORIGINS.includes(authOrigin);
        if (!sameOrigin && !allowedOrigin) return;

        const iframeToken = event.data.token || event.data.payload?.token;
        if (!iframeToken) {
          console.warn("No token found in message");
          return;
        }

        verifyToken(iframeToken)
          .then((verifiedUser) => {
            setUserName(verifiedUser?.display_name || verifiedUser?.username || null);
            pushNotification({
              title: "Authenticated",
              message: `Signed in as ${verifiedUser?.display_name || verifiedUser?.username || "user"}.`,
              source: "Auth",
              level: "success",
            });
          })
          .catch((err) => {
            console.error("Failed to verify iframe token:", err);
            pushNotification({
              title: "Authentication failed",
              message: err?.message || "Invalid token received from iframe.",
              source: "Auth",
              level: "error",
            });
          });
      }
      if (event.data?.type === "nodeProperties") {
        const properties = event.data.payload; // unpack the payload
        const targetGraphWindow = event.data?.payload?.id ?? resolvedSourceWindowId ?? windowIdRef.current;
        setWindows(prev =>
            prev.map(w => w.type === "graph" && w.id === targetGraphWindow ? { ...w, nodeProperties: properties } : w)
        );
      }
      if (event.data?.type === "all_property_keys_response") {
        const { id, keys } = event.data.payload; // unpack the payload
        const targetGraphWindowId = id ?? resolvedSourceWindowId;
        //console.log(`Got keys from iframe ${id}:`, keys); // ["label", "group", ...]
        // Update your state with just the keys
        // Update the specific window that matches this iframe id
        setWindows(prev =>
          prev.map(w => w.type === "graph" && w.id === targetGraphWindowId ? { ...w, filterPropertyKeys: keys } : w)
        );
        console.log("IframeSettings:",iframeSettings)
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
        const { id, selectedNodes, selectedEdges } = event.data.payload; // unpack the payload
        const sourceGraphId = id ?? resolvedSourceWindowId;
        //set selected entities for alllinked chart window to the top graph window
        handleChartActions(sourceGraphId,"updateNetwork","selection", { ...event.data.payload, id: sourceGraphId, selectedNodes, selectedEdges });
        console.log(23)
      }
      //1 Listen what is selected from the graph window
      //2 update the selected node and edges in each window that are chart type and linkd to that specific graph window
      //3 listen fro the nodes selection change and update the graphs that are already created
    };

      window.addEventListener("message", handleIframeMessage);
      return () => window.removeEventListener("message", handleIframeMessage);
  }, [pushNotification]);

  // ---------------------------------------------------------------------------- Windows management ---
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
    if (typeof windowIdRef.current !== "number") { //Happens for source windows (since it has '_' between the window id and session id)
      const parts = String(windowIdRef.current).split('_');
      const last_id = parseInt(parts[0], 10);
      if (!isNaN(last_id)){
        windowIdRef.current = last_id + 1;
      } else {
        windowIdRef.current = 1;
      }
      return windowIdRef.current;
    }
    windowIdRef.current += 1;
    return windowIdRef.current;
  };
  const handleCreateWindows = (sessionId, type, iframeRef, initialContent = null) => {
    if (type === "source" && !requirePermission(PERMISSIONS.SOURCE_CREATE, "source windows")) return null;
    if (type === "graph" && !requirePermission(PERMISSIONS.GRAPH_CREATE, "graph windows")) return null;
    const id = generateWindowId();
    // if (windowIdRef[id]){
    //   const id = generateWindowId();
    // }
    if (type === "source") {
      const windowsId = id+"_"+sessionId;
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
                      sessionId: sessionId,
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
                      toolDatabase: sourceAutofillDefaults.toolDatabase,
                      realtimeToolUrl: sourceAutofillDefaults.realtimeToolUrl,
                      realtimeToolUsername: sourceAutofillDefaults.realtimeToolUsername,
                      realtimeToolPassword: sourceAutofillDefaults.realtimeToolPassword,
                      realtimeToolDatabase: sourceAutofillDefaults.realtimeToolDatabase,
                      formToolResponse: null,
                      formRealtimeToolResponse: null,
                      batchFilesSearchResults: null,
                    },
                  ];
                });
                console.log("windowsId:",windowsId)
                handleFocusWindow(windowsId)
                setZIndexCounter(prev => prev + 1);
              } else {
                alert("Could not initialize source window!");
              }
            })
            .catch(console.error);
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
            activeGraph: null,
            iframeSearch: initialSearch,
            iframeSettings: initialSettings,
            covered: false,
          },
        ];
      });
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
        handleCreateWindows(sessionId,type,iframeRef,initialContent);
      }
      else{
        return;
      }
    }
    if (type==="graph"){
      if (link===""){
        //If theres no link just creates the window
        handleCreateWindows(sessionId,type,iframeRef);
      }
      else{
        return;
      }
    }
    if (type==="chart"){
      if (link===""){
        //If theres no link just creates the window
        handleCreateWindows(sessionId,type,iframeRef);
      }
      else{
        return;
      }
    }
    if (type==="parent"){
      handleCreateWindows(type);
    }
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
      socket.emit("graph_status_subscribe", { session_id: analysisSessionId });
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
    apiFetch("/graph_link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(linkPayload),
    })
      .then((data) => {
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
        else setOrientation("windows");
      }, 0);
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
        socket.emit("log_stream_unplug", {filename: closingWindow.sourceSessionLogFile,session_id: id});
        socket.emit("graph_status_unsubscribe", { session_id: id });
        graphStatusSubscribedSessionsRef.current.delete(String(id));
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
          iframe.current.contentWindow.postMessage(
            { action: "network_components", payload: id}, // Requesting for the nodes and egdes of that specific graph (request is sent to the graph window itself), #id is the graph window id
              getTrustedMessageOrigin()
          );
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
          iframe.current.contentWindow.postMessage(
            { action: "network_components", payload: { nodes, edges } },
            getTrustedMessageOrigin()
          );
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
                chartIframeRef.current.contentWindow.postMessage(
                  { action: "updateSelection", payload:{selectedNodes, selectedEdges} },
                  getTrustedMessageOrigin()
                );
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
  const handleGraphActions = (id, menuId, action, payload) => {
    console.log("GraphAction:", id, menuId, action, payload);
    if (menuId === "get_graph" && !requirePermission(PERMISSIONS.GRAPH_READ, "graph data")) return;

    const sendToIframe = (iframe, msgAction, msgPayload) => {
      if (!iframe?.current) {
        alert("Iframe not found!");
        return;
      }

      const send = () => {
        iframe.current.contentWindow?.postMessage(
          { action: msgAction, payload: msgPayload },
          getTrustedMessageOrigin()
        );
      };

      const iframeSrc = iframe.current.src;
      if (iframeSrc.includes("graphs_basic")) {
        send();
      } else {
        iframe.current.onload = send;
      }
    };
    // Debounce wrapper for actions that need delay
    runScopedDebounce(graphActionDebounceRef, id, () => {
      setWindows(prev =>
        prev.map(w => {
          if (w.id !== id) return w;

          const iframe = payload?.iframe || null;
          const updates = {};

          // ------------------ Graph generation ------------------
          if (menuId === "get_graph" && action === "relationship") {
            const newPayload = {
              id: action,
              source_id: payload.sourceId,
              relationship: sanitizeGraphEndpointId(payload.relationship, { maxLength: 128 }),
            };
            if (graphFetchAbortControllersRef.current[id]) {
              graphFetchAbortControllersRef.current[id].abort();
              delete graphFetchAbortControllersRef.current[id];
            }
            const controller = new AbortController();
            graphFetchAbortControllersRef.current[id] = controller;

            updates.loadscreenState = true;
            updates.loadscreenText = "Staging graph";

            apiFetch("/get_graph", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newPayload),
              signal: controller.signal
            })
              .then(data => {
                if (!graphFetchAbortControllersRef.current[id] || graphFetchAbortControllersRef.current[id] !== controller) return;
                setWindows(prev =>
                  prev.map(win =>
                    win.id === id
                      ? { ...win, loadscreenState: false, activeGraph: isSuccessResponse(data) ? "graphs_basic" : null }
                      : win
                  )
                );

                if (isSuccessResponse(data)) {
                  const settingsToApply = normalizeGraphIframeSettings(iframeSettings[id] || w.iframeSettings);
                  settingsToApply[2] = normalizeGraphLimitRange({ min: 0, max: 25 }, 25);
                  updateIframeSettings(id, 2, { min: 0, max: 25 });
                  sendToIframe(iframe, "new_graph", {
                    id,
                    nodes: data.results.nodes,
                    edges: data.results.edges,
                    settings: settingsToApply
                  });
                } else {
                  alert(data.message);
                }
              })
              .catch(err => {
                if (err?.name === "AbortError") return;
                console.error(err);
                setWindows(prev =>
                  prev.map(win =>
                    win.id === id
                      ? { ...win, windowResponseI: "Connection failed!" }
                      : win
                  )
                );
                alert(err);
              })
              .finally(() => {
                if (graphFetchAbortControllersRef.current[id] === controller) {
                  delete graphFetchAbortControllersRef.current[id];
                }
              });
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
                    sendToIframe(iframe, setting, value);
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
              sendToIframe(iframe, payload.settings, normalizedSettingState);
}
            if (action === "search") {
              const { option, keyword, keys, settings } = payload;
              sendToIframe(iframe, "graph_search", { id, option, keyword, keys, settings });
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
              sendToIframe(iframe, "all_property_keys", { id });
            }            
          }

          // ------------------ Iframe options ------------------
          if (menuId === "iframe_options" && action === "settings") {
            const nextAction = payload?.settings || "fit_graph";
            const allowedActions = new Set(["fit_graph", "undo_graph", "redo_graph"]);
            if (allowedActions.has(nextAction)) {
              sendToIframe(iframe, nextAction, nextAction);
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
            const allowedExtensions = [".csv", ".json", ".parquet", ".xlsx"];
            const uploadedFiles = payload.files;
            const invalidFiles = [];
            const validFiles = [];
            const sessionId = id //That specific source window id
            for (const file of uploadedFiles) {
              const fileName = file.name.toLowerCase();
              const isValid = allowedExtensions.some(ext => fileName.endsWith(ext));
              if (isValid) {
                validFiles.push(file);
              } else {
                invalidFiles.push(file.name);
              }
            }
            if (invalidFiles.length > 0) { // IF invalid files found
              alert(`Unsupported file types:\n\n${invalidFiles.join("\n")}\n\nAllowed types: CSV, JSON, Parquet.`);
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
                } 
                else {
                  alert(data.message)
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
              w.id === id ? { ...w, sourceRealtimeAddressType: payload } : w
            )
          );
        }
        if (menuId === "real_time_source_address_text" && action === "change") {
          console.log("address_change:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceRealtimeAddressText: sanitizeConnectionValue(payload, { maxLength: 300 }) } : w
            )
          );
        }
        if (menuId === "real_time_source_topic_text" && action === "change") {
          console.log("topic_change:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, sourceRealtimeTopicText: sanitizeKafkaTopic(payload) } : w
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
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, [fieldName]: normalizeValue(payload) } : w
            )
          );
        }
        if (menuId === "real_time_input_form" && action === "connect" && payload) {
          console.log("realtime_connection_payload:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, windowRealtimeResponseI: "Connecting..." } : w
            )
          );
          apiFetch("/connect_to_source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          .then((data) => {
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, windowRealtimeResponseI: data.message } : w
              )
            );
          })
          .catch((err) => {
            console.error(err);
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, windowRealtimeResponseI: "Connection failed!" } : w
              )
            );
          });
        }
        if (menuId === "real_time_input_form" && action === "disconnect" && payload) {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, windowRealtimeResponseI: "Disconnecting..." } : w
            )
          );
          const disconnectPayload = {
            ...payload,
            broker: payload?.broker ?? payload?.address ?? "",
            hdfs: payload?.hdfs ?? payload?.storage ?? "",
            session_id: payload?.session_id ?? id,
          };
          apiFetch("/disconnect_source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(disconnectPayload),
          })
            .then((data) => {
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, windowRealtimeResponseI: data.message } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, windowRealtimeResponseI: "Disconnecting failed!" } : w
                )
              );
            });
        }
        if (menuId === "real_time_tool_integration_form" && action === "connect" && payload) {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, formRealtimeToolResponse: "Connecting..." } : w
            )
          );
          apiFetch("/connect_to_tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
            .then((data) => {
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formRealtimeToolResponse: data.message } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formRealtimeToolResponse: "Connecting failed!" } : w
                )
              );
            });
        }
        if (menuId === "real_time_tool_integration_form" && action === "disconnect" && payload) {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, formRealtimeToolResponse: "Disconnecting..." } : w
            )
          );
          apiFetch("/disconnect_tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
            .then((data) => {
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formRealtimeToolResponse: data.message } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formRealtimeToolResponse: "Disonnecting failed!" } : w
                )
              );
            });
        }
        if (menuId === "batch_input_form" && action === "connect" && payload) {
          console.log("connection_payload:",payload);
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, windowResponseI: "Connecting...", sourceStatus: SOURCE_STATUSES.CONNECTING, sourceKind: payload?.addressType || w.sourceAddressType || SOURCE_KINDS.BROKER } : w
            )
          );
          apiFetch("/connect_to_source", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          .then((data) => {
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, windowResponseI: data.message, sourceStatus: sourceStatusFromResponse(data.message), sourceKind: payload?.addressType || w.sourceKind || w.sourceAddressType || SOURCE_KINDS.BROKER } : w
              )
            );
          })
          .catch((err) => {
            console.error(err);
            setWindows(prev =>
              prev.map(w =>
                w.id === id ? { ...w, windowResponseI: "Connection failed!", sourceStatus: SOURCE_STATUSES.FAILED } : w
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
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, windowResponseI: data.message, sourceStatus: sourceStatusFromResponse(data.message) } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, windowResponseI: "Disconnecting failed!", sourceStatus: SOURCE_STATUSES.FAILED } : w
                )
              );
            });        
        }
        if (menuId === "tool_integration_form" && action === "connect" && payload) {
          setWindows(prev =>
            prev.map(w =>
              w.id === id ? { ...w, formToolResponse: "Connecting...", toolStatus: TOOL_STATUSES.CONNECTING } : w
            )
          );
          apiFetch("/connect_to_tool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
            .then((data) => {              
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formToolResponse: data.message, toolStatus: toolStatusFromResponse(data.message) } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formToolResponse: "Connecting failed!", toolStatus: TOOL_STATUSES.FAILED } : w
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
            body: JSON.stringify(payload),
          })
            .then((data) => {              
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formToolResponse: data.message, toolStatus: toolStatusFromResponse(data.message) } : w
                )
              );
            })
            .catch((err) => {
              console.error(err);
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, formToolResponse: "Disonnecting failed!", toolStatus: TOOL_STATUSES.FAILED } : w
                )
              );
            });        
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
                requestDataframeCreation(apiFetch, payload1)
                .then((data) => { 
                    console.log("public source data:",data, "payload:", payload1, "api:", `${API_URL}/live_batch_files`)   
                    var arrayData=Object.values(data.results)
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
                      alert("We could not create the dataframe right now. Please check the selected source and try again.")
                      setWindows(prev =>
                        prev.map(w =>
                          w.id === id ? { ...w, batchFilesDataframeInfoI:[],loadscreenState: false,dataframeStatus: DATAFRAME_STATUSES.FAILED } : w
                        )
                      );
                    }
                  })
                .catch((err) => {
                  console.error("create_DF error:", err, "payload:", payload1, "api:", `${API_URL}/live_batch_files`);
                  alert("We could not create the dataframe from this source. Please verify the source is reachable and try again.");
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
                    w.id === id
                      ? {
                          ...w,
                          searchText: true,
                          searchResultsVisible: true,
                          searchPlaceholder: "Searching..."
                        }
                      : w
                  )
                );

                apiFetch("/live_batch_files", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(buildPayload(0))
                })
                  .then(data => {
                    const results = Array.isArray(data?.results) ? data.results : [];
                    const hasMore = !!data?.has_more;
                    console.log("search results:", results, hasMore, "payload:", buildPayload(0));

                    handleRawSearchDiagnostics(data, results);

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

                    if (data?.message === "Result out of bound!") {
                      alert(data.message);
                    }
                  })
                  .catch(console.error);
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

              apiFetch("/live_batch_files", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildPayload(offset))
              })
                .then(data => {
                  const results = Array.isArray(data?.results) ? data.results : [];
                  const hasMore = !!data?.has_more;
                  console.log("search results:", data, "payload:", buildPayload(offset));

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
                .catch(console.error);
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
            requestDataframeCreation(apiFetch, payload)
            .then((data) => { 
                console.log("searchdata:",data)   
                var arrayData=Object.values(data.results)
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
                  alert("We could not create the dataframe from the selected files. Please review your selection and try again.")
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id ? { ...w, batchFilesDataframeInfoI:[],loadscreenState: false,dataframeStatus: DATAFRAME_STATUSES.FAILED } : w
                    )
                  );
                }
              })
            .catch((err) => {
              console.error(err);
              alert("We could not create the dataframe from the selected files. Please try again in a moment.");
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
        if (menuId === "batch_input_form_swap" && action === "page_IV") { //This is the component that initalizes the graph streaming
          // Set new timeout for debounce
          console.log("streaming:",batchFilesDataframeInfoI)
          debounceRef.current = setTimeout(() => {
            const newLoadscreenText="Initalizing "
            // Initialize a variable to accumulate logs
            let accumulatedLogs = '';
            setSourceStreams(prev => ({ ...prev, [id]: false }));
            setWindows(prev =>
              prev.map(w =>
               w.id === id ? { ...w, windowResponseI:null,sourceSessionLog:null,sourceStreamListener: true,loadscreenState: false, loadscreenText:newLoadscreenText,streamStatus: STREAM_STATUSES.STARTING,sourceStep: SOURCE_FLOW_STEPS.STREAM } : w
              )
            );
            //Requesting session start
            // Get the window object from the current state
            const targetWindow = windows.find(w => w.id === id);
            let action, source, target, relationship, tool, rule
            if (!targetWindow) {
              console.warn("Window not found:", id);
            } else {
              action = targetWindow.batchFilesDataframeActionValue;
              source = targetWindow.batchFilesDataframeSourceValue;
              target = targetWindow.batchFilesDataframeTargetValue;
              relationship = targetWindow.batchFilesDataframeRelationshipValue && targetWindow.batchFilesDataframeRelationshipValue !== '' &&  targetWindow.batchFilesDataframeRelationshipValue !== true
              ? targetWindow.batchFilesDataframeRelationshipValue : 'HAS_RELATIONSHIP';            
              tool=targetWindow.batchFilesDataframeInfoI[7]; //Tools values sent from dataframe info
              rule=targetWindow.batchFilesDataframeRuleValue;
              console.log("Action, Source, Target from window:", action, source, target, relationship, tool, rule);
            }            
            //Template stance if failed to start the session (keeps the page from swaping)
            newContent = sourceWorkflowContent;
            newSubContent = "batch_input_form_pageIII";
            const sourceMode = sourceWorkflowContent === "real_time_input" ? "realtime" : "batch";
            const payload = {
                id: "stream",
                session_id: id,
                mode: sourceMode,
                source_mode: sourceMode,
                value:{"window_id":id,"session_id":id,"mode":sourceMode,"source_mode":sourceMode,"tool":tool,"action":action,"source":source,"target":target,"relationship":relationship,"rule":rule}// Add filter request here
              };
            console.log("[stream request]", {
              sourceMode,
              action,
              source,
              target,
              relationship,
              rule,
              payload,
            });
            apiFetch("/live_batch_files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
            .then((data) => { 
              //var response=Object.values(data.results)
              if (data != null){
                if (isSuccessResponse(data)){
                  const logFile = data.results;
                  console.log("logFile:",logFile);
                  const socket = socketRef.current;
                  if (!socket || !logFile) return;
                  setSourceStreamListener(true);
                  setSourceSessionLogFile({logFile,session_id: id});
                  setSourceStreams(prev => ({ ...prev, [id]: true }));
                  newContent = sourceWorkflowContent;
                  newSubContent = "batch_input_form_pageIV";
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id
                        ? {
                            ...w,
                            windowResponseI: "Session running...",
                            streamStatus: STREAM_STATUSES.RUNNING,
                            sourceStep: SOURCE_FLOW_STEPS.STREAM,
                            batchFilesDataframeInfoI:w.batchFilesDataframeInfoI,
                            loadscreenState: false,
                            selectedContent: newContent,
                            selectedSubContent: newSubContent,     
                            sourceStreamListener: true,
                            sourceSessionLogFile: logFile               
                          }
                        : w
                    )
                  );
                }
                else{
                  pushNotification({
                    title: "Streaming could not start",
                    message: "The request was received, but the stream did not initialize. Please check the selected action and try again.",
                    source: "Linkx",
                    level: "error",
                  });
                  console.warn("Stream initialization rejected", { message: data?.message, status: data?.status, hasException: Boolean(data?.exception) });
                  setSourceStreams(prev => ({ ...prev, [id]: false}));
                  setSourceStreamListener(true);
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id
                        ? {
                            ...w,
                            batchFilesDataframeInfoI:w.batchFilesDataframeInfoI,
                            windowResponseI: sourceWorkflowReadyResponse,
                            loadscreenState: false,
                            sourceStreamListener: false,
                            streamStatus: STREAM_STATUSES.FAILED
                          }
                        : w
                    )
                  );
                }
              }
            })
            .catch((err) => {
              console.error("Stream initialization request failed", err);
              pushNotification({
                title: "Streaming could not start",
                message: "Unable to reach the streaming service. Please try again.",
                source: "Linkx",
                level: "error",
              });
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, batchFilesDataframeInfoI:w.batchFilesDataframeInfoI, loadscreenState: false} : w
                )
              );
            });
          }, 300); // debounce delay   
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
            if (socket && socket.connected) {
              socket.emit("log_stream_unplug", {filename: sourceSessionLogFile?.logFile,session_id: id});
              socket.emit("graph_status_unsubscribe", {session_id: id})
              // Optional: stop listening to the client side
              // socket.off("stream_logs");
            }
            //Refresh the options (the previous content options)
            let oldBatchFilesDataframeInfoI=batchFilesDataframeInfoI
            //setBatchFilesDataframeInfoI(null)
            console.log("termination:",batchFilesDataframeInfoI)
            const payload = {
                id: "end_session",
                  session_id: id,
                value:{"window_id":id,"session_id":id,"log_file":sourceSessionLogFile}
              };
            apiFetch("/live_batch_files", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            }) 
            .then((data) => { 
              if (data!=null){
                if (data.message==="success"){
                  if (socket) socket.off("stream_logs"); 
                  setSourceStreamListener(false);
                  setSourceSessionLogFile(null);
                  setSourceSessionLog(null);
                  setSourceStreams(prev => ({ ...prev, [id]: false }));
                  //setBatchFilesDataframeInfoI(oldBatchFilesDataframeInfoI)
                  // unsubscribe sockets
                  socketRef.current.emit("graph_status_unsubscribe", { session_id: id });
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
              alert("We could not update the stream state. Please try again in a moment.");
              setWindows(prev =>
                prev.map(w =>
                  w.id === id ? { ...w, batchFilesDataframeInfoI:w.batchFilesDataframeInfoI, loadscreenState: false} : w
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
              iframe.current.contentWindow.postMessage(
                { action: menuId, payload: { id, settings: settingsToApply } },
                getTrustedMessageOrigin()
              );
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
            const newPayload = { id: "link", source_id: sanitizeGraphEndpointId(sourceId), graph_window_id: sanitizeGraphEndpointId(id) };

            // Send link request to backend
            apiFetch("/graph_link", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newPayload),
            })
              .then(data => {
                if (isSuccessResponse(data)) {
                  // Link succeeded
                  setGraphLinkState(true);
                  setGraphLinkSource(sourceId);
                  sourceRef.current = sourceId;
                  setGraphStatusListener(true);
                  alert("Linked to:",sourceId);
                  // -----------------------------
                  // 1️⃣ Determine relationships to send
                  // -----------------------------
                  const targetWindows = windowsRef.current.filter(
                    w => w.graphLinkSource === String(sourceId)
                  );

                  let existingRelationships = null;
                  // clone relationships from the existing siblings
                  if (targetWindows.length > 0) { //Could be 0 even the link is formed with the first child

                    // Use graphStatus from first linked window that has it
                    existingRelationships = targetWindows.find(w => w.graphStatus)?.graphStatus;
                  }
                  console.log("targetWindows.length:",targetWindows.length, targetWindows.id)
                  // Fallback: use global graphStatus
                  // No siblings found
                  if (!existingRelationships) {
                    // relationship that corelates with the linked source (cause this linking could be the first)
                    // graphStatus containes all the session status and relationships
                    const relationships = graphStatus[sourceId]?.relationships || [];
                    console.log("relationships_global:",graphStatus[sourceId],relationships)
                    existingRelationships = relationships;
                  }

                  // -----------------------------
                  // 2️⃣ Send relationships to the new window
                  // -----------------------------
                  if (existingRelationships) {
                    console.log("existingRelationships.length",existingRelationships.length)
                    setWindows(prev =>
                      prev.map(w =>
                        w.id === id
                          ? { ...w, graphStatus: existingRelationships}
                          : w
                      )
                    );
                  }
                  
                  // -----------------------------
                  // 3️⃣ Subscribe socket for streaming (doesnt over lap or duplicates)
                  // -----------------------------
                  const sessionKey = String(sourceId || "").trim();
                  if (sessionKey && socketRef.current) {
                    socketRef.current.emit("graph_status_subscribe", { session_id: sessionKey });
                    graphStatusSubscribedSessionsRef.current.add(sessionKey);
                  }
                  // -----------------------------
                  // 4️⃣ Update new window state
                  // -----------------------------
                  setWindows(prev =>
                    prev.map(w =>
                      w.id === id
                        ? {
                            ...w,
                            sessionId: sourceId,
                            graphLinkSource: sourceId,
                            selectedContent: "graph_content",
                            activeGraph: "graph_info_placeholder",                            
                            graphLink: true,
                            loadscreenState: false
                          }
                        : w
                    )
                  );
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
                setGraphLinkState(false);
                setGraphLinkSource(null);
                setGraphStatusListener(false);
                setWindows(prev =>
                  prev.map(w =>
                    w.id === id ? { ...w, activeGraph:"graph_placeholder",graphStatus:null,graphLinkSource:null,filterPropertyKeys:null,selectedContent:null,graphLink:false,loadscreenState: false} : w
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
                      iframe.current.contentWindow?.postMessage(
                        {
                          action: menuId,
                          payload: { id, file, settings: settingsToApply },
                        },
                        getTrustedMessageOrigin()
                      );
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
                    iframe.current.contentWindow?.postMessage(
                      {
                        action: menuId,
                        payload: { id, file, settings: settingsToApply },
                      },
                      getTrustedMessageOrigin()
                    );
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
            iframe.current.contentWindow.postMessage(
              { action: menuId, payload: "" },
              getTrustedMessageOrigin()
            );
          }          
        }
        if (menuId === "graph_print") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            iframe.current.contentWindow.postMessage(
              { action: menuId, payload: "" },
              getTrustedMessageOrigin()
            );
          }          
        }
        if (menuId === "graph_report") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            iframe.current.contentWindow.postMessage(
              { action: menuId, payload: { id, format: action || "html" } },
              getTrustedMessageOrigin()
            );
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
            iframe.current.contentWindow.postMessage(
              { action: menuId, payload: newSettings},
              getTrustedMessageOrigin()
            );
          }   
        }
        if (menuId === "export_graph") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            iframe.current.contentWindow.postMessage(
              { action: menuId, payload: action },
              getTrustedMessageOrigin()
            );
          }          
        }
        // ------------------------------------------------------------------- Graph window contents handling
        if (menuId === "create_chart") {
          const { iframe } = payload;
          console.log("here:",iframe)
            if (iframe?.current && iframe.current.contentWindow) {
              iframe.current.contentWindow.postMessage(
                { action: menuId, payload: action },
                getTrustedMessageOrigin()
              );
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
            iframe.current.contentWindow.postMessage(
              { action: menuId, payload: "" },
              getTrustedMessageOrigin()
            );
          }          
        }
        if (menuId === "chart_print") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            iframe.current.contentWindow.postMessage(
              { action: menuId, payload: "" },
              getTrustedMessageOrigin()
            );
          }          
        }
        if (menuId === "chart_reset") {
          const iframe=payload;          
          if (iframe?.current && iframe.current.contentWindow) {
            iframe.current.contentWindow.postMessage(
              { action: menuId, payload: "" },
              getTrustedMessageOrigin()
            );
          }          
        }
        console.log("batchFilesDataframeInfoI:",batchFilesDataframeInfoI)
        const nextSourceStep = w.type === "source" ? sourceStepFromSubContent(newSubContent) : w.sourceStep;
        return { ...w, 
          selectedContent: newContent, 
          selectedSubContent: newSubContent,
          sourceStep: nextSourceStep,
          batchFilesSearchHybrid: batchFilesSearchHybrid,
          batchFilesSearchHiveQuery: batchFilesSearchHiveQuery,
          batchFilesSearchResults: newBatchSearchResult, 
          searchResultsVisible: searchResultsVisible,
          batchFilesCollection : newBatchFilesCollection,
          searchPlaceholder: searchPlaceholder,
          batchFilesDataframeInfoI: w.batchFilesDataframeInfoI,
          batchFilesDataframeInfoII: batchFilesDataframeInfoII,
          loadscreenState: loadscreenState,
          sourceStreams: sourceStreams,
          textareaRefs: textareaRefs,
          isMaximized:isMaximized
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

  useIdleTimeout({
    enabled: Boolean(token) && idleSettings.enabled,
    warningMs: idleSettings.warningMs,
    timeoutMs: idleSettings.timeoutMs,
    isLocked: isWorkspaceLocked,
    resetKey: idleResetSeq,
    onWarn: () => {
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
      const minutesRemaining = Math.max(1, Math.ceil((idleSettings.timeoutMs - idleSettings.warningMs) / 60000));
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
    const resolvedSessionId = normalizeSessionId(sessionId || sessionIdRef.current || readStoredSessionId());
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
            if (hasRuleUpload) {
              const ruleUploadInput = document.getElementById("rule_to_upload");
              const ruleNameInput = document.querySelector('#configurations_form input[name="rule_name"]');
              if (ruleUploadInput) ruleUploadInput.value = "";
              if (ruleNameInput) ruleNameInput.value = "";
              setConfigurations((prev) => ({ ...prev, rule_name: "" }));
              alert("Rule uploaded!");
              handleConfigurationActions("load_default");
            } else {
              alert("Configuration saved!");
              handleConfigurationActions("load_default");
            }
            setloadscreenState(false);
          } 
          else {
            alert(data.message)
            setloadscreenState(false);
          }
        })
        .catch((err) => {
          console.error("err",err);
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
          handleConfigurationActions("load_default");
        } else {
          alert(`Remove failed: ${data.message}${data?.results ? ` (${String(data.results)})` : ""}`);
        }
        setloadscreenState(false);
      })
      .catch((err) => {
        console.error("ConfigRemoveErr", err);
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
          handleConfigurationActions("load_default");
        } else {
          alert(data.message);
        }
        if (importInput) importInput.value = "";
        setloadscreenState(false);
      })
      .catch((err) => {
        console.error("ConfigUploadErr", err);
        setloadscreenState(false);
      });
    }
    else if (id === "load_default"){
      const session = normalizeSessionId(sessionId || sessionIdRef.current || readStoredSessionId()); // Stored main session
      if (!session) {
        setloadscreenState(false);
        return;
      }
      const newPayload = { id: "load", session_id: session }
      debounceRef.current = setTimeout(() => {  
        setloadscreenState(true)    
        apiFetch("/configuration", {
          method: "POST",
          body: newPayload,
        })
        .then((data) => {
          if (isSuccessResponse(data)) {     
            try{
                  const configs = normalizeLoadedConfiguration(extractConfigurationPayload(data));
                  console.log("defaultConfig:", configs)                 
                  setConfigurations(configs) 
                  setloadscreenState(false)
                } 
                catch (error) {
                  console.error('Error parsing configurations:', error);
                  setloadscreenState(false)        
                }             
          } 
          else {
            alert(data.message)
            setloadscreenState(false)
          }
        })
        .catch((err) => {
          console.error("ConfigErr",err);  
          setloadscreenState(false)        
        });    
      }, 300);
    }
  };
  // --- Toggle Menu Actions ---
  const handleToggleMenu = (id) => {
    if (["toggle_menu_new_source_window", "toggle_menu_upload_source_window"].includes(id) && !requirePermission(PERMISSIONS.SOURCE_CREATE, "source windows")) return;
    if (id === "toggle_menu_new_graph_window" && !requirePermission(PERMISSIONS.GRAPH_CREATE, "graph windows")) return;
    if (id === "configurations" && !requirePermission(PERMISSIONS.CONFIG_READ, "configurations")) return;
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
      handleConfigurationActions("load_default")
      setIsConfigurationsOpen(prev => !prev);
      setIsSettingsOpen(false);
    }
    else if(id === "settings") {
      setIsSettingsOpen(prev => !prev);
      setIsConfigurationsOpen(false);
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
      className={showDarkHomeOverlay ? "linkx_app_shell linkx_app_shell--dark_home" : "linkx_app_shell"}
      style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden' }}
    >
      {/*<NetworkBackground />*/}
      <div
        className={isWorkspaceLocked ? "linkx_workspace_layer linkx_workspace_layer--locked" : "linkx_workspace_layer"}
        data-workspace-locked={isWorkspaceLocked ? "true" : "false"}
        style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 1 }}
      >
        {themeMode !== "dark" && <NavBar onNavAction={handleNavAction} user={user} />}
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
        <Configurations sessionId={sessionId} actions={handleConfigurationActions} loadscreenState={loadscreenState} setloadscreenState={setloadscreenState} toggleAction={handleToggleMenu} configurations={configurations} isConfigurationsOpen={isConfigurationsOpen} apiFetch={apiFetch} canAccess={canAccess} idleSettings={idleSettings} onIdleSettingsChange={updateIdleSettings}/>
        <Settings isSettingsOpen={isSettingsOpen} toggleAction={handleToggleMenu} actor={actor || user} roles={roles} permissions={permissions} canAccess={canAccess} apiFetch={apiFetch} sessionId={sessionId} onNotice={pushNotification} onLogout={() => performLogout("user_logout")} areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled} onBackgroundAnimationsChange={setBackgroundAnimationsEnabled} />
        <Main userName={userName} setSessionId={setSessionId} API_URL={API_URL} debounceRef={debounceRef} setConfigurations={setConfigurations} configurations={configurations} windows={windows} setWindows={setWindows} openWindows={handleOpenWindows} themeMode={themeMode} areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled} />
        {isWorkspaceLocked && (
          <WorkspaceLockOverlay
            user={actor || user}
            isUnlocking={isUnlockingWorkspace}
            lockMinutes={workspaceIdleLockMinutes}
            logoutMinutes={workspaceIdleLogoutMinutes}
            themeMode={themeMode}
            areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled}
            onUnlock={handleUnlockWorkspace}
            onLogout={() => performLogout("user_logout")}
          />
        )}
        {showDarkHomeOverlay && (
          <DarkHomeMenuOverlay
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

function WorkspaceLockOverlay({ user, isUnlocking, lockMinutes, logoutMinutes, themeMode, areBackgroundAnimationsEnabled, onUnlock, onLogout }) {
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
        <NetworkBackground name={displayName} themeMode={themeMode} />
      )}
      <div className="workspace_lock_panel">
        <h2>Workspace locked</h2>
        <p>{displayName}, your windows and activity are still here.</p>
        <p className="workspace_lock_hint">Locked after {lockMinutes} minute{lockMinutes === 1 ? "" : "s"}. Automatic logout after {logoutMinutes} minute{logoutMinutes === 1 ? "" : "s"} of inactivity.</p>
        <div className="workspace_lock_actions">
          <button type="button" onClick={onUnlock} disabled={isUnlocking}>{isUnlocking ? "Unlocking..." : "Unlock"}</button>
          <button type="button" onClick={onLogout} disabled={isUnlocking}>Log out</button>
        </div>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const auth = useAuth();

  if (!auth.isAuthReady) {
    return <Loadscreen loadingText={auth.isSsoAuthenticating ? "Completing single sign-on" : "Checking authentication"} />;
  }

  if (!auth.isAuthenticated) {
    return <LoginPage onLogin={auth.login} ssoError={auth.ssoError} isSsoAuthenticating={auth.isSsoAuthenticating} />;
  }

  return <LinkxWorkspace />;
}

function Root() {
  const API_URL = import.meta.env.VITE_API_URL;
  const SSO_ALLOWED_ORIGINS = [
    ...String(import.meta.env.VITE_SSO_ALLOWED_ORIGINS || "").split(","),
    ...String(import.meta.env.VITE_HEADER_ALLOWED_ORIGINS || "").split(","),
  ].map((item) => item.trim()).filter(Boolean);

  return (
    <AuthProvider apiUrl={API_URL} allowedSsoOrigins={SSO_ALLOWED_ORIGINS}>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

export default Root;
