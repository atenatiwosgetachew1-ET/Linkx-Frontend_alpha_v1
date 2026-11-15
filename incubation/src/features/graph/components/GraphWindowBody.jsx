import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useSession } from '../../../shared/session/useSession.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { getActiveDomainKey } from '../../configuration/lib/configModel.js';
import { buildEvidencePayload, buildRelationshipPayload } from '../../../services/graphApi.js';
import { getCachedEvidenceGraph, cacheEvidenceGraph } from '../../reports/lib/evidenceGraphs.js';
import { markGpuNotCapable } from '../../../shared/device/gpuCapability.js';
import { getTasksSnapshot, subscribeTasks } from '../../tasks/lib/taskRegistry.js';
import { disposeGraphStore, getGraphStore } from '../lib/graphStore.js';
import { forgetLayoutOwner } from '../lib/layoutClient.js';
import { runGraphFetch } from '../lib/graphFetchRunner.js';
import { getGraphSession, subscribeGraphSession } from '../lib/graphStatus.js';
import { linkGraphToSession, linkableSources, resolveSourceWindow, unlinkGraph } from '../lib/graphLinkFlow.js';
import {
  DEFAULT_GRAPH_SETTINGS, GRAPH_LIMITS, applyPerformancePolicy, layoutSignatureOf, normalizeGraphSettings, viewKeyOf, visibleCapFor,
} from '../lib/graphSettings.js';
import { RENDERERS, markGpuSuggested, resolveRenderer, setGpuPreference, shouldSuggestGpu, subscribeGpuPreference } from '../lib/rendererPreference.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { allPairsLinked, contextMenuItems } from '../lib/graphContextMenu.js';
import {
  ALL_PATHS_LIMITS, ELEMENT_TYPES, PATH_MODES, applyElementFilters, degreeEncoding, detectCommunities,
  findAllSimplePaths, findCutPoints, findShortestPath, inferNodeKeys, nodeColor, paletteColor, pathModeOf,
  propertyEncoding, separateCommunities,
} from '../lib/graphAnalysis.js';
import {
  readAlertRules, readElementFilters, readPathOptions, writeAlertRules, writeElementFilters, writePathOptions,
} from '../lib/analysisPrefs.js';
import {
  ALERT_AUTO_SCAN_LIMITS, ALERT_RULE_FIELDS, ALERT_SCAN_DELAY_MS, alertFocusNode, alertNameMissing, alertNodeName, alertPropertyKeys, alertSummary,
  describeGraphAlert, generateGraphAlerts, normalizeAlertRules,
} from '../lib/graphAlerts.js';
import { requestContextTab } from '../../../workspace/state/contextTabRequests.js';
import {
  clearPinnedEvidence, edgeKeyForPinned, evidenceItems, getPinnedEvidence, pinEvidence, pinnedEdgeId, pinnedFitNodes, pinnedInGraph,
  subscribePinnedEvidence, unpinEvidence,
} from '../lib/pinnedEvidence.js';
import {
  MAX_SAVED_VIEWS, defaultViewName, fromSavedView, graphScope, removeSavedViews, savedElementFilters, savedViewsFor,
  storeSavedView, toSavedSettings,
} from '../lib/savedViews.js';
import GraphAlertsPanel from './GraphAlertsPanel.jsx';
import { GraphOverlayDock } from './GraphOverlayPanel.jsx';
import GraphPinnedPanel from './GraphPinnedPanel.jsx';
import GraphCombinedPanel from './GraphCombinedPanel.jsx';
import GraphSemanticLegend from './GraphSemanticLegend.jsx';
import GraphOverlayMenu from './GraphOverlayMenu.jsx';
import GraphZoomBox from './GraphZoomBox.jsx';
import GraphAdjustBox from './GraphAdjustBox.jsx';
import {
  edgeBoxValues, edgeColorPatch, edgeStylePatch, edgeWidthPatch, nodeBoxValues, nodeColorPatches, nodeIconPatch, nodeShapePatch,
} from '../lib/graphEditing.js';
import {
  ANNOTATION_ACTIONS, ANNOTATION_PROMPTS, annotationBoxKind, annotationBoxValues, annotationNode, fromDateTimeLocalValue, hasAttachment,
  oleIconRepair, openAttachment, themeLineEdge, themeLineOrder,
} from '../lib/graphAnnotations.js';
import { getOverlayPrefs, setOverlayPref, subscribeOverlayPrefs } from '../lib/overlayPrefs.js';
import { getClipboard, setClipboard, subscribeClipboard } from '../lib/graphClipboard.js';
import { nodeFilterKey } from '../lib/graphAnalysis.js';
import { getNodeValue } from '../lib/graphModel.js';
import GraphDialog from './GraphDialog.jsx';
import GraphCanvas from './GraphCanvas.jsx';
import GraphContextMenu from './GraphContextMenu.jsx';

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {(Array.isArray(d) ? d : [d]).map((path) => <path key={path} d={path} />)}
  </svg>
);
const ICONS = {
  zoomArea: ['M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm21 21-5.5-5.5', 'M7 8h1', 'M12 8h1', 'M7 12h1', 'M12 12h1'],
  fit: ['M4 9V5a1 1 0 0 1 1-1h4', 'M15 4h4a1 1 0 0 1 1 1v4', 'M20 15v4a1 1 0 0 1-1 1h-4', 'M9 20H5a1 1 0 0 1-1-1v-4'],
  zoomIn: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-4-4', 'M11 8v6', 'M8 11h6'],
  zoomOut: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-4-4', 'M8 11h6'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  plus: ['M12 5v14', 'M5 12h14'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
};

const formatCount = (value) => Number(value || 0).toLocaleString();

// Production getDefaultGraphNodeColor (GA:3068): an added node's colour,
// by theme (drawn as the theme's default node).
const defaultNodeColor = () => (document.documentElement.getAttribute('data-theme') === 'dark'
  ? { background: 'rgba(0,0,0,0)', border: '#3e5775', highlight: { background: 'rgba(0,0,0,0)', border: '#4a6484' }, hover: { background: 'rgba(0,0,0,0)', border: '#446082' } }
  : { background: 'rgba(0,0,0,0)', border: '#777777', highlight: { background: 'rgba(0,0,0,0)', border: '#333333' }, hover: { background: 'rgba(0,0,0,0)', border: '#555555' } });

// Graph editing actions (G3.1), run by runEditAction.
const EDIT_ACTIONS = new Set(['group', 'ungroup', 'merge_nodes', 'add_node', 'delete', 'link', 'unlink', 'unlinks', 'copy', 'paste', 'bring_to_front', 'add_theme_line', ...ANNOTATION_ACTIONS]);
// Selection tools (G3.6, after i2 Analyst's Notebook), run by runSelectAction.
const SELECT_ACTIONS = new Set(['select_all', 'invert_selection', 'select_by_type', 'select_by_property', 'select_link_ends', 'show_hidden', 'select_linked', 'select_same_type', 'hide_selected']);
// A node's type for Select by Type: its annotation kind, else its
// node_identity (Entity / Source / Target Node), else "Nodes".
const ELEMENT_LABELS = Object.fromEntries(ELEMENT_TYPES.map((type) => [type.id, type.label]));
const nodeTypeOf = (node) => {
  const key = nodeFilterKey(node);
  if (key !== 'nodes') return ELEMENT_LABELS[key];
  return node?.node_identity ? String(node.node_identity) : 'Nodes';
};
const isDarkTheme = () => document.documentElement.getAttribute('data-theme') === 'dark';

// State kept in the window's graph store, so it survives the body remounting
// (docked <-> floating, docked tab switches). `restore` adjusts a kept value.
const useWindowUiState = (store, key, initial, restore) => {
  const [value, setValue] = useState(() => {
    const kept = store.getUi(key, initial);
    return restore ? restore(kept) : kept;
  });
  useEffect(() => store.setUi(key, value), [store, key, value]);
  return [value, setValue];
};
// Loads whose alert auto-open has run (production __alertAutoScanDone): one
// per finished load, kept across remounts (a load is its status object).
const ALERTS_AUTO_OPENED = new WeakSet();
const PINNED_AUTO_OPENED = new WeakSet(); // the same for the Pinned Evidence card
const COMBINED_AUTO_OPENED = new WeakSet(); // and for the Merged & Grouped card

const formatPinnedAt = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `Pinned ${date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
};
const EMPTY_SESSION = getGraphSession('');
const noopSubscribe = () => () => {};

// What this window shows: an evidence graph (Reports), a session linked to a
// Source stream (its relationship chips load the graph), or nothing yet.
const sourceOf = (metadata = {}) => {
  if (metadata.evidence?.traceId) return { kind: 'evidence', traceId: String(metadata.evidence.traceId), evidence: metadata.evidence };
  if (metadata.graphLinkSource) return { kind: 'session', sessionId: String(metadata.graphLinkSource) };
  return { kind: 'none' };
};

export default function GraphWindowBody({ windowItem }) {
  const windowId = windowItem.id;
  const metadata = useMemo(() => windowItem.metadata || {}, [windowItem.metadata]);
  const store = useMemo(() => getGraphStore(windowId), [windowId]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const workspace = useWorkspace();
  const { closeWindow, updateWindowMetadata } = workspace;
  const { tasks } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const { apiFetch, configuration } = useSession();
  const { notify } = useNotifications();
  const isCdr = getActiveDomainKey(configuration) === 'cdr';
  const canvasRef = useRef(null);
  const [isLayingOut, setIsLayingOut] = useState(false);
  const [linkTarget, setLinkTarget] = useState('');

  const source = useMemo(() => sourceOf(metadata), [metadata]);
  const sessionId = source.kind === 'session' ? source.sessionId : '';
  const subscribeSession = useCallback((listener) => subscribeGraphSession(sessionId, listener), [sessionId]);
  const session = useSyncExternalStore(
    sessionId ? subscribeSession : noopSubscribe,
    () => (sessionId ? getGraphSession(sessionId) : EMPTY_SESSION),
  );

  // Settings live in the window's metadata (edited from the right panel).
  const settings = useMemo(
    () => normalizeGraphSettings(metadata.graphSettings || DEFAULT_GRAPH_SETTINGS),
    [metadata.graphSettings],
  );

  // Renderer: canvas unless GPU is allowed, chosen on this device and capable.
  const [renderer, setRenderer] = useState(() => resolveRenderer(configuration));
  useEffect(() => subscribeGpuPreference(() => setRenderer(resolveRenderer(configuration))), [configuration]);
  const handleRendererFailed = useCallback((error) => {
    markGpuNotCapable(error?.message || 'GPU rendering failed on this device.');
    setGpuPreference(false);
    setRenderer(RENDERERS.CANVAS);
    notify({
      title: 'Switched to standard rendering',
      message: 'GPU rendering stopped working on this device, so the graph is drawn without it. Your view was kept.',
      level: 'warning',
      source: windowItem.title,
    });
  }, [notify, windowItem.title]);

  // The visible view, capped for the renderer (plan §5.3). An active search
  // (right panel → Filter) replaces it, as in production.
  const cap = visibleCapFor(renderer);
  const requested = settings.limit.max - settings.limit.min;
  const capped = requested > cap;
  const search = metadata.graphSearch;
  // Expand / collapse edits belong to the view they were made on; a new
  // limit, search or renderer cap starts from the plain view again
  // (production applyLimit rebuilds VISIBLE_STATE).
  const viewKey = useMemo(() => viewKeyOf(settings.limit, cap, search), [settings.limit, cap, search]);
  // Element types hidden with Filter Elements (production keeps the choice
  // on the device; each window starts from it).
  const elementFilters = useMemo(() => metadata.graphElementFilters || readElementFilters(), [metadata.graphElementFilters]);
  const view = useMemo(
    () => applyElementFilters(store.graph(), store.applyVisibility(store.searchView({
      ...settings.limit,
      max: settings.limit.min + Math.min(requested, cap),
      keyword: search?.keyword || '',
      includeLinked: Boolean(search?.includeLinked),
      keys: Array.isArray(search?.keys) ? search.keys : [],
    }), viewKey), elementFilters),
    // `snapshot.version` changes whenever the data (or an edit) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store, snapshot.version, settings.limit, cap, requested, search, viewKey, elementFilters],
  );
  useEffect(() => {
    store.setViewStats({ nodes: view.nodeIds.length, edges: view.edgeIds.length, searched: view.searched });
  }, [store, view]);
  const effective = useMemo(() => applyPerformancePolicy(settings, view.nodeIds.length), [settings, view.nodeIds.length]);

  // Once per device: a graph shown above the standard-drawing comfort limit
  // on a capable device suggests GPU rendering (Libraries → Graph rendering).
  const { openWindow } = workspace;
  useEffect(() => {
    if (renderer !== RENDERERS.CANVAS || view.nodeIds.length <= GRAPH_LIMITS.WARNING) return;
    if (!shouldSuggestGpu(configuration)) return;
    markGpuSuggested();
    notify({
      title: 'Faster drawing available',
      message: 'This device can draw large graphs faster with its GPU. You can turn it on in Libraries → Graph rendering.',
      level: 'info',
      source: windowItem.title,
      durationMs: 12000,
      action: {
        label: 'Open Libraries',
        onClick: () => openWindow(WORKSPACE_WINDOW_TYPES.LIBRARIES, {
          metadata: { librariesUi: { activeTab: 'graph_rendering' }, librariesRequest: { tab: 'graph_rendering', seq: Date.now() } },
        }),
      },
    });
  }, [configuration, notify, openWindow, renderer, view.nodeIds.length, windowItem.title]);

  // Production: the first draw of each fetched graph shows nodes 0–25 and
  // drops any search.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const resetRange = useCallback(() => {
    const current = settingsRef.current;
    updateWindowMetadata(windowId, {
      metadata: { graphSettings: { ...current, limit: { ...current.limit, min: 0, max: GRAPH_LIMITS.DEFAULT_VISIBLE } }, graphSearch: null },
    });
  }, [updateWindowMetadata, windowId]);

  // Production (src/App.jsx ~13876): an evidence request with no nodes and no
  // edges closes the window with "Graph Empty". Service requests often skip
  // the graph, so this is a normal outcome.
  const closeAsEmpty = useCallback(() => {
    notify({ title: 'Graph Empty', message: 'No graph data found for this evidence.', level: 'info', source: windowItem.title });
    disposeGraphStore(windowId);
    forgetLayoutOwner(windowId);
    closeWindow(windowId);
  }, [closeWindow, notify, windowId, windowItem.title]);

  /* ── Evidence (Reports) ─────────────────────────────────────────────── */
  const loadEvidence = useCallback(() => {
    if (source.kind !== 'evidence') return;
    const cached = getCachedEvidenceGraph(source.traceId);
    if (cached) {
      if (!cached.nodes.length && !cached.edges.length) {
        closeAsEmpty();
        return;
      }
      store.replace({ nodes: cached.nodes, edges: cached.edges });
      store.setStatus({ state: 'ready', source: 'evidence' });
      return;
    }
    runGraphFetch({
      store,
      apiFetch,
      source: 'evidence',
      label: 'the evidence graph',
      payload: buildEvidencePayload(source.traceId, { id: source.evidence.reportId, externalReferenceId: source.evidence.externalReferenceId }),
      onEmpty: () => {
        cacheEvidenceGraph(source.traceId, { data: null, nodes: [], edges: [] });
        closeAsEmpty();
      },
      onLoaded: () => cacheEvidenceGraph(source.traceId, { data: null, ...store.toPayload() }),
    });
  }, [apiFetch, closeAsEmpty, source, store]);

  useEffect(() => {
    if (source.kind === 'evidence' && store.getStatus().state === 'idle' && store.getSnapshot().nodes === 0) loadEvidence();
  }, [loadEvidence, source.kind, store]);

  /* ── Linked session: relationships load the graph ───────────────────── */
  const fetchRelationship = useCallback((relationship) => {
    if (!sessionId) return;
    updateWindowMetadata(windowId, { metadata: { graphRelationship: relationship } });
    runGraphFetch({
      store,
      apiFetch,
      source: 'relationship',
      label: relationship === '*' ? 'all relationships' : `“${relationship}”`,
      payload: buildRelationshipPayload(sessionId, relationship),
      onFirstChunk: resetRange,
      // Production closes the window here too, with the evidence message; a
      // linked window is kept (closing it would drop the link).
      onEmpty: () => notify({
        title: 'Graph Empty',
        message: `No graph data found for ${relationship === '*' ? 'this session' : `relationship ${relationship}`}.`,
        level: 'info',
        source: windowItem.title,
      }),
    });
  }, [apiFetch, notify, resetRange, sessionId, store, updateWindowMetadata, windowId, windowItem.title]);

  // Source terminated: production unlinks the windows and clears the
  // relationships, keeping what is drawn. Source closed: the window resets.
  useEffect(() => {
    if (!sessionId || !session.terminated) return;
    if (session.closed) {
      store.abortFetch();
      store.clear();
      store.setStatus({ state: 'idle' });
    }
    updateWindowMetadata(windowId, { metadata: { graphLinkSource: null, graphLinkAction: null, graphRelationship: null } });
    notify({
      title: 'Graph unlinked',
      message: session.closed ? `Source session ${sessionId} was closed.` : `Source session ${sessionId} was terminated; the graph is kept.`,
      level: 'info',
      source: windowItem.title,
    });
  }, [notify, session.closed, session.terminated, sessionId, store, updateWindowMetadata, windowId, windowItem.title]);

  /* ── Link / unlink ──────────────────────────────────────────────────── */
  const candidates = useMemo(() => linkableSources(workspace.windows, tasks), [workspace.windows, tasks]);
  const linking = Boolean(metadata.graphLinking);
  const handleLink = async (event) => {
    event.preventDefault();
    if (!linkTarget.trim()) return;
    const target = resolveSourceWindow(linkTarget, workspace.windows);
    if (!target) {
      notify({ title: 'Graph link blocked', message: 'The selected source window could not be found.', level: 'warning', source: windowItem.title });
      return;
    }
    // Blocked (production message) unless that source is streaming.
    const linked = await linkGraphToSession({ apiFetch, updateWindowMetadata, notify, graphWindowId: windowId, sourceSessionId: target.sourceSessionId });
    if (linked) setLinkTarget('');
  };
  const handleUnlink = () => unlinkGraph({ apiFetch, updateWindowMetadata, graphWindowId: windowId, sourceSessionId: sessionId });

  const retry = () => {
    if (snapshot.status.source === 'relationship' && metadata.graphRelationship) fetchRelationship(metadata.graphRelationship);
    else loadEvidence();
  };

  // An unlinked empty window can start a new graph: a blank canvas for the
  // analyst (graph-chart-plan G3; the authoring tools land there).
  const createBlankGraph = () => updateWindowMetadata(windowId, { metadata: { graphBlank: true } });

  /* ── Pinned evidence (G2.4b; production GA:5017-5195) ────────────────── */
  // One device-wide list; this window outlines the pinned items it holds.
  const pinned = useSyncExternalStore(subscribePinnedEvidence, getPinnedEvidence);
  // On-graph components shown (device-wide; toolbar ▸ On-graph components).
  const overlays = useSyncExternalStore(subscribeOverlayPrefs, getOverlayPrefs);
  // The device-wide graph clipboard (Copy / Paste across Graph windows).
  const clipboard = useSyncExternalStore(subscribeClipboard, getClipboard);
  const pinnedMarkerKey = useRef('');
  useEffect(() => {
    const sets = pinnedInGraph(store.graph(), pinned);
    const key = JSON.stringify(sets);
    // Writing markers bumps the store version: only when the set changes.
    if (key === pinnedMarkerKey.current) return;
    pinnedMarkerKey.current = key;
    if (sets.nodes.length || sets.edges.length) store.setMarkers('pinned', sets);
    else store.clearMarkers('pinned');
  }, [pinned, snapshot.version, store]);

  // The Pinned Evidence card: opens (folded) once a graph holding pinned
  // items has loaded, and whenever something is pinned here.
  const [pinnedPanel, setPinnedPanel] = useWindowUiState(store, 'pinnedPanel', { open: false, collapsed: true });
  // Which overlay card is drawn on top: the one last clicked / focused, or
  // the one an action just opened ('alerts' | 'pinned' | 'combined').
  const [frontCard, setFrontCard] = useWindowUiState(store, 'overlayFront', 'alerts');
  const pinnedHere = useMemo(() => {
    const graph = store.graph();
    return pinned.filter((item) => (item.type === 'node' ? graph.hasNode(item.id) : Boolean(edgeKeyForPinned(graph, item.id))));
    // The graph changes with the store version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, store, snapshot.version]);
  useEffect(() => {
    const status = snapshot.status;
    if (status.state !== 'ready' || !snapshot.nodes || PINNED_AUTO_OPENED.has(status)) return;
    PINNED_AUTO_OPENED.add(status);
    if (pinnedHere.length) setPinnedPanel((current) => ({ ...current, open: true }));
  }, [pinnedHere.length, setPinnedPanel, snapshot.nodes, snapshot.status]);

  // The Merged & Grouped card (analyst decision 2026-11-15): the graph's
  // group and merged nodes. Opens (folded) once a graph holding some has
  // loaded, and whenever nodes are grouped or merged here.
  const [combinedPanel, setCombinedPanel] = useWindowUiState(store, 'combinedPanel', { open: false, collapsed: true });
  const combinedCards = useMemo(() => {
    const graph = store.graph();
    const visible = new Set(view.nodeIds);
    const cards = [];
    graph.forEachNode((id, node) => {
      const merged = Array.isArray(node.merged_from) && node.merged_from.length > 0;
      if (!node.isGroup && !merged) return;
      const name = node.label != null && String(node.label).trim() ? String(node.label) : id;
      if (node.isGroup) {
        const members = Array.isArray(node.members) ? node.members : [];
        const names = members.map((member) => (member.label != null && String(member.label).trim() ? String(member.label) : String(member.id)));
        cards.push({ key: `group:${id}`, id, kind: 'group', name, count: `${members.length} members`, detail: names.join(', '), hidden: !visible.has(id) });
      } else {
        const count = Number(node.merge_count) || node.merged_from.length + 1;
        cards.push({ key: `merged:${id}`, id, kind: 'merged', name, count: `${count} nodes merged`, detail: `Merged from ${node.merged_from.join(', ')}`, hidden: !visible.has(id) });
      }
    });
    return cards;
    // The graph changes with the store version.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, snapshot.version, view.nodeIds]);
  useEffect(() => {
    const status = snapshot.status;
    if (status.state !== 'ready' || !snapshot.nodes || COMBINED_AUTO_OPENED.has(status)) return;
    COMBINED_AUTO_OPENED.add(status);
    if (combinedCards.length) setCombinedPanel((current) => ({ ...current, open: true }));
  }, [combinedCards.length, setCombinedPanel, snapshot.nodes, snapshot.status]);
  // Grouping or merging here shows the card in front.
  const showCombined = useCallback(() => {
    setCombinedPanel((current) => ({ ...current, open: true }));
    setOverlayPref('combined', true);
    setFrontCard('combined');
  }, [setCombinedPanel, setFrontCard]);

  // What Pin / Unpin act on (production pinEvidenceByContext /
  // pinSelectedEvidence): the right-clicked node, or the selected nodes and
  // edges when several are selected.
  const evidenceTargets = (request) => (
    request.kind === 'node' && request.selection.length <= 1
      ? { nodeIds: [request.id], edgeKeys: [] }
      : { nodeIds: request.selection, edgeKeys: request.edgeSelection || [] }
  );

  /* ── Right-click menu and double-click (GB:2096, GB:2536) ──────────── */
  const [menu, setMenu] = useState(null); // { x, y, kind, id, selection, content }
  // Zoom to area tool on (toolbar; one use).
  const [zoomingArea, setZoomingArea] = useState(false);
  const endZoomArea = useCallback(() => setZoomingArea(false), []);
  const zoomToArea = useCallback((box) => canvasRef.current?.zoomToRect(box), []);
  const closeMenu = useCallback(() => setMenu(null), []);
  const handleContextMenu = useCallback((request) => {
    if (!request) {
      setMenu(null);
      return;
    }
    const graph = store.graph();
    const visible = new Set(view.nodeIds);
    const targets = evidenceTargets(request);
    const pinnedKeys = new Set(pinned.map((item) => `${item.type}:${item.id}`));
    const targetKeys = [
      ...targets.nodeIds.map((id) => `node:${id}`),
      ...targets.edgeKeys.map((key) => `edge:${pinnedEdgeId(key)}`),
    ];
    const nodeHasEdges = request.kind === 'node' && graph.hasNode(request.id)
      && graph.someEdge(request.id, (key, attributes, source, target) => visible.has(source === request.id ? target : source));
    const content = contextMenuItems({
      kind: request.kind,
      nodeId: request.id,
      selection: request.selection,
      edge: request.kind === 'edge' ? store.getEdge(request.id) : null,
      isCdr,
      nodeHasEdges,
      selectionFullyLinked: request.selection.length > 1 && allPairsLinked(graph, request.selection),
      hasClipboard: clipboard.nodes.length > 0,
      pathHighlighted: store.hasMarkers('path') || store.hasMarkers('traversal', viewKey),
      nodeStylesChanged: store.hasNodePatches(),
      alertRules: settings.alertRules,
      edgeBundling: settings.edgeBundling,
      edgeSelectionCount: (request.edgeSelection || []).length,
      hiddenCount: store.hiddenCount(viewKey),
      drawnCount: view.nodeIds.length,
      savedViewCount: request.kind === 'canvas' && graph.order ? savedViewsFor(graphScope(graph)).length : 0,
      pinnedCount: pinned.length,
      canPin: targetKeys.some((key) => !pinnedKeys.has(key)),
      canUnpin: targetKeys.some((key) => pinnedKeys.has(key)),
    });
    if (!content.header && !content.items.length) return;
    setMenu({ ...request, content });
  }, [clipboard.nodes.length, isCdr, pinned, settings.alertRules, settings.edgeBundling, store, view.nodeIds, viewKey]);

  const notifyDrawingLimit = useCallback((skipped) => notify({
    title: 'Drawing limit reached',
    message: `${formatCount(skipped)} more node${skipped === 1 ? '' : 's'} could not be shown: this renderer draws at most ${formatCount(cap)} at once.`,
    level: 'warning',
    source: windowItem.title,
  }), [cap, notify, windowItem.title]);

  /* ── Analysis tools (G2.3; production graphs_adjuster.js) ────────────── */
  const [dialog, setDialog] = useState(null); // { ...GraphDialog props, onSubmit }
  const closeDialog = useCallback(() => setDialog(null), []);
  const report = useCallback((message, level = 'info') => notify({ title: 'Graph analysis', message, level, source: windowItem.title }), [notify, windowItem.title]);

  /* ── Undo / redo (G2.4d; production GA:1336-1556) ──────────────────── */
  // The window's own state goes into each step too (production's snapshot
  // held currentSettings), so undo also brings back the limit / search the
  // step was made on.
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const historyContext = useCallback(() => ({
    graphSettings: settingsRef.current,
    graphSearch: metadataRef.current.graphSearch ?? null,
    graphElementFilters: metadataRef.current.graphElementFilters ?? null,
  }), []);
  const warnedLargeHistory = useRef(false);
  // Called before each recorded action (production queueGraphHistoryCapture).
  const record = useCallback(() => {
    if (store.recordHistory(historyContext()) || warnedLargeHistory.current) return;
    warnedLargeHistory.current = true;
    notify({ title: 'History', message: 'Undo/Redo is disabled for large graphs (more than 4,500 entities).', level: 'warning', source: windowItem.title });
  }, [historyContext, notify, store, windowItem.title]);
  const stepHistory = useCallback((direction) => {
    const restored = direction === 'undo' ? store.undo(historyContext()) : store.redo(historyContext());
    if (!restored) return;
    if (restored.context) updateWindowMetadata(windowId, { metadata: restored.context });
    // Production re-selected the step's selection once redrawn.
    requestAnimationFrame(() => requestAnimationFrame(() => canvasRef.current?.select(restored.selection)));
  }, [historyContext, store, updateWindowMetadata, windowId]);

  // Shows found paths: their nodes become visible, then they are highlighted
  // (production highlightPath / PATH_HIGHLIGHT_STATE). Stays until cleared.
  const showPaths = useCallback((found) => {
    const nodeIds = new Set();
    const edgeIds = new Set();
    found.forEach((item) => {
      item.path.forEach((id) => nodeIds.add(id));
      item.edgeIds.forEach((id) => edgeIds.add(id));
    });
    const { skipped } = store.revealNodes([...nodeIds], { viewKey, visibleIds: view.nodeIds, cap });
    if (skipped) notifyDrawingLimit(skipped);
    store.setMarkers('path', { nodes: nodeIds, edges: edgeIds });
  }, [cap, notifyDrawingLimit, store, view.nodeIds, viewKey]);

  const runShortestPath = useCallback((ids) => {
    const current = readPathOptions();
    setDialog({
      title: 'Find Shortest Path',
      okText: 'Find path',
      fields: [
        { name: 'mode', label: 'Path mode', type: 'select', value: pathModeOf(current), options: PATH_MODES.map((mode) => ({ value: mode.id, label: mode.label })) },
        { name: 'includeThemeLines', label: 'Include theme lines', type: 'checkbox', value: current.includeThemeLines },
      ],
      onSubmit: ({ mode, includeThemeLines }) => {
        const chosen = PATH_MODES.find((item) => item.id === mode) || PATH_MODES[0];
        const options = { directed: chosen.directed, weighted: chosen.weighted, includeThemeLines: Boolean(includeThemeLines) };
        writePathOptions(options);
        const result = findShortestPath(store.graph(), ids[0], ids[1], options);
        if (!result.path.length) {
          report('No path found between the selected nodes.', 'warning');
          return;
        }
        record();
        showPaths([result]);
        const distance = result.weighted ? `Total cost: ${Number(result.totalCost).toFixed(3)}` : `Hops: ${Math.max(0, result.path.length - 1)}`;
        report(`Path found. Nodes: ${result.path.length}. ${distance}.`);
      },
    });
  }, [record, report, showPaths, store]);

  const runAllPaths = useCallback((ids) => {
    setDialog({
      title: 'Find All Paths',
      description: 'Uses the edge direction and theme-line choices of Find Shortest Path.',
      okText: 'Find paths',
      fields: [{ name: 'maxDepth', label: `Max depth (1–${ALL_PATHS_LIMITS.maxDepth}, recommended 4–8)`, type: 'number', min: 1, max: ALL_PATHS_LIMITS.maxDepth, value: ALL_PATHS_LIMITS.defaultDepth }],
      onSubmit: ({ maxDepth }) => {
        const current = readPathOptions();
        const depth = Math.max(1, Math.min(ALL_PATHS_LIMITS.maxDepth, Number(maxDepth) || ALL_PATHS_LIMITS.defaultDepth));
        const { paths, truncated } = findAllSimplePaths(store.graph(), ids[0], ids[1], {
          directed: current.directed, includeThemeLines: current.includeThemeLines, maxDepth: depth, maxPaths: ALL_PATHS_LIMITS.defaultPaths,
        });
        if (!paths.length) {
          report(truncated ? 'No paths found before the search limit was reached. Try a smaller depth.' : 'No paths found between the selected nodes.', 'warning');
          return;
        }
        record();
        showPaths(paths);
        report(`Found ${paths.length} path(s) within depth ${depth}.${truncated ? ' The search stopped at its limit, so there may be more.' : ''}`);
      },
    });
  }, [record, report, showPaths, store]);

  const runCutPoints = useCallback(() => {
    const points = findCutPoints(store.graph(), view.nodeIds);
    record();
    store.setMarkers('path', { nodes: points, edges: [] });
    if (!points.length) {
      report('No cut points found in the current visible graph.');
      return;
    }
    canvasRef.current?.select(points);
    report(`Found ${points.length} cut point(s).`);
  }, [record, report, store, view.nodeIds]);

  const runCommunities = useCallback(() => {
    const graph = store.graph();
    const communities = detectCommunities(graph, view.nodeIds, view.edgeIds);
    if (!communities.length) {
      report('No communities detected in the current visible graph.');
      return;
    }
    record();
    // Production separateCommunityLayout: each community moved onto a ring.
    const moved = separateCommunities(communities, (id) => store.getPosition(id));
    store.setPositions(Object.entries(moved));
    store.patchNodes(communities.flatMap((members, index) => {
      const color = nodeColor(paletteColor(index, communities.length));
      return members.map((id) => [id, { community_id: index + 1, color }]);
    }));
    requestAnimationFrame(() => canvasRef.current?.fit(communities.flat()));
    report(`${communities.length} communit${communities.length === 1 ? 'y' : 'ies'} detected; the largest has ${communities[0].length} node(s).`);
  }, [record, report, store, view.edgeIds, view.nodeIds]);

  const runVisualProperty = useCallback(() => {
    const graph = store.graph();
    const { numeric, categorical } = inferNodeKeys(view.nodeIds.map((id) => graph.getNodeAttributes(id)));
    const keys = [...numeric, ...categorical];
    if (!keys.length) {
      report('The visible nodes have no properties to visualize.', 'warning');
      return;
    }
    setDialog({
      title: 'Visualize by Property',
      description: 'Numbers scale size and colour; text values get one colour each.',
      okText: 'Apply',
      fields: [{ name: 'key', label: 'Property', type: 'select', value: keys[0], options: keys.map((key) => ({ value: key, label: key })) }],
      onSubmit: ({ key }) => {
        record();
        store.patchNodes(propertyEncoding(store.graph(), view.nodeIds, key));
      },
    });
  }, [record, report, store, view.nodeIds]);

  const runElementFilter = useCallback(() => {
    setDialog({
      title: 'Filter Graph Elements',
      okText: 'Apply',
      fields: [{
        name: 'types',
        label: 'Visible graph elements',
        type: 'checkboxes',
        value: ELEMENT_TYPES.filter((type) => elementFilters[type.id]).map((type) => type.id),
        options: ELEMENT_TYPES.map((type) => ({ value: type.id, label: type.label, description: type.description })),
      }],
      onSubmit: ({ types }) => {
        const chosen = new Set(types);
        const next = Object.fromEntries(ELEMENT_TYPES.map((type) => [type.id, chosen.has(type.id)]));
        writeElementFilters(next);
        updateWindowMetadata(windowId, { metadata: { graphElementFilters: next } });
        requestAnimationFrame(() => canvasRef.current?.fit());
      },
    });
  }, [elementFilters, updateWindowMetadata, windowId]);

  /* ── Graph alerts (G2.4; production GA:4776-5015) ───────────────────── */
  // Rules are kept on the device (production linkx_alert_rules_v1); on / off
  // is a window setting (production currentSettings.alertRules).
  const [alertRules, setAlertRules] = useState(readAlertRules);
  const [alerts, setAlerts] = useWindowUiState(store, 'alerts', []);
  // A rescan cut short by a remount is not resumed: it shows the last results.
  const [alertsPanel, setAlertsPanel] = useWindowUiState(store, 'alertsPanel', { open: false, scanning: false }, (kept) => ({ ...kept, scanning: false }));
  const [alertNameKey, setAlertNameKey] = useWindowUiState(store, 'alertNameKey', '');
  const alertMarkerKey = useRef('');
  // Both overlay cards start folded to their header (analyst decision 2026-11-15).
  const [alertsCollapsed, setAlertsCollapsed] = useWindowUiState(store, 'alertsCollapsed', true);
  const alertsEnabled = settings.alertRules;

  // Production applyAlertHighlight. Markers are only rewritten when the
  // flagged set changes: writing them bumps the store version, which
  // rebuilds the view and would otherwise scan again forever.
  const applyAlerts = useCallback((found) => {
    const nodes = found.filter((item) => item.nodeId != null).map((item) => String(item.nodeId));
    const edges = found.filter((item) => item.edgeId != null).map((item) => String(item.edgeId));
    const key = JSON.stringify([nodes, edges]);
    setAlerts(found);
    if (key === alertMarkerKey.current) return;
    alertMarkerKey.current = key;
    if (nodes.length || edges.length) store.setMarkers('alert', { nodes, edges });
    else store.clearMarkers('alert');
  }, [setAlerts, store]);

  const scanAlerts = useCallback(
    () => (alertsEnabled ? generateGraphAlerts(store.graph(), view, alertRules) : []),
    [alertRules, alertsEnabled, store, view],
  );

  // Production scheduleAlertScan: 180 ms after the view changes, skipped for
  // very large views. The first scan after a graph has finished loading opens
  // the panel, flagged or not, so a clean graph is reported too (production
  // opened it only when something was flagged; analyst decision 2026-11-15).
  // It waits for the whole graph, since chunks stream in.
  const loadStatus = snapshot.status;
  useEffect(() => {
    if (!alertsEnabled) {
      applyAlerts([]);
      return undefined;
    }
    if (view.nodeIds.length > ALERT_AUTO_SCAN_LIMITS.nodes || view.edgeIds.length > ALERT_AUTO_SCAN_LIMITS.edges) return undefined;
    const timer = setTimeout(() => {
      const found = scanAlerts();
      applyAlerts(found);
      if (loadStatus.state === 'ready' && view.nodeIds.length > 0 && !ALERTS_AUTO_OPENED.has(loadStatus)) {
        ALERTS_AUTO_OPENED.add(loadStatus);
        setAlertsPanel({ open: true, scanning: false });
      }
    }, ALERT_SCAN_DELAY_MS);
    return () => clearTimeout(timer);
  }, [alertsEnabled, applyAlerts, loadStatus, scanAlerts, setAlertsPanel, view]);

  // Production triggerAlertRescan / runAlertScan(true): a short "Scanning…"
  // state, then the results in the panel.
  const rescanTimer = useRef(null);
  useEffect(() => () => clearTimeout(rescanTimer.current), []);
  const runAlertScan = useCallback(() => {
    setAlertsPanel({ open: true, scanning: true });
    setOverlayPref('alerts', true); // asked for: shown even if hidden
    setFrontCard('alerts');
    clearTimeout(rescanTimer.current);
    rescanTimer.current = setTimeout(() => {
      applyAlerts(scanAlerts());
      setAlertsPanel({ open: true, scanning: false });
    }, ALERT_SCAN_DELAY_MS);
  }, [applyAlerts, scanAlerts, setAlertsPanel, setFrontCard]);

  const toggleAlertRules = useCallback(() => {
    updateWindowMetadata(windowId, { metadata: { graphSettings: { ...settingsRef.current, alertRules: !alertsEnabled } } });
  }, [alertsEnabled, updateWindowMetadata, windowId]);

  // Production toggleEdgeBundlingLite / configureEdgeBundlingLite: a window
  // setting (saved with views as production's edgeBundling) applied when
  // drawing; the minimum group is asked for (at least 2).
  const toggleEdgeBundling = useCallback(() => {
    updateWindowMetadata(windowId, { metadata: { graphSettings: { ...settingsRef.current, edgeBundling: !settingsRef.current.edgeBundling } } });
  }, [updateWindowMetadata, windowId]);
  const configureEdgeBundling = useCallback(() => {
    const current = Math.max(2, parseInt(settingsRef.current.edgeBundleMin, 10) || 2);
    setDialog({
      title: 'Configure Edge Bundling',
      description: 'Links between the same two nodes are drawn as one, labelled with how many, once there are at least this many.',
      okText: 'Apply',
      fields: [{ name: 'min', label: 'Minimum parallel edges to bundle (>=2)', type: 'number', min: 2, step: 1, value: current }],
      onSubmit: ({ min }) => {
        const next = Math.max(2, parseInt(min, 10) || current);
        updateWindowMetadata(windowId, { metadata: { graphSettings: { ...settingsRef.current, edgeBundleMin: next } } });
      },
    });
  }, [updateWindowMetadata, windowId]);

  // Production asked for JSON; this is the same configuration as a form.
  const configureAlertRules = useCallback(() => {
    setDialog({
      title: 'Configure Alert Rules',
      description: 'Values outside a range are set to its nearest limit.',
      okText: 'Save rules',
      fields: ALERT_RULE_FIELDS.map((field) => ({
        ...field,
        label: field.type === 'number' ? `${field.label} (${field.min}–${field.max === Number.MAX_SAFE_INTEGER ? 'any' : field.max})` : field.label,
        step: field.step ?? (field.type === 'number' && !field.integer ? 'any' : 1),
        value: alertRules[field.name],
      })),
      onSubmit: (values) => {
        const next = normalizeAlertRules(values);
        writeAlertRules(next);
        setAlertRules(next);
        report('Alert rules updated.');
      },
    });
  }, [alertRules, report]);

  // Production focusAlertNode / focusAlertEdge: centre the node, select it
  // (a heavy edge and its source node) and show its details in Info.
  const focusAlert = useCallback((alert) => {
    const nodeId = alertFocusNode(store.graph(), alert);
    if (nodeId == null) return;
    canvasRef.current?.select(alert.edgeId != null ? [String(alert.edgeId), nodeId] : [nodeId]);
    canvasRef.current?.focus(nodeId);
    requestContextTab('info');
  }, [store]);

  const alertNameKeys = useMemo(() => alertPropertyKeys(store.graph(), alerts), [alerts, store]);
  // Production falls back to Auto when the chosen key is gone.
  const activeNameKey = alertNameKeys.includes(alertNameKey) ? alertNameKey : '';
  const describedAlerts = useMemo(() => {
    const graph = store.graph();
    return alerts.map((alert) => ({
      key: `${alert.type}:${alert.nodeId ?? alert.edgeId}`,
      alert,
      ...describeGraphAlert(graph, alert, activeNameKey),
      nameMissing: alertNameMissing(graph, alert, activeNameKey) ? activeNameKey : '',
    }));
  }, [alerts, activeNameKey, store]);

  // Shows nodes the limit hides (past it, up to the drawing cap), then runs
  // `then` once they are drawn.
  const revealThen = useCallback((ids, then) => {
    const visible = new Set(view.nodeIds);
    if (ids.some((id) => !visible.has(id))) {
      const { skipped } = store.revealNodes(ids, { viewKey, visibleIds: view.nodeIds, cap });
      if (skipped) notifyDrawingLimit(skipped);
    }
    requestAnimationFrame(then);
  }, [cap, notifyDrawingLimit, store, view.nodeIds, viewKey]);

  // Production showPinnedEvidenceSummary fitted the pinned items it showed and
  // listed their ids in an alert. Here every pinned item of this graph is
  // shown, past the limit (analyst decision 2026-11-15), fitted, and listed
  // in the Pinned Evidence card.
  const showPinnedEvidence = useCallback(() => {
    const fit = pinnedFitNodes(store.graph(), pinned);
    if (fit.length) revealThen(fit, () => canvasRef.current?.fit(fit));
    setPinnedPanel((current) => ({ ...current, open: true, collapsed: false }));
    setOverlayPref('pinned', true); // asked for: shown even if hidden
    setFrontCard('pinned');
  }, [pinned, revealThen, setFrontCard, setPinnedPanel, store]);

  // Toolbar ▸ On-graph components. Turning a card on also opens it (so the
  // check shows something); turning it off hides it in every Graph window.
  const toggleOverlay = useCallback((key, on) => {
    setOverlayPref(key, on);
    if (!on) return;
    if (key === 'alerts') {
      setAlertsPanel((current) => ({ ...current, open: true }));
      setFrontCard('alerts');
    } else if (key === 'pinned') {
      setPinnedPanel((current) => ({ ...current, open: true }));
      setFrontCard('pinned');
    } else if (key === 'combined') {
      setCombinedPanel((current) => ({ ...current, open: true }));
      setFrontCard('combined');
    }
  }, [setAlertsPanel, setCombinedPanel, setFrontCard, setPinnedPanel]);

  // A Merged & Grouped item: show it if hidden, then select, centre, Info.
  const focusNode = useCallback((id) => {
    revealThen([id], () => {
      canvasRef.current?.select([id]);
      canvasRef.current?.focus(id);
      requestContextTab('info');
    });
  }, [revealThen]);

  // A card click: show it if hidden, then select, centre and open Info (as
  // an alert card does).
  const focusPinned = useCallback((item) => {
    const graph = store.graph();
    const edgeKey = item.type === 'edge' ? edgeKeyForPinned(graph, item.id) : null;
    const nodeId = item.type === 'node' ? item.id : (edgeKey ? graph.source(edgeKey) : null);
    if (nodeId == null) return;
    const ids = edgeKey ? [graph.source(edgeKey), graph.target(edgeKey)] : [nodeId];
    revealThen(ids, () => {
      canvasRef.current?.select(edgeKey ? [edgeKey, nodeId] : [nodeId]);
      canvasRef.current?.focus(nodeId);
      requestContextTab('info');
    });
  }, [revealThen, store]);

  const pinnedCards = useMemo(() => {
    const graph = store.graph();
    const visible = new Set(view.nodeIds);
    return pinnedHere.map((item) => {
      if (item.type === 'node') {
        return { key: `node:${item.id}`, item, kind: 'node', name: alertNodeName(graph, item.id), detail: formatPinnedAt(item.pinnedAt), hidden: !visible.has(item.id) };
      }
      const key = edgeKeyForPinned(graph, item.id);
      const [from, to] = [graph.source(key), graph.target(key)];
      const relation = graph.getEdgeAttribute(key, 'label');
      return {
        key: `edge:${item.id}`,
        item,
        kind: 'edge',
        name: alertNodeName(graph, from),
        detail: `→ ${alertNodeName(graph, to)}${relation ? ` · ${relation}` : ''}`,
        hidden: !visible.has(from) || !visible.has(to),
      };
    });
  }, [pinnedHere, store, view.nodeIds]);

  // Production cleared at once; the list is shared by every graph on the
  // device, so this asks first.
  const confirmClearPinned = useCallback(() => {
    setDialog({
      title: 'Clear Pinned Evidence',
      description: `Remove all ${pinned.length} pinned item(s)? Pinned evidence is shared by every graph on this device.`,
      okText: 'Clear all',
      onSubmit: () => {
        const removed = clearPinnedEvidence();
        report(`Cleared ${removed} pinned item(s).`);
      },
    });
  }, [pinned.length, report]);

  /* ── Saved views (G2.4c; production GA:3812-3935) ───────────────────── */
  const viewStamp = (item) => {
    const date = new Date(item?.createdAt);
    return Number.isNaN(date.getTime()) ? '' : `saved ${date.toLocaleString()}`;
  };

  // Production saveCurrentView: camera, visible nodes / edges, selection and
  // settings; here also the visible nodes' positions.
  const saveView = useCallback(() => {
    setDialog({
      title: 'Save View',
      description: `Saved on this device for this graph (up to ${MAX_SAVED_VIEWS}). A view with the same name is replaced.`,
      okText: 'Save view',
      fields: [{ name: 'name', label: 'View name', type: 'text', value: defaultViewName() }],
      onSubmit: ({ name }) => {
        const trimmed = String(name || '').trim();
        if (!trimmed) return;
        const graph = store.graph();
        const camera = canvasRef.current?.getCamera() || { position: { x: 0, y: 0 }, scale: 1, selectedNodes: [], selectedEdges: [] };
        const positions = {};
        view.nodeIds.forEach((id) => {
          const position = store.getPosition(id);
          if (position) positions[id] = [Math.round(position.x * 10) / 10, Math.round(position.y * 10) / 10];
        });
        const scopeId = graphScope(graph);
        const stored = storeSavedView(scopeId, {
          id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: trimmed,
          createdAt: new Date().toISOString(),
          position: camera.position,
          scale: camera.scale,
          visibleNodes: view.nodeIds,
          visibleEdges: view.edgeIds.map(pinnedEdgeId),
          selectedNodes: camera.selectedNodes,
          selectedEdges: camera.selectedEdges.map(pinnedEdgeId),
          settings: toSavedSettings(settings, elementFilters),
          graphSettings: settings,
          positions,
        });
        if (stored) report(`View “${trimmed}” saved.`);
        else report('The view could not be saved: this browser’s storage is full or unavailable. Remove some saved views and try again.', 'warning');
      },
    });
  }, [elementFilters, report, settings, store, view.edgeIds, view.nodeIds]);

  // Production loadSavedView: its settings, exactly its visible nodes, its
  // camera and its selection. A view saved by production has no positions:
  // the layout runs and the view is fitted instead of moving the camera.
  const applySavedView = useCallback((saved) => {
    const graph = store.graph();
    const next = fromSavedView(saved, settings);
    const nodes = (saved.visibleNodes || []).map(String).filter((id) => graph.hasNode(id)).slice(0, cap);
    const positions = Object.entries(saved.positions || {}).filter(([id, at]) => graph.hasNode(id) && Array.isArray(at));
    const placed = nodes.length > 0 && nodes.every((id) => saved.positions?.[id]);
    if (positions.length) {
      store.setPositions(positions.map(([id, [x, y]]) => [id, { x, y }]));
      if (placed) store.setLayoutSignature(layoutSignatureOf(next.layout));
    }
    if (nodes.length) {
      const targetKey = viewKeyOf(next.limit, cap, null);
      const base = store.searchView({ ...next.limit, max: next.limit.min + Math.min(next.limit.max - next.limit.min, cap) });
      store.restoreVisibility(targetKey, base.nodeIds, nodes);
    }
    const filters = savedElementFilters(saved);
    updateWindowMetadata(windowId, {
      metadata: { graphSettings: next, graphSearch: null, ...(filters ? { graphElementFilters: filters } : {}) },
    });
    // Once the view is drawn: camera and selection.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (placed) canvas.moveTo({ position: saved.position, scale: Number.isFinite(saved.scale) ? saved.scale : 1 });
      else canvas.fit();
      const selected = [
        ...(saved.selectedNodes || []).map(String).filter((id) => nodes.includes(id)),
        ...(saved.selectedEdges || []).map((id) => (graph.hasEdge(`id:${id}`) ? `id:${id}` : String(id))).filter((key) => graph.hasEdge(key)),
      ];
      canvas.select(selected);
    }));
    report(`View “${saved.name}” loaded.`);
  }, [cap, report, settings, store, updateWindowMetadata, windowId]);

  const loadView = useCallback(() => {
    const views = savedViewsFor(graphScope(store.graph()));
    if (!views.length) {
      report('No saved views available for this graph.');
      return;
    }
    setDialog({
      title: 'Load Saved View',
      okText: 'Load view',
      fields: [{
        name: 'name',
        label: 'Saved view',
        type: 'select',
        value: String(views[0].name || ''),
        options: views.map((item, index) => {
          const name = String(item.name || `View ${index + 1}`);
          const stamp = viewStamp(item);
          return { value: String(item.name || ''), label: stamp ? `${name} (${stamp})` : name };
        }),
      }],
      onSubmit: ({ name }) => applySavedView(views.find((item) => String(item.name || '') === name) || views[0]),
    });
  }, [applySavedView, report, store]);

  const removeViews = useCallback(() => {
    const scopeId = graphScope(store.graph());
    const views = savedViewsFor(scopeId);
    setDialog({
      title: 'Remove Saved Views',
      description: 'Removes them for this graph only.',
      okText: 'Remove',
      fields: [{
        name: 'names',
        label: 'Saved views',
        type: 'checkboxes',
        value: [],
        options: views.map((item, index) => ({
          value: String(item.name || ''),
          label: String(item.name || `View ${index + 1}`),
          description: viewStamp(item),
        })),
      }],
      onSubmit: ({ names }) => {
        if (!names?.length) return;
        const removed = removeSavedViews(scopeId, names);
        report(`Removed ${removed} saved view(s).`);
      },
    });
  }, [report, store]);

  // The view without this window's visibility edits (what restoreVisibility
  // records edits against).
  const plainNodeIds = useCallback(() => store.searchView({
    ...settings.limit,
    max: settings.limit.min + Math.min(requested, cap),
    keyword: search?.keyword || '',
    includeLinked: Boolean(search?.includeLinked),
    keys: Array.isArray(search?.keys) ? search.keys : [],
  }).nodeIds, [cap, requested, search, settings.limit, store]);

  // Graph editing (G3.1; production graphs_basic.html GB:2240 cases, GA
  // handleAddNode, handleDeleteNode, handleLinkNodes, handleUnlinkNode(s),
  // copyNodes, pasteNodes, bringNodeToFront). Each is recorded for undo.
  const runEditAction = useCallback((action, request) => {
    const selection = request?.selection || [];
    const nodeId = request?.id ?? null;
    const graph = store.graph();
    // Where the menu was opened, in graph coordinates.
    const at = () => canvasRef.current?.toGraphPosition?.({ x: request?.x ?? 0, y: request?.y ?? 0 }) || { x: 0, y: 0 };
    // Placed nodes on a graph never laid out (a new graph) must not trigger
    // the layout of the whole view.
    const keepLayout = () => {
      if (!store.getLayoutSignature()) store.setLayoutSignature(layoutSignatureOf(effective.layout));
    };
    if (ANNOTATION_ACTIONS.has(action)) {
      // Production handleAddLabelNode … handleAddOleObject: a prompt, then
      // the annotation where the menu was opened.
      const prompt = ANNOTATION_PROMPTS[action];
      const position = at();
      setDialog({
        title: prompt.title,
        okText: 'Add',
        fields: [{ name: 'text', label: prompt.label, type: 'text', value: prompt.value }],
        onSubmit: ({ text }) => {
          record();
          keepLayout();
          store.addNode(annotationNode(action, text ?? '', { dark: isDarkTheme() }), { position, viewKey, visibleIds: view.nodeIds, prefix: 'anno' });
        },
      });
    } else if (action === 'add_theme_line') {
      // Production handleAddThemeLine: dashed grey lines joining the
      // selected nodes left to right.
      const ids = selection.map(String).filter((id) => graph.hasNode(id));
      if (ids.length < 2) {
        report('Select at least two nodes to create a Theme Line.');
        return;
      }
      record();
      const ordered = themeLineOrder(ids, (id) => store.getPosition(id));
      for (let i = 0; i < ordered.length - 1; i += 1) store.addEdge(ordered[i], ordered[i + 1], themeLineEdge());
    } else if (action === 'group') {
      if (selection.length < 2) return;
      record();
      if (store.groupNodes(selection, { color: defaultNodeColor(), viewKey, visibleIds: view.nodeIds })) showCombined();
    } else if (action === 'ungroup') {
      const id = String(nodeId ?? selection[0] ?? '');
      if (!store.getNode(id)?.isGroup) return;
      record();
      const restored = store.ungroupNode(id, { viewKey, visibleIds: view.nodeIds });
      if (restored.length) requestAnimationFrame(() => requestAnimationFrame(() => canvasRef.current?.select(restored)));
    } else if (action === 'merge_nodes') {
      // Production mergeSelectedNodes: which properties of the others to
      // carry (prompt 1) and under which prefix (prompt 2), in one form.
      const ids = selection.map(String).filter((id) => graph.hasNode(id));
      if (ids.length < 2) return;
      const available = store.mergeKeys(ids.slice(1));
      const preview = available.slice(0, 28).join(', ');
      const extra = Math.max(0, available.length - 28);
      setDialog({
        title: 'Merge Nodes',
        description: available.length
          ? `“${store.getNode(ids[0])?.label ?? ids[0]}” is kept. Properties of the others: ${preview}${extra ? ` … (+${extra} more)` : ''}.`
          : 'No transferable custom keys found in the selected source nodes.',
        okText: 'Merge',
        fields: [
          { name: 'keys', label: 'Property keys to carry (comma-separated, or all)', type: 'text', value: 'all' },
          { name: 'prefix', label: 'Derived property variable (result: variable_propertyKey)', type: 'text', value: 'merged' },
        ],
        onSubmit: ({ keys, prefix }) => {
          const variable = String(prefix || '').trim();
          if (!variable) {
            report('Variable name is required (the result is variable_propertyKey).', 'error');
            return;
          }
          const raw = String(keys || '').trim();
          let chosen = null;
          if (raw && raw.toLowerCase() !== 'all' && raw !== '*') {
            const valid = raw.split(',').map((key) => key.trim()).filter((key) => available.includes(key));
            if (valid.length) chosen = valid;
            else if (available.length) report('No valid property keys matched. Using all keys.', 'warning');
          }
          record();
          const kept = store.mergeNodes(ids, { keys: chosen, prefix: variable, viewKey, visibleIds: view.nodeIds });
          if (kept) {
            showCombined();
            requestAnimationFrame(() => requestAnimationFrame(() => canvasRef.current?.select([kept])));
          }
        },
      });
    } else if (action === 'add_node') {
      record();
      keepLayout();
      store.addNode(
        (id) => ({ label: effective.showLabels ? `Node ${id}` : '', color: defaultNodeColor() }),
        { position: at(), viewKey, visibleIds: view.nodeIds },
      );
    } else if (action === 'delete') {
      record();
      store.removeNodes([nodeId ?? selection[0]].filter((id) => id != null));
    } else if (action === 'unlink') {
      record();
      store.unlinkNode(nodeId ?? selection[0]);
    } else if (action === 'link') {
      record();
      store.linkNodes(selection);
    } else if (action === 'unlinks') {
      record();
      store.unlinkNodes(selection);
    } else if (action === 'copy') {
      const ids = selection.length ? selection : [nodeId].filter((id) => id != null);
      if (ids.length) setClipboard(store.copyNodes(ids));
    } else if (action === 'paste') {
      record();
      keepLayout();
      const pasted = store.pasteNodes(getClipboard(), { position: at(), viewKey, visibleIds: view.nodeIds });
      if (pasted.length) requestAnimationFrame(() => requestAnimationFrame(() => canvasRef.current?.select(pasted)));
    } else if (action === 'bring_to_front') {
      // Production bringNodeToFront: only the node and its neighbours stay
      // shown, highlighted as a path, and fitted.
      const focus = String(nodeId ?? selection[0] ?? '');
      if (!graph.hasNode(focus)) return;
      record();
      const shown = [focus, ...graph.neighbors(focus).filter((id) => id !== focus)].slice(0, cap);
      const set = new Set(shown);
      const edges = [];
      graph.forEachEdge((key, attributes, source, target) => {
        if (set.has(source) && set.has(target)) edges.push(key);
      });
      if (graph.neighbors(focus).length + 1 > cap) notifyDrawingLimit(graph.neighbors(focus).length + 1 - cap);
      store.restoreVisibility(viewKey, plainNodeIds(), shown);
      store.setMarkers('path', { nodes: [focus], edges });
      requestAnimationFrame(() => requestAnimationFrame(() => canvasRef.current?.fit(shown)));
    }
  }, [cap, effective.layout, effective.showLabels, notifyDrawingLimit, plainNodeIds, record, report, showCombined, store, view.nodeIds, viewKey]);

  // Node / edge adjust box (G3.2; production click GB:2374): which element
  // it belongs to and where it opened. Edits apply to everything of that
  // kind that is selected (production getSelectedNodes / Edges), except the
  // icon, which only the clicked node takes (production currentEntityId).
  const [adjust, setAdjust] = useState(null); // { kind, id, x, y }
  const closeAdjust = useCallback(() => setAdjust(null), []);
  const handleElementTap = useCallback((target) => {
    if (target?.kind !== 'node') {
      setAdjust(target);
      return;
    }
    const node = store.getNode(target.id);
    const boxKind = annotationBoxKind(node);
    // Production's OLE click gives an object that lost its icon the
    // document icon back (a recorded change).
    const repair = boxKind === 'object' ? oleIconRepair(node, { dark: isDarkTheme() }) : null;
    if (repair) {
      record();
      store.updateNodes([[target.id, repair]]);
    }
    setAdjust(boxKind ? { ...target, kind: boxKind } : target);
  }, [record, store]);
  const adjustTarget = adjust && (adjust.kind === 'edge' ? store.getEdge(adjust.id) : store.getNode(adjust.id));
  const lastEdit = useRef({ field: '', at: 0 });
  // One undo step per field while it is being changed (the colour picker
  // sends many values; production queued one history capture).
  const recordEdit = useCallback((field) => {
    const now = Date.now();
    if (lastEdit.current.field !== field || now - lastEdit.current.at > 800) record();
    lastEdit.current = { field, at: now };
  }, [record]);
  const applyAdjust = useCallback((field, value) => {
    if (!adjust) return;
    const selected = canvasRef.current?.selectedIds?.() || { nodes: [], edges: [] };
    if (adjust.kind !== 'node' && adjust.kind !== 'edge') {
      // Annotation boxes change the clicked annotation only (production
      // currentEntityId).
      const node = store.getNode(adjust.id);
      if (!node) return;
      if (field === 'openFile') {
        openAttachment(node, { link: false });
        return;
      }
      if (field === 'openLink') {
        openAttachment(node, { file: false });
        return;
      }
      let patch = null;
      if (field === 'label' || field === 'note' || field === 'eventTypes') patch = { [field]: value };
      else if (field === 'font') patch = { font: { ...(node.font || {}), ...value } };
      else if (field === 'eventDateTime') patch = { eventDateTime: fromDateTimeLocalValue(value) };
      else if (field === 'attachmentLink') {
        const link = String(value || '').trim();
        const linkedName = link ? link.split('/').pop() : '';
        patch = { attachmentLink: link, attachmentName: node.attachmentName || linkedName || '' };
      } else if (field === 'attachmentFile') patch = { attachmentDataUrl: value.dataUrl, attachmentName: value.name, attachmentMime: value.mime };
      else if (field === 'clearAttachment') patch = { attachmentLink: '', attachmentName: '', attachmentDataUrl: '', attachmentMime: '' };
      if (!patch) return;
      recordEdit(`annotation:${field}`);
      store.updateNodes([[adjust.id, patch]]);
      return;
    }
    if (adjust.kind === 'node') {
      const ids = selected.nodes.includes(adjust.id) ? selected.nodes : [adjust.id];
      if (field === 'colorBehavior') {
        // Production stored it without a history step.
        store.updateNodes(ids.map((id) => [id, { colorBehavior: value }]));
        return;
      }
      recordEdit(`node:${field}`);
      if (field === 'label' || field === 'note') store.updateNodes(ids.map((id) => [id, { [field]: value }]));
      else if (field === 'size') store.updateNodes(ids.map((id) => [id, { size: value }]));
      else if (field === 'shape') store.updateNodes(ids.map((id) => [id, nodeShapePatch(store.getNode(id), value)]));
      else if (field === 'icon') store.updateNodes([[adjust.id, nodeIconPatch(value)]]);
      else if (field === 'color') {
        const graph = store.graph();
        const drawn = new Set(view.edgeIds);
        const patches = nodeColorPatches(ids, value, {
          behaviorOf: (id) => store.getNode(id)?.colorBehavior,
          neighbours: (id) => {
            const found = new Set();
            graph.forEachEdge(id, (key, attributes, source, target) => {
              if (drawn.has(key)) found.add(source === id ? target : source);
            });
            return [...found];
          },
          edges: view.edgeIds.map((key) => [key, graph.source(key), graph.target(key)]),
        });
        store.updateNodes(patches.nodes);
        store.updateEdges(patches.edges.map(([key, patch]) => [key, { ...patch, __edits: { ...(store.getEdge(key)?.__edits || {}), ...patch.__edits } }]));
      }
    } else {
      const keys = selected.edges.includes(adjust.id) ? selected.edges : [adjust.id];
      recordEdit(`edge:${field}`);
      const patchFor = (key) => {
        const edge = store.getEdge(key);
        if (field === 'label') return { label: value };
        if (field === 'color') return edgeColorPatch(edge, value);
        if (field === 'style') return edgeStylePatch(edge, value);
        if (field === 'width') return edgeWidthPatch(edge, value);
        return null;
      };
      store.updateEdges(keys.map((key) => [key, patchFor(key)]));
    }
  }, [adjust, recordEdit, store, view.edgeIds]);

  // Selection tools (G3.6, after i2; not in production). They work on the
  // drawn nodes; hiding is a visibility edit of this view, recorded.
  const runSelectAction = useCallback((action, request) => {
    const graph = store.graph();
    const drawn = view.nodeIds;
    const drawnSet = new Set(drawn);
    const selection = (request?.selection || []).map(String).filter((id) => drawnSet.has(id));
    const select = (ids) => canvasRef.current?.select([...new Set(ids)]);
    const typesOf = (ids) => new Set(ids.map((id) => nodeTypeOf(store.getNode(id))));
    if (action === 'select_all') select(drawn);
    else if (action === 'invert_selection') {
      const current = new Set(canvasRef.current?.selectedIds?.().nodes ?? selection);
      select(drawn.filter((id) => !current.has(id)));
    } else if (action === 'select_linked') {
      const linked = new Set(selection);
      selection.forEach((id) => graph.forEachNeighbor(id, (other) => {
        if (drawnSet.has(other)) linked.add(other);
      }));
      select([...linked]);
    } else if (action === 'select_same_type') {
      const types = typesOf(selection);
      select(drawn.filter((id) => types.has(nodeTypeOf(store.getNode(id)))));
    } else if (action === 'select_link_ends') {
      const ends = [];
      (request?.edgeSelection || []).forEach((key) => {
        if (!graph.hasEdge(key)) return;
        ends.push(graph.source(key), graph.target(key));
      });
      select(ends.filter((id) => drawnSet.has(id)));
    } else if (action === 'hide_selected') {
      if (!selection.length) return;
      record();
      store.hideNodes(selection, { viewKey, visibleIds: drawn });
    } else if (action === 'show_hidden') {
      record();
      const shown = store.showHidden(viewKey);
      if (shown) report(`${shown} hidden node(s) shown again.`);
    } else if (action === 'select_by_type') {
      const counts = new Map();
      drawn.forEach((id) => {
        const type = nodeTypeOf(store.getNode(id));
        counts.set(type, (counts.get(type) || 0) + 1);
      });
      const options = [...counts].map(([type, count]) => ({ value: type, label: `${type} (${count})` }));
      setDialog({
        title: 'Select by Type',
        description: 'Selects the drawn nodes of the chosen types.',
        okText: 'Select',
        fields: [{ name: 'types', label: 'Types', type: 'checkboxes', options, value: options.length === 1 ? [options[0].value] : [] }],
        onSubmit: ({ types }) => {
          const wanted = new Set(types || []);
          select(drawn.filter((id) => wanted.has(nodeTypeOf(store.getNode(id)))));
        },
      });
    } else if (action === 'select_by_property') {
      const keys = store.propertyKeys();
      setDialog({
        title: 'Select by Property',
        description: 'Selects the drawn nodes whose property contains the value (any case). Leave the value empty to select every node that has the property.',
        okText: 'Select',
        fields: [
          { name: 'key', label: 'Property', type: 'select', options: keys.map((key) => ({ value: key, label: key })), value: keys[0] || '' },
          { name: 'value', label: 'Value contains', type: 'text', value: '' },
        ],
        onSubmit: ({ key, value }) => {
          const needle = String(value || '').trim().toLowerCase();
          const matches = drawn.filter((id) => {
            const found = getNodeValue(store.getNode(id), key);
            if (found == null || found === '') return false;
            if (!needle) return true;
            const text = typeof found === 'object' ? JSON.stringify(found) : String(found);
            return text.toLowerCase().includes(needle);
          });
          select(matches);
          report(matches.length ? `${matches.length} node(s) selected.` : 'No drawn node matches.');
        },
      });
    }
  }, [record, report, store, view.nodeIds, viewKey]);

  const runMenuAction = useCallback((action) => {
    const selection = menu?.selection || [];
    const visibleIds = view.nodeIds;
    if (EDIT_ACTIONS.has(action)) {
      runEditAction(action, menu);
      return;
    }
    if (SELECT_ACTIONS.has(action)) {
      runSelectAction(action, menu);
      return;
    }
    if (action === 'expand_neighborhood') {
      record();
      const { skipped } = store.expandNeighbourhood(selection, { viewKey, visibleIds, depth: 1, cap });
      if (skipped) notifyDrawingLimit(skipped);
    } else if (action === 'collapse_neighborhood') {
      record();
      store.collapseNeighbourhood(selection, { viewKey, visibleIds, depth: 1 });
    } else if (action === 'path_finder') {
      runShortestPath(selection);
    } else if (action === 'find_all_paths') {
      runAllPaths(selection);
    } else if (action === 'link_traversal') {
      // Production runLinkTraversal: expand up to 5 degrees, highlight kept.
      record();
      const { skipped } = store.expandNeighbourhood(selection, { viewKey, visibleIds, depth: 5, cap, persist: true });
      if (skipped) notifyDrawingLimit(skipped);
      report('Expanded traversal up to 5 degree(s).');
    } else if (action === 'cut_points') {
      runCutPoints();
    } else if (action === 'clear_path') {
      store.clearMarkers('path', 'traversal');
    } else if (action === 'apply_community_detection') {
      runCommunities();
    } else if (action === 'visual_degree') {
      record();
      store.patchNodes(degreeEncoding(store.graph(), visibleIds));
    } else if (action === 'visual_property') {
      runVisualProperty();
    } else if (action === 'filter_elements') {
      runElementFilter();
    } else if (action === 'reset_node_styles') {
      record();
      store.restoreNodePatches();
    } else if (action === 'toggle_alert_rules') {
      toggleAlertRules();
    } else if (action === 'configure_alert_rules') {
      configureAlertRules();
    } else if (action === 'toggle_edge_bundling') {
      toggleEdgeBundling();
    } else if (action === 'configure_edge_bundling') {
      configureEdgeBundling();
    } else if (action === 'run_alert_scan') {
      runAlertScan();
    } else if (action === 'pin_evidence') {
      if (menu && pinEvidence(evidenceItems(store.graph(), evidenceTargets(menu)))) {
        setPinnedPanel((current) => ({ ...current, open: true }));
        setOverlayPref('pinned', true);
        setFrontCard('pinned');
      }
    } else if (action === 'unpin_evidence') {
      if (menu) unpinEvidence(evidenceItems(store.graph(), evidenceTargets(menu)));
    } else if (action === 'save_view') {
      saveView();
    } else if (action === 'load_view') {
      loadView();
    } else if (action === 'remove_saved_views') {
      removeViews();
    } else if (action === 'show_pinned_evidence') {
      showPinnedEvidence();
    } else if (action === 'clear_pinned_evidence') {
      confirmClearPinned();
    }
  }, [
    cap, configureAlertRules, configureEdgeBundling, confirmClearPinned, toggleEdgeBundling, runSelectAction, loadView, menu, removeViews, runEditAction, saveView, notifyDrawingLimit, record, report, runAlertScan, runAllPaths, runCommunities,
    runCutPoints, runElementFilter, runShortestPath, runVisualProperty, setFrontCard, setPinnedPanel, showPinnedEvidence, store, toggleAlertRules,
    view.nodeIds, viewKey,
  ]);

  // Production expandNode: one hidden neighbour, past the limit if need be.
  const handleNodeDoubleClick = useCallback((nodeId) => {
    // Production doubleClick: an OLE object with an attachment opens it.
    const clicked = store.getNode(String(nodeId));
    if (annotationBoxKind(clicked) === 'object' && hasAttachment(clicked)) {
      openAttachment(clicked);
      return;
    }
    if (view.nodeIds.length >= cap) {
      notifyDrawingLimit(1);
      return;
    }
    // Recorded here too (production's expandNode was not).
    record();
    store.expandNode(nodeId, { viewKey, visibleIds: view.nodeIds });
  }, [cap, notifyDrawingLimit, record, store, view.nodeIds, viewKey]);

  /* ── Render ─────────────────────────────────────────────────────────── */
  const status = snapshot.status;
  const hasData = snapshot.nodes > 0;
  const shown = view.nodeIds.length;
  const warnAt = renderer === RENDERERS.WEBGL ? GRAPH_LIMITS.WEBGL_WARNING : GRAPH_LIMITS.WARNING;
  const busy = status.state === 'loading' || status.state === 'queued';
  const relationships = session.relationships || [];

  let overlay = null;
  if (busy && !(hasData && status.progressive)) {
    overlay = <div className="graph_window_state" role="status"><span className="graph_window_spinner" aria-hidden="true" /><p>{status.message}</p></div>;
  } else if (status.state === 'error') {
    overlay = (
      <div className="graph_window_state is-error" role="alert">
        <h4>Could not load the graph</h4>
        <p>{status.message}</p>
        <button type="button" className="graph_window_button" onClick={retry}>Retry</button>
      </div>
    );
  } else if (linking) {
    overlay = <div className="graph_window_state" role="status"><span className="graph_window_spinner" aria-hidden="true" /><p>Linking to session {metadata.graphLinking}…</p></div>;
  } else if (!hasData && !(source.kind === 'none' && metadata.graphBlank)) {
    let title = 'No graph to render';
    let text = 'Open a graph from a report or a task, or link this window to a streaming Source session.';
    if (source.kind === 'session') {
      title = relationships.length ? 'Choose a relationship' : 'Waiting for the linked session';
      text = relationships.length
        ? 'Pick a relationship below (or All) to load the graph.'
        : `Linked to session ${sessionId}. Its relationships appear below once the session reports them.`;
    }
    overlay = (
      <div className="graph_window_state" role="status">
        <h4>{title}</h4>
        <p>{text}</p>
        {source.kind === 'none' ? (
          <button type="button" className="graph_window_button is-primary" onClick={createBlankGraph}>
            <Icon d={ICONS.plus} /> Create new graph
          </button>
        ) : null}
      </div>
    );
  }


  return (
    <div className="workspace_window_body graph_window_body">
      {/* One inner container: the workspace makes every direct child of a
          window body fill its full height (main.css .workspace_window_body > *). */}
      <div className="graph_window">
        <div className="graph_window_toolbar">
          <p className="graph_window_counts" aria-live="polite">
            {hasData
              ? <>{view.searched ? 'Search: ' : 'Showing '}<strong>{formatCount(shown)}</strong> of {formatCount(snapshot.nodes)} nodes · {formatCount(view.edgeIds.length)} edges</>
              : source.kind === 'none' && metadata.graphBlank ? 'New graph · 0 nodes' : 'No data'}
            {busy && hasData ? <span className="graph_window_hint"> · {status.message}</span> : null}
            {isLayingOut ? <span className="graph_window_hint"> · arranging…</span> : null}
          </p>
          {capped ? (
            <span className="graph_window_flag is-warning" title={`This renderer shows at most ${formatCount(cap)} nodes at once.`}>
              Limited to {formatCount(cap)}
            </span>
          ) : shown > warnAt ? (
            <span className="graph_window_flag is-warning">Large view: may be slow</span>
          ) : null}
          <span
            className={`graph_window_flag${renderer === RENDERERS.WEBGL ? ' is-gpu' : ''}`}
            title={renderer === RENDERERS.WEBGL ? 'Drawn with the GPU (Libraries → Graph rendering).' : 'Standard rendering. GPU rendering can be turned on in Libraries → Graph rendering.'}
          >
            {renderer === RENDERERS.WEBGL ? 'GPU' : 'Standard'}
          </span>
          {source.kind === 'session' ? (
            <button type="button" className="graph_window_button is-compact" onClick={handleUnlink} title={`Unlink from session ${sessionId}`}>
              <Icon d={ICONS.link} /> Unlink
            </button>
          ) : source.kind === 'none' ? (
            <form className="graph_window_link" aria-label="Link to a source" onSubmit={handleLink}>
              {/* Production said "Enter window ID". Streaming sources are suggested.
                  Same field as the Reports search, in the graph's theme tokens. */}
              <label className="graph_window_field">
                <Icon d={ICONS.link} />
                <input
                  type="text"
                  aria-label="Source ID"
                  placeholder="Enter source ID"
                  list={`${windowId}-link-sources`}
                  value={linkTarget}
                  maxLength={128}
                  disabled={linking}
                  onChange={(event) => setLinkTarget(event.target.value)}
                />
              </label>
              <datalist id={`${windowId}-link-sources`}>
                {candidates.map((item) => <option key={item.sessionId} value={item.sessionId}>{item.title}</option>)}
              </datalist>
              <button
                type="submit"
                className="graph_window_button is-compact"
                disabled={!linkTarget.trim() || linking}
                title="Link this graph to a streaming Source window (its window ID or session ID)."
              >
                Link
              </button>
            </form>
          ) : null}
          <div className="graph_window_tools" role="group" aria-label="History">
            <button type="button" className="graph_window_icon_button" aria-label="Undo" title="Undo" disabled={!snapshot.history?.canUndo} onClick={() => stepHistory('undo')}><Icon d={ICONS.undo} /></button>
            <button type="button" className="graph_window_icon_button" aria-label="Redo" title="Redo" disabled={!snapshot.history?.canRedo} onClick={() => stepHistory('redo')}><Icon d={ICONS.redo} /></button>
          </div>
          <div className="graph_window_tools" role="group" aria-label="View">
            <button type="button" className="graph_window_icon_button" aria-label="Zoom in" title="Zoom in" disabled={!hasData} onClick={() => canvasRef.current?.zoomBy(1.25)}><Icon d={ICONS.zoomIn} /></button>
            <button type="button" className="graph_window_icon_button" aria-label="Zoom out" title="Zoom out" disabled={!hasData} onClick={() => canvasRef.current?.zoomBy(0.8)}><Icon d={ICONS.zoomOut} /></button>
            <button
              type="button"
              className={`graph_window_icon_button${zoomingArea ? ' is-active' : ''}`}
              aria-label="Zoom to area"
              aria-pressed={zoomingArea}
              title="Zoom to area: drag a box over the graph"
              disabled={!hasData}
              onClick={() => setZoomingArea((value) => !value)}
            >
              <Icon d={ICONS.zoomArea} />
            </button>
            <button type="button" className="graph_window_icon_button" aria-label="Fit graph" title="Fit graph" disabled={!hasData} onClick={() => canvasRef.current?.fit()}><Icon d={ICONS.fit} /></button>
            <GraphOverlayMenu prefs={overlays} onToggle={toggleOverlay} />
          </div>
        </div>
        <div className="graph_window_stage">
          <GraphCanvas
            ref={canvasRef}
            windowId={windowId}
            store={store}
            view={view}
            settings={effective}
            renderer={renderer}
            isCdr={isCdr}
            onRendererFailed={handleRendererFailed}
            onLayoutState={setIsLayingOut}
            onContextMenu={handleContextMenu}
            onNodeDoubleClick={handleNodeDoubleClick}
            showMinimap={overlays.minimap}
            showGlyphs={overlays.glyphs}
            onElementTap={handleElementTap}
          />
          {hasData && overlays.legend ? <GraphSemanticLegend isCdr={isCdr} /> : null}
          {zoomingArea && hasData ? <GraphZoomBox onZoom={zoomToArea} onDone={endZoomArea} /> : null}
          {adjust && adjustTarget ? (
            <GraphAdjustBox
              key={`${adjust.kind}:${adjust.id}`}
              kind={adjust.kind}
              values={adjust.kind === 'node' ? nodeBoxValues(adjustTarget) : adjust.kind === 'edge' ? edgeBoxValues(adjustTarget) : annotationBoxValues(adjustTarget)}
              at={adjust}
              onChange={applyAdjust}
              onClose={closeAdjust}
            />
          ) : null}
          <GraphOverlayDock>
            {overlays.alerts && alertsPanel.open ? (
              <GraphAlertsPanel
                alerts={describedAlerts}
                summary={alertsEnabled ? alertSummary(alerts) : 'Alert rules are off.'}
                emptyText={alertsEnabled ? undefined : 'Alert rules are turned off. Turn them on from the right-click menu: Alert Rules ▸ Enable Alert Rules.'}
                scanning={alertsPanel.scanning}
                nameKey={activeNameKey}
                nameKeys={alertNameKeys}
                onNameKey={setAlertNameKey}
                position={store.getUi('alertsPosition', null)}
                onMoved={(position) => store.setUi('alertsPosition', position)}
                collapsed={alertsCollapsed}
                onToggleCollapsed={() => setAlertsCollapsed((value) => !value)}
                onFocus={focusAlert}
                onRescan={runAlertScan}
                canRescan={alertsEnabled}
                front={frontCard === 'alerts'}
                onActivate={() => setFrontCard('alerts')}
                onClose={() => setAlertsPanel({ open: false, scanning: false })}
              />
            ) : null}
            {overlays.pinned && pinnedPanel.open ? (
              <GraphPinnedPanel
                items={pinnedCards}
                elsewhere={pinned.length - pinnedHere.length}
                summary={pinnedHere.length ? `${pinnedHere.length} pinned in this graph` : 'None in this graph'}
                position={store.getUi('pinnedPosition', null)}
                onMoved={(position) => store.setUi('pinnedPosition', position)}
                collapsed={pinnedPanel.collapsed}
                onToggleCollapsed={() => setPinnedPanel((current) => ({ ...current, collapsed: !current.collapsed }))}
                onFocus={focusPinned}
                onUnpin={(item) => unpinEvidence([item])}
                onShowAll={showPinnedEvidence}
                front={frontCard === 'pinned'}
                onActivate={() => setFrontCard('pinned')}
                onClose={() => setPinnedPanel((current) => ({ ...current, open: false }))}
              />
            ) : null}
            {overlays.combined && combinedPanel.open ? (
              <GraphCombinedPanel
                items={combinedCards}
                summary={combinedCards.length
                  ? [
                    combinedCards.filter((card) => card.kind === 'group').length && `${combinedCards.filter((card) => card.kind === 'group').length} grouped`,
                    combinedCards.filter((card) => card.kind === 'merged').length && `${combinedCards.filter((card) => card.kind === 'merged').length} merged`,
                  ].filter(Boolean).join(' · ')
                  : 'None in this graph'}
                position={store.getUi('combinedPosition', null)}
                onMoved={(position) => store.setUi('combinedPosition', position)}
                collapsed={combinedPanel.collapsed}
                onToggleCollapsed={() => setCombinedPanel((current) => ({ ...current, collapsed: !current.collapsed }))}
                onFocus={focusNode}
                onUngroup={(id) => runEditAction('ungroup', { id, selection: [id] })}
                front={frontCard === 'combined'}
                onActivate={() => setFrontCard('combined')}
                onClose={() => setCombinedPanel((current) => ({ ...current, open: false }))}
              />
            ) : null}
          </GraphOverlayDock>
          {menu ? <GraphContextMenu menu={menu} onAction={runMenuAction} onClose={closeMenu} /> : null}
          {dialog ? (
            <GraphDialog
              dialog={dialog}
              onCancel={closeDialog}
              onSubmit={(values) => {
                closeDialog();
                dialog.onSubmit(values);
              }}
            />
          ) : null}
          {overlay}
        </div>
        {source.kind === 'session' ? (
          <div className="graph_window_relationships" role="group" aria-label="Graph relationships">
            {relationships.length ? (
              ['*', ...relationships].map((item) => {
                const type = item === '*' ? '*' : item.type;
                const active = metadata.graphRelationship === type;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`graph_relationship_chip${active ? ' is-active' : ''}${item === '*' ? ' is-all' : ''}`}
                    aria-pressed={active}
                    disabled={busy && active}
                    style={item === '*' ? undefined : { '--chip-bg': item.bgcolor, '--chip-text': item.textcolor }}
                    title={type === '*' ? 'All relationships' : type}
                    onClick={() => fetchRelationship(type)}
                  >
                    {type === '*' ? 'All (*)' : type}
                  </button>
                );
              })
            ) : (
              <span className="graph_window_hint">Waiting for relationships from session {sessionId}…</span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
