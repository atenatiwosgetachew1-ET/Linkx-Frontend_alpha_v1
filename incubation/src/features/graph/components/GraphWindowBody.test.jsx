// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { cacheEvidenceGraph, clearEvidenceGraphs } from '../../reports/lib/evidenceGraphs.js';
import { clearGraphStores, getGraphStore, hasGraphStore } from '../lib/graphStore.js';
import { getPinnedEvidence, pinEvidence, resetPinnedEvidenceCache } from '../lib/pinnedEvidence.js';
import { OVERLAY_PREFS_KEY, resetOverlayPrefsCache } from '../lib/overlayPrefs.js';
import { CLIPBOARD_KEY, resetClipboardCache } from '../lib/graphClipboard.js';
import { getProfileSettings, resetProfileSettingsCache, setProfileSettings } from '../lib/nodeProfile.js';
import { bindGraphStatusSocket, clearGraphStatus, markGraphSessionClosed, markGraphSessionTerminated } from '../lib/graphStatus.js';

// jsdom cannot draw: the canvas is replaced by a probe showing what it gets.
// The latest props are kept so tests can play right-click / double-click.
const canvasProps = { current: null };
vi.mock('./GraphCanvas.jsx', () => ({
  default: React.forwardRef(function GraphCanvasProbe(props) {
    const { view, renderer } = props;
    canvasProps.current = props;
    return <div data-testid="canvas" data-renderer={renderer} data-nodes={view.nodeIds.length} data-edges={view.edgeIds.length} />;
  }),
}));

// jsdom has no WebGL: the device check is answered here.
vi.mock('../../../shared/device/gpuCapability.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGpuCapability: vi.fn(() => ({ verdict: 'capable', reasons: [] })),
}));

const { default: GraphWindowBody } = await import('./GraphWindowBody.jsx');

afterEach(() => {
  cleanup();
  clearGraphStatus();
  clearGraphStores();
  clearEvidenceGraphs();
  localStorage.clear();
  resetPinnedEvidenceCache();
  resetOverlayPrefsCache();
  resetClipboardCache();
});

const graphOf = (count) => ({
  nodes: Array.from({ length: count }, (_, i) => ({ id: i + 1, label: `N${i + 1}` })),
  edges: Array.from({ length: count - 1 }, (_, i) => ({ from: 1, to: i + 2 })),
});

let workspaceRef;
function Probe() {
  workspaceRef = useWorkspace();
  return null;
}

const renderGraph = ({ metadata = {}, apiFetch = vi.fn(), id = 'graph-1' } = {}) => {
  const windowItem = { id, type: WORKSPACE_WINDOW_TYPES.GRAPH, title: 'Graph 1', metadata };
  return render(
    <NotificationProvider>
      <SessionContext.Provider value={{ apiFetch, configuration: { active_domain: 'bank' } }}>
        <WorkspaceProvider>
          <Probe />
          <GraphWindowBody windowItem={windowItem} />
        </WorkspaceProvider>
      </SessionContext.Provider>
    </NotificationProvider>,
  );
};

describe('GraphWindowBody', () => {
  it('opens an evidence graph from the Reports cache without a request', async () => {
    cacheEvidenceGraph('tr-1', { data: {}, ...graphOf(40) });
    const apiFetch = vi.fn();
    renderGraph({ metadata: { evidence: { traceId: 'tr-1', reportId: 5 } }, apiFetch });
    // Production default: 25 visible nodes.
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '25'));
    expect(screen.getByText(/of 40 nodes/)).toBeInTheDocument();
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-renderer', 'canvas');
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('fetches an evidence graph that is not cached, then shows it', async () => {
    const apiFetch = vi.fn(async () => ({ results: { graph: graphOf(3) } }));
    renderGraph({ metadata: { evidence: { traceId: 'tr-2', reportId: 9, externalReferenceId: 'R-9' } }, apiFetch });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3'));
    expect(apiFetch).toHaveBeenCalledWith('/get_graph', expect.objectContaining({
      method: 'POST',
      body: expect.objectContaining({ id: 'evidence', trace_id: 'tr-2', report_id: '9', external_reference_id: 'R-9' }),
    }));
  });

  it('shows the backend error with a working Retry', async () => {
    const apiFetch = vi.fn()
      .mockResolvedValueOnce({ message: 'Evidence not found' })
      .mockResolvedValueOnce({ results: { graph: graphOf(2) } });
    renderGraph({ metadata: { evidence: { traceId: 'tr-3' } }, apiFetch });
    expect(await screen.findByText('Evidence not found')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '2'));
  });

  it('closes with "Graph Empty" when the evidence has no graph (production)', async () => {
    const apiFetch = vi.fn(async () => ({ results: { graph: { nodes: [], edges: [] } } }));
    // A real workspace window, rendered from the workspace like the dock does.
    function OpenGraphWindows() {
      const workspace = useWorkspace();
      workspaceRef = workspace;
      return workspace.windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.GRAPH)
        .map((item) => <GraphWindowBody key={item.id} windowItem={item} />);
    }
    render(
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch, configuration: { active_domain: 'bank' } }}>
          <WorkspaceProvider>
            <OpenGraphWindows />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>,
    );
    act(() => {
      workspaceRef.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id: 'graph-5', metadata: { evidence: { traceId: 'tr-5' } } });
    });
    expect(workspaceRef.windows.map((item) => item.id)).toContain('graph-5');
    expect(await screen.findByText('No graph data found for this evidence.')).toBeInTheDocument();
    expect(screen.getByText('Graph Empty')).toBeInTheDocument();
    await waitFor(() => expect(workspaceRef.windows.map((item) => item.id)).not.toContain('graph-5'));
    expect(hasGraphStore('graph-5')).toBe(false);
  });

  it('closes the same way for an empty graph from the Reports cache', async () => {
    cacheEvidenceGraph('tr-6', { data: {}, nodes: [], edges: [] });
    const apiFetch = vi.fn();
    renderGraph({ id: 'graph-6', metadata: { evidence: { traceId: 'tr-6' } }, apiFetch });
    expect(await screen.findByText('Graph Empty')).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('keeps its data across remounts (docked tab switch) without refetching', async () => {
    const apiFetch = vi.fn(async () => ({ results: { graph: graphOf(3) } }));
    const first = renderGraph({ metadata: { evidence: { traceId: 'tr-4' } }, apiFetch });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3'));
    first.unmount();
    renderGraph({ metadata: { evidence: { traceId: 'tr-4' } }, apiFetch });
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3');
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it('caps the view for the standard renderer and says so', () => {
    getGraphStore('graph-9').replace(graphOf(2500));
    renderGraph({ id: 'graph-9', metadata: { graphSettings: { limit: { min: 0, max: 3000 } } } });
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '2000');
    expect(screen.getByText('Limited to 2,000')).toBeInTheDocument();
  });

  it('warns above 300 visible nodes, and suggests GPU rendering once per device', () => {
    getGraphStore('graph-8').replace(graphOf(400));
    const first = renderGraph({ id: 'graph-8', metadata: { graphSettings: { limit: { min: 0, max: 350 } } } });
    expect(screen.getByText('Large view: may be slow')).toBeInTheDocument();
    expect(screen.getByText('Faster drawing available')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Libraries' })).toBeInTheDocument();
    first.unmount();
    renderGraph({ id: 'graph-8', metadata: { graphSettings: { limit: { min: 0, max: 350 } } } });
    expect(screen.queryByText('Faster drawing available')).not.toBeInTheDocument();
  });

  it('explains an empty window and a linked session', () => {
    const { unmount } = renderGraph();
    expect(screen.getByText('No graph to render')).toBeInTheDocument();
    unmount();
    renderGraph({ id: 'graph-2', metadata: { graphLinkSource: '1_7' } });
    expect(screen.getByText('Waiting for the linked session')).toBeInTheDocument();
    expect(screen.getByText(/Waiting for relationships from session 1_7/)).toBeInTheDocument();
  });
});

describe('GraphWindowBody linked to a session', () => {
  const statusSocket = () => {
    const handlers = {};
    const socket = { connected: true, on: (event, fn) => { handlers[event] = fn; }, off: () => {}, emit: vi.fn(), receive: (event, payload) => handlers[event]?.(payload) };
    bindGraphStatusSocket(socket);
    return socket;
  };

  function Windows() {
    const workspace = useWorkspace();
    workspaceRef = workspace;
    return workspace.windows.map((item) => <GraphWindowBody key={item.id} windowItem={item} />);
  }

  const openLinked = (apiFetch) => {
    render(
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch, configuration: { active_domain: 'bank' } }}>
          <WorkspaceProvider>
            <Windows />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>,
    );
    act(() => {
      workspaceRef.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id: 'graph-7', metadata: { graphLinkSource: '3_17' } });
    });
  };

  it('shows the relationship tabs from the status socket, starts on All and loads one', async () => {
    const socket = statusSocket();
    const apiFetch = vi.fn(async () => ({ results: { graph: graphOf(4) } }));
    openLinked(apiFetch);
    expect(screen.getByText('Waiting for the linked session')).toBeInTheDocument();
    act(() => socket.receive('status', { session_id: '3_17', type: 'relationships', data: [{ type: 'FUND_FLOW', bgcolor: '#2563eb' }] }));
    expect(screen.getByRole('tablist', { name: 'Graph relationships' })).toBeInTheDocument();
    // All loads by itself once the relationships arrive.
    expect(screen.getByRole('tab', { name: 'All (*)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'FUND_FLOW' })).toHaveAttribute('aria-selected', 'false');
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    expect(apiFetch).toHaveBeenCalledWith('/get_graph', expect.objectContaining({ body: { id: 'relationship', source_id: '3_17', relationship: '*' } }));
    await userEvent.click(screen.getByRole('tab', { name: 'FUND_FLOW' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    expect(apiFetch).toHaveBeenCalledWith('/get_graph', expect.objectContaining({ body: { id: 'relationship', source_id: '3_17', relationship: 'FUND_FLOW' } }));
    // The drawn tab is selected, read as words, in its backend colour.
    const tab = screen.getByRole('tab', { name: 'FUND_FLOW' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveTextContent('Fund flow');
    expect(tab.style.getPropertyValue('--chip-bg')).toBe('#2563eb');
    expect(screen.getByRole('tab', { name: 'All (*)' })).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps the window when a relationship has no data', async () => {
    const socket = statusSocket();
    openLinked(vi.fn(async () => ({ results: { graph: { nodes: [], edges: [] } } })));
    act(() => socket.receive('status', { session_id: '3_17', type: 'relationships', data: ['SMURFING'] }));
    expect(await screen.findByText('No graph data found for this session.')).toBeInTheDocument();
    expect(workspaceRef.windows.map((item) => item.id)).toContain('graph-7');
  });

  it('unlinks but keeps the graph when the source is terminated; resets when it is closed', async () => {
    const socket = statusSocket();
    openLinked(vi.fn(async () => ({ results: { graph: graphOf(3) } })));
    act(() => socket.receive('status', { session_id: '3_17', type: 'relationships', data: ['A'] }));
    await userEvent.click(screen.getByRole('tab', { name: 'A' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3'));
    act(() => markGraphSessionTerminated('3_17'));
    await waitFor(() => expect(workspaceRef.windows[0].metadata.graphLinkSource).toBeNull());
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3');

    // Linked again, then the Source window is closed: production resets it.
    act(() => workspaceRef.updateWindowMetadata('graph-7', { metadata: { graphLinkSource: '4_17' } }));
    act(() => markGraphSessionClosed('4_17'));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '0'));
  });
});

describe('GraphWindowBody right-click menu and double-click', () => {
  // Node 1 is a hub of 40; 25 are shown.
  const open = async () => {
    cacheEvidenceGraph('tr-menu', { data: {}, ...graphOf(40) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-menu', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '25'));
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));

  it('lists production\'s node items; unported ones are shown but unavailable', async () => {
    await open();
    rightClick({ kind: 'node', id: 3, selection: [3] });
    const menu = screen.getByRole('menu', { name: 'Graph actions' });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Expand Neighborhood' })).toHaveAttribute('aria-disabled', 'false');
    expect(screen.queryByRole('menuitem', { name: 'Delete Node' })).not.toBeInTheDocument();
    // Groups open as submenus (hover, click or →); Escape closes one level.
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    const edit = screen.getByRole('menu', { name: 'Edit' });
    expect(screen.getByRole('menuitem', { name: 'Delete Node' })).toHaveAttribute('aria-disabled', 'false');
    await userEvent.keyboard('{Escape}');
    expect(edit).not.toBeInTheDocument();
    expect(screen.getByRole('menu', { name: 'Graph actions' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('expand shows the hidden neighbours; collapse hides them again', async () => {
    await open();
    rightClick({ kind: 'node', id: 1, selection: [1] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Expand Neighborhood' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '40');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    rightClick({ kind: 'node', id: 1, selection: [1] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Collapse Neighborhood' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '1');
  });

  it('double-click shows one hidden neighbour past the limit', async () => {
    await open();
    act(() => canvasProps.current.onNodeDoubleClick(1));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '26');
  });

  it('an edge shows production\'s edge information', async () => {
    await open();
    const edgeKey = getGraphStore('graph-1').graph().edges()[0];
    rightClick({ kind: 'edge', id: edgeKey, selection: [] });
    const menu = screen.getByRole('menu', { name: 'Edge Information' });
    expect(menu).toHaveTextContent('Semantic: N/A');
    expect(menu).toHaveTextContent('Financial Flow: No');
  });
});

describe('GraphWindowBody empty window', () => {
  it('offers "Create new graph", which turns it into a blank canvas', async () => {
    renderGraph();
    expect(screen.getByText('No graph to render')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create new graph' }));
    // The metadata update reaches a workspace window; here the prop is fixed,
    // so the call is checked through a re-render with the new metadata.
    cleanup();
    renderGraph({ metadata: { graphBlank: true } });
    expect(screen.queryByText('No graph to render')).not.toBeInTheDocument();
    expect(screen.getByText('New graph · 0 nodes')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Source ID' })).toHaveAttribute('placeholder', 'Enter source ID');
  });

  it('says when a typed window ID matches no Source window', async () => {
    renderGraph();
    await userEvent.type(screen.getByRole('combobox', { name: 'Source ID' }), 'source-9{Enter}');
    expect(await screen.findByText('The selected source window could not be found.')).toBeInTheDocument();
  });
});

describe('GraphWindowBody analysis tools (G2.3)', () => {
  // A chain 1-2-3-4 plus 1-4 weighted 10; all four shown.
  const open = async () => {
    cacheEvidenceGraph('tr-an', {
      data: {},
      nodes: [1, 2, 3, 4].map((id) => ({ id, label: `N${id}`, amount: id * 10 })),
      edges: [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }, { from: 1, to: 4, weight: 10 }],
    });
    renderGraph({ metadata: { evidence: { traceId: 'tr-an', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const store = () => getGraphStore('graph-1');

  it('Find Shortest Path asks for the mode, highlights the path and reports it', async () => {
    await open();
    rightClick({ kind: 'node', id: '1', selection: ['1', '4'] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Paths' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Find Shortest Path' }));
    const dialog = screen.getByRole('dialog', { name: 'Find Shortest Path' });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Path mode' }), 'weighted');
    await userEvent.click(screen.getByRole('button', { name: 'Find path' }));
    expect(dialog).not.toBeInTheDocument();
    expect(await screen.findByText('Path found. Nodes: 4. Total cost: 3.000.')).toBeInTheDocument();
    expect([...store().getMarkers().path.nodes].sort()).toEqual(['1', '2', '3', '4']);
    expect(JSON.parse(localStorage.getItem('linkx_path_options_v1'))).toMatchObject({ weighted: true, directed: false });
    // Clear Path Highlight (node menu) removes it.
    rightClick({ kind: 'node', id: '1', selection: ['1'] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Clear Path Highlight' }));
    expect(store().hasMarkers('path')).toBe(false);
  });

  it('Visualize by Degree changes node styles; Reset Node Styles restores them', async () => {
    await open();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Analyze' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Visualize by Degree' }));
    expect(store().getNode('1')).toMatchObject({ size: 40 });
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Analyze' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reset Node Styles' }));
    expect(store().getNode('1').size).toBeUndefined();
  });

  it('Filter Elements hides theme lines and remembers the choice on the device', async () => {
    await open();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Analyze' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Filter Elements' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Theme lines' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(JSON.parse(localStorage.getItem('linkx_element_filters_v1'))).toMatchObject({ theme_lines: false, nodes: true });
  });

  it('Cut Points and communities report their result', async () => {
    await open();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Analyze' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Cut Points' }));
    expect(await screen.findByText('No cut points found in the current visible graph.')).toBeInTheDocument();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Analyze' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Detect Communities' }));
    expect(await screen.findByText(/communit(y|ies) detected/)).toBeInTheDocument();
    expect(store().getNode('1').community_id).toBe(1);
  });
});

// A Graph window opened in the workspace, so metadata updates (settings)
// come back to it as in the app.
function LiveGraph({ metadata }) {
  const workspace = useWorkspace();
  workspaceRef = workspace;
  const opened = React.useRef(false);
  React.useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    workspace.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { title: 'Graph 1', metadata });
  }, [metadata, workspace]);
  const item = workspace.windows.find((entry) => entry.type === WORKSPACE_WINDOW_TYPES.GRAPH);
  return item ? <GraphWindowBody windowItem={item} /> : null;
}

describe('GraphWindowBody graph alerts (G2.4)', () => {
  // Node 1 is a hub with 24 shown neighbours: production's high-degree rule.
  const open = async (graph = graphOf(40)) => {
    cacheEvidenceGraph('tr-alerts', { data: {}, ...graph });
    render(
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch: vi.fn(), configuration: { active_domain: 'bank' } }}>
          <WorkspaceProvider>
            <LiveGraph metadata={{ evidence: { traceId: 'tr-alerts', reportId: 1 } }} />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('canvas')).not.toHaveAttribute('data-nodes', '0'));
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const graphWindow = () => workspaceRef.windows.find((entry) => entry.type === WORKSPACE_WINDOW_TYPES.GRAPH);
  const store = () => getGraphStore(graphWindow().id);
  const alertMenu = async (name) => {
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Alert Rules' }));
    await userEvent.click(screen.getByRole('menuitem', { name }));
  };

  it('the first scan flags the hub, opens the panel and highlights it; a card focuses it in Info', async () => {
    const { subscribeContextTabRequests } = await import('../../../workspace/state/contextTabRequests.js');
    const requested = [];
    const unsubscribe = subscribeContextTabRequests((tab) => requested.push(tab));
    const hub = graphOf(40);
    hub.nodes = hub.nodes.map((node) => ({ ...node, account: `ACC-${node.id}` }));
    await open(hub);
    const panel = await screen.findByRole('region', { name: 'Graph Alerts' });
    // Starts folded, as an alerted node with its count and "!" badge; the
    // summary is its title and status.
    expect(panel).toHaveClass('is-collapsed');
    expect(panel).toHaveClass('is-bubble');
    expect(panel).toHaveTextContent('1 alert · 1 high');
    expect(panel.querySelector('.graph_card_node')).toHaveTextContent('×1');
    expect(panel.querySelector('.graph_card_node_badge')).not.toBeNull();
    // Its themed tooltip: title, summary, severity chips.
    const tip = screen.getByRole('tooltip', { hidden: true });
    expect(screen.getByRole('button', { name: 'Expand Graph Alerts' })).toHaveAttribute('aria-describedby', tip.id);
    expect(tip).toHaveTextContent('Graph Alerts');
    expect(tip).toHaveTextContent('1 alert · 1 high');
    expect(tip).toHaveTextContent('1 high');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Graph Alerts' }));
    expect(panel).toHaveTextContent('Highly connected');
    // Short card text; production's full text is the tooltip.
    expect(panel).toHaveTextContent('Hub linked to 24 nodes.');
    expect(panel).not.toHaveTextContent('structuring');
    expect(screen.getByRole('button', { name: /label : N1/ }).title).toMatch(/^Connected to 24 other nodes/);
    // Open, it has no fold or close button of its own: × folds it back into
    // the bubble (summary stays), and it is not dragged.
    expect(screen.queryByRole('button', { name: 'Close Graph Alerts' })).not.toBeInTheDocument();
    expect(panel.querySelector('.graph_overlay_fold')).toBeNull();
    // Grouped by severity, with the number that raised it.
    expect(within(panel).getByRole('region', { name: 'High severity' })).toHaveTextContent('24links');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Graph Alerts' }));
    expect(panel).toHaveClass('is-bubble');
    expect(panel).toHaveClass('is-collapsed');
    expect(panel).toHaveTextContent('1 alert · 1 high');
    expect(screen.queryByRole('combobox', { name: 'Name by' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Expand Graph Alerts' }));
    expect(panel).not.toHaveClass('is-collapsed');
    expect([...store().getMarkers().alert.nodes]).toEqual(['1']);
    // Name by: any property of the alerted nodes (Auto: the first one).
    expect(screen.getByRole('button', { name: /label : N1/ })).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Name by' }), 'account');
    await userEvent.click(await screen.findByRole('button', { name: /account : ACC-1/ }));
    // A key the flagged node has no value for falls back to Auto, and says so.
    act(() => store().patchNodes([['1', { account: '' }]])); // a data change rescans
    expect(await screen.findByText('No “account” on this node; named automatically.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /label : N1/ })).toBeInTheDocument();
    expect(requested).toEqual(['info']);
    // Escape folds it (the window is the active one).
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(panel).toHaveClass('is-collapsed');
    unsubscribe();
  });

  it('a clean graph still opens the panel and says so; Run Alert Scan rescans', async () => {
    await open(graphOf(3));
    const panel = await screen.findByRole('region', { name: 'Graph Alerts' });
    expect(panel).toHaveTextContent('No alerts — graph looks clean.');
    await alertMenu('Run Alert Scan');
    expect(screen.getByRole('region', { name: 'Graph Alerts' })).toHaveTextContent('Scanning…');
    // (The summary is also in the bubble's tooltip.)
    expect((await screen.findAllByText('No alerts — graph looks clean.')).length).toBeGreaterThan(0);
  });

  it('Disable Alert Rules clears the highlight and is kept in the window settings', async () => {
    await open();
    await screen.findByRole('region', { name: 'Graph Alerts' });
    await alertMenu('Disable Alert Rules');
    await waitFor(() => expect(store().hasMarkers('alert')).toBe(false));
    expect(screen.getByRole('region', { name: 'Graph Alerts' })).toHaveTextContent('Alert rules are off.');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Graph Alerts' }));
    expect(screen.getByRole('button', { name: /Rescan/ })).toBeDisabled();
    expect(graphWindow().metadata.graphSettings.alertRules).toBe(false);
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Alert Rules' }));
    expect(screen.getByRole('menuitem', { name: 'Enable Alert Rules' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Run Alert Scan' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('Configure Alert Rules saves the rules on the device and rescans with them', async () => {
    await open();
    await screen.findByRole('region', { name: 'Graph Alerts' });
    await alertMenu('Configure Alert Rules');
    const field = screen.getByRole('spinbutton', { name: /Minimum degree to alert/ });
    await userEvent.clear(field);
    await userEvent.type(field, '30');
    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    expect(JSON.parse(localStorage.getItem('linkx_alert_rules_v1'))).toMatchObject({ highDegreeMin: 30, heavyEdgePercentile: 95 });
    await waitFor(() => expect(store().hasMarkers('alert')).toBe(false));
  });
});

describe('GraphWindowBody alerts panel behaviour', () => {
  it('waits for a streamed graph to finish before opening by itself', async () => {
    const store = getGraphStore('graph-1');
    renderGraph({ metadata: { evidence: { traceId: 'tr-stream', reportId: 1 } }, apiFetch: vi.fn(() => new Promise(() => {})) });
    // First chunk: no hub yet. Still loading, so the panel must not use up its auto-open.
    act(() => {
      store.setStatus({ state: 'loading', progressive: true });
      store.replace(graphOf(3));
    });
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    expect(screen.queryByRole('region', { name: 'Graph Alerts' })).not.toBeInTheDocument();
    act(() => {
      store.replace(graphOf(20));
      store.setStatus({ state: 'ready', source: 'evidence' });
    });
    expect(await screen.findByRole('region', { name: 'Graph Alerts' })).toHaveTextContent('1 alert · 1 high');
  });

  it('open, it drags by its header and folds back to the stack; it resizes from its top-left corner and keeps that size while open', async () => {
    cacheEvidenceGraph('tr-drag', { data: {}, ...graphOf(20) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-drag', reportId: 1 } } });
    const panel = await screen.findByRole('region', { name: 'Graph Alerts' });
    const stage = panel.parentElement;
    Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 800 });
    Object.defineProperty(stage, 'clientHeight', { configurable: true, value: 600 });
    Object.defineProperty(panel, 'offsetWidth', { configurable: true, get: () => parseFloat(panel.style.width) || 300 });
    Object.defineProperty(panel, 'offsetHeight', { configurable: true, get: () => parseFloat(panel.style.height) || 380 });
    Object.defineProperty(panel, 'offsetLeft', { configurable: true, get: () => 480 });
    Object.defineProperty(panel, 'offsetTop', { configurable: true, get: () => 200 });
    await userEvent.click(screen.getByRole('button', { name: 'Expand Graph Alerts' }));
    const { fireEvent } = await import('@testing-library/react');
    if (!window.PointerEvent) window.PointerEvent = class extends MouseEvent {};
    // The header drags it; folding sends it back to the stack, and the next
    // unfold starts there.
    fireEvent.pointerDown(panel.querySelector('header'), { button: 0, clientX: 600, clientY: 210 });
    fireEvent.pointerMove(document, { clientX: 500, clientY: 260 });
    fireEvent.pointerUp(document);
    expect(panel).toHaveClass('is-moved');
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Graph Alerts' }));
    expect(panel).not.toHaveClass('is-moved');
    expect(panel.style.left).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Graph Alerts' }));
    expect(panel).not.toHaveClass('is-moved');
    // The top-left grip grows it up and to the left (anchored bottom-right).
    fireEvent.pointerDown(panel.querySelector('.graph_overlay_resize'), { button: 0, clientX: 480, clientY: 200 });
    fireEvent.pointerMove(document, { clientX: 420, clientY: 160 });
    expect(panel.style.width).toBe('360px');
    expect(panel.style.height).toBe('420px');
    // Not below its smallest size, nor past the canvas.
    fireEvent.pointerMove(document, { clientX: 700, clientY: 500 });
    expect(panel.style.width).toBe('240px');
    expect(panel.style.height).toBe('200px');
    fireEvent.pointerMove(document, { clientX: -900, clientY: -900 });
    expect(panel.style.width).toBe('800px');
    expect(panel.style.height).toBe('600px');
    fireEvent.pointerMove(document, { clientX: 420, clientY: 160 });
    fireEvent.pointerUp(document);
    expect(getGraphStore('graph-1').getUi('alertsSize')).toEqual({ width: 360, height: 420 });
    // Kept for the next mount.
    cleanup();
    renderGraph({ metadata: { evidence: { traceId: 'tr-drag', reportId: 1 } } });
    const again = await screen.findByRole('region', { name: 'Graph Alerts' });
    expect(again.style.width).toBe('360px');
    expect(again.style.height).toBe('420px');
    // Folded and opened again: back to its initial size.
    await userEvent.click(screen.getByRole('button', { name: 'Collapse Graph Alerts' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand Graph Alerts' }));
    expect(again.style.width).toBe('');
    expect(again.style.height).toBe('');
    expect(getGraphStore('graph-1').getUi('alertsSize')).toBeNull();
  });
});

describe('GraphWindowBody pinned evidence (G2.4b)', () => {
  // A chain 1-2-3 plus a backend edge e9 (3 → 4); all shown.
  const open = async () => {
    cacheEvidenceGraph('tr-pin', {
      data: {},
      nodes: [1, 2, 3, 4].map((id) => ({ id, label: `N${id}` })),
      edges: [{ from: 1, to: 2 }, { from: 2, to: 3 }, { id: 'e9', from: 3, to: 4 }],
    });
    renderGraph({ metadata: { evidence: { traceId: 'tr-pin', reportId: 1 }, graphSettings: { alertRules: false } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const store = () => getGraphStore('graph-1');
  const evidenceItem = async (request, name) => {
    rightClick(request);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Evidence' }));
    return screen.getByRole('menuitem', { name });
  };

  it('pins the right-clicked node (outlined), then only Unpin applies; unpinning removes it', async () => {
    await open();
    const node = { kind: 'node', id: '2', selection: ['2'] };
    expect(await evidenceItem(node, 'Unpin Evidence')).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin Evidence' }));
    expect(getPinnedEvidence().map((item) => `${item.type}:${item.id}`)).toEqual(['node:2']);
    await waitFor(() => expect([...store().getMarkers().pinned.nodes]).toEqual(['2']));
    expect(await evidenceItem(node, 'Pin Evidence')).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByRole('menuitem', { name: 'Unpin Evidence' }));
    expect(getPinnedEvidence()).toEqual([]);
    await waitFor(() => expect(store().hasMarkers('pinned')).toBe(false));
  });

  it('pins a selection with its selected edges, stored by backend edge id', async () => {
    await open();
    rightClick({ kind: 'node', id: '3', selection: ['3', '4'], edgeSelection: ['id:e9'] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Evidence' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin Evidence' }));
    expect(getPinnedEvidence().map((item) => `${item.type}:${item.id}`)).toEqual(['edge:e9', 'node:4', 'node:3']);
    await waitFor(() => expect([...store().getMarkers().pinned.edges]).toEqual(['id:e9']));
  });

  it('Show opens the Pinned Evidence card expanded; other graphs are counted; Clear asks first', async () => {
    pinEvidence([{ type: 'node', id: 'elsewhere', data: { label: 'Other graph' } }]);
    await open();
    pinEvidence([{ type: 'node', id: '1', data: { label: 'N1' } }]);
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pinned Evidence' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show Pinned Evidence' }));
    const card = screen.getByRole('region', { name: 'Pinned Evidence' });
    expect(card).not.toHaveClass('is-collapsed');
    expect(card).toHaveTextContent('1 pinned in this graph');
    expect(card).toHaveTextContent('label : N1');
    expect(card).toHaveTextContent('1 more pinned in other graphs.');
    expect(card).not.toHaveTextContent('Other graph');
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pinned Evidence' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Clear Pinned Evidence' }));
    expect(screen.getByRole('dialog', { name: 'Clear Pinned Evidence' })).toHaveTextContent('Remove all 2 pinned item(s)?');
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(getPinnedEvidence()).toEqual([]);
    expect(await screen.findByText('Cleared 2 pinned item(s).')).toBeInTheDocument();
  });

  it('Show and Clear are unavailable while nothing is pinned', async () => {
    await open();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pinned Evidence' }));
    expect(screen.getByRole('menuitem', { name: 'Show Pinned Evidence' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Clear Pinned Evidence' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('GraphWindowBody Show Pinned Evidence past the limit', () => {
  it('shows pinned nodes the limit hides (and both ends of pinned edges)', async () => {
    // 40 nodes, 25 shown; node 33 and the edge 1 → 38 are pinned.
    const graph = graphOf(40);
    graph.edges = graph.edges.map((edge) => (edge.to === 38 ? { ...edge, id: 'e38' } : edge));
    cacheEvidenceGraph('tr-pin-limit', { data: {}, ...graph });
    pinEvidence([{ type: 'node', id: '33' }, { type: 'edge', id: 'e38' }]);
    renderGraph({ metadata: { evidence: { traceId: 'tr-pin-limit', reportId: 1 }, graphSettings: { alertRules: false } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '25'));
    act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, kind: 'canvas', id: null, selection: [] }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pinned Evidence' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Show Pinned Evidence' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '27');
    const shown = new Set(canvasProps.current.view.nodeIds);
    expect(shown.has('33') && shown.has('38') && shown.has('1')).toBe(true);
    expect(screen.getByRole('region', { name: 'Pinned Evidence' })).toHaveTextContent('2 pinned in this graph');
  });
});

describe('GraphWindowBody Pinned Evidence card', () => {
  const open = async () => {
    cacheEvidenceGraph('tr-card', { data: {}, ...graphOf(40) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-card', reportId: 1 }, graphSettings: { alertRules: false } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '25'));
  };

  it('opens folded once a graph with pinned items has loaded; a card shows a hidden item; × unpins', async () => {
    pinEvidence([{ type: 'node', id: '33' }]);
    await open();
    const card = await screen.findByRole('region', { name: 'Pinned Evidence' });
    expect(card).toHaveClass('is-collapsed');
    expect(card).toHaveTextContent('1 pinned in this graph');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Pinned Evidence' }));
    expect(card).toHaveTextContent('not shown at this limit');
    await userEvent.click(screen.getByRole('button', { name: /^label : N33/ }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '26');
    await userEvent.click(screen.getByRole('button', { name: 'Unpin label : N33' }));
    expect(getPinnedEvidence()).toEqual([]);
    expect(card).toHaveTextContent('None in this graph');
  });

  it('stays closed without pinned items, and opens when something is pinned', async () => {
    await open();
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(screen.queryByRole('region', { name: 'Pinned Evidence' })).not.toBeInTheDocument();
    act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, kind: 'node', id: '2', selection: ['2'] }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Evidence' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin Evidence' }));
    expect(screen.getByRole('region', { name: 'Pinned Evidence' })).toHaveTextContent('1 pinned in this graph');
  });
});

describe('GraphWindowBody saved views (G2.4c)', () => {
  const open = async () => {
    cacheEvidenceGraph('tr-views', { data: {}, ...graphOf(40) });
    render(
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch: vi.fn(), configuration: { active_domain: 'bank' } }}>
          <WorkspaceProvider>
            <LiveGraph metadata={{ evidence: { traceId: 'tr-views', reportId: 1 }, graphSettings: { alertRules: false } }} />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '25'));
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const viewsMenu = async (name) => {
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Views' }));
    return screen.queryByRole('menuitem', { name });
  };

  it('saves the expanded view, and loading it brings back exactly those nodes and settings', async () => {
    await open();
    expect(await viewsMenu('Load View')).not.toBeInTheDocument(); // nothing saved yet
    await userEvent.keyboard('{Escape}{Escape}');
    rightClick({ kind: 'node', id: '1', selection: ['1'] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Expand Neighborhood' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '40');
    await userEvent.click(await viewsMenu('Save View'));
    const name = screen.getByRole('textbox', { name: 'View name' });
    expect(name.value).toMatch(/^View \d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
    await userEvent.clear(name);
    await userEvent.type(name, 'Whole hub');
    await userEvent.click(screen.getByRole('button', { name: 'Save view' }));
    expect(await screen.findByText('View “Whole hub” saved.')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('linkx_saved_views_v1'));
    expect(stored[0]).toMatchObject({ name: 'Whole hub', scopeId: 'graph_40_39_2073939184', settings: { limitMin: 0, limitMax: 25 } });
    expect(stored[0].visibleNodes).toHaveLength(40);
    // Change the view: collapse the hub, then load the saved view.
    rightClick({ kind: 'node', id: '1', selection: ['1'] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Collapse Neighborhood' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '1');
    await userEvent.click(await viewsMenu('Load View'));
    expect(screen.getByRole('combobox', { name: 'Saved view' })).toHaveTextContent('Whole hub');
    await userEvent.click(screen.getByRole('button', { name: 'Load view' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '40'));
    expect(await screen.findByText('View “Whole hub” loaded.')).toBeInTheDocument();
  });

  it('applies a view production saved (its settings keys, its visible nodes)', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => String(i + 1));
    localStorage.setItem('linkx_saved_views_v1', JSON.stringify([{
      name: 'From production',
      scopeId: 'graph_40_39_2073939184',
      visibleNodes: ids.slice(30),
      settings: { limitMin: 30, limitMax: 40, layoutType: 'circle', alertRules: false },
    }]));
    await open();
    await userEvent.click(await viewsMenu('Load View'));
    await userEvent.click(screen.getByRole('button', { name: 'Load view' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '10'));
    expect([...canvasProps.current.view.nodeIds].sort()).toEqual(ids.slice(30).sort());
    const graphWindow = workspaceRef.windows.find((entry) => entry.type === WORKSPACE_WINDOW_TYPES.GRAPH);
    expect(graphWindow.metadata.graphSettings).toMatchObject({ limit: { min: 30, max: 40 }, layout: { type: 'circle' } });
  });

  it('removes saved views of this graph', async () => {
    localStorage.setItem('linkx_saved_views_v1', JSON.stringify([
      { name: 'A', scopeId: 'graph_40_39_2073939184' }, { name: 'B', scopeId: 'graph_40_39_2073939184' },
    ]));
    await open();
    await userEvent.click(await viewsMenu('Remove Saved Views'));
    await userEvent.click(screen.getByRole('checkbox', { name: 'A' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Removed 1 saved view(s).')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('linkx_saved_views_v1')).map((view) => view.name)).toEqual(['B']);
  });
});

describe('GraphWindowBody undo / redo (G2.4d)', () => {
  const open = async (count = 40) => {
    cacheEvidenceGraph('tr-history', { data: {}, ...graphOf(count) });
    render(
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch: vi.fn(), configuration: { active_domain: 'bank' } }}>
          <WorkspaceProvider>
            <LiveGraph metadata={{ evidence: { traceId: 'tr-history', reportId: 1 }, graphSettings: { alertRules: false } }} />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('canvas')).not.toHaveAttribute('data-nodes', '0'));
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const store = () => getGraphStore(workspaceRef.windows.find((entry) => entry.type === WORKSPACE_WINDOW_TYPES.GRAPH).id);

  it('the toolbar undoes and redoes an expand and a style change', async () => {
    await open();
    const undo = screen.getByRole('button', { name: 'Undo' });
    const redo = screen.getByRole('button', { name: 'Redo' });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();
    rightClick({ kind: 'node', id: '1', selection: ['1'] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Expand Neighborhood' }));
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Analyze' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Visualize by Degree' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '40');
    expect(store().getNode('1').size).toBeDefined();
    await userEvent.click(undo);
    expect(store().getNode('1').size).toBeUndefined();
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '40');
    await userEvent.click(undo);
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '25');
    expect(undo).toBeDisabled();
    await userEvent.click(redo);
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '40');
    await userEvent.click(redo);
    expect(store().getNode('1').size).toBeDefined();
    expect(redo).toBeDisabled();
  });

  it('a double-click expand can be undone', async () => {
    await open();
    act(() => canvasProps.current.onNodeDoubleClick('1'));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '26');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '25');
  });

  it('says once that history is off for graphs above 4,500 entities', async () => {
    await open(2300);
    rightClick({ kind: 'node', id: '1', selection: ['1'] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Collapse Neighborhood' }));
    expect(await screen.findByText('Undo/Redo is disabled for large graphs (more than 4,500 entities).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });
});

describe('GraphWindowBody semantic legend', () => {
  it('shows production\'s Relationship Types for NBE once a graph is drawn, and none on an empty window', async () => {
    renderGraph();
    expect(screen.queryByRole('note', { name: 'Relationship Types' })).not.toBeInTheDocument();
    cleanup();
    cacheEvidenceGraph('tr-legend', { data: {}, ...graphOf(3) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-legend', reportId: 1 }, graphSettings: { alertRules: false } } });
    const legend = await screen.findByRole('note', { name: 'Relationship Types' });
    expect(legend).toHaveTextContent('Observed financial transfer');
    expect(legend).toHaveTextContent('Time-ordered sequence (not a transfer)');
    expect(legend).toHaveTextContent('Analytical grouping (shared property)');
    expect(legend).toHaveTextContent('Node flag (property of transaction)');
  });
});

describe('GraphWindowBody overlay cards stay put', () => {
  if (!window.PointerEvent) window.PointerEvent = class extends MouseEvent {};

  it('cards keep their state when the window body remounts (docked <-> floating)', async () => {
    pinEvidence([{ type: 'node', id: '2' }]);
    cacheEvidenceGraph('tr-remount', { data: {}, ...graphOf(20) });
    const metadata = { evidence: { traceId: 'tr-remount', reportId: 1 } };
    renderGraph({ metadata });
    await screen.findByRole('region', { name: 'Pinned Evidence' });
    await screen.findByRole('region', { name: 'Graph Alerts' });
    await userEvent.click(screen.getByRole('button', { name: 'Expand Pinned Evidence' }));
    await userEvent.click(screen.getByRole('button', { name: 'Expand Graph Alerts' }));
    // Same window, new body (as a mode switch does); the store is kept.
    cleanup();
    renderGraph({ metadata });
    const pinned = await screen.findByRole('region', { name: 'Pinned Evidence' });
    expect(pinned).not.toHaveClass('is-collapsed');
    expect(pinned).toHaveTextContent('1 pinned in this graph');
    expect(await screen.findByRole('region', { name: 'Graph Alerts' })).not.toHaveClass('is-collapsed'); // open stays open
  });

  it('the card last clicked comes on top, also after a remount', async () => {
    pinEvidence([{ type: 'node', id: '2' }]);
    cacheEvidenceGraph('tr-front', { data: {}, ...graphOf(20) });
    const metadata = { evidence: { traceId: 'tr-front', reportId: 1 } };
    renderGraph({ metadata });
    const pinned = await screen.findByRole('region', { name: 'Pinned Evidence' });
    const alerts = await screen.findByRole('region', { name: 'Graph Alerts' });
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.pointerDown(pinned.querySelector('.graph_overlay_bubble'), { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(document);
    expect(pinned).toHaveClass('is-front');
    expect(alerts).not.toHaveClass('is-front');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Graph Alerts' }));
    expect(alerts).toHaveClass('is-front');
    expect(pinned).not.toHaveClass('is-front');
    cleanup();
    renderGraph({ metadata });
    expect(await screen.findByRole('region', { name: 'Graph Alerts' })).toHaveClass('is-front');
  });
});

describe('GraphWindowBody on-graph components menu', () => {
  const openMenu = () => userEvent.click(screen.getByRole('button', { name: 'On-graph components' }));
  const item = (name) => screen.getByRole('menuitemcheckbox', { name });

  it('lists the components, all shown by default', async () => {
    cacheEvidenceGraph('tr-ov1', { data: {}, ...graphOf(20) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-ov1', reportId: 1 } } });
    await screen.findByRole('note', { name: 'Relationship Types' });
    await openMenu();
    ['Minimap', 'Relationship legend', 'Graph Alerts', 'Pinned Evidence'].forEach((name) => {
      expect(item(name)).toHaveAttribute('aria-checked', 'true');
    });
    expect(canvasProps.current.showMinimap).toBe(true);
  });

  it('hides and shows the legend and the minimap, and remembers it on the device', async () => {
    cacheEvidenceGraph('tr-ov2', { data: {}, ...graphOf(20) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-ov2', reportId: 1 } } });
    await screen.findByRole('note', { name: 'Relationship Types' });
    await openMenu();
    await userEvent.click(item('Relationship legend'));
    await userEvent.click(item('Minimap'));
    expect(screen.queryByRole('note', { name: 'Relationship Types' })).not.toBeInTheDocument();
    expect(canvasProps.current.showMinimap).toBe(false);
    expect(JSON.parse(localStorage.getItem(OVERLAY_PREFS_KEY))).toMatchObject({ legend: false, minimap: false, alerts: true });
    await userEvent.click(item('Relationship legend'));
    expect(screen.getByRole('note', { name: 'Relationship Types' })).toBeInTheDocument();
  });

  it('a hidden card stays hidden after load; turning it on opens it; Run Alert Scan shows it again', async () => {
    localStorage.setItem(OVERLAY_PREFS_KEY, JSON.stringify({ alerts: false }));
    cacheEvidenceGraph('tr-ov3', { data: {}, ...graphOf(20) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-ov3', reportId: 1 } } });
    await screen.findByRole('note', { name: 'Relationship Types' });
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    expect(screen.queryByRole('region', { name: 'Graph Alerts' })).not.toBeInTheDocument();
    await openMenu();
    await userEvent.click(item('Graph Alerts'));
    expect(await screen.findByRole('region', { name: 'Graph Alerts' })).toBeInTheDocument();
    await userEvent.click(item('Graph Alerts'));
    expect(screen.queryByRole('region', { name: 'Graph Alerts' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, kind: 'canvas', id: null, selection: [] }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Alert Rules' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Run Alert Scan' }));
    expect(await screen.findByRole('region', { name: 'Graph Alerts' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(OVERLAY_PREFS_KEY)).alerts).toBe(true);
  });

  it('All hides every component, is mixed when some show, and shows them all again', async () => {
    cacheEvidenceGraph('tr-ov5', { data: {}, ...graphOf(20) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-ov5', reportId: 1 } } });
    await screen.findByRole('note', { name: 'Relationship Types' });
    await openMenu();
    expect(item('All')).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(item('All'));
    expect(item('All')).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('note', { name: 'Relationship Types' })).not.toBeInTheDocument();
    expect(canvasProps.current.showMinimap).toBe(false);
    expect(Object.values(JSON.parse(localStorage.getItem(OVERLAY_PREFS_KEY))).every((on) => on === false)).toBe(true);
    await userEvent.click(item('Minimap'));
    expect(item('All')).toHaveAttribute('aria-checked', 'mixed');
    await userEvent.click(item('All'));
    expect(item('All')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('note', { name: 'Relationship Types' })).toBeInTheDocument();
    expect(Object.values(JSON.parse(localStorage.getItem(OVERLAY_PREFS_KEY))).every((on) => on === true)).toBe(true);
  });

  it('closes on Escape', async () => {
    cacheEvidenceGraph('tr-ov4', { data: {}, ...graphOf(5) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-ov4', reportId: 1 } } });
    await screen.findByRole('note', { name: 'Relationship Types' });
    await openMenu();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'On-graph components' })).not.toBeInTheDocument();
  });
});

describe('GraphWindowBody zoom to area', () => {
  it('the toolbar tool puts a drag layer over the canvas until Escape', async () => {
    cacheEvidenceGraph('tr-zoom', { data: {}, ...graphOf(5) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-zoom', reportId: 1 } } });
    await screen.findByRole('note', { name: 'Relationship Types' });
    const tool = screen.getByRole('button', { name: 'Zoom to area' });
    await userEvent.click(tool);
    expect(tool).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/Drag a box to zoom into it/)).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(tool).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/Drag a box to zoom into it/)).not.toBeInTheDocument();
  });

  it('is unavailable on an empty window', () => {
    renderGraph({ metadata: { graphBlank: true } });
    expect(screen.getByRole('button', { name: 'Zoom to area' })).toBeDisabled();
  });
});

describe('GraphWindowBody graph editing (G3.1)', () => {
  // Node 1 linked to 2..5; all shown.
  const open = async () => {
    cacheEvidenceGraph('tr-edit', { data: {}, ...graphOf(5) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-edit', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '5'));
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const choose = async (group, name) => {
    if (group) await userEvent.click(screen.getByRole('menuitem', { name: group }));
    await userEvent.click(screen.getByRole('menuitem', { name }));
  };
  const canvas = () => screen.getByTestId('canvas');

  it('Add Node on a new graph: one node, named as production when labels are on', async () => {
    renderGraph({ metadata: { graphBlank: true, graphSettings: { showLabels: true, performance: false } } });
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await choose('Add', 'Add Node');
    await waitFor(() => expect(canvas()).toHaveAttribute('data-nodes', '1'));
    const [id] = getGraphStore('graph-1').graph().nodes();
    expect(getGraphStore('graph-1').getNode(id).label).toBe(`Node ${id}`);
    // Laid out by hand: no layout of the whole view is due.
    expect(getGraphStore('graph-1').getLayoutSignature()).not.toBe('');
  });

  it('Delete Node removes the node and its links; Undo brings them back', async () => {
    await open();
    rightClick({ kind: 'node', id: '3', selection: ['3'] });
    await choose('Edit', 'Delete Node');
    await waitFor(() => expect(canvas()).toHaveAttribute('data-nodes', '4'));
    expect(canvas()).toHaveAttribute('data-edges', '3');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(canvas()).toHaveAttribute('data-nodes', '5'));
    expect(canvas()).toHaveAttribute('data-edges', '4');
  });

  it('Unlink Node removes all of its links', async () => {
    await open();
    rightClick({ kind: 'node', id: '1', selection: ['1'] });
    await choose('Edit', 'Unlink Node');
    await waitFor(() => expect(canvas()).toHaveAttribute('data-edges', '0'));
  });

  it('Link Nodes links each unlinked pair; then the menu offers Unlink Nodes', async () => {
    await open();
    rightClick({ kind: 'node', id: '2', selection: ['2', '3', '4'] });
    await choose('Edit', 'Link Nodes');
    await waitFor(() => expect(canvas()).toHaveAttribute('data-edges', '7'));
    rightClick({ kind: 'node', id: '2', selection: ['2', '3', '4'] });
    await choose('Edit', 'Unlink Nodes');
    await waitFor(() => expect(canvas()).toHaveAttribute('data-edges', '4')); // 2-3, 2-4, 3-4 gone; hub links stay
  });

  it('Copy, then Paste on the canvas: copies with the links among them, in production\'s clipboard', async () => {
    await open();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    expect(screen.queryByRole('menuitem', { name: 'Paste' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    rightClick({ kind: 'node', id: '1', selection: ['1', '2'] });
    await choose('Edit', 'Copy Nodes/Edges');
    expect(JSON.parse(localStorage.getItem(CLIPBOARD_KEY)).nodes.map((node) => node.id)).toEqual(['1', '2']);
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await choose(null, 'Paste');
    await waitFor(() => expect(canvas()).toHaveAttribute('data-nodes', '7'));
    expect(canvas()).toHaveAttribute('data-edges', '5');
  });

  it('Bring to Front shows only the node and its neighbours, highlighted', async () => {
    await open();
    rightClick({ kind: 'node', id: '2', selection: ['2'] });
    await choose('Edit', 'Bring to Front');
    await waitFor(() => expect(canvas()).toHaveAttribute('data-nodes', '2'));
    const store = getGraphStore('graph-1');
    expect([...store.getMarkers().path.nodes]).toEqual(['2']);
    expect(store.getMarkers().path.edges.size).toBe(1);
  });
});

describe('GraphWindowBody actor profile', () => {
  it('a click on a node shows its profile: a portrait and empty details; the background, Escape and Ctrl-clicks close it', async () => {
    cacheEvidenceGraph('tr-profile', { data: {}, ...graphOf(4) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-profile', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    const tap = (target) => act(() => canvasProps.current.onElementTap(target));
    tap({ kind: 'node', id: '2', x: 40, y: 40 });
    const card = screen.getByRole('region', { name: 'Actor profile' });
    expect(within(card).getByRole('img', { name: 'No portrait' })).toBeInTheDocument();
    expect(card).not.toHaveTextContent('N2');
    ['Full name', 'ID', 'Acc No.', 'Tel', 'Address'].forEach((label) => expect(card).toHaveTextContent(label));
    expect(card.querySelectorAll('dd.is-empty')).toHaveLength(5);
    tap(null);
    expect(screen.queryByRole('region', { name: 'Actor profile' })).not.toBeInTheDocument();
    tap({ kind: 'node', id: '3', x: 40, y: 40 });
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Actor profile' })).not.toBeInTheDocument();
    tap({ kind: 'node', id: '3', x: 40, y: 40, adding: true });
    expect(screen.queryByRole('region', { name: 'Actor profile' })).not.toBeInTheDocument();
    // Moving the view lets it go.
    tap({ kind: 'node', id: '3', x: 40, y: 40 });
    act(() => canvasProps.current.onViewportChange());
    expect(screen.queryByRole('region', { name: 'Actor profile' })).not.toBeInTheDocument();
  });
});

describe('GraphWindowBody actor profile, configured', () => {
  afterEach(() => {
    localStorage.clear();
    resetProfileSettingsCache();
  });

  it('fills the details from the chosen properties, shows a portrait link, hides unticked details; off, a click shows nothing', async () => {
    cacheEvidenceGraph('tr-profile2', {
      data: {},
      nodes: [{ id: 1, label: 'A', name: 'Abebe Kebede', id_number: '1234 5678', photo: 'https://example.org/a.jpg' }, { id: 2, label: 'B' }],
      edges: [{ from: 1, to: 2 }],
    });
    const profile = {
      enabled: true,
      portraitKey: 'photo',
      fields: [{ key: 'fullName', source: 'name', shown: true }, { key: 'idNumber', source: 'id_number', shown: true }, { key: 'address', source: '', shown: false }],
    };
    // The domain's settings (bank in these tests).
    setProfileSettings('bank', profile);
    renderGraph({ metadata: { evidence: { traceId: 'tr-profile2', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '2'));
    act(() => canvasProps.current.onElementTap({ kind: 'node', id: '1', x: 40, y: 40 }));
    const card = screen.getByRole('region', { name: 'Actor profile' });
    expect(within(card).getByRole('img', { name: 'Portrait' })).toHaveAttribute('src', 'https://example.org/a.jpg');
    expect(card).toHaveTextContent('Full nameAbebe Kebede');
    expect(card).toHaveTextContent('ID1234 5678');
    expect(card).not.toHaveTextContent('Address');
    // A node without them: the sample portrait and "—".
    act(() => canvasProps.current.onElementTap({ kind: 'node', id: '2', x: 40, y: 40 }));
    expect(within(screen.getByRole('region', { name: 'Actor profile' })).getByRole('img', { name: 'No portrait' })).toBeInTheDocument();
    cleanup();
    act(() => setProfileSettings('bank', { ...profile, enabled: false }));
    renderGraph({ metadata: { evidence: { traceId: 'tr-profile2', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '2'));
    act(() => canvasProps.current.onElementTap({ kind: 'node', id: '1', x: 40, y: 40 }));
    expect(screen.queryByRole('region', { name: 'Actor profile' })).not.toBeInTheDocument();
    // Another domain keeps its own.
    expect(getProfileSettings('cdr').enabled).toBe(true);
    // On for the domain but off for this graph (Settings ▸ This graph): no card.
    cleanup();
    act(() => setProfileSettings('bank', profile));
    renderGraph({ metadata: { evidence: { traceId: 'tr-profile2', reportId: 1 }, graphSettings: { actorProfile: false } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '2'));
    act(() => canvasProps.current.onElementTap({ kind: 'node', id: '1', x: 40, y: 40 }));
    expect(screen.queryByRole('region', { name: 'Actor profile' })).not.toBeInTheDocument();
  });
});

describe('GraphWindowBody Customize popup (replaces the G3.2 adjust boxes)', () => {
  const open = async () => {
    cacheEvidenceGraph('tr-adjust', { data: {}, ...graphOf(4) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-adjust', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    return getGraphStore('graph-1');
  };
  const tap = (target) => act(() => canvasProps.current.onElementTap(target));
  const selectNodes = (store, ids) => act(() => { store.setSelection(ids); });
  const selectEdges = (keys) => act(() => canvasProps.current.onEdgeSelection(keys));
  const customize = () => screen.getByRole('button', { name: 'Customize' });

  it('the toolbar button needs a selection; clicking a node no longer opens a box', async () => {
    const store = await open();
    expect(customize()).toBeDisabled();
    tap({ kind: 'node', id: '2', x: 40, y: 40 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /adjustments/ })).not.toBeInTheDocument();
    selectNodes(store, ['2']);
    expect(customize()).toBeEnabled();
    expect(customize()).toHaveAttribute('title', 'Customize the selected 1 node');
  });

  it('options on the left, a preview on the right; nothing changes until Apply, then once (one undo step)', async () => {
    const store = await open();
    selectNodes(store, ['2', '3']);
    await userEvent.click(customize());
    const dialog = screen.getByRole('dialog', { name: 'Customize node' });
    expect(dialog).toHaveTextContent('2 selected');
    expect(screen.getByRole('img', { name: 'Node preview' })).toBeInTheDocument();
    const label = screen.getByRole('textbox', { name: 'Node label' });
    expect(label).toHaveValue('N2');
    await userEvent.clear(label);
    await userEvent.type(label, 'Renamed');
    await userEvent.type(screen.getByRole('textbox', { name: 'Note' }), 'seen twice');
    fireEvent.change(screen.getByRole('slider', { name: 'Node size' }), { target: { value: '25' } });
    await userEvent.click(screen.getByRole('button', { name: 'Colour #DC143C' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Diamond' }));
    // The icons open in a popover from the icon button; Escape closes it
    // (not the popup); picking one closes it.
    await userEvent.click(screen.getByRole('button', { name: 'Choose an icon' }));
    expect(screen.getByRole('dialog', { name: 'Choose an icon' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Choose an icon' })).not.toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose an icon' }));
    await userEvent.click(screen.getByRole('option', { name: 'Bank' }));
    expect(screen.queryByRole('dialog', { name: 'Choose an icon' })).not.toBeInTheDocument();
    // The preview follows; the graph does not yet.
    expect(screen.getByRole('img', { name: 'Node preview' }).querySelector('path').style.fill).toBe('#DC143C');
    expect(screen.getByRole('img', { name: 'Node preview' })).toHaveTextContent('Renamed');
    expect(store.getNode('2').label).toBe('N2');
    expect(dialog).toHaveTextContent('6 changes to apply');
    // Held down, the preview shows the current look.
    const stage = screen.getByLabelText(/Preview: hold to compare/);
    expect(dialog).toHaveTextContent('Click and hold on the preview to compare');
    fireEvent.pointerDown(stage);
    expect(dialog).toHaveTextContent('Old look');
    expect(screen.getByRole('img', { name: 'Node preview' })).toHaveTextContent('N2');
    fireEvent.pointerUp(stage);
    expect(screen.getByRole('img', { name: 'Node preview' })).toHaveTextContent('Renamed');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    ['2', '3'].forEach((id) => expect(store.getNode(id)).toMatchObject({
      label: 'Renamed', note: 'seen twice', size: 25, baseColor: '#DC143C', shape: 'diamond', iconPath: '../graph_icons/Bank.svg',
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(store.getNode('2')).toMatchObject({ label: 'N2' });
    expect(store.getNode('2').baseColor).toBeUndefined();
  });

  it('Cancel, Escape and the backdrop close it without changes; Reset restores the options', async () => {
    const store = await open();
    selectNodes(store, ['1']);
    await userEvent.click(customize());
    await userEvent.click(screen.getByRole('button', { name: 'Colour #32CD32' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Colour #32CD32' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(store.getNode('1').baseColor).toBeUndefined();
    await userEvent.click(customize());
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('paints the border alone (the fill stays the theme\'s), and a later fill keeps it', async () => {
    const store = await open();
    selectNodes(store, ['1']);
    await userEvent.click(customize());
    await userEvent.click(screen.getByRole('radio', { name: 'Border' }));
    expect(screen.getByRole('radio', { name: 'Border' })).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Colour #7851A9' }));
    expect(screen.getByRole('radio', { name: 'Border' })).toHaveTextContent('#7851A9');
    expect(screen.getByRole('radio', { name: 'Fill' })).toHaveTextContent('Theme');
    expect(screen.getByRole('img', { name: 'Node preview' }).querySelector('.graph_customize_subject circle').style.stroke).toBe('#7851A9');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getNode('1')).toMatchObject({ borderColor: '#7851A9', color: { background: 'rgba(0,0,0,0)', border: '#7851A9' } });
    expect(store.getNode('1').baseColor).toBeUndefined();
    // Then the fill alone: the border stays.
    await userEvent.click(customize());
    expect(screen.getByRole('radio', { name: 'Border' })).toHaveTextContent('#7851A9');
    await userEvent.click(screen.getByRole('button', { name: 'Colour #32CD32' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getNode('1')).toMatchObject({ baseColor: '#32CD32', color: { background: '#32CD32', border: '#7851A9' } });
    // Auto border: back to the one worked out from the fill.
    await userEvent.click(customize());
    await userEvent.click(screen.getByRole('radio', { name: 'Border' }));
    await userEvent.click(screen.getByRole('button', { name: 'Auto' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getNode('1')).toMatchObject({ borderColor: null, color: { background: '#32CD32', border: '#28a428' } });
  });

  it('removes an icon', async () => {
    const store = await open();
    act(() => { store.updateNodes([['2', { shape: 'circularImage', image: '../graph_icons/Bank.svg', iconPath: '../graph_icons/Bank.svg' }]]); });
    selectNodes(store, ['2']);
    await userEvent.click(customize());
    await userEvent.click(screen.getByRole('button', { name: 'Remove icon' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getNode('2')).toMatchObject({ shape: 'dot', image: null, iconPath: null });
  });

  it('"link" colour effect colours the neighbours and the links among them', async () => {
    const store = await open();
    selectNodes(store, ['1']);
    await userEvent.click(customize());
    await userEvent.click(screen.getByRole('radio', { name: 'Link' }));
    await userEvent.click(screen.getByRole('button', { name: 'Colour #32CD32' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    ['1', '2', '3', '4'].forEach((id) => expect(store.getNode(id).baseColor).toBe('#32CD32'));
    store.graph().forEachEdge((key, attributes) => expect(attributes.__edits.color).toBe('#32CD32'));
  });

  it('customizes the selected links: label, colour, style and width, with a link preview', async () => {
    const store = await open();
    const [key] = store.graph().edges();
    selectEdges([key]);
    await userEvent.click(customize());
    expect(screen.getByRole('dialog', { name: 'Customize link' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Link preview' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Link label' }), 'wire');
    await userEvent.click(screen.getByRole('radio', { name: 'Dotted' }));
    fireEvent.change(screen.getByRole('slider', { name: 'Link width' }), { target: { value: '4' } });
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getEdge(key)).toMatchObject({ label: 'wire', edgeStyle: 'dotted', dashes: [2, 6], width: 4 });
  });

  it('with nodes and links selected, Node / Link tabs switch; Apply covers both', async () => {
    const store = await open();
    const [key] = store.graph().edges();
    selectNodes(store, ['4']);
    selectEdges([key]);
    await userEvent.click(customize());
    await userEvent.click(screen.getByRole('button', { name: 'Colour #00BFFF' }));
    await userEvent.click(screen.getByRole('tab', { name: /Link/ }));
    expect(screen.getByRole('dialog', { name: 'Customize link' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Dashed' }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(store.getNode('4').baseColor).toBe('#00BFFF');
    expect(store.getEdge(key).edgeStyle).toBe('dashed');
  });
});

describe('GraphWindowBody annotations (G3.3)', () => {
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const tap = (target) => act(() => canvasProps.current.onElementTap(target));
  const add = async (name, text) => {
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add' }));
    await userEvent.click(screen.getByRole('menuitem', { name }));
    const field = screen.getByRole('textbox');
    if (text !== undefined) {
      await userEvent.clear(field);
      await userEvent.type(field, text);
    }
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
  };
  const blank = () => {
    renderGraph({ metadata: { graphBlank: true } });
    return getGraphStore('graph-1');
  };
  const only = (store) => store.getNode(store.graph().nodes().at(-1));

  it('adds each annotation with production\'s prompt and default text', async () => {
    const store = blank();
    await add('Label');
    expect(only(store)).toMatchObject({ annotationType: 'label', label: 'Label', shape: 'text' });
    expect(store.graph().nodes().at(-1)).toMatch(/^anno_/);
    await add('Comment Box', 'Look here');
    expect(only(store)).toMatchObject({ annotationType: 'comment_box', label: 'Look here', note: 'Look here' });
    await add('Text Block');
    expect(only(store)).toMatchObject({ annotationType: 'text_block', label: 'Analyst note' });
    await add('Event Frame');
    expect(only(store)).toMatchObject({ annotationType: 'event_frame', label: 'Event Frame' });
    await add('OLE Object');
    expect(only(store)).toMatchObject({ annotationType: 'ole_object', label: 'External Object', shape: 'image' });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '5'));
  });

  it('Theme Line joins the selected nodes left to right', async () => {
    cacheEvidenceGraph('tr-theme', { data: {}, nodes: [1, 2, 3].map((id) => ({ id, label: `N${id}` })), edges: [] });
    renderGraph({ metadata: { evidence: { traceId: 'tr-theme', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3'));
    const store = getGraphStore('graph-1');
    store.setPositions([['1', { x: 50, y: 0 }], ['2', { x: 0, y: 0 }], ['3', { x: 100, y: 0 }]]);
    rightClick({ kind: 'node', id: '1', selection: ['1', '2', '3'] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Theme Line' }));
    const graph = store.graph();
    expect(graph.size).toBe(2);
    expect(graph.edges('2', '1')).toHaveLength(1);
    expect(graph.edges('1', '3')).toHaveLength(1);
    expect(graph.getEdgeAttributes(graph.edges('2', '1')[0])).toMatchObject({ edge_kind: 'theme_line', label: 'Theme' });
  });

  it('an annotation opens its own box; the label box changes text and font', async () => {
    const store = blank();
    await add('Label', 'Hello');
    const id = store.graph().nodes()[0];
    tap({ kind: 'node', id, x: 30, y: 30 });
    expect(screen.getByRole('region', { name: 'Label adjustments' })).toBeInTheDocument();
    const text = screen.getByRole('textbox', { name: 'Label text' });
    await userEvent.clear(text);
    await userEvent.type(text, 'Bye{Enter}');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Font family' }), 'Arial');
    expect(store.getNode(id)).toMatchObject({ label: 'Bye', font: { face: 'Arial', size: 18 } });
  });

  it('the event frame box sets date and types; the note box sets the text', async () => {
    const store = blank();
    await add('Event Frame');
    const frame = store.graph().nodes()[0];
    tap({ kind: 'node', id: frame, x: 30, y: 30 });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Payment' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Meeting' }));
    expect(store.getNode(frame).eventTypes).toEqual(['meeting', 'payment']);
    const when = screen.getByLabelText('Date and time');
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(when, '2026-11-15T09:30');
      when.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(store.getNode(frame).eventDateTime).toBe(new Date('2026-11-15T09:30').toISOString());
    await userEvent.keyboard('{Escape}');
    await add('Comment Box');
    const comment = store.graph().nodes().at(-1);
    tap({ kind: 'node', id: comment, x: 30, y: 30 });
    expect(screen.getByRole('region', { name: 'Comment Box adjustments' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Text' }), ' more');
    await userEvent.tab();
    expect(store.getNode(comment).note).toBe('New comment more');
  });

  it('the object box keeps a link (naming it) and double-click opens it', async () => {
    const store = blank();
    await add('OLE Object');
    const id = store.graph().nodes()[0];
    tap({ kind: 'node', id, x: 30, y: 30 });
    await userEvent.type(screen.getByRole('textbox', { name: 'Attached link' }), 'example.com/files/photo.png{Enter}');
    expect(store.getNode(id)).toMatchObject({ attachmentLink: 'example.com/files/photo.png', attachmentName: 'photo.png' });
    expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'https://example.com/files/photo.png');
    const clicks = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { clicks.push(this.href); });
    act(() => canvasProps.current.onNodeDoubleClick(id));
    expect(clicks).toEqual(['https://example.com/files/photo.png']);
    spy.mockRestore();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(store.getNode(id).attachmentLink).toBe('');
  });
});

describe('GraphWindowBody group / ungroup / merge (G3.4)', () => {
  // Node 1 linked to 2..5; all shown.
  const open = async () => {
    cacheEvidenceGraph('tr-group', { data: {}, nodes: [1, 2, 3, 4, 5].map((id) => ({ id, label: `N${id}`, amount: id * 10 })), edges: [2, 3, 4, 5].map((to) => ({ from: 1, to })) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-group', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '5'));
    return getGraphStore('graph-1');
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const choose = async (group, name) => {
    await userEvent.click(screen.getByRole('menuitem', { name: group }));
    await userEvent.click(screen.getByRole('menuitem', { name }));
  };

  it('Group Nodes, then Ungroup on the group node', async () => {
    const store = await open();
    rightClick({ kind: 'node', id: '2', selection: ['2', '3'] });
    await choose('Edit', 'Group Nodes');
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    const groupId = store.graph().nodes().find((id) => id.startsWith('Group'));
    expect(store.getNode(groupId).members).toHaveLength(2);
    rightClick({ kind: 'node', id: groupId, selection: [groupId] });
    await choose('Edit', 'Ungroup');
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '5'));
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-edges', '4');
  });

  it('Merge Nodes asks which properties and the prefix, then keeps the first node', async () => {
    const store = await open();
    rightClick({ kind: 'node', id: '2', selection: ['2', '3', '4'] });
    await choose('Edit', 'Merge Nodes');
    expect(screen.getByText(/“N2” is kept\. Properties of the others: amount/)).toBeInTheDocument();
    const prefix = screen.getByRole('textbox', { name: /Derived property variable/ });
    await userEvent.clear(prefix);
    await userEvent.type(prefix, 'mx');
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3'));
    expect(store.getNode('2')).toMatchObject({ merged_from: ['3', '4'], merge_count: 3, mx_amount: 30, mx_amount_2: 40 });
  });

  it('Merge needs a prefix', async () => {
    const store = await open();
    rightClick({ kind: 'node', id: '2', selection: ['2', '3'] });
    await choose('Edit', 'Merge Nodes');
    await userEvent.clear(screen.getByRole('textbox', { name: /Derived property variable/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    expect(store.getNode('3')).not.toBeNull();
    expect(await screen.findByText(/Variable name is required/)).toBeInTheDocument();
  });
});

describe('GraphWindowBody Merged & Grouped card', () => {
  const open = async () => {
    cacheEvidenceGraph('tr-combined', { data: {}, nodes: [1, 2, 3, 4, 5].map((id) => ({ id, label: `N${id}` })), edges: [2, 3, 4, 5].map((to) => ({ from: 1, to })) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-combined', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '5'));
    return getGraphStore('graph-1');
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const choose = async (group, name) => {
    await userEvent.click(screen.getByRole('menuitem', { name: group }));
    await userEvent.click(screen.getByRole('menuitem', { name }));
  };

  it('stays closed while nothing is merged or grouped', async () => {
    await open();
    await new Promise((resolve) => { setTimeout(resolve, 250); });
    expect(screen.queryByRole('region', { name: 'Merged & Grouped' })).not.toBeInTheDocument();
  });

  it('opens in front when nodes are grouped or merged, listing each with its members', async () => {
    const store = await open();
    rightClick({ kind: 'node', id: '2', selection: ['2', '3'] });
    await choose('Edit', 'Group Nodes');
    const card = await screen.findByRole('region', { name: 'Merged & Grouped' });
    expect(card).toHaveClass('is-front');
    await userEvent.click(screen.getByRole('button', { name: 'Expand Merged & Grouped' }));
    expect(card).toHaveTextContent('1 grouped');
    expect(card).toHaveTextContent('2 members');
    expect(card).toHaveTextContent('N2, N3');
    rightClick({ kind: 'node', id: '4', selection: ['4', '5'] });
    await choose('Edit', 'Merge Nodes');
    await userEvent.click(screen.getByRole('button', { name: 'Merge' }));
    await waitFor(() => expect(card).toHaveTextContent('1 grouped · 1 merged'));
    expect(card).toHaveTextContent('2 nodes merged');
    expect(card).toHaveTextContent('Merged from 5');
    // Ungroup from the card.
    await userEvent.click(screen.getByRole('button', { name: 'Ungroup Group' }));
    await waitFor(() => expect(card).toHaveTextContent('1 merged'));
    expect(store.getNode('2')).not.toBeNull();
  });

  it('can be hidden from the On-graph components menu', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'On-graph components' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Merged & Grouped' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('GraphWindowBody edge bundling (G3.5)', () => {
  it('Enable / Disable Edge Bundling and Configure set the window settings', async () => {
    cacheEvidenceGraph('tr-bundle', { data: {}, ...graphOf(4) });
    render(
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch: vi.fn(), configuration: { active_domain: 'bank' } }}>
          <WorkspaceProvider>
            <LiveGraph metadata={{ evidence: { traceId: 'tr-bundle', reportId: 1 } }} />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    const rightClick = () => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, kind: 'canvas', id: null, selection: [] }));
    rightClick();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edge Bundling' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Enable Edge Bundling' }));
    await waitFor(() => expect(canvasProps.current.settings.edgeBundling).toBe(true));
    rightClick();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edge Bundling' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Configure Edge Bundling' }));
    const field = screen.getByRole('spinbutton', { name: /Minimum parallel edges/ });
    await userEvent.clear(field);
    await userEvent.type(field, '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(canvasProps.current.settings.edgeBundleMin).toBe(3));
    rightClick();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Edge Bundling' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Disable Edge Bundling' }));
    await waitFor(() => expect(canvasProps.current.settings.edgeBundling).toBe(false));
  });
});

describe('GraphWindowBody selection tools (G3.6)', () => {
  // 1 linked to 2..5; 5 is a Source Node.
  const open = async () => {
    cacheEvidenceGraph('tr-select', {
      data: {},
      nodes: [1, 2, 3, 4, 5].map((id) => ({ id, label: `N${id}`, city: id % 2 ? 'Addis' : 'Adama', node_identity: id === 5 ? 'Source Node' : 'Entity Node' })),
      edges: [2, 3, 4, 5].map((to) => ({ from: 1, to })),
    });
    renderGraph({ metadata: { evidence: { traceId: 'tr-select', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '5'));
  };
  const rightClick = (request) => act(() => canvasProps.current.onContextMenu({ x: 20, y: 20, ...request }));
  const choose = async (name) => {
    await userEvent.click(screen.getByRole('menuitem', { name: 'Select' }));
    await userEvent.click(screen.getByRole('menuitem', { name }));
  };

  it('Hide Node hides it; Show Hidden Nodes (n) brings it back', async () => {
    await open();
    rightClick({ kind: 'node', id: '3', selection: ['3'] });
    await choose('Hide Node');
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await choose('Show Hidden Nodes (1)');
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '5'));
  });

  it('Show Hidden Nodes is off while nothing is hidden; Select Link Ends needs selected links', async () => {
    await open();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await userEvent.click(screen.getByRole('menuitem', { name: 'Select' }));
    expect(screen.getByRole('menuitem', { name: 'Show Hidden Nodes' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Select Link Ends' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Select All' })).toHaveAttribute('aria-disabled', 'false');
  });

  it('Select by Type lists the drawn types with counts', async () => {
    await open();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await choose('Select by Type…');
    expect(screen.getByRole('checkbox', { name: /Entity Node \(4\)/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Source Node \(1\)/ })).toBeInTheDocument();
  });

  it('Select by Property reports how many drawn nodes match', async () => {
    await open();
    rightClick({ kind: 'canvas', id: null, selection: [] });
    await choose('Select by Property…');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Property' }), 'city');
    await userEvent.type(screen.getByRole('textbox', { name: 'Value contains' }), 'addis');
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    expect(await screen.findByText('3 node(s) selected.')).toBeInTheDocument();
  });
});

describe('GraphWindowBody timeline filter (i2 benchmark #1)', () => {
  const open = async () => {
    cacheEvidenceGraph('tr-time', {
      data: {},
      nodes: [1, 2, 3, 4].map((id) => ({ id, label: `N${id}`, TRANSACTIONDATE: `2026-03-0${id}` })),
      edges: [{ from: 1, to: 2 }, { from: 3, to: 4 }],
    });
    renderGraph({ metadata: { evidence: { traceId: 'tr-time', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
  };
  if (!window.PointerEvent) window.PointerEvent = class extends MouseEvent {};

  it('is always there, collapsed, at 0.5x; the toolbar button expands it', async () => {
    await open();
    const strip = screen.getByRole('region', { name: 'Timeline' });
    expect(screen.queryByRole('img', { name: /Histogram/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Play speed' })).toHaveValue('0.5');
    expect(screen.queryByRole('button', { name: 'Close timeline' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByRole('img', { name: /Histogram/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Date field' })).toHaveValue('TRANSACTIONDATE');
    expect(screen.getByRole('img', { name: /Histogram/ })).toHaveAccessibleName(/by hour/);
    expect(strip.querySelector('.graph_timeline_summary')).toBeNull();
  });

  it('dragging across the bars keeps only that period; Reset shows all again', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    const bars = screen.getByRole('img', { name: /Histogram/ });
    bars.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 56, right: 1000, bottom: 56 });
    const { fireEvent } = await import('@testing-library/react');
    const count = bars.querySelectorAll('rect').length; // hourly bars over three days
    fireEvent.pointerDown(bars, { button: 0, clientX: 0 });
    fireEvent.pointerUp(bars, { clientX: Math.floor(1000 / count) * 30 }); // the first ~day
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '2'));
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveClass('is-filtering');
    expect(screen.getByRole('status', { name: 'Timeline period' })).toHaveTextContent(/Mar/);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    expect(screen.queryByRole('status', { name: 'Timeline period' })).not.toBeInTheDocument();
  });

  it('the fold button expands and collapses it to its header', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Expand timeline' }));
    expect(screen.getByRole('img', { name: /Histogram/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Collapse timeline' }));
    expect(screen.queryByRole('img', { name: /Histogram/ })).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Date field' })).toBeInTheDocument();
  });

  const openDaily = async (traceId) => {
    cacheEvidenceGraph(traceId, {
      data: {},
      nodes: ['01', '03', '05', '08'].map((day, index) => ({ id: index + 1, label: `N${index + 1}`, TRANSACTIONDATE: `2026-03-${day}` })),
      edges: [{ from: 1, to: 2 }, { from: 3, to: 4 }],
    });
    renderGraph({ metadata: { evidence: { traceId, reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
  };

  it('plays at the chosen speed and resets to all dates at the end', async () => {
    await openDaily('tr-play');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Play speed' }), '4');
    expect(screen.getByRole('checkbox', { name: 'Auto reset' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Timeline' })).toHaveClass('is-filtering'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByRole('button', { name: 'Timeline' })).not.toHaveClass('is-filtering');
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4');
  });

  it('Slice by changes the bars: daily, weekly, monthly…', async () => {
    await openDaily('tr-slice');
    const bars = () => screen.getByRole('img', { name: /Histogram/ });
    expect(bars()).toHaveAccessibleName(/by day/);
    expect(bars().querySelectorAll('rect')).toHaveLength(8); // 1-8 March
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Slice by' }), 'week');
    expect(bars()).toHaveAccessibleName(/by week/);
    expect(bars().querySelectorAll('rect')).toHaveLength(2); // weeks of 23 Feb and 2 Mar
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Slice by' }), 'quarter');
    expect(bars().querySelectorAll('rect')).toHaveLength(1);
    expect(bars()).toHaveAccessibleName(/by quarter/);
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Slice by' }), 'auto');
    expect(bars()).toHaveAccessibleName(/by day/);
  });

  it('Previous / Next step through the dated periods while paused', async () => {
    await openDaily('tr-step');
    const period = () => screen.getByRole('status', { name: 'Timeline period' }).textContent;
    const day = () => Number(period().match(/\b(\d{1,2})\b/)[1]);
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(day()).toBe(1);
    expect(screen.getByRole('button', { name: 'Previous period' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(day()).toBe(3); // the empty 2 March is skipped
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '1');
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next period' }));
    expect(day()).toBe(8);
    expect(screen.getByRole('button', { name: 'Next period' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Previous period' }));
    expect(day()).toBe(5);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(); // still paused
  });

  it('Play skips the bars with nothing dated in them', async () => {
    await openDaily('tr-skip');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Play speed' }), '4');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto reset' }));
    const periods = [];
    const observer = new MutationObserver(() => {
      const title = screen.queryByRole('status', { name: 'Timeline period' });
      if (title && periods[periods.length - 1] !== title.textContent) periods.push(title.textContent);
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(), { timeout: 4000 });
    observer.disconnect();
    expect(periods).toHaveLength(4); // 1, 3, 5 and 8 March, not the 8 days between
    expect(periods.map((text) => Number(text.match(/\b(\d{1,2})\b/)[1]))).toEqual([1, 3, 5, 8]);
  });

  it('without Auto reset, Play stops on the last period', async () => {
    await openDaily('tr-noreset');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Play speed' }), '4');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Auto reset' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.getByRole('button', { name: 'Timeline' })).toHaveClass('is-filtering');
    expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '1');
  });

  it('Autoplay starts Play at once and again whenever the timeline is expanded', async () => {
    await openDaily('tr-autoplay');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Autoplay' }));
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    await userEvent.click(screen.getByRole('button', { name: 'Timeline' }));
    expect(screen.getByRole('checkbox', { name: 'Autoplay' })).toBeChecked();
    expect(await screen.findByRole('button', { name: 'Pause' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
  });

  it('Play and the expanded strip carry on across a remount (docked <-> floating)', async () => {
    await openDaily('tr-play-remount');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Autoplay' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Timeline' })).toHaveClass('is-filtering'), { timeout: 3000 });
    cleanup();
    renderGraph({ metadata: { evidence: { traceId: 'tr-play-remount', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '1'), { timeout: 3000 });
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Histogram/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
  });

  it('says so when the graph has no dates', async () => {
    cacheEvidenceGraph('tr-nodate', { data: {}, ...graphOf(3) });
    renderGraph({ metadata: { evidence: { traceId: 'tr-nodate', reportId: 1 } } });
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3'));
    expect(screen.getByText('No dates found on the shown nodes or links.')).toBeInTheDocument();
  });
});
