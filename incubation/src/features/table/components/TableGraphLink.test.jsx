// @vitest-environment jsdom
// A real Graph window and its Table window together, floating (both
// mounted) and docked (only the active window mounted).
import React, { useEffect, useImperativeHandle } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { cacheEvidenceGraph, clearEvidenceGraphs } from '../../reports/lib/evidenceGraphs.js';
import { clearGraphStores, getGraphStore } from '../../graph/lib/graphStore.js';
import { resetGraphLinkBus } from '../../graph/lib/graphLinkBus.js';

// The canvas: selecting puts the nodes in the store and reports the links,
// as Cytoscape's select events do.
const focused = vi.fn();
vi.mock('../../graph/components/GraphCanvas.jsx', () => ({
  default: React.forwardRef(function CanvasProbe(props, ref) {
    useImperativeHandle(ref, () => ({
      select: (ids) => {
        props.store.setSelection(ids.filter((id) => props.store.graph().hasNode(id)));
        props.onEdgeSelection?.(ids.filter((id) => props.store.graph().hasEdge(id)));
      },
      focusOn: (ids) => focused(ids),
      focus: () => {},
      fit: () => {},
    }));
    return <div data-testid="canvas" data-nodes={props.view.nodeIds.length} />;
  }),
}));
vi.mock('../../../shared/device/gpuCapability.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGpuCapability: vi.fn(() => ({ verdict: 'capable', reasons: [] })),
}));

const { default: GraphWindowBody } = await import('../../graph/components/GraphWindowBody.jsx');
const { default: TableWindowBody } = await import('./TableWindowBody.jsx');

afterEach(() => {
  cleanup();
  clearGraphStores();
  clearEvidenceGraphs();
  resetGraphLinkBus();
  localStorage.clear();
  focused.mockReset();
});

const GRAPH = {
  nodes: [{ id: 1, label: 'Abebe' }, { id: 2, label: 'Bekele' }, { id: 3, label: 'Chala' }],
  edges: [{ from: 1, to: 2, label: 'paid' }, { from: 2, to: 3, label: 'called' }],
};

let workspaceRef;
function Windows({ docked }) {
  workspaceRef = useWorkspace();
  const { windows, activeWindowId, openWindow } = workspaceRef;
  useEffect(() => {
    openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id: 'graph-1', title: 'Graph', metadata: { evidence: { traceId: 'tr-link', reportId: 1 } } });
  }, [openWindow]);
  const shown = docked ? windows.filter((item) => item.id === activeWindowId) : windows;
  return shown.map((item) => (
    <section key={item.id} aria-label={item.id}>
      {item.type === WORKSPACE_WINDOW_TYPES.GRAPH ? <GraphWindowBody windowItem={item} /> : <TableWindowBody windowItem={item} />}
    </section>
  ));
}

const open = async ({ docked = false } = {}) => {
  cacheEvidenceGraph('tr-link', { data: {}, ...GRAPH });
  render(
    <NotificationProvider>
      <SessionContext.Provider value={{ apiFetch: vi.fn(), configuration: { active_domain: 'bank' } }}>
        <WorkspaceProvider>
          <Windows docked={docked} />
        </WorkspaceProvider>
      </SessionContext.Provider>
    </NotificationProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3'));
  await userEvent.click(screen.getByRole('button', { name: 'Open as table' }));
  return screen.findByRole('grid', { name: 'Nodes' });
};

const rows = () => within(screen.getByRole('grid')).getAllByRole('row').slice(1);

describe('Table window linked to a Graph window', () => {
  it('floating: rows follow the graph; a row click selects on the graph, a graph selection marks the row', async () => {
    await open();
    expect(rows().map((row) => within(row).getAllByRole('gridcell')[0].textContent)).toEqual(['Abebe', 'Bekele', 'Chala']);
    await userEvent.click(rows()[1]);
    await waitFor(() => expect(getGraphStore('graph-1').getSnapshot().selection).toEqual(['2']));
    await waitFor(() => expect(rows()[1]).toHaveAttribute('aria-selected', 'true'));
    // Selected on the graph.
    act(() => getGraphStore('graph-1').setSelection(['3']));
    await waitFor(() => expect(rows()[2]).toHaveAttribute('aria-selected', 'true'));
    expect(rows()[1]).toHaveAttribute('aria-selected', 'false');
    // Double-click focuses it there.
    await userEvent.dblClick(rows()[0]);
    await waitFor(() => expect(focused).toHaveBeenCalledWith(['1']));
    // A data change on the graph shows at once.
    act(() => getGraphStore('graph-1').updateNodes([['1', { label: 'Abebe K.' }]]));
    await waitFor(() => expect(within(rows()[0]).getAllByRole('gridcell')[0]).toHaveTextContent('Abebe K.'));
  });

  it('floating: a link row selects the link on the graph', async () => {
    await open();
    await userEvent.click(screen.getByRole('tab', { name: /Links/ }));
    await userEvent.click(rows()[0]);
    await waitFor(() => expect(rows()[0]).toHaveAttribute('aria-selected', 'true'));
  });

  it('docked: the graph is not mounted while the table is shown; the selection waits for it, a focus brings it up', async () => {
    await open({ docked: true });
    expect(screen.queryByTestId('canvas')).not.toBeInTheDocument();
    await userEvent.click(rows()[2]);
    // Shown here at once, applied on the graph when it is back.
    expect(rows()[2]).toHaveAttribute('aria-selected', 'true');
    await userEvent.dblClick(rows()[0]);
    expect(await screen.findByTestId('canvas')).toBeInTheDocument();
    expect(workspaceRef.activeWindowId).toBe('graph-1');
    await waitFor(() => expect(getGraphStore('graph-1').getSnapshot().selection).toEqual(['1']));
    await waitFor(() => expect(focused).toHaveBeenCalledWith(['1']));
  });
});
