(() => {
  const SOURCE_LABEL = "Graph";

  function postNotificationToParent(message, options = {}) {
    const text = String(message ?? "").trim();
    if (!text) return false;
    try {
      window.parent?.postMessage(
        {
          type: "app_notification",
          payload: {
            title: options.title || "Notification",
            message: text,
            level: options.level || "info",
            source: options.source || SOURCE_LABEL,
            durationMs: options.durationMs
          }
        },
        "*"
      );
      return true;
    } catch (_err) {
      return false;
    }
  }

  window.linkxNotify = (message, options = {}) => postNotificationToParent(message, options);

  if (!window.__linkxAlertBridgeInstalled) {
    window.__linkxAlertBridgeInstalled = true;
    const nativeAlert = typeof window.alert === "function" ? window.alert.bind(window) : null;
    window.alert = (message) => {
      const sent = postNotificationToParent(message, { title: "Alert", level: "warning" });
      if (!sent && nativeAlert) nativeAlert(message);
    };
  }
})();

window.addEventListener("message", (event) => {
  const { action, payload } = event.data;
  if (action === "theme_mode") {
    const nextMode = payload === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", nextMode);
    return;
  }
  switch (action) {
    case "network_components":      
      getNetworkComponents(payload);
      break;

    case "graph_search":
      graphSearch(payload);
      break;
    
    case "limit_nodes_key":      
      applyLimit(payload);
      break;
    
    case "limit_nodes_sort":      
      applyLimit(payload);
      break;

    case "limit_nodes_amount":      
      applyLimit(payload);
      break;
     
    case "label_nodes_group":
      window.currentSettings.lableGroup = payload;
      break;
    case "weight_edges":
      weightEdges(payload);
      break;

    case "show_title":
      let showTitleEnabled = payload;
      applyTitleToggle(showTitleEnabled);
      break;

    case "show_label":
      window.currentSettings.showLabels = payload;
      showNodelabels(window.currentSettings.showLabels);
      break;

    case "edit_infos":
      window.currentSettings.editInformations = payload;
      toggleNodeInfosEdit(window.currentSettings.editInformations);
      break;

    case "graph_physics":
      let state = payload;
      networkphysics(state);
      break;

    case "layout_type":
      let type = payload;
      networkLayoutType(type);
      break;

    case "layout_direction":
      let direction = payload;
      networkLayoutDirection(direction);
      break;

    case "sort_method":
      let sort = payload;
      networkLayoutSort(sort);
      break;

    case "layer_mode":
      networkLayerMode(payload);
      break;

    case "layer_key":
      networkLayerKey(payload);
      break;

    case "new_graph":      
      createNewGraph(payload); // <-- payload should contain {nodes, edges}
      break;

    case "load_graph_url":
      const id = payload?.id || null;  
      const file = payload?.file || null;  
      const settings = payload?.settings || null;
      loadGraphFromFile(id,file,settings);
      break;

    case "graph_snapshot":
      captureGraphSnapshot();
      break;
    
    case "graph_print":
      printGraph();
      break;

    case "export_graph":
      exportGraph(payload);
      break;      

    case "reset_graph":      
      resetGraph(payload);
      break;

    case "fit_graph":
      fit_graph();
      break;
    case "undo_graph":
      undoGraphAction();
      break;
    case "redo_graph":
      redoGraphAction();
      break;

    case "label_nodes_by":
      labelNodesWith(payload);
      break;

    case "graph_report":
      generateGraphReport(payload);
      break;

    default:
      console.warn("Unknown action:", action);
      break;
  }
});
// Passing a message to the parent window
function messageParent(payload){
  const {id, selectedNodes, selectedEdges} = payload;

  const nodeIds = Object.keys(selectedNodes || {}); // get IDs only
  const edgeIds = selectedEdges || []; // already an array from sender

  window.parent.postMessage(
    {
      type: id,
      payload: {        
        nodes: nodesData.get(nodeIds), // pass array of IDs
        edges: edgesData.get(edgeIds)  // pass array of edge IDs
      }
    },
    "*"
  );
}

function ensureInteractionPopupUi() {
  if (window.__linkxInteractionPopupUi) return window.__linkxInteractionPopupUi;

  if (!document.getElementById("linkx_interaction_popup_styles")) {
    const style = document.createElement("style");
    style.id = "linkx_interaction_popup_styles";
    style.textContent = `
      #linkx_interaction_overlay {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 2vh 2vw;
        background: rgba(10, 18, 24, 0.26);
        backdrop-filter: blur(1px);
        z-index: 2147483647;
      }
      #linkx_interaction_panel {
        width: min(520px, 94vw);
        min-height: 16vh;
        border: 0.1vh solid rgb(179, 179, 179);
        box-shadow: rgba(0, 0, 0, 0.2) 0px 0px 10px;
        background-color: rgba(255, 255, 255, 0.94);
        border-radius: 0.5vh;
        padding: 0.8vw;
        color: #333;
        font-family: "Segoe UI", Roboto, Arial, sans-serif;
      }
      #linkx_interaction_title {
        font-size: 14px;
        font-weight: 600;
        border-bottom: 0.1vh solid rgba(179, 179, 179, 0.45);
        padding-bottom: 0.5vh;
        margin-bottom: 0.9vh;
      }
      #linkx_interaction_message {
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        margin-bottom: 0.9vh;
        max-height: 32vh;
        overflow-y: auto;
      }
      #linkx_interaction_input,
      #linkx_interaction_textarea {
        width: 100%;
        box-sizing: border-box;
        border: 0.1vh solid rgba(179, 179, 179, 0.55);
        border-radius: 0.35vh;
        background: rgba(255, 255, 255, 0.85);
        color: #333;
        font-size: 13px;
        outline: none;
      }
      #linkx_interaction_input {
        height: 3.8vh;
        padding: 0 0.6vw;
        margin-bottom: 0.9vh;
      }
      #linkx_interaction_textarea {
        min-height: 18vh;
        padding: 0.6vh 0.6vw;
        resize: vertical;
        margin-bottom: 0.9vh;
      }
      #linkx_interaction_input:focus,
      #linkx_interaction_textarea:focus {
        border-color: rgba(86, 132, 172, 0.8);
        box-shadow: rgba(86, 132, 172, 0.2) 0px 0px 0.6vh;
      }
      #linkx_interaction_actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.45vw;
      }
      .linkx_interaction_btn {
        min-width: 82px;
        height: 3.5vh;
        border-radius: 0.3vh;
        border: 0.1vh solid rgba(160, 160, 160, 0.75);
        background: rgba(246, 246, 246, 0.96);
        color: #333;
        font-size: 12px;
        cursor: pointer;
      }
      .linkx_interaction_btn:hover {
        background: rgba(235, 235, 235, 1);
      }
      #linkx_interaction_ok {
        border-color: rgba(70, 122, 166, 0.75);
        background: rgba(223, 236, 247, 0.98);
      }
      #linkx_interaction_ok:hover {
        background: rgba(208, 227, 244, 1);
      }
      html[data-theme="dark"] #linkx_interaction_panel {
        border: 0.1vh solid #3a5165;
        box-shadow: rgba(0, 0, 0, 0.35) 0px 0px 10px;
        background-color: rgba(20, 31, 41, 0.96);
        color: #d8e5f0;
      }
      html[data-theme="dark"] #linkx_interaction_title {
        border-bottom: 0.1vh solid rgba(131, 165, 194, 0.35);
      }
      html[data-theme="dark"] #linkx_interaction_input,
      html[data-theme="dark"] #linkx_interaction_textarea {
        border: 0.1vh solid rgba(109, 143, 171, 0.55);
        background: rgba(18, 27, 36, 0.92);
        color: #d8e5f0;
      }
      html[data-theme="dark"] .linkx_interaction_btn {
        border: 0.1vh solid rgba(109, 143, 171, 0.75);
        background: rgba(35, 51, 64, 0.96);
        color: #d8e5f0;
      }
      html[data-theme="dark"] .linkx_interaction_btn:hover {
        background: rgba(52, 73, 90, 1);
      }
    `;
    document.head.appendChild(style);
  }

  const overlay = document.createElement("div");
  overlay.id = "linkx_interaction_overlay";

  const panel = document.createElement("div");
  panel.id = "linkx_interaction_panel";

  const titleEl = document.createElement("div");
  titleEl.id = "linkx_interaction_title";

  const messageEl = document.createElement("div");
  messageEl.id = "linkx_interaction_message";

  const inputEl = document.createElement("input");
  inputEl.id = "linkx_interaction_input";
  inputEl.type = "text";

  const textareaEl = document.createElement("textarea");
  textareaEl.id = "linkx_interaction_textarea";

  const actions = document.createElement("div");
  actions.id = "linkx_interaction_actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.id = "linkx_interaction_cancel";
  cancelBtn.className = "linkx_interaction_btn";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";

  const okBtn = document.createElement("button");
  okBtn.id = "linkx_interaction_ok";
  okBtn.className = "linkx_interaction_btn";
  okBtn.type = "button";
  okBtn.textContent = "OK";

  actions.appendChild(cancelBtn);
  actions.appendChild(okBtn);

  panel.appendChild(titleEl);
  panel.appendChild(messageEl);
  panel.appendChild(inputEl);
  panel.appendChild(textareaEl);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  window.__linkxInteractionPopupUi = {
    overlay,
    panel,
    titleEl,
    messageEl,
    inputEl,
    textareaEl,
    cancelBtn,
    okBtn
  };
  return window.__linkxInteractionPopupUi;
}

function showInteractionPopup({
  title = "Confirmation",
  message = "",
  mode = "confirm",
  defaultValue = "",
  placeholder = "",
  okText = "OK",
  cancelText = "Cancel",
  multiline = false
} = {}) {
  return new Promise(resolve => {
    const ui = ensureInteractionPopupUi();
    const { overlay, panel, titleEl, messageEl, inputEl, textareaEl, cancelBtn, okBtn } = ui;
    const isPrompt = mode === "prompt";
    const useTextarea = isPrompt && multiline;
    let finished = false;

    titleEl.textContent = title;
    messageEl.textContent = String(message ?? "");
    okBtn.textContent = okText;
    cancelBtn.textContent = cancelText;
    cancelBtn.style.display = "inline-block";

    inputEl.style.display = useTextarea ? "none" : (isPrompt ? "block" : "none");
    textareaEl.style.display = useTextarea ? "block" : "none";
    inputEl.value = isPrompt && !useTextarea ? String(defaultValue ?? "") : "";
    textareaEl.value = isPrompt && useTextarea ? String(defaultValue ?? "") : "";
    inputEl.placeholder = placeholder;
    textareaEl.placeholder = placeholder;

    const cleanup = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      overlay.removeEventListener("click", onBackdropClick, true);
      cancelBtn.removeEventListener("click", onCancel, true);
      okBtn.removeEventListener("click", onConfirm, true);
      overlay.style.display = "none";
    };

    const finish = (confirmed) => {
      if (finished) return;
      finished = true;
      const value = useTextarea ? textareaEl.value : inputEl.value;
      cleanup();
      resolve({
        confirmed: !!confirmed,
        value
      });
    };

    const onCancel = () => finish(false);
    const onConfirm = () => finish(true);
    const onBackdropClick = (event) => {
      if (event.target === overlay) finish(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(false);
        return;
      }
      if (event.key !== "Enter") return;
      if (useTextarea && !event.ctrlKey && !event.metaKey) return;
      if (panel.contains(event.target)) {
        event.preventDefault();
        finish(true);
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    overlay.addEventListener("click", onBackdropClick, true);
    cancelBtn.addEventListener("click", onCancel, true);
    okBtn.addEventListener("click", onConfirm, true);

    overlay.style.display = "flex";
    requestAnimationFrame(() => {
      const target = useTextarea ? textareaEl : inputEl;
      if (isPrompt) {
        target.focus();
        target.select?.();
      } else {
        okBtn.focus();
      }
    });
  });
}

async function requestUserInput(message, defaultValue = "", options = {}) {
  const result = await showInteractionPopup({
    title: options.title || "Input Required",
    message,
    mode: "prompt",
    defaultValue,
    placeholder: options.placeholder || "",
    okText: options.okText || "OK",
    cancelText: options.cancelText || "Cancel",
    multiline: options.multiline === true
  });
  return result.confirmed ? result.value : null;
}

async function requestUserConfirmation(message, options = {}) {
  const result = await showInteractionPopup({
    title: options.title || "Confirm",
    message,
    mode: "confirm",
    okText: options.okText || "Confirm",
    cancelText: options.cancelText || "Cancel"
  });
  return result.confirmed;
}

function clearVisibleGraph() {
  nodesData.clear();
  edgesData.clear();
  VISIBLE_STATE.nodes.clear();
  VISIBLE_STATE.edges.clear();
}

function getDocumentOneIconDataUri(fillColor = "#7c3aed") {
  const fill = String(fillColor || "#7c3aed");
  const pathData = "M19.5 3h0.5l6 7v18.009c0 1.093-0.894 1.991-1.997 1.991h-15.005c-1.107 0-1.997-0.899-1.997-2.007v-22.985c0-1.109 0.897-2.007 2.003-2.007h10.497zM19 4h-10.004c-0.55 0-0.996 0.455-0.996 0.995v23.009c0 0.55 0.455 0.995 1 0.995h15c0.552 0 1-0.445 1-0.993v-17.007h-4.002c-1.103 0-1.998-0.887-1.998-2.006v-4.994zM20 4.5v4.491c0 0.557 0.451 1.009 0.997 1.009h3.703l-4.7-5.5z";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="${fill}" d="${pathData}"/></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

if (!window.OLE_OBJECT_ICON_PATH) {
  window.OLE_OBJECT_ICON_PATH = getDocumentOneIconDataUri("#7c3aed");
}

function getOleObjectIconPath() {
  return window.OLE_OBJECT_ICON_PATH || getDocumentOneIconDataUri("#7c3aed");
}

function persistNodeChange(id, patch) {
  queueGraphHistoryCapture();
  window.MODIFIED_NODES.set(id, {
    ...(window.MODIFIED_NODES.get(id) || {}),
    ...patch
  });
}

function persistEdgeChange(id, patch) {
  queueGraphHistoryCapture();
  window.MODIFIED_EDGES.set(id, {
    ...(window.MODIFIED_EDGES.get(id) || {}),
    ...patch
  });
}

function EdgeWeightToWidth(weight, scale) {
  const minWidth = 1;
  const maxWidth = 6;
  const minW = Math.max(0, scale?.min ?? 0);
  const maxW = Math.max(minW, scale?.max ?? minW);
  const useLog = !!scale?.useLog;

  if (maxW <= minW) {
    return minWidth;
  }

  const clampedWeight = Math.min(maxW, Math.max(minW, weight));
  let normalized = 0;

  if (useLog) {
    const minLog = Math.log(minW + 1);
    const maxLog = Math.log(maxW + 1);
    normalized = (Math.log(clampedWeight + 1) - minLog) / (maxLog - minLog);
  } else {
    normalized = (clampedWeight - minW) / (maxW - minW);
  }

  const safeNormalized = Number.isFinite(normalized) ? normalized : 0;
  return minWidth + safeNormalized * (maxWidth - minWidth);
}

function toFiniteNumber(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const normalized = trimmed.replace(/,/g, "");
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) return numeric;

    // Range support, e.g. "20-50" or "300000 - 1000000"
    const rangeMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
    if (rangeMatch) {
      const lower = Number(rangeMatch[1]);
      const upper = Number(rangeMatch[2]);
      if (Number.isFinite(lower) && Number.isFinite(upper)) {
        return (lower + upper) / 2;
      }
    }

    // Fallback: try integer extraction for values like "350000 ETB"
    const parsedInteger = parseInt(normalized, 10);
    return Number.isFinite(parsedInteger) ? parsedInteger : null;
  }
  return null;
}

function toIntegerNumber(value) {
  const numeric = toFiniteNumber(value);
  if (numeric == null) return null;
  return Math.trunc(numeric);
}

function normalizeEdgeWeightMode(state) {
  if (state === true || state === "true") return "default";
  if (state === false || state === "false" || state == null) return "";
  return String(state).trim();
}

function normalizeLayerMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === "node_identity" || value === "by_key") return value;
  return "hop_distance";
}

const AUTO_PHYSICS_NODE_THRESHOLD = 300;
const GRAPH_LIMIT_HARD_MAX = 100000;
let AUTO_PHYSICS_FORCED_OFF = false;
let LAST_APPLIED_EFFECTIVE_PHYSICS = null;
const SAVED_VIEWS_STORAGE_KEY = "linkx_saved_views_v1";
const PINNED_EVIDENCE_STORAGE_KEY = "linkx_pinned_evidence_v1";
const ALERT_RULES_STORAGE_KEY = "linkx_alert_rules_v1";
const PATH_OPTIONS_STORAGE_KEY = "linkx_path_options_v1";
const MAX_SAVED_VIEWS = 30;
const DEFAULT_ALERT_RULES_CONFIG = {
  enableHighDegree: true,
  highDegreeMin: 3,
  highSeverityDegree: 8,
  maxHighDegreeAlerts: 5,
  enableHeavyEdge: true,
  heavyEdgePercentile: 95,
  heavyEdgeMinSamples: 4,
  maxHeavyEdgeAlerts: 5,
  heavyEdgeMinValue: 0
};
const DEFAULT_PATH_OPTIONS = {
  directed: false,
  weighted: false,
  includeThemeLines: false
};

function normalizeAlertRulesConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  const intOr = (value, fallback, min, max) => {
    const numeric = parseInt(value, 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  };
  const numOr = (value, fallback, min, max) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  };
  const boolOr = (value, fallback) => {
    if (value === true || value === false) return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  };

  return {
    enableHighDegree: boolOr(source.enableHighDegree, DEFAULT_ALERT_RULES_CONFIG.enableHighDegree),
    highDegreeMin: intOr(source.highDegreeMin, DEFAULT_ALERT_RULES_CONFIG.highDegreeMin, 1, 100000),
    highSeverityDegree: intOr(source.highSeverityDegree, DEFAULT_ALERT_RULES_CONFIG.highSeverityDegree, 1, 100000),
    maxHighDegreeAlerts: intOr(source.maxHighDegreeAlerts, DEFAULT_ALERT_RULES_CONFIG.maxHighDegreeAlerts, 1, 1000),
    enableHeavyEdge: boolOr(source.enableHeavyEdge, DEFAULT_ALERT_RULES_CONFIG.enableHeavyEdge),
    heavyEdgePercentile: numOr(source.heavyEdgePercentile, DEFAULT_ALERT_RULES_CONFIG.heavyEdgePercentile, 50, 99.99),
    heavyEdgeMinSamples: intOr(source.heavyEdgeMinSamples, DEFAULT_ALERT_RULES_CONFIG.heavyEdgeMinSamples, 2, 100000),
    maxHeavyEdgeAlerts: intOr(source.maxHeavyEdgeAlerts, DEFAULT_ALERT_RULES_CONFIG.maxHeavyEdgeAlerts, 1, 1000),
    heavyEdgeMinValue: numOr(source.heavyEdgeMinValue, DEFAULT_ALERT_RULES_CONFIG.heavyEdgeMinValue, 0, Number.MAX_SAFE_INTEGER)
  };
}

function normalizePathOptions(options) {
  const source = options && typeof options === "object" ? options : {};
  return {
    directed: source.directed === true || source.directed === "true",
    weighted: source.weighted === true || source.weighted === "true",
    includeThemeLines: source.includeThemeLines === true || source.includeThemeLines === "true"
  };
}

function readJsonStorage(key, fallbackValue) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallbackValue;
    const parsed = JSON.parse(raw);
    return parsed == null ? fallbackValue : parsed;
  } catch (_err) {
    return fallbackValue;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (_err) {
    // ignore storage errors
  }
}

window.SAVED_VIEWS = Array.isArray(window.SAVED_VIEWS)
  ? window.SAVED_VIEWS
  : readJsonStorage(SAVED_VIEWS_STORAGE_KEY, []);
window.PINNED_EVIDENCE = Array.isArray(window.PINNED_EVIDENCE)
  ? window.PINNED_EVIDENCE
  : readJsonStorage(PINNED_EVIDENCE_STORAGE_KEY, []);
window.ALERT_RULES_CONFIG = normalizeAlertRulesConfig(
  window.ALERT_RULES_CONFIG || readJsonStorage(ALERT_RULES_STORAGE_KEY, DEFAULT_ALERT_RULES_CONFIG)
);
window.PATH_OPTIONS = normalizePathOptions(
  window.PATH_OPTIONS || readJsonStorage(PATH_OPTIONS_STORAGE_KEY, DEFAULT_PATH_OPTIONS)
);
window.ALERT_RULES_ENABLED = window.ALERT_RULES_ENABLED !== false;
window.EDGE_BUNDLING_STATE = window.EDGE_BUNDLING_STATE || {
  enabled: false,
  originalByEdgeId: new Map(),
  bundledPrimaryEdges: new Set(),
  minGroupSize: 2
};
window.PATH_HIGHLIGHT_STATE = window.PATH_HIGHLIGHT_STATE || {
  nodeIds: new Set(),
  edgeIds: new Set()
};
window.ALERT_HIGHLIGHT_STATE = window.ALERT_HIGHLIGHT_STATE || {
  nodeIds: new Set(),
  edgeIds: new Set()
};
const GRAPH_HISTORY_MAX = 50;
const GRAPH_HISTORY_SNAPSHOT_LIMIT = 4500;
window.GRAPH_HISTORY = window.GRAPH_HISTORY || {
  undo: [],
  redo: [],
  pendingBefore: null,
  commitTimer: null,
  applying: false,
  max: GRAPH_HISTORY_MAX,
  warnedLargeGraph: false
};
window.__graphHistorySuspendDepth = window.__graphHistorySuspendDepth || 0;

function cloneHistoryValue(value) {
  if (value == null) return value;
  try {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  } catch (_err) {
    return JSON.parse(JSON.stringify(value));
  }
}

function suspendGraphHistoryStart() {
  window.__graphHistorySuspendDepth = (window.__graphHistorySuspendDepth || 0) + 1;
}

function suspendGraphHistoryEnd() {
  window.__graphHistorySuspendDepth = Math.max(0, (window.__graphHistorySuspendDepth || 0) - 1);
}

function clearPendingGraphHistoryCapture() {
  const history = window.GRAPH_HISTORY;
  if (!history) return;
  history.pendingBefore = null;
  if (history.commitTimer) {
    clearTimeout(history.commitTimer);
    history.commitTimer = null;
  }
}

function resetGraphHistoryBuffer() {
  const history = window.GRAPH_HISTORY;
  if (!history) return;
  clearPendingGraphHistoryCapture();
  history.undo = [];
  history.redo = [];
}

function canSnapshotGraphHistory() {
  const totalElements = (FULL_GRAPH?.nodes?.size || 0) + (FULL_GRAPH?.edges?.size || 0);
  if (totalElements <= GRAPH_HISTORY_SNAPSHOT_LIMIT) return true;
  const history = window.GRAPH_HISTORY;
  if (history && !history.warnedLargeGraph) {
    history.warnedLargeGraph = true;
    window.linkxNotify?.(
      `Undo/Redo is disabled for large graphs (>${GRAPH_HISTORY_SNAPSHOT_LIMIT} entities).`,
      { title: "History", level: "warning" }
    );
  }
  return false;
}

function captureGraphHistorySnapshot() {
  if (!canSnapshotGraphHistory()) return null;
  return {
    fullNodes: Array.from(FULL_GRAPH.nodes.entries()).map(([id, node]) => [id, cloneHistoryValue(node)]),
    fullEdges: Array.from(FULL_GRAPH.edges.entries()).map(([id, edge]) => [id, cloneHistoryValue(edge)]),
    modifiedNodes: Array.from(MODIFIED_NODES.entries()).map(([id, patch]) => [id, cloneHistoryValue(patch)]),
    modifiedEdges: Array.from(MODIFIED_EDGES.entries()).map(([id, patch]) => [id, cloneHistoryValue(patch)]),
    visibleNodes: Array.from(VISIBLE_STATE.nodes),
    visibleEdges: Array.from(VISIBLE_STATE.edges),
    settings: cloneHistoryValue(window.currentSettings || {}),
    limitOverridden: !!window.limitOverridden,
    pathNodeIds: Array.from(window.PATH_HIGHLIGHT_STATE?.nodeIds || []),
    pathEdgeIds: Array.from(window.PATH_HIGHLIGHT_STATE?.edgeIds || []),
    alertNodeIds: Array.from(window.ALERT_HIGHLIGHT_STATE?.nodeIds || []),
    alertEdgeIds: Array.from(window.ALERT_HIGHLIGHT_STATE?.edgeIds || []),
    selectedNodes: typeof network?.getSelectedNodes === "function" ? network.getSelectedNodes() : [],
    selectedEdges: typeof network?.getSelectedEdges === "function" ? network.getSelectedEdges() : []
  };
}

function applyGraphHistorySnapshot(snapshot) {
  if (!snapshot) return;
  const history = window.GRAPH_HISTORY;
  if (!history) return;

  history.applying = true;
  suspendGraphHistoryStart();
  try {
    clearPendingGraphHistoryCapture();

    nodesData.clear();
    edgesData.clear();
    FULL_GRAPH.nodes.clear();
    FULL_GRAPH.edges.clear();
    MODIFIED_NODES.clear();
    MODIFIED_EDGES.clear();
    VISIBLE_STATE.nodes.clear();
    VISIBLE_STATE.edges.clear();

    (snapshot.fullNodes || []).forEach(([id, node]) => {
      FULL_GRAPH.nodes.set(id, cloneHistoryValue(node));
    });
    (snapshot.fullEdges || []).forEach(([id, edge]) => {
      FULL_GRAPH.edges.set(id, cloneHistoryValue(edge));
    });
    (snapshot.modifiedNodes || []).forEach(([id, patch]) => {
      MODIFIED_NODES.set(id, cloneHistoryValue(patch));
    });
    (snapshot.modifiedEdges || []).forEach(([id, patch]) => {
      MODIFIED_EDGES.set(id, cloneHistoryValue(patch));
    });
    (snapshot.visibleNodes || []).forEach((id) => VISIBLE_STATE.nodes.add(id));
    (snapshot.visibleEdges || []).forEach((id) => VISIBLE_STATE.edges.add(id));

    window.currentSettings = cloneHistoryValue(snapshot.settings || window.currentSettings || {});
    window.limitOverridden = !!snapshot.limitOverridden;

    if (window.PATH_HIGHLIGHT_STATE) {
      window.PATH_HIGHLIGHT_STATE.nodeIds.clear();
      window.PATH_HIGHLIGHT_STATE.edgeIds.clear();
      (snapshot.pathNodeIds || []).forEach((id) => window.PATH_HIGHLIGHT_STATE.nodeIds.add(id));
      (snapshot.pathEdgeIds || []).forEach((id) => window.PATH_HIGHLIGHT_STATE.edgeIds.add(id));
    }
    if (window.ALERT_HIGHLIGHT_STATE) {
      window.ALERT_HIGHLIGHT_STATE.nodeIds.clear();
      window.ALERT_HIGHLIGHT_STATE.edgeIds.clear();
      (snapshot.alertNodeIds || []).forEach((id) => window.ALERT_HIGHLIGHT_STATE.nodeIds.add(id));
      (snapshot.alertEdgeIds || []).forEach((id) => window.ALERT_HIGHLIGHT_STATE.edgeIds.add(id));
    }

    rebuildAdjacencyFromFullGraph();
    renderVisibleGraphBatch();
    if (Array.isArray(snapshot.selectedNodes) && snapshot.selectedNodes.length > 0) {
      network.selectNodes(snapshot.selectedNodes);
      if (Array.isArray(snapshot.selectedEdges) && snapshot.selectedEdges.length > 0) {
        network.selectEdges(snapshot.selectedEdges);
      }
    } else if (typeof network?.unselectAll === "function") {
      network.unselectAll();
    }
  } finally {
    suspendGraphHistoryEnd();
    history.applying = false;
  }
}

function queueGraphHistoryCapture() {
  const history = window.GRAPH_HISTORY;
  if (!history || history.applying || (window.__graphHistorySuspendDepth || 0) > 0) return;
  if (!history.pendingBefore) {
    history.pendingBefore = captureGraphHistorySnapshot();
  }
  if (!history.pendingBefore || history.commitTimer) return;
  history.commitTimer = setTimeout(() => {
    commitGraphHistoryCapture();
  }, 0);
}

function commitGraphHistoryCapture() {
  const history = window.GRAPH_HISTORY;
  if (!history) return;
  if (history.commitTimer) {
    clearTimeout(history.commitTimer);
    history.commitTimer = null;
  }
  if (history.applying || (window.__graphHistorySuspendDepth || 0) > 0) {
    history.pendingBefore = null;
    return;
  }
  const before = history.pendingBefore;
  history.pendingBefore = null;
  if (!before) return;

  history.undo.push(before);
  if (history.undo.length > history.max) {
    history.undo.splice(0, history.undo.length - history.max);
  }
  history.redo = [];
}

function undoGraphAction() {
  const history = window.GRAPH_HISTORY;
  if (!history) return;
  commitGraphHistoryCapture();
  if (!history.undo.length) return;
  const current = captureGraphHistorySnapshot();
  const previous = history.undo.pop();
  if (current) {
    history.redo.push(current);
    if (history.redo.length > history.max) {
      history.redo.splice(0, history.redo.length - history.max);
    }
  }
  applyGraphHistorySnapshot(previous);
}

function redoGraphAction() {
  const history = window.GRAPH_HISTORY;
  if (!history) return;
  commitGraphHistoryCapture();
  if (!history.redo.length) return;
  const current = captureGraphHistorySnapshot();
  const next = history.redo.pop();
  if (current) {
    history.undo.push(current);
    if (history.undo.length > history.max) {
      history.undo.splice(0, history.undo.length - history.max);
    }
  }
  applyGraphHistorySnapshot(next);
}

function getDefaultEdgeWidth(edgeId) {
  const base = FULL_GRAPH.edges.get(edgeId) || {};
  const numeric = toFiniteNumber(base.width ?? base.weight ?? base.value);
  if (numeric == null) return 1;
  return Math.max(1, numeric);
}

function getNodeNumericValueMap(key) {
  const values = new Map();
  if (!key) return values;

  for (const [nodeId, node] of FULL_GRAPH.nodes) {
    const numeric = toIntegerNumber(getNodeValue(node, key));
    if (numeric != null) {
      values.set(nodeId, numeric);
    }
  }
  return values;
}

function getEdgeWeightFromNodeValues(edge, nodeValues) {
  const sourceValue = nodeValues.get(edge.from);
  const targetValue = nodeValues.get(edge.to);

  if (sourceValue != null && targetValue != null) {
    return Math.max(0, Math.round((sourceValue + targetValue) / 2));
  }
  if (sourceValue != null) return Math.max(0, sourceValue);
  if (targetValue != null) return Math.max(0, targetValue);
  return 1;
}

function getPercentile(sortedValues, percentile) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 1;
  const bounded = Math.max(0, Math.min(1, percentile));
  const index = (sortedValues.length - 1) * bounded;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }
  const lowerValue = sortedValues[lowerIndex];
  const upperValue = sortedValues[upperIndex];
  const ratio = index - lowerIndex;
  return lowerValue + (upperValue - lowerValue) * ratio;
}

function getAdaptiveWeightScale(values) {
  const positives = (values || []).filter(v => Number.isFinite(v) && v >= 0);
  if (positives.length === 0) {
    return { min: 1, max: 1, useLog: false };
  }

  const sorted = positives.slice().sort((a, b) => a - b);
  const absoluteMin = sorted[0];
  const absoluteMax = sorted[sorted.length - 1];

  let rangeMin = getPercentile(sorted, 0.05);
  let rangeMax = getPercentile(sorted, 0.95);

  if (!Number.isFinite(rangeMin) || !Number.isFinite(rangeMax) || rangeMax <= rangeMin) {
    rangeMin = absoluteMin;
    rangeMax = absoluteMax;
  }

  if (rangeMax <= rangeMin) {
    return { min: rangeMin, max: rangeMax, useLog: false };
  }

  const spreadRatio = (rangeMax + 1) / (Math.max(0, rangeMin) + 1);
  const useLog = spreadRatio > 30;
  return { min: rangeMin, max: rangeMax, useLog };
}

// overwrite with the latest options (for runtime changes like Physics/ Layouts)
function updateGraphOption(settingName, value) {
  switch (settingName) {
    case "graph_physics":
      // store boolean directly
      window.currentOptions.physics = !!value;
      break;

    case "layout_type":
      if (value === "hierarchical") {
        window.currentOptions.layout = {
          hierarchical: {
            enabled: true,
            direction: "UD",
            sortMethod: "directed"
          }
        };
      } else {
        window.currentOptions.layout = {};
      }
      break;

    case "layout_direction":
      if (window.currentOptions.layout.hierarchical) {
        window.currentOptions.layout.hierarchical.direction = value;
      }
      break;

    case "layout_sort":
      if (window.currentOptions.layout.hierarchical) {
        window.currentOptions.layout.hierarchical.sortMethod = value;
      }
      break;
  }
}

function areDataSetsEqual(ds1, ds2) {
    const items1 = ds1.get();
    const items2 = ds2.get();

    if (items1.length !== items2.length) return false;

    // compare item by item
    return items1.every(item1 => {
        const item2 = items2.find(i => i.id === item1.id);
        return item2 && JSON.stringify(item1) === JSON.stringify(item2);
    });
}

function areAllSelectedNodesLinked(selectedNodes) {
  for (let i = 0; i < selectedNodes.length; i++) {
    for (let j = i + 1; j < selectedNodes.length; j++) {
      const a = selectedNodes[i];
      const b = selectedNodes[j];

      const edges = edgesData.get({
        filter: e =>
          (e.from === a && e.to === b) ||
          (e.from === b && e.to === a)
      });

      if (edges.length === 0) return false;
    }
  }
  return true;
}

// overwrite with the latest state
function syncModifiedNodes() {
  nodesData.forEach(node => {
    persistNodeChange(node.id, node);
  });
}

function getAllNodeKeys(id) {
  const keySet = new Set();

  const excludeKeys = new Set([
    "size","x","y","vx","vy","index","edges","neighbors",
    "color","shape","borderWidth","borderWidthSelected",
    "borderWidth1","image","imagePadding","iconPath",
    "title","batch_id","input_file","label","nodes_label","colorBehavior"
  ]);

  for (const node of FULL_GRAPH.nodes.values()) {
    for (const key of Object.keys(node)) {
      if (!excludeKeys.has(key)) keySet.add(key);
    }
  }

  window.parent.postMessage({
    type: "all_property_keys_response",
    payload: { id, keys: [...keySet] }
  }, "*");
}

function normalizeLimitRange(value, fallbackMax = 25) {
  const clampInt = (num, min, max) => Math.max(min, Math.min(max, Math.floor(Number(num) || 0)));

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const minRaw = value.min ?? 0;
    const maxRaw = value.max ?? fallbackMax;
    const min = clampInt(minRaw, 0, GRAPH_LIMIT_HARD_MAX - 1);
    const max = clampInt(maxRaw, 1, GRAPH_LIMIT_HARD_MAX);
    return { min, max: Math.max(min + 1, max) };
  }

  if (Array.isArray(value) && value.length >= 2) {
    const min = clampInt(value[0], 0, GRAPH_LIMIT_HARD_MAX - 1);
    const max = clampInt(value[1], 1, GRAPH_LIMIT_HARD_MAX);
    return { min, max: Math.max(min + 1, max) };
  }

  const max = clampInt(value, 1, GRAPH_LIMIT_HARD_MAX) || clampInt(fallbackMax, 1, GRAPH_LIMIT_HARD_MAX);
  return { min: 0, max };
}

function restoreSettings(settings) {
  if (!settings || !Array.isArray(settings)) {
    console.warn("Invalid settings array, skipping restore.");
    return;
  }

  try {
    const asBool = (value) => value === true || value === "true";
    const limitAmount = normalizeLimitRange(settings[2], 25);
    const layoutType = settings[10] || "default";
    const layoutDirection = settings[11] || "UD";
    const layerMode = normalizeLayerMode(settings[13] || "hop_distance");
    const layerKey = settings[14] == null ? "" : String(settings[14]);

    if (settings[3]) {
      window.currentSettings.lableGroup = settings[3];
    }
    window.currentSettings.layoutDirection = layoutDirection;
    window.currentSettings.layerMode = layerMode;
    window.currentSettings.layerKey = layerKey;

    applyLimit({
      key: settings[0],
      sort: settings[1] || "asc",
      amount: limitAmount
    });

    if (settings[4]) {
      labelNodesWith({
        labelIdentity: settings[3] || window.currentSettings.lableGroup || "Entity Node",
        labelkey: settings[4],
        filterKey: settings[0] || "",
        filterSort: settings[1] || "asc",
        limitAmount
      });
    }

    weightEdges(settings[5]);
    applyTitleToggle(asBool(settings[6]));
    showNodelabels(asBool(settings[7]));
    console.log("Skipping edit infos at index 6.");
    networkphysics(asBool(settings[9]));
    networkLayoutType(layoutType);

    if (layoutType === "hierarchical") {
      networkLayoutDirection(layoutDirection);
      networkLayoutSort(settings[12]);
    }

    const alertRulesEnabled = window.currentSettings.alertRules !== false;
    const bundlingEnabled = !!window.currentSettings.edgeBundling;
    toggleAlertRules(alertRulesEnabled);
    toggleEdgeBundlingLite(bundlingEnabled);
  } catch (err) {
    console.error("Error in restoreSettings:", err);
  }
}

function brightenColor(hex, percent) {
  // Remove "#" if present
  hex = hex.replace(/^#/, "");

  // Parse r, g, b
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  // Brighten each channel more aggressively
  r = Math.max(0, Math.min(255, r + (255 - r) * (percent / 100)));
  g = Math.max(0, Math.min(255, g + (255 - g) * (percent / 100)));
  b = Math.max(0, Math.min(255, b + (255 - b) * (percent / 100)));

  // Return brightened hex
  return "#" +
    ("0" + Math.round(r).toString(16)).slice(-2) +
    ("0" + Math.round(g).toString(16)).slice(-2) +
    ("0" + Math.round(b).toString(16)).slice(-2);
}

function darkenColor(hex, percent) {
  // Remove "#" if present
  hex = hex.replace(/^#/, "");

  // Parse r,g,b
  let r = parseInt(hex.substring(0,2), 16);
  let g = parseInt(hex.substring(2,4), 16);
  let b = parseInt(hex.substring(4,6), 16);

  // Darken each channel
  r = Math.max(0, Math.min(255, r * (100 - percent) / 100));
  g = Math.max(0, Math.min(255, g * (100 - percent) / 100));
  b = Math.max(0, Math.min(255, b * (100 - percent) / 100));

  // Return darkened hex
  return "#" + 
    ("0" + Math.round(r).toString(16)).slice(-2) +
    ("0" + Math.round(g).toString(16)).slice(-2) +
    ("0" + Math.round(b).toString(16)).slice(-2);
}

function updateNodeLabel(nodeId, label) {
  nodesData.update({ id: nodeId, label });
  persistNodeChange(nodeId, { label });
}

function updateEdgeLabel(edgeId, label) {
  const edge = edgesData.get(edgeId);
  if (!edge) {
    console.warn("[updateEdgeLabel] Edge not found:", edgeId);
    return;
  }
  queueGraphHistoryCapture();
  MODIFIED_EDGES.set(edgeId, {
    ...(MODIFIED_EDGES.get(edgeId) || {}),
    label
  });

  edgesData.update({
    id: edgeId,
    label
  });
}


function UpdateNodeShape(newShape) {
  const selectedNodes = network.getSelectedNodes();
  if (!selectedNodes.length) return;

  selectedNodes.forEach(id => {
    const node = nodesData.get(id);
    if (!node) return;

    // Retrieve previously stored iconPath
    const mod = MODIFIED_NODES.get(id) || {};
    const iconPath = mod.iconPath || node.iconPath || null;

    let shape = newShape;

    if (newShape === "dot" && iconPath) {
      // Force circularImage if icon exists
      shape = "circularImage";
    }
    const patch = {
      shape,
      size: node.size ?? 15
    };

    // Only add image if shape supports it
    if (shape === "circularImage" && iconPath) {
      patch.image = iconPath;
      patch.imagePadding = 10;
    }

    nodesData.update({ id, ...patch });

    // Always persist iconPath to MODIFIED_NODES
    persistNodeChange(id, {
      ...patch,
      iconPath
    });
  });
}

function UpdateEdgeStyle(edgeId, newStyle) {
  const edge = edgesData.get(edgeId);
  if (!edge) {
    console.warn("[UpdateEdgeStyle] Edge not found:", edgeId);
    return;
  }
  queueGraphHistoryCapture();

  let dashes = false;

  switch (newStyle) {
    case "solid":
      dashes = false;
      break;

    case "dashed":
      dashes = [10, 6];
      break;

    case "dotted":
      dashes = [2, 6];
      break;

    case "dashdot":
      dashes = [10, 4, 2, 4];
      break;

    default:
      console.warn("[UpdateEdgeStyle] Unknown style:", newStyle);
      return;
  }

  MODIFIED_EDGES.set(edgeId, {
    ...(MODIFIED_EDGES.get(edgeId) || {}),
    dashes: dashes,
    edgeStyle: newStyle
  });

  edgesData.update({
    id: edgeId,
    dashes
  });
}


function updateNodeSize(nodeId, size) {
  nodesData.update({ id: nodeId, size });
  persistNodeChange(nodeId, { size });
}

function updateEdgesWeight(edgeId, width) {
  const edge = edgesData.get(edgeId);
  if (!edge) {
    console.warn("[updateEdgesWeight] Edge not found:", edgeId);
    return;
  }
  queueGraphHistoryCapture();

  // Constrain width between 1 and 6
  const safeWidth = Math.max(1, Math.min(Number(width) || 1, 6));

  MODIFIED_EDGES.set(edgeId, {
    ...(MODIFIED_EDGES.get(edgeId) || {}),
    width: safeWidth    
  });

  edgesData.update({
    id: edgeId,
    width: safeWidth    
  });
}


// Helper to apply color while preserving border and sizes
function applyColorBehavior(nodeId, color) {
  const node = nodesData.get(nodeId);
  if (!node) return;

  const borderColor = darkenColor(color, 20);

  const patch = {
    color: {
      background: color,
      border: borderColor,
      hover: { background: color, border: borderColor },
      highlight: { background: color, border: borderColor }
    }
  };

  nodesData.update({ id: nodeId, ...patch });
  persistNodeChange(nodeId, patch);
}

// Function to update edge color
function updateEdgeColor(edgeId, baseColor) {
  const edge = edgesData.get(edgeId);
  if (!edge) {
    console.warn("[updateEdgeColor] Edge not found:", edgeId);
    return;
  }
  queueGraphHistoryCapture();

  const color = {
    color: baseColor,
    highlight: baseColor,
    hover: baseColor,
    inherit: false
  };

  MODIFIED_EDGES.set(edgeId, {
    ...(MODIFIED_EDGES.get(edgeId) || {}),
    color,
    baseColor
  });

  edgesData.update({
    id: edgeId,
    color
  });
}

function normalizeHex(hex) {
  return hex.startsWith("#") ? hex : "#" + hex;
}

function buildNodeColor(baseColor, {
  borderShift = 20,
  hoverShift = 12,
  highlightShift = 18,
  focusShift = 25
} = {}) {
  baseColor = normalizeHex(baseColor);

  return {
    background: baseColor,

    border: darkenColor(baseColor, borderShift),

    hover: {
      background: brightenColor(baseColor, hoverShift),
      border: darkenColor(baseColor, borderShift)
    },

    highlight: {
      background: brightenColor(baseColor, highlightShift),
      border: darkenColor(baseColor, borderShift)
    },

    // vis doesn't officially document "focus",
    // but it DOES respect it internally
    focus: {
      background: brightenColor(baseColor, focusShift),
      border: darkenColor(baseColor, borderShift + 5)
    }
  };
}

// Function to update node color
function updateNodeColor(nodeIds, baseColor) {
  if (!Array.isArray(nodeIds)) nodeIds = [nodeIds]; // always an array
  queueGraphHistoryCapture();
  const color = buildNodeColor(baseColor);

  // Map to track affected nodes (avoid duplicates)
  const affectedNodes = new Map(); // key: idKey, value: real nodeId
  function idKey(id) { return String(id); }

  // Helper to get neighbors
  function getNeighbors(id) {
    return edgesData.get({
      filter: e => e.from === id || e.to === id
    }).map(e => (e.from === id ? e.to : e.from));
  }

  // First pass: collect affected nodes
  nodeIds.forEach(nodeId => {
    const behavior = (MODIFIED_NODES.get(nodeId)?.colorBehavior || "individual").toLowerCase();

    // Always include the node itself
    affectedNodes.set(idKey(nodeId), nodeId);

    // If link behavior, add all neighbors
    if (behavior === "link") {
      getNeighbors(nodeId).forEach(nId => affectedNodes.set(idKey(nId), nId));
    }
  });

  // ---- Update Nodes ----
  affectedNodes.forEach(realId => {
    MODIFIED_NODES.set(realId, {
      ...(MODIFIED_NODES.get(realId) || {}),
      color,
      baseColor
    });

    if (nodesData.get(realId)) {
      nodesData.update({ id: realId, color });
    }
  });

  // ---- Update Edges (link behavior) ----
  edgesData.get().forEach(edge => {
    const from = edge.from;
    const to   = edge.to;

    if (affectedNodes.has(idKey(from)) && affectedNodes.has(idKey(to))) {
      const edgeColor = {
        color: color.background,
        hover: brightenColor(color.background, 15),
        highlight: brightenColor(color.background, 25)
      };

      MODIFIED_EDGES.set(edge.id, {
        ...(MODIFIED_EDGES.get(edge.id) || {}),
        color: edgeColor
      });

      edgesData.update({ id: edge.id, color: edgeColor });
    }
  });
}




function updateNodeDisplay(node) {
  const el = document.getElementById(node.id);
  if (!el) return;

  el.style.transform = "rotate(0deg)";
  el.style.borderRadius = node.shape === "diamond" ? "0%" : "50%";

  if (node.shape === "diamond") {
    el.style.transform = "rotate(45deg)";
  }

  const bg = node.color?.background || "#EEE";
  el.style.backgroundColor = bg;
  el.style.borderColor = darkenColor(bg, 20);
}


function applyNodeIcon(nodeId, iconPath) {
  if (!nodesData.get(nodeId)) return;

  const patch = {
    shape: "circularImage",
    image: iconPath,
    imagePadding: 10,
    iconPath
  };

  nodesData.update({ id: nodeId, ...patch });
  persistNodeChange(nodeId, patch);
}


function updateNodeNote(nodeId, text) {
  if (!nodesData.get(nodeId)) return;

  nodesData.update({ id: nodeId, note: text });
  persistNodeChange(nodeId, { note: text });
}

function updateNodeFont(nodeId, fontPatch = {}) {
  if (nodeId == null) return;
  const id = normalizeGraphId(nodeId);
  const base = FULL_GRAPH.nodes.get(id) || {};
  const mod = MODIFIED_NODES.get(id) || {};
  const current = nodesData.get(id) || {};
  const mergedFont = {
    ...(base.font || {}),
    ...(mod.font || {}),
    ...(current.font || {}),
    ...(fontPatch || {})
  };
  nodesData.update({ id, font: mergedFont });
  persistNodeChange(id, { font: mergedFont });
}

function updateNodeEventFrame(nodeId, patch = {}) {
  if (nodeId == null) return;
  const id = normalizeGraphId(nodeId);
  const normalizedPatch = { ...patch };
  if (Array.isArray(normalizedPatch.eventTypes)) {
    normalizedPatch.eventTypes = normalizedPatch.eventTypes.map(item => String(item));
  }
  nodesData.update({ id, ...normalizedPatch });
  persistNodeChange(id, normalizedPatch);
}

function updateNodeAttachment(nodeId, patch = {}) {
  if (nodeId == null) return;
  const id = normalizeGraphId(nodeId);
  const attachmentPatch = { ...patch };
  nodesData.update({ id, ...attachmentPatch });
  persistNodeChange(id, attachmentPatch);
}

function getMergedNodeById(nodeId) {
  const id = normalizeGraphId(nodeId);
  const base = FULL_GRAPH.nodes.get(id) || {};
  const mod = MODIFIED_NODES.get(id) || {};
  const current = nodesData.get(id) || {};
  return { ...base, ...current, ...mod };
}

function nodeHasAttachment(nodeId) {
  const merged = getMergedNodeById(nodeId);
  const link = String(merged.attachmentLink || "").trim();
  const dataUrl = String(merged.attachmentDataUrl || "").trim();
  return link !== "" || dataUrl !== "";
}

function normalizeExternalLink(rawLink) {
  const trimmed = String(rawLink || "").trim();
  if (!trimmed) return "";
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}

function openNodeAttachmentFile(nodeId) {
  if (nodeId == null) return false;
  const merged = getMergedNodeById(nodeId);
  const attachmentDataUrl = String(merged.attachmentDataUrl || "").trim();
  const attachmentName = String(merged.attachmentName || "attachment");

  if (!attachmentDataUrl) return false;
  const anchor = document.createElement("a");
  anchor.href = attachmentDataUrl;
  anchor.download = attachmentName;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  return true;
}

function openNodeAttachmentLink(nodeId) {
  if (nodeId == null) return false;
  const merged = getMergedNodeById(nodeId);
  const normalizedLink = normalizeExternalLink(merged.attachmentLink);
  if (!normalizedLink) return false;
  const anchor = document.createElement("a");
  anchor.href = normalizedLink;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  return true;
}

function openNodeAttachment(nodeId) {
  if (nodeId == null) return false;
  if (openNodeAttachmentFile(nodeId)) return true;
  if (openNodeAttachmentLink(nodeId)) return true;

  return false;
}

function getDocumentOutlineIconDataUri(strokeColor = "#4b5563", fillColor = "#ffffff") {
  const stroke = String(strokeColor || "#4b5563");
  const fill = String(fillColor || "#ffffff");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M20 8H52V56H12V16L20 8Z" fill="${fill}" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M12 16H20V8" fill="none" stroke="${stroke}" stroke-width="3" stroke-linejoin="round"/>
  <path d="M22 26H46M22 34H46M22 42H40" stroke="${stroke}" stroke-width="2.4" stroke-linecap="round"/>
</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function shouldKeepNodeLabelVisible(node) {
  if (!node || typeof node !== "object") return false;
  if (node.annotationType) return true;
  const shape = String(node.shape || "").toLowerCase();
  return shape === "text";
}

function getNodeRenderLabel(baseNode, modNode, showLabelsState) {
  const merged = { ...(baseNode || {}), ...(modNode || {}) };
  const candidate = merged.label ?? baseNode?.label ?? "";
  if (showLabelsState || shouldKeepNodeLabelVisible(merged)) {
    return candidate;
  }
  return "";
}

function buildNodeColorWithBorder(baseColor, borderColor) {
  const normalizedBase = typeof baseColor === "string" && baseColor.trim() !== ""
    ? normalizeHex(baseColor.trim())
    : "#ffffff";
  return {
    background: normalizedBase,
    border: borderColor,
    highlight: { background: normalizedBase, border: borderColor },
    hover: { background: normalizedBase, border: borderColor }
  };
}

function getNodeBackgroundColor(node) {
  if (!node || !node.color) return "#ffffff";
  if (typeof node.color === "string") return node.color;
  if (typeof node.color.background === "string") return node.color.background;
  return "#ffffff";
}

function applyNodeStateDecorations(mergedNode, nodeId, markerSets) {
  const isPath = markerSets.pathNodeIds.has(nodeId);
  const isAlert = markerSets.alertNodeIds.has(nodeId);
  const isPinned = markerSets.pinnedNodeIds.has(nodeId);
  if (!isPath && !isAlert && !isPinned) return;

  const baseBg = getNodeBackgroundColor(mergedNode);
  if (isPath) {
    mergedNode.borderWidth = Math.max(3.5, Number(mergedNode.borderWidth) || 1);
    mergedNode.color = buildNodeColorWithBorder(baseBg, "#f97316");
    mergedNode.shadow = { enabled: true, color: "rgba(249,115,22,0.45)", size: 18, x: 0, y: 0 };
    return;
  }
  if (isAlert) {
    mergedNode.borderWidth = Math.max(3.2, Number(mergedNode.borderWidth) || 1);
    mergedNode.color = buildNodeColorWithBorder(baseBg, "#dc2626");
    mergedNode.shadow = { enabled: true, color: "rgba(220,38,38,0.35)", size: 16, x: 0, y: 0 };
    return;
  }
  if (isPinned) {
    mergedNode.borderWidth = Math.max(3.2, Number(mergedNode.borderWidth) || 1);
    mergedNode.color = buildNodeColorWithBorder(baseBg, "#f59e0b");
    mergedNode.shadow = { enabled: true, color: "rgba(245,158,11,0.40)", size: 16, x: 0, y: 0 };
  }
}

function getEdgeBaseColor(edge) {
  if (!edge || !edge.color) return "#6b7280";
  if (typeof edge.color === "string") return edge.color;
  if (typeof edge.color.color === "string") return edge.color.color;
  return "#6b7280";
}

function applyEdgeStateDecorations(mergedEdge, edgeId, markerSets) {
  const isPath = markerSets.pathEdgeIds.has(edgeId);
  const isAlert = markerSets.alertEdgeIds.has(edgeId);
  const isPinned = markerSets.pinnedEdgeIds.has(edgeId);
  if (!isPath && !isAlert && !isPinned) return;

  const baseWidth = Number(mergedEdge.width) || 1;
  if (isPath) {
    mergedEdge.width = Math.max(baseWidth, 3.4);
    mergedEdge.color = { color: "#f97316", inherit: false };
    return;
  }
  if (isAlert) {
    mergedEdge.width = Math.max(baseWidth, 3.1);
    mergedEdge.color = { color: "#dc2626", inherit: false };
    return;
  }
  if (isPinned) {
    mergedEdge.width = Math.max(baseWidth, 3.1);
    mergedEdge.color = { color: "#f59e0b", inherit: false };
  }
}

function getMarkerSets() {
  const pinnedSets = getPinnedEvidenceSets();
  return {
    pinnedNodeIds: pinnedSets.nodeIds,
    pinnedEdgeIds: pinnedSets.edgeIds,
    pathNodeIds: window.PATH_HIGHLIGHT_STATE?.nodeIds || new Set(),
    pathEdgeIds: window.PATH_HIGHLIGHT_STATE?.edgeIds || new Set(),
    alertNodeIds: window.ALERT_HIGHLIGHT_STATE?.nodeIds || new Set(),
    alertEdgeIds: window.ALERT_HIGHLIGHT_STATE?.edgeIds || new Set()
  };
}

function applyMarkerOverlays(nodeIds, edgeIds) {
  const markerSets = getMarkerSets();
  const nodeUpdates = [];
  const edgeUpdates = [];

  (nodeIds || []).forEach(nodeId => {
    if (
      !markerSets.pathNodeIds.has(nodeId) &&
      !markerSets.alertNodeIds.has(nodeId) &&
      !markerSets.pinnedNodeIds.has(nodeId)
    ) {
      return;
    }
    const node = nodesData.get(nodeId);
    if (!node) return;
    const decorated = { ...node, id: nodeId };
    applyNodeStateDecorations(decorated, nodeId, markerSets);
    nodeUpdates.push(decorated);
  });

  (edgeIds || []).forEach(edgeId => {
    if (
      !markerSets.pathEdgeIds.has(edgeId) &&
      !markerSets.alertEdgeIds.has(edgeId) &&
      !markerSets.pinnedEdgeIds.has(edgeId)
    ) {
      return;
    }
    const edge = edgesData.get(edgeId);
    if (!edge) return;
    const decorated = { ...edge, id: edgeId };
    applyEdgeStateDecorations(decorated, edgeId, markerSets);
    edgeUpdates.push(decorated);
  });

  if (nodeUpdates.length > 0) nodesData.update(nodeUpdates);
  if (edgeUpdates.length > 0) edgesData.update(edgeUpdates);
}


function normalizeGraphId(rawId) {
  if (rawId == null) return rawId;
  if (typeof rawId === "number") return rawId;
  const trimmed = String(rawId).trim();
  if (trimmed === "") return rawId;
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed) && String(parsed) === trimmed) return parsed;
  return trimmed;
}

function createUniqueNodeId(prefix = "node") {
  let candidate = `${prefix}_${Date.now()}`;
  while (FULL_GRAPH.nodes.has(candidate) || nodesData.get(candidate)) {
    candidate = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }
  return candidate;
}

function createUniqueEdgeId(prefix = "edge") {
  let candidate = `${prefix}_${Date.now()}`;
  while (FULL_GRAPH.edges.has(candidate) || edgesData.get(candidate)) {
    candidate = `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }
  return candidate;
}

function getContextCanvasPosition(x, y) {
  if (!network || !network.canvas || !network.canvas.body || !network.canvas.body.container) {
    return { x: 0, y: 0 };
  }
  const rect = network.canvas.body.container.getBoundingClientRect();
  const domX = Number.isFinite(x) ? x - rect.left : rect.width / 2;
  const domY = Number.isFinite(y) ? y - rect.top : rect.height / 2;
  return network.DOMtoCanvas({ x: domX, y: domY });
}

function ensureAdjacencyNode(nodeId) {
  if (!FULL_GRAPH.adjacency.has(nodeId)) {
    FULL_GRAPH.adjacency.set(nodeId, new Set());
  }
}

function invalidateGraphEdgeIndexes() {
  FULL_GRAPH.edgesByNode = null;
}

function upsertFullGraphNode(node) {
  if (!node || node.id == null) return null;
  FULL_GRAPH.nodes.set(node.id, node);
  ensureAdjacencyNode(node.id);
  return node;
}

function upsertFullGraphEdge(edge) {
  if (!edge) return null;
  const id = edge.id == null ? createUniqueEdgeId("edge") : edge.id;
  const from = normalizeGraphId(edge.from);
  const to = normalizeGraphId(edge.to);
  if (from == null || to == null) return null;

  const merged = { ...edge, id, from, to };
  FULL_GRAPH.edges.set(id, merged);
  ensureAdjacencyNode(from);
  ensureAdjacencyNode(to);
  FULL_GRAPH.adjacency.get(from).add(to);
  FULL_GRAPH.adjacency.get(to).add(from);
  invalidateGraphEdgeIndexes();
  return merged;
}

function removeFullGraphEdge(edgeId) {
  if (edgeId == null) return;
  const edge = FULL_GRAPH.edges.get(edgeId) || edgesData.get(edgeId);
  if (!edge) return;
  queueGraphHistoryCapture();

  FULL_GRAPH.edges.delete(edgeId);
  const from = normalizeGraphId(edge.from);
  const to = normalizeGraphId(edge.to);
  if (FULL_GRAPH.adjacency.has(from)) FULL_GRAPH.adjacency.get(from).delete(to);
  if (FULL_GRAPH.adjacency.has(to)) FULL_GRAPH.adjacency.get(to).delete(from);

  MODIFIED_EDGES.delete(edgeId);
  VISIBLE_STATE.edges.delete(edgeId);
  invalidateGraphEdgeIndexes();
  if (edgesData.get(edgeId)) edgesData.remove(edgeId);
}

function removeFullGraphNode(nodeId) {
  const id = normalizeGraphId(nodeId);
  if (id == null) return;
  queueGraphHistoryCapture();
  const incident = [];
  FULL_GRAPH.edges.forEach((edge, edgeId) => {
    if (edge.from === id || edge.to === id) incident.push(edgeId);
  });
  incident.forEach(removeFullGraphEdge);

  FULL_GRAPH.nodes.delete(id);
  FULL_GRAPH.adjacency.delete(id);
  FULL_GRAPH.adjacency.forEach(neighbors => neighbors.delete(id));
  MODIFIED_NODES.delete(id);
  VISIBLE_STATE.nodes.delete(id);
  if (nodesData.get(id)) nodesData.remove(id);
}

function rebuildAdjacencyFromFullGraph() {
  FULL_GRAPH.adjacency.clear();
  FULL_GRAPH.nodes.forEach((_node, nodeId) => {
    FULL_GRAPH.adjacency.set(nodeId, new Set());
  });
  FULL_GRAPH.edges.forEach(edge => {
    ensureAdjacencyNode(edge.from);
    ensureAdjacencyNode(edge.to);
    FULL_GRAPH.adjacency.get(edge.from).add(edge.to);
    FULL_GRAPH.adjacency.get(edge.to).add(edge.from);
  });
  invalidateGraphEdgeIndexes();
}

function createGraphEdge(from, to, patch = {}) {
  if (from == null || to == null || from === to) return null;
  queueGraphHistoryCapture();
  const edge = {
    ...patch,
    id: patch.id ?? createUniqueEdgeId("edge"),
    from: normalizeGraphId(from),
    to: normalizeGraphId(to),
    label: patch.label ?? "",
    width: patch.width ?? 1,
    arrows: patch.arrows ?? "to",
    dashes: patch.dashes ?? false,
    color: patch.color ?? undefined
  };
  const stored = upsertFullGraphEdge(edge);
  if (!stored) return null;

  MODIFIED_EDGES.set(stored.id, { ...(MODIFIED_EDGES.get(stored.id) || {}), ...stored });
  if (VISIBLE_STATE.nodes.has(stored.from) && VISIBLE_STATE.nodes.has(stored.to)) {
    VISIBLE_STATE.edges.add(stored.id);
  }
  edgesData.update(stored);
  return stored;
}

function createAnnotationNode({
  label = "Annotation",
  x = 0,
  y = 0,
  shape = "box",
  image = "",
  color = { background: "#fffdf2", border: "#8b7d4f" },
  font = { color: "#333333", size: 14 },
  extra = {}
} = {}) {
  queueGraphHistoryCapture();
  const id = createUniqueNodeId("anno");
  const normalizedShape = String(shape || "box");
  const normalizedImage = typeof image === "string" ? image.trim() : "";
  const resolvedImage = normalizedShape === "image"
    ? (normalizedImage || getOleObjectIconPath())
    : normalizedImage;
  const node = {
    id,
    label,
    x,
    y,
    shape: normalizedShape,
    ...(normalizedShape === "image" ? { image: resolvedImage } : {}),
    color,
    font,
    borderWidth: extra.borderWidth ?? (normalizedShape === "image" ? 0 : 1.2),
    borderWidthSelected: extra.borderWidthSelected ?? (normalizedShape === "image" ? 0 : 2),
    margin: extra.margin ?? 8,
    annotationType: extra.annotationType || "generic",
    note: extra.note || "",
    ...extra
  };
  upsertFullGraphNode(node);
  MODIFIED_NODES.set(id, { ...(MODIFIED_NODES.get(id) || {}), ...node });
  VISIBLE_STATE.nodes.add(id);
  window.limitOverridden = true;
  nodesData.update(node);
  return node;
}

// Context menu actions
function handleAddNode(x, y) {
  queueGraphHistoryCapture();
  const pos = getContextCanvasPosition(x, y);
  const id = createUniqueNodeId("node");
  const node = {
    id,
    label: window.currentSettings.showLabels ? `Node ${id}` : "",
    x: pos.x,
    y: pos.y,
    color: { background: "#FFFFFF", border: "#777777" }
  };

  upsertFullGraphNode(node);
  MODIFIED_NODES.set(id, { ...(MODIFIED_NODES.get(id) || {}), ...node });
  VISIBLE_STATE.nodes.add(id);
  window.limitOverridden = true;
  nodesData.update(node);
}

async function handleAddLabelNode(x, y) {
  const text = await requestUserInput("Label text", "Label", { title: "Add Label" });
  if (text == null) return;
  const pos = getContextCanvasPosition(x, y);
  createAnnotationNode({
    label: String(text),
    x: pos.x,
    y: pos.y,
    shape: "text",
    font: { color: "#1f2d3d", size: 18, face: "Georgia" },
    extra: { annotationType: "label" }
  });
}

async function handleAddCommentBox(x, y) {
  const text = await requestUserInput("Comment", "New comment", { title: "Add Comment Box" });
  if (text == null) return;
  const pos = getContextCanvasPosition(x, y);
  createAnnotationNode({
    label: String(text),
    x: pos.x,
    y: pos.y,
    shape: "box",
    color: { background: "#fff9e6", border: "#b8860b" },
    font: { color: "#4d3b00", size: 14 },
    extra: { annotationType: "comment_box", note: String(text) }
  });
}

async function handleAddTextBlock(x, y) {
  const text = await requestUserInput("Text block", "Analyst note", { title: "Add Text Block" });
  if (text == null) return;
  const pos = getContextCanvasPosition(x, y);
  createAnnotationNode({
    label: String(text),
    x: pos.x,
    y: pos.y,
    shape: "box",
    color: { background: "#f3f7ff", border: "#4a6fa5" },
    font: { color: "#1b3558", size: 13 },
    extra: { annotationType: "text_block", note: String(text) }
  });
}

async function handleAddEventFrame(x, y) {
  const text = await requestUserInput("Event frame title", "Event Frame", { title: "Add Event Frame" });
  if (text == null) return;
  const pos = getContextCanvasPosition(x, y);
  createAnnotationNode({
    label: String(text),
    x: pos.x,
    y: pos.y,
    shape: "box",
    color: { background: "#f8f8f8", border: "#555555" },
    font: { color: "#333333", size: 13 },
    extra: {
      annotationType: "event_frame",
      borderWidth: 2,
      dashes: [8, 4],
      eventDateTime: "",
      eventTypes: []
    }
  });
}

function handleAddThemeLine(selectedNodes) {
  const nodes = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId) : [];
  if (nodes.length < 2) {
    alert("Select at least two nodes to create a Theme Line.");
    return;
  }

  const positions = network.getPositions(nodes);
  const orderedNodes = nodes
    .slice()
    .sort((a, b) => {
      const aPos = positions[a] || { x: 0, y: 0 };
      const bPos = positions[b] || { x: 0, y: 0 };
      if (aPos.x !== bPos.x) return aPos.x - bPos.x;
      if (aPos.y !== bPos.y) return aPos.y - bPos.y;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    });

  for (let i = 0; i < orderedNodes.length - 1; i++) {
    createGraphEdge(orderedNodes[i], orderedNodes[i + 1], {
      label: "Theme",
      width: 2,
      dashes: [8, 6],
      color: { color: "#6b7280", inherit: false },
      arrows: "",
      smooth: { type: "curvedCW", roundness: 0.18 },
      physics: false,
      edge_kind: "theme_line"
    });
  }
  renderVisibleGraphBatch();
}

async function handleAddOleObject(x, y) {
  const text = await requestUserInput("OLE object title", "External Object", { title: "Add OLE Object" });
  if (text == null) return;
  const pos = getContextCanvasPosition(x, y);
  createAnnotationNode({
    label: String(text),
    x: pos.x,
    y: pos.y,
    shape: "image",
    image: getOleObjectIconPath(),
    size: 34,
    borderWidth: 0,
    borderWidthSelected: 0,
    font: { color: "#6d28d9", size: 13, face: "Georgia" },
    shadow: { enabled: true, color: "rgba(124,58,237,0.32)", size: 10, x: 0, y: 0 },
    extra: {
      annotationType: "ole_object",
      accentColor: "#7c3aed",
      attachmentLink: "",
      attachmentDataUrl: "",
      attachmentName: "",
      attachmentMime: "",
      attachmentAutoOpen: true
    }
  });
}

function handleDeleteNode(nodeId) {
  queueGraphHistoryCapture();
  removeFullGraphNode(nodeId);
  renderVisibleGraphBatch();
}

function hasEdgeBetween(nodeA, nodeB) {
  const a = normalizeGraphId(nodeA);
  const b = normalizeGraphId(nodeB);
  for (const edge of FULL_GRAPH.edges.values()) {
    if ((edge.from === a && edge.to === b) || (edge.from === b && edge.to === a)) return true;
  }
  return false;
}

function handleLinkNodes(selectedNodes) {
  const nodes = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId) : [];
  if (nodes.length < 2) return;
  queueGraphHistoryCapture();

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const from = nodes[i];
      const to = nodes[j];
      if (!hasEdgeBetween(from, to)) {
        createGraphEdge(from, to);
      }
    }
  }
  renderVisibleGraphBatch();
}

// Handle single node
function handleUnlinkNode(nodeId) {
  const id = normalizeGraphId(nodeId);
  const toRemove = [];
  queueGraphHistoryCapture();
  FULL_GRAPH.edges.forEach((edge, edgeId) => {
    if (edge.from === id || edge.to === id) toRemove.push(edgeId);
  });
  toRemove.forEach(removeFullGraphEdge);
  renderVisibleGraphBatch();
}

// Handle multiple nodes
function handleUnlinkNodes(selectedNodes) {
  const nodeSet = new Set((selectedNodes || []).map(normalizeGraphId));
  if (nodeSet.size < 2) return;
  queueGraphHistoryCapture();

  const toRemove = [];
  FULL_GRAPH.edges.forEach((edge, edgeId) => {
    if (nodeSet.has(edge.from) && nodeSet.has(edge.to)) toRemove.push(edgeId);
  });
  toRemove.forEach(removeFullGraphEdge);
  renderVisibleGraphBatch();
}

function handleGroupNodes(nodeIds) {
  const ids = Array.isArray(nodeIds) ? nodeIds.map(normalizeGraphId) : [];
  if (ids.length < 2) return;
  queueGraphHistoryCapture();

  const groupId = `Group ${Date.now()}`;
  const pos = network.getPositions(ids);
  let x = 0;
  let y = 0;
  ids.forEach(id => {
    x += pos[id]?.x || 0;
    y += pos[id]?.y || 0;
  });
  x /= ids.length;
  y /= ids.length;

  const memberSet = new Set(ids);
  const memberNodes = ids
    .map(id => ({ ...(FULL_GRAPH.nodes.get(id) || {}), ...(MODIFIED_NODES.get(id) || {}) }))
    .filter(node => node.id != null);
  const memberEdges = [];
  FULL_GRAPH.edges.forEach(edge => {
    if (memberSet.has(edge.from) && memberSet.has(edge.to)) memberEdges.push({ ...edge });
  });

  ids.forEach(removeFullGraphNode);

  const groupNode = {
    id: groupId,
    label: "Group",
    size: 40,
    x,
    y,
    color: { background: "#FFFFFF", border: "#777777" },
    isGroup: true,
    members: memberNodes,
    edges: memberEdges
  };

  upsertFullGraphNode(groupNode);
  MODIFIED_NODES.set(groupId, { ...(MODIFIED_NODES.get(groupId) || {}), ...groupNode });
  VISIBLE_STATE.nodes.add(groupId);
  renderVisibleGraphBatch();
}

function handleUngroupNode(groupId) {
  const id = normalizeGraphId(groupId);
  const groupNode = FULL_GRAPH.nodes.get(id) || nodesData.get(id);
  if (!groupNode || !groupNode.isGroup) {
    console.warn("Not a group node:", groupId);
    return;
  }
  queueGraphHistoryCapture();

  const { members = [], edges = [] } = groupNode;
  removeFullGraphNode(id);

  const idMap = new Map();
  members.forEach(node => {
    let newId = node.id;
    if (FULL_GRAPH.nodes.has(newId) || nodesData.get(newId)) {
      newId = createUniqueNodeId("restored");
    }
    idMap.set(node.id, newId);
    const restoredNode = { ...node, id: newId };
    upsertFullGraphNode(restoredNode);
    MODIFIED_NODES.set(newId, { ...(MODIFIED_NODES.get(newId) || {}), ...restoredNode });
    VISIBLE_STATE.nodes.add(newId);
  });

  const existingPairs = new Set();
  FULL_GRAPH.edges.forEach(edge => {
    existingPairs.add([String(edge.from), String(edge.to)].sort().join("--"));
  });

  edges.forEach(edge => {
    const from = idMap.get(edge.from) || edge.from;
    const to = idMap.get(edge.to) || edge.to;
    if (from === to) return;
    const pairKey = [String(from), String(to)].sort().join("--");
    if (existingPairs.has(pairKey)) return;
    existingPairs.add(pairKey);

    const restoredEdge = {
      ...edge,
      id: createUniqueEdgeId("restored_edge"),
      from,
      to
    };
    upsertFullGraphEdge(restoredEdge);
    MODIFIED_EDGES.set(restoredEdge.id, { ...(MODIFIED_EDGES.get(restoredEdge.id) || {}), ...restoredEdge });
    if (VISIBLE_STATE.nodes.has(from) && VISIBLE_STATE.nodes.has(to)) {
      VISIBLE_STATE.edges.add(restoredEdge.id);
    }
  });

  renderVisibleGraphBatch();
}

function expandNeighborhoodFromSelection(selectedNodes, maxDepth = 1) {
  const seeds = new Set((selectedNodes || []).map(normalizeGraphId).filter(id => FULL_GRAPH.nodes.has(id)));
  if (seeds.size === 0) return;
  queueGraphHistoryCapture();

  const queue = [];
  const visited = new Set();
  seeds.forEach(nodeId => {
    queue.push({ nodeId, depth: 0 });
    visited.add(nodeId);
    VISIBLE_STATE.nodes.add(nodeId);
  });

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    const neighbors = FULL_GRAPH.adjacency.get(nodeId);
    if (!neighbors) continue;
    neighbors.forEach(neighborId => {
      if (!FULL_GRAPH.nodes.has(neighborId)) return;
      VISIBLE_STATE.nodes.add(neighborId);
      if (visited.has(neighborId)) return;
      visited.add(neighborId);
      queue.push({ nodeId: neighborId, depth: depth + 1 });
    });
  }

  recomputeVisibleEdges();
  renderVisibleGraphBatch();
}

function collapseNeighborhoodFromSelection(selectedNodes, maxDepth = 1) {
  const anchors = new Set((selectedNodes || []).map(normalizeGraphId).filter(id => VISIBLE_STATE.nodes.has(id)));
  if (anchors.size === 0) return;
  queueGraphHistoryCapture();

  const toHide = new Set();
  const queue = [];
  const visited = new Set();

  anchors.forEach(nodeId => {
    queue.push({ nodeId, depth: 0 });
    visited.add(nodeId);
  });

  while (queue.length > 0) {
    const { nodeId, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    const neighbors = FULL_GRAPH.adjacency.get(nodeId);
    if (!neighbors) continue;
    neighbors.forEach(neighborId => {
      if (!VISIBLE_STATE.nodes.has(neighborId)) return;
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push({ nodeId: neighborId, depth: depth + 1 });
      }
      if (!anchors.has(neighborId)) {
        toHide.add(neighborId);
      }
    });
  }

  toHide.forEach(nodeId => VISIBLE_STATE.nodes.delete(nodeId));
  recomputeVisibleEdges();
  renderVisibleGraphBatch();
}

function collectMergeTransferableKeys(nodeIds, skipKeys) {
  const keys = new Set();
  (nodeIds || []).forEach(nodeId => {
    const sourceBase = FULL_GRAPH.nodes.get(nodeId) || {};
    const sourceMod = MODIFIED_NODES.get(nodeId) || {};
    const sourceNode = { ...sourceBase, ...sourceMod };
    Object.entries(sourceNode).forEach(([key, value]) => {
      if (skipKeys.has(key)) return;
      if (value === undefined || value === null || value === "") return;
      keys.add(String(key));
    });
  });
  return Array.from(keys).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
}

async function promptMergePropertyCarryOptions(nodeIds, skipKeys) {
  const availableKeys = collectMergeTransferableKeys(nodeIds, skipKeys);
  const previewMax = 28;
  const previewList = availableKeys.slice(0, previewMax).join(", ");
  const extraCount = Math.max(0, availableKeys.length - previewMax);
  const keySelectionMessage = availableKeys.length > 0
    ? `Merge property transfer keys:\n${previewList}${extraCount > 0 ? ` ... (+${extraCount} more)` : ""}\n\nEnter comma-separated keys, or type "all" (or "*").`
    : "No transferable custom keys found in selected source nodes.\nType \"all\" to continue.";

  const selectedKeysRaw = await requestUserInput(keySelectionMessage, "all", {
    title: "Merge Property Keys"
  });
  if (selectedKeysRaw == null) return null;

  let selectedKeys = null;
  const selectedKeysValue = String(selectedKeysRaw).trim();
  if (
    selectedKeysValue !== "" &&
    selectedKeysValue.toLowerCase() !== "all" &&
    selectedKeysValue !== "*"
  ) {
    const availableSet = new Set(availableKeys);
    const requested = selectedKeysValue
      .split(",")
      .map(key => key.trim())
      .filter(Boolean);
    const valid = requested.filter(key => availableSet.has(key));
    if (valid.length > 0) {
      selectedKeys = new Set(valid);
    } else if (availableKeys.length > 0) {
      alert("No valid property keys matched. Using all keys.");
    }
  }

  const variableRaw = await requestUserInput(
    "Derived property variable name.\nResult format: <variable>_<propertyKey>\nExample: merged",
    "merged",
    { title: "Derived Property Variable" }
  );
  if (variableRaw == null) return null;
  const variablePrefix = String(variableRaw).trim();
  if (variablePrefix === "") {
    alert("Variable name is required. Expected format: <variable>_<propertyKey>");
    return null;
  }

  return {
    selectedKeys,
    variablePrefix
  };
}

async function mergeSelectedNodes(selectedNodes) {
  const ids = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId).filter(id => FULL_GRAPH.nodes.has(id)) : [];
  if (ids.length < 2) return;

  const canonicalId = ids[0];
  const mergeSet = new Set(ids);
  const canonicalBase = FULL_GRAPH.nodes.get(canonicalId) || {};
  const canonicalMod = MODIFIED_NODES.get(canonicalId) || {};
  const canonicalNode = { ...canonicalBase, ...canonicalMod, id: canonicalId };

  const positions = network.getPositions(ids);
  let cx = 0;
  let cy = 0;
  let count = 0;
  ids.forEach(id => {
    const pos = positions[id];
    if (!pos) return;
    cx += pos.x;
    cy += pos.y;
    count += 1;
  });
  if (count > 0) {
    canonicalNode.x = cx / count;
    canonicalNode.y = cy / count;
  }

  const mergedFrom = ids.filter(id => id !== canonicalId);
  canonicalNode.merged_from = Array.from(new Set([...(canonicalNode.merged_from || []), ...mergedFrom]));
  canonicalNode.merge_count = (canonicalNode.merge_count || 1) + mergedFrom.length;

  const sourcePropertySkipKeys = new Set([
    "id", "label", "title", "x", "y", "vx", "vy", "fx", "fy",
    "size", "shape", "image", "icon", "iconPath",
    "color", "font", "borderWidth", "borderWidthSelected",
    "shadow", "hidden", "physics", "fixed", "chosen",
    "group", "level", "mass"
  ]);

  const carryOptions = await promptMergePropertyCarryOptions(mergedFrom, sourcePropertySkipKeys);
  if (!carryOptions) return;
  const allowedKeys = carryOptions.selectedKeys;
  const variablePrefix = carryOptions.variablePrefix;

  mergedFrom.forEach(sourceId => {
    const sourceBase = FULL_GRAPH.nodes.get(sourceId) || {};
    const sourceMod = MODIFIED_NODES.get(sourceId) || {};
    const sourceNode = { ...sourceBase, ...sourceMod };

    Object.entries(sourceNode).forEach(([key, value]) => {
      if (sourcePropertySkipKeys.has(key)) return;
      if (allowedKeys && !allowedKeys.has(key)) return;
      if (value === undefined) return;
      const baseDerivedKey = `${String(variablePrefix)}_${String(key)}`;
      let derivedKey = baseDerivedKey;
      let suffixCounter = 2;
      while (Object.prototype.hasOwnProperty.call(canonicalNode, derivedKey)) {
        derivedKey = `${baseDerivedKey}_${suffixCounter}`;
        suffixCounter += 1;
      }
      canonicalNode[derivedKey] = value;
    });
  });

  const rewrittenEdges = [];
  const usedEdgeIds = new Set();

  FULL_GRAPH.edges.forEach((baseEdge, edgeId) => {
    const modEdge = MODIFIED_EDGES.get(edgeId) || {};
    const mergedEdge = { ...baseEdge, ...modEdge };

    const from = mergeSet.has(normalizeGraphId(mergedEdge.from)) ? canonicalId : normalizeGraphId(mergedEdge.from);
    const to = mergeSet.has(normalizeGraphId(mergedEdge.to)) ? canonicalId : normalizeGraphId(mergedEdge.to);
    if (from == null || to == null || from === to) return;

    let nextEdgeId = mergedEdge.id ?? edgeId ?? createUniqueEdgeId("merged_edge");
    if (usedEdgeIds.has(nextEdgeId)) {
      nextEdgeId = createUniqueEdgeId("merged_edge");
    }
    usedEdgeIds.add(nextEdgeId);

    rewrittenEdges.push({
      ...mergedEdge,
      id: nextEdgeId,
      from,
      to
    });
  });

  ids.forEach(id => {
    if (id !== canonicalId) removeFullGraphNode(id);
  });

  upsertFullGraphNode({ ...canonicalNode, id: canonicalId });
  MODIFIED_NODES.set(canonicalId, { ...(MODIFIED_NODES.get(canonicalId) || {}), ...canonicalNode, id: canonicalId });
  VISIBLE_STATE.nodes.add(canonicalId);

  FULL_GRAPH.edges.clear();
  MODIFIED_EDGES.clear();
  rewrittenEdges.forEach(edge => {
    const stored = upsertFullGraphEdge(edge);
    if (!stored) return;
    MODIFIED_EDGES.set(stored.id, { ...(MODIFIED_EDGES.get(stored.id) || {}), ...stored });
  });

  rebuildAdjacencyFromFullGraph();
  recomputeVisibleEdges();
  renderVisibleGraphBatch();
  network.selectNodes([canonicalId]);
}

function generatePaletteColor(index, total) {
  const safeTotal = Math.max(1, total);
  const hue = Math.round((index % safeTotal) * (360 / safeTotal));
  return `hsl(${hue}, 62%, 55%)`;
}

function getVisibleNodeSnapshots() {
  return Array.from(VISIBLE_STATE.nodes)
    .map(nodeId => {
      const base = FULL_GRAPH.nodes.get(nodeId);
      if (!base) return null;
      const mod = MODIFIED_NODES.get(nodeId) || {};
      return { id: nodeId, ...base, ...mod };
    })
    .filter(Boolean);
}

function inferDynamicNodeKeys(nodes) {
  const numeric = new Set();
  const categorical = new Set();
  const counters = new Map();

  (nodes || []).forEach(node => {
    Object.entries(node).forEach(([key, value]) => {
      if (["id", "x", "y", "vx", "vy", "title", "label", "color", "font", "shape", "image", "iconPath"].includes(key)) return;
      if (value == null || value === "") return;
      const num = toFiniteNumber(value);
      if (num != null) {
        numeric.add(key);
      } else {
        categorical.add(key);
      }
      counters.set(key, (counters.get(key) || 0) + 1);
    });
  });

  const sortByCoverage = key => -(counters.get(key) || 0);
  return {
    numeric: Array.from(numeric).sort((a, b) => sortByCoverage(a) - sortByCoverage(b)),
    categorical: Array.from(categorical).sort((a, b) => sortByCoverage(a) - sortByCoverage(b))
  };
}

function applyVisualEncodingByDegree() {
  const visibleSet = new Set(VISIBLE_STATE.nodes);
  const nodes = getVisibleNodeSnapshots();
  if (nodes.length === 0) return;

  let maxDegree = 1;
  const degreeMap = new Map();
  nodes.forEach(node => {
    const degree = getVisibleNeighborCount(node.id, visibleSet);
    degreeMap.set(node.id, degree);
    if (degree > maxDegree) maxDegree = degree;
  });

  const updates = nodes.map(node => {
    const degree = degreeMap.get(node.id) || 0;
    const ratio = degree / maxDegree;
    const size = 14 + (ratio * 26);
    const background = `hsl(${Math.round(220 - ratio * 180)}, 70%, 58%)`;
    const patch = {
      id: node.id,
      size,
      color: buildNodeColor(background)
    };
    persistNodeChange(node.id, patch);
    return patch;
  });
  nodesData.update(updates);
}

function applyVisualEncodingByProperty(propertyKey) {
  const key = String(propertyKey || "").trim();
  if (!key) return;
  const nodes = getVisibleNodeSnapshots();
  if (nodes.length === 0) return;

  const numericValues = [];
  const categoricalMap = new Map();
  nodes.forEach(node => {
    const value = getNodeValue(node, key);
    const num = toFiniteNumber(value);
    if (num != null) numericValues.push(num);
    else if (value != null && String(value).trim() !== "") categoricalMap.set(String(value), true);
  });

  const useNumeric = numericValues.length >= Math.max(4, Math.floor(nodes.length * 0.35));
  const min = useNumeric ? Math.min(...numericValues) : 0;
  const max = useNumeric ? Math.max(...numericValues) : 1;
  const categories = Array.from(categoricalMap.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const categoryColor = new Map();
  categories.forEach((cat, index) => {
    categoryColor.set(cat, generatePaletteColor(index, categories.length));
  });

  const updates = nodes.map(node => {
    const value = getNodeValue(node, key);
    const num = toFiniteNumber(value);
    let ratio = 0.5;
    let color = "#5a8ac6";

    if (useNumeric && num != null && max > min) {
      ratio = (num - min) / (max - min);
      color = `hsl(${Math.round(220 - ratio * 180)}, 72%, 56%)`;
    } else if (!useNumeric && value != null && categoryColor.has(String(value))) {
      color = categoryColor.get(String(value));
    }

    const patch = {
      id: node.id,
      size: 13 + (ratio * 24),
      color: buildNodeColor(color)
    };
    persistNodeChange(node.id, patch);
    return patch;
  });

  nodesData.update(updates);
}

function saveCurrentView(name) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) return;

  const snapshot = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: trimmedName,
    createdAt: new Date().toISOString(),
    position: network.getViewPosition(),
    scale: network.getScale(),
    visibleNodes: Array.from(VISIBLE_STATE.nodes),
    visibleEdges: Array.from(VISIBLE_STATE.edges),
    selectedNodes: network.getSelectedNodes(),
    selectedEdges: network.getSelectedEdges(),
    settings: { ...window.currentSettings }
  };

  const next = Array.isArray(window.SAVED_VIEWS) ? window.SAVED_VIEWS.slice() : [];
  const existingIndex = next.findIndex(item => item.name === trimmedName);
  if (existingIndex >= 0) next.splice(existingIndex, 1);
  next.unshift(snapshot);
  window.SAVED_VIEWS = next.slice(0, MAX_SAVED_VIEWS);
  writeJsonStorage(SAVED_VIEWS_STORAGE_KEY, window.SAVED_VIEWS);
}

function applySavedViewSettings(settings) {
  if (!settings || typeof settings !== "object") return;

  const asBool = (value) => value === true || value === "true";
  const merged = {
    ...window.currentSettings,
    ...settings
  };

  window.currentSettings = merged;

  const limitAmount = normalizeLimitRange({
    min: merged.limitMin ?? merged.limitRangeMin ?? 0,
    max: merged.limitMax ?? merged.limitRangeMax ?? merged.limit ?? 25
  }, 25);
  applyLimit({
    key: merged.sortKey || "",
    sort: merged.sortOrder || "asc",
    amount: limitAmount
  });

  weightEdges(merged.weightEdges ?? "");
  applyTitleToggle(asBool(merged.showTitles));
  showNodelabels(asBool(merged.showLabels));
  networkphysics(asBool(merged.physics));

  const layoutType = merged.layoutType || "default";
  networkLayoutType(layoutType);
  if (layoutType === "hierarchical" || layoutType === "layered") {
    networkLayoutDirection(merged.layoutDirection || "UD");
    networkLayoutSort(merged.sortMethod || "directed");
  }
  networkLayerMode(merged.layerMode || "hop_distance");
  networkLayerKey(merged.layerKey == null ? "" : merged.layerKey);

  toggleAlertRules(merged.alertRules !== false);
  toggleEdgeBundlingLite(!!merged.edgeBundling);
}

function loadSavedView(name) {
  const list = Array.isArray(window.SAVED_VIEWS) ? window.SAVED_VIEWS : [];
  if (list.length === 0) return;
  const target = list.find(item => item.name === name) || list[0];
  if (!target) return;

  applySavedViewSettings(target.settings);

  const nodes = new Set((target.visibleNodes || [])
    .map(normalizeGraphId)
    .filter(nodeId => FULL_GRAPH.nodes.has(nodeId)));
  if (nodes.size > 0) {
    VISIBLE_STATE.nodes = nodes;
    const savedVisibleEdges = Array.isArray(target.visibleEdges) ? target.visibleEdges : [];
    if (savedVisibleEdges.length > 0) {
      const edges = new Set(
        savedVisibleEdges.filter(edgeId => {
          const edge = FULL_GRAPH.edges.get(edgeId);
          return !!edge && nodes.has(edge.from) && nodes.has(edge.to);
        })
      );
      if (edges.size > 0) {
        VISIBLE_STATE.edges = edges;
      } else {
        recomputeVisibleEdges();
      }
    } else {
      recomputeVisibleEdges();
    }
    renderVisibleGraphBatch();
  }

  network.moveTo({
    position: target.position || { x: 0, y: 0 },
    scale: Number.isFinite(target.scale) ? target.scale : 1,
    animation: { duration: 280, easingFunction: "easeInOutQuad" }
  });

  if (typeof network.unselectAll === "function") {
    network.unselectAll();
  }
  if (Array.isArray(target.selectedNodes) && target.selectedNodes.length > 0) {
    const selectedNodeIds = target.selectedNodes
      .map(normalizeGraphId)
      .filter(nodeId => VISIBLE_STATE.nodes.has(nodeId));
    if (selectedNodeIds.length > 0) {
      network.selectNodes(selectedNodeIds, false);
    }
  }
  if (Array.isArray(target.selectedEdges) && target.selectedEdges.length > 0 && typeof network.selectEdges === "function") {
    const selectedEdgeIds = target.selectedEdges.filter(edgeId => VISIBLE_STATE.edges.has(edgeId));
    if (selectedEdgeIds.length > 0) {
      network.selectEdges(selectedEdgeIds);
    }
  }
}

function isThemeLineEdge(edge) {
  if (!edge || typeof edge !== "object") return false;
  return String(edge.edge_kind || "").toLowerCase() === "theme_line";
}

function getPinnedEvidenceSets() {
  const nodeIds = new Set();
  const edgeIds = new Set();
  const list = Array.isArray(window.PINNED_EVIDENCE) ? window.PINNED_EVIDENCE : [];
  list.forEach(item => {
    if (!item || item.id == null) return;
    if (item.type === "node") nodeIds.add(normalizeGraphId(item.id));
    if (item.type === "edge") edgeIds.add(item.id);
  });
  return { nodeIds, edgeIds };
}

function getEdgeTraversalWeight(edge) {
  const numeric = toFiniteNumber(edge?.weight ?? edge?.value ?? edge?.width);
  if (numeric == null || numeric <= 0) return 1;
  return numeric;
}

function getTraversableEdges(nodeId, options = {}) {
  const directed = options.directed === true;
  const includeThemeLines = options.includeThemeLines === true;
  const edgeIds = ensureEdgesByNodeIndex().get(nodeId);
  const traversable = [];
  if (!edgeIds || edgeIds.size === 0) return traversable;

  edgeIds.forEach(edgeId => {
    const edge = FULL_GRAPH.edges.get(edgeId);
    if (!edge) return;
    if (!includeThemeLines && isThemeLineEdge(edge)) return;

    const from = normalizeGraphId(edge.from);
    const to = normalizeGraphId(edge.to);

    if (directed) {
      if (from !== nodeId) return;
      traversable.push({
        edgeId,
        to: normalizeGraphId(to),
        cost: getEdgeTraversalWeight(edge)
      });
      return;
    }

    if (from === nodeId) {
      traversable.push({ edgeId, to: normalizeGraphId(to), cost: getEdgeTraversalWeight(edge) });
      return;
    }
    if (to === nodeId) {
      traversable.push({ edgeId, to: normalizeGraphId(from), cost: getEdgeTraversalWeight(edge) });
    }
  });

  return traversable;
}

function reconstructPathResult(start, end, previousNode, previousEdge, totalCost, options) {
  if (start !== end && !previousNode.has(end)) {
    return {
      path: [],
      edgeIds: [],
      totalCost: Number.POSITIVE_INFINITY,
      directed: !!options.directed,
      weighted: !!options.weighted
    };
  }

  const path = [end];
  const edgeIds = [];
  let cursor = end;
  while (cursor !== start) {
    const edgeId = previousEdge.get(cursor);
    const prev = previousNode.get(cursor);
    if (prev == null) break;
    if (edgeId != null) edgeIds.push(edgeId);
    path.push(prev);
    cursor = prev;
  }

  path.reverse();
  edgeIds.reverse();
  return {
    path,
    edgeIds,
    totalCost,
    directed: !!options.directed,
    weighted: !!options.weighted
  };
}

function clearPathHighlight() {
  if (!window.PATH_HIGHLIGHT_STATE) return;
  window.PATH_HIGHLIGHT_STATE.nodeIds.clear();
  window.PATH_HIGHLIGHT_STATE.edgeIds.clear();
  renderVisibleGraphBatch();
}

function findShortestPath(startId, endId, options = {}) {
  const normalizedOptions = {
    directed: options.directed === true,
    weighted: options.weighted === true,
    includeThemeLines: options.includeThemeLines === true
  };
  const start = normalizeGraphId(startId);
  const end = normalizeGraphId(endId);
  if (!FULL_GRAPH.nodes.has(start) || !FULL_GRAPH.nodes.has(end)) {
    return { path: [], edgeIds: [], totalCost: Number.POSITIVE_INFINITY, ...normalizedOptions };
  }
  if (start === end) {
    return { path: [start], edgeIds: [], totalCost: 0, ...normalizedOptions };
  }

  const previous = new Map();
  const previousEdge = new Map();

  if (!normalizedOptions.weighted) {
    const queue = [start];
    const visited = new Set([start]);

    while (queue.length > 0) {
      const current = queue.shift();
      const traversable = getTraversableEdges(current, normalizedOptions);
      for (const next of traversable) {
        if (visited.has(next.to)) continue;
        visited.add(next.to);
        previous.set(next.to, current);
        previousEdge.set(next.to, next.edgeId);
        if (next.to === end) {
          const result = reconstructPathResult(start, end, previous, previousEdge, 0, normalizedOptions);
          result.totalCost = Math.max(0, result.path.length - 1);
          return result;
        }
        queue.push(next.to);
      }
    }
    return { path: [], edgeIds: [], totalCost: Number.POSITIVE_INFINITY, ...normalizedOptions };
  }

  const distances = new Map();
  const visited = new Set();
  distances.set(start, 0);

  while (visited.size < FULL_GRAPH.nodes.size) {
    let currentNode = null;
    let currentDistance = Number.POSITIVE_INFINITY;
    distances.forEach((distance, nodeId) => {
      if (visited.has(nodeId)) return;
      if (distance < currentDistance) {
        currentDistance = distance;
        currentNode = nodeId;
      }
    });

    if (currentNode == null) break;
    if (currentNode === end) break;
    visited.add(currentNode);

    const traversable = getTraversableEdges(currentNode, normalizedOptions);
    traversable.forEach(next => {
      const newDistance = currentDistance + next.cost;
      if (newDistance < (distances.get(next.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(next.to, newDistance);
        previous.set(next.to, currentNode);
        previousEdge.set(next.to, next.edgeId);
      }
    });
  }

  const finalCost = distances.get(end);
  return reconstructPathResult(
    start,
    end,
    previous,
    previousEdge,
    Number.isFinite(finalCost) ? finalCost : Number.POSITIVE_INFINITY,
    normalizedOptions
  );
}

function highlightPath(pathResult) {
  if (!window.PATH_HIGHLIGHT_STATE) return;
  window.PATH_HIGHLIGHT_STATE.nodeIds.clear();
  window.PATH_HIGHLIGHT_STATE.edgeIds.clear();
  if (!pathResult || !Array.isArray(pathResult.path) || pathResult.path.length === 0) {
    renderVisibleGraphBatch();
    return;
  }

  pathResult.path.forEach(nodeId => {
    if (VISIBLE_STATE.nodes.has(nodeId)) {
      window.PATH_HIGHLIGHT_STATE.nodeIds.add(nodeId);
    }
  });
  (pathResult.edgeIds || []).forEach(edgeId => {
    if (VISIBLE_STATE.edges.has(edgeId)) {
      window.PATH_HIGHLIGHT_STATE.edgeIds.add(edgeId);
    }
  });

  renderVisibleGraphBatch();
}

async function runPathFinderForSelection(selectedNodes) {
  const ids = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId) : [];
  if (ids.length !== 2) {
    alert("Select exactly two nodes to compute shortest path.");
    return;
  }

  const current = normalizePathOptions(window.PATH_OPTIONS);
  const modeDefault = current.weighted
    ? (current.directed ? "directed_weighted" : "weighted")
    : (current.directed ? "directed_hops" : "hops");
  const modeInput = await requestUserInput(
    "Path mode: hops | directed_hops | weighted | directed_weighted",
    modeDefault,
    { title: "Path Finder Mode" }
  );
  if (modeInput == null) return;

  const mode = String(modeInput || "").trim().toLowerCase();
  const nextOptions = {
    directed: mode === "directed_hops" || mode === "directed_weighted",
    weighted: mode === "weighted" || mode === "directed_weighted",
    includeThemeLines: current.includeThemeLines
  };

  const includeThemeInput = await requestUserInput(
    "Include Theme Lines in path? (yes/no)",
    nextOptions.includeThemeLines ? "yes" : "no",
    { title: "Path Finder Scope" }
  );
  if (includeThemeInput != null) {
    const normalized = String(includeThemeInput).trim().toLowerCase();
    nextOptions.includeThemeLines = normalized === "yes" || normalized === "y" || normalized === "true";
  }

  window.PATH_OPTIONS = normalizePathOptions(nextOptions);
  writeJsonStorage(PATH_OPTIONS_STORAGE_KEY, window.PATH_OPTIONS);

  const pathResult = findShortestPath(ids[0], ids[1], window.PATH_OPTIONS);
  if (!pathResult.path.length) {
    alert("No path found between the selected nodes.");
    return;
  }
  queueGraphHistoryCapture();
  pathResult.path.forEach(nodeId => VISIBLE_STATE.nodes.add(nodeId));
  recomputeVisibleEdges();
  highlightPath(pathResult);

  const distanceText = pathResult.weighted
    ? `Total cost: ${Number(pathResult.totalCost).toFixed(3)}`
    : `Hops: ${Math.max(0, pathResult.path.length - 1)}`;
  alert(`Path found. Nodes: ${pathResult.path.length}. ${distanceText}.`);
}

function findAllSimplePaths(startId, endId, options = {}) {
  const normalizedOptions = {
    directed: options.directed === true,
    includeThemeLines: options.includeThemeLines === true,
    maxDepth: Math.max(1, Math.min(12, Number(options.maxDepth) || 6)),
    maxPaths: Math.max(1, Math.min(2000, Number(options.maxPaths) || 400))
  };
  const start = normalizeGraphId(startId);
  const end = normalizeGraphId(endId);
  if (!FULL_GRAPH.nodes.has(start) || !FULL_GRAPH.nodes.has(end)) return [];
  if (start === end) return [{ path: [start], edgeIds: [] }];

  const paths = [];
  const stackNodes = [start];
  const stackEdges = [];
  const visited = new Set([start]);

  function dfs(currentNode, depth) {
    if (paths.length >= normalizedOptions.maxPaths) return;
    if (depth > normalizedOptions.maxDepth) return;
    if (currentNode === end) {
      paths.push({ path: [...stackNodes], edgeIds: [...stackEdges] });
      return;
    }
    const nextEdges = getTraversableEdges(currentNode, {
      directed: normalizedOptions.directed,
      weighted: false,
      includeThemeLines: normalizedOptions.includeThemeLines
    });
    for (const next of nextEdges) {
      if (visited.has(next.to)) continue;
      visited.add(next.to);
      stackNodes.push(next.to);
      stackEdges.push(next.edgeId);
      dfs(next.to, depth + 1);
      stackEdges.pop();
      stackNodes.pop();
      visited.delete(next.to);
      if (paths.length >= normalizedOptions.maxPaths) return;
    }
  }

  dfs(start, 0);
  return paths;
}

async function runFindAllPathsForSelection(selectedNodes) {
  const ids = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId) : [];
  if (ids.length !== 2) {
    alert("Select exactly two nodes to find all paths.");
    return;
  }

  const depthInput = await requestUserInput(
    "Max depth for all paths (recommended 4-8)",
    "6",
    { title: "Find All Paths" }
  );
  if (depthInput == null) return;
  const maxDepth = Math.max(1, Math.min(12, Number(depthInput) || 6));

  const current = normalizePathOptions(window.PATH_OPTIONS);
  const allPaths = findAllSimplePaths(ids[0], ids[1], {
    directed: current.directed,
    includeThemeLines: current.includeThemeLines,
    maxDepth,
    maxPaths: 400
  });
  if (!allPaths.length) {
    alert("No paths found between the selected nodes.");
    return;
  }
  queueGraphHistoryCapture();

  const pathNodeIds = new Set();
  const pathEdgeIds = new Set();
  allPaths.forEach(item => {
    (item.path || []).forEach(nodeId => {
      VISIBLE_STATE.nodes.add(nodeId);
      pathNodeIds.add(nodeId);
    });
    (item.edgeIds || []).forEach(edgeId => pathEdgeIds.add(edgeId));
  });

  recomputeVisibleEdges();
  if (window.PATH_HIGHLIGHT_STATE) {
    window.PATH_HIGHLIGHT_STATE.nodeIds.clear();
    window.PATH_HIGHLIGHT_STATE.edgeIds.clear();
    pathNodeIds.forEach(nodeId => {
      if (VISIBLE_STATE.nodes.has(nodeId)) window.PATH_HIGHLIGHT_STATE.nodeIds.add(nodeId);
    });
    pathEdgeIds.forEach(edgeId => {
      if (VISIBLE_STATE.edges.has(edgeId)) window.PATH_HIGHLIGHT_STATE.edgeIds.add(edgeId);
    });
  }
  renderVisibleGraphBatch();
  alert(`Found ${allPaths.length} path(s) within depth ${maxDepth}.`);
}

function bringNodeToFront(nodeId) {
  const focusId = normalizeGraphId(nodeId);
  if (!FULL_GRAPH.nodes.has(focusId)) return;
  queueGraphHistoryCapture();

  const nextVisible = new Set([focusId]);
  const neighbors = FULL_GRAPH.adjacency.get(focusId);
  if (neighbors) {
    neighbors.forEach(neighborId => {
      if (FULL_GRAPH.nodes.has(neighborId)) nextVisible.add(neighborId);
    });
  }

  VISIBLE_STATE.nodes.clear();
  nextVisible.forEach(id => VISIBLE_STATE.nodes.add(id));
  recomputeVisibleEdges();

  if (window.PATH_HIGHLIGHT_STATE) {
    window.PATH_HIGHLIGHT_STATE.nodeIds.clear();
    window.PATH_HIGHLIGHT_STATE.edgeIds.clear();
    window.PATH_HIGHLIGHT_STATE.nodeIds.add(focusId);
    VISIBLE_STATE.edges.forEach(edgeId => window.PATH_HIGHLIGHT_STATE.edgeIds.add(edgeId));
  }

  renderVisibleGraphBatch();
  network.fit({ nodes: Array.from(VISIBLE_STATE.nodes), animation: { duration: 300, easingFunction: "easeInOutQuad" } });
}

function runLinkTraversal(selectedNodes, degree = 4) {
  const ids = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId).filter(id => FULL_GRAPH.nodes.has(id)) : [];
  if (!ids.length) {
    alert("Select at least one node to run link traversal.");
    return;
  }
  const maxDepth = Math.max(1, Math.min(4, Number(degree) || 4));
  expandNeighborhoodFromSelection(ids, maxDepth);
  alert(`Expanded traversal up to ${maxDepth} degree(s).`);
}

function findVisibleCutPoints() {
  const visibleNodes = Array.from(VISIBLE_STATE.nodes).filter(id => FULL_GRAPH.nodes.has(id));
  const visibleSet = new Set(visibleNodes);
  const adjacency = new Map();
  visibleNodes.forEach(nodeId => adjacency.set(nodeId, new Set()));

  FULL_GRAPH.edges.forEach((edge) => {
    const from = normalizeGraphId(edge.from);
    const to = normalizeGraphId(edge.to);
    if (!visibleSet.has(from) || !visibleSet.has(to) || from === to) return;
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  });

  const discovery = new Map();
  const low = new Map();
  const parent = new Map();
  const cutPoints = new Set();
  let time = 0;

  function dfs(u) {
    discovery.set(u, ++time);
    low.set(u, discovery.get(u));
    let children = 0;

    adjacency.get(u).forEach(v => {
      if (!discovery.has(v)) {
        children += 1;
        parent.set(v, u);
        dfs(v);
        low.set(u, Math.min(low.get(u), low.get(v)));
        if (!parent.has(u) && children > 1) cutPoints.add(u);
        if (parent.has(u) && low.get(v) >= discovery.get(u)) cutPoints.add(u);
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u), discovery.get(v)));
      }
    });
  }

  visibleNodes.forEach(nodeId => {
    if (!discovery.has(nodeId)) dfs(nodeId);
  });

  return Array.from(cutPoints);
}

function runCutPointDetection() {
  const cutPoints = findVisibleCutPoints();
  queueGraphHistoryCapture();
  if (window.PATH_HIGHLIGHT_STATE) {
    window.PATH_HIGHLIGHT_STATE.nodeIds.clear();
    window.PATH_HIGHLIGHT_STATE.edgeIds.clear();
    cutPoints.forEach(nodeId => window.PATH_HIGHLIGHT_STATE.nodeIds.add(nodeId));
  }
  renderVisibleGraphBatch();
  if (!cutPoints.length) {
    alert("No cut points found in the current visible graph.");
    return;
  }
  network.selectNodes(cutPoints);
  alert(`Found ${cutPoints.length} cut point(s).`);
}

function clearEdgeBundlingLite() {
  const state = window.EDGE_BUNDLING_STATE;
  if (!state) return;
  const restoreUpdates = [];
  state.originalByEdgeId.forEach((original, edgeId) => {
    if (edgesData.get(edgeId)) {
      restoreUpdates.push({ id: edgeId, ...original });
    }
  });
  if (restoreUpdates.length > 0) edgesData.update(restoreUpdates);
  state.originalByEdgeId.clear();
  state.bundledPrimaryEdges.clear();
}

function applyEdgeBundlingLite() {
  const state = window.EDGE_BUNDLING_STATE;
  if (!state || !state.enabled) return;
  clearEdgeBundlingLite();

  const minGroupSize = Math.max(2, parseInt(state.minGroupSize, 10) || 2);

  const groups = new Map();
  Array.from(VISIBLE_STATE.edges).forEach(edgeId => {
    const edge = edgesData.get(edgeId) || FULL_GRAPH.edges.get(edgeId);
    if (!edge) return;
    const key = isThemeLineEdge(edge) ? `theme::${edge.id}` : `${String(edge.from)}-->${String(edge.to)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  });

  const updates = [];
  groups.forEach(group => {
    group.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    if (group.length < minGroupSize) {
      const solo = group[0];
      if (solo) updates.push({ id: solo.id, hidden: false });
      if (group.length > 1) {
        group.slice(1).forEach(edge => updates.push({ id: edge.id, hidden: false }));
      }
      return;
    }

    group.forEach((edge, index) => {
      if (!state.originalByEdgeId.has(edge.id)) {
        state.originalByEdgeId.set(edge.id, {
          label: edge.label,
          width: edge.width,
          color: edge.color,
          hidden: edge.hidden
        });
      }
      if (index === 0) {
        state.bundledPrimaryEdges.add(edge.id);
        updates.push({
          id: edge.id,
          hidden: false,
          label: `${edge.label || "link"} x${group.length}`,
          width: Math.max(1.5, Math.min(6, 1 + Math.log2(group.length + 1))),
          color: { color: "#4b5563", inherit: false }
        });
      } else {
        updates.push({ id: edge.id, hidden: true });
      }
    });
  });

  if (updates.length > 0) edgesData.update(updates);
}

function toggleEdgeBundlingLite(forceState = null) {
  const state = window.EDGE_BUNDLING_STATE;
  if (!state) return false;
  const next = forceState == null ? !state.enabled : !!forceState;
  state.enabled = next;
  window.currentSettings.edgeBundling = next;
  if (!next) {
    clearEdgeBundlingLite();
  } else {
    applyEdgeBundlingLite();
  }
  network.redraw();
  return next;
}

async function configureEdgeBundlingLite() {
  const state = window.EDGE_BUNDLING_STATE || {};
  const currentMin = Math.max(2, parseInt(state.minGroupSize, 10) || 2);
  const answer = await requestUserInput(
    "Minimum parallel edges to bundle (>=2)",
    String(currentMin),
    { title: "Configure Edge Bundling" }
  );
  if (answer == null) return;
  const nextMin = Math.max(2, parseInt(answer, 10) || currentMin);
  state.minGroupSize = nextMin;
  window.EDGE_BUNDLING_STATE = state;

  if (state.enabled) {
    applyEdgeBundlingLite();
    network.redraw();
  }
}

function clearAlertHighlight() {
  if (!window.ALERT_HIGHLIGHT_STATE) return;
  window.ALERT_HIGHLIGHT_STATE.nodeIds.clear();
  window.ALERT_HIGHLIGHT_STATE.edgeIds.clear();
}

function applyAlertHighlight(alerts) {
  if (!window.ALERT_HIGHLIGHT_STATE) {
    window.ALERT_HIGHLIGHT_STATE = { nodeIds: new Set(), edgeIds: new Set() };
  }
  clearAlertHighlight();
  (alerts || []).forEach(item => {
    if (item.nodeId != null) window.ALERT_HIGHLIGHT_STATE.nodeIds.add(normalizeGraphId(item.nodeId));
    if (item.edgeId != null) window.ALERT_HIGHLIGHT_STATE.edgeIds.add(item.edgeId);
  });
}

function generateGraphAlerts() {
  if (!window.ALERT_RULES_ENABLED) return [];
  const rules = normalizeAlertRulesConfig(window.ALERT_RULES_CONFIG);
  window.ALERT_RULES_CONFIG = rules;

  const alerts = [];
  const visibleNodes = Array.from(VISIBLE_STATE.nodes);
  const visibleEdges = Array.from(VISIBLE_STATE.edges);
  if (visibleNodes.length === 0) return alerts;

  if (rules.enableHighDegree) {
    const visibleNodeSet = new Set(VISIBLE_STATE.nodes);
    const degreeStats = visibleNodes
      .map(nodeId => ({ nodeId, degree: getVisibleNeighborCount(nodeId, visibleNodeSet) }))
      .sort((a, b) => b.degree - a.degree);

    degreeStats
      .slice(0, Math.min(rules.maxHighDegreeAlerts, degreeStats.length))
      .forEach(item => {
        if (item.degree < rules.highDegreeMin) return;
        alerts.push({
          type: "high_degree",
          severity: item.degree >= rules.highSeverityDegree ? "high" : "medium",
          nodeId: item.nodeId,
          message: `Node ${item.nodeId} has degree ${item.degree}`
        });
      });
  }

  if (rules.enableHeavyEdge) {
    const numericEdgeValues = [];
    visibleEdges.forEach(edgeId => {
      const edge = FULL_GRAPH.edges.get(edgeId) || edgesData.get(edgeId);
      if (!edge || isThemeLineEdge(edge)) return;
      const value = toFiniteNumber(edge.weight ?? edge.value ?? edge.width);
      if (value != null) numericEdgeValues.push({ edgeId, value });
    });

    if (numericEdgeValues.length >= rules.heavyEdgeMinSamples) {
      const sorted = numericEdgeValues.slice().sort((a, b) => a.value - b.value);
      const threshold = getPercentile(sorted.map(item => item.value), rules.heavyEdgePercentile / 100);
      sorted
        .filter(item => item.value >= threshold && item.value >= rules.heavyEdgeMinValue)
        .slice(-rules.maxHeavyEdgeAlerts)
        .forEach(item => {
          alerts.push({
            type: "heavy_edge",
            severity: "medium",
            edgeId: item.edgeId,
            message: `Edge ${item.edgeId} has high weight ${item.value}`
          });
        });
    }
  }

  return alerts;
}

function publishGraphAlerts(alerts) {
  window.parent.postMessage({
    type: "graph_alerts",
    payload: {
      count: alerts.length,
      alerts
    }
  }, "*");
}

function runAlertScan(notify = true) {
  const alerts = generateGraphAlerts();
  applyAlertHighlight(alerts);
  publishGraphAlerts(alerts);
  if (notify) {
    renderVisibleGraphBatch();
    if (alerts.length === 0) alert("Alert scan complete. No alerts triggered.");
    else alert(`Alert scan complete. ${alerts.length} alert(s) found.`);
  }
  return alerts;
}

function scheduleAlertScan() {
  if (!window.ALERT_RULES_ENABLED) return;
  if (VISIBLE_STATE.nodes.size > 5000 || VISIBLE_STATE.edges.size > 25000) return;

  if (window.__alertScanTimer) {
    clearTimeout(window.__alertScanTimer);
  }

  window.__alertScanTimer = setTimeout(() => {
    window.__alertScanTimer = null;
    runAlertScan(false);
  }, 180);
}

function toggleAlertRules(forceState = null) {
  const next = forceState == null ? !window.ALERT_RULES_ENABLED : !!forceState;
  window.ALERT_RULES_ENABLED = next;
  window.currentSettings.alertRules = next;
  if (next) {
    runAlertScan(false);
    renderVisibleGraphBatch();
  } else {
    if (window.__alertScanTimer) {
      clearTimeout(window.__alertScanTimer);
      window.__alertScanTimer = null;
    }
    clearAlertHighlight();
    publishGraphAlerts([]);
    renderVisibleGraphBatch();
  }
  return next;
}

async function configureAlertRules() {
  const current = normalizeAlertRulesConfig(window.ALERT_RULES_CONFIG);
  const raw = await requestUserInput(
    "Set alert rules JSON",
    JSON.stringify(current),
    { title: "Configure Alert Rules", multiline: true }
  );
  if (raw == null) return;

  try {
    const parsed = JSON.parse(raw);
    const normalized = normalizeAlertRulesConfig(parsed);
    window.ALERT_RULES_CONFIG = normalized;
    writeJsonStorage(ALERT_RULES_STORAGE_KEY, normalized);
    if (window.ALERT_RULES_ENABLED) {
      runAlertScan(false);
      renderVisibleGraphBatch();
    }
    alert("Alert rules updated.");
  } catch (_err) {
    alert("Invalid JSON. Alert rules were not changed.");
  }
}

function pushPinnedEvidenceItem(item) {
  const key = `${item.type}:${item.id}`;
  const existing = new Set(window.PINNED_EVIDENCE.map(entry => `${entry.type}:${entry.id}`));
  if (existing.has(key)) return;
  window.PINNED_EVIDENCE.unshift({
    ...item,
    pinnedAt: new Date().toISOString()
  });
  window.PINNED_EVIDENCE = window.PINNED_EVIDENCE.slice(0, 300);
  writeJsonStorage(PINNED_EVIDENCE_STORAGE_KEY, window.PINNED_EVIDENCE);
  window.parent.postMessage({
    type: "pinned_evidence_update",
    payload: window.PINNED_EVIDENCE
  }, "*");
}

function pinSelectedEvidence() {
  const selectedNodes = network.getSelectedNodes();
  const selectedEdges = network.getSelectedEdges();
  selectedNodes.forEach(nodeId => {
    const base = FULL_GRAPH.nodes.get(nodeId);
    if (!base) return;
    const mod = MODIFIED_NODES.get(nodeId) || {};
    pushPinnedEvidenceItem({
      type: "node",
      id: nodeId,
      data: { ...base, ...mod }
    });
  });
  selectedEdges.forEach(edgeId => {
    const base = FULL_GRAPH.edges.get(edgeId);
    if (!base) return;
    const mod = MODIFIED_EDGES.get(edgeId) || {};
    pushPinnedEvidenceItem({
      type: "edge",
      id: edgeId,
      data: { ...base, ...mod }
    });
  });
  renderVisibleGraphBatch();
}

function clearPinnedEvidence() {
  window.PINNED_EVIDENCE = [];
  writeJsonStorage(PINNED_EVIDENCE_STORAGE_KEY, window.PINNED_EVIDENCE);
  window.parent.postMessage({
    type: "pinned_evidence_update",
    payload: window.PINNED_EVIDENCE
  }, "*");
  renderVisibleGraphBatch();
}

function unpinSelectedEvidence() {
  const selectedNodeIds = new Set(network.getSelectedNodes().map(normalizeGraphId));
  const selectedEdgeIds = new Set(network.getSelectedEdges());
  const list = Array.isArray(window.PINNED_EVIDENCE) ? window.PINNED_EVIDENCE : [];

  const next = list.filter(item => {
    if (!item) return false;
    if (item.type === "node") return !selectedNodeIds.has(normalizeGraphId(item.id));
    if (item.type === "edge") return !selectedEdgeIds.has(item.id);
    return false;
  });

  window.PINNED_EVIDENCE = next;
  writeJsonStorage(PINNED_EVIDENCE_STORAGE_KEY, window.PINNED_EVIDENCE);
  window.parent.postMessage({
    type: "pinned_evidence_update",
    payload: window.PINNED_EVIDENCE
  }, "*");
  renderVisibleGraphBatch();
}

function showPinnedEvidenceSummary() {
  const list = Array.isArray(window.PINNED_EVIDENCE) ? window.PINNED_EVIDENCE : [];
  if (list.length === 0) {
    alert("No pinned evidence.");
    return;
  }

  const preview = list
    .slice(0, 20)
    .map(item => `${item.type}:${item.id}`)
    .join("\n");
  const suffix = list.length > 20 ? `\n... (${list.length - 20} more)` : "";
  alert(`Pinned evidence (${list.length}):\n${preview}${suffix}`);
}

function detectVisibleCommunities() {
  const visibleSet = new Set(VISIBLE_STATE.nodes);
  const visited = new Set();
  const communities = [];

  visibleSet.forEach(startNode => {
    if (visited.has(startNode)) return;
    const queue = [startNode];
    const members = [];
    visited.add(startNode);

    while (queue.length > 0) {
      const nodeId = queue.shift();
      members.push(nodeId);
      const neighbors = FULL_GRAPH.adjacency.get(nodeId);
      if (!neighbors) continue;
      neighbors.forEach(neighborId => {
        if (!visibleSet.has(neighborId) || visited.has(neighborId)) return;
        visited.add(neighborId);
        queue.push(neighborId);
      });
    }
    communities.push(members);
  });

  return communities.sort((a, b) => b.length - a.length);
}

function applyCommunityDetection() {
  const communities = detectVisibleCommunities();
  if (communities.length === 0) return;

  const nodeUpdates = [];
  communities.forEach((communityNodes, index) => {
    const color = generatePaletteColor(index, communities.length);
    communityNodes.forEach(nodeId => {
      const patch = {
        id: nodeId,
        community_id: index + 1,
        color: buildNodeColor(color)
      };
      persistNodeChange(nodeId, patch);
      nodeUpdates.push(patch);
    });
  });
  nodesData.update(nodeUpdates);

  window.parent.postMessage({
    type: "community_detection_result",
    payload: {
      communities: communities.length,
      largest: communities[0]?.length || 0
    }
  }, "*");
}


function restoreNodeState(nodeId) {
  const mod = window.MODIFIED_NODES.get(nodeId);
  if (!mod) return;

  nodesData.update({ id: nodeId, ...mod });
}


function applyLimit({ key = "", sort = "asc", amount = 25, min = null, max = null }) {
    const perfStart = performance.now();
    const baseRange = normalizeLimitRange(amount, 25);
    const resolvedRange = normalizeLimitRange({
      min: min == null ? baseRange.min : min,
      max: max == null ? baseRange.max : max
    }, baseRange.max);
    const rangeMin = resolvedRange.min;
    const rangeMax = resolvedRange.max;
    const rangeCount = Math.max(1, rangeMax - rangeMin);

      // Store in global settings
    window.currentSettings.limit = rangeCount;
    window.currentSettings.limitMin = rangeMin;
    window.currentSettings.limitMax = rangeMax;
    window.currentSettings.sortKey = key;
    window.currentSettings.sortOrder = sort;
    window.currentSortKey = key;
    window.currentSortOrder = sort;

    VISIBLE_STATE.nodes.clear();
    VISIBLE_STATE.edges.clear();
    VISIBLE_STATE.limit = rangeCount;
    VISIBLE_STATE.limitMin = rangeMin;
    VISIBLE_STATE.limitMax = rangeMax;

    // For large graphs, skip sorting if no key
    if (!key || FULL_GRAPH.nodes.size > 10000) {
        // Fast path: apply offset and range without sorting
        const iterator = FULL_GRAPH.nodes.keys();
        let idx = 0;
        for (;;) {
            const { value, done } = iterator.next();
            if (done) break;
            if (idx >= rangeMin && idx < rangeMax) {
              VISIBLE_STATE.nodes.add(value);
            }
            if (idx >= rangeMax) break;
            idx += 1;
        }
    } else {
        // Original sorting logic for smaller graphs
        const nodes = [];
        for (const [id, node] of FULL_GRAPH.nodes) {
            const value = getNodeValue(node, key);
            if (value != null) nodes.push({ id, value });
            // if (nodes.length > amount * 2) break; // Early exit
        }
        
        nodes.sort((a, b) => {
          // Handle null/undefined cases
          if (a.value == null && b.value == null) return 0;
          if (a.value == null) return 1;  // nulls go to end
          if (b.value == null) return -1; // nulls go to end

          // Numeric comparison 
          if (typeof a.value === "number" && typeof b.value === "number") {
            return sort === "asc" 
              ? a.value - b.value 
              : b.value - a.value;
           }

          // String comparison
           const aStr = String(a.value);
           const bStr = String(b.value);
            
          // Try numeric string comparison if both are numeric strings
            const aNum = parseFloat(aStr);
            const bNum = parseFloat(bStr);
            if (!isNaN(aNum) && !isNaN(bNum)) {
                return sort === "asc" 
                    ? aNum - bNum 
                    : bNum - aNum;
            }
            // Fallback to locale comparison
            return sort === "asc"
                ? aStr.localeCompare(bStr, undefined, { numeric: true })
                : bStr.localeCompare(aStr, undefined, { numeric: true });
        });
        
        const end = Math.min(rangeMax, nodes.length);
        for (let i = rangeMin; i < end; i++) {
            VISIBLE_STATE.nodes.add(nodes[i].id);
        }
    }

    const selectionDone = performance.now();
    recomputeVisibleEdges();
    const edgesDone = performance.now();
    renderVisibleGraphBatch();
    const renderDone = performance.now();

    if (VISIBLE_STATE.nodes.size >= 500 || VISIBLE_STATE.edges.size >= 1000) {
      console.log(
        `[applyLimit] nodes=${VISIBLE_STATE.nodes.size} edges=${VISIBLE_STATE.edges.size} ` +
        `select=${(selectionDone - perfStart).toFixed(1)}ms ` +
        `edgeRecompute=${(edgesDone - selectionDone).toFixed(1)}ms ` +
        `render=${(renderDone - edgesDone).toFixed(1)}ms ` +
        `total=${(renderDone - perfStart).toFixed(1)}ms`
      );
    }
}


function recomputeVisibleEdges() {
  VISIBLE_STATE.edges.clear();

  if (VISIBLE_STATE.nodes.size === 0) return;

  const edgesByNode = ensureEdgesByNodeIndex();

  // For partial views, iterating incident edges is much faster than scanning all edges.
  const useIndexedPath = VISIBLE_STATE.nodes.size < (FULL_GRAPH.nodes.size * 0.65);
  if (useIndexedPath) {
    const candidateEdgeIds = new Set();
    VISIBLE_STATE.nodes.forEach(nodeId => {
      const edgeIds = edgesByNode.get(nodeId);
      if (!edgeIds) return;
      edgeIds.forEach(edgeId => candidateEdgeIds.add(edgeId));
    });

    candidateEdgeIds.forEach(edgeId => {
      const edge = FULL_GRAPH.edges.get(edgeId);
      if (!edge) return;
      if (VISIBLE_STATE.nodes.has(edge.from) && VISIBLE_STATE.nodes.has(edge.to)) {
        VISIBLE_STATE.edges.add(edgeId);
      }
    });
    return;
  }

  // Fallback full scan for very large visible sets.
  for (const [id, edge] of FULL_GRAPH.edges) {
    if (VISIBLE_STATE.nodes.has(edge.from) && VISIBLE_STATE.nodes.has(edge.to)) {
      VISIBLE_STATE.edges.add(id);
    }
  }
}

function ensureEdgesByNodeIndex() {
  const currentIndex = FULL_GRAPH.edgesByNode;
  if (currentIndex instanceof Map && currentIndex.size > 0) {
    return currentIndex;
  }

  const index = new Map();
  for (const nodeId of FULL_GRAPH.nodes.keys()) {
    index.set(nodeId, new Set());
  }

  for (const [edgeId, edge] of FULL_GRAPH.edges) {
    if (!index.has(edge.from)) index.set(edge.from, new Set());
    if (!index.has(edge.to)) index.set(edge.to, new Set());
    index.get(edge.from).add(edgeId);
    index.get(edge.to).add(edgeId);
  }

  FULL_GRAPH.edgesByNode = index;
  return index;
}

function addVisibleEdgesForNode(nodeId) {
  const edgesByNode = ensureEdgesByNodeIndex();
  const edgeIds = edgesByNode.get(nodeId);
  if (!edgeIds || edgeIds.size === 0) return;

  edgeIds.forEach(edgeId => {
    const edge = FULL_GRAPH.edges.get(edgeId);
    if (!edge) return;
    if (VISIBLE_STATE.nodes.has(edge.from) && VISIBLE_STATE.nodes.has(edge.to)) {
      VISIBLE_STATE.edges.add(edgeId);
    }
  });
}

function expandNode(nodeId) {
    const neighbors = FULL_GRAPH.adjacency.get(nodeId);
    if (!neighbors || neighbors.size === 0) return;
    
    // Find first neighbor not visible
    let neighborToExpand = null;
    for (const n of neighbors) {
        if (!VISIBLE_STATE.nodes.has(n)) {
            neighborToExpand = n;
            break;
        }
    }
    
    if (neighborToExpand) {
        // OVERRIDE limit - add neighbor even if over limit
        VISIBLE_STATE.nodes.add(neighborToExpand);
        
        // Optional: Store that we've overridden the limit
        window.limitOverridden = true;
        window.originalLimit = VISIBLE_STATE.limit;
        // Only add newly affected edges for progressive extraction.
        addVisibleEdgesForNode(neighborToExpand);
    } else {
        return;
    }

    renderVisibleGraphBatch();
    
    // Show indicator that limit is overridden
    console.log(`Limit overridden: Now showing ${VISIBLE_STATE.nodes.size} nodes (limit was ${VISIBLE_STATE.limit})`);
}

// Optional: Reset to limit
function resetToLimit() {
    if (window.limitOverridden) {
        const limit = window.originalLimit || 25;
        applyLimit({ 
            key: window.currentSortKey || "", 
            sort: window.currentSortOrder || "asc", 
            amount: limit 
        });
        window.limitOverridden = false;
    }
}

function applyTitleToggle(state) {
    console.log("applyTitleToggle_called:", state);
    window.currentSettings.showTitles = state;
    
    const nodeUpdates = [];
    const edgeUpdates = [];
    
    // --- Handle Node Titles ---
    nodesData.forEach(node => {
        if (!state) {
            nodeUpdates.push({ id: node.id, title: undefined });
        } else {
            const base = FULL_GRAPH.nodes.get(node.id);
            const mod = MODIFIED_NODES.get(node.id) || {};
            const merged = { ...base, ...mod };
            
            const titleEntries = [];
            
            // Always show label first if it exists
            if (merged.label) {
                titleEntries.push(`Label: ${merged.label}`);
            }
            
            // Then show other properties
            Object.entries(merged)
                .filter(([k, v]) => v != null)
                .filter(([k]) => {
                    // Keep these important keys
                    const keepKeys = ['node_identity', 'id', 'type', 'category', 'department', 'name', 'description'];
                    
                    // Exclude these internal/system keys
                    const excludeKeys = [
                        'session_id', 'label', 'rel_type', 'x', 'y', 'vx', 'vy', 'index', 
                        'edges', 'neighbors', 'color', 'shape', 'borderWidth', 
                        'borderWidthSelected', 'image', 'iconPath', 'title', 
                        'size', 'font', 'margin', 'shadow'
                    ];
                    
                    if (keepKeys.includes(k)) return true;
                    if (excludeKeys.includes(k)) return false;
                    
                    // If not in either list, keep it (but limit total)
                    return true;
                })
                .slice(0, 50) // Show max 50 additional properties
                .forEach(([k, v]) => {
                    // Special formatting for certain keys
                    if (k === 'node_identity') {
                        titleEntries.push(`Identity: ${v}`);
                    } 
                    // else if (k === 'id' && v === node.id) {
                    //     // Skip showing id if it's the same as node id (redundant)
                    //     return;
                    // } 
                    else if (typeof v === 'object') {
                        titleEntries.push(`${k}: ${JSON.stringify(v).slice(0, 50)}...`);
                    } else {
                        titleEntries.push(`${k}: ${v}`);
                    }
                });
            
            if (titleEntries.length > 0) {
                nodeUpdates.push({ id: node.id, title: titleEntries.join("\n") });
            }
        }
    });
    
    // --- Handle Edge Titles ---
    edgesData.forEach(edge => {
        if (!state) {
          edgeUpdates.push({ id: edge.id, title: null }); // <- force clearing
        } else {
            const base = FULL_GRAPH.edges.get(edge.id);
            const mod = MODIFIED_EDGES.get(edge.id) || {};
            const merged = { ...base, ...mod };

            const titleEntries = [];

            const fromNode = FULL_GRAPH.nodes.get(merged.from);
            const toNode = FULL_GRAPH.nodes.get(merged.to);
            if (fromNode?.label) titleEntries.push(`From: ${fromNode.label}`);
            if (toNode?.label) titleEntries.push(`To: ${toNode.label}`);

            Object.entries(merged)
                .filter(([k, v]) => {
                    if (['from','to','id','arrows','smooth','selectionWidth','hoverWidth','width','widthConstrain','length','font','arrowStrikethrough','chosen','endPointOffset','bgcolor','textcolor','session_id','color','baseColor','Text Color', 'label'].includes(k)) {
                        return false;
                    }
                    return v != null;
                })
                .slice(0, 50)
                .forEach(([k, v]) => {
                    if (k === 'label') {
                        titleEntries.push(`Text Color: ${v.color || 'custom'}`);                  
                    } else {
                        titleEntries.push(`${k}: ${v}`);
                    }
                });

            // Always push, even if empty
            edgeUpdates.push({ id: edge.id, title: titleEntries.join("\n") });
        }
    });
    
    // Batch update both datasets
    if (nodeUpdates.length > 0) {
        nodesData.update(nodeUpdates);
    }
    if (edgeUpdates.length > 0) {
        console.log("found edgeUpdates :",edgeUpdates)
        edgesData.update(edgeUpdates);
    }
    
    console.log(`Titles ${state ? 'enabled' : 'disabled'} - Updated ${nodeUpdates.length} nodes, ${edgeUpdates.length} edges`);
}


function applyLabelToggle(state) {
  nodesData.forEach(node => {
    const base = FULL_GRAPH.nodes.get(node.id);
    const mod  = MODIFIED_NODES.get(node.id) || {};
    nodesData.update({
      id: node.id,
      label: getNodeRenderLabel(base, mod, state)
    });
  });
  window.currentSettings.showLabels = state;
  network.redraw();
}


function copyNodes(selectedIds) {
  const CLIPBOARD_STORAGE_KEY = "linkx_graph_clipboard_v1";
  const safeSelectedIds = Array.isArray(selectedIds) ? selectedIds : [];
  const selectedNodeIds = new Set(safeSelectedIds.map(id => String(id)));

  const copiedNodes = safeSelectedIds
    .map(id => nodesData.get(id))
    .filter(Boolean)
    .map(n => ({ ...n }));

  const copiedEdges = edgesData.get({
    filter: edge =>
      selectedNodeIds.has(String(edge.from)) &&
      selectedNodeIds.has(String(edge.to))
  }).map(edge => ({ ...edge }));

  // Keep clipboard as an array for existing UI checks (localClipboard.length)
  // and attach linked edges as metadata for paste reconstruction.
  copiedNodes.__edges = copiedEdges;
  localClipboard = copiedNodes;

  const clipboardPayload = copiedNodes.map(node => ({ ...node }));
  clipboardPayload.__edges = copiedEdges.map(edge => ({ ...edge }));

  try {
    localStorage.setItem(
      CLIPBOARD_STORAGE_KEY,
      JSON.stringify({
        nodes: clipboardPayload.map(node => ({ ...node })),
        edges: clipboardPayload.__edges.map(edge => ({ ...edge }))
      })
    );
  } catch (_err) {
    // ignore storage errors
  }

  // Persist clipboard to parent so all graph iframes receive the same nodes+edges.
  window.parent.postMessage(
    {
      type: "clipboard_set",
      payload: clipboardPayload
    },
    "*"
  );
}

function pasteNodes(pos) {
  const clipboardNodes = Array.isArray(localClipboard)
    ? localClipboard
    : Array.isArray(localClipboard?.nodes)
      ? localClipboard.nodes
      : [];

  if (clipboardNodes.length === 0) return;

  const basePosition = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y))
    ? pos
    : getContextCanvasPosition();
  const idMap = new Map();
  const pastedNodeIds = [];
  const pastedEdgeIds = [];

  clipboardNodes.forEach((n, i) => {
    const isGroupNode = String(n.id || "").startsWith("Group");
    const id = createUniqueNodeId(isGroupNode ? "Group" : "node");

    idMap.set(String(n.id), id);

    const node = {
      ...n,
      id,
      x: basePosition.x + i * 20,
      y: basePosition.y + i * 20
    };

    upsertFullGraphNode(node);
    MODIFIED_NODES.set(id, { ...(MODIFIED_NODES.get(id) || {}), ...node });
    VISIBLE_STATE.nodes.add(id);
    pastedNodeIds.push(id);
  });

  const copiedEdges = Array.isArray(clipboardNodes.__edges)
    ? clipboardNodes.__edges
    : Array.isArray(localClipboard?.edges)
      ? localClipboard.edges
    : [];

  const remappedEdges = copiedEdges
    .map((edge, index) => {
      const from = idMap.get(String(edge.from));
      const to = idMap.get(String(edge.to));
      if (!from || !to) return null;

      const edgeId = createUniqueEdgeId(`paste_edge_${index}`);
      return { ...edge, id: edgeId, from, to };
    })
    .filter(Boolean);

  remappedEdges.forEach(edge => {
    const stored = upsertFullGraphEdge(edge);
    if (!stored) return;
    MODIFIED_EDGES.set(stored.id, { ...(MODIFIED_EDGES.get(stored.id) || {}), ...stored });
    pastedEdgeIds.push(stored.id);
  });

  if (pastedEdgeIds.length > 0) {
    pastedEdgeIds.forEach(edgeId => VISIBLE_STATE.edges.add(edgeId));
  }

  window.limitOverridden = true;
  recomputeVisibleEdges();
  renderVisibleGraphBatch();
  if (pastedNodeIds.length > 0) {
    network.selectNodes(pastedNodeIds);
  }
  network?.redraw();
}

function weightEdges(state) {
  const mode = normalizeEdgeWeightMode(state);
  const isOff = mode === "";
  const isDefault = mode === "default";
  const nodeValues = !isOff && !isDefault ? getNodeNumericValueMap(mode) : null;
  const computedEdgeWeights = new Map();
  let adaptiveScale = { min: 1, max: 1, useLog: false };

  if (!isOff && !isDefault) {
    const sampledWeights = [];

    FULL_GRAPH.edges.forEach((baseEdge, edgeId) => {
      const mod = MODIFIED_EDGES.get(edgeId) || {};
      const merged = { ...baseEdge, ...mod };
      const weightValue = getEdgeWeightFromNodeValues(merged, nodeValues);
      computedEdgeWeights.set(edgeId, weightValue);
      sampledWeights.push(weightValue);
    });

    adaptiveScale = getAdaptiveWeightScale(sampledWeights);
  }

  edgesData.forEach(edge => {
    const mod = MODIFIED_EDGES.get(edge.id) || {};
    let width = 1;

    if (isDefault) {
      width = getDefaultEdgeWidth(edge.id);
    } else if (!isOff) {
      let weightValue = computedEdgeWeights.get(edge.id);
      if (weightValue == null) {
        const merged = { ...(FULL_GRAPH.edges.get(edge.id) || {}), ...mod };
        weightValue = getEdgeWeightFromNodeValues(merged, nodeValues);
      }
      width = EdgeWeightToWidth(weightValue, adaptiveScale);
    }

    edgesData.update({
      id: edge.id,
      width
    });

    MODIFIED_EDGES.set(edge.id, {
      ...mod,
      width
    });
  });

  window.currentSettings.weightEdges = mode;
}


function filterNodes(predicate, limit = 300) {
  nodesData.clear();
  edgesData.clear();

  const ids = [];

  for (const n of FULL_GRAPH.nodes.values()) {
    if (predicate(n)) {
      ids.push(n.id);
      if (ids.length >= limit) break;
    }
  }

  const visible = new Set(ids);

  for (const id of ids) {
    const base = FULL_GRAPH.nodes.get(id);
    const mod  = MODIFIED_NODES.get(id) || {};
    nodesData.add({
      ...base,
      ...mod,
      label: getNodeRenderLabel(base, mod, window.currentSettings.showLabels)
    });
  }

  for (const e of FULL_GRAPH.edges.values()) {
    if (visible.has(e.from) && visible.has(e.to)) {
      edgesData.add(e);
    }
  }

  network.redraw();
}



function showNodelabels(state) {
  window.currentSettings.showLabels = state;

  nodesData.forEach(node => {
    const base = FULL_GRAPH.nodes.get(node.id);
    const mod  = MODIFIED_NODES.get(node.id) || {};
    nodesData.update({
      id: node.id,
      label: getNodeRenderLabel(base, mod, state)
    });
  });

  network.redraw();
}




function showNodeInfos(node, state) {
  if (!node) return {};

  const excludeKeys = ["size", "x", "y", "vx", "vy", "rel_type", "session_id", "index", "edges", "neighbors","colorBehavior","baseColor", "color", "shape", "borderWidth", "borderWidthSelected", "borderWidth1", "image", "imagePadding", "iconPath", "title"]; // keys to ignore
  const result = {};
  Object.entries(node).forEach(([key, value]) => {
    if (!excludeKeys.includes(key)) {
      if (key === "label" && (!value || value.trim() === "")) {
        value = "";
      }
      result[key] = value;
    }
  });
  // Send message to parent window
  window.parent.postMessage(
    { type: "nodeProperties", payload: result },
    "*"
  );
  return result;
}

function networkphysics(state) {
  const requested = state === true || state === "true";
  window.currentSettings.physics = requested;
  updateGraphOption("graph_physics", requested);
  syncPhysicsWithCurrentState({ forceRestart: true });
}

function isPhysicsEnabledState(state) {
  return state === true || state === "true";
}

function getEffectivePhysicsEnabled() {
  const requested = isPhysicsEnabledState(window.currentSettings.physics);
  return requested && !AUTO_PHYSICS_FORCED_OFF;
}

function applyPhysicsRuntimeState(enabled, { forceRestart = false, forceApply = false } = {}) {
  if (!network) return;

  const changedState = LAST_APPLIED_EFFECTIVE_PHYSICS !== enabled;
  const shouldApply = forceApply || forceRestart || changedState;
  if (!shouldApply) return;

  if (enabled) {
    network.setOptions({
      physics: {
        ...STABLE_PHYSICS,
        enabled: true
      }
    });
    // Only restart/stabilize when explicitly requested or when effective state flips.
    if (forceRestart || changedState) {
      network.startSimulation();
      network.stabilize();
    }
  } else {
    network.stopSimulation();
    network.setOptions({
      physics: { enabled: false }
    });
  }

  LAST_APPLIED_EFFECTIVE_PHYSICS = enabled;
}

function syncPhysicsWithCurrentState({ forceRestart = false, forceApply = false } = {}) {
  const enabled = getEffectivePhysicsEnabled();
  applyPhysicsRuntimeState(enabled, { forceRestart, forceApply });
  applyEdgeSmoothForCurrentPhysics();
  return enabled;
}

function updatePerformancePhysicsGuard(visibleNodeCount) {
  const shouldForceOff = Number(visibleNodeCount) >= AUTO_PHYSICS_NODE_THRESHOLD;
  if (AUTO_PHYSICS_FORCED_OFF === shouldForceOff) return;

  AUTO_PHYSICS_FORCED_OFF = shouldForceOff;
  const effective = syncPhysicsWithCurrentState({ forceRestart: true });
  console.log(
    `[performancePhysics] visibleNodes=${visibleNodeCount} threshold=${AUTO_PHYSICS_NODE_THRESHOLD} ` +
    `forcedOff=${AUTO_PHYSICS_FORCED_OFF} effectivePhysics=${effective}`
  );
}

function enforceCurrentPhysicsState({ forceApply = false } = {}) {
  return syncPhysicsWithCurrentState({ forceApply });
}

function applyEdgeSmoothForCurrentPhysics() {
  const physicsEnabled = getEffectivePhysicsEnabled();
  const smoothOptions = physicsEnabled
    ? { enabled: true, type: "dynamic", roundness: 0.1 }
    : { enabled: true, type: "continuous", roundness: 0.1 };

  network.setOptions({
    edges: { smooth: smoothOptions }
  });

  if (window.currentOptions && window.currentOptions.edges) {
    window.currentOptions.edges.smooth = smoothOptions;
  }
}


function isManualLayoutType(type) {
  return type === "circle" || type === "star" || type === "radial" || type === "grid" || type === "spiral" || type === "concentric" || type === "layered";
}

function getVisibleLayoutNodeIds() {
  return Array.from(VISIBLE_STATE.nodes).filter(id => FULL_GRAPH.nodes.has(id) && nodesData.get(id));
}

function getVisibleNeighborCount(nodeId, visibleSet) {
  const neighbors = FULL_GRAPH.adjacency.get(nodeId);
  if (!neighbors) return 0;

  let count = 0;
  neighbors.forEach(neighborId => {
    if (visibleSet.has(neighborId)) count += 1;
  });
  return count;
}

function getLayoutCenterNode(nodeIds, visibleSet) {
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) return null;

  let centerId = nodeIds[0];
  let maxDegree = -1;
  nodeIds.forEach(nodeId => {
    const degree = getVisibleNeighborCount(nodeId, visibleSet);
    if (degree > maxDegree) {
      maxDegree = degree;
      centerId = nodeId;
    }
  });

  return centerId;
}

function getLayoutRadius(nodeCount, baseRadius = 200, step = 16, maxRadius = 1800) {
  return Math.max(baseRadius, Math.min(maxRadius, nodeCount * step));
}

function getLayeredRootNode(nodeIds, visibleSet) {
  const sourceCandidates = nodeIds.filter(nodeId => {
    const node = FULL_GRAPH.nodes.get(nodeId);
    const identity = String(node?.node_identity || "").toLowerCase();
    return identity.includes("source");
  });

  if (sourceCandidates.length > 0) {
    return sourceCandidates.sort((a, b) => {
      const degreeDiff = getVisibleNeighborCount(b, visibleSet) - getVisibleNeighborCount(a, visibleSet);
      if (degreeDiff !== 0) return degreeDiff;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    })[0];
  }

  return getLayoutCenterNode(nodeIds, visibleSet);
}

function sortLayerNodes(layerNodes, visibleSet, prevOrderMap = null) {
  const list = Array.from(layerNodes || []);
  const hasPrev = prevOrderMap instanceof Map && prevOrderMap.size > 0;

  list.sort((a, b) => {
    const degreeA = getVisibleNeighborCount(a, visibleSet);
    const degreeB = getVisibleNeighborCount(b, visibleSet);
    const neighborsA = FULL_GRAPH.adjacency.get(a);
    const neighborsB = FULL_GRAPH.adjacency.get(b);

    let baryA = Number.POSITIVE_INFINITY;
    let baryB = Number.POSITIVE_INFINITY;

    if (hasPrev) {
      if (neighborsA) {
        let total = 0;
        let count = 0;
        neighborsA.forEach(neighborId => {
          if (prevOrderMap.has(neighborId)) {
            total += prevOrderMap.get(neighborId);
            count += 1;
          }
        });
        if (count > 0) baryA = total / count;
      }

      if (neighborsB) {
        let total = 0;
        let count = 0;
        neighborsB.forEach(neighborId => {
          if (prevOrderMap.has(neighborId)) {
            total += prevOrderMap.get(neighborId);
            count += 1;
          }
        });
        if (count > 0) baryB = total / count;
      }
    }

    const aFinite = Number.isFinite(baryA);
    const bFinite = Number.isFinite(baryB);
    if (aFinite && bFinite && baryA !== baryB) return baryA - baryB;
    if (aFinite !== bFinite) return aFinite ? -1 : 1;
    if (degreeA !== degreeB) return degreeB - degreeA;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });

  return list;
}

function sequenceLayerOrdering(layers, visibleSet) {
  const ordered = [];
  let prevOrderMap = null;

  layers.forEach(layerNodes => {
    const sorted = sortLayerNodes(layerNodes, visibleSet, prevOrderMap);
    ordered.push(sorted);
    prevOrderMap = new Map();
    sorted.forEach((nodeId, index) => prevOrderMap.set(nodeId, index));
  });

  return ordered;
}

function buildHopDistanceLayers(nodeIds, visibleSet) {
  const rootId = getLayeredRootNode(nodeIds, visibleSet);
  if (rootId == null) return [nodeIds];

  const queue = [rootId];
  const visited = new Set([rootId]);
  const layerByNode = new Map([[rootId, 0]]);

  while (queue.length > 0) {
    const current = queue.shift();
    const currentLayer = layerByNode.get(current) || 0;
    const neighbors = FULL_GRAPH.adjacency.get(current);
    if (!neighbors) continue;

    neighbors.forEach(neighborId => {
      if (!visibleSet.has(neighborId) || visited.has(neighborId)) return;
      visited.add(neighborId);
      layerByNode.set(neighborId, currentLayer + 1);
      queue.push(neighborId);
    });
  }

  let maxLayer = 0;
  layerByNode.forEach(layer => {
    if (layer > maxLayer) maxLayer = layer;
  });
  const disconnectedLayer = maxLayer + 1;

  nodeIds.forEach(nodeId => {
    if (!layerByNode.has(nodeId)) layerByNode.set(nodeId, disconnectedLayer);
  });

  const nodesByLayer = new Map();
  nodeIds.forEach(nodeId => {
    const layer = layerByNode.get(nodeId) || 0;
    if (!nodesByLayer.has(layer)) nodesByLayer.set(layer, []);
    nodesByLayer.get(layer).push(nodeId);
  });

  const orderedLayerKeys = Array.from(nodesByLayer.keys()).sort((a, b) => a - b);
  const rawLayers = orderedLayerKeys.map(layer => nodesByLayer.get(layer) || []);
  return sequenceLayerOrdering(rawLayers, visibleSet);
}

function getIdentityLayerRank(identity) {
  const value = String(identity || "").trim().toLowerCase();
  if (value.includes("source")) return 0;
  if (value.includes("entity")) return 1;
  if (value.includes("target")) return 2;
  return 3;
}

function buildIdentityLayers(nodeIds, visibleSet) {
  const nodesByIdentity = new Map();

  nodeIds.forEach(nodeId => {
    const node = FULL_GRAPH.nodes.get(nodeId);
    const identity = String(node?.node_identity || "Unspecified");
    if (!nodesByIdentity.has(identity)) nodesByIdentity.set(identity, []);
    nodesByIdentity.get(identity).push(nodeId);
  });

  const orderedEntries = Array.from(nodesByIdentity.entries()).sort((a, b) => {
    const rankDiff = getIdentityLayerRank(a[0]) - getIdentityLayerRank(b[0]);
    if (rankDiff !== 0) return rankDiff;
    return String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true });
  });

  return sequenceLayerOrdering(orderedEntries.map(([, ids]) => ids), visibleSet);
}

function buildPropertyLayers(nodeIds, visibleSet, layerKey) {
  const key = String(layerKey || "").trim();
  if (!key) return buildHopDistanceLayers(nodeIds, visibleSet);

  const buckets = new Map();
  nodeIds.forEach(nodeId => {
    const node = FULL_GRAPH.nodes.get(nodeId) || {};
    const rawValue = getNodeValue(node, key);
    const isMissing = rawValue == null || String(rawValue).trim() === "";
    const displayValue = isMissing ? "Unspecified" : String(rawValue);
    const numericValue = isMissing ? null : toFiniteNumber(rawValue);
    const bucketKey = displayValue;

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        displayValue,
        numericValue,
        ids: []
      });
    }
    buckets.get(bucketKey).ids.push(nodeId);
  });

  const orderedBuckets = Array.from(buckets.values()).sort((a, b) => {
    const aNumeric = Number.isFinite(a.numericValue);
    const bNumeric = Number.isFinite(b.numericValue);
    if (aNumeric && bNumeric && a.numericValue !== b.numericValue) {
      return a.numericValue - b.numericValue;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return String(a.displayValue).localeCompare(String(b.displayValue), undefined, { numeric: true });
  });

  return sequenceLayerOrdering(orderedBuckets.map(bucket => bucket.ids), visibleSet);
}

function applyLayeredLayout(nodeIds, visibleSet, updates) {
  const mode = normalizeLayerMode(window.currentSettings.layerMode);
  const layerKey = String(window.currentSettings.layerKey || "").trim();
  let layers = [];

  if (mode === "node_identity") {
    layers = buildIdentityLayers(nodeIds, visibleSet);
  } else if (mode === "by_key") {
    layers = buildPropertyLayers(nodeIds, visibleSet, layerKey);
  } else {
    layers = buildHopDistanceLayers(nodeIds, visibleSet);
  }

  const cleanedLayers = layers.filter(layer => Array.isArray(layer) && layer.length > 0);
  if (cleanedLayers.length === 0) return;

  const direction = window.currentSettings.layoutDirection === "LR" ? "LR" : "UD";
  const maxLayerSize = Math.max(...cleanedLayers.map(layer => layer.length), 1);
  const layerGap = Math.max(140, Math.min(320, Math.round(getLayoutRadius(nodeIds.length, 180, 2, 320))));
  const slotGap = Math.max(70, Math.min(200, Math.round(1700 / Math.max(3, maxLayerSize + 1))));
  const primaryStart = -((cleanedLayers.length - 1) * layerGap) / 2;

  cleanedLayers.forEach((layerNodes, layerIndex) => {
    const primaryPosition = primaryStart + (layerIndex * layerGap);
    const secondaryStart = -((layerNodes.length - 1) * slotGap) / 2;

    layerNodes.forEach((nodeId, index) => {
      const secondaryPosition = secondaryStart + (index * slotGap);
      updates.push({
        id: nodeId,
        x: direction === "LR" ? primaryPosition : secondaryPosition,
        y: direction === "LR" ? secondaryPosition : primaryPosition
      });
    });
  });
}

function applyManualLayout(type, { fitToView = true, redraw = true } = {}) {
  if (!network || !isManualLayoutType(type)) return;

  const nodeIds = getVisibleLayoutNodeIds();
  if (nodeIds.length === 0) return;

  const visibleSet = new Set(nodeIds);
  const updates = [];

  if (type === "circle") {
    if (nodeIds.length === 1) {
      updates.push({ id: nodeIds[0], x: 0, y: 0 });
    } else {
      const radius = getLayoutRadius(nodeIds.length, 220, 15, 1600);
      const angleStep = (Math.PI * 2) / nodeIds.length;
      nodeIds.forEach((nodeId, index) => {
        const angle = (-Math.PI / 2) + (index * angleStep);
        updates.push({
          id: nodeId,
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle)
        });
      });
    }
  }

  if (type === "star") {
    const centerId = getLayoutCenterNode(nodeIds, visibleSet);
    if (centerId != null) {
      updates.push({ id: centerId, x: 0, y: 0 });
      const ringNodes = nodeIds.filter(nodeId => nodeId !== centerId);
      const radius = getLayoutRadius(ringNodes.length, 230, 18, 1700);
      const angleStep = ringNodes.length > 0 ? (Math.PI * 2) / ringNodes.length : 0;

      ringNodes.forEach((nodeId, index) => {
        const angle = (-Math.PI / 2) + (index * angleStep);
        updates.push({
          id: nodeId,
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle)
        });
      });
    }
  }

  if (type === "radial") {
    const centerId = getLayoutCenterNode(nodeIds, visibleSet);
    if (centerId != null) {
      const queue = [centerId];
      const visited = new Set([centerId]);
      const layerByNode = new Map([[centerId, 0]]);

      while (queue.length > 0) {
        const current = queue.shift();
        const currentLayer = layerByNode.get(current) || 0;
        const neighbors = FULL_GRAPH.adjacency.get(current);
        if (!neighbors) continue;

        neighbors.forEach(neighborId => {
          if (!visibleSet.has(neighborId) || visited.has(neighborId)) return;
          visited.add(neighborId);
          layerByNode.set(neighborId, currentLayer + 1);
          queue.push(neighborId);
        });
      }

      let maxLayer = 0;
      layerByNode.forEach(layer => {
        if (layer > maxLayer) maxLayer = layer;
      });
      const disconnectedLayer = maxLayer + 1;

      nodeIds.forEach(nodeId => {
        if (!layerByNode.has(nodeId)) {
          layerByNode.set(nodeId, disconnectedLayer);
        }
      });

      const nodesByLayer = new Map();
      nodeIds.forEach(nodeId => {
        const layer = layerByNode.get(nodeId) || 0;
        if (!nodesByLayer.has(layer)) nodesByLayer.set(layer, []);
        nodesByLayer.get(layer).push(nodeId);
      });

      const layerGap = getLayoutRadius(nodeIds.length, 140, 2, 260);
      const sortedLayers = Array.from(nodesByLayer.keys()).sort((a, b) => a - b);

      sortedLayers.forEach(layer => {
        const layerNodes = nodesByLayer.get(layer) || [];
        if (layer === 0) {
          updates.push({ id: layerNodes[0], x: 0, y: 0 });
          return;
        }

        const radius = layer * layerGap;
        const angleStep = layerNodes.length > 0 ? (Math.PI * 2) / layerNodes.length : 0;
        const angleOffset = layer % 2 ? angleStep / 2 : 0;

        layerNodes.forEach((nodeId, index) => {
          const angle = (-Math.PI / 2) + angleOffset + (index * angleStep);
          updates.push({
            id: nodeId,
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle)
          });
        });
      });
    }
  }

  if (type === "grid") {
    const total = nodeIds.length;
    const columns = Math.max(1, Math.ceil(Math.sqrt(total)));
    const rows = Math.max(1, Math.ceil(total / columns));
    const spacingX = Math.max(90, Math.min(260, Math.round(2000 / columns)));
    const spacingY = Math.max(90, Math.min(240, Math.round(1800 / rows)));
    const originX = -((columns - 1) * spacingX) / 2;
    const originY = -((rows - 1) * spacingY) / 2;

    nodeIds.forEach((nodeId, index) => {
      const row = Math.floor(index / columns);
      const col = index % columns;
      updates.push({
        id: nodeId,
        x: originX + (col * spacingX),
        y: originY + (row * spacingY)
      });
    });
  }

  if (type === "spiral") {
    if (nodeIds.length === 1) {
      updates.push({ id: nodeIds[0], x: 0, y: 0 });
    } else {
      const angleStep = Math.PI / 3.2;
      const baseRadius = 14;
      const radiusStep = 9;

      nodeIds.forEach((nodeId, index) => {
        const radius = baseRadius + (index * radiusStep);
        const angle = (-Math.PI / 2) + (index * angleStep);
        updates.push({
          id: nodeId,
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle)
        });
      });
    }
  }

  if (type === "concentric") {
    const rankedNodes = nodeIds
      .map(nodeId => ({ id: nodeId, degree: getVisibleNeighborCount(nodeId, visibleSet) }))
      .sort((a, b) => {
        if (b.degree !== a.degree) return b.degree - a.degree;
        return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
      });

    const ringGap = Math.max(90, Math.min(220, Math.round(getLayoutRadius(nodeIds.length, 180, 2, 320))));
    let cursor = 0;
    let ringIndex = 0;

    while (cursor < rankedNodes.length) {
      const ringCapacity = ringIndex === 0 ? 1 : Math.max(6, ringIndex * 10);
      const ringNodes = rankedNodes.slice(cursor, cursor + ringCapacity);
      if (ringNodes.length === 0) break;

      if (ringIndex === 0) {
        updates.push({ id: ringNodes[0].id, x: 0, y: 0 });
      } else {
        const radius = ringIndex * ringGap;
        const angleStep = (Math.PI * 2) / ringNodes.length;
        const angleOffset = ringIndex % 2 ? 0 : angleStep / 2;

        ringNodes.forEach((entry, index) => {
          const angle = (-Math.PI / 2) + angleOffset + (index * angleStep);
          updates.push({
            id: entry.id,
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle)
          });
        });
      }

      cursor += ringNodes.length;
      ringIndex += 1;
    }
  }

  if (type === "layered") {
    applyLayeredLayout(nodeIds, visibleSet, updates);
  }

  if (updates.length > 0) {
    nodesData.update(updates);
  }

  if (fitToView) {
    network.fit();
  }

  if (redraw) {
    network.redraw();
  }
}

function networkLayoutType(type) {
  if (!network) return;

  const layoutType = type || "default";
  if (layoutType === "hierarchical") {
    network.setOptions({
      layout: {
        hierarchical: {
          enabled: true,
          direction: "UD",
          sortMethod: "directed"
        }
      }
    });
  } else {
    network.setOptions({
      layout: { hierarchical: { enabled: false } }
    });
  }

  const physicsEnabled = enforceCurrentPhysicsState({ forceApply: true });
  applyEdgeSmoothForCurrentPhysics();

  window.currentSettings.layoutType = layoutType;
  updateGraphOption("layout_type", layoutType);

  if (isManualLayoutType(layoutType)) {
    // Keep shape deterministic when applying manual layouts.
    network.stopSimulation();
    applyManualLayout(layoutType, { fitToView: true, redraw: true });
    return;
  }

  if (physicsEnabled) {
    network.stabilize();
  }

  network.fit();
}

function networkLayoutDirection(direction) {
  if (!network) return;
  window.currentSettings.layoutDirection = direction;
  updateGraphOption("layout_direction", direction);

  if (window.currentSettings.layoutType === "layered") {
    network.stopSimulation();
    applyManualLayout("layered", { fitToView: true, redraw: true });
    return;
  }

  network.setOptions({
    layout: { hierarchical: { direction: direction } }
  });

  const physicsEnabled = enforceCurrentPhysicsState({ forceApply: true });
  applyEdgeSmoothForCurrentPhysics();
  if (physicsEnabled) {
    network.stabilize();
  }
}

function networkLayoutSort(sort) {
  if (!network) return;
  network.setOptions({
    layout: { hierarchical: { sortMethod: sort } }
  });

  const physicsEnabled = enforceCurrentPhysicsState({ forceApply: true });
  applyEdgeSmoothForCurrentPhysics();
  if (physicsEnabled) {
    network.stabilize();
  }
  window.currentSettings.sortMethod = sort;
  updateGraphOption("layout_sort", sort);
}

function networkLayerMode(mode) {
  const normalizedMode = normalizeLayerMode(mode);
  window.currentSettings.layerMode = normalizedMode;

  if (window.currentSettings.layoutType === "layered") {
    network.stopSimulation();
    applyManualLayout("layered", { fitToView: true, redraw: true });
  }
}

function networkLayerKey(key) {
  const normalizedKey = key == null ? "" : String(key);
  window.currentSettings.layerKey = normalizedKey;

  if (window.currentSettings.layoutType === "layered" && normalizeLayerMode(window.currentSettings.layerMode) === "by_key") {
    network.stopSimulation();
    applyManualLayout("layered", { fitToView: true, redraw: true });
  }
}

function parseSearchExpression(rawKeyword) {
  const raw = rawKeyword == null ? "" : String(rawKeyword).trim();
  if (!raw) {
    return { mode: "text", textLower: "" };
  }

  const parseNumericLiteral = (value) => {
    const normalized = String(value).trim().replace(/,/g, "");
    if (!normalized) return null;
    const numeric = Number(normalized);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const rangeMatch = raw.match(/^(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)$/);
  if (rangeMatch) {
    const left = parseNumericLiteral(rangeMatch[1]);
    const right = parseNumericLiteral(rangeMatch[2]);
    if (left != null && right != null) {
      return {
        mode: "range",
        min: Math.min(left, right),
        max: Math.max(left, right)
      };
    }
  }

  const cmpMatch = raw.match(/^(>=|<=|>|<|=|==)\s*(-?\d+(?:[.,]\d+)?)$/);
  if (cmpMatch) {
    const op = cmpMatch[1] === "==" ? "=" : cmpMatch[1];
    const target = parseNumericLiteral(cmpMatch[2]);
    if (target != null) {
      return { mode: "compare", op, target };
    }
  }

  const exactNumericMatch = raw.match(/^-?\d+(?:[.,]\d+)?$/);
  if (exactNumericMatch) {
    const target = parseNumericLiteral(exactNumericMatch[0]);
    if (target != null) {
      return { mode: "number_exact", target };
    }
  }

  return { mode: "text", textLower: raw.toLowerCase() };
}

function valueMatchesSearchExpression(value, expression) {
  if (value == null || !expression) return false;

  if (expression.mode === "text") {
    return String(value).toLowerCase().includes(expression.textLower);
  }

  const numeric = typeof value === "number"
    ? (Number.isFinite(value) ? value : null)
    : toFiniteNumber(value);

  if (numeric == null) return false;

  if (expression.mode === "range") {
    return numeric >= expression.min && numeric <= expression.max;
  }

  if (expression.mode === "compare") {
    if (expression.op === ">") return numeric > expression.target;
    if (expression.op === ">=") return numeric >= expression.target;
    if (expression.op === "<") return numeric < expression.target;
    if (expression.op === "<=") return numeric <= expression.target;
    return numeric === expression.target;
  }

  if (expression.mode === "number_exact") {
    return numeric === expression.target;
  }

  return false;
}

function graphSearch({ id, keyword, option, keys, settings }) {
  const postResults = () => {
    window.parent.postMessage({
      type: "graph_search_results",
      payload: { id, nodes: VISIBLE_STATE.nodes.size, edges: VISIBLE_STATE.edges.size }
    }, "*");
  };

  const limitRange = normalizeLimitRange(
    settings?.[2] ?? {
      min: window.currentSettings.limitMin ?? 0,
      max: window.currentSettings.limitMax ?? window.currentSettings.limit ?? 25
    },
    25
  );
  const rangeMin = limitRange.min;
  const rangeMax = limitRange.max;
  const rangeCount = Math.max(1, rangeMax - rangeMin);

  const rawKeyword = keyword == null ? "" : String(keyword).trim();
  const searchExpr = parseSearchExpression(rawKeyword);
  const includeLinked = option === true || option === "true";
  const isNumericExpression = searchExpr.mode === "compare" || searchExpr.mode === "range";
  const allowLinkedExpansion = includeLinked && !isNumericExpression;
  const selectedKeys = Array.isArray(keys)
    ? Array.from(new Set(keys.map(k => String(k || "").trim()).filter(Boolean)))
    : [];

  // Empty search resets back to current limit/sort settings deterministically.
  if (!rawKeyword) {
    applyLimit({
      key: window.currentSettings.sortKey || window.currentSortKey || "",
      sort: window.currentSettings.sortOrder || window.currentSortOrder || "asc",
      amount: { min: rangeMin, max: rangeMax }
    });
    postResults();
    return;
  }

  const matchCap = Math.max(rangeMax, 25) * (allowLinkedExpansion ? 4 : 2);
  const matched = [];
  const skipKeys = new Set(["x", "y", "vx", "vy", "index"]);

  for (const [nodeId, base] of FULL_GRAPH.nodes) {
    const mod = MODIFIED_NODES.get(nodeId) || {};
    const node = { ...base, ...mod };
    let isMatch = false;

    if (selectedKeys.length > 0) {
      for (const key of selectedKeys) {
        const value = node[key];
        if (valueMatchesSearchExpression(value, searchExpr)) {
          isMatch = true;
          break;
        }
      }
    } else {
      for (const [key, value] of Object.entries(node)) {
        if (key.startsWith("_") || skipKeys.has(key)) continue;
        if (valueMatchesSearchExpression(value, searchExpr)) {
          isMatch = true;
          break;
        }
      }
    }

    if (isMatch) {
      matched.push(nodeId);
      if (matched.length >= matchCap) break;
    }
  }

  let resultIds = matched;
  if (allowLinkedExpansion && matched.length > 0) {
    const expanded = new Set(matched);
    for (const nodeId of matched) {
      const neighbors = FULL_GRAPH.adjacency.get(nodeId);
      if (!neighbors) continue;
      for (const neighborId of neighbors) {
        expanded.add(neighborId);
        if (expanded.size >= matchCap) break;
      }
      if (expanded.size >= matchCap) break;
    }
    resultIds = Array.from(expanded);
  }

  window.currentSettings.limit = rangeCount;
  window.currentSettings.limitMin = rangeMin;
  window.currentSettings.limitMax = rangeMax;
  VISIBLE_STATE.limit = rangeCount;
  VISIBLE_STATE.limitMin = rangeMin;
  VISIBLE_STATE.limitMax = rangeMax;

  VISIBLE_STATE.nodes.clear();
  VISIBLE_STATE.edges.clear();
  const end = Math.min(rangeMax, resultIds.length);
  for (let i = rangeMin; i < end; i++) {
    VISIBLE_STATE.nodes.add(resultIds[i]);
  }

  window.lastSearchContext = {
    keyword: rawKeyword,
    option: allowLinkedExpansion,
    keys: selectedKeys,
    matchedNodes: resultIds
  };

  recomputeVisibleEdges();
  renderVisibleGraphBatch();

  if (VISIBLE_STATE.nodes.size === 0) {
    alert("No Result Found!");
  }
  postResults();
}

async function exportGraph(type) {
  try {
    const graphData = {
      type: "Graph",
      nodes: window.nodesData.get(),
      edges: window.edgesData.get()
    };

    // grab current runtime options
    const networkOptions = window.currentOptions;

    const suggestedName = `LinkxGraph_export_${Date.now()}.${type}`;
    let blob;

    if (type === "json") {
      blob = new Blob(
        [JSON.stringify({ graphData, networkOptions }, null, 2)],
        { type: "application/json" }
      );

    } else if (type === "html") {
      const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Linkx Graph</title>
        <script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script>
      </head>
      <body>
        <div id="mynetwork" style="width:100%; height:100vh;"></div>
        <script>
          const { graphData, networkOptions } = ${JSON.stringify({ graphData, networkOptions }, null, 2)};
          const nodesData = new vis.DataSet(graphData.nodes);
          const edgesData = new vis.DataSet(graphData.edges);
          const container = document.getElementById('mynetwork');
          const data = { nodes: nodesData, edges: edgesData };
          const network = new vis.Network(container, data, networkOptions);
        </script>
      </body>
      </html>`;
      blob = new Blob([html], { type: "text/html" });

    } else {
      console.warn("Unsupported export type:", type);
      return;
    }

    // Always trigger a browser download (shows in Downloads)
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log("Graph downloaded via browser:", suggestedName);

  } catch (err) {
    console.error("Error exporting graph:", err);
  }
}

async function loadGraphFromFile(id,file,settings = null) {
  try {
    if (!file || !(file instanceof Blob)) {
      alert("Please select a valid graph file (JSON or HTML).");
      return;
    }

    // Determine file extension safely
    const ext = file.name ? file.name.split(".").pop().toLowerCase() : "";
    let text = (await file.text()).trim(); // remove whitespace/BOM

    let graphData = { nodes: [], edges: [] };
    let networkOptions = {};
    if (ext === "json") {
      const parsed = JSON.parse(text);
      if (
        parsed.graphData &&
        Array.isArray(parsed.graphData.nodes) &&
        Array.isArray(parsed.graphData.edges)
      ) {
        graphData = parsed.graphData;
        networkOptions = parsed.networkOptions || {};
      } else if (
        Array.isArray(parsed.nodes) &&
        Array.isArray(parsed.edges)
      ) {
        graphData = parsed;
        networkOptions = parsed.networkOptions || {};
      } else {
        throw new Error("This JSON file does not contain a valid graph.");
      }

    } else if (ext === "html") {
      // Look for embedded JSON in <script>
      const match = text.match(
        /const\s+\{\s*graphData\s*,\s*networkOptions\s*\}\s*=\s*(\{[\s\S]*?\});/
      );

      if (match) {
        const parsed = JSON.parse(match[1]);
        graphData = parsed.graphData || { nodes: [], edges: [] };
        networkOptions = parsed.networkOptions || {};
      } else {
        throw new Error("Could not extract graph data from HTML file.");
      }

    } else {
      throw new Error("Unsupported file type: " + ext);
    }

    // Validate final nodes/edges arrays
    if (!Array.isArray(graphData.nodes) || !Array.isArray(graphData.edges)) {
      throw new Error("Graph data must contain nodes and edges arrays.");
    }

    // Apply the graph
    createNewGraph({
      id,
      nodes: graphData.nodes,
      edges: graphData.edges,
      options: networkOptions,
      settings: Array.isArray(settings) ? settings : null
    });
    //Passing property keys
    getAllNodeKeys(id);
    console.log("Graph loaded successfully1");

  } catch (err) {
    console.error("Error loading graph file:", err);
    alert(
      "Failed to load graph file. It may be corrupted or invalid.\n" +
        err.message
    );
  }
}

//Save function here

function captureGraphSnapshot(filename = `LinkxGraph_snapshot_${Date.now()}.png`) {
  try {
    if (!network || !network.canvas || !network.canvas.frame) {
      alert("Graph is not ready to capture.");
      return;
    }

    // Check if graph is empty
    if (!network.body || !network.body.data || network.body.data.nodes.length === 0) {
      alert("Graph is empty. Nothing to capture.");
      return;
    }

    // Get PNG data URL of the current view
    const dataUrl = network.canvas.frame.canvas.toDataURL("image/png");

    // Trigger download
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    a.click();

    console.log("Graph snapshot saved:", filename);
  } catch (err) {
    console.error("Error capturing graph snapshot:", err);
    alert("Could not capture the graph snapshot.");
  }
}

function printGraph() {
  const canvas = document.querySelector("#mynetwork canvas");

  if (!canvas) {
    alert("Graph canvas not found.");
    return;
  }

  // Check if graph is empty
  if (!network.body || !network.body.data || network.body.data.nodes.length === 0) {
    alert("Graph is empty. Nothing to print.");
    return;
  }

  const dataUrl = canvas.toDataURL("image/png");

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`
    <html>
      <head>
        <title>Print Graph</title>
        <style>
          body { margin: 0; text-align: center; }
          img { max-width: 100%; height: auto; }
        </style>
      </head>
      <body>
        <img src="${dataUrl}" alt="Graph Snapshot"/>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function resetGraph(settings) {
  queueGraphHistoryCapture();
  MODIFIED_NODES.clear();
  MODIFIED_EDGES.clear();
  if (Array.isArray(settings)) {
    restoreSettings(settings);
    return;
  }
  applyLimit({ amount: 25 });
}

function fit_graph(){
  if(nodesData.length>0){
    network.fit()
  }
}

function getNetworkComponents(payload){
  // Post message with window id 
  window.parent.postMessage(
    {
      type: "network_components",
      payload: {
        id: payload,          // include the window ID
        nodes: nodesData.get(),
        edges: edgesData.get()
      }
    },
    "*"
  );
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function identityColor(identity) {
  const normalized = String(identity || "Unspecified").toLowerCase();
  if (normalized === "source node" || normalized === "source") return "#0ea5e9";
  if (normalized === "target node" || normalized === "target") return "#f59e0b";
  if (normalized === "entity node" || normalized === "entity") return "#4f46e5";
  if (normalized === "unspecified") return "#6b7280";

  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

function numberFormat(value) {
  const safe = Number(value);
  return Number.isFinite(safe) ? safe.toLocaleString() : "0";
}

const REPORT_LOGO_SRC = "../site_images/Linkx square (1024x1024).png";
const REPORT_WATERMARK_SRC = "../site_images/Logo_of_Ethiopian_INSA.png";

function normalizeReportIdentity(identity) {
  const raw = String(identity || "").trim();
  const normalized = raw.toLowerCase();
  if (normalized === "source node" || normalized === "source") return "Source";
  if (normalized === "target node" || normalized === "target") return "Target";
  if (normalized === "entity node" || normalized === "entity") return "Entity";
  if (!raw) return "Unspecified";
  return raw;
}

function buildGraphReportData(payload) {
  const sourceWindowId = payload?.id || null;
  const visibleNodes = nodesData.get();
  const visibleEdges = edgesData.get();
  const selectedNodeIds = network?.getSelectedNodes?.() || [];
  const selectedEdgeIds = network?.getSelectedEdges?.() || [];

  const relationshipCounter = new Map();
  const nodeIdentityCounter = new Map();
  const degreeCounter = new Map();
  const nodeLookup = new Map();

  for (const node of visibleNodes) {
    const key = String(node.id);
    nodeLookup.set(key, node);
    degreeCounter.set(key, 0);

    const identity = normalizeReportIdentity(node.node_identity || "Unspecified");
    nodeIdentityCounter.set(identity, (nodeIdentityCounter.get(identity) || 0) + 1);
  }

  for (const edge of visibleEdges) {
    const relType = edge.rel_type || edge.type || edge.label || "Unspecified";
    relationshipCounter.set(relType, (relationshipCounter.get(relType) || 0) + 1);

    const fromKey = String(edge.from);
    const toKey = String(edge.to);
    degreeCounter.set(fromKey, (degreeCounter.get(fromKey) || 0) + 1);
    degreeCounter.set(toKey, (degreeCounter.get(toKey) || 0) + 1);
  }

  const topNodesByDegree = Array.from(degreeCounter.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([nodeId, degree]) => {
      const node = nodeLookup.get(nodeId) || {};
      return {
        id: nodeId,
        label: node.label || "",
        identity: normalizeReportIdentity(node.node_identity || "Unspecified"),
        degree
      };
    });

  const nodeCount = visibleNodes.length;
  const edgeCount = visibleEdges.length;
  const density = nodeCount > 1
    ? ((2 * edgeCount) / (nodeCount * (nodeCount - 1))) * 100
    : 0;
  const averageDegree = nodeCount > 0 ? (2 * edgeCount) / nodeCount : 0;

  return {
    sourceWindowId,
    generatedAt: new Date().toLocaleString(),
    visibleNodes: nodeCount,
    visibleEdges: edgeCount,
    totalNodes: FULL_GRAPH.nodes.size,
    totalEdges: FULL_GRAPH.edges.size,
    selectedNodes: selectedNodeIds.length,
    selectedEdges: selectedEdgeIds.length,
    averageDegree,
    densityPercent: density,
    relationshipTypes: Array.from(relationshipCounter.entries()).map(([type, count]) => ({ type, count })),
    nodeIdentityDistribution: Array.from(nodeIdentityCounter.entries()).map(([identity, count]) => ({ identity, count })),
    topNodesByDegree
  };
}

function loadImageAsDataUrl(src, options = {}) {
  return new Promise(resolve => {
    if (!src) {
      resolve(null);
      return;
    }

    const alpha = typeof options.alpha === "number"
      ? Math.max(0, Math.min(1, options.alpha))
      : 1;
    const maxSide = Number(options.maxSide) > 0 ? Number(options.maxSide) : 0;

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const sourceWidth = img.naturalWidth || img.width;
        const sourceHeight = img.naturalHeight || img.height;
        const sourceMax = Math.max(sourceWidth, sourceHeight) || 1;
        const scale = maxSide > 0 ? Math.min(1, maxSide / sourceMax) : 1;
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        ctx.globalAlpha = alpha;
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        resolve(canvas.toDataURL("image/png"));
      } catch (_err) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function getGraphSnapshotDataUrl() {
  try {
    const canvas = network?.canvas?.frame?.canvas || document.querySelector("#mynetwork canvas");
    if (!canvas) return null;
    return canvas.toDataURL("image/png");
  } catch (_err) {
    return null;
  }
}

function colorToRgb(color) {
  const fallback = { r: 235, g: 238, b: 243 };
  const value = String(color || "").trim();

  if (/^#([0-9a-f]{3})$/i.test(value)) {
    const hex = value.slice(1);
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16)
    };
  }

  if (/^#([0-9a-f]{6})$/i.test(value)) {
    return {
      r: parseInt(value.slice(1, 3), 16),
      g: parseInt(value.slice(3, 5), 16),
      b: parseInt(value.slice(5, 7), 16)
    };
  }

  const hslMatch = value.match(/^hsl\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)%\s*,\s*(\d+(?:\.\d+)?)%\s*\)$/i);
  if (hslMatch) {
    const h = ((Number(hslMatch[1]) % 360) + 360) % 360;
    const s = Number(hslMatch[2]) / 100;
    const l = Number(hslMatch[3]) / 100;
    const c = (1 - Math.abs((2 * l) - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - (c / 2);

    let rp = 0;
    let gp = 0;
    let bp = 0;
    if (h < 60) { rp = c; gp = x; bp = 0; }
    else if (h < 120) { rp = x; gp = c; bp = 0; }
    else if (h < 180) { rp = 0; gp = c; bp = x; }
    else if (h < 240) { rp = 0; gp = x; bp = c; }
    else if (h < 300) { rp = x; gp = 0; bp = c; }
    else { rp = c; gp = 0; bp = x; }

    return {
      r: Math.round((rp + m) * 255),
      g: Math.round((gp + m) * 255),
      b: Math.round((bp + m) * 255)
    };
  }

  return fallback;
}

function lighterRgb(color, factor = 0.84) {
  const rgb = colorToRgb(color);
  const mix = Math.max(0, Math.min(1, factor));
  return {
    r: Math.round(rgb.r + (255 - rgb.r) * mix),
    g: Math.round(rgb.g + (255 - rgb.g) * mix),
    b: Math.round(rgb.b + (255 - rgb.b) * mix)
  };
}

function ensureJsPdf() {
  if (window.jspdf && window.jspdf.jsPDF) {
    return Promise.resolve(window.jspdf.jsPDF);
  }

  if (window.__linkxJsPdfLoader) {
    return window.__linkxJsPdfLoader;
  }

  const sources = [
    "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
    "https://unpkg.com/jspdf@2.5.1/dist/jspdf.umd.min.js"
  ];

  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  window.__linkxJsPdfLoader = (async () => {
    for (const src of sources) {
      try {
        await loadScript(src);
        if (window.jspdf && window.jspdf.jsPDF) {
          return window.jspdf.jsPDF;
        }
      } catch (_err) {
        // Try next source.
      }
    }
    throw new Error("jsPDF loader failed");
  })().catch(err => {
    window.__linkxJsPdfLoader = null;
    throw err;
  });

  return window.__linkxJsPdfLoader;
}

function ensureHtml2Canvas() {
  if (window.html2canvas) {
    return Promise.resolve(window.html2canvas);
  }

  if (window.__linkxHtml2CanvasLoader) {
    return window.__linkxHtml2CanvasLoader;
  }

  const sources = [
    "https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js",
    "https://unpkg.com/html2canvas@1.4.1/dist/html2canvas.min.js"
  ];

  const loadScript = src => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });

  window.__linkxHtml2CanvasLoader = (async () => {
    for (const src of sources) {
      try {
        await loadScript(src);
        if (window.html2canvas) {
          return window.html2canvas;
        }
      } catch (_err) {
        // Try next source.
      }
    }
    throw new Error("html2canvas loader failed");
  })().catch(err => {
    window.__linkxHtml2CanvasLoader = null;
    throw err;
  });

  return window.__linkxHtml2CanvasLoader;
}

function waitForFrames(frameCount = 2) {
  return new Promise(resolve => {
    let count = Math.max(1, Number(frameCount) || 1);
    const tick = () => {
      count -= 1;
      if (count <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function renderReportCanvasFromTemplate(report) {
  const html2canvasRef = await ensureHtml2Canvas();
  const iframe = document.createElement("iframe");
  iframe.src = "../temp_placeholders/graph_reports.html";
  iframe.style.position = "fixed";
  iframe.style.left = "-12000px";
  iframe.style.top = "0";
  iframe.style.width = "1040px";
  iframe.style.height = "1800px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Report template load timeout")), 5000);
      iframe.onload = () => {
        clearTimeout(timeout);
        resolve(true);
      };
    });

    if (!iframe.contentWindow || !iframe.contentDocument) {
      throw new Error("Report template iframe is unavailable");
    }

    iframe.contentWindow.postMessage({ action: "graph_report", payload: report }, "*");
    await waitForFrames(3);

    const root = iframe.contentDocument.querySelector(".report_container") || iframe.contentDocument.body;
    if (!root) {
      throw new Error("Report template root not found");
    }

    const canvas = await html2canvasRef(root, {
      scale: 2,
      useCORS: true,
      backgroundColor: "#fcfefd",
      logging: false
    });
    return canvas;
  } finally {
    iframe.remove();
  }
}

function downloadPdfViaBlobUrl(doc, filename) {
  try {
    const blob = doc.output("blob");
    if (!blob) return false;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    return true;
  } catch (_err) {
    return false;
  }
}

async function downloadGraphReport(report) {
  let JsPdfConstructor = null;
  try {
    JsPdfConstructor = await ensureJsPdf();
  } catch (err) {
    console.error("Report PDF generation failed: jsPDF unavailable.", err);
    alert("Could not generate report PDF. jsPDF library is not available.");
    return;
  }

  const doc = new JsPdfConstructor({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true
  });
  const filename = `LinkxInvestigation_report_${Date.now()}.pdf`;

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Preferred path: render the same HTML report template into PDF for higher visual fidelity.
  try {
    const templateCanvas = await renderReportCanvasFromTemplate(report);
    if (templateCanvas?.width > 0 && templateCanvas?.height > 0) {
      const marginPdf = 22;
      const maxWidth = pageWidth - (marginPdf * 2);
      const maxHeight = pageHeight - (marginPdf * 2);
      const ratio = Math.min(maxWidth / templateCanvas.width, maxHeight / templateCanvas.height);
      const drawWidth = templateCanvas.width * ratio;
      const drawHeight = templateCanvas.height * ratio;
      const drawX = (pageWidth - drawWidth) / 2;
      const drawY = marginPdf;
      const imageData = templateCanvas.toDataURL("image/png");
      doc.addImage(imageData, "PNG", drawX, drawY, drawWidth, drawHeight, undefined, "FAST");
      const savedByBlobPreferred = downloadPdfViaBlobUrl(doc, filename);
      if (!savedByBlobPreferred) {
        doc.save(filename);
      }
      return;
    }
  } catch (err) {
    console.warn("HTML template PDF rendering failed. Falling back to manual PDF layout.", err);
  }

  const margin = 34;
  const contentWidth = pageWidth - (margin * 2);
  const footerLimit = pageHeight - margin;
  let y = margin;

  const [logoDataUrl, watermarkDataUrl] = await Promise.all([
    loadImageAsDataUrl(REPORT_LOGO_SRC, { maxSide: 220 }),
    loadImageAsDataUrl(REPORT_WATERMARK_SRC, { alpha: 0.065, maxSide: 900 })
  ]);

  const drawPageDecorations = () => {
    if (watermarkDataUrl) {
      const wmSize = Math.min(contentWidth * 0.68, 320);
      const wmX = (pageWidth - wmSize) / 2;
      const wmY = (pageHeight - wmSize) / 2;
      try {
        doc.addImage(watermarkDataUrl, "PNG", wmX, wmY, wmSize, wmSize);
      } catch (_err) {
        // Keep report generation robust if watermark fails.
      }
    }

    doc.setDrawColor(232, 236, 242);
    doc.setLineWidth(0.7);
    doc.line(margin, margin - 8, pageWidth - margin, margin - 8);
    doc.line(margin, pageHeight - margin + 8, pageWidth - margin, pageHeight - margin + 8);
  };

  drawPageDecorations();

  const ensureSpace = neededHeight => {
    if ((y + neededHeight) <= footerLimit) return;
    doc.addPage();
    y = margin;
    drawPageDecorations();
  };

  const drawSectionTitle = title => {
    ensureSpace(24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(33, 57, 79);
    doc.text(String(title), margin, y);
    doc.setDrawColor(212, 220, 229);
    doc.setLineWidth(0.9);
    doc.line(margin + 118, y - 3, pageWidth - margin, y - 3);
    y += 11;
  };

  const drawList = (rows, formatter, emptyText = "No data found.") => {
    if (!Array.isArray(rows) || rows.length === 0) {
      ensureSpace(12);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.8);
      doc.setTextColor(106, 111, 118);
      doc.text(String(emptyText), margin + 2, y);
      y += 12;
      return;
    }

    for (const row of rows) {
      const text = String(formatter(row));
      const lines = doc.splitTextToSize(text, contentWidth - 18);
      for (const line of lines) {
        ensureSpace(12);
        doc.setFillColor(190, 198, 208);
        doc.circle(margin + 4, y - 2.5, 1.2, "F");
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.8);
        doc.setTextColor(58, 63, 69);
        doc.text(line, margin + 10, y);
        y += 12;
      }
    }
  };

  const headerHeight = 72;
  ensureSpace(headerHeight + 8);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y - 2, contentWidth, headerHeight, 7, 7, "F");

  const logoSize = logoDataUrl ? 38 : 0;
  const logoX = margin + 10;
  const logoY = y + 12;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoSize, logoSize);
    } catch (_err) {
      // Keep report generation robust even if logo image fails.
    }
  }

  const titleStartX = margin + (logoSize ? 58 : 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.8);
  doc.setTextColor(105, 113, 122);
  doc.text("CONFIDENTIAL INVESTIGATION", titleStartX, y + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15.5);
  doc.setTextColor(31, 58, 85);
  doc.text("Linkx Investigation Report", titleStartX, y + 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  doc.setTextColor(97, 103, 110);
  doc.text(`Case Reference: INV-${String(report.sourceWindowId ?? "-")}`, titleStartX, y + 43);
  doc.text(`Source Window: ${String(report.sourceWindowId ?? "-")}`, titleStartX, y + 50);
  doc.text(`Generated At: ${String(report.generatedAt ?? "-")}`, titleStartX, y + 57);

  y += headerHeight + 8;
  doc.setDrawColor(218, 226, 235);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 12;

  if (report.graphSnapshotDataUrl) {
    drawSectionTitle("Evidence Snapshot");
    ensureSpace(248);

    const maxWidth = contentWidth - 20;
    const maxHeight = 212;
    let imageWidth = maxWidth;
    let imageHeight = maxHeight;

    try {
      const imageProps = doc.getImageProperties(report.graphSnapshotDataUrl);
      if (imageProps && imageProps.width > 0 && imageProps.height > 0) {
        imageHeight = (maxWidth * imageProps.height) / imageProps.width;
        if (imageHeight > maxHeight) {
          imageHeight = maxHeight;
          imageWidth = (maxHeight * imageProps.width) / imageProps.height;
        }
      }
    } catch (_err) {
      imageWidth = maxWidth;
      imageHeight = maxHeight;
    }

    const frameX = margin + 10;
    const frameY = y - 4;
    const frameWidth = contentWidth - 20;
    const frameHeight = imageHeight + 10;
    const imageX = margin + ((contentWidth - imageWidth) / 2);
    doc.setFillColor(250, 251, 253);
    doc.roundedRect(frameX, frameY, frameWidth, frameHeight, 5, 5, "F");
    doc.setDrawColor(217, 224, 233);
    doc.setLineWidth(0.75);
    doc.roundedRect(frameX, frameY, frameWidth, frameHeight, 5, 5, "S");
    try {
      doc.addImage(report.graphSnapshotDataUrl, "PNG", imageX, y, imageWidth, imageHeight);
    } catch (_err) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.8);
      doc.setTextColor(110, 113, 117);
      doc.text("Graph snapshot is unavailable for this report.", margin, y + 14);
      imageHeight = 18;
    }
    y += imageHeight + 16;
  }

  drawSectionTitle("Investigation Snapshot");
  const summaryRows = [
    ["Observed Entities", numberFormat(report.visibleNodes)],
    ["Observed Relationships", numberFormat(report.visibleEdges)],
    ["Total Entities", numberFormat(report.totalNodes)],
    ["Total Relationships", numberFormat(report.totalEdges)],
    ["Focused Entities", numberFormat(report.selectedNodes)],
    ["Focused Relationships", numberFormat(report.selectedEdges)],
    ["Connectivity Index", Number(report.averageDegree || 0).toFixed(2)],
    ["Density", `${Number(report.densityPercent || 0).toFixed(2)}%`]
  ];

  const summaryGap = 10;
  const summaryCardWidth = (contentWidth - summaryGap) / 2;
  const summaryCardHeight = 26;
  const summaryRowsPerColumn = Math.ceil(summaryRows.length / 2);
  const summarySectionHeight = (summaryRowsPerColumn * (summaryCardHeight + 6)) + 4;
  ensureSpace(summarySectionHeight);

  for (let i = 0; i < summaryRows.length; i += 1) {
    const [key, value] = summaryRows[i];
    const col = i % 2;
    const row = Math.floor(i / 2);
    const cardX = margin + (col * (summaryCardWidth + summaryGap));
    const cardY = y + (row * (summaryCardHeight + 6));

    doc.setFillColor(248, 250, 252);
    doc.roundedRect(cardX, cardY, summaryCardWidth, summaryCardHeight, 4, 4, "F");
    doc.setDrawColor(223, 229, 237);
    doc.setLineWidth(0.6);
    doc.roundedRect(cardX, cardY, summaryCardWidth, summaryCardHeight, 4, 4, "S");

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.7);
    doc.setTextColor(112, 118, 126);
    doc.text(String(key).toUpperCase(), cardX + 8, cardY + 10);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.1);
    doc.setTextColor(44, 49, 54);
    doc.text(String(value), cardX + 8, cardY + 20);
  }
  y += summarySectionHeight + 3;

  drawSectionTitle("Relationship Breakdown");
  drawList(
    report.relationshipTypes,
    item => `${item.type}: ${numberFormat(item.count)}`,
    "No relationship types found."
  );
  y += 4;

  drawSectionTitle("Entity Distribution");
  drawList(
    report.nodeIdentityDistribution,
    item => `${item.identity}: ${numberFormat(item.count)}`,
    "No node identities found."
  );
  y += 4;

  drawSectionTitle("Priority Entities");
  if (!Array.isArray(report.topNodesByDegree) || report.topNodesByDegree.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.setTextColor(90, 90, 90);
    doc.text("No nodes found.", margin + 2, y);
    y += 12;
  } else {
    const rowHeight = 16;
    for (const item of report.topNodesByDegree) {
      ensureSpace(rowHeight + 2);
      const label = item.label && String(item.label).trim() !== ""
        ? String(item.label)
        : String(item.id);
      const identity = String(item.identity || "Unspecified");
      const degree = numberFormat(item.degree);
      const rowRgb = lighterRgb(identityColor(identity), 0.9);

      doc.setFillColor(rowRgb.r, rowRgb.g, rowRgb.b);
      doc.roundedRect(margin, y - 10, contentWidth, rowHeight, 3, 3, "F");

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.7);
      doc.setTextColor(44, 44, 44);
      doc.text(`${label} (degree: ${degree})`, margin + 8, y);

      doc.setTextColor(88, 88, 88);
      doc.text(identity, pageWidth - margin - 8, y, { align: "right" });
      y += rowHeight;
    }
  }
  y += 0;

  drawSectionTitle("Investigation Summary");
  const remarkStatus = (() => {
    const visibleNodes = Number(report.visibleNodes) || 0;
    const visibleEdges = Number(report.visibleEdges) || 0;
    const selectedNodes = Number(report.selectedNodes) || 0;
    if (visibleNodes <= 0) return "No Observable Activity";
    if (visibleEdges <= 0) return "Entity-Only Activity";
    if (selectedNodes > 0) return "Focused Examination";
    const ratio = visibleNodes > 0 ? (visibleEdges / visibleNodes) : 0;
    if (ratio >= 2.5) return "High Relationship Density";
    if (ratio >= 1.2) return "Moderate Relationship Density";
    return "Low Relationship Density";
  })();

  const remarkText = `Based on the current graph scope, the investigation indicates ${numberFormat(report.visibleNodes)} observed entities connected through ${numberFormat(report.visibleEdges)} relationships. The network shows a density of ${Number(report.densityPercent || 0).toFixed(2)}% with a connectivity index of ${Number(report.averageDegree || 0).toFixed(2)}. Current focus includes ${numberFormat(report.selectedNodes)} selected entities. Overall assessment status: ${remarkStatus}. This remark is generated from the active analytical snapshot and should be reviewed together with the detailed findings before final case submission.`;
  const remarkLines = doc.splitTextToSize(remarkText, contentWidth - 4);
  for (const line of remarkLines) {
    ensureSpace(12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.setTextColor(58, 63, 69);
    doc.text(line, margin + 2, y);
    y += 11;
  }
  y += 4;

  drawSectionTitle("Investigator Remark");
  ensureSpace(92);
  doc.setDrawColor(223, 229, 237);
  doc.setLineWidth(0.6);
  doc.roundedRect(margin, y - 8, contentWidth, 82, 4, 4, "S");
  doc.setDrawColor(235, 239, 244);
  for (let lineY = y + 10; lineY <= y + 66; lineY += 14) {
    doc.line(margin + 8, lineY, pageWidth - margin - 8, lineY);
  }
  y += 86;

  ensureSpace(14);
  doc.setDrawColor(223, 229, 237);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;
  const signatureRightStartX = margin + (contentWidth * 0.6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.6);
  doc.setTextColor(44, 49, 54);
  doc.text("Investigator Name", margin + 2, y);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(61, 83, 107);
  doc.text("Inverstigator", margin + 92, y);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(44, 49, 54);
  doc.text("Signature", signatureRightStartX, y);
  doc.setFont("helvetica", "normal");
  const signatureLineStartX = signatureRightStartX + 44;
  const signatureLineEndX = Math.min(signatureLineStartX + 128, pageWidth - margin - 2);
  doc.setDrawColor(120, 135, 151);
  doc.line(signatureLineStartX, y + 1, signatureLineEndX, y + 1);
  doc.text("-", signatureLineStartX + 4, y);

  const savedByBlob = downloadPdfViaBlobUrl(doc, filename);
  if (!savedByBlob) {
    doc.save(filename);
  }
}

async function generateGraphReport(payload) {
  const report = buildGraphReportData(payload);
  report.graphSnapshotDataUrl = getGraphSnapshotDataUrl();
  await downloadGraphReport(report);
}

function getNodeValue(node, key) {
  if (typeof key !== "string" || key.trim() === "") return null;
  const normalizedKey = key.trim().toLowerCase();

  const actualKey = Object.keys(node).find(
    k => k.toLowerCase() === normalizedKey
  );
  return actualKey ? node[actualKey] : null;
}
let n=0
function labelNodesWith({ labelIdentity, labelkey, filterKey, filterSort = "asc", limitAmount = 25 }) {
  console.log("to update labels of:",labelIdentity)
  if (!labelkey) return;

  // Validate labelIdentity and provide fallback
  const validIdentities = ["Entity Node", "Source Node", "Target Node"];
  const identityToUse = validIdentities.includes(labelIdentity) ? labelIdentity : "Entity Node";

  for (const [id, node] of FULL_GRAPH.nodes) {
    // Only label nodes with matching node_identity
    if (node.node_identity === identityToUse) {
      const value = node[labelkey];
      if (value != null) {
        MODIFIED_NODES.set(id, {
          ...(MODIFIED_NODES.get(id) || {}),
          label: String(value)
        });
      }
    }
  }
  window.currentSettings.showLabels = true;
  const limitRange = normalizeLimitRange(limitAmount, 25);

  applyLimit({
    key: filterKey || "",
    sort: filterSort,
    amount: limitRange
  });
}

function initializer(id){
  // Optional: apply default settings (like labels/limits)
  let defaultLimit = 25;
  applyLimit({key:"",sort:"asc",amount:defaultLimit});
  getAllNodeKeys(id);
  network.fit();
  network.redraw();
}

function createNewGraph({ id, nodes = [], edges = [], settings = null }) {
  console.log("yooo")
  resetGraphHistoryBuffer();
  suspendGraphHistoryStart();
  try {
  // Reset visible graph
  nodesData.clear();
  edgesData.clear();

  if (window.__alertScanTimer) {
    clearTimeout(window.__alertScanTimer);
    window.__alertScanTimer = null;
  }
  if (window.PATH_HIGHLIGHT_STATE) {
    window.PATH_HIGHLIGHT_STATE.nodeIds.clear();
    window.PATH_HIGHLIGHT_STATE.edgeIds.clear();
  }
  if (window.ALERT_HIGHLIGHT_STATE) {
    window.ALERT_HIGHLIGHT_STATE.nodeIds.clear();
    window.ALERT_HIGHLIGHT_STATE.edgeIds.clear();
  }
  if (window.EDGE_BUNDLING_STATE) {
    clearEdgeBundlingLite();
    window.EDGE_BUNDLING_STATE.enabled = !!window.currentSettings?.edgeBundling;
  }

  // Reset modification state
  MODIFIED_NODES.clear();
  MODIFIED_EDGES.clear();

  // Build FULL_GRAPH from the provided data
  console.log("Initializing FullGraph...");
  FULL_GRAPH.edgesByNode = null;
  initializeFullGraph({ nodes, edges });

  // Optional: any iframe / parent init logic
  initializer?.(id);

  if (Array.isArray(settings)) {
    restoreSettings(settings);
  }
  } finally {
    suspendGraphHistoryEnd();
  }
}

function renderVisibleGraphBatch() {
    const renderStart = performance.now();
    if (!window.limitOverridden && VISIBLE_STATE.nodes.size > window.currentSettings.limit) {
      // Trim to limit
      const nodesArray = Array.from(VISIBLE_STATE.nodes);
      VISIBLE_STATE.nodes.clear();
      for (let i = 0; i < window.currentSettings.limit; i++) {
          VISIBLE_STATE.nodes.add(nodesArray[i]);
      }
      recomputeVisibleEdges();
    }

    const desiredNodeIds = new Set(VISIBLE_STATE.nodes);
    const desiredEdgeIds = new Set(VISIBLE_STATE.edges);
    updatePerformancePhysicsGuard(desiredNodeIds.size);
    const markerSets = getMarkerSets();

    const currentNodeIds = new Set(nodesData.getIds());
    const currentEdgeIds = new Set(edgesData.getIds());

    // Remove elements that are no longer visible.
    const edgesToRemove = [];
    currentEdgeIds.forEach(id => {
      if (!desiredEdgeIds.has(id)) edgesToRemove.push(id);
    });
    if (edgesToRemove.length > 0) {
      edgesData.remove(edgesToRemove);
    }

    const nodesToRemove = [];
    currentNodeIds.forEach(id => {
      if (!desiredNodeIds.has(id)) nodesToRemove.push(id);
    });
    if (nodesToRemove.length > 0) {
      nodesData.remove(nodesToRemove);
    }

    // Add/update visible nodes progressively.
    const nodeBatch = [];
    for (const id of desiredNodeIds) {
      const base = FULL_GRAPH.nodes.get(id);
      if (!base) continue;

      const mod = MODIFIED_NODES.get(id) || {};
      const merged = { ...base, ...mod };

      const annotationType = String(merged.annotationType || "").toLowerCase();
      if (annotationType === "ole_object") {
        merged.shape = "image";
        const currentImage = String(merged.image || "").trim();
        const isLegacyDocIcon =
          currentImage.includes("Document 1.svg") ||
          currentImage.includes("Document%201.svg");
        if (!currentImage || isLegacyDocIcon) {
          merged.image = getOleObjectIconPath();
        }
        merged.borderWidth = 0;
        merged.borderWidthSelected = 0;
        merged.font = {
          ...(merged.font || {}),
          color: (merged.font && merged.font.color) ? merged.font.color : "#6d28d9"
        };
        merged.shadow = merged.shadow || {
          enabled: true,
          color: `rgba(124,58,237,0.32)`,
          size: 10,
          x: 0,
          y: 0
        };
      } else if (merged.shape === "image" && (!merged.image || String(merged.image).trim() === "")) {
        merged.image = getOleObjectIconPath();
      }

      if (window.currentSettings.showTitles && FULL_GRAPH.nodes.size < 5000) {
        merged.title = generateNodeTitleSafely(merged);
      } else {
        merged.title = undefined;
      }

      merged.label = getNodeRenderLabel(base, mod, window.currentSettings.showLabels);
      applyNodeStateDecorations(merged, id, markerSets);

      // Keep analyst focus stable: do not reset already-rendered node coordinates.
      if (currentNodeIds.has(id)) {
        delete merged.x;
        delete merged.y;
        delete merged.vx;
        delete merged.vy;
      }

      nodeBatch.push(merged);
    }
    if (nodeBatch.length > 0) {
      nodesData.update(nodeBatch);
    }

    // Add/update visible edges progressively.
    const edgeBatch = [];
    for (const id of desiredEdgeIds) {
      const base = FULL_GRAPH.edges.get(id);
      if (!base) continue;

      const mod = MODIFIED_EDGES.get(id) || {};
      const merged = { ...base, ...mod };

      if (window.currentSettings.showTitles) {
        merged.title = generateEdgeTitleSafely(merged);
      } else {
        merged.title = undefined;
      }
      edgeBatch.push(merged);
    }
    if (edgeBatch.length > 0) {
      edgesData.update(edgeBatch);
    }

    const activeLayoutType = window.currentSettings.layoutType;
    if (isManualLayoutType(activeLayoutType)) {
        applyManualLayout(activeLayoutType, { fitToView: false, redraw: false });
    }

    const weightMode = normalizeEdgeWeightMode(window.currentSettings.weightEdges);
    if (weightMode !== "") {
      weightEdges(window.currentSettings.weightEdges);
    }

    if (window.EDGE_BUNDLING_STATE?.enabled) {
      applyEdgeBundlingLite();
    }

    applyMarkerOverlays(desiredNodeIds, desiredEdgeIds);
    
    if (network) {
        network.redraw();
    }

    if (window.ALERT_RULES_ENABLED) {
      scheduleAlertScan();
    }

    const renderDone = performance.now();
    if (desiredNodeIds.size >= 500 || desiredEdgeIds.size >= 1000) {
      console.log(
        `[renderVisibleGraphBatch] nodes=${desiredNodeIds.size} edges=${desiredEdgeIds.size} ` +
        `nodeBatch=${nodeBatch.length} edgeBatch=${edgeBatch.length} ` +
        `removedNodes=${nodesToRemove.length} removedEdges=${edgesToRemove.length} ` +
        `weightMode=${weightMode || "off"} total=${(renderDone - renderStart).toFixed(1)}ms`
      );
    }
}

function generateNodeTitleSafely(node) {
  const excludeKeys = ['session_id', 'rel_type', 'x', 'y', 'vx', 'vy', 'index', 'edges', 'neighbors', 'color', 'shape', 'borderWidth', 'borderWidthSelected', 'image', 'iconPath', 'title', 'size', 'font', 'margin', 'shadow'];
  const entries = Object.entries(node)
    .filter(([k]) => {
      // Keep these important keys
      const keepKeys = ['node_identity', 'id', 'type', 'category', 'department', 'name', 'description'];                    
      // Exclude these internal/system keys
      const excludeKeys = ['session_id', 'Label', 'rel_type', 'x', 'y', 'vx', 'vy', 'index', 'edges', 'neighbors', 'color', 'shape', 'borderWidth', 'borderWidthSelected', 'image', 'iconPath', 'title', 'size', 'font', 'margin', 'shadow'];
        if (keepKeys.includes(k)) return true;
        if (excludeKeys.includes(k)) return false;
        // If not in either list, keep it (but limit total)
          return true;
        })
    .slice(0, 50);
  return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
}

function generateEdgeTitleSafely(edge) {
    const base = FULL_GRAPH.edges.get(edge.id) || {};
    const mod = MODIFIED_EDGES.get(edge.id) || {};
    const merged = { ...base, ...mod };

    const fromNodeBase = FULL_GRAPH.nodes.get(merged.from) || {};
    const fromNodeMod = MODIFIED_NODES.get(merged.from) || {};
    const toNodeBase = FULL_GRAPH.nodes.get(merged.to) || {};
    const toNodeMod = MODIFIED_NODES.get(merged.to) || {};

    const fromLabel = fromNodeMod.label ?? fromNodeBase.label ?? merged.from;
    const toLabel = toNodeMod.label ?? toNodeBase.label ?? merged.to;

    const weightCandidate = merged.weight ?? merged.value ?? merged.width ?? 1;
    const weightValue = toFiniteNumber(weightCandidate);
    const normalizedWeight = weightValue == null ? 1 : weightValue;

    return `From: ${fromLabel}\nTo: ${toLabel}\nWeight: ${normalizedWeight}`;
}

// Batch update all edge titles
function updateAllEdgeTitles() {
    const edgeUpdates = [];
    edgesData.forEach(edge => {
        edgeUpdates.push({ id: edge.id, title: generateEdgeTitleSafely(edge) });
    });
    edgesData.update(edgeUpdates);
}

function renderVisibleGraph() {
  const nodeBatch = [];
  const edgeBatch = [];
  const markerSets = getMarkerSets();

  for (const id of VISIBLE_STATE.nodes) {
    const base = FULL_GRAPH.nodes.get(id);
    if (!base) continue;

    const mod = MODIFIED_NODES.get(id) || {};
    const merged = { ...base, ...mod };

    // build title ALWAYS if enabled
    if (window.currentSettings.showTitles) {
      merged.title = Object.entries(merged)
        .filter(([_, v]) => v != null)
        .map(([k, v]) => `${k}: ${v}`)
        .join("\n");
    } else {
      merged.title = undefined;
    }

    // build label ALWAYS correctly
    merged.label = getNodeRenderLabel(base, mod, window.currentSettings.showLabels);
    applyNodeStateDecorations(merged, id, markerSets);

    nodeBatch.push(merged);
  }

  for (const id of VISIBLE_STATE.edges) {
    const base = FULL_GRAPH.edges.get(id);
    if (!base) continue;

    const mod = MODIFIED_EDGES.get(id) || {};
    const merged = { ...base, ...mod };
    if (!window.currentSettings.showTitles) {
      merged.title = undefined;
    }
    edgeBatch.push(merged);
  }

  nodesData.clear();
  edgesData.clear();

  nodesData.add(nodeBatch);
  edgesData.add(edgeBatch);
  applyMarkerOverlays(VISIBLE_STATE.nodes, VISIBLE_STATE.edges);

  network.redraw();
}
