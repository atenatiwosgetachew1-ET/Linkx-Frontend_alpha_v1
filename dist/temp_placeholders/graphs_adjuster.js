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

    case "new_graph":      
      createNewGraph(payload); // <-- payload should contain {nodes, edges}
      break;

    case "load_graph_url":
      const id = payload?.id || null;  
      const file = payload?.file || null;  
      loadGraphFromFile(id,file);
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
    applyLimit({
      key: settings[0],
      sort: settings[1] || "asc",
      amount: Math.min(settings[2] || 25, 300)
    });
    weightEdges(settings[5]);
    applyTitleToggle(settings[6]);
    showNodelabels(settings[7]);
    console.log("Skipping edit infos at index 6.");
    networkphysics(settings[9]);
    networkLayoutType(settings[10]);
    labelNodesWith(settings[11] || null);
    if (settings[9] === "hierarchical") {
      networkLayoutDirection(settings[11]);
      networkLayoutSort(settings[12]);
    }
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


//Context menu actions
function handleAddNode(x, y) {
  const id = Date.now();
  const pos = network.DOMtoCanvas({ x, y });

  const node = {
    id,
    label: window.currentSettings.showLabels ? `Node ${id}` : "",
    x: pos.x,
    y: pos.y,
    color: { background: "#FFFFFF", border: "#777777" }
  };

  // Add to FULL_GRAPH too
  FULL_GRAPH.nodes.set(id, node);

  // Persist modifications
  MODIFIED_NODES.set(id, node);

  // Add to nodesData so it appears immediately
  nodesData.add(node);

  // Mark as visible
  VISIBLE_STATE.nodes.add(id);
}





function handleDeleteNode(nodeId) {
  if (!nodeId) return;
  const id = isNaN(nodeId) ? nodeId : Number(nodeId);

  nodesData.remove(id);
  window.MODIFIED_NODES.delete(id);
}


function handleLinkNodes(selectedNodes) {
  if (selectedNodes.length < 2) return;

  for (let i = 0; i < selectedNodes.length; i++) {
    for (let j = i + 1; j < selectedNodes.length; j++) {
      const from = selectedNodes[i];
      const to = selectedNodes[j];

      const exists = network
        .getConnectedEdges(from)
        .map(id => edgesData.get(id))
        .some(e => e?.from === to || e?.to === to);

      if (!exists) {
        const edge = { from, to };
        const id = edgesData.add(edge)[0];
        window.MODIFIED_EDGES.set(id, edge);
      }
    }
  }

}


//Handle single node
function handleUnlinkNode(nodeId) {
  const edges = network
    .getConnectedEdges(nodeId)
    .filter(id => edgesData.get(id));

  edgesData.remove(edges);
  edges.forEach(id => window.MODIFIED_EDGES.delete(id));
}


//Handle multiple nodes
function handleUnlinkNodes(selectedNodes) {
  if (selectedNodes.length < 2) return;

  const toRemove = [];

  edgesData.forEach(edge => {
    if (
      selectedNodes.includes(edge.from) &&
      selectedNodes.includes(edge.to)
    ) {
      toRemove.push(edge.id);
    }
  });

  edgesData.remove(toRemove);
  toRemove.forEach(id => window.MODIFIED_EDGES.delete(id));

}


function handleGroupNodes(nodeIds) {
  const groupId = `Group ${Date.now()}`;
  const pos = network.getPositions(nodeIds);

  let x = 0, y = 0;

  // Capture full node data BEFORE removal
  const memberNodes = nodesData.get(nodeIds);

  // 🔑 Capture internal edges BEFORE removal
  const memberEdges = edgesData.get({
    filter: edge =>
      nodeIds.includes(edge.from) &&
      nodeIds.includes(edge.to)
  });

  nodeIds.forEach(id => {
    x += pos[id]?.x || 0;
    y += pos[id]?.y || 0;
  });

  x /= nodeIds.length;
  y /= nodeIds.length;

  // Remove original nodes (edges auto-removed by vis)
  nodesData.remove(nodeIds);

  const groupNode = {
    id: groupId,
    label: "Group",
    size: 40,
    x,
    y,
    color: {
      background: "#FFFFFF",
      border: "#777777"
    },
    isGroup: true,

    // 🔒 serialized subgraph
    members: memberNodes,
    edges: memberEdges
  };

  nodesData.add(groupNode);
  window.MODIFIED_NODES.set(groupId, groupNode);

}



function handleUngroupNode(groupId) {
  const groupNode = nodesData.get(groupId);
  if (!groupNode || !groupNode.isGroup) {
    console.warn("Not a group node:", groupId);
    return;
  }

  const { members = [], edges = [] } = groupNode;

  // Remove the group node
  nodesData.remove(groupId);
  MODIFIED_NODES.delete(groupId);

  const idMap = new Map(); // oldId -> new unique ID

  // Restore member nodes, remap IDs if duplicate exists
  const restoredNodes = members.map(node => {
    let newId = node.id;
    if (nodesData.get(newId)) {
      // Generate a unique ID
      newId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
    idMap.set(node.id, newId);

    const patchedNode = { ...node, id: newId };
    nodesData.add(patchedNode);

    MODIFIED_NODES.set(newId, {
      ...(MODIFIED_NODES.get(newId) || {}),
      ...patchedNode
    });

    return patchedNode;
  });

  // Restore edges with remapped IDs
  const existingEdges = new Set(
    edgesData.get().map(e => {
      const a = String(e.from);
      const b = String(e.to);
      return a < b ? `${a}--${b}` : `${b}--${a}`;
    })
  );

  const safeEdges = edges.map(edge => {
    const from = idMap.get(edge.from) || edge.from;
    const to = idMap.get(edge.to) || edge.to;
    const key = from < to ? `${from}--${to}` : `${to}--${from}`;

    if (!existingEdges.has(key)) {
      existingEdges.add(key);
      return { ...edge, from, to, id: `${from}-${to}` };
    }
    return null; // skip duplicates
  }).filter(Boolean);

  edgesData.add(safeEdges);

}


function restoreNodeState(nodeId) {
  const mod = window.MODIFIED_NODES.get(nodeId);
  if (!mod) return;

  nodesData.update({ id: nodeId, ...mod });
}


function applyLimit({ key = "", sort = "asc", amount = 25 }) {
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

    recomputeVisibleEdges();
    renderVisibleGraphBatch();
}


function recomputeVisibleEdges() {
  VISIBLE_STATE.edges.clear();

  for (const [id, e] of FULL_GRAPH.edges) {
    if (
      VISIBLE_STATE.nodes.has(e.from) &&
      VISIBLE_STATE.nodes.has(e.to)
    ) {
      VISIBLE_STATE.edges.add(id);
    }
  }
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
    }
    
    recomputeVisibleEdges();
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

  const idMap = new Map();

  clipboardNodes.forEach((n, i) => {
    let id = Date.now() + i;
    if(String(n.id).startsWith("Group")){
      id = `Group ${id}`
    }

    idMap.set(String(n.id), id);

    nodesData.add({
      ...n,
      id,
      x: pos.x + i * 20,
      y: pos.y + i * 20
    });
    MODIFIED_NODES.set(id, { ...n, id });
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

      const edgeId = `${Date.now()}_edge_${index}`;
      return { ...edge, id: edgeId, from, to };
    })
    .filter(Boolean);

  if (remappedEdges.length > 0) {
    edgesData.add(remappedEdges);
    remappedEdges.forEach(edge => {
      MODIFIED_EDGES.set(edge.id, { ...edge });
    });
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
  const enabled = state === true || state === "true";
  if (enabled) {
    network.setOptions({
      physics: {
        ...STABLE_PHYSICS,
        enabled: true
      }
    });
    // always restart engine cleanly
    network.startSimulation();
    network.stabilize();

  } else {
    // stop engine cleanly
    network.stopSimulation();
    network.setOptions({
      physics: { enabled: false }
    });
  }
  window.currentSettings.physics = state;
  updateGraphOption("graph_physics", enabled);
}


function isManualLayoutType(type) {
  return type === "circle" || type === "star" || type === "radial";
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

  window.currentSettings.layoutType = layoutType;
  updateGraphOption("layout_type", layoutType);

  if (isManualLayoutType(layoutType)) {
    // Keep shape deterministic when applying manual layouts.
    network.stopSimulation();
    applyManualLayout(layoutType, { fitToView: true, redraw: true });
    return;
  }

  if (network.physics) {
    network.stabilize();
  }

  network.fit();
}

function networkLayoutDirection(direction) {
  if (!network) return;
  network.setOptions({
    layout: { hierarchical: { direction: direction } }
  });

  if (network.physics) {
    network.stabilize();
  }
  window.currentSettings.layoutDirection = direction;
  updateGraphOption("layout_direction", direction);
}

function networkLayoutSort(sort) {
  if (!network) return;
  network.setOptions({
    layout: { hierarchical: { sortMethod: sort } }
  });

  if (network.physics) {
    network.stabilize();
  }
  window.currentSettings.sortMethod = sort;
  updateGraphOption("layout_sort", sort);
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

async function loadGraphFromFile(id,file) {
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
      nodes: graphData.nodes,
      edges: graphData.edges,
      options: networkOptions
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

function resetGraph() {
  MODIFIED_NODES.clear();
  MODIFIED_EDGES.clear();
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

function createNewGraph({ id, nodes = [], edges = [] }) {
  console.log("yooo")
  // Reset visible graph
  nodesData.clear();
  edgesData.clear();

  // Reset modification state
  MODIFIED_NODES.clear();
  MODIFIED_EDGES.clear();

  // Build FULL_GRAPH from the provided data
  console.log("Initializing FullGraph...");
  initializeFullGraph({ nodes, edges });

  // Optional: any iframe / parent init logic
  initializer?.(id);
}

function renderVisibleGraphBatch() {
    if (!window.limitOverridden && VISIBLE_STATE.nodes.size > window.currentSettings.limit) {
      // Trim to limit
      const nodesArray = Array.from(VISIBLE_STATE.nodes);
      VISIBLE_STATE.nodes.clear();
      for (let i = 0; i < window.currentSettings.limit; i++) {
          VISIBLE_STATE.nodes.add(nodesArray[i]);
      }
      recomputeVisibleEdges();
    }
    // Don't clear and re-add one by one
    const nodeBatch = [];
    const edgeBatch = [];
    
    // Process in chunks to avoid UI freeze
    const BATCH_SIZE = 1000;
    
    let nodeCount = 0;
    for (const id of VISIBLE_STATE.nodes) {
        const base = FULL_GRAPH.nodes.get(id);
        if (!base) continue;
        
        const mod = MODIFIED_NODES.get(id) || {};
        const merged = { ...base, ...mod };
        
        // Only add title if explicitly enabled AND graph is small
        if (window.currentSettings.showTitles && FULL_GRAPH.nodes.size < 5000) {
            merged.title = generateNodeTitleSafely(merged);
        }
        
        merged.label = window.currentSettings.showLabels ? (merged.label ?? base.label ?? "") : "";
        nodeBatch.push(merged);
        
        nodeCount++;
        
        // Periodic yield
        if (nodeCount % BATCH_SIZE === 0) {
            setTimeout(() => {}, 0);
        }
    }
    
    // Single update for nodes
    if (nodeBatch.length > 0) {
        nodesData.clear();
        nodesData.add(nodeBatch);
    }
    
    // Similar for edges...
    let edgeCount = 0;
    for (const id of VISIBLE_STATE.edges) {
        const base = FULL_GRAPH.edges.get(id);
        if (!base) continue;

        const mod = MODIFIED_EDGES.get(id) || {};
        const merged = { ...base, ...mod };

        // Add edge titles if titles are enabled
        if (window.currentSettings.showTitles) {
            merged.title = generateEdgeTitleSafely(merged);
        }

        edgeBatch.push(merged);

        edgeCount++;
        // Periodic yield to avoid UI freeze
        if (edgeCount % BATCH_SIZE === 0) {
            setTimeout(() => {}, 0);
        }
    }

    if (edgeBatch.length > 0) {
        edgesData.clear();
        edgesData.add(edgeBatch);
    } else {
        edgesData.clear();
    }

    const activeLayoutType = window.currentSettings.layoutType;
    if (isManualLayoutType(activeLayoutType)) {
        applyManualLayout(activeLayoutType, { fitToView: false, redraw: false });
    }

    weightEdges(window.currentSettings.weightEdges);
    
    if (network) {
        network.redraw();
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
    edgeBatch.push({ ...base, ...mod });
  }

  nodesData.clear();
  edgesData.clear();

  nodesData.add(nodeBatch);
  edgesData.add(edgeBatch);

  network.redraw();
}
