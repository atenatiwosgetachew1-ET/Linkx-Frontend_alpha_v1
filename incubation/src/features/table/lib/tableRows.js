// The Table window's rows and columns (G3.5 i2 #5, after IBM i2 Analyst's
// Notebook's data grid; analyst decision 2026-11-17: its own window, linked
// to a Graph window). Pure: built from the graph store's graph and the ids
// in scope, so tests run them directly. Nothing here changes the graph.

import { compareNodeValues, PROPERTY_KEY_HIDDEN } from '../../graph/lib/graphModel.js';
import { nodeTypeOf } from '../../graph/lib/graphAnalysis.js';

export const TABLE_TABS = Object.freeze(['nodes', 'links']);
export const TABLE_SCOPES = Object.freeze([
  { id: 'drawn', label: 'Drawn', hint: 'What the graph draws now (after its limit, filters, timeline and hidden items)' },
  { id: 'selected', label: 'Selected', hint: 'What is selected on the graph' },
  { id: 'all', label: 'All', hint: 'Everything in the graph, drawn or not' },
]);

// Built-in columns, before the properties found in the data.
export const NODE_BUILT_INS = Object.freeze([
  { key: '@label', label: 'Label' },
  { key: '@id', label: 'ID' },
  { key: '@type', label: 'Type' },
  { key: '@degree', label: 'Links', numeric: true },
  { key: '@flags', label: 'Flags' },
]);
export const LINK_BUILT_INS = Object.freeze([
  { key: '@label', label: 'Label' },
  { key: '@from', label: 'From' },
  { key: '@to', label: 'To' },
  { key: '@type', label: 'Type' },
  { key: '@flags', label: 'Flags' },
]);

// Drawing and bookkeeping keys of links (never columns).
export const LINK_KEY_HIDDEN = new Set(['from', 'to', 'id', 'label', 'width', 'color', 'dashes', 'smooth', 'arrows', 'arrowStrikethrough', 'font', 'title', 'hidden', 'physics']);

const plain = (value) => {
  if (value == null) return '';
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value);
};

const nameOf = (id, attributes) => {
  const label = attributes?.label;
  return label != null && String(label).trim() ? String(label) : String(id);
};

// Property columns found on the given nodes / links, in first-seen order.
export const propertyColumns = (items, hidden) => {
  const keys = new Set();
  items.forEach((attributes) => {
    Object.keys(attributes || {}).forEach((key) => {
      if (!key.startsWith('__') && !hidden.has(key)) keys.add(key);
    });
  });
  return [...keys].map((key) => ({ key, label: key }));
};

// markers: the store's { alert, pinned } marker sets ({ nodes, edges }).
const flagsOf = (kind, id, attributes, markers) => {
  const set = kind === 'node' ? 'nodes' : 'edges';
  const flags = [];
  if (markers?.alert?.[set]?.has(id)) flags.push('Alerted');
  if (markers?.pinned?.[set]?.has(id)) flags.push('Pinned');
  if (kind === 'node' && attributes?.isGroup) flags.push('Group');
  if (kind === 'node' && Array.isArray(attributes?.merged_from) && attributes.merged_from.length) flags.push('Merged');
  return flags;
};

// -> { rows: [{ id, values: { key: shown text }, sort: { key: raw } }], columns }
export const buildNodeRows = (graph, ids, markers) => {
  const present = ids.filter((id) => graph.hasNode(id));
  const attributesList = present.map((id) => graph.getNodeAttributes(id));
  const columns = [...NODE_BUILT_INS, ...propertyColumns(attributesList, new Set([...PROPERTY_KEY_HIDDEN, 'id']))];
  const rows = present.map((id, index) => {
    const attributes = attributesList[index];
    const flags = flagsOf('node', id, attributes, markers);
    const sort = {
      '@label': nameOf(id, attributes),
      '@id': id,
      '@type': nodeTypeOf(attributes) || '',
      '@degree': graph.degree(id),
      '@flags': flags.join(', '),
    };
    columns.forEach(({ key }) => {
      if (!key.startsWith('@')) sort[key] = attributes[key] ?? null;
    });
    const values = Object.fromEntries(Object.entries(sort).map(([key, value]) => [key, plain(value)]));
    return { id, values, sort };
  });
  return { rows, columns };
};

export const buildLinkRows = (graph, keys, markers) => {
  const present = keys.filter((key) => graph.hasEdge(key));
  const attributesList = present.map((key) => graph.getEdgeAttributes(key));
  const columns = [...LINK_BUILT_INS, ...propertyColumns(attributesList, LINK_KEY_HIDDEN)];
  const rows = present.map((key, index) => {
    const attributes = attributesList[index];
    const from = graph.source(key);
    const to = graph.target(key);
    const flags = flagsOf('edge', key, attributes, markers);
    const sort = {
      '@label': attributes.label != null ? String(attributes.label) : '',
      '@from': nameOf(from, graph.getNodeAttributes(from)),
      '@to': nameOf(to, graph.getNodeAttributes(to)),
      '@type': String(attributes.rel_type ?? attributes.relationship ?? attributes.type ?? attributes.edge_kind ?? ''),
      '@flags': flags.join(', '),
    };
    columns.forEach(({ key: column }) => {
      if (!column.startsWith('@')) sort[column] = attributes[column] ?? null;
    });
    const values = Object.fromEntries(Object.entries(sort).map(([column, value]) => [column, plain(value)]));
    return { id: key, ends: [from, to], values, sort };
  });
  return { rows, columns };
};

// Numbers as numbers ("2,500" too), empty last, else natural order.
const numeric = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export const sortRows = (rows, sort) => {
  if (!sort?.key) return rows;
  const direction = sort.dir === 'desc' ? 'desc' : 'asc';
  return [...rows].sort((a, b) => {
    const left = a.sort[sort.key];
    const right = b.sort[sort.key];
    const blankLeft = left == null || left === '';
    const blankRight = right == null || right === '';
    if (blankLeft || blankRight) return blankLeft === blankRight ? 0 : (blankLeft ? 1 : -1); // empty last either way
    const x = numeric(left);
    const y = numeric(right);
    if (x !== null && y !== null) return direction === 'asc' ? x - y : y - x;
    return compareNodeValues(plain(left), plain(right), direction);
  });
};

// Rows with the text in any of the shown columns (any case).
export const filterRows = (rows, text, columns) => {
  const wanted = String(text || '').trim().toLowerCase();
  if (!wanted) return rows;
  const keys = columns.map((column) => column.key);
  return rows.filter((row) => keys.some((key) => row.values[key]?.toLowerCase().includes(wanted)));
};

// The shown columns, in the analyst's order: `order` (keys moved by hand)
// first where present, then the rest as found; `hidden` left out.
export const arrangeColumns = (columns, { order = [], hidden = [] } = {}) => {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const placed = order.filter((key) => byKey.has(key));
  const rest = columns.map((column) => column.key).filter((key) => !placed.includes(key));
  const hiddenSet = new Set(hidden);
  return [...placed, ...rest].map((key) => ({ ...byKey.get(key), hidden: hiddenSet.has(key) }));
};

// Window metadata -> settings, normalized.
export const normalizeTableState = (input = {}) => {
  const tab = TABLE_TABS.includes(input?.tab) ? input.tab : 'nodes';
  const scope = TABLE_SCOPES.some((entry) => entry.id === input?.scope) ? input.scope : 'drawn';
  const columnsOf = (value) => ({
    order: Array.isArray(value?.order) ? value.order.map(String).slice(0, 400) : [],
    hidden: Array.isArray(value?.hidden) ? value.hidden.map(String).slice(0, 400) : [],
  });
  const sortOf = (value) => (value && typeof value.key === 'string' && value.key ? { key: value.key, dir: value.dir === 'desc' ? 'desc' : 'asc' } : null);
  return {
    tab,
    scope,
    follow: input?.follow !== false,
    columns: { nodes: columnsOf(input?.columns?.nodes), links: columnsOf(input?.columns?.links) },
    sort: { nodes: sortOf(input?.sort?.nodes), links: sortOf(input?.sort?.links) },
  };
};
