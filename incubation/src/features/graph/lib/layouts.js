// Layouts ported from production's graph iframe (graphs_adjuster.js
// applyManualLayout ~6506). Pure: they take the visible node ids and the
// undirected neighbour index and return { id: {x, y} }. Run in the layout
// worker (workers/layout.worker.js); also unit-tested directly.

// GA:6248
export const layoutRadius = (nodeCount, baseRadius = 200, step = 16, maxRadius = 1800) => (
  Math.max(baseRadius, Math.min(maxRadius, nodeCount * step))
);

// GA:6221: distinct visible neighbours.
const visibleNeighbourCount = (id, neighbours, visible) => {
  let count = 0;
  (neighbours.get(id) || []).forEach((other) => {
    if (visible.has(other)) count += 1;
  });
  return count;
};

// Production default layout (GA:6657): rank by visible degree (ties by id,
// natural order), one node at the centre, then rings of max(6, ring × 10).
export const concentricLayout = (nodeIds, neighbours) => {
  const visible = new Set(nodeIds);
  const ranked = nodeIds
    .map((id) => ({ id, degree: visibleNeighbourCount(id, neighbours, visible) }))
    .sort((a, b) => (b.degree !== a.degree ? b.degree - a.degree : String(a.id).localeCompare(String(b.id), undefined, { numeric: true })));
  const ringGap = Math.max(90, Math.min(220, Math.round(layoutRadius(nodeIds.length, 180, 2, 320))));
  const positions = {};
  let cursor = 0;
  let ring = 0;
  while (cursor < ranked.length) {
    const capacity = ring === 0 ? 1 : Math.max(6, ring * 10);
    const ringNodes = ranked.slice(cursor, cursor + capacity);
    if (ring === 0) {
      positions[ringNodes[0].id] = { x: 0, y: 0 };
    } else {
      const radius = ring * ringGap;
      const step = (Math.PI * 2) / ringNodes.length;
      const offset = ring % 2 ? 0 : step / 2;
      ringNodes.forEach((entry, index) => {
        const angle = (-Math.PI / 2) + offset + (index * step);
        positions[entry.id] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
      });
    }
    cursor += ringNodes.length;
    ring += 1;
  }
  return positions;
};

// GA:6232 getLayoutCenterNode: the most connected visible node (first wins).
const centerNode = (nodeIds, neighbours, visible) => {
  let center = nodeIds[0];
  let best = -1;
  nodeIds.forEach((id) => {
    const degree = visibleNeighbourCount(id, neighbours, visible);
    if (degree > best) {
      best = degree;
      center = id;
    }
  });
  return center;
};

const ring = (ids, radius, offset = 0) => {
  const positions = {};
  const step = ids.length ? (Math.PI * 2) / ids.length : 0;
  ids.forEach((id, index) => {
    const angle = (-Math.PI / 2) + offset + (index * step);
    positions[id] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  return positions;
};

export const circleLayout = (nodeIds) => (
  nodeIds.length === 1 ? { [nodeIds[0]]: { x: 0, y: 0 } } : ring(nodeIds, layoutRadius(nodeIds.length, 220, 15, 1600))
);

export const starLayout = (nodeIds, neighbours) => {
  if (!nodeIds.length) return {};
  const visible = new Set(nodeIds);
  const center = centerNode(nodeIds, neighbours, visible);
  const others = nodeIds.filter((id) => id !== center);
  return { [center]: { x: 0, y: 0 }, ...ring(others, layoutRadius(others.length, 230, 18, 1700)) };
};

// Breadth-first layers from `root` over visible neighbours; unreachable
// nodes go one layer past the deepest (GA:6340 / radial ~6555).
const hopLayers = (nodeIds, neighbours, visible, root) => {
  const layerOf = new Map([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    (neighbours.get(current) || []).forEach((other) => {
      if (!visible.has(other) || layerOf.has(other)) return;
      layerOf.set(other, layerOf.get(current) + 1);
      queue.push(other);
    });
  }
  let deepest = 0;
  layerOf.forEach((layer) => { deepest = Math.max(deepest, layer); });
  nodeIds.forEach((id) => { if (!layerOf.has(id)) layerOf.set(id, deepest + 1); });
  const byLayer = new Map();
  nodeIds.forEach((id) => {
    const layer = layerOf.get(id) || 0;
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer).push(id);
  });
  return [...byLayer.keys()].sort((a, b) => a - b).map((layer) => byLayer.get(layer));
};

export const radialLayout = (nodeIds, neighbours) => {
  if (!nodeIds.length) return {};
  const visible = new Set(nodeIds);
  const layers = hopLayers(nodeIds, neighbours, visible, centerNode(nodeIds, neighbours, visible));
  const gap = layoutRadius(nodeIds.length, 140, 2, 260);
  const positions = {};
  layers.forEach((ids, layer) => {
    if (layer === 0) {
      positions[ids[0]] = { x: 0, y: 0 };
      return;
    }
    const step = ids.length ? (Math.PI * 2) / ids.length : 0;
    Object.assign(positions, ring(ids, layer * gap, layer % 2 ? step / 2 : 0));
  });
  return positions;
};

export const gridLayout = (nodeIds) => {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodeIds.length)));
  const rows = Math.max(1, Math.ceil(nodeIds.length / columns));
  const spacingX = Math.max(90, Math.min(260, Math.round(2000 / columns)));
  const spacingY = Math.max(90, Math.min(240, Math.round(1800 / rows)));
  const originX = -((columns - 1) * spacingX) / 2;
  const originY = -((rows - 1) * spacingY) / 2;
  const positions = {};
  nodeIds.forEach((id, index) => {
    positions[id] = { x: originX + ((index % columns) * spacingX), y: originY + (Math.floor(index / columns) * spacingY) };
  });
  return positions;
};

export const spiralLayout = (nodeIds) => {
  if (nodeIds.length === 1) return { [nodeIds[0]]: { x: 0, y: 0 } };
  const positions = {};
  nodeIds.forEach((id, index) => {
    const radius = 14 + (index * 9);
    const angle = (-Math.PI / 2) + (index * (Math.PI / 3.2));
    positions[id] = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  });
  return positions;
};

/* ── Layered (GA:6252-6474) ─────────────────────────────────────────── */

const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

// GA sortLayerNodes: barycentre of neighbours in the previous layer, then
// visible degree, then id.
const sortLayer = (ids, neighbours, visible, previousOrder) => {
  const barycentre = (id) => {
    if (!previousOrder) return Infinity;
    let total = 0;
    let count = 0;
    (neighbours.get(id) || []).forEach((other) => {
      if (previousOrder.has(other)) {
        total += previousOrder.get(other);
        count += 1;
      }
    });
    return count ? total / count : Infinity;
  };
  return [...ids].sort((a, b) => {
    const ba = barycentre(a);
    const bb = barycentre(b);
    const fa = Number.isFinite(ba);
    const fb = Number.isFinite(bb);
    if (fa && fb && ba !== bb) return ba - bb;
    if (fa !== fb) return fa ? -1 : 1;
    const da = visibleNeighbourCount(a, neighbours, visible);
    const db = visibleNeighbourCount(b, neighbours, visible);
    if (da !== db) return db - da;
    return naturalCompare(a, b);
  });
};

const orderLayers = (layers, neighbours, visible) => {
  let previous = null;
  return layers.map((ids) => {
    const sorted = sortLayer(ids, neighbours, visible, previous);
    previous = new Map(sorted.map((id, index) => [id, index]));
    return sorted;
  });
};

// GA:6252 getLayeredRootNode: a "source" node (most connected), else the centre.
const layeredRoot = (nodeIds, neighbours, visible, info) => {
  const sources = nodeIds.filter((id) => String(info[id]?.identity || '').toLowerCase().includes('source'));
  if (sources.length) {
    return sources.sort((a, b) => (visibleNeighbourCount(b, neighbours, visible) - visibleNeighbourCount(a, neighbours, visible)) || naturalCompare(a, b))[0];
  }
  return centerNode(nodeIds, neighbours, visible);
};

const identityRank = (identity) => {
  const value = String(identity || '').trim().toLowerCase();
  if (value.includes('source')) return 0;
  if (value.includes('entity')) return 1;
  if (value.includes('target')) return 2;
  return 3;
};

const identityLayers = (nodeIds, info) => {
  const groups = new Map();
  nodeIds.forEach((id) => {
    const identity = String(info[id]?.identity || 'Unspecified');
    if (!groups.has(identity)) groups.set(identity, []);
    groups.get(identity).push(id);
  });
  return [...groups.entries()]
    .sort((a, b) => (identityRank(a[0]) - identityRank(b[0])) || naturalCompare(a[0], b[0]))
    .map(([, ids]) => ids);
};

const toNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const numeric = Number(String(value ?? '').trim().replace(/,/g, ''));
  return String(value ?? '').trim() && Number.isFinite(numeric) ? numeric : null;
};

// Buckets by the layer key's value: numbers ascending, then text.
const propertyLayers = (nodeIds, info) => {
  const buckets = new Map();
  nodeIds.forEach((id) => {
    const raw = info[id]?.layerValue;
    const missing = raw == null || String(raw).trim() === '';
    const display = missing ? 'Unspecified' : String(raw);
    if (!buckets.has(display)) buckets.set(display, { display, numeric: missing ? null : toNumber(raw), ids: [] });
    buckets.get(display).ids.push(id);
  });
  return [...buckets.values()].sort((a, b) => {
    const an = Number.isFinite(a.numeric);
    const bn = Number.isFinite(b.numeric);
    if (an && bn && a.numeric !== b.numeric) return a.numeric - b.numeric;
    if (an !== bn) return an ? -1 : 1;
    return naturalCompare(a.display, b.display);
  }).map((bucket) => bucket.ids);
};

// Places layers as rows (UD) or columns (LR), as production applyLayeredLayout.
export const placeLayers = (layers, nodeCount, direction = 'UD') => {
  const cleaned = layers.filter((ids) => ids.length);
  if (!cleaned.length) return {};
  const largest = Math.max(...cleaned.map((ids) => ids.length), 1);
  const layerGap = Math.max(140, Math.min(320, Math.round(layoutRadius(nodeCount, 180, 2, 320))));
  const slotGap = Math.max(70, Math.min(200, Math.round(1700 / Math.max(3, largest + 1))));
  const primaryStart = -((cleaned.length - 1) * layerGap) / 2;
  const positions = {};
  cleaned.forEach((ids, layerIndex) => {
    const primary = primaryStart + (layerIndex * layerGap);
    const secondaryStart = -((ids.length - 1) * slotGap) / 2;
    ids.forEach((id, index) => {
      const secondary = secondaryStart + (index * slotGap);
      positions[id] = direction === 'LR' ? { x: primary, y: secondary } : { x: secondary, y: primary };
    });
  });
  return positions;
};

// options: { direction: 'UD'|'LR', layerMode: 'hop_distance'|'node_identity'|'by_key', info: { id: { identity, layerValue } } }
export const layeredLayout = (nodeIds, neighbours, { direction = 'UD', layerMode = 'hop_distance', info = {} } = {}) => {
  const visible = new Set(nodeIds);
  let layers;
  if (layerMode === 'node_identity') layers = identityLayers(nodeIds, info);
  else if (layerMode === 'by_key' && nodeIds.some((id) => info[id]?.layerValue !== undefined)) layers = propertyLayers(nodeIds, info);
  else layers = nodeIds.length ? hopLayers(nodeIds, neighbours, visible, layeredRoot(nodeIds, neighbours, visible, info)) : [];
  return placeLayers(orderLayers(layers, neighbours, visible), nodeIds.length, direction);
};

// vis-network hierarchical "hubsize": the biggest unplaced hub starts at
// level 0 and its neighbours follow level by level; repeated for the rest.
export const hubsizeLayout = (nodeIds, neighbours, { direction = 'UD' } = {}) => {
  const visible = new Set(nodeIds);
  const levelOf = new Map();
  const byDegree = [...nodeIds].sort((a, b) => (visibleNeighbourCount(b, neighbours, visible) - visibleNeighbourCount(a, neighbours, visible)) || naturalCompare(a, b));
  byDegree.forEach((hub) => {
    if (levelOf.has(hub)) return;
    levelOf.set(hub, 0);
    const queue = [hub];
    while (queue.length) {
      const current = queue.shift();
      (neighbours.get(current) || []).forEach((other) => {
        if (!visible.has(other) || levelOf.has(other)) return;
        levelOf.set(other, levelOf.get(current) + 1);
        queue.push(other);
      });
    }
  });
  const layers = [];
  nodeIds.forEach((id) => {
    const level = levelOf.get(id) || 0;
    (layers[level] = layers[level] || []).push(id);
  });
  return placeLayers(orderLayers(layers.filter(Boolean), neighbours, visible), nodeIds.length, direction);
};

/* ── Peacock and grouped (G3.5 i2 #6; after IBM i2 Analyst's Notebook; not
   in production; analyst decision 2026-11-17) ───────────────────────── */

const LEAF_GAP = 34; // between leaves on a fan ring
const FAN_FIRST = 70; // first fan ring's radius
const FAN_STEP = 42; // between fan rings
const NODE_ROOM = 34; // a node's own room
const CLUSTER_GAP = 60; // between footprints

// Leaves on rings around a hub: as many per ring as fit, outer rings for
// the rest. -> { offsets: [{x, y}], radius } (radius 0 without leaves).
const fanRings = (count) => {
  const offsets = [];
  let radius = 0;
  let placed = 0;
  for (let ringIndex = 0; placed < count; ringIndex += 1) {
    radius = FAN_FIRST + (ringIndex * FAN_STEP);
    const capacity = Math.max(6, Math.floor((Math.PI * 2 * radius) / LEAF_GAP));
    const here = Math.min(capacity, count - placed);
    const step = (Math.PI * 2) / here;
    const offset = ringIndex % 2 ? step / 2 : 0;
    for (let i = 0; i < here; i += 1) {
      const angle = (-Math.PI / 2) + offset + (i * step);
      offsets.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    }
    placed += here;
  }
  return { offsets, radius };
};

// Circles of the given radii, without overlap: the first in the middle, the
// rest on rings around it, each ring as far out as its largest needs.
// -> [{x, y}] in the same order.
const packAround = (radii) => {
  if (!radii.length) return [];
  const centres = [{ x: 0, y: 0 }];
  let inner = radii[0]; // reach of what is placed so far
  let index = 1;
  while (index < radii.length) {
    // One ring: as many as fit round it, in order.
    const start = index;
    let largest = radii[index];
    let ringRadius = inner + CLUSTER_GAP + largest;
    let used = 0;
    const angles = [];
    while (index < radii.length) {
      const r = radii[index];
      if (r > largest) {
        largest = r;
        ringRadius = inner + CLUSTER_GAP + largest;
      }
      const span = 2 * Math.asin(Math.min(1, (r + CLUSTER_GAP / 2) / ringRadius));
      if (index > start && used + span > Math.PI * 2) break;
      angles.push(span);
      used += span;
      index += 1;
    }
    // Spread the spare angle evenly.
    const spare = Math.max(0, (Math.PI * 2) - used) / angles.length;
    let angle = -Math.PI / 2;
    angles.forEach((span) => {
      const middle = angle + (span + spare) / 2;
      centres.push({ x: ringRadius * Math.cos(middle), y: ringRadius * Math.sin(middle) });
      angle += span + spare;
    });
    inner = ringRadius + largest;
  }
  return centres;
};

// Nodes without links: a grid under the rest.
const gridBelow = (ids, positions) => {
  if (!ids.length) return;
  // (No spread into Math.max: large graphs pass the argument limit.)
  const bottom = Object.values(positions).reduce((lowest, point) => Math.max(lowest, point.y), 0);
  const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length * 2)));
  const gap = 60;
  const originX = -((Math.min(columns, ids.length) - 1) * gap) / 2;
  ids.forEach((id, index) => {
    positions[id] = { x: originX + ((index % columns) * gap), y: bottom + 120 + (Math.floor(index / columns) * gap) };
  });
};

// Peacock: nodes with a single link (leaves) fan out round the node they
// hang from, on rings; those hubs and the other linked nodes are spread so
// no fans overlap, the biggest in the middle and its neighbours next; nodes
// without links go in a grid under them.
export const peacockLayout = (nodeIds, neighbours) => {
  if (!nodeIds.length) return {};
  const visible = new Set(nodeIds);
  const linked = (id) => [...(neighbours.get(id) || [])].filter((other) => visible.has(other) && other !== id);
  const degree = new Map(nodeIds.map((id) => [id, linked(id).length]));
  const isolated = [];
  const fans = new Map(); // hub -> leaves
  const core = [];
  nodeIds.forEach((id) => {
    const d = degree.get(id);
    if (d === 0) {
      isolated.push(id);
      return;
    }
    if (d === 1) {
      const [hub] = linked(id);
      // Two nodes linked only to each other: the first (natural order) is the hub.
      if (degree.get(hub) > 1 || naturalCompare(hub, id) < 0) {
        if (!fans.has(hub)) fans.set(hub, []);
        fans.get(hub).push(id);
        return;
      }
    }
    core.push(id);
  });
  const fanOf = new Map(core.map((id) => [id, fanRings((fans.get(id) || []).length)]));
  const room = (id) => Math.max(NODE_ROOM, fanOf.get(id).radius + LEAF_GAP / 2);
  // Order: from the biggest, breadth-first over the core, larger first.
  const size = (id) => ((fans.get(id) || []).length * 2) + degree.get(id);
  const bySize = [...core].sort((a, b) => (size(b) - size(a)) || naturalCompare(a, b));
  const coreSet = new Set(core);
  const order = [];
  const seen = new Set();
  bySize.forEach((startId) => {
    if (seen.has(startId)) return;
    seen.add(startId);
    const queue = [startId];
    while (queue.length) {
      const current = queue.shift();
      order.push(current);
      linked(current)
        .filter((other) => coreSet.has(other) && !seen.has(other))
        .sort((a, b) => (size(b) - size(a)) || naturalCompare(a, b))
        .forEach((other) => {
          seen.add(other);
          queue.push(other);
        });
    }
  });
  const centres = packAround(order.map(room));
  const positions = {};
  order.forEach((id, index) => {
    const centre = centres[index];
    positions[id] = centre;
    const leaves = (fans.get(id) || []).sort(naturalCompare);
    const { offsets } = fanOf.get(id);
    leaves.forEach((leaf, leafIndex) => {
      positions[leaf] = { x: centre.x + offsets[leafIndex].x, y: centre.y + offsets[leafIndex].y };
    });
  });
  gridBelow(isolated.sort(naturalCompare), positions);
  return positions;
};

// Grouped: one cluster per group (options.info[id].group: the node type or
// a property's value; 'Unspecified' when missing), each laid out round its
// most connected nodes (concentric inside the group); clusters packed in
// rows, the largest first.
export const groupedLayout = (nodeIds, neighbours, { info = {} } = {}) => {
  if (!nodeIds.length) return {};
  const groups = new Map();
  nodeIds.forEach((id) => {
    const raw = info[id]?.group;
    const name = raw == null || String(raw).trim() === '' ? 'Unspecified' : String(raw);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(id);
  });
  const clusters = [...groups.entries()]
    .sort((a, b) => (b[1].length - a[1].length) || naturalCompare(a[0], b[0]))
    .map(([name, ids]) => {
      const local = concentricLayout(ids, neighbours);
      let reach = 0;
      Object.values(local).forEach(({ x, y }) => { reach = Math.max(reach, Math.hypot(x, y)); });
      return { name, ids, local, radius: reach + NODE_ROOM };
    });
  // Rows about as wide as the whole is tall.
  const area = clusters.reduce((sum, cluster) => sum + (2 * cluster.radius + CLUSTER_GAP) ** 2, 0);
  const rowWidth = Math.max(2 * clusters[0].radius, Math.sqrt(area) * 1.3);
  const rows = [];
  let row = { items: [], width: 0, height: 0 };
  clusters.forEach((cluster) => {
    const width = 2 * cluster.radius;
    if (row.items.length && row.width + CLUSTER_GAP + width > rowWidth) {
      rows.push(row);
      row = { items: [], width: 0, height: 0 };
    }
    row.width += (row.items.length ? CLUSTER_GAP : 0) + width;
    row.height = Math.max(row.height, width);
    row.items.push(cluster);
  });
  rows.push(row);
  const total = rows.reduce((sum, entry) => sum + entry.height, 0) + CLUSTER_GAP * (rows.length - 1);
  const positions = {};
  let top = -total / 2;
  rows.forEach((entry) => {
    let left = -entry.width / 2;
    entry.items.forEach((cluster) => {
      const centre = { x: left + cluster.radius, y: top + entry.height / 2 };
      Object.entries(cluster.local).forEach(([id, point]) => {
        positions[id] = { x: centre.x + point.x, y: centre.y + point.y };
      });
      left += 2 * cluster.radius + CLUSTER_GAP;
    });
    top += entry.height + CLUSTER_GAP;
  });
  return positions;
};

export const LAYOUTS = {
  concentric: concentricLayout,
  circle: circleLayout,
  star: starLayout,
  radial: radialLayout,
  grid: gridLayout,
  spiral: spiralLayout,
  layered: layeredLayout,
  hubsize: hubsizeLayout,
  peacock: peacockLayout,
  grouped: groupedLayout,
};

// Undirected, distinct neighbour index from [source, target] pairs
// (production FULL_GRAPH.adjacency).
export const neighbourIndex = (edgePairs) => {
  const index = new Map();
  const link = (a, b) => {
    if (!index.has(a)) index.set(a, new Set());
    index.get(a).add(b);
  };
  edgePairs.forEach(([source, target]) => {
    if (source === target) return;
    link(source, target);
    link(target, source);
  });
  return index;
};

// Places nodes that joined an already drawn view (expand, double-click)
// without moving anything that is drawn: each new node goes on a ring
// around its first placed neighbour, fanned out away from the graph's
// centre; nodes with no placed neighbour go on a ring outside the drawing.
// `placed`: { id: {x, y} }. Returns positions for `newIds` only.
const NODE_SPACING = 45; // node diameter 30 + gap
export const placeNear = (newIds, placed, neighbours) => {
  const known = new Map(Object.entries(placed));
  const result = {};
  if (!newIds.length) return result;
  const all = [...known.values()];
  const centre = all.length
    ? { x: all.reduce((sum, p) => sum + p.x, 0) / all.length, y: all.reduce((sum, p) => sum + p.y, 0) / all.length }
    : { x: 0, y: 0 };

  const groups = new Map(); // anchor id -> new ids
  const loose = [];
  newIds.forEach((id) => {
    const anchor = [...(neighbours.get(id) || [])].find((other) => known.has(other));
    if (anchor === undefined) loose.push(id);
    else {
      if (!groups.has(anchor)) groups.set(anchor, []);
      groups.get(anchor).push(id);
    }
  });

  groups.forEach((ids, anchorId) => {
    const anchor = known.get(anchorId);
    const k = ids.length;
    const away = Math.atan2(anchor.y - centre.y, anchor.x - centre.x) || 0;
    const step = Math.min((2 * Math.PI) / k, 0.6);
    const radius = Math.max(120, NODE_SPACING / step);
    ids.forEach((id, i) => {
      const angle = away + (i - (k - 1) / 2) * step;
      result[id] = { x: anchor.x + radius * Math.cos(angle), y: anchor.y + radius * Math.sin(angle) };
    });
  });

  if (loose.length) {
    const reach = all.length ? Math.max(...all.map((p) => Math.hypot(p.x - centre.x, p.y - centre.y))) : 0;
    const step = (2 * Math.PI) / loose.length;
    const radius = Math.max(reach + 150, (NODE_SPACING * loose.length) / (2 * Math.PI));
    loose.forEach((id, i) => {
      result[id] = { x: centre.x + radius * Math.cos(i * step), y: centre.y + radius * Math.sin(i * step) };
    });
  }
  return result;
};
