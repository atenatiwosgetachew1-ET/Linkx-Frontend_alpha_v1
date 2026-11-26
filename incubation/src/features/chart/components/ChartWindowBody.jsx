import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { WORKSPACE_WINDOW_TYPES, getWindowLimitBlock } from '../../../workspace/state/workspaceTypes.js';
import { getGraphStore, hasGraphStore } from '../../graph/lib/graphStore.js';
import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { getGraphState, requestGraphAction, subscribeGraphState } from '../../graph/lib/graphLinkBus.js';
import { requestChartMetric } from '../../graph/lib/layoutClient.js';
import { downloadBlob, downloadDataUrl, printImage } from '../../graph/lib/graphFile.js';
import { TABLE_SCOPES } from '../../table/lib/tableRows.js';
import { COLOR_SCHEMAS, DEFAULT_SCHEMA, SCHEMA_NAMES, nodeOwnColor } from '../lib/chartColors.js';
import { ADVANCED_HINT, CHART_METRICS, METRIC_GROUPS, isMetricAvailable, metricById } from '../lib/chartMetrics.js';
import { graphDataNotice } from '../../graph/lib/graphDataNotice.js';
import RunRemarkFlag from '../../../shared/components/RunRemarkFlag.jsx';
import { runRemark } from '../../../shared/runSettings.js';
import { resultCache } from '../lib/chartResultCache.js';
import { normalizeChartState, scopeInput, toneStep } from '../lib/chartState.js';
import { getChartDefaults, subscribeChartDefaults } from '../lib/chartDefaults.js';
import { histogramKeys, histogramValues } from '../lib/chartHistogram.js';
import ChartCard from './ChartCard.jsx';
import ChartSnapDialog from './ChartSnapDialog.jsx';
import { CELLS, SNAP_THEME, chartCell, chartsPdfFileName, figuresCell, framePages, pagesToPdf, snapFileName } from '../lib/chartSnaps.js';
import { buildChartOption } from '../lib/chartOption.js';
import { entityName } from '../../graph/report/graphReportModel.js';
import nbeLogoSvg from '../../graph/report/nbe_logo.svg?raw';
import StrokeIcon from '../../../shared/icons/StrokeIcon.jsx';
import { CHART_ICON, TOOL_ICONS } from '../../../shared/icons/windowIcons.js';
import { LinkedGraphMenu, ScopeMenu } from '../../graph/components/GraphCompanionTools.jsx';
import GraphToolbarPopover from '../../graph/components/GraphToolbarPopover.jsx';
import GraphFileMenu from '../../graph/components/GraphFileMenu.jsx';

// Chart window (G5; production's Chart window, A:10519, inventoried in
// graph-chart-plan §2.4; analyst decisions 2026-11-18): linked to a Graph
// window, it charts network metrics of that graph's entities as cards.
// Scope: what the graph draws (production), what is selected, or all of it.
// Each card: production's colour toggle and schemas, full screen, close; the
// global control sets every card. Selection both ways: the graph's selected
// entities show in their own colour; a click on a bar selects on the graph.
// Take snaps (a PNG per card), Print, Reset.
//
// Window metadata: chartGraph (the Graph window id), chartState (scope,
// cards, global; normalizeChartState).

const EMPTY = Object.freeze([]);
const noopSubscribe = () => () => {};
const NO_SNAPSHOT = { version: 0, dataVersion: 0, nodes: 0, edges: 0 };
// No selection colours (shared, so it never looks changed).
const NO_COLORS = Object.freeze({});
// A chart's level, short (the snap list).
const LEVEL_LABEL = { global: 'Global', node: 'Node', edge: 'Link' };
// The NBE logo for the snaps' header (the report's, as a data URL).
const NBE_LOGO_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(nbeLogoSvg)}`;

// Theme colours for the charts, read from the window (ECharts cannot read
// CSS variables).
const readTheme = (element) => {
  if (!element) return {};
  const style = getComputedStyle(element);
  const read = (name, fallback) => style.getPropertyValue(name).trim() || fallback;
  return { text: read('--graph-text', '#222222'), muted: read('--graph-muted-text', '#777777'), line: read('--graph-text', '#333333'), background: read('--graph-canvas-bg', '#ffffff'), selected: read('--graph-selected', '#2563eb'), surface: read('--graph-toolbar-bg', ''), border: read('--graph-border', ''), pinText: read('--chart-pin-callout-text', ''), pinBackground: read('--chart-pin-callout-bg', ''), pinBorder: read('--chart-pin-border', ''), pinShadow: read('--chart-pin-shadow', '') };
};


// A value that stays as it was while `frozen` (read during render: no
// effect, so the frozen value is never one render late).
const useFrozenWhile = (frozen, value) => {
  const kept = useRef(value);
  if (!frozen) kept.current = value;
  return frozen ? kept.current : value;
};

// Generation (analyst decision 2026-11-18).
const CHART_MODE_OPTIONS = Object.freeze([
  { id: 'auto', label: 'Automatic', hint: 'The starting charts (Libraries ▸ Charts) come up by themselves once linked' },
  { id: 'manual', label: 'Manual', hint: 'You choose: a whole category, or one chart at a time (New chart)' },
]);

// hidden: docked and not shown (kept mounted, WindowDock): dormant. It
// follows neither the graph nor its selection until shown again, then
// catches up once (analyst report 2026-11-18: a hidden Chart window
// redrawing on every graph selection made the Graph window slow).
export default function ChartWindowBody({ windowItem, hidden = false }) {
  const { windows, focusWindow, openWindow, nextWindowId, updateWindowMetadata } = useWorkspace();
  const { notify } = useNotifications();
  const windowId = windowItem.id;
  const metadata = useMemo(() => windowItem.metadata || {}, [windowItem.metadata]);
  // A window without a state of its own starts from Libraries ▸ Charts.
  const defaults = useSyncExternalStore(subscribeChartDefaults, getChartDefaults);
  const state = useMemo(() => normalizeChartState(metadata.chartState, defaults), [metadata.chartState, defaults]);
  const setState = useCallback((patch) => {
    updateWindowMetadata(windowId, { metadata: { chartState: { ...state, ...patch } } });
  }, [state, updateWindowMetadata, windowId]);

  const graphs = useMemo(() => windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.GRAPH), [windows]);
  const graphId = metadata.chartGraph ? String(metadata.chartGraph) : '';
  const graphWindow = graphs.find((item) => item.id === graphId) || null;
  const linkTo = (id) => updateWindowMetadata(windowId, { metadata: { chartGraph: id } });

  // Unlinked only, as the Table window: right-click ▸ New Graph window opens
  // one and links this chart window to it; unavailable once the Graph /
  // Chart / Table limit is reached.
  const [menu, setMenu] = useState(null); // { x, y } in the window
  useEffect(() => {
    if (!menu) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !event.target.closest?.('.chart_context_menu')) setMenu(null);
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
  const newGraph = () => {
    if (limitBlock) return;
    setMenu(null);
    const id = nextWindowId(WORKSPACE_WINDOW_TYPES.GRAPH);
    if (openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, {})) linkTo(id);
  };

  const store = graphWindow && hasGraphStore(graphId) ? getGraphStore(graphId) : null;
  const liveSnapshot = useSyncExternalStore(store && !hidden ? store.subscribe : noopSubscribe, store ? store.getSnapshot : () => NO_SNAPSHOT);
  const subscribeLink = useCallback((listener) => (graphId && !hidden ? subscribeGraphState(graphId, listener) : () => {}), [graphId, hidden]);
  const liveLink = useSyncExternalStore(subscribeLink, () => getGraphState(graphId));
  // While hidden, what was seen last (a render the workspace causes reads
  // nothing new).
  const snapshot = useFrozenWhile(hidden, liveSnapshot);
  const link = useFrozenWhile(hidden, liveLink);
  const dataNotice = graphDataNotice(snapshot, link, state.scope);
  const remark = runRemark(snapshot?.runSettings);
  const selectedNodes = link.selection.nodes;

  // The scope's entities and the links among them (theme lines left out,
  // as the Graph window's measures).
  const withCommunities = state.cards.some((card) => ['cohesion', 'temporal', 'communitySizes'].includes(card.metric));
  const withTimes = state.cards.some((card) => card.metric === 'temporal' || card.metric === 'heatMatrix');
  // The scope, by its content: only what the scope reads, and the graph's
  // data version (not a highlight's). A selection on the graph recomputes
  // the charts in the Selected scope alone (elsewhere it only recolours
  // them, keeping each chart and its zoom); the Graph window publishing
  // the same view again (its tab shown again) computes nothing.
  const scopeKey = useMemo(() => [
    graphId, snapshot.dataVersion ?? snapshot.version, state.scope, withCommunities, withTimes, link.weightKey, link.timeKey, link.timeSlice,
    state.scope === 'drawn' ? link.nodeIds.join('\u0001') : '',
    state.scope === 'drawn' ? link.edgeIds.join('\u0001') : '',
    state.scope === 'selected' ? link.selection.nodes.join('\u0001') : '',
  ].join('\u0002'),
  // link.selection only counts in the Selected scope (inside the key).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [graphId, snapshot.dataVersion, snapshot.version, state.scope, withCommunities, withTimes, link.weightKey, link.timeKey, link.timeSlice, link.nodeIds, link.edgeIds, state.scope === 'selected' ? link.selection.nodes : EMPTY]);
  const input = useMemo(() => (store ? scopeInput(store, link, state.scope, { communities: withCommunities, times: withTimes }) : { nodeIds: EMPTY, edges: EMPTY }),
    // Everything it reads is in scopeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, scopeKey]);
  // The Histogram's properties over the scope (only with a Histogram card).
  const hasHistogram = state.cards.some((card) => card.metric === 'histogram');
  const histogramOptions = useMemo(
    () => (hasHistogram && store ? histogramKeys(store.graph(), input.nodeIds, input.edges.map((edge) => edge.key)) : EMPTY),
    [hasHistogram, input, store],
  );
  // Names: entities by their label (else id); links as "From → To" (with
  // their label). Kept apart, as a node id may equal a link key.
  const names = useMemo(() => {
    if (!store) return { node: {}, edge: {} };
    const graph = store.graph();
    const nodeName = (id) => {
      const label = graph.hasNode(id) ? graph.getNodeAttribute(id, 'label') : null;
      return label != null && String(label).trim() ? String(label).trim() : String(id);
    };
    const node = Object.fromEntries(input.nodeIds.map((id) => [id, nodeName(id)]));
    const edge = Object.fromEntries(input.edges.map(({ key, source, target }) => {
      const label = store.getEdge(key)?.label;
      return [key, `${nodeName(source)} → ${nodeName(target)}${label != null && String(label).trim() ? ` (${String(label).trim()})` : ''}`];
    }));
    return { node, edge };
  }, [input, store]);

  // The names by a chosen column (snaps and prints: "Identify entities
  // by"); entities without a value keep their label.
  const namesBy = (nameKey) => {
    if (!store) return { node: {}, edge: {} };
    const graph = store.graph();
    const nodeName = (id) => entityName(graph, id, nameKey);
    const node = Object.fromEntries(input.nodeIds.map((id) => [id, nodeName(id)]));
    const edge = Object.fromEntries(input.edges.map(({ key, source, target }) => {
      const label = store.getEdge(key)?.label;
      return [key, `${nodeName(source)} \u2192 ${nodeName(target)}${label != null && String(label).trim() ? ` (${String(label).trim()})` : ''}`];
    }));
    return { node, edge };
  };

  const rootRef = useRef(null);
  // The theme's colours (kept per window, so a remount draws in them at
  // once; replaced only when they differ).
  const [theme, setTheme] = useState(() => resultCache.get(windowId)?.theme || {});
  useEffect(() => {
    const next = readTheme(rootRef.current);
    setTheme((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    resultCache.set(windowId, { ...resultCache.get(windowId), theme: next });
  }, [graphWindow, windowId]);
  // The graph's selection in its own colours (a link: its colour, else the
  // selection colour).
  // Kept apart per kind and by content (analyst report 2026-11-18: every
  // chart rebuilt for any selection): a node selection leaves the link
  // charts as they are and the other way round, and the same selection
  // published again changes nothing.
  const selectedEdges = link.selection.edges;
  const nodeSelectionKey = selectedNodes.join('\u0001');
  const edgeSelectionKey = selectedEdges.join('\u0001');
  const fallbackColour = theme.selected || '#2563eb';
  const nodeColors = useMemo(
    () => (store ? Object.fromEntries(selectedNodes.map((id) => [id, nodeOwnColor(store.getNode(id), fallbackColour)])) : NO_COLORS),
    // By content (nodeSelectionKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeSelectionKey, store, fallbackColour],
  );
  const edgeColors = useMemo(
    () => (store ? Object.fromEntries(selectedEdges.map((key) => [key, nodeOwnColor(store.getEdge(key), fallbackColour)])) : NO_COLORS),
    // By content (edgeSelectionKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edgeSelectionKey, store, fallbackColour],
  );
  // Link charts: the selected links, and the links of the selected entities
  // in the entity's colour (analyst decision 2026-11-18: an entity selected
  // shows its pin on link charts too, e.g. Assortativity, the Heat Matrix).
  const linkColors = useMemo(() => {
    if (!nodeSelectionKey) return edgeColors;
    const out = {};
    input.edges.forEach(({ key, source, target }) => {
      const colour = nodeColors[source] || nodeColors[target];
      if (colour) out[key] = colour;
    });
    return Object.keys(out).length ? { ...out, ...edgeColors } : edgeColors;
  }, [edgeColors, input, nodeColors, nodeSelectionKey]);
  // The charts follow the selection at a lower priority than the graph:
  // a click on the graph is never held up by the charts redrawing.
  const shownNodeColors = useDeferredValue(nodeColors);
  const shownEdgeColors = useDeferredValue(linkColors);
  // A card's colours: those of the kind it measures; none for the cards
  // that show no selection (figures, Temporal), so a click passes them by.
  const coloursFor = (entry) => {
    const result = entry?.status === 'ready' ? entry.result : null;
    if (!result || result.form === 'figures' || result.form === 'time') return NO_COLORS;
    return result.kind === 'edge' ? shownEdgeColors : shownNodeColors;
  };

  // Each card's metric, computed in the worker for the current scope; a
  // newer scope supersedes an older one. Results are kept per window across
  // remounts (docked tab switches unmount the window): coming back with the
  // same scope data shows them at once, without computing again; a new card
  // computes only its own metric.
  const inputKey = scopeKey;
  const [results, setResults] = useState(() => resultCache.get(windowId)?.results || {}); // metric -> { status, result, error }
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const resultsKeyRef = useRef(resultCache.get(windowId)?.key || '');
  const runRef = useRef(0);
  // A card's parameter (the Histogram's property) is part of its request.
  const paramKeyOf = (card) => (card?.param ? `${card.param.subject}:${card.param.key}` : '');
  const metricsKey = state.cards.map((card) => `${card.metric}${card.param ? `:${paramKeyOf(card)}` : ''}`).join('|');
  const requestedRef = useRef({}); // metric -> param key last asked for
  // What a metric is asked with: the scope; the Histogram, the chosen
  // property's values over the scope instead.
  const requestInput = (card) => {
    if (card.metric !== 'histogram' || !store) return input;
    const graph = store.graph();
    return {
      nodeIds: [],
      edges: [],
      values: histogramValues(graph, input.nodeIds, input.edges.map((edge) => edge.key), card.param),
      subject: card.param.subject,
      paramLabel: card.param.key === '@type' ? 'Type' : card.param.key,
    };
  };
  useEffect(() => {
    if (!store) return undefined;
    const sameInput = resultsKeyRef.current === inputKey;
    if (!sameInput) {
      runRef.current += 1;
      resultsKeyRef.current = inputKey;
    }
    const run = runRef.current;
    const current = sameInput ? resultsRef.current : {};
    const cardOf = new Map(state.cards.map((card) => [card.metric, card]));
    const metrics = [...cardOf.keys()];
    // Missing, or asked with another parameter.
    const todo = metrics.filter((metric) => !current[metric] || (current[metric].param || '') !== paramKeyOf(cardOf.get(metric)));
    setResults(Object.fromEntries(metrics.map((metric) => [metric, todo.includes(metric) ? { status: 'loading' } : current[metric]])));
    todo.forEach((metric) => {
      const card = cardOf.get(metric);
      const param = paramKeyOf(card);
      requestedRef.current[metric] = param;
      // Only the latest request for a metric lands (a parameter changed
      // while an older one ran).
      const latest = () => runRef.current === run && requestedRef.current[metric] === param;
      requestChartMetric(metric, requestInput(card))
        .then((result) => { if (latest()) setResults((now) => ({ ...now, [metric]: { status: 'ready', result, param } })); })
        .catch((error) => { if (latest()) setResults((now) => ({ ...now, [metric]: { status: 'error', error: error?.message || String(error), param } })); });
    });
    return undefined;
    // When the scope's data or the set of metrics changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, metricsKey, store]);
  // Kept for the next mount: the finished results only (a request still
  // running when the window unmounts is asked again).
  useEffect(() => {
    const ready = Object.fromEntries(Object.entries(results).filter(([, entry]) => entry.status === 'ready'));
    resultCache.set(windowId, { ...resultCache.get(windowId), key: resultsKeyRef.current, results: ready });
  }, [results, windowId]);
  // Closed Chart windows: their kept results go.
  useEffect(() => {
    const open = new Set(windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.CHART).map((item) => item.id));
    [...resultCache.keys()].forEach((id) => { if (!open.has(id)) resultCache.delete(id); });
  }, [windows]);

  // The board comes back where it was scrolled to.
  const gridRef = useRef(null);
  const boardShown = Boolean(store && snapshot.nodes && state.cards.length);
  useLayoutEffect(() => {
    const top = resultCache.get(windowId)?.scrollTop;
    if (boardShown && gridRef.current && top) gridRef.current.scrollTop = top;
    // On showing the board (a mount, or the first cards).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardShown]);

  /* ── Cards ── */
  // offset: its place among cards created together (a category).
  const newCard = (metricId, offset = 0) => ({
    id: `${metricId}-${Date.now().toString(36)}`, metric: metricId, colorful: state.global.colorful, schema: state.global.schema, tone: toneStep(state.toneCount + offset),
  });
  // New cards first, and the tone count moved past them.
  const withNewCards = (metricIds) => ({ cards: [...metricIds.map(newCard), ...state.cards], toneCount: state.toneCount + metricIds.length });
  // The metrics not yet on the board (available ones only), in menu order.
  const missing = (metricIds) => metricIds.filter((id) => isMetricAvailable(metricById(id)) && !state.cards.some((card) => card.metric === id));
  const addCard = (metricId) => {
    if (!missing([metricId]).length) return;
    // A new chart comes first, at the top of the board (analyst decision
    // 2026-11-18).
    setState(withNewCards([metricId]));
    setMenuOpen(false);
  };
  // Manual, a whole category at once: checked, all its charts come up (the
  // ones missing); unchecked, they all go. The menu stays open.
  const groupMetrics = (groupId) => CHART_METRICS.filter((metric) => metric.group === groupId && isMetricAvailable(metric)).map((metric) => metric.id);
  const groupState = (groupId) => {
    const ids = groupMetrics(groupId);
    const shown = ids.filter((id) => state.cards.some((card) => card.metric === id)).length;
    return shown === 0 ? 'false' : shown === ids.length ? 'true' : 'mixed';
  };
  const toggleGroup = (groupId) => {
    const ids = groupMetrics(groupId);
    if (groupState(groupId) === 'true') {
      if (fullCard && state.cards.some((card) => card.id === fullCard && ids.includes(card.metric))) setFullCard(null);
      setState({ cards: state.cards.filter((card) => !ids.includes(card.metric)) });
    } else {
      setState(withNewCards(missing(ids)));
    }
  };
  // Automatic: once linked to a graph, the starting charts (Libraries ▸
  // Charts; the Global-level ones unless chosen otherwise) come up by
  // themselves (once per graph: charts closed afterwards stay closed).
  useEffect(() => {
    if (!graphWindow || state.mode !== 'auto' || state.seeded === graphId) return;
    setState({ seeded: graphId, ...withNewCards(missing(defaults.autoMetrics)) });
    // Only on linking, or on turning Automatic on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphWindow, graphId, state.mode, state.seeded]);
  // Switching to Automatic fills the board at once (the global charts
  // missing); to Manual, the board is left as it is.
  const setMode = (mode) => setState({ mode, seeded: mode === 'auto' ? '' : state.seeded });
  const changeCard = (cardId, patch) => setState({ cards: state.cards.map((card) => (card.id === cardId ? { ...card, ...patch } : card)) });
  const closeCard = (cardId) => {
    setState({ cards: state.cards.filter((card) => card.id !== cardId) });
    if (fullCard === cardId) setFullCard(null);
  };
  // The global control sets every card (production).
  const setGlobal = (patch) => {
    const global = { ...state.global, ...patch };
    setState({ global, cards: state.cards.map((card) => ({ ...card, ...patch })) });
  };
  const [fullCard, setFullCard] = useState(null);
  useEffect(() => {
    if (!fullCard) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setFullCard(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullCard]);

  /* ── New chart menu ── */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (event.type === 'keydown' ? event.key === 'Escape' : !menuRef.current?.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', close);
    };
  }, [menuOpen]);
  // The menu is placed in the Chart window itself, kept inside it (it was
  // cropped by the window's edge when it hung off its button): under the
  // button, moved left to fit, as wide as the window allows (its columns
  // reflow), scrolling when the window is short.
  const menuButtonRef = useRef(null);
  const menuListRef = useRef(null);
  const [menuBox, setMenuBox] = useState(null);
  useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuBox(null);
      return undefined;
    }
    const place = () => {
      const frame = rootRef.current?.getBoundingClientRect();
      const button = menuButtonRef.current?.getBoundingClientRect();
      if (!frame || !button) return;
      // Not laid out (no size): left as it is.
      if (!frame.width || !frame.height) {
        setMenuBox({});
        return;
      }
      const gutter = 8;
      const width = Math.min(600, Math.max(0, frame.width - gutter * 2));
      const listWidth = Math.min(width, menuListRef.current?.offsetWidth || width);
      const top = button.bottom - frame.top + 4;
      setMenuBox({
        top,
        left: Math.max(gutter, Math.min(button.left - frame.left, frame.width - listWidth - gutter)),
        width,
        maxHeight: Math.max(120, frame.height - top - gutter),
      });
    };
    place();
    // Once more after the first frame: the menu's own width is known then.
    const frame = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(place) : null;
    window.addEventListener('resize', place);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', place);
    };
  }, [menuOpen]);

  /* ── Chart <-> graph ── */
  // kind: 'node' | 'edge' (the card's metric).
  // target: an id, or several (a bin's or a cell's members). Adding: they
  // join the selection, or leave it when all of them are in it already.
  const select = (target, adding, kind = 'node') => {
    const ids = Array.isArray(target) ? target : [target];
    const toggle = (list) => {
      const present = new Set(list);
      if (ids.every((id) => present.has(id))) {
        const gone = new Set(ids);
        return list.filter((entry) => !gone.has(entry));
      }
      return [...list, ...ids.filter((id) => !present.has(id))];
    };
    const nodes = kind === 'node' ? (adding ? toggle(selectedNodes) : ids) : (adding ? selectedNodes : []);
    const edges = kind === 'edge' ? (adding ? toggle(selectedEdges) : ids) : (adding ? selectedEdges : []);
    requestGraphAction(graphId, { type: 'select', nodes, edges });
  };
  const focus = (target, kind = 'node') => {
    const ids = Array.isArray(target) ? target : [target];
    const done = requestGraphAction(graphId, { type: 'focus', nodes: kind === 'node' ? ids : [], edges: kind === 'edge' ? ids : [] });
    if (!done) focusWindow(graphId);
  };

  // Stable handlers for the cards (memoized: a card re-renders only when
  // its own props change, not on every render of the window).
  const handlersRef = useRef({});
  handlersRef.current = { changeCard, closeCard, select, focus };
  const onCardChange = useCallback((...args) => handlersRef.current.changeCard(...args), []);
  const onCardClose = useCallback((...args) => handlersRef.current.closeCard(...args), []);
  const onCardSelect = useCallback((...args) => handlersRef.current.select(...args), []);
  const onCardFocus = useCallback((...args) => handlersRef.current.focus(...args), []);

  /* ── Snaps, print, reset ── */
  const charts = useRef(new Map()); // card id -> ECharts instance
  const onReady = useCallback((cardId, chart) => {
    if (chart) charts.current.set(cardId, chart);
    else charts.current.delete(cardId);
  }, []);
  // Each chart as a picture, as drawn now: [{ id, title, url }] (cards not
  // drawn yet left out); ids: those cards only, else every card.
  // size: the cell size (CELLS.group: two across an A4 page; CELLS.single:
  // one at full width).
  // nameKey: the column naming the entities ('' = the label).
  const pictures = async (ids = null, size = CELLS.group, nameKey = '') => {
    const named = nameKey ? namesBy(nameKey) : names;
    // The ECharts module (loaded already: the cards draw with it).
    const engine = await import('../lib/echarts.js').then((module) => module.default).catch(() => null);
    const list = await Promise.all(state.cards.filter((card) => !ids || ids.includes(card.id)).map(async (card) => {
      const entry = results[card.metric];
      if (entry?.status !== 'ready') return null;
      const metric = metricById(card.metric);
      const title = metric?.label || card.metric;
      const level = LEVEL_LABEL[metric?.group] || '';
      // Drawn for the white body (the snap's palette), with the card's own
      // colours, its selection pins and the zoom it shows now.
      const cellTheme = { ...SNAP_THEME, selected: theme.selected, tone: (COLOR_SCHEMAS[card.schema] || COLOR_SCHEMAS[DEFAULT_SCHEMA])(card.tone) };
      if (entry.result.form === 'figures') return { id: card.id, title, url: figuresCell({ title, level, items: entry.result.items, theme: cellTheme, size }) };
      const live = charts.current.get(card.id);
      if (!live) return null;
      const kind = entry.result.kind === 'edge' ? 'edge' : 'node';
      const { option } = buildChartOption(entry.result, { names: named[kind] || {}, colorful: card.colorful, schema: card.schema, selectedColors: coloursFor(entry), theme: cellTheme, paper: true });
      const zoom = typeof live.getModel === 'function' ? live.getModel()?.getComponent?.('dataZoom', 0)?.option : null;
      const zoomed = zoom && Number.isFinite(zoom.start) && Array.isArray(option.dataZoom)
        ? { ...option, dataZoom: option.dataZoom.map((entryZoom) => ({ ...entryZoom, start: zoom.start, end: zoom.end })) }
        : option;
      const url = await chartCell({ engine, live, option: zoomed, title, level, theme: cellTheme, size });
      return url ? { id: card.id, title, url } : null;
    }));
    return list.filter(Boolean);
  };

  /* ── Take snaps / Print charts (a popup: which charts, the layout, the
     naming) ── */
  const [exportPopup, setExportPopup] = useState(null); // 'snap' | 'print'
  // The charts' pictures for a naming (two across), made once per naming
  // while the popup is open.
  const cellCache = useRef(new Map()); // nameKey -> Promise<{ id: { id, title, url } }>
  const cellsFor = (nameKey) => {
    if (!cellCache.current.has(nameKey)) {
      cellCache.current.set(nameKey, pictures(null, CELLS.group, nameKey).then((list) => Object.fromEntries(list.map((picture) => [picture.id, picture]))));
    }
    return cellCache.current.get(nameKey);
  };
  const exportCharts = state.cards.map((card) => {
    const metric = metricById(card.metric);
    const entry = results[card.metric];
    return {
      id: card.id,
      title: metric?.label || card.metric,
      level: LEVEL_LABEL[metric?.group] || '',
      ready: entry?.status === 'ready' && (entry.result.form === 'figures' || charts.current.has(card.id)),
    };
  });
  const nameKeys = useMemo(() => (store && exportPopup ? store.propertyKeys() : []), [exportPopup, store]);
  const openExport = (purpose) => {
    cellCache.current = new Map();
    setExportPopup(purpose);
  };
  // The frame's right-hand lines: where the charts come from, and the snap.
  const snapFrame = (count) => ({
    remark: remark?.marked ? remark.short : '',
    logoUrl: NBE_LOGO_URL,
    source: `Source: ${graphWindow?.title || 'Graph'} \u00b7 ${TABLE_SCOPES.find((entry) => entry.id === state.scope)?.label || ''} scope`,
    details: `${windowItem.title} \u00b7 ${count} ${count === 1 ? 'chart' : 'charts'} \u00b7 ${new Date().toLocaleString('en-GB')}`,
  });
  // Group: the chosen charts two across A4 pages. -> [page data URL]
  const groupPages = async (ids, nameKey = '') => {
    const byId = await cellsFor(nameKey);
    const chosen = ids.map((id) => byId[id]).filter(Boolean);
    return chosen.length ? framePages(chosen, { ...snapFrame(chosen.length), layout: 'group' }) : [];
  };
  // Individual: each chart on its own A4 page, at the page's full width.
  // -> [{ title, page }]
  const singlePages = async (ids, nameKey = '') => {
    const cells = await pictures(ids, CELLS.single, nameKey);
    return Promise.all(cells.map(async (cell) => ({ title: cell.title, page: (await framePages([cell], { ...snapFrame(1), layout: 'single' }))[0] || (remark?.marked ? null : cell.url) }))); // never without the frame that says it
  };
  const previewTiles = async (nameKey) => Object.fromEntries(Object.values(await cellsFor(nameKey)).map((picture) => [picture.id, picture.url]));
  const exportWarning = (message) => notify({ title: exportPopup === 'print' ? 'Print charts' : 'Take snaps', message, level: 'warning', source: windowItem.title });
  // Print ▸ Download PDF: the pages as one PDF.
  const downloadPagesPdf = async (pages, now) => {
    const doc = await pagesToPdf(pages, { title: `${windowItem.title} \u00b7 charts` });
    downloadBlob(chartsPdfFileName(windowItem.title, now), doc.output('blob'));
  };
  const submitExport = async ({ ids, mode, nameKey, action = 'take' }) => {
    const byId = await cellsFor(nameKey);
    if (!ids.some((id) => byId[id])) {
      exportWarning('No chart to capture yet.');
      return;
    }
    const now = new Date();
    if (mode === 'group') {
      const pages = await groupPages(ids, nameKey);
      if (!pages.length) {
        exportWarning('The charts could not be drawn on a page. Try Individual.');
        return;
      }
      if (exportPopup === 'print' && action === 'download') await downloadPagesPdf(pages, now);
      else if (exportPopup === 'print') printImage(pages, { pages: true });
      else pages.forEach((url, index) => downloadDataUrl(snapFileName(windowItem.title, '', now, pages.length > 1 ? { number: index + 1, count: pages.length } : null), url));
    } else {
      const pages = (await singlePages(ids, nameKey)).filter((entry) => entry.page);
      if (!pages.length) {
        exportWarning('The charts could not be drawn on a page.');
        return;
      }
      if (exportPopup === 'print' && action === 'download') await downloadPagesPdf(pages.map((entry) => entry.page), now);
      else if (exportPopup === 'print') printImage(pages.map((entry) => entry.page), { pages: true });
      else pages.forEach((entry) => downloadDataUrl(snapFileName(windowItem.title, entry.title, now), entry.page));
    }
    setExportPopup(null);
  };
  const resetCharts = () => {
    setFullCard(null);
    setState({ cards: [] });
  };

  /* ── Not linked, or the graph went ── */
  if (!graphWindow) {
    return (
      <div className="workspace_window_body chart_window_body">
        <div
          ref={rootRef}
          className="chart_window"
          onContextMenu={(event) => {
            event.preventDefault();
            const box = rootRef.current?.getBoundingClientRect();
            setMenu({ x: event.clientX - (box?.left || 0), y: event.clientY - (box?.top || 0) });
          }}
        >
          <div className="chart_state" role="status">
            <h4>{graphId ? 'The linked Graph window was closed' : 'Link a Graph window'}</h4>
            <p>{graphs.length ? 'Choose the graph to chart.' : 'Open a Graph window first; its network metrics are charted here.'}</p>
            {graphs.length ? (
              <ul className="chart_pick" aria-label="Graph windows">
                {graphs.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="chart_button" onClick={() => linkTo(item.id)}>{item.title}</button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <p className="chart_state_tip"><strong>Tip:</strong> To start a new graph from here, open the context menu.</p>
          {menu ? (
            <div className="graph_context_menu chart_context_menu" role="menu" aria-label="Chart actions" style={{ left: menu.x, top: menu.y }} onContextMenu={(event) => event.preventDefault()}>
              <button
                type="button"
                role="menuitem"
                className="graph_context_menu_item"
                aria-disabled={Boolean(limitBlock)}
                title={limitBlock ? `You can have up to ${limitBlock.limit} ${limitBlock.label} windows open at a time. Close one to open another.` : 'Open a new Graph window and chart it here'}
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

  // Nothing drawn yet: the Graph window may still be fetching, or have failed.
  const graphStatus = (store && !snapshot.nodes && snapshot.status) || {};
  const graphLoading = graphStatus.state === 'loading' || graphStatus.state === 'queued';
  const graphError = graphStatus.state === 'error' ? graphStatus.message || '' : '';
  let empty = '';
  if (graphLoading) empty = 'Loading the graph…';
  else if (graphStatus.state === 'error') empty = 'The linked graph could not be loaded.';
  else if (!store || !snapshot.nodes) empty = 'The linked graph has no data yet.';
  else if (!link.live && state.scope !== 'all') empty = 'Waiting for the Graph window…';

  return (
    <div className="workspace_window_body chart_window_body">
      <div ref={rootRef} className="chart_window">
        {/* The Graph window's toolbar (analyst decision 2026-11-18): every
            top option in one bar, the global colour control included. */}
        <div className="graph_window_toolbar chart_toolbar">
          <p className="graph_window_counts" aria-live="polite">
            <strong>{input.nodeIds.length.toLocaleString()}</strong> {input.nodeIds.length === 1 ? 'entity' : 'entities'} · <strong>{input.edges.length.toLocaleString()}</strong> {input.edges.length === 1 ? 'link' : 'links'} in scope
          </p>
          <RunRemarkFlag remark={remark} />
          {dataNotice ? <span className="graph_window_flag is-warning linkx_tooltip_anchor" role="status" data-tooltip-placement="bottom" data-tooltip={dataNotice.detail}>{dataNotice.label}</span> : null}
          <LinkedGraphMenu icon={CHART_ICON} graphs={graphs} graphId={graphId} onLink={linkTo} onShow={() => focusWindow(graphId)} />
          <ScopeMenu scopes={TABLE_SCOPES} scope={state.scope} onScope={(scope) => setState({ scope })} />
          <GraphToolbarPopover label="Generation" tooltip={`Generation: ${CHART_MODE_OPTIONS.find((entry) => entry.id === state.mode).hint}`} icon={<StrokeIcon d={TOOL_ICONS.generation} />} text={CHART_MODE_OPTIONS.find((entry) => entry.id === state.mode).label}>
            {(close) => (
              <>
                <strong>Generation</strong>
                {CHART_MODE_OPTIONS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={entry.id === state.mode}
                    className="graph_overlay_menu_item is-described"
                    onClick={() => { close(); if (entry.id !== state.mode) setMode(entry.id); }}
                  >
                    <span className="graph_overlay_menu_check" aria-hidden="true">{entry.id === state.mode ? '✓' : ''}</span>
                    <span>
                      {entry.label}
                      <small>{entry.hint}</small>
                    </span>
                  </button>
                ))}
              </>
            )}
          </GraphToolbarPopover>
          <div ref={menuRef} className="chart_new">
            <button ref={menuButtonRef} type="button" className="graph_window_button is-compact chart_new_button" aria-haspopup="menu" aria-expanded={menuOpen} disabled={Boolean(empty)} onClick={() => setMenuOpen((open) => !open)}>
              <StrokeIcon d={TOOL_ICONS.plus} /> New chart
            </button>
            {menuOpen ? (
              <div
                ref={menuListRef}
                className="chart_menu"
                role="menu"
                aria-label="New chart"
                style={menuBox ? { top: menuBox.top, left: menuBox.left, maxWidth: menuBox.width, maxHeight: menuBox.maxHeight } : { visibility: 'hidden' }}
              >
                {METRIC_GROUPS.map((group) => (
                  <div key={group.id} className="chart_menu_group" role="group" aria-label={group.label}>
                    {/* The whole category (Manual's first way): checked, all of its charts. */}
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={groupState(group.id)}
                      className="chart_menu_heading"
                      title={groupState(group.id) === 'true' ? `Remove every ${group.label.replace(/s$/, '').toLowerCase()}` : `Show every ${group.label.replace(/s$/, '').toLowerCase()} (${groupMetrics(group.id).length})`}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <span className={`chart_menu_box is-${groupState(group.id)}`} aria-hidden="true" />
                      {group.label}
                      <span className="chart_menu_count">{groupMetrics(group.id).length}</span>
                    </button>
                    {CHART_METRICS.filter((metric) => metric.group === group.id).map((metric) => {
                      const available = isMetricAvailable(metric);
                      const created = state.cards.some((card) => card.metric === metric.id);
                      return (
                        <button
                          key={metric.id}
                          type="button"
                          role="menuitem"
                          className="chart_menu_item"
                          aria-disabled={!available || created}
                          title={!available ? `Arrives with ${metric.slice}` : created ? 'Already on the board' : metric.hint || ''}
                          aria-description={metric.advanced ? `Advanced. ${ADVANCED_HINT}` : undefined}
                          onClick={() => addCard(metric.id)}
                        >
                          <span>
                            {metric.label}
                            {metric.advanced ? <span className="chart_advanced_tag" aria-hidden="true">Advanced</span> : null}
                          </span>
                          {created ? <span className="chart_menu_note">✓</span> : !available ? <span className="chart_menu_note">{metric.slice}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="graph_window_tools" role="group" aria-label="Charts">
            {/* The global control (production's top bar), in a panel. */}
            <GraphToolbarPopover label="Colours" tooltip="Colours: the global control, for every chart" role="dialog" icon={<StrokeIcon d={TOOL_ICONS.colours} />} active={state.global.colorful} disabled={!state.cards.length}>
              {() => (
                <div className="chart_colours">
                  <strong>Global control</strong>
                  <label className="chart_colours_row">
                    <span className="chart_switch">
                      <input type="checkbox" aria-label="Colour every chart" checked={state.global.colorful} onChange={(event) => setGlobal({ colorful: event.target.checked })} />
                      <span aria-hidden="true" />
                    </span>
                    Colour by the schema
                  </label>
                  <label className="chart_colours_row">
                    Schema
                    <select className="chart_select" aria-label="Colour schema of every chart" value={state.global.schema} onChange={(event) => setGlobal({ schema: event.target.value })}>
                      {SCHEMA_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  </label>
                  <small>Sets every chart; each card keeps its own controls.</small>
                </div>
              )}
            </GraphToolbarPopover>
            <button
              type="button"
              className={`graph_window_icon_button${state.follow ? ' is-active' : ''} linkx_tooltip_anchor`}
              aria-label="Follow selection"
              aria-pressed={state.follow}
              data-tooltip-placement="bottom"
              data-tooltip={state.follow ? 'Follow selection: on (each chart zooms to what is selected on the graph)' : 'Follow selection: off'}
              onClick={() => setState({ follow: !state.follow })}
            >
              <StrokeIcon d={TOOL_ICONS.follow} />
            </button>
            <GraphFileMenu
              label="Export"
              icon={<StrokeIcon d={TOOL_ICONS.export} />}
              disabled={!state.cards.length}
              onPick={(id) => openExport(id === 'snaps' ? 'snap' : 'print')}
              items={[
                { id: 'snaps', label: 'Take snaps…', hint: 'A4 PNG pages: all or some charts, two across or one each' },
                { id: 'print', label: 'Print charts…', hint: 'A4 pages: all or some charts, two across or one each' },
              ]}
            />
            <button type="button" className="graph_window_icon_button linkx_tooltip_anchor" aria-label="Reset" data-tooltip-placement="bottom" data-tooltip="Reset: remove every chart" disabled={!state.cards.length} onClick={resetCharts}>
              <StrokeIcon d={TOOL_ICONS.reset} />
            </button>
          </div>
        </div>
        {graphLoading ? (
          <WindowLoadScreen className="is-block" label="Loading the graph…" />
        ) : empty ? (
          <div className="chart_state" role="status"><p>{empty}</p>{graphError ? <p>{graphError}</p> : null}</div>
        ) : state.cards.length ? (
          <div
            ref={gridRef}
            className="chart_grid"
            onScroll={(event) => { resultCache.set(windowId, { ...resultCache.get(windowId), scrollTop: event.currentTarget.scrollTop }); }}
          >
            {state.cards.map((card) => {
              const metric = metricById(card.metric);
              if (!metric) return null;
              // Each card its own colour along its schema, at the step it
              // was given when created (analyst decision 2026-11-18): kept
              // when cards are added or removed.
              const tone = (COLOR_SCHEMAS[card.schema] || COLOR_SCHEMAS[DEFAULT_SCHEMA])(card.tone);
              return (
                <ChartCard
                  key={card.id}
                  card={card}
                  metric={metric}
                  state={results[card.metric]}
                  names={names}
                  selectedColors={coloursFor(results[card.metric])}
                  theme={theme}
                  full={fullCard === card.id}
                  follow={state.follow}
                  histogramOptions={card.metric === 'histogram' ? histogramOptions : undefined}
                  tone={tone}
                  onChange={onCardChange}
                  onClose={onCardClose}
                  onFull={setFullCard}
                  onSelect={onCardSelect}
                  onFocus={onCardFocus}
                  onReady={onReady}
                />
              );
            })}
          </div>
        ) : (
          <>
            <div className="chart_state" role="status">
              <h4>No charts yet</h4>
              <p>Each chart measures the linked graph in its scope; selecting on a chart selects on the graph.</p>
            </div>
            <p className="chart_state_tip is-above-footer"><strong>Tip:</strong> To create a chart, choose <strong>New chart</strong> in the toolbar.</p>
          </>
        )}
        {exportPopup ? (
          <ChartSnapDialog
            purpose={exportPopup}
            charts={exportCharts}
            nameKeys={nameKeys}
            load={previewTiles}
            compose={groupPages}
            onSubmit={submitExport}
            onCancel={() => setExportPopup(null)}
          />
        ) : null}
        <footer className="chart_footer">
          <span>{state.cards.length.toLocaleString()} {state.cards.length === 1 ? 'chart' : 'charts'}{selectedNodes.length + selectedEdges.length ? ` · ${(selectedNodes.length + selectedEdges.length).toLocaleString()} selected on the graph` : ''}</span>
          <span className="chart_footer_hint">Click a bar to select it on the graph · Ctrl / Shift + click adds · double-click focuses it · a pin marks what is selected: click it to zoom</span>
        </footer>
      </div>
    </div>
  );
}

