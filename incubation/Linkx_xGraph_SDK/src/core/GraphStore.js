/**
 * Helper to normalize graph IDs
 * @param {*} rawId 
 * @returns {number|string}
 */
export function normalizeGraphId(rawId) {
  if (rawId == null) return rawId;
  if (typeof rawId === "number") return rawId;
  const trimmed = String(rawId).trim();
  if (trimmed === "") return rawId;
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed) && String(parsed) === trimmed) return parsed;
  return trimmed;
}

/**
 * Normalizes limit range for subsetting
 * @param {*} amountOrRange 
 * @param {number} maxFallback 
 * @returns {{min: number, max: number}}
 */
function normalizeLimitRange(amountOrRange, maxFallback) {
  if (typeof amountOrRange === "object" && amountOrRange !== null) {
    return {
      min: Math.max(0, parseInt(amountOrRange.min, 10) || 0),
      max: Math.max(1, parseInt(amountOrRange.max, 10) || maxFallback)
    };
  }
  const amt = Math.max(1, parseInt(amountOrRange, 10) || maxFallback);
  return { min: 0, max: amt };
}

/**
 * Normalizes element filter state
 * @param {Object} filters 
 * @returns {Object}
 */
export function normalizeElementFilterState(filters) {
  const source = filters && typeof filters === "object" ? filters : {};
  const asBool = (value, fallback) => {
    if (value === true || value === false) return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  };
  return {
    nodes: asBool(source.nodes, true),
    labels: asBool(source.labels, true),
    comment_boxes: asBool(source.comment_boxes, true),
    text_blocks: asBool(source.text_blocks, true),
    event_frames: asBool(source.event_frames, true),
    theme_lines: asBool(source.theme_lines, true),
    ole_objects: asBool(source.ole_objects, true)
  };
}

/**
 * Determines filter key from node annotationType
 * @param {Object} node 
 * @returns {string}
 */
export function getNodeElementFilterKey(node) {
  const annotationType = String((node && node.annotationType) || "").toLowerCase();
  if (annotationType === "label") return "labels";
  if (annotationType === "comment_box") return "comment_boxes";
  if (annotationType === "text_block") return "text_blocks";
  if (annotationType === "event_frame") return "event_frames";
  if (annotationType === "ole_object") return "ole_objects";
  return "nodes";
}

/**
 * Utility to extract deep numeric or string property from node
 * @param {Object} node 
 * @param {string} key 
 * @returns {*}
 */
function getNodeValue(node, key) {
  if (!node || !key) return null;
  const parts = key.split(".");
  let current = node;
  for (const part of parts) {
    if (current == null) return null;
    current = current[part];
  }
  return current;
}

/**
 * Determines if an edge is a theme line
 * @param {Object} edge 
 * @returns {boolean}
 */
function isThemeLineEdge(edge) {
  if (!edge || typeof edge !== "object") return false;
  return String(edge.edge_kind || "").toLowerCase() === "theme_line";
}


/**
 * Central state and logic store for graph data windowing and filtering
 */
export default class GraphStore {
  /**
   * @param {Object} [options]
   * @param {number} [options.nodeLimit=25]
   */
  constructor(options = {}) {
    this.nodes = new Map();        // id -> base node
    this.edges = new Map();        // id -> base edge
    this.adjacency = new Map();    // id -> Set<neighborId>
    
    // Lazy reverse index
    this.edgesByNode = null;       // Map<nodeId, Set<edgeId>>

    this.visibleNodes = new Set();
    this.visibleEdges = new Set();
    
    this.limit = options.nodeLimit ?? 25;
    this.limitMin = 0;
    this.limitMax = this.limit;
  }

  get nodeCount() {
    return this.nodes.size;
  }

  get edgeCount() {
    return this.edges.size;
  }

  clear() {
    this.nodes.clear();
    this.edges.clear();
    this.adjacency.clear();
    this.edgesByNode = null;
    this.visibleNodes.clear();
    this.visibleEdges.clear();
  }

  /**
   * Clears and loads new graph data
   * @param {Object} data 
   * @param {Array<Object>} [data.nodes]
   * @param {Array<Object>} [data.edges]
   */
  setGraph(data) {
    this.clear();
    if (!data) return;

    if (Array.isArray(data.nodes)) {
      for (const rawNode of data.nodes) {
        const id = normalizeGraphId(rawNode.id);
        const node = { ...rawNode, id };
        this.nodes.set(id, node);
        this.adjacency.set(id, new Set());
      }
    }

    if (Array.isArray(data.edges)) {
      for (const rawEdge of data.edges) {
        const from = normalizeGraphId(rawEdge.from);
        const to = normalizeGraphId(rawEdge.to);
        const id = rawEdge.id != null ? normalizeGraphId(rawEdge.id) : `${from}_${to}`;
        
        const edge = {
          ...rawEdge,
          id,
          from,
          to,
          width: rawEdge.weight ?? 1,
          title: rawEdge.title || undefined
        };
        
        this.edges.set(id, edge);
        
        const fromSet = this.adjacency.get(from);
        if (fromSet) fromSet.add(to);
        const toSet = this.adjacency.get(to);
        if (toSet) toSet.add(from);
      }
    }
  }

  /**
   * Get node by id
   * @param {string|number} id 
   * @returns {Object|undefined}
   */
  getNode(id) {
    return this.nodes.get(normalizeGraphId(id));
  }

  /**
   * Get edge by id
   * @param {string|number} id 
   * @returns {Object|undefined}
   */
  getEdge(id) {
    return this.edges.get(normalizeGraphId(id));
  }

  /**
   * Get all neighbor nodes ids
   * @param {string|number} id 
   * @returns {Set<string|number>}
   */
  getNeighborIds(id) {
    return this.adjacency.get(normalizeGraphId(id)) || new Set();
  }

  /**
   * Internally maintains a Map<nodeId, Set<edgeId>> for fast lookup
   * @returns {Map<string|number, Set<string|number>>}
   */
  _ensureEdgesByNodeIndex() {
    if (this.edgesByNode) {
      return this.edgesByNode;
    }
    
    const index = new Map();
    for (const nodeId of this.nodes.keys()) {
      index.set(nodeId, new Set());
    }

    for (const [edgeId, edge] of this.edges) {
      if (!index.has(edge.from)) index.set(edge.from, new Set());
      if (!index.has(edge.to)) index.set(edge.to, new Set());
      index.get(edge.from).add(edgeId);
      index.get(edge.to).add(edgeId);
    }

    this.edgesByNode = index;
    return index;
  }

  /**
   * Get all edge ids connected to a specific node
   * @param {string|number} id 
   * @returns {Set<string|number>}
   */
  getEdgesForNode(id) {
    const index = this._ensureEdgesByNodeIndex();
    return index.get(normalizeGraphId(id)) || new Set();
  }

  /**
   * Re-evaluates visible subset of nodes and edges applying sorting and limits
   * @param {Object} options 
   * @param {string} [options.key=""]
   * @param {string} [options.sort="asc"]
   * @param {number|Object} [options.amount=25]
   * @param {number} [options.min=null]
   * @param {number} [options.max=null]
   */
  computeVisibleSubset({ key = "", sort = "asc", amount = 25, min = null, max = null }) {
    const baseRange = normalizeLimitRange(amount, 25);
    const resolvedRange = normalizeLimitRange({
      min: min == null ? baseRange.min : min,
      max: max == null ? baseRange.max : max
    }, baseRange.max);
    
    const rangeMin = resolvedRange.min;
    const rangeMax = resolvedRange.max;
    const rangeCount = Math.max(1, rangeMax - rangeMin);

    this.limit = rangeCount;
    this.limitMin = rangeMin;
    this.limitMax = rangeMax;

    this.visibleNodes.clear();
    this.visibleEdges.clear();

    if (!key || this.nodes.size > 10000) {
      const iterator = this.nodes.keys();
      let idx = 0;
      for (;;) {
        const { value, done } = iterator.next();
        if (done) break;
        if (idx >= rangeMin && idx < rangeMax) {
          this.visibleNodes.add(value);
        }
        if (idx >= rangeMax) break;
        idx += 1;
      }
    } else {
      const nodesArr = [];
      for (const [id, node] of this.nodes) {
        const value = getNodeValue(node, key);
        if (value != null) nodesArr.push({ id, value });
      }

      nodesArr.sort((a, b) => {
        if (a.value == null && b.value == null) return 0;
        if (a.value == null) return 1;
        if (b.value == null) return -1;

        if (typeof a.value === "number" && typeof b.value === "number") {
          return sort === "asc" ? a.value - b.value : b.value - a.value;
        }

        const aStr = String(a.value);
        const bStr = String(b.value);

        const aNum = parseFloat(aStr);
        const bNum = parseFloat(bStr);
        if (!isNaN(aNum) && !isNaN(bNum)) {
          return sort === "asc" ? aNum - bNum : bNum - aNum;
        }
        return sort === "asc"
          ? aStr.localeCompare(bStr, undefined, { numeric: true })
          : bStr.localeCompare(aStr, undefined, { numeric: true });
      });

      const end = Math.min(rangeMax, nodesArr.length);
      for (let i = rangeMin; i < end; i++) {
        this.visibleNodes.add(nodesArr[i].id);
      }
    }

    this.recomputeVisibleEdges();
  }

  /**
   * Rebuilds the visible edges set depending strictly on currently visible nodes
   */
  recomputeVisibleEdges() {
    this.visibleEdges.clear();

    if (this.visibleNodes.size === 0) return;

    const useIndexedPath = this.visibleNodes.size < (this.nodes.size * 0.65);
    
    if (useIndexedPath) {
      const edgesByNode = this._ensureEdgesByNodeIndex();
      const candidateEdgeIds = new Set();
      
      this.visibleNodes.forEach(nodeId => {
        const edgeIds = edgesByNode.get(nodeId);
        if (!edgeIds) return;
        edgeIds.forEach(edgeId => candidateEdgeIds.add(edgeId));
      });

      candidateEdgeIds.forEach(edgeId => {
        const edge = this.edges.get(edgeId);
        if (!edge) return;
        if (this.visibleNodes.has(edge.from) && this.visibleNodes.has(edge.to)) {
          this.visibleEdges.add(edgeId);
        }
      });
      return;
    }

    for (const [id, edge] of this.edges) {
      if (this.visibleNodes.has(edge.from) && this.visibleNodes.has(edge.to)) {
        this.visibleEdges.add(id);
      }
    }
  }

  /**
   * Tests if a given node is visible based on element type filters
   * @param {Object} node 
   * @param {Object} state 
   * @returns {boolean}
   */
  isNodeVisibleByTypeFilter(node, state) {
    const key = getNodeElementFilterKey(node);
    return !!state[key];
  }

  /**
   * Determines the true visible subset taking into account user element filters
   * @param {Object} elementFilters 
   * @returns {{nodeIds: Set<string|number>, edgeIds: Set<string|number>}}
   */
  getFilteredVisibleIds(elementFilters) {
    const state = normalizeElementFilterState(elementFilters);
    const nodeIds = new Set();

    for (const nodeId of this.visibleNodes) {
      const node = this.nodes.get(nodeId);
      if (!node) continue;
      
      if (!this.isNodeVisibleByTypeFilter(node, state)) continue;
      nodeIds.add(nodeId);
    }

    const edgeIds = new Set();
    for (const edgeId of this.visibleEdges) {
      const edge = this.edges.get(edgeId);
      if (!edge) continue;
      
      if (isThemeLineEdge(edge) && !state.theme_lines) continue;
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
      
      edgeIds.add(edgeId);
    }

    return { nodeIds, edgeIds };
  }

  /**
   * Extracts all distinct property keys from nodes present in the graph
   * @returns {Array<string>}
   */
  getAllPropertyKeys() {
    const keys = new Set();
    for (const node of this.nodes.values()) {
      if (node && typeof node === "object") {
        Object.keys(node).forEach(k => keys.add(k));
      }
    }
    return Array.from(keys);
  }
}
