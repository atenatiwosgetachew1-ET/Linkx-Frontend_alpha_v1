// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { cacheEvidenceGraph, clearEvidenceGraphs } from '../../reports/lib/evidenceGraphs.js';
import { clearGraphStores, getGraphStore, hasGraphStore } from '../lib/graphStore.js';
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
    expect(screen.getByRole('group', { name: 'Graph relationships' })).toBeInTheDocument();
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

  it('shows the relationship chips from the status socket and loads one', async () => {
    const socket = statusSocket();
    const apiFetch = vi.fn(async () => ({ results: { graph: graphOf(4) } }));
    openLinked(apiFetch);
    expect(screen.getByText('Waiting for the linked session')).toBeInTheDocument();
    act(() => socket.receive('status', { session_id: '3_17', type: 'relationships', data: [{ type: 'FUND_FLOW', bgcolor: '#2563eb' }] }));
    expect(screen.getByText('Choose a relationship')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'FUND_FLOW' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '4'));
    expect(apiFetch).toHaveBeenCalledWith('/get_graph', expect.objectContaining({ body: { id: 'relationship', source_id: '3_17', relationship: 'FUND_FLOW' } }));
    expect(screen.getByRole('button', { name: 'FUND_FLOW' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the window when a relationship has no data', async () => {
    const socket = statusSocket();
    openLinked(vi.fn(async () => ({ results: { graph: { nodes: [], edges: [] } } })));
    act(() => socket.receive('status', { session_id: '3_17', type: 'relationships', data: ['SMURFING'] }));
    await userEvent.click(screen.getByRole('button', { name: 'All (*)' }));
    expect(await screen.findByText('No graph data found for this session.')).toBeInTheDocument();
    expect(workspaceRef.windows.map((item) => item.id)).toContain('graph-7');
  });

  it('unlinks but keeps the graph when the source is terminated; resets when it is closed', async () => {
    const socket = statusSocket();
    openLinked(vi.fn(async () => ({ results: { graph: graphOf(3) } })));
    act(() => socket.receive('status', { session_id: '3_17', type: 'relationships', data: ['A'] }));
    await userEvent.click(screen.getByRole('button', { name: 'A' }));
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
    expect(screen.getByRole('menuitem', { name: 'Delete Node' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', { name: 'Delete Node' })).toHaveAttribute('title', 'Coming with graph editing.');
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
