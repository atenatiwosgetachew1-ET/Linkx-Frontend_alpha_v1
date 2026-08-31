/**
 * Linkx xGraph SDK - Visual Engine
 * Extracts visual encoding, node/edge rendering pipeline, and utilities.
 */

/**
 * Normalizes graph identifiers.
 * @param {any} rawId - The raw ID to normalize
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
 * Parses values into finite numbers if possible.
 * @param {any} value - The value to parse
 * @returns {number|null}
 */
export function toFiniteNumber(value) {
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

    // Fallback: try integer extraction
    const parsedInteger = parseInt(normalized, 10);
    return Number.isFinite(parsedInteger) ? parsedInteger : null;
  }
  return null;
}

/**
 * Calculates a percentile from a sorted array of numbers.
 * @param {number[]} sortedValues - Array of sorted numbers
 * @param {number} percentile - Percentile to calculate (0.0 to 1.0)
 * @returns {number}
 */
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

/**
 * Gets the adaptive weight scale for a set of weights.
 * @param {number[]} values - Array of raw weights
 * @returns {{min: number, max: number, useLog: boolean}}
 */
export function getAdaptiveWeightScale(values) {
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

/**
 * Converts a weight to an edge width based on a scale.
 * @param {number} weight - The weight to convert
 * @param {{min: number, max: number, useLog?: boolean}} scale - The scale parameters
 * @returns {number}
 */
export function edgeWeightToWidth(weight, scale) {
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

/**
 * Computes edge widths for a map of edges.
 * @param {Map<string|number, Object>} edgesMap - Map of edges
 * @param {string} mode - The weight mode
 * @returns {Map<string|number, {width: number}>}
 */
export function computeEdgeWeights(edgesMap, mode) {
  const result = new Map();
  const edges = Array.from(edgesMap.values());
  const weights = edges.map(e => toFiniteNumber(e.weight ?? e.value ?? e.width ?? 1));
  const scale = getAdaptiveWeightScale(weights);

  for (const edge of edges) {
    const weightCandidate = edge.weight ?? edge.value ?? edge.width ?? 1;
    const weightValue = toFiniteNumber(weightCandidate) ?? 1;
    const width = edgeWeightToWidth(weightValue, scale);
    result.set(edge.id, { width });
  }

  return result;
}

/**
 * Generates an HSL palette color string.
 * @param {number} index - Index in the palette
 * @param {number} total - Total number of colors
 * @returns {string}
 */
export function generatePaletteColor(index, total) {
  const safeTotal = Math.max(1, total);
  const hue = Math.round((index % safeTotal) * (360 / safeTotal));
  return `hsl(${hue}, 62%, 55%)`;
}

/**
 * Computes visual encoding based on node degree.
 * @param {Map<string|number, Object>} nodesMap - Map of nodes
 * @param {Map<string|number, Set<string|number>>} adjacencyMap - Map of node adjacency sets
 * @returns {Map<string|number, {size: number, color: string}>}
 */
export function computeDegreeEncoding(nodesMap, adjacencyMap) {
  const result = new Map();
  const nodes = Array.from(nodesMap.values());
  if (nodes.length === 0) return result;

  let maxDegree = 1;
  const degreeMap = new Map();
  
  for (const node of nodes) {
    const neighbors = adjacencyMap.get(node.id);
    const degree = neighbors ? neighbors.size : 0;
    degreeMap.set(node.id, degree);
    if (degree > maxDegree) maxDegree = degree;
  }

  for (const node of nodes) {
    const degree = degreeMap.get(node.id) || 0;
    const ratio = degree / maxDegree;
    const size = 14 + (ratio * 26);
    const background = `hsl(${Math.round(220 - ratio * 180)}, 70%, 58%)`;
    
    result.set(node.id, { size, color: background });
  }

  return result;
}

/**
 * Helper to get a property value from a node safely.
 */
function getNodeValue(node, key) {
  return node?.[key];
}

/**
 * Computes visual encoding based on a numeric or categorical property.
 * @param {Map<string|number, Object>} nodesMap - Map of nodes
 * @param {string} propertyKey - The property key to encode
 * @returns {Map<string|number, {size: number, color: string}>}
 */
export function computePropertyEncoding(nodesMap, propertyKey) {
  const result = new Map();
  const key = String(propertyKey || "").trim();
  if (!key) return result;
  const nodes = Array.from(nodesMap.values());
  if (nodes.length === 0) return result;

  const numericValues = [];
  const categoricalMap = new Map();

  for (const node of nodes) {
    const value = getNodeValue(node, key);
    const num = toFiniteNumber(value);
    if (num != null) numericValues.push(num);
    else if (value != null && String(value).trim() !== "") categoricalMap.set(String(value), true);
  }

  const useNumeric = numericValues.length >= Math.max(4, Math.floor(nodes.length * 0.35));
  const min = useNumeric ? Math.min(...numericValues) : 0;
  const max = useNumeric ? Math.max(...numericValues) : 1;
  const categories = Array.from(categoricalMap.keys()).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  
  const categoryColor = new Map();
  categories.forEach((cat, index) => {
    categoryColor.set(cat, generatePaletteColor(index, categories.length));
  });

  for (const node of nodes) {
    const value = getNodeValue(node, key);
    const num = toFiniteNumber(value);
    let ratio = 0.5;
    let color = "#5a8ac6"; // fallback

    if (useNumeric && num != null && max > min) {
      ratio = (num - min) / (max - min);
      color = `hsl(${Math.round(220 - ratio * 180)}, 72%, 56%)`;
    } else if (!useNumeric && value != null && categoryColor.has(String(value))) {
      color = categoryColor.get(String(value));
    }

    const size = 13 + (ratio * 24);
    result.set(node.id, { size, color });
  }

  return result;
}

/**
 * Builds the render label for a node.
 * @param {Object} node - The node object
 * @param {boolean} showLabels - Whether labels are globally shown
 * @returns {string}
 */
export function buildNodeLabel(node, showLabels) {
  const candidate = node?.label ?? "";
  // Check for node-specific override, fallback to global
  const shouldShow = showLabels || node?.showLabel === true;
  if (shouldShow) {
    return candidate;
  }
  return "";
}

/**
 * Builds a safe tooltip title for a node.
 * @param {Object} node - The node object
 * @returns {string}
 */
export function buildNodeTooltip(node) {
  if (!node || typeof node !== "object") return "";
  
  const keepKeys = ['node_identity', 'id', 'type', 'category', 'department', 'name', 'description'];                    
  const excludeKeys = ['session_id', 'Label', 'rel_type', 'x', 'y', 'vx', 'vy', 'index', 'edges', 'neighbors', 'color', 'shape', 'borderWidth', 'borderWidthSelected', 'image', 'iconPath', 'title', 'size', 'font', 'margin', 'shadow'];
  
  const entries = Object.entries(node)
    .filter(([k]) => {
      if (keepKeys.includes(k)) return true;
      if (excludeKeys.includes(k)) return false;
      return true;
    })
    .slice(0, 50);
    
  return entries.map(([k, v]) => `${k}: ${v}`).join("\n");
}

/**
 * Builds a safe tooltip title for an edge.
 * @param {Object} edge - The edge object
 * @param {Function} getNodeFn - Function to retrieve node by ID
 * @returns {string}
 */
export function buildEdgeTooltip(edge, getNodeFn) {
  if (!edge) return "";
  
  const fromNode = getNodeFn(edge.from) || {};
  const toNode = getNodeFn(edge.to) || {};

  const fromLabel = fromNode.label ?? edge.from;
  const toLabel = toNode.label ?? edge.to;

  const weightCandidate = edge.weight ?? edge.value ?? edge.width ?? 1;
  const weightValue = toFiniteNumber(weightCandidate);
  const normalizedWeight = weightValue == null ? 1 : weightValue;

  return `From: ${fromLabel}\nTo: ${toLabel}\nWeight: ${normalizedWeight}`;
}
