import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES, getWindowLimitBlock } from '../../../workspace/state/workspaceTypes.js';
import { graphDataNotice } from '../../graph/lib/graphDataNotice.js';
import { getGraphStore, hasGraphStore } from '../../graph/lib/graphStore.js';
import { getGraphState, requestGraphAction, subscribeGraphState } from '../../graph/lib/graphLinkBus.js';
import StrokeIcon from '../../../shared/icons/StrokeIcon.jsx';
import { TABLE_ICON, TOOL_ICONS } from '../../../shared/icons/windowIcons.js';
import { LinkedGraphMenu, ScopeMenu } from '../../graph/components/GraphCompanionTools.jsx';
import GraphFileMenu from '../../graph/components/GraphFileMenu.jsx';
import { downloadBlob } from '../../graph/lib/graphFile.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { rowsToCsv, rowsToTsv, tableFileName } from '../lib/tableExport.js';
import { TABLE_PDF_MAX_ROWS, tablePdfFileName } from '../lib/tablePdf.js';
import { buildTablePdf } from '../lib/tablePrint.js';
import { tablePreview } from '../lib/tablePreview.js';
import TablePrintDialog from './TablePrintDialog.jsx';
import { getTableDefaults, subscribeTableDefaults } from '../lib/tableDefaults.js';
import nbeLogoSvg from '../../graph/report/nbe_logo.svg?raw';
import {
  TABLE_SCOPES, arrangeColumns, buildLinkRows, buildNodeRows, filterRows, normalizeTableState, sortRows,
} from '../lib/tableRows.js';

// Table window (G3.5 i2 #5, after IBM i2 Analyst's Notebook's data grid; not
// in production; analyst decision 2026-11-17: a window of its own, linked to
// a Graph window, so the canvas keeps its room). The linked graph's nodes or
// links as rows, read live from that window's store: edits, merges, groups
// and filters show at once. Scope: what the graph draws, what is selected,
// or everything. Columns: built-ins, then every property found; shown /
// hidden and moved from the Columns menu; sorted by a header click (numbers
// as numbers, empty last); a quick filter. A row click selects it on the
// graph (Ctrl / Cmd / Shift adds or removes), a double click (or Enter)
// also focuses it there; the graph's selection is marked here and, with
// Follow selection, scrolled to. Only the rows in sight are drawn.
//
// Window metadata: tableGraph (the Graph window id), tableState (tab, scope,
// follow, columns and sort per tab; normalizeTableState).

const ROW_HEIGHT = 26;
const OVERSCAN = 8;
const EMPTY = Object.freeze([]);
const noopSubscribe = () => () => {};
const NO_SNAPSHOT = { version: 0, nodes: 0, edges: 0, selection: EMPTY };

const TabIcon = ({ kind }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {kind === 'nodes'
      ? <><circle cx="6" cy="7" r="2.5" /><circle cx="18" cy="7" r="2.5" /><circle cx="12" cy="17" r="2.5" /></>
      : <><path d="M5 17 19 7" /><circle cx="5" cy="17" r="2" /><circle cx="19" cy="7" r="2" /></>}
  </svg>
);

function ColumnsMenu({ columns, onToggle, onMove, onReset }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  const shown = columns.filter((column) => !column.hidden).length;
  return (
    <div ref={rootRef} className="table_columns">
      <button
        type="button"
        className={`graph_window_icon_button${open || shown < columns.length ? ' is-active' : ''} linkx_tooltip_anchor`}
        aria-label="Columns"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tooltip-placement="bottom"
        data-tooltip={open ? '' : `Columns: ${shown} of ${columns.length} shown`}
        onClick={() => setOpen((value) => !value)}
      >
        <StrokeIcon d={TOOL_ICONS.columns} />
      </button>
      {open ? (
        <div className="table_columns_menu" role="dialog" aria-label="Columns">
          <ol>
            {columns.map((column, index) => (
              <li key={column.key}>
                <label>
                  <input type="checkbox" checked={!column.hidden} disabled={!column.hidden && shown === 1} onChange={() => onToggle(column.key)} />
                  <span>{column.label}</span>
                </label>
                <button type="button" aria-label={`Move ${column.label} up`} disabled={index === 0} onClick={() => onMove(column.key, -1)}>↑</button>
                <button type="button" aria-label={`Move ${column.label} down`} disabled={index === columns.length - 1} onClick={() => onMove(column.key, 1)}>↓</button>
              </li>
            ))}
          </ol>
          <button type="button" className="table_button is-quiet" onClick={onReset}>Show all, original order</button>
        </div>
      ) : null}
    </div>
  );
}

// The NBE logo for the print's header (the report's, as a data URL).
const NBE_LOGO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(nbeLogoSvg)}`;

export default function TableWindowBody({ windowItem }) {
  const { windows, focusWindow, openWindow, nextWindowId, updateWindowMetadata } = useWorkspace();
  const { notify } = useNotifications();
  const windowId = windowItem.id;
  const metadata = useMemo(() => windowItem.metadata || {}, [windowItem.metadata]);
  // A window without a state of its own starts from Libraries ▸ Table defaults.
  const defaults = useSyncExternalStore(subscribeTableDefaults, getTableDefaults);
  const state = useMemo(() => normalizeTableState(metadata.tableState, defaults), [metadata.tableState, defaults]);
  const setState = useCallback((patch) => {
    updateWindowMetadata(windowId, { metadata: { tableState: { ...state, ...patch } } });
  }, [state, updateWindowMetadata, windowId]);

  const graphs = useMemo(() => windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.GRAPH), [windows]);
  const graphId = metadata.tableGraph ? String(metadata.tableGraph) : '';
  const graphWindow = graphs.find((item) => item.id === graphId) || null;
  const linkTo = (id) => updateWindowMetadata(windowId, { metadata: { tableGraph: id } });

  // Unlinked only: right-click ▸ New Graph window opens one and links this
  // table to it (analyst decision 2026-11-17); unavailable once the Graph /
  // Chart / Table limit is reached.
  const [menu, setMenu] = useState(null); // { x, y } in the window
  const windowRef = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !event.target.closest?.('.table_context_menu')) setMenu(null);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);
  const limitBlock = getWindowLimitBlock(windows, WORKSPACE_WINDOW_TYPES.GRAPH);
  const openMenu = (event) => {
    event.preventDefault();
    const box = windowRef.current?.getBoundingClientRect();
    setMenu({ x: event.clientX - (box?.left || 0), y: event.clientY - (box?.top || 0) });
  };
  const newGraph = () => {
    if (limitBlock) return;
    setMenu(null);
    const id = nextWindowId(WORKSPACE_WINDOW_TYPES.GRAPH);
    if (openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, {})) linkTo(id);
  };

  // The linked graph: its store (data) and what its window publishes (view,
  // selection). A store is only read, never created, from here.
  const store = graphWindow && hasGraphStore(graphId) ? getGraphStore(graphId) : null;
  const snapshot = useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.getSnapshot : () => NO_SNAPSHOT);
  const subscribeLink = useCallback((listener) => (graphId ? subscribeGraphState(graphId, listener) : () => {}), [graphId]);
  const link = useSyncExternalStore(subscribeLink, () => getGraphState(graphId));
  const dataNotice = graphDataNotice(snapshot, link, state.scope);

  // Refresh (just in case, analyst decision 2026-11-18): the rows are read
  // again from the linked graph, and the list goes back to its top.
  const [refreshCount, setRefreshCount] = useState(0);

  const nodesTab = state.tab === 'nodes';
  const selectedNodes = link.selection.nodes;
  const selectedEdges = link.selection.edges;
  const { rows: allRows, columns: foundColumns } = useMemo(() => {
    if (!store) return { rows: EMPTY, columns: EMPTY };
    const graph = store.graph();
    const markers = store.getMarkers();
    let ids;
    if (state.scope === 'all') ids = nodesTab ? graph.nodes() : graph.edges();
    else if (state.scope === 'selected') ids = nodesTab ? selectedNodes : selectedEdges;
    else ids = nodesTab ? link.nodeIds : link.edgeIds;
    return nodesTab ? buildNodeRows(graph, ids, markers, { edgeKeys: state.scope === 'all' ? graph.edges() : link.edgeIds }) : buildLinkRows(graph, ids, markers);
    // The graph changes with the store version; Refresh reads it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, snapshot.version, state.scope, nodesTab, link, selectedNodes, selectedEdges, refreshCount]);

  const tabKey = nodesTab ? 'nodes' : 'links';
  const columnState = state.columns[tabKey];
  const columns = useMemo(() => arrangeColumns(foundColumns, columnState), [columnState, foundColumns]);
  const shownColumns = useMemo(() => columns.filter((column) => !column.hidden), [columns]);
  const sort = state.sort[tabKey];
  // The filter is kept with the window (analyst decision 2026-11-19: the
  // graph report takes the rows as seen), saved once typing pauses.
  const [filter, setFilter] = useState(() => state.filter);
  useEffect(() => {
    if (filter === state.filter) return undefined;
    const timer = setTimeout(() => setState({ filter }), 300);
    return () => clearTimeout(timer);
  }, [filter, setState, state.filter]);
  const rows = useMemo(() => sortRows(filterRows(allRows, filter, shownColumns), sort), [allRows, filter, shownColumns, sort]);

  const selectedSet = useMemo(() => new Set(nodesTab ? selectedNodes : selectedEdges), [nodesTab, selectedEdges, selectedNodes]);
  const selectedHere = useMemo(() => rows.filter((row) => selectedSet.has(row.id)).length, [rows, selectedSet]);

  /* ── Columns ── */
  const setColumns = (next) => setState({ columns: { ...state.columns, [tabKey]: next } });
  const toggleColumn = (key) => {
    const hidden = columnState.hidden.includes(key) ? columnState.hidden.filter((entry) => entry !== key) : [...columnState.hidden, key];
    setColumns({ ...columnState, hidden });
  };
  const moveColumn = (key, step) => {
    const order = columns.map((column) => column.key);
    const from = order.indexOf(key);
    const to = from + step;
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    setColumns({ ...columnState, order });
  };
  const sortBy = (key) => {
    const next = sort?.key !== key ? { key, dir: 'asc' } : sort.dir === 'asc' ? { key, dir: 'desc' } : null;
    setState({ sort: { ...state.sort, [tabKey]: next } });
  };

  /* ── Export, refresh ── */
  const exportRows = async (id) => {
    if (!rows.length) {
      notify({ title: 'Export', message: 'No rows to export.', level: 'warning', source: windowItem.title });
      return;
    }
    if (id === 'csv') {
      downloadBlob(tableFileName(windowItem.title, tabKey), new Blob([rowsToCsv(rows, shownColumns)], { type: 'text/csv;charset=utf-8' }));
    } else if (id === 'copy') {
      try {
        await navigator.clipboard.writeText(rowsToTsv(rows, shownColumns));
        notify({ title: 'Copy rows', message: `${rows.length.toLocaleString()} ${rows.length === 1 ? 'row' : 'rows'} copied; paste them into a spreadsheet.`, level: 'success', source: windowItem.title });
      } catch {
        notify({ title: 'Copy rows', message: 'The browser did not allow copying. Export CSV instead.', level: 'warning', source: windowItem.title });
      }
    } else if (id === 'print') {
      setPrintOpen(true);
    }
  };

  /* ── Print table (a popup, then a PDF in the NBE frame; analyst decision
     2026-11-18: the browser printing the page was poor) ── */
  const [printOpen, setPrintOpen] = useState(false);
  // The rows each choice prints, in the window's sort.
  const rowsFor = (rowsMode) => {
    if (rowsMode === 'all') return sortRows(allRows, sort);
    if (rowsMode === 'selected') {
      if (!store) return [];
      const graph = store.graph();
      const ids = nodesTab ? selectedNodes : selectedEdges;
      return sortRows((nodesTab ? buildNodeRows(graph, ids, store.getMarkers(), { edgeKeys: state.scope === 'all' ? graph.edges() : link.edgeIds }) : buildLinkRows(graph, ids, store.getMarkers())).rows, sort);
    }
    return rows;
  };
  const printFrame = (rowsMode, count) => ({
    source: `Source: ${graphWindow?.title || 'Graph'} \u00b7 ${nodesTab ? 'Nodes' : 'Links'} \u00b7 ${TABLE_SCOPES.find((entry) => entry.id === state.scope)?.label || ''} scope${rowsMode === 'selected' ? ' \u00b7 selected' : rowsMode === 'shown' && filter ? ` \u00b7 filter "${filter}"` : ''}`,
    details: `${windowItem.title} \u00b7 ${count > TABLE_PDF_MAX_ROWS ? `first ${TABLE_PDF_MAX_ROWS.toLocaleString()} of ${count.toLocaleString()}` : count.toLocaleString()} ${count === 1 ? 'row' : 'rows'} \u00b7 ${new Date().toLocaleString('en-GB')}`,
  });
  const printColumns = (columnKeys) => columnKeys.map((key) => columns.find((column) => column.key === key)).filter(Boolean);
  const composePrint = ({ rowsMode, columnKeys, orientation }) => {
    const chosenRows = rowsFor(rowsMode);
    return tablePreview(chosenRows, printColumns(columnKeys), { ...printFrame(rowsMode, chosenRows.length), logoUrl: NBE_LOGO_URL, orientation });
  };
  const submitPrint = async ({ rowsMode, columnKeys, orientation, action }) => {
    // Print: a tab opened at once (still the click), filled with the PDF.
    const tab = action === 'print' ? window.open('', '_blank') : null;
    if (tab) tab.document.title = 'Preparing the table…';
    try {
      const chosenRows = rowsFor(rowsMode);
      const doc = await buildTablePdf({ rows: chosenRows, columns: printColumns(columnKeys), orientation, ...printFrame(rowsMode, chosenRows.length) });
      const name = tablePdfFileName(windowItem.title, tabKey);
      if (action === 'print' && tab) {
        doc.autoPrint();
        tab.location.href = URL.createObjectURL(doc.output('blob'));
      } else {
        downloadBlob(name, doc.output('blob'));
        if (action === 'print') notify({ title: 'Print table', message: 'The browser did not open a new tab: the PDF was downloaded instead; print it from there.', level: 'warning', source: windowItem.title });
      }
      setPrintOpen(false);
    } catch (error) {
      tab?.close();
      notify({ title: 'Print table', message: `The PDF could not be made: ${error?.message || error}`, level: 'error', source: windowItem.title });
    }
  };
  const refresh = () => {
    setRefreshCount((count) => count + 1);
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  /* ── Rows in sight (virtual scrolling) ── */
  const scrollRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const measure = () => setViewHeight(element.clientHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [store]);
  // (No layout in tests: then a screenful is assumed.)
  const inSight = Math.ceil((viewHeight || 640) / ROW_HEIGHT) + OVERSCAN * 2;
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const last = Math.min(rows.length, first + inSight);

  /* ── Graph <-> table ── */
  // A selection made here is not scrolled to (the row is already in sight).
  const ownSelection = useRef(false);
  const select = (row, event) => {
    const adding = event.ctrlKey || event.metaKey || event.shiftKey;
    const toggle = (list, id) => (list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id]);
    const nodes = nodesTab ? (adding ? toggle(selectedNodes, row.id) : [row.id]) : (adding ? selectedNodes : []);
    const edges = nodesTab ? (adding ? selectedEdges : []) : (adding ? toggle(selectedEdges, row.id) : [row.id]);
    ownSelection.current = true;
    requestGraphAction(graphId, { type: 'select', nodes, edges });
  };
  // Docked, the Graph window is not mounted while this one is shown: a
  // selection waits for it (and shows here at once); a focus brings the
  // Graph window up, where it is carried out.
  const focus = (row) => {
    ownSelection.current = true;
    const done = requestGraphAction(graphId, { type: 'focus', nodes: nodesTab ? [row.id] : [], edges: nodesTab ? [] : [row.id] });
    if (!done) focusWindow(graphId);
  };
  // Follow selection: the graph's newly selected row is scrolled into sight.
  useEffect(() => {
    if (ownSelection.current) {
      ownSelection.current = false;
      return;
    }
    if (!state.follow || !selectedSet.size) return;
    const index = rows.findIndex((row) => selectedSet.has(row.id));
    const element = scrollRef.current;
    if (index < 0 || !element) return;
    const top = index * ROW_HEIGHT;
    if (top < element.scrollTop || top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = Math.max(0, top - ROW_HEIGHT * 2);
    }
    // Only when the graph's selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSet]);

  /* ── Not linked, or the graph went ── */
  if (!graphWindow) {
    return (
      <div className="workspace_window_body table_window_body">
        <div ref={windowRef} className="table_window" onContextMenu={openMenu}>
          <div className="table_state" role="status">
            <h4>{graphId ? 'The linked Graph window was closed' : 'Link a Graph window'}</h4>
            <p>{graphs.length ? 'Choose the graph to show as a table.' : 'Open a Graph window first; its data is shown here as rows.'}</p>
            {graphs.length ? (
              <ul className="table_pick" aria-label="Graph windows">
                {graphs.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="table_button" onClick={() => linkTo(item.id)}>{item.title}</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="table_state_tip"><strong>Tip:</strong> To start a new graph from here, open the context menu.</p>
          {menu ? (
            <div className="graph_context_menu table_context_menu" role="menu" aria-label="Table actions" style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()}>
              <button
                type="button"
                role="menuitem"
                className="graph_context_menu_item"
                aria-disabled={Boolean(limitBlock)}
                title={limitBlock ? `You can have up to ${limitBlock.limit} ${limitBlock.label} windows open at a time. Close one to open another.` : 'Open a new Graph window and show it here'}
                onClick={newGraph}
                autoFocus
              >
                New Graph window
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const counts = { nodes: 0, links: 0 };
  if (store) {
    if (state.scope === 'all') { counts.nodes = snapshot.nodes; counts.links = snapshot.edges; }
    else if (state.scope === 'selected') { counts.nodes = selectedNodes.length; counts.links = selectedEdges.length; }
    else { counts.nodes = link.nodeIds.length; counts.links = link.edgeIds.length; }
  }

  let empty = '';
  if (!store || !snapshot.nodes) empty = 'The linked graph has no data yet.';
  else if (!link.live && state.scope !== 'all') empty = 'Waiting for the Graph window…';
  else if (!allRows.length) empty = state.scope === 'selected' ? `Nothing selected on the graph. Select ${nodesTab ? 'nodes' : 'links'} there, or switch the scope.` : `No ${nodesTab ? 'nodes' : 'links'} in this scope.`;
  else if (!rows.length) empty = 'No rows match the filter.';

  const gridColumns = shownColumns.map((column) => (column.key === '@label' ? 'minmax(160px, 2fr)' : 'minmax(110px, 1fr)')).join(' ');
  // Wider than the window with many columns: it scrolls sideways.
  const gridMinWidth = shownColumns.reduce((sum, column) => sum + (column.key === '@label' ? 160 : 110), 0);

  return (
    <div className="workspace_window_body table_window_body">
      <div className="table_window">
        {/* The Graph window's toolbar (analyst decision 2026-11-18): every
            top option in one bar, in the same container and buttons. */}
        <div className="graph_window_toolbar table_toolbar">
          <p className="graph_window_counts" aria-live="polite">
            <strong>{counts.nodes.toLocaleString()}</strong> {counts.nodes === 1 ? 'node' : 'nodes'} · <strong>{counts.links.toLocaleString()}</strong> {counts.links === 1 ? 'link' : 'links'}
            <span className="graph_window_hint"> · {TABLE_SCOPES.find((entry) => entry.id === state.scope)?.label.toLowerCase()}</span>
          </p>
          {dataNotice ? <span className="graph_window_flag is-warning linkx_tooltip_anchor" role="status" data-tooltip-placement="bottom" data-tooltip={dataNotice.detail}>{dataNotice.label}</span> : null}
          <LinkedGraphMenu icon={TABLE_ICON} graphs={graphs} graphId={graphId} onLink={linkTo} onShow={() => focusWindow(graphId)} />
          <div className="table_tabs" role="tablist" aria-label="Rows">
            {['nodes', 'links'].map((tab) => (
              <button key={tab} type="button" role="tab" aria-selected={state.tab === tab} className={`table_tab${state.tab === tab ? ' is-current' : ''}`} onClick={() => setState({ tab })}>
                <TabIcon kind={tab} />
                {tab === 'nodes' ? 'Nodes' : 'Links'}
                <span className="table_badge">{counts[tab].toLocaleString()}</span>
              </button>
            ))}
          </div>
          <ScopeMenu scopes={TABLE_SCOPES} scope={state.scope} onScope={(scope) => setState({ scope })} />
          <label className="graph_window_field table_filter_field">
            <StrokeIcon d={TOOL_ICONS.search} />
            <input type="search" aria-label="Filter rows" placeholder="Filter rows…" value={filter} maxLength={200} onChange={(event) => setFilter(event.target.value)} />
          </label>
          <div className="graph_window_tools" role="group" aria-label="Table tools">
            <ColumnsMenu columns={columns} onToggle={toggleColumn} onMove={moveColumn} onReset={() => setColumns({ order: [], hidden: [] })} />
            <button
              type="button"
              className={`graph_window_icon_button${state.follow ? ' is-active' : ''} linkx_tooltip_anchor`}
              aria-label="Follow selection"
              aria-pressed={state.follow}
              data-tooltip-placement="bottom"
              data-tooltip={state.follow ? 'Follow selection: on (scrolls to what is selected on the graph)' : 'Follow selection: off'}
              onClick={() => setState({ follow: !state.follow })}
            >
              <StrokeIcon d={TOOL_ICONS.follow} />
            </button>
            <GraphFileMenu
              label="Export"
              icon={<StrokeIcon d={TOOL_ICONS.export} />}
              disabled={Boolean(empty)}
              onPick={exportRows}
              items={[
                { id: 'csv', label: 'Export CSV', hint: 'The rows as shown: filtered, sorted, the columns in sight' },
                { id: 'copy', label: 'Copy rows', hint: 'Tab-separated, to paste into a spreadsheet' },
                { id: 'print', label: 'Print table…', hint: 'A PDF in the NBE frame: download it or print it' },
              ]}
            />
            <button type="button" className="graph_window_icon_button linkx_tooltip_anchor" aria-label="Refresh" data-tooltip-placement="bottom" data-tooltip="Refresh: read the linked graph again" onClick={refresh}>
              <StrokeIcon d={TOOL_ICONS.refresh} />
            </button>
          </div>
        </div>
        {empty ? (
          <div className="table_state" role="status"><p>{empty}</p></div>
        ) : (
          <div
            ref={scrollRef}
            className="table_scroll"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div className="table_grid" role="grid" aria-label={nodesTab ? 'Nodes' : 'Links'} aria-rowcount={rows.length + 1} style={{ '--table-columns': gridColumns, minWidth: gridMinWidth }}>
              <div className="table_row is-head" role="row" aria-rowindex={1}>
                {shownColumns.map((column) => {
                  const sorted = sort?.key === column.key ? sort.dir : null;
                  return (
                    <div key={column.key} role="columnheader" aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'} className="table_cell is-head">
                      <button type="button" onClick={() => sortBy(column.key)} title={`Sort by ${column.label}`}>
                        <span>{column.label}</span>
                        {sorted ? <span className="table_sort" aria-hidden="true">{sorted === 'asc' ? '▲' : '▼'}</span> : null}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div style={{ height: first * ROW_HEIGHT }} aria-hidden="true" />
              {rows.slice(first, last).map((row, offset) => (
                <div
                  key={row.id}
                  role="row"
                  aria-rowindex={first + offset + 2}
                  aria-selected={selectedSet.has(row.id)}
                  tabIndex={0}
                  className={`table_row${(first + offset) % 2 ? ' is-alt' : ''}${selectedSet.has(row.id) ? ' is-selected' : ''}`}
                  onClick={(event) => select(row, event)}
                  onDoubleClick={() => focus(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') focus(row);
                    else if (event.key === ' ') { event.preventDefault(); select(row, event); }
                  }}
                >
                  {shownColumns.map((column) => (
                    <div key={column.key} role="gridcell" className={`table_cell${column.numeric ? ' is-number' : ''}`} title={row.values[column.key] || undefined}>
                      {row.values[column.key] || <span className="table_blank">—</span>}
                    </div>
                  ))}
                </div>
              ))}
              <div style={{ height: (rows.length - last) * ROW_HEIGHT }} aria-hidden="true" />
            </div>
          </div>
        )}
        <footer className="table_footer">
          <span>{rows.length.toLocaleString()} {rows.length === 1 ? 'row' : 'rows'}{filter ? ` (of ${allRows.length.toLocaleString()})` : ''}{selectedHere ? ` · ${selectedHere.toLocaleString()} selected` : ''}</span>
          <span className="table_footer_hint">Click a row to select it on the graph · Ctrl / Shift + click adds · double-click or Enter focuses it</span>
        </footer>
        {printOpen ? (
          <TablePrintDialog
            rowCounts={{ shown: rows.length, all: allRows.length, selected: (nodesTab ? selectedNodes : selectedEdges).length }}
            columns={columns.map((column) => ({ key: column.key, label: column.label, hidden: Boolean(column.hidden) }))}
            defaultRowsMode={defaults.print.rows}
            defaultOrientation={defaults.print.page}
            compose={composePrint}
            onSubmit={submitPrint}
            onCancel={() => setPrintOpen(false)}
          />
        ) : null}
      </div>
    </div>
  );
}
