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
import { DEFAULT_GRAPH_SETTINGS, GRAPH_LIMITS, applyPerformancePolicy, normalizeGraphSettings, visibleCapFor } from '../lib/graphSettings.js';
import { RENDERERS, markGpuSuggested, resolveRenderer, setGpuPreference, shouldSuggestGpu, subscribeGpuPreference } from '../lib/rendererPreference.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { allPairsLinked, contextMenuItems } from '../lib/graphContextMenu.js';
import {
  ALL_PATHS_LIMITS, ELEMENT_TYPES, PATH_MODES, applyElementFilters, degreeEncoding, detectCommunities,
  findAllSimplePaths, findCutPoints, findShortestPath, inferNodeKeys, nodeColor, paletteColor, pathModeOf,
  propertyEncoding, separateCommunities,
} from '../lib/graphAnalysis.js';
import { readElementFilters, readPathOptions, writeElementFilters, writePathOptions } from '../lib/analysisPrefs.js';
import GraphDialog from './GraphDialog.jsx';
import GraphCanvas from './GraphCanvas.jsx';
import GraphContextMenu from './GraphContextMenu.jsx';

const Icon = ({ d }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {(Array.isArray(d) ? d : [d]).map((path) => <path key={path} d={path} />)}
  </svg>
);
const ICONS = {
  fit: ['M4 9V5a1 1 0 0 1 1-1h4', 'M15 4h4a1 1 0 0 1 1 1v4', 'M20 15v4a1 1 0 0 1-1 1h-4', 'M9 20H5a1 1 0 0 1-1-1v-4'],
  zoomIn: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-4-4', 'M11 8v6', 'M8 11h6'],
  zoomOut: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'm20 20-4-4', 'M8 11h6'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  plus: ['M12 5v14', 'M5 12h14'],
};

const formatCount = (value) => Number(value || 0).toLocaleString();
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
  const viewKey = useMemo(() => JSON.stringify([settings.limit, cap, search || null]), [settings.limit, cap, search]);
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

  /* ── Right-click menu and double-click (GB:2096, GB:2536) ──────────── */
  const [menu, setMenu] = useState(null); // { x, y, kind, id, selection, content }
  const closeMenu = useCallback(() => setMenu(null), []);
  const handleContextMenu = useCallback((request) => {
    if (!request) {
      setMenu(null);
      return;
    }
    const graph = store.graph();
    const visible = new Set(view.nodeIds);
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
      pathHighlighted: store.hasMarkers('path') || store.hasMarkers('traversal', viewKey),
      nodeStylesChanged: store.hasNodePatches(),
    });
    if (!content.header && !content.items.length) return;
    setMenu({ ...request, content });
  }, [isCdr, store, view.nodeIds, viewKey]);

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
        showPaths([result]);
        const distance = result.weighted ? `Total cost: ${Number(result.totalCost).toFixed(3)}` : `Hops: ${Math.max(0, result.path.length - 1)}`;
        report(`Path found. Nodes: ${result.path.length}. ${distance}.`);
      },
    });
  }, [report, showPaths, store]);

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
        showPaths(paths);
        report(`Found ${paths.length} path(s) within depth ${depth}.${truncated ? ' The search stopped at its limit, so there may be more.' : ''}`);
      },
    });
  }, [report, showPaths, store]);

  const runCutPoints = useCallback(() => {
    const points = findCutPoints(store.graph(), view.nodeIds);
    store.setMarkers('path', { nodes: points, edges: [] });
    if (!points.length) {
      report('No cut points found in the current visible graph.');
      return;
    }
    canvasRef.current?.select(points);
    report(`Found ${points.length} cut point(s).`);
  }, [report, store, view.nodeIds]);

  const runCommunities = useCallback(() => {
    const graph = store.graph();
    const communities = detectCommunities(graph, view.nodeIds, view.edgeIds);
    if (!communities.length) {
      report('No communities detected in the current visible graph.');
      return;
    }
    // Production separateCommunityLayout: each community moved onto a ring.
    const moved = separateCommunities(communities, (id) => store.getPosition(id));
    store.setPositions(Object.entries(moved));
    store.patchNodes(communities.flatMap((members, index) => {
      const color = nodeColor(paletteColor(index, communities.length));
      return members.map((id) => [id, { community_id: index + 1, color }]);
    }));
    requestAnimationFrame(() => canvasRef.current?.fit(communities.flat()));
    report(`${communities.length} communit${communities.length === 1 ? 'y' : 'ies'} detected; the largest has ${communities[0].length} node(s).`);
  }, [report, store, view.edgeIds, view.nodeIds]);

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
      onSubmit: ({ key }) => store.patchNodes(propertyEncoding(store.graph(), view.nodeIds, key)),
    });
  }, [report, store, view.nodeIds]);

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

  const runMenuAction = useCallback((action) => {
    const selection = menu?.selection || [];
    const visibleIds = view.nodeIds;
    if (action === 'expand_neighborhood') {
      const { skipped } = store.expandNeighbourhood(selection, { viewKey, visibleIds, depth: 1, cap });
      if (skipped) notifyDrawingLimit(skipped);
    } else if (action === 'collapse_neighborhood') {
      store.collapseNeighbourhood(selection, { viewKey, visibleIds, depth: 1 });
    } else if (action === 'path_finder') {
      runShortestPath(selection);
    } else if (action === 'find_all_paths') {
      runAllPaths(selection);
    } else if (action === 'link_traversal') {
      // Production runLinkTraversal: expand up to 5 degrees, highlight kept.
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
      store.patchNodes(degreeEncoding(store.graph(), visibleIds));
    } else if (action === 'visual_property') {
      runVisualProperty();
    } else if (action === 'filter_elements') {
      runElementFilter();
    } else if (action === 'reset_node_styles') {
      store.restoreNodePatches();
    }
  }, [cap, menu, notifyDrawingLimit, report, runAllPaths, runCommunities, runCutPoints, runElementFilter, runShortestPath, runVisualProperty, store, view.nodeIds, viewKey]);

  // Production expandNode: one hidden neighbour, past the limit if need be.
  const handleNodeDoubleClick = useCallback((nodeId) => {
    if (view.nodeIds.length >= cap) {
      notifyDrawingLimit(1);
      return;
    }
    store.expandNode(nodeId, { viewKey, visibleIds: view.nodeIds });
  }, [cap, notifyDrawingLimit, store, view.nodeIds, viewKey]);

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
          <div className="graph_window_tools" role="group" aria-label="View">
            <button type="button" className="graph_window_icon_button" aria-label="Zoom in" title="Zoom in" disabled={!hasData} onClick={() => canvasRef.current?.zoomBy(1.25)}><Icon d={ICONS.zoomIn} /></button>
            <button type="button" className="graph_window_icon_button" aria-label="Zoom out" title="Zoom out" disabled={!hasData} onClick={() => canvasRef.current?.zoomBy(0.8)}><Icon d={ICONS.zoomOut} /></button>
            <button type="button" className="graph_window_icon_button" aria-label="Fit graph" title="Fit graph" disabled={!hasData} onClick={() => canvasRef.current?.fit()}><Icon d={ICONS.fit} /></button>
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
          />
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
