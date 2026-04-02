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
      weightEdgesEnabled = payload;
      weightEdges(weightEdgesEnabled); // define logic here
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

function EdgeWeightToWidth(weight, minW, maxW) {
  console.log("EdgeWeightToWidth:",weight, minW, maxW);
  const minWidth = 1;
  const maxWidth = 6;
    // If all weights are equal → use middle width
  if (minW === maxW && minW == 1) {
    return minWidth;
  }
  else{
    minW = 0;
  }
  const normalized = (Math.log(weight + 1) - Math.log(minW + 1)) /
                     (Math.log(maxW + 1) - Math.log(minW + 1));

  return minWidth + normalized * (maxWidth - minWidth);
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
  const graph_edges = FULL_GRAPH.edges;

  let minW = Infinity;
  let maxW = -Infinity;

  // FIRST PASS — compute real min/max using merged weights
  graph_edges.forEach(edge => {
    const base = FULL_GRAPH.edges.get(edge.id) || {};
    const mod  = MODIFIED_EDGES.get(edge.id) || {};
    const merged = { ...base, ...mod };
    console.log("mod:",mod)
    const weightValue =
      merged.weight ??
      merged.width ??
      merged.value ??
      1;

    if (weightValue < minW) minW = weightValue;
    if (weightValue > maxW) maxW = weightValue;
  });

  // SECOND PASS — apply widths
  edgesData.forEach(edge => {
    const base = FULL_GRAPH.edges.get(edge.id) || {};
    const mod  = MODIFIED_EDGES.get(edge.id) || {};
    const merged = { ...base, ...mod };

    const weightValue =
      merged.weight ??
      merged.width ??
      merged.value ??
      1;

    const width = state
      ? EdgeWeightToWidth(weightValue, minW, maxW)
      : 1;
    edgesData.update({
      id: edge.id,
      width
    });

    MODIFIED_EDGES.set(edge.id, {
      ...mod,
      width
    });
  });

  window.currentSettings.weightEdges = state;
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


function networkLayoutType(type) {
  if (!network) return;

  if (type === "hierarchical") {
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
  window.currentSettings.layoutType = type;
  updateGraphOption("layout_type", type);

  // only stabilize if physics is enabled
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
}


function networkLayoutSort(sort) {
  if (!network) return;
  network.setOptions({
    layout: { hierarchical: { sortMethod: sort } }
  });
  updateGraphOption("layout_sort", sort);
  network.stabilize();
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
  if (normalized === "source node") return "#0ea5e9";
  if (normalized === "target node") return "#f59e0b";
  if (normalized === "entity node") return "#4f46e5";
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

    const identity = node.node_identity || "Unspecified";
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
        identity: node.node_identity || "Unspecified",
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

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
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
  doc.text("CONFIDENTIAL REPORT", titleStartX, y + 12);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15.5);
  doc.setTextColor(31, 58, 85);
  doc.text("Linkx Graph Report", titleStartX, y + 28);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.6);
  doc.setTextColor(97, 103, 110);
  doc.text(`Source Window: ${String(report.sourceWindowId ?? "-")}`, titleStartX, y + 43);
  doc.text(`Generated At: ${String(report.generatedAt ?? "-")}`, titleStartX, y + 56);

  y += headerHeight + 8;
  doc.setDrawColor(218, 226, 235);
  doc.setLineWidth(0.8);
  doc.line(margin, y, pageWidth - margin, y);
  y += 12;

  if (report.graphSnapshotDataUrl) {
    drawSectionTitle("Visible Graph Snapshot");
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

  drawSectionTitle("Summary");
  const summaryRows = [
    ["Visible Nodes", numberFormat(report.visibleNodes)],
    ["Visible Edges", numberFormat(report.visibleEdges)],
    ["Total Nodes", numberFormat(report.totalNodes)],
    ["Total Edges", numberFormat(report.totalEdges)],
    ["Selected Nodes", numberFormat(report.selectedNodes)],
    ["Selected Edges", numberFormat(report.selectedEdges)],
    ["Average Degree", Number(report.averageDegree || 0).toFixed(2)],
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

  drawSectionTitle("Relationship Types");
  drawList(
    report.relationshipTypes,
    item => `${item.type}: ${numberFormat(item.count)}`,
    "No relationship types found."
  );
  y += 4;

  drawSectionTitle("Node Identity Distribution");
  drawList(
    report.nodeIdentityDistribution,
    item => `${item.identity}: ${numberFormat(item.count)}`,
    "No node identities found."
  );
  y += 4;

  drawSectionTitle("Top Nodes By Degree");
  if (!Array.isArray(report.topNodesByDegree) || report.topNodesByDegree.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.8);
    doc.setTextColor(90, 90, 90);
    doc.text("No nodes found.", margin + 2, y);
    y += 12;
  } else {
    const rowHeight = 16;
    for (const item of report.topNodesByDegree) {
      ensureSpace(rowHeight + 6);
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
      y += rowHeight + 4;
    }
  }

  const filename = `LinkxGraph_report_${Date.now()}.pdf`;
  doc.save(filename);
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
    }
    
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
    // Merge base and modified data
    const base = FULL_GRAPH.edges.get(edge.id) || {};
    const mod = MODIFIED_EDGES.get(edge.id) || {};
    const merged = { ...base, ...mod };

    // Start building title entries
    const entries = Object.entries(merged)
        .filter(([_, v]) => v != null)
        .filter(([k]) => !['from', 'to', 'id', 'arrows', 'smooth', 'selectionWidth', 'width',
                          'hoverWidth', 'widthConstrain', 'length', 'font', 'label', 
                          'arrowStrikethrough', 'chosen', 'endPointOffset', 'bgcolor', 'textcolor', 'session_id', 'color', 'baseColor', 'Text Color'].includes(k)) // skip standard visual keys
        .slice(0, 50); // max 50 properties

    let titleText = entries.map(([k, v]) => {
        if (typeof v === 'object') return `${k}: ${JSON.stringify(v).slice(0,30)}...`;
        return `${k}: ${v}`;
    }).join("\n");

    // Always include "from → to" for clarity
    const fromLabel = FULL_GRAPH.nodes.get(merged.from)?.label || merged.from;
    const toLabel = FULL_GRAPH.nodes.get(merged.to)?.label || merged.to;
    titleText = `From: ${fromLabel}\nTo: ${toLabel}` + (titleText ? `\n${titleText}` : '');

    return titleText;
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
