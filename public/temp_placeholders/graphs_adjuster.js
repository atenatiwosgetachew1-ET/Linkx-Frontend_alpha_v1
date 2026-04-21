window.addEventListener("message", (event) => {
  const { action, payload } = event.data;
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

function clearVisibleGraph() {
  nodesData.clear();
  edgesData.clear();
  VISIBLE_STATE.nodes.clear();
  VISIBLE_STATE.edges.clear();
}

function persistNodeChange(id, patch) {
  window.MODIFIED_NODES.set(id, {
    ...(window.MODIFIED_NODES.get(id) || {}),
    ...patch
  });
}

function persistEdgeChange(id, patch) {
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
let AUTO_PHYSICS_FORCED_OFF = false;
let LAST_APPLIED_EFFECTIVE_PHYSICS = null;
const SAVED_VIEWS_STORAGE_KEY = "linkx_saved_views_v1";
const PINNED_EVIDENCE_STORAGE_KEY = "linkx_pinned_evidence_v1";
const MAX_SAVED_VIEWS = 30;

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
window.ALERT_RULES_ENABLED = window.ALERT_RULES_ENABLED !== false;
window.EDGE_BUNDLING_STATE = window.EDGE_BUNDLING_STATE || {
  enabled: false,
  originalByEdgeId: new Map(),
  bundledPrimaryEdges: new Set()
};
window.PATH_HIGHLIGHT_STATE = window.PATH_HIGHLIGHT_STATE || {
  nodeIds: new Set(),
  edgeIds: new Set()
};

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

function restoreSettings(settings) {
  if (!settings || !Array.isArray(settings)) {
    console.warn("Invalid settings array, skipping restore.");
    return;
  }

  try {
    const asBool = (value) => value === true || value === "true";
    const limitAmount = Math.min(parseInt(settings[2], 10) || 25, 300);
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
  const edge = {
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
  color = { background: "#fffdf2", border: "#8b7d4f" },
  font = { color: "#333333", size: 14 },
  extra = {}
} = {}) {
  const id = createUniqueNodeId("anno");
  const node = {
    id,
    label,
    x,
    y,
    shape,
    color,
    font,
    borderWidth: extra.borderWidth ?? 1.2,
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

function handleAddLabelNode(x, y) {
  const text = prompt("Label text", "Label");
  if (text == null) return;
  const pos = getContextCanvasPosition(x, y);
  createAnnotationNode({
    label: String(text),
    x: pos.x,
    y: pos.y,
    shape: "text",
    font: { color: "#1f2d3d", size: 18 },
    extra: { annotationType: "label" }
  });
}

function handleAddCommentBox(x, y) {
  const text = prompt("Comment", "New comment");
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

function handleAddTextBlock(x, y) {
  const text = prompt("Text block", "Analyst note");
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

function handleAddEventFrame(x, y) {
  const text = prompt("Event frame title", "Event Frame");
  if (text == null) return;
  const pos = getContextCanvasPosition(x, y);
  createAnnotationNode({
    label: String(text),
    x: pos.x,
    y: pos.y,
    shape: "box",
    color: { background: "#f8f8f8", border: "#555555" },
    font: { color: "#333333", size: 13 },
    extra: { annotationType: "event_frame", borderWidth: 2, dashes: [8, 4] }
  });
}

function handleAddThemeLine(selectedNodes) {
  const nodes = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId) : [];
  if (nodes.length < 2) {
    alert("Select at least two nodes to create a Theme Line.");
    return;
  }
  for (let i = 0; i < nodes.length - 1; i++) {
    createGraphEdge(nodes[i], nodes[i + 1], {
      label: "Theme",
      width: 2,
      dashes: [8, 6],
      color: { color: "#6b7280", inherit: false }
    });
  }
  renderVisibleGraphBatch();
}

function handleAddOleObject(x, y) {
  const text = prompt("OLE object title", "External Object");
  if (text == null) return;
  const pos = getContextCanvasPosition(x, y);
  createAnnotationNode({
    label: String(text),
    x: pos.x,
    y: pos.y,
    shape: "database",
    color: { background: "#eef6ff", border: "#245c9a" },
    font: { color: "#1a3f66", size: 13 },
    extra: { annotationType: "ole_object" }
  });
}

function handleDeleteNode(nodeId) {
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

function mergeSelectedNodes(selectedNodes) {
  const ids = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId).filter(id => FULL_GRAPH.nodes.has(id)) : [];
  if (ids.length < 2) return;

  const canonicalId = ids[0];
  const mergeSet = new Set(ids);
  const canonicalBase = FULL_GRAPH.nodes.get(canonicalId) || {};
  const canonicalMod = MODIFIED_NODES.get(canonicalId) || {};
  const canonicalNode = { ...canonicalBase, ...canonicalMod };

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

  const aggregated = new Map();
  FULL_GRAPH.edges.forEach(edge => {
    const from = mergeSet.has(edge.from) ? canonicalId : edge.from;
    const to = mergeSet.has(edge.to) ? canonicalId : edge.to;
    if (from === to) return;
    const key = `${String(from)}-->${String(to)}`;
    if (!aggregated.has(key)) {
      aggregated.set(key, {
        ...edge,
        id: createUniqueEdgeId("merged_edge"),
        from,
        to,
        merged_count: 1
      });
      return;
    }

    const acc = aggregated.get(key);
    acc.merged_count += 1;
    const accWeight = toFiniteNumber(acc.weight ?? acc.value ?? acc.width ?? 1) ?? 1;
    const edgeWeight = toFiniteNumber(edge.weight ?? edge.value ?? edge.width ?? 1) ?? 1;
    const totalWeight = accWeight + edgeWeight;
    acc.weight = totalWeight;
    acc.value = totalWeight;
    acc.width = Math.max(1, Math.min(6, totalWeight));
    if (!acc.label) acc.label = edge.label || "Merged";
  });

  ids.forEach(id => {
    if (id !== canonicalId) removeFullGraphNode(id);
  });

  upsertFullGraphNode({ ...canonicalNode, id: canonicalId });
  MODIFIED_NODES.set(canonicalId, { ...(MODIFIED_NODES.get(canonicalId) || {}), ...canonicalNode, id: canonicalId });
  VISIBLE_STATE.nodes.add(canonicalId);

  FULL_GRAPH.edges.clear();
  MODIFIED_EDGES.clear();
  aggregated.forEach(edge => {
    const stored = upsertFullGraphEdge(edge);
    if (!stored) return;
    MODIFIED_EDGES.set(stored.id, { ...(MODIFIED_EDGES.get(stored.id) || {}), ...stored });
  });

  rebuildAdjacencyFromFullGraph();
  recomputeVisibleEdges();
  renderVisibleGraphBatch();
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

function loadSavedView(name) {
  const list = Array.isArray(window.SAVED_VIEWS) ? window.SAVED_VIEWS : [];
  if (list.length === 0) return;
  const target = list.find(item => item.name === name) || list[0];
  if (!target) return;

  const nodes = new Set((target.visibleNodes || []).filter(nodeId => FULL_GRAPH.nodes.has(nodeId)));
  if (nodes.size > 0) {
    VISIBLE_STATE.nodes = nodes;
    recomputeVisibleEdges();
    renderVisibleGraphBatch();
  }

  network.moveTo({
    position: target.position || { x: 0, y: 0 },
    scale: Number.isFinite(target.scale) ? target.scale : 1,
    animation: { duration: 280, easingFunction: "easeInOutQuad" }
  });

  if (Array.isArray(target.selectedNodes) && target.selectedNodes.length > 0) {
    network.selectNodes(target.selectedNodes.filter(nodeId => VISIBLE_STATE.nodes.has(nodeId)));
  }
}

function clearPathHighlight() {
  if (!window.PATH_HIGHLIGHT_STATE) return;
  window.PATH_HIGHLIGHT_STATE.nodeIds.clear();
  window.PATH_HIGHLIGHT_STATE.edgeIds.clear();
  renderVisibleGraphBatch();
}

function findShortestPath(startId, endId) {
  const start = normalizeGraphId(startId);
  const end = normalizeGraphId(endId);
  if (!FULL_GRAPH.nodes.has(start) || !FULL_GRAPH.nodes.has(end)) return [];
  if (start === end) return [start];

  const queue = [start];
  const visited = new Set([start]);
  const previous = new Map();

  while (queue.length > 0) {
    const current = queue.shift();
    const neighbors = FULL_GRAPH.adjacency.get(current);
    if (!neighbors) continue;
    for (const neighborId of neighbors) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      previous.set(neighborId, current);
      if (neighborId === end) {
        const path = [end];
        let cursor = end;
        while (previous.has(cursor)) {
          cursor = previous.get(cursor);
          path.push(cursor);
        }
        return path.reverse();
      }
      queue.push(neighborId);
    }
  }

  return [];
}

function highlightPath(path) {
  clearPathHighlight();
  if (!Array.isArray(path) || path.length === 0) return;

  const nodeUpdates = [];
  const edgeUpdates = [];

  for (let i = 0; i < path.length; i++) {
    const nodeId = path[i];
    if (!VISIBLE_STATE.nodes.has(nodeId)) continue;
    window.PATH_HIGHLIGHT_STATE.nodeIds.add(nodeId);
    nodeUpdates.push({
      id: nodeId,
      borderWidth: 3,
      color: buildNodeColor("#f97316")
    });
    persistNodeChange(nodeId, {
      borderWidth: 3,
      color: buildNodeColor("#f97316")
    });

    if (i === path.length - 1) continue;
    const from = path[i];
    const to = path[i + 1];
    for (const [edgeId, edge] of FULL_GRAPH.edges) {
      if ((edge.from === from && edge.to === to) || (edge.from === to && edge.to === from)) {
        window.PATH_HIGHLIGHT_STATE.edgeIds.add(edgeId);
        edgeUpdates.push({
          id: edgeId,
          color: { color: "#f97316", inherit: false },
          width: 3
        });
        MODIFIED_EDGES.set(edgeId, {
          ...(MODIFIED_EDGES.get(edgeId) || {}),
          color: { color: "#f97316", inherit: false },
          width: 3
        });
        break;
      }
    }
  }

  if (nodeUpdates.length > 0) nodesData.update(nodeUpdates);
  if (edgeUpdates.length > 0) edgesData.update(edgeUpdates);
}

function runPathFinderForSelection(selectedNodes) {
  const ids = Array.isArray(selectedNodes) ? selectedNodes.map(normalizeGraphId) : [];
  if (ids.length !== 2) {
    alert("Select exactly two nodes to compute shortest path.");
    return;
  }
  const path = findShortestPath(ids[0], ids[1]);
  if (!path.length) {
    alert("No path found between the selected nodes.");
    return;
  }
  path.forEach(nodeId => VISIBLE_STATE.nodes.add(nodeId));
  recomputeVisibleEdges();
  renderVisibleGraphBatch();
  highlightPath(path);
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

  const groups = new Map();
  Array.from(VISIBLE_STATE.edges).forEach(edgeId => {
    const edge = edgesData.get(edgeId) || FULL_GRAPH.edges.get(edgeId);
    if (!edge) return;
    const key = `${String(edge.from)}-->${String(edge.to)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(edge);
  });

  const updates = [];
  groups.forEach(group => {
    group.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    if (group.length === 1) {
      const solo = group[0];
      updates.push({ id: solo.id, hidden: false });
      return;
    }
    const primary = group[0];
    const extraCount = group.length - 1;

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

function generateGraphAlerts() {
  if (!window.ALERT_RULES_ENABLED) return [];
  const alerts = [];
  const visibleNodes = Array.from(VISIBLE_STATE.nodes);
  const visibleEdges = Array.from(VISIBLE_STATE.edges);
  if (visibleNodes.length === 0) return alerts;

  const degreeStats = visibleNodes
    .map(nodeId => ({ nodeId, degree: getVisibleNeighborCount(nodeId, new Set(VISIBLE_STATE.nodes)) }))
    .sort((a, b) => b.degree - a.degree);

  const topDegree = degreeStats.slice(0, Math.min(5, degreeStats.length));
  topDegree.forEach(item => {
    if (item.degree >= 3) {
      alerts.push({
        type: "high_degree",
        severity: item.degree >= 8 ? "high" : "medium",
        nodeId: item.nodeId,
        message: `Node ${item.nodeId} has degree ${item.degree}`
      });
    }
  });

  const numericEdgeValues = [];
  visibleEdges.forEach(edgeId => {
    const edge = FULL_GRAPH.edges.get(edgeId) || edgesData.get(edgeId);
    if (!edge) return;
    const value = toFiniteNumber(edge.weight ?? edge.value ?? edge.width);
    if (value != null) numericEdgeValues.push({ edgeId, value });
  });
  if (numericEdgeValues.length >= 4) {
    const sorted = numericEdgeValues.slice().sort((a, b) => a.value - b.value);
    const p95 = getPercentile(sorted.map(item => item.value), 0.95);
    sorted
      .filter(item => item.value >= p95)
      .slice(-5)
      .forEach(item => {
        alerts.push({
          type: "heavy_edge",
          severity: "medium",
          edgeId: item.edgeId,
          message: `Edge ${item.edgeId} has high weight ${item.value}`
        });
      });
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
  publishGraphAlerts(alerts);
  if (notify) {
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
  } else {
    if (window.__alertScanTimer) {
      clearTimeout(window.__alertScanTimer);
      window.__alertScanTimer = null;
    }
    publishGraphAlerts([]);
  }
  return next;
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
}

function clearPinnedEvidence() {
  window.PINNED_EVIDENCE = [];
  writeJsonStorage(PINNED_EVIDENCE_STORAGE_KEY, window.PINNED_EVIDENCE);
  window.parent.postMessage({
    type: "pinned_evidence_update",
    payload: window.PINNED_EVIDENCE
  }, "*");
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


function applyLimit({ key = "", sort = "asc", amount = 25 }) {
    const perfStart = performance.now();
      // Store in global settings
    window.currentSettings.limit = amount;
    window.currentSettings.sortKey = key;
    window.currentSettings.sortOrder = sort;

    VISIBLE_STATE.nodes.clear();
    VISIBLE_STATE.edges.clear();
    VISIBLE_STATE.limit = amount;

    // For large graphs, skip sorting if no key
    if (!key || FULL_GRAPH.nodes.size > 10000) {
        // Fast path: just take first N nodes
        const iterator = FULL_GRAPH.nodes.keys();
        for (let i = 0; i < amount; i++) {
            const { value, done } = iterator.next();
            if (done) break;
            VISIBLE_STATE.nodes.add(value);
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
        
        for (let i = 0; i < Math.min(amount, nodes.length); i++) {
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
      label: state ? (mod.label ?? base.label ?? "") : ""
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
      label: window.currentSettings.showLabels ? (mod.label ?? base.label ?? "") : ""
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
      label: state ? (mod.label ?? base?.label ?? "") : ""
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

function graphSearch({ id, keyword, option, keys, settings }) {
    // --- EMPTY SEARCH: Restore to limit settings ---
    if (!keyword || keyword.trim() === "") {
        // Reset to current limit settings, not just first 25
        const currentLimit = VISIBLE_STATE.limit || 25;
        
        VISIBLE_STATE.nodes.clear();
        VISIBLE_STATE.edges.clear();
        
        // Apply current sort/filter settings
        const sortKey = window.currentSortKey || "";
        const sortOrder = window.currentSortOrder || "asc";
        
        // Get nodes based on current limit settings
        const nodes = [];
        for (const [id, node] of FULL_GRAPH.nodes) {
            let value = null;
            if (sortKey) {
                value = getNodeValue(node, sortKey);
                if (value == null) continue;
            }
            nodes.push({ id, value });
        }
        
        // Sort if needed
        if (sortKey) {
            nodes.sort((a, b) => {
                // ... sorting logic ...
            });
        }
        
        // Take top N based on limit
        for (let i = 0; i < Math.min(currentLimit, nodes.length); i++) {
            VISIBLE_STATE.nodes.add(nodes[i].id);
        }
        
        recomputeVisibleEdges();
        renderVisibleGraphBatch();
        
        window.parent.postMessage({
            type: "graph_search_results",
            payload: { id, nodes: VISIBLE_STATE.nodes.size, edges: VISIBLE_STATE.edges.size }
        }, "*");
        return;
    }
// --- SEARCH WITH KEYWORD ---
    const limit = Math.min(settings?.[2] || 25, 300);
    const keywordLower = keyword.toLowerCase();
    const matched = new Set();
    const searchKeys = keys?.length ? keys : [];
    
    // First pass: find matching nodes
    for (const [id, base] of FULL_GRAPH.nodes) {
        const mod = MODIFIED_NODES.get(id) || {};
        const node = { ...base, ...mod };
        
        // If specific keys provided, ONLY search those keys
        if (searchKeys.length > 0) {
            for (const key of searchKeys) {
                const value = node[key];
                if (value != null && String(value).toLowerCase().includes(keywordLower)) {
                    matched.add(id);
                    break;
                }
            }
        } else {
            // No keys specified - search all properties (but limit scope)
            let found = false;
            for (const [key, value] of Object.entries(node)) {
                // Skip vis.js internal properties
                if (key.startsWith('_') || ['x','y','vx','vy','index'].includes(key)) continue;
                if (value != null && String(value).toLowerCase().includes(keywordLower)) {
                    matched.add(id);
                    found = true;
                    break;
                }
                if (found) break;
            }
        }
        
        if (matched.size >= limit * 2) break; // Collect more than needed for neighbor expansion
    }
    
    // --- FIXED NEIGHBOR EXPANSION ---
    if (option) {
        const visited = new Set(matched);
        const queue = Array.from(matched);
        
        // BFS with depth limit to prevent explosion
        const MAX_DEPTH = 300;
        const depth = new Map();
        queue.forEach(id => depth.set(id, 0));
        
        while (queue.length > 0) {
            const nodeId = queue.shift();
            const currentDepth = depth.get(nodeId) || 0;
            
            if (currentDepth >= MAX_DEPTH) continue;
            
            const neighbors = FULL_GRAPH.adjacency.get(nodeId);
            if (neighbors) {
                for (const neighbor of neighbors) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        depth.set(neighbor, currentDepth + 1);
                        queue.push(neighbor);
                    }
                }
            }
        }
        
        // Replace matched with full reachable set, but respect limit
        matched.clear();
        let count = 0;
        for (const id of visited) {
            matched.add(id);
            count++;
            if (count >= limit * 2) break; // Don't exceed 2x limit
        }
    }
    
    // --- APPLY SEARCH RESULTS WHILE RESPECTING LIMIT ---
    VISIBLE_STATE.nodes.clear();
    VISIBLE_STATE.edges.clear();
    
    // Only show up to the limit
    let nodeCount = 0;
    for (const id of matched) {
        if (nodeCount >= limit) break;
        VISIBLE_STATE.nodes.add(id);
        nodeCount++;
    }
    
    // Store search context for limit adjustments
    window.lastSearchContext = {
        keyword,
        option,
        keys: searchKeys,
        matchedNodes: Array.from(matched) // Store full match set
    };
    
    recomputeVisibleEdges();
    renderVisibleGraphBatch();
    // If No node is found
    if(VISIBLE_STATE.nodes.size == 0){
      alert("No Result Found!")
    }
    window.parent.postMessage({
        type: "graph_search_results",
        payload: { id, nodes: VISIBLE_STATE.nodes.size, edges: VISIBLE_STATE.edges.size }
    }, "*");
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

  applyLimit({
    key: filterKey || "",
    sort: filterSort,
    amount: Math.min(limitAmount, 300)
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

      if (window.currentSettings.showTitles && FULL_GRAPH.nodes.size < 5000) {
        merged.title = generateNodeTitleSafely(merged);
      } else {
        merged.title = undefined;
      }

      merged.label = window.currentSettings.showLabels ? (merged.label ?? base.label ?? "") : "";

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
    merged.label = window.currentSettings.showLabels
      ? (merged.label ?? base.label ?? "")
      : "";

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

  network.redraw();
}
