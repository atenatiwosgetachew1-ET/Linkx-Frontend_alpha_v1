// Graph analysis tools (graph-chart-plan G2.3), ported from production
// graphs_adjuster.js. They work on the window's graphology graph (string
// node keys) and, where production used VISIBLE_STATE, on the visible ids.
//
// Deliberate differences, each noted at the function:
// - weighted shortest path uses a binary heap (same costs; production's
//   linear scan was O(n²)); ties between equal-cost paths may differ;
// - all-paths and cut points are iterative / step-bounded so a large graph
//   cannot freeze the window (production recursed without a budget);
// - degree / property colours are real hex colours (production passed
//   "hsl(…)" to a hex-only colour helper, which produced "#hsl(…)").

import { getNodeValue } from './graphModel.js';
import { toFiniteNumber } from './graphSearch.js';

/* ── Shared helpers ─────────────────────────────────────────────────── */

// GA:3938 isThemeLineEdge
export const isThemeLineEdge = (edge) => String(edge?.edge_kind || '').toLowerCase() === 'theme_line';

// GA:3955 getEdgeTraversalWeight
export const edgeTraversalWeight = (edge) => {
  const numeric = toFiniteNumber(edge?.weight ?? edge?.value ?? edge?.width);
  return numeric == null || numeric <= 0 ? 1 : numeric;
};

// GA:3961 getTraversableEdges -> [{ edgeId, to, cost }]
export const traversableEdges = (graph, nodeId, { directed = false, includeThemeLines = false } = {}) => {
  const result = [];
  if (!graph.hasNode(nodeId)) return result;
  graph.forEachEdge(nodeId, (edgeId, attributes, source, target) => {
    if (!includeThemeLines && isThemeLineEdge(attributes)) return;
    if (directed) {
      if (source !== nodeId) return;
      result.push({ edgeId, to: target, cost: edgeTraversalWeight(attributes) });
      return;
    }
    if (source === nodeId) result.push({ edgeId, to: target, cost: edgeTraversalWeight(attributes) });
    else if (target === nodeId) result.push({ edgeId, to: source, cost: edgeTraversalWeight(attributes) });
  });
  return result;
};

// GA:1158 normalizePathOptions; path mode names from runPathFinderForSelection.
export const PATH_MODES = [
  { id: 'hops', label: 'Fewest hops', directed: false, weighted: false },
  { id: 'directed_hops', label: 'Fewest hops, following edge direction', directed: true, weighted: false },
  { id: 'weighted', label: 'Lowest total weight', directed: false, weighted: true },
  { id: 'directed_weighted', label: 'Lowest total weight, following edge direction', directed: true, weighted: true },
];
export const normalizePathOptions = (options) => {
  const source = options && typeof options === 'object' ? options : {};
  return {
    directed: source.directed === true || source.directed === 'true',
    weighted: source.weighted === true || source.weighted === 'true',
    includeThemeLines: source.includeThemeLines === true || source.includeThemeLines === 'true',
  };
};
export const pathModeOf = ({ directed, weighted }) => {
  if (weighted) return directed ? 'directed_weighted' : 'weighted';
  return directed ? 'directed_hops' : 'hops';
};

/* ── Shortest path (GA:4039 findShortestPath) ───────────────────────── */

const noPath = (options) => ({ path: [], edgeIds: [], totalCost: Number.POSITIVE_INFINITY, ...options });

const reconstruct = (start, end, previousNode, previousEdge, totalCost, options) => {
  if (start !== end && !previousNode.has(end)) return noPath(options);
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
  return { path: path.reverse(), edgeIds: edgeIds.reverse(), totalCost, ...options };
};

// Minimal binary heap of [priority, value].
const createHeap = () => {
  const items = [];
  const swap = (a, b) => {
    [items[a], items[b]] = [items[b], items[a]];
  };
  return {
    size: () => items.length,
    push: (priority, value) => {
      items.push([priority, value]);
      let i = items.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (items[parent][0] <= items[i][0]) break;
        swap(i, parent);
        i = parent;
      }
    },
    pop: () => {
      const top = items[0];
      const last = items.pop();
      if (items.length) {
        items[0] = last;
        let i = 0;
        for (;;) {
          const left = 2 * i + 1;
          const right = left + 1;
          let smallest = i;
          if (left < items.length && items[left][0] < items[smallest][0]) smallest = left;
          if (right < items.length && items[right][0] < items[smallest][0]) smallest = right;
          if (smallest === i) break;
          swap(i, smallest);
          i = smallest;
        }
      }
      return top;
    },
  };
};

export const findShortestPath = (graph, startId, endId, rawOptions = {}) => {
  const options = normalizePathOptions(rawOptions);
  const start = String(startId);
  const end = String(endId);
  if (!graph.hasNode(start) || !graph.hasNode(end)) return noPath(options);
  if (start === end) return { path: [start], edgeIds: [], totalCost: 0, ...options };
  const previous = new Map();
  const previousEdge = new Map();

  if (!options.weighted) {
    const queue = [start];
    const visited = new Set([start]);
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      for (const next of traversableEdges(graph, current, options)) {
        if (visited.has(next.to)) continue;
        visited.add(next.to);
        previous.set(next.to, current);
        previousEdge.set(next.to, next.edgeId);
        if (next.to === end) {
          const result = reconstruct(start, end, previous, previousEdge, 0, options);
          result.totalCost = Math.max(0, result.path.length - 1);
          return result;
        }
        queue.push(next.to);
      }
    }
    return noPath(options);
  }

  const distances = new Map([[start, 0]]);
  const settled = new Set();
  const heap = createHeap();
  heap.push(0, start);
  while (heap.size()) {
    const [distance, current] = heap.pop();
    if (settled.has(current) || distance > (distances.get(current) ?? Infinity)) continue;
    if (current === end) break;
    settled.add(current);
    traversableEdges(graph, current, options).forEach((next) => {
      const candidate = distance + next.cost;
      if (candidate < (distances.get(next.to) ?? Infinity)) {
        distances.set(next.to, candidate);
        previous.set(next.to, current);
        previousEdge.set(next.to, next.edgeId);
        heap.push(candidate, next.to);
      }
    });
  }
  const cost = distances.get(end);
  return reconstruct(start, end, previous, previousEdge, Number.isFinite(cost) ? cost : Infinity, options);
};

/* ── All simple paths (GA findAllSimplePaths) ───────────────────────── */

export const ALL_PATHS_LIMITS = Object.freeze({ defaultDepth: 6, maxDepth: 12, defaultPaths: 400, maxPaths: 2000 });
// Steps (edges looked at) before the search stops; keeps hub-heavy graphs
// from freezing the window. Production had no budget.
export const ALL_PATHS_STEP_BUDGET = 2000000;

// -> { paths: [{ path, edgeIds }], truncated }
export const findAllSimplePaths = (graph, startId, endId, rawOptions = {}) => {
  const options = {
    directed: rawOptions.directed === true,
    includeThemeLines: rawOptions.includeThemeLines === true,
    maxDepth: Math.max(1, Math.min(ALL_PATHS_LIMITS.maxDepth, Number(rawOptions.maxDepth) || ALL_PATHS_LIMITS.defaultDepth)),
    maxPaths: Math.max(1, Math.min(ALL_PATHS_LIMITS.maxPaths, Number(rawOptions.maxPaths) || ALL_PATHS_LIMITS.defaultPaths)),
  };
  const budget = rawOptions.stepBudget || ALL_PATHS_STEP_BUDGET;
  const start = String(startId);
  const end = String(endId);
  if (!graph.hasNode(start) || !graph.hasNode(end)) return { paths: [], truncated: false };
  if (start === end) return { paths: [{ path: [start], edgeIds: [] }], truncated: false };

  const paths = [];
  const stackNodes = [start];
  const stackEdges = [];
  const visited = new Set([start]);
  let steps = 0;
  let outOfBudget = false;
  const dfs = (current, depth) => {
    if (paths.length >= options.maxPaths || outOfBudget) return;
    if (depth > options.maxDepth) return;
    if (current === end) {
      paths.push({ path: [...stackNodes], edgeIds: [...stackEdges] });
      return;
    }
    for (const next of traversableEdges(graph, current, options)) {
      steps += 1;
      if (steps > budget) {
        outOfBudget = true;
        return;
      }
      if (visited.has(next.to)) continue;
      visited.add(next.to);
      stackNodes.push(next.to);
      stackEdges.push(next.edgeId);
      dfs(next.to, depth + 1); // depth ≤ 12: recursion is safe
      stackEdges.pop();
      stackNodes.pop();
      visited.delete(next.to);
      if (paths.length >= options.maxPaths || outOfBudget) return;
    }
  };
  dfs(start, 0);
  return { paths, truncated: outOfBudget || paths.length >= options.maxPaths, maxDepth: options.maxDepth };
};

/* ── Cut points (GA findVisibleCutPoints) ───────────────────────────── */

// Articulation points of the visible graph (undirected, self-loops and
// parallel edges ignored). Iterative Tarjan: same result as production's
// recursive version, without a stack overflow on long chains.
export const findCutPoints = (graph, visibleIds) => {
  const visible = new Set([...visibleIds].map(String).filter((id) => graph.hasNode(id)));
  const adjacency = new Map([...visible].map((id) => [id, new Set()]));
  visible.forEach((id) => {
    graph.forEachNeighbor(id, (other) => {
      if (other !== id && visible.has(other)) adjacency.get(id).add(other);
    });
  });
  const discovery = new Map();
  const low = new Map();
  const cutPoints = new Set();
  let time = 0;
  visible.forEach((root) => {
    if (discovery.has(root)) return;
    discovery.set(root, ++time);
    low.set(root, time);
    let rootChildren = 0;
    const stack = [{ node: root, parent: null, neighbours: adjacency.get(root).values() }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const step = frame.neighbours.next();
      if (!step.done) {
        const next = step.value;
        if (!discovery.has(next)) {
          if (frame.node === root) rootChildren += 1;
          discovery.set(next, ++time);
          low.set(next, time);
          stack.push({ node: next, parent: frame.node, neighbours: adjacency.get(next).values() });
        } else if (next !== frame.parent) {
          low.set(frame.node, Math.min(low.get(frame.node), discovery.get(next)));
        }
        continue;
      }
      stack.pop();
      const parent = frame.parent;
      if (parent != null) {
        low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
        if (parent !== root && low.get(frame.node) >= discovery.get(parent)) cutPoints.add(parent);
      }
    }
    if (rootChildren > 1) cutPoints.add(root);
  });
  return [...cutPoints];
};

/* ── Communities (GA:5233 buildVisibleCommunityGraph, GA:5273) ──────── */

const increment = (map, key, amount = 1) => map.set(key, (map.get(key) || 0) + amount);
const topKey = (counter) => {
  let winner = '';
  let winnerCount = -1;
  counter.forEach((count, key) => {
    if (count > winnerCount || (count === winnerCount && String(key) < String(winner))) {
      winner = key;
      winnerCount = count;
    }
  });
  return winner;
};
const communityRelationship = (edge) => {
  const value = edge?.rel_type ?? edge?.relationship ?? edge?.type ?? edge?.label ?? 'Unspecified';
  return String(value == null ? '' : value).trim() || 'Unspecified';
};
const isCommunityNode = (attributes) => String(attributes?.annotationType || '').trim() === '';

// Relationship-weighted label propagation, 14 rounds; communities largest
// first. -> [[nodeId, …], …]
export const detectCommunities = (graph, visibleIds, visibleEdgeIds, { includeThemeLines = false } = {}) => {
  const nodeIds = [...visibleIds].map(String)
    .filter((id) => graph.hasNode(id) && isCommunityNode(graph.getNodeAttributes(id)))
    .sort();
  if (!nodeIds.length) return [];
  const visible = new Set(nodeIds);
  const labelFrequency = new Map();
  const usable = [];
  visibleEdgeIds.forEach((edgeId) => {
    if (!graph.hasEdge(edgeId)) return;
    const edge = graph.getEdgeAttributes(edgeId);
    if (!includeThemeLines && isThemeLineEdge(edge)) return;
    const from = graph.source(edgeId);
    const to = graph.target(edgeId);
    if (!visible.has(from) || !visible.has(to) || from === to) return;
    const relationship = communityRelationship(edge);
    increment(labelFrequency, relationship);
    usable.push({ from, to, relationship });
  });

  const adjacency = new Map(nodeIds.map((id) => [id, new Map()]));
  const relationshipCounts = new Map(nodeIds.map((id) => [id, new Map()]));
  const link = (from, to, relationship, weight) => {
    const neighbours = adjacency.get(from);
    const current = neighbours.get(to) || { weight: 0, labels: new Map() };
    current.weight += weight;
    increment(current.labels, relationship, weight);
    neighbours.set(to, current);
  };
  usable.forEach((edge) => {
    const frequency = Math.max(1, labelFrequency.get(edge.relationship) || 1);
    const rarityBoost = Math.min(2.5, Math.sqrt(usable.length / frequency) / 3);
    const weight = 1 + rarityBoost;
    link(edge.from, edge.to, edge.relationship, weight);
    link(edge.to, edge.from, edge.relationship, weight);
    increment(relationshipCounts.get(edge.from), edge.relationship);
    increment(relationshipCounts.get(edge.to), edge.relationship);
  });

  const labels = new Map(nodeIds.map((id) => [id, id]));
  const dominant = new Map(nodeIds.map((id) => [id, topKey(relationshipCounts.get(id))]));
  const ordered = [...nodeIds].sort((a, b) => (adjacency.get(b).size - adjacency.get(a).size) || a.localeCompare(b));
  for (let round = 0; round < 14; round += 1) {
    let changed = false;
    ordered.forEach((id) => {
      const neighbours = adjacency.get(id);
      if (!neighbours.size) return;
      const scores = new Map();
      const nodeDominant = dominant.get(id);
      neighbours.forEach((info, neighbour) => {
        const neighbourLabel = labels.get(neighbour);
        if (!neighbourLabel) return;
        const bonus = nodeDominant && topKey(info.labels) === nodeDominant ? 1.35 : 1;
        increment(scores, neighbourLabel, info.weight * bonus);
      });
      let best = labels.get(id);
      let bestScore = scores.get(best) || 0;
      scores.forEach((score, label) => {
        if (score > bestScore || (score === bestScore && String(label) < String(best))) {
          best = label;
          bestScore = score;
        }
      });
      if (best !== labels.get(id)) {
        labels.set(id, best);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const grouped = new Map();
  nodeIds.forEach((id) => {
    const label = labels.get(id) || id;
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label).push(id);
  });
  return [...grouped.values()]
    .map((members) => members.sort())
    .sort((a, b) => b.length - a.length || String(a[0]).localeCompare(String(b[0])));
};

// GA separateCommunityLayout: each community moved (kept in shape) so its
// centre sits on a ring. -> { id: {x, y} } for the moved nodes.
export const separateCommunities = (communities, positionOf) => {
  const groups = communities.filter((group) => group.length);
  if (groups.length <= 1) return {};
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  const radius = Math.max(220, Math.min(1600, Math.sqrt(total) * 80));
  const step = (Math.PI * 2) / groups.length;
  const moved = {};
  groups.forEach((group, index) => {
    const placed = group.map((id) => [id, positionOf(id)]).filter(([, p]) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!placed.length) return;
    const centre = placed.reduce((acc, [, p]) => ({ x: acc.x + p.x / placed.length, y: acc.y + p.y / placed.length }), { x: 0, y: 0 });
    const angle = index * step - Math.PI / 2;
    const dx = Math.cos(angle) * radius - centre.x;
    const dy = Math.sin(angle) * radius - centre.y;
    placed.forEach(([id, p]) => {
      moved[id] = { x: p.x + dx, y: p.y + dy };
    });
  });
  return moved;
};

/* ── Colours (GA hslToHex, generatePaletteColor, buildNodeColor) ────── */

export const hslToHex = (h, s, l) => {
  const hue = (((Number(h) || 0) % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, Number(s) || 0)) / 100;
  const light = Math.max(0, Math.min(100, Number(l) || 0)) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rgb;
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return `#${rgb.map((value) => `0${Math.round((value + m) * 255).toString(16)}`.slice(-2)).join('')}`;
};

export const paletteColor = (index, total) => {
  const safeTotal = Math.max(1, total);
  return hslToHex(Math.round((index % safeTotal) * (360 / safeTotal)), 62, 55);
};

// GA darkenColor: each channel × (100 − percent) / 100.
export const darkenHex = (hex, percent) => {
  const value = String(hex).replace(/^#/, '');
  const channel = (offset) => Math.round(Math.max(0, Math.min(255, (parseInt(value.substring(offset, offset + 2), 16) * (100 - percent)) / 100)));
  return `#${[0, 2, 4].map((offset) => `0${channel(offset).toString(16)}`.slice(-2)).join('')}`;
};

// The parts of production's buildNodeColor the renderer uses.
export const nodeColor = (hex) => ({ background: hex, border: darkenHex(hex, 20) });

/* ── Visual encodings (GA:3735, GA:3764, GA:3709) ───────────────────── */

const SKIP_KEYS = new Set(['id', 'x', 'y', 'vx', 'vy', 'title', 'label', 'color', 'font', 'shape', 'image', 'iconPath']);

// GA inferDynamicNodeKeys: numeric and text keys, most common first.
export const inferNodeKeys = (nodes) => {
  const numeric = new Set();
  const categorical = new Set();
  const counters = new Map();
  nodes.forEach((node) => {
    Object.entries(node || {}).forEach(([key, value]) => {
      if (SKIP_KEYS.has(key) || value == null || value === '') return;
      if (toFiniteNumber(value) != null) numeric.add(key);
      else categorical.add(key);
      increment(counters, key);
    });
  });
  const byCoverage = (a, b) => (counters.get(b) || 0) - (counters.get(a) || 0);
  return { numeric: [...numeric].sort(byCoverage), categorical: [...categorical].sort(byCoverage) };
};

// -> [[id, { size, color }]] (production persistNodeChange patches)
export const degreeEncoding = (graph, visibleIds) => {
  const visible = new Set([...visibleIds].map(String));
  const degrees = new Map();
  let maxDegree = 1;
  visible.forEach((id) => {
    if (!graph.hasNode(id)) return;
    let degree = 0;
    graph.forEachNeighbor(id, (other) => {
      if (visible.has(other)) degree += 1;
    });
    degrees.set(id, degree);
    maxDegree = Math.max(maxDegree, degree);
  });
  return [...degrees].map(([id, degree]) => {
    const ratio = degree / maxDegree;
    return [id, { size: 14 + ratio * 26, color: nodeColor(hslToHex(Math.round(220 - ratio * 180), 70, 58)) }];
  });
};

export const propertyEncoding = (graph, visibleIds, propertyKey) => {
  const key = String(propertyKey || '').trim();
  const ids = [...visibleIds].map(String).filter((id) => graph.hasNode(id));
  if (!key || !ids.length) return [];
  const values = new Map(ids.map((id) => [id, getNodeValue(graph.getNodeAttributes(id), key)]));
  const numbers = [];
  const categories = new Set();
  values.forEach((value) => {
    const number = toFiniteNumber(value);
    if (number != null) numbers.push(number);
    else if (value != null && String(value).trim() !== '') categories.add(String(value));
  });
  const useNumeric = numbers.length >= Math.max(4, Math.floor(ids.length * 0.35));
  const min = useNumeric ? Math.min(...numbers) : 0;
  const max = useNumeric ? Math.max(...numbers) : 1;
  const sorted = [...categories].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const categoryColor = new Map(sorted.map((category, index) => [category, paletteColor(index, sorted.length)]));
  return ids.map((id) => {
    const value = values.get(id);
    const number = toFiniteNumber(value);
    let ratio = 0.5;
    let color = '#5a8ac6';
    if (useNumeric && number != null && max > min) {
      ratio = (number - min) / (max - min);
      color = hslToHex(Math.round(220 - ratio * 180), 72, 56);
    } else if (!useNumeric && value != null && categoryColor.has(String(value))) {
      color = categoryColor.get(String(value));
    }
    return [id, { size: 13 + ratio * 24, color: nodeColor(color) }];
  });
};

/* ── Element type filter (GA:821, GA:839, GA:888) ───────────────────── */

export const ELEMENT_TYPES = [
  { id: 'nodes', label: 'Nodes', description: 'Entity nodes' },
  { id: 'labels', label: 'Labels', description: 'Label elements' },
  { id: 'comment_boxes', label: 'Comment boxes', description: 'Comment containers' },
  { id: 'text_blocks', label: 'Text blocks', description: 'Text block annotations' },
  { id: 'event_frames', label: 'Event frames', description: 'Event frame annotations' },
  { id: 'theme_lines', label: 'Theme lines', description: 'Theme line edges' },
  { id: 'ole_objects', label: 'OLE Objects', description: 'Embedded object nodes' },
];
export const DEFAULT_ELEMENT_FILTERS = Object.freeze(Object.fromEntries(ELEMENT_TYPES.map((type) => [type.id, true])));

export const normalizeElementFilters = (filters) => {
  const source = filters && typeof filters === 'object' ? filters : {};
  const asBool = (value) => (value === false || value === 'false' ? false : true);
  return Object.fromEntries(ELEMENT_TYPES.map((type) => [type.id, asBool(source[type.id])]));
};

const ANNOTATION_FILTER_KEY = {
  label: 'labels',
  comment_box: 'comment_boxes',
  text_block: 'text_blocks',
  event_frame: 'event_frames',
  ole_object: 'ole_objects',
};
export const nodeFilterKey = (node) => ANNOTATION_FILTER_KEY[String(node?.annotationType || '').toLowerCase()] || 'nodes';

// The view with hidden element types left out (production
// getFilteredVisibleGraphIds). Returns `view` itself when nothing is hidden.
export const applyElementFilters = (graph, view, filters) => {
  const state = normalizeElementFilters(filters);
  if (ELEMENT_TYPES.every((type) => state[type.id])) return view;
  const nodeIds = view.nodeIds.filter((id) => graph.hasNode(id) && state[nodeFilterKey(graph.getNodeAttributes(id))]);
  const kept = new Set(nodeIds);
  const edgeIds = view.edgeIds.filter((edgeId) => {
    if (!graph.hasEdge(edgeId)) return false;
    if (isThemeLineEdge(graph.getEdgeAttributes(edgeId)) && !state.theme_lines) return false;
    return kept.has(graph.source(edgeId)) && kept.has(graph.target(edgeId));
  });
  return { ...view, nodeIds, edgeIds, filtered: true };
};
