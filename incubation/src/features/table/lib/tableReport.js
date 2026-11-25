// The graph report's table appendices (analyst decisions 2026-11-18 and
// 2026-11-19). From a Graph window: each linked Table window as the analyst
// left it (its rows by tab, scope and typed filter, its columns in their
// order with the hidden ones left out, and its sort), read from the
// window's saved state. With no Table window linked, and in the evidence
// report: the default tables (the entities and the relationships, flagged
// ones first, with the columns most worth reading).

import { isThemeLineEdge } from '../../graph/lib/graphAnalysis.js';
import { parseAmount } from '../../../shared/numbers/values.js';
import { arrangeColumns, buildLinkRows, buildNodeRows, filterRows, normalizeTableState, sortRows } from './tableRows.js';
import { getTableDefaults } from './tableDefaults.js';

// Rows in a report's table at most (a longer one is cut, and says so).
export const REPORT_TABLE_MAX_ROWS = 2000;

const SCOPE_LABEL = { drawn: 'Drawn', selected: 'Selected', all: 'All' };
const count = (n) => n.toLocaleString('en-GB');

// -> { title, source, columns: [{ label, numeric }], rows: [[text]], total, note }
const appendixOf = ({ title, source, columns, rows, fromWindow = false }) => {
  const shown = rows.slice(0, REPORT_TABLE_MAX_ROWS);
  return {
    fromWindow,
    title,
    source,
    columns: columns.map((column) => ({ label: column.label, numeric: Boolean(column.numeric) })),
    rows: shown.map((row) => columns.map((column) => row.values[column.key] ?? '')),
    total: rows.length,
    note: rows.length > shown.length ? `The first ${count(shown.length)} of ${count(rows.length)} rows are listed.` : '',
  };
};

const idsOf = (graph, link, scope, nodes) => {
  if (scope === 'all') return nodes ? graph.nodes() : graph.edges();
  if (scope === 'selected') return nodes ? link.selection?.nodes || [] : link.selection?.edges || [];
  return nodes ? link.nodeIds || [] : link.edgeIds || [];
};

// A linked Table window's table. store: the graph's store; link: what the
// graph draws and selects ({ nodeIds, edgeIds, selection }); tableState:
// the window's saved state (metadata.tableState); title: the window's.
export const tableAppendix = ({ store, link, tableState, title = 'Table' }) => {
  // As the window shows it: its own state, else Libraries ▸ Table defaults.
  const state = normalizeTableState(tableState, getTableDefaults());
  const graph = store.graph();
  const nodes = state.tab === 'nodes';
  const ids = idsOf(graph, link, state.scope, nodes);
  const built = nodes ? buildNodeRows(graph, ids, store.getMarkers(), { edgeKeys: idsOf(graph, link, state.scope === 'all' ? 'all' : 'drawn', false) }) : buildLinkRows(graph, ids, store.getMarkers());
  const columns = arrangeColumns(built.columns, state.columns[state.tab]).filter((column) => !column.hidden);
  const filter = state.filter.trim();
  const rows = sortRows(filterRows(built.rows, filter, columns), state.sort[state.tab]);
  return appendixOf({
    fromWindow: true,
    title: nodes ? 'Nodes' : 'Links',
    source: `${title} · ${nodes ? 'Nodes' : 'Links'} · ${SCOPE_LABEL[state.scope] || 'Drawn'} scope${filter ? ` · filter "${filter}"` : ''}`,
    columns,
    rows,
  });
};

// Flagged (alerted, pinned) rows first, then by `rank` (larger first),
// else as found.
const flaggedFirst = (rows, rank) => rows
  .map((row, index) => ({ row, index, flagged: row.values['@flags'] ? 1 : 0, rank: rank(row) }))
  .sort((a, b) => (b.flagged - a.flagged) || (b.rank - a.rank) || (a.index - b.index))
  .map((entry) => entry.row);
const amountOf = (value) => {
  return parseAmount(value) ?? -Infinity;
};

// The default tables: the entities (most connected first) and the
// relationships (largest amount first when links carry one), over what the
// graph draws. weightKey / timeKey: the links' amount and date properties
// ('' when none), shown as columns when present.
export const defaultTableAppendices = ({ store, link, weightKey = '', timeKey = '', scopeLabel = 'drawn' }) => {
  const graph = store.graph();
  const markers = store.getMarkers();
  const nodeBuilt = buildNodeRows(graph, link.nodeIds || [], markers);
  // Links as the report counts them (its Method): the distinct entities
  // drawn that an entity is linked to by a drawn link, parallel links once.
  const drawn = new Set(link.nodeIds || []);
  const neighbours = new Map();
  (link.edgeIds || []).forEach((key) => {
    if (!graph.hasEdge(key) || isThemeLineEdge(graph.getEdgeAttributes(key))) return;
    const a = graph.source(key);
    const b = graph.target(key);
    if (a === b || !drawn.has(a) || !drawn.has(b)) return;
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    if (!neighbours.has(b)) neighbours.set(b, new Set());
    neighbours.get(a).add(b);
    neighbours.get(b).add(a);
  });
  nodeBuilt.rows.forEach((row) => {
    const links = neighbours.get(row.id)?.size || 0;
    row.sort['@degree'] = links;
    row.values['@degree'] = String(links);
  });
  const nodeColumns = ['@label', '@id', '@type', '@degree', '@flags'].map((key) => nodeBuilt.columns.find((column) => column.key === key)).filter(Boolean);
  const linkBuilt = buildLinkRows(graph, link.edgeIds || [], markers);
  const linkKeys = ['@from', '@to', '@type', ...(weightKey ? [weightKey] : []), ...(timeKey && timeKey !== weightKey ? [timeKey] : []), '@label', '@flags'];
  const linkColumns = linkKeys
    .map((key) => linkBuilt.columns.find((column) => column.key === key) || null)
    .filter(Boolean)
    .map((column) => (column.key === weightKey ? { ...column, numeric: true } : column));
  const tables = [];
  if (nodeBuilt.rows.length) {
    tables.push(appendixOf({
      title: 'Entities',
      source: `Every entity ${scopeLabel === 'whole' ? 'in the graph' : 'drawn'}, flagged ones first, then the most connected`,
      columns: nodeColumns,
      rows: flaggedFirst(nodeBuilt.rows, (row) => Number(row.sort['@degree']) || 0),
    }));
  }
  if (linkBuilt.rows.length) {
    tables.push(appendixOf({
      title: 'Relationships',
      source: `Every relationship ${scopeLabel === 'whole' ? 'in the graph' : 'drawn'}, flagged ones first${weightKey ? `, then the largest ${weightKey}` : ''}`,
      columns: linkColumns,
      rows: flaggedFirst(linkBuilt.rows, (row) => (weightKey ? amountOf(row.sort[weightKey]) : 0)),
    }));
  }
  return tables;
};
