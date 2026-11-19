// The Histogram's properties and values (G6.0, after i2 Analyst's
// Notebook's Histogram; analyst decision 2026-11-18), read on the window's
// side from the graph store: the chosen property's value for each entity or
// link in scope, sent to the worker, which bins them (chartMetrics.js).

import { PROPERTY_KEY_HIDDEN } from '../../graph/lib/graphModel.js';
import { nodeTypeOf } from '../../graph/lib/graphAnalysis.js';
import { LINK_KEY_HIDDEN } from '../../table/lib/tableRows.js';

// Looked at to find the properties (the values themselves are all read).
const SAMPLE = 2000;

const linkTypeOf = (attributes) => String(attributes?.rel_type ?? attributes?.relationship ?? attributes?.type ?? attributes?.edge_kind ?? '');

// The default: links by their type (always there).
export const DEFAULT_HISTOGRAM = Object.freeze({ subject: 'edge', key: '@type' });

// [{ subject: 'node' | 'edge', key, label }]: the type first, then the
// properties found on the scope's entities / links (plain values only).
export const histogramKeys = (graph, nodeIds, edgeKeys) => {
  const found = (ids, attributesOf, hidden) => {
    const keys = new Set();
    ids.slice(0, SAMPLE).forEach((id) => {
      Object.entries(attributesOf(id) || {}).forEach(([key, value]) => {
        if (key.startsWith('__') || hidden.has(key) || value == null || typeof value === 'object') return;
        keys.add(key);
      });
    });
    return [...keys].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  };
  return [
    { subject: 'edge', key: '@type', label: 'Type' },
    ...found(edgeKeys.filter((key) => graph.hasEdge(key)), (key) => graph.getEdgeAttributes(key), LINK_KEY_HIDDEN).map((key) => ({ subject: 'edge', key, label: key })),
    { subject: 'node', key: '@type', label: 'Type' },
    ...found(nodeIds.filter((id) => graph.hasNode(id)), (id) => graph.getNodeAttributes(id), PROPERTY_KEY_HIDDEN).map((key) => ({ subject: 'node', key, label: key })),
  ];
};

// [[id, value]] of the chosen property over the scope's entities or links.
export const histogramValues = (graph, nodeIds, edgeKeys, { subject, key }) => {
  if (subject === 'edge') {
    return edgeKeys.filter((id) => graph.hasEdge(id)).map((id) => {
      const attributes = graph.getEdgeAttributes(id);
      return [id, key === '@type' ? linkTypeOf(attributes) : attributes[key] ?? null];
    });
  }
  return nodeIds.filter((id) => graph.hasNode(id)).map((id) => {
    const attributes = graph.getNodeAttributes(id);
    return [id, key === '@type' ? nodeTypeOf(attributes) ?? '' : attributes[key] ?? null];
  });
};

export const histogramLabel = (param) => `${param.subject === 'edge' ? 'Links' : 'Entities'} · ${param.key === '@type' ? 'Type' : param.key}`;
