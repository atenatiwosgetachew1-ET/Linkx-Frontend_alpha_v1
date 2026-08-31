/**
 * Linkx Layout Algorithms
 * Extracted pure algorithm implementations for graph rendering.
 */

export const AUTO_PHYSICS_THRESHOLD = 300;

export function isManualLayout(type) {
  return (
    type === "circle" ||
    type === "star" ||
    type === "radial" ||
    type === "grid" ||
    type === "spiral" ||
    type === "concentric" ||
    type === "layered"
  );
}

function getVisibleNeighborCount(nodeId, visibleSet, adjacencyMap) {
  const neighbors = adjacencyMap.get(nodeId);
  if (!neighbors) return 0;

  let count = 0;
  neighbors.forEach((neighborId) => {
    if (visibleSet.has(neighborId)) count += 1;
  });
  return count;
}

export function getLayoutCenterNode(nodesMap, adjacencyMap) {
  const nodeIds = Array.from(nodesMap.keys());
  if (!Array.isArray(nodeIds) || nodeIds.length === 0) return null;
  const visibleSet = new Set(nodeIds);

  let centerId = nodeIds[0];
  let maxDegree = -1;
  nodeIds.forEach((nodeId) => {
    const degree = getVisibleNeighborCount(nodeId, visibleSet, adjacencyMap);
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

function normalizeLayerMode(mode) {
  const value = String(mode || "").trim().toLowerCase();
  if (value === "node_identity" || value === "by_key") return value;
  return "hop_distance";
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

    const rangeMatch = normalized.match(/(-?\d+(?:\.\d+)?)\s*[-–—]\s*(-?\d+(?:\.\d+)?)/);
    if (rangeMatch) {
      const lower = Number(rangeMatch[1]);
      const upper = Number(rangeMatch[2]);
      if (Number.isFinite(lower) && Number.isFinite(upper)) {
        return (lower + upper) / 2;
      }
    }

    const parsedInteger = parseInt(normalized, 10);
    return Number.isFinite(parsedInteger) ? parsedInteger : null;
  }
  return null;
}

function getNodeValue(node, key) {
  if (typeof key !== "string" || key.trim() === "") return null;
  const normalizedKey = key.trim().toLowerCase();

  const actualKey = Object.keys(node).find(
    (k) => k.toLowerCase() === normalizedKey
  );
  return actualKey ? node[actualKey] : null;
}

function getLayeredRootNode(nodeIds, visibleSet, nodesMap, adjacencyMap) {
  const sourceCandidates = nodeIds.filter((nodeId) => {
    const node = nodesMap.get(nodeId);
    const identity = String(node?.node_identity || "").toLowerCase();
    return identity.includes("source");
  });

  if (sourceCandidates.length > 0) {
    return sourceCandidates.sort((a, b) => {
      const degreeDiff =
        getVisibleNeighborCount(b, visibleSet, adjacencyMap) -
        getVisibleNeighborCount(a, visibleSet, adjacencyMap);
      if (degreeDiff !== 0) return degreeDiff;
      return String(a).localeCompare(String(b), undefined, { numeric: true });
    })[0];
  }

  let centerId = nodeIds[0];
  let maxDegree = -1;
  nodeIds.forEach((nodeId) => {
    const degree = getVisibleNeighborCount(nodeId, visibleSet, adjacencyMap);
    if (degree > maxDegree) {
      maxDegree = degree;
      centerId = nodeId;
    }
  });
  return centerId;
}

function sortLayerNodes(layerNodes, visibleSet, prevOrderMap = null, adjacencyMap) {
  const list = Array.from(layerNodes || []);
  const hasPrev = prevOrderMap instanceof Map && prevOrderMap.size > 0;

  list.sort((a, b) => {
    const degreeA = getVisibleNeighborCount(a, visibleSet, adjacencyMap);
    const degreeB = getVisibleNeighborCount(b, visibleSet, adjacencyMap);
    const neighborsA = adjacencyMap.get(a);
    const neighborsB = adjacencyMap.get(b);

    let baryA = Number.POSITIVE_INFINITY;
    let baryB = Number.POSITIVE_INFINITY;

    if (hasPrev) {
      if (neighborsA) {
        let total = 0;
        let count = 0;
        neighborsA.forEach((neighborId) => {
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
        neighborsB.forEach((neighborId) => {
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

function sequenceLayerOrdering(layers, visibleSet, adjacencyMap) {
  const ordered = [];
  let prevOrderMap = null;

  layers.forEach((layerNodes) => {
    const sorted = sortLayerNodes(layerNodes, visibleSet, prevOrderMap, adjacencyMap);
    ordered.push(sorted);
    prevOrderMap = new Map();
    sorted.forEach((nodeId, index) => prevOrderMap.set(nodeId, index));
  });

  return ordered;
}

function buildHopDistanceLayers(nodeIds, visibleSet, nodesMap, adjacencyMap) {
  const rootId = getLayeredRootNode(nodeIds, visibleSet, nodesMap, adjacencyMap);
  if (rootId == null) return [nodeIds];

  const queue = [rootId];
  const visited = new Set([rootId]);
  const layerByNode = new Map([[rootId, 0]]);

  while (queue.length > 0) {
    const current = queue.shift();
    const currentLayer = layerByNode.get(current) || 0;
    const neighbors = adjacencyMap.get(current);
    if (!neighbors) continue;

    neighbors.forEach((neighborId) => {
      if (!visibleSet.has(neighborId) || visited.has(neighborId)) return;
      visited.add(neighborId);
      layerByNode.set(neighborId, currentLayer + 1);
      queue.push(neighborId);
    });
  }

  let maxLayer = 0;
  layerByNode.forEach((layer) => {
    if (layer > maxLayer) maxLayer = layer;
  });
  const disconnectedLayer = maxLayer + 1;

  nodeIds.forEach((nodeId) => {
    if (!layerByNode.has(nodeId)) layerByNode.set(nodeId, disconnectedLayer);
  });

  const nodesByLayer = new Map();
  nodeIds.forEach((nodeId) => {
    const layer = layerByNode.get(nodeId) || 0;
    if (!nodesByLayer.has(layer)) nodesByLayer.set(layer, []);
    nodesByLayer.get(layer).push(nodeId);
  });

  const orderedLayerKeys = Array.from(nodesByLayer.keys()).sort((a, b) => a - b);
  const rawLayers = orderedLayerKeys.map((layer) => nodesByLayer.get(layer) || []);
  return sequenceLayerOrdering(rawLayers, visibleSet, adjacencyMap);
}

function getIdentityLayerRank(identity) {
  const value = String(identity || "").trim().toLowerCase();
  if (value.includes("source")) return 0;
  if (value.includes("entity")) return 1;
  if (value.includes("target")) return 2;
  return 3;
}

function buildIdentityLayers(nodeIds, visibleSet, nodesMap, adjacencyMap) {
  const nodesByIdentity = new Map();

  nodeIds.forEach((nodeId) => {
    const node = nodesMap.get(nodeId);
    const identity = String(node?.node_identity || "Unspecified");
    if (!nodesByIdentity.has(identity)) nodesByIdentity.set(identity, []);
    nodesByIdentity.get(identity).push(nodeId);
  });

  const orderedEntries = Array.from(nodesByIdentity.entries()).sort((a, b) => {
    const rankDiff = getIdentityLayerRank(a[0]) - getIdentityLayerRank(b[0]);
    if (rankDiff !== 0) return rankDiff;
    return String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true });
  });

  return sequenceLayerOrdering(
    orderedEntries.map(([, ids]) => ids),
    visibleSet,
    adjacencyMap
  );
}

function buildPropertyLayers(nodeIds, visibleSet, layerKey, nodesMap, adjacencyMap) {
  const key = String(layerKey || "").trim();
  if (!key) return buildHopDistanceLayers(nodeIds, visibleSet, nodesMap, adjacencyMap);

  const buckets = new Map();
  nodeIds.forEach((nodeId) => {
    const node = nodesMap.get(nodeId) || {};
    const rawValue = getNodeValue(node, key);
    const isMissing = rawValue == null || String(rawValue).trim() === "";
    const displayValue = isMissing ? "Unspecified" : String(rawValue);
    const numericValue = isMissing ? null : toFiniteNumber(rawValue);
    const bucketKey = displayValue;

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        displayValue,
        numericValue,
        ids: [],
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
    return String(a.displayValue).localeCompare(String(b.displayValue), undefined, {
      numeric: true,
    });
  });

  return sequenceLayerOrdering(
    orderedBuckets.map((bucket) => bucket.ids),
    visibleSet,
    adjacencyMap
  );
}

function applyLayeredLayout(nodeIds, visibleSet, updates, nodesMap, adjacencyMap, options) {
  const mode = normalizeLayerMode(options.layerMode);
  const layerKey = String(options.layerKey || "").trim();
  let layers = [];

  if (mode === "node_identity") {
    layers = buildIdentityLayers(nodeIds, visibleSet, nodesMap, adjacencyMap);
  } else if (mode === "by_key") {
    layers = buildPropertyLayers(nodeIds, visibleSet, layerKey, nodesMap, adjacencyMap);
  } else {
    layers = buildHopDistanceLayers(nodeIds, visibleSet, nodesMap, adjacencyMap);
  }

  const cleanedLayers = layers.filter((layer) => Array.isArray(layer) && layer.length > 0);
  if (cleanedLayers.length === 0) return;

  const direction = options.layoutDirection === "LR" ? "LR" : "UD";
  const maxLayerSize = Math.max(...cleanedLayers.map((layer) => layer.length), 1);
  const layerGap = Math.max(140, Math.min(320, Math.round(getLayoutRadius(nodeIds.length, 180, 2, 320))));
  const slotGap = Math.max(70, Math.min(200, Math.round(1700 / Math.max(3, maxLayerSize + 1))));
  const primaryStart = -((cleanedLayers.length - 1) * layerGap) / 2;

  cleanedLayers.forEach((layerNodes, layerIndex) => {
    const primaryPosition = primaryStart + layerIndex * layerGap;
    const secondaryStart = -((layerNodes.length - 1) * slotGap) / 2;

    layerNodes.forEach((nodeId, index) => {
      const secondaryPosition = secondaryStart + index * slotGap;
      updates.set(nodeId, {
        x: direction === "LR" ? primaryPosition : secondaryPosition,
        y: direction === "LR" ? secondaryPosition : primaryPosition,
      });
    });
  });
}

/**
 * Computes layout positions for the given graph.
 *
 * @param {string} layoutType
 * @param {Map} nodesMap
 * @param {Map} edgesMap
 * @param {Map} adjacencyMap
 * @param {Object} options
 * @returns {Map<string|number, {x: number, y: number}>}
 */
export function computeLayout(layoutType, nodesMap, edgesMap, adjacencyMap, options = {}) {
  const nodeIds = Array.from(nodesMap.keys());
  const updates = new Map();
  if (nodeIds.length === 0 || !isManualLayout(layoutType)) return updates;

  const visibleSet = new Set(nodeIds);

  if (layoutType === "circle") {
    if (nodeIds.length === 1) {
      updates.set(nodeIds[0], { x: 0, y: 0 });
    } else {
      const radius = getLayoutRadius(nodeIds.length, 220, 15, 1600);
      const angleStep = (Math.PI * 2) / nodeIds.length;
      nodeIds.forEach((nodeId, index) => {
        const angle = -Math.PI / 2 + index * angleStep;
        updates.set(nodeId, {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
        });
      });
    }
  }

  if (layoutType === "star") {
    const centerId = getLayoutCenterNode(nodesMap, adjacencyMap);
    if (centerId != null) {
      updates.set(centerId, { x: 0, y: 0 });
      const ringNodes = nodeIds.filter((nodeId) => nodeId !== centerId);
      const radius = getLayoutRadius(ringNodes.length, 230, 18, 1700);
      const angleStep = ringNodes.length > 0 ? (Math.PI * 2) / ringNodes.length : 0;

      ringNodes.forEach((nodeId, index) => {
        const angle = -Math.PI / 2 + index * angleStep;
        updates.set(nodeId, {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
        });
      });
    }
  }

  if (layoutType === "radial") {
    const centerId = getLayoutCenterNode(nodesMap, adjacencyMap);
    if (centerId != null) {
      const queue = [centerId];
      const visited = new Set([centerId]);
      const layerByNode = new Map([[centerId, 0]]);

      while (queue.length > 0) {
        const current = queue.shift();
        const currentLayer = layerByNode.get(current) || 0;
        const neighbors = adjacencyMap.get(current);
        if (!neighbors) continue;

        neighbors.forEach((neighborId) => {
          if (!visibleSet.has(neighborId) || visited.has(neighborId)) return;
          visited.add(neighborId);
          layerByNode.set(neighborId, currentLayer + 1);
          queue.push(neighborId);
        });
      }

      let maxLayer = 0;
      layerByNode.forEach((layer) => {
        if (layer > maxLayer) maxLayer = layer;
      });
      const disconnectedLayer = maxLayer + 1;

      nodeIds.forEach((nodeId) => {
        if (!layerByNode.has(nodeId)) {
          layerByNode.set(nodeId, disconnectedLayer);
        }
      });

      const nodesByLayer = new Map();
      nodeIds.forEach((nodeId) => {
        const layer = layerByNode.get(nodeId) || 0;
        if (!nodesByLayer.has(layer)) nodesByLayer.set(layer, []);
        nodesByLayer.get(layer).push(nodeId);
      });

      const layerGap = getLayoutRadius(nodeIds.length, 140, 2, 260);
      const sortedLayers = Array.from(nodesByLayer.keys()).sort((a, b) => a - b);

      sortedLayers.forEach((layer) => {
        const layerNodes = nodesByLayer.get(layer) || [];
        if (layer === 0) {
          updates.set(layerNodes[0], { x: 0, y: 0 });
          return;
        }

        const radius = layer * layerGap;
        const angleStep = layerNodes.length > 0 ? (Math.PI * 2) / layerNodes.length : 0;
        const angleOffset = layer % 2 ? angleStep / 2 : 0;

        layerNodes.forEach((nodeId, index) => {
          const angle = -Math.PI / 2 + angleOffset + index * angleStep;
          updates.set(nodeId, {
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle),
          });
        });
      });
    }
  }

  if (layoutType === "grid") {
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
      updates.set(nodeId, {
        x: originX + col * spacingX,
        y: originY + row * spacingY,
      });
    });
  }

  if (layoutType === "spiral") {
    if (nodeIds.length === 1) {
      updates.set(nodeIds[0], { x: 0, y: 0 });
    } else {
      const angleStep = Math.PI / 3.2;
      const baseRadius = 14;
      const radiusStep = 9;

      nodeIds.forEach((nodeId, index) => {
        const radius = baseRadius + index * radiusStep;
        const angle = -Math.PI / 2 + index * angleStep;
        updates.set(nodeId, {
          x: radius * Math.cos(angle),
          y: radius * Math.sin(angle),
        });
      });
    }
  }

  if (layoutType === "concentric") {
    const rankedNodes = nodeIds
      .map((nodeId) => ({
        id: nodeId,
        degree: getVisibleNeighborCount(nodeId, visibleSet, adjacencyMap),
      }))
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
        updates.set(ringNodes[0].id, { x: 0, y: 0 });
      } else {
        const radius = ringIndex * ringGap;
        const angleStep = (Math.PI * 2) / ringNodes.length;
        const angleOffset = ringIndex % 2 ? 0 : angleStep / 2;

        ringNodes.forEach((entry, index) => {
          const angle = -Math.PI / 2 + angleOffset + index * angleStep;
          updates.set(entry.id, {
            x: radius * Math.cos(angle),
            y: radius * Math.sin(angle),
          });
        });
      }

      cursor += ringNodes.length;
      ringIndex += 1;
    }
  }

  if (layoutType === "layered") {
    applyLayeredLayout(nodeIds, visibleSet, updates, nodesMap, adjacencyMap, options);
  }

  return updates;
}
