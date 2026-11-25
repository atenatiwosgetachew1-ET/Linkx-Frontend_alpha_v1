// The Table window's rows and columns (G3.5 i2 #5, after IBM i2 Analyst's
// Notebook's data grid; analyst decision 2026-11-17: its own window, linked
// to a Graph window). Pure: built from the graph store's graph and the ids
// in scope, so tests run them directly. Nothing here changes the graph.

import { sortByValue } from '../../../shared/numbers/values.js';
import { PROPERTY_KEY_HIDDEN } from '../../graph/lib/graphModel.js';
import { isAnnotation, isThemeLineEdge, nodeTypeOf } from '../../graph/lib/graphAnalysis.js';

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
  { key: '@degree', label: 'Links', numeric: true, hint: 'Links in this scope' },
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
// Entities only: the analyst's text notes are not rows. edgeKeys: the links
// in scope, for the Links column (the whole graph's when not given); theme
// lines never count.
export const buildNodeRows = (graph, ids, markers, { edgeKeys = null } = {}) => {
  const present = ids.filter((id) => graph.hasNode(id) && !isAnnotation(graph.getNodeAttributes(id)));
  const links = new Map();
  (edgeKeys || graph.edges()).forEach((key) => {
    if (!graph.hasEdge(key) || isThemeLineEdge(graph.getEdgeAttributes(key))) return;
    [graph.source(key), graph.target(key)].forEach((id) => links.set(id, (links.get(id) || 0) + 1));
  });
  const attributesList = present.map((id) => graph.getNodeAttributes(id));
  const columns = [...NODE_BUILT_INS, ...propertyColumns(attributesList, new Set([...PROPERTY_KEY_HIDDEN, 'id']))];
  const rows = present.map((id, index) => {
    const attributes = attributesList[index];
    const flags = flagsOf('node', id, attributes, markers);
    const sort = {
      '@label': nameOf(id, attributes),
      '@id': id,
      '@type': nodeTypeOf(attributes) || '',
      '@degree': links.get(id) || 0,
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
  // Theme lines are drawing, not links (as the Chart window and reports).
  const present = keys.filter((key) => graph.hasEdge(key) && !isThemeLineEdge(graph.getEdgeAttributes(key)));
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

// By the shared rules (numbers, dates, amounts, text), empty last either way.
export const sortRows = (rows, sort) => {
  if (!sort?.key) return rows;
  const direction = sort.dir === 'desc' ? 'desc' : 'asc';
  return sortByValue(rows, (row) => row.sort[sort.key], direction);
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

// What a Table window starts from when nothing says otherwise (Libraries ▸
// Table defaults replaces it; lib/tableDefaults.js): `hidden` and `sort`
// per tab, over the built-in columns.
export const BUILTIN_TABLE_START = Object.freeze({
  tab: 'nodes',
  scope: 'drawn',
  follow: true,
  hidden: Object.freeze({ nodes: Object.freeze([]), links: Object.freeze([]) }),
  sort: Object.freeze({ nodes: null, links: null }),
});

// Window metadata -> settings, normalized. defaults: what a window without
// a state of its own starts from.
export const normalizeTableState = (input = {}, defaults = BUILTIN_TABLE_START) => {
  // Nothing saved yet: a new window.
  const blank = !input || Object.keys(input).length === 0;
  const tab = TABLE_TABS.includes(input?.tab) ? input.tab : defaults.tab;
  const scope = TABLE_SCOPES.some((entry) => entry.id === input?.scope) ? input.scope : defaults.scope;
  const columnsOf = (value) => ({
    order: Array.isArray(value?.order) ? value.order.map(String).slice(0, 400) : [],
    hidden: Array.isArray(value?.hidden) ? value.hidden.map(String).slice(0, 400) : [],
  });
  const sortOf = (value) => (value && typeof value.key === 'string' && value.key ? { key: value.key, dir: value.dir === 'desc' ? 'desc' : 'asc' } : null);
  return {
    tab,
    scope,
    follow: blank ? defaults.follow !== false : input?.follow !== false,
    columns: blank
      ? { nodes: columnsOf({ hidden: defaults.hidden?.nodes }), links: columnsOf({ hidden: defaults.hidden?.links }) }
      : { nodes: columnsOf(input?.columns?.nodes), links: columnsOf(input?.columns?.links) },
    sort: blank
      ? { nodes: sortOf(defaults.sort?.nodes), links: sortOf(defaults.sort?.links) }
      : { nodes: sortOf(input?.sort?.nodes), links: sortOf(input?.sort?.links) },
    // The typed filter, kept with the window (the graph report takes the
    // rows as seen; analyst decision 2026-11-19).
    filter: typeof input?.filter === 'string' ? input.filter.slice(0, 200) : '',
  };
};
