// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { NotificationProvider } from '../../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../../shared/session/sessionContext.js';
import { WorkspaceProvider } from '../../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../../workspace/state/workspaceTypes.js';
import { clearGraphStores, getGraphStore } from '../../lib/graphStore.js';
import GraphInfoTab from '../../../../workspace/components/right/GraphInfoTab.jsx';
import GraphFilterTab from '../../../../workspace/components/right/GraphFilterTab.jsx';

vi.mock('../GraphCanvas.jsx', () => ({
  default: React.forwardRef(function GraphCanvasProbe({ view }) {
    return <div data-testid="canvas" data-nodes={view.nodeIds.join(',')} />;
  }),
}));
// The Settings tab also renders the theme sections; only "This graph" is under test.
vi.mock('../../../../workspace/components/right/WorkspaceSettingsTab.jsx', async () => {
  const { useActiveGraph } = await import('../../lib/useActiveGraph.js');
  const { GraphSettingsPanel } = await import('./GraphPanels.jsx');
  function GraphSettingsOnly({ workspace }) {
    const graph = useActiveGraph(workspace);
    return graph.windowItem ? <GraphSettingsPanel graph={graph} /> : null;
  }
  return { default: GraphSettingsOnly };
});

const { default: GraphWindowBody } = await import('../GraphWindowBody.jsx');
const { default: WorkspaceSettingsTab } = await import('../../../../workspace/components/right/WorkspaceSettingsTab.jsx');

afterEach(() => {
  cleanup();
  clearGraphStores();
});

const NODES = [
  { id: 1, label: 'A', name: 'Abebe', amount: 500, node_identity: 'Entity Node', color: '#fff' },
  { id: 2, label: 'B', name: 'Kebede', amount: 1500, node_identity: 'Entity Node' },
  { id: 3, label: 'C', name: 'Almaz', amount: 2500, node_identity: 'Source Node' },
];

let workspaceRef;
function Shell({ tab }) {
  const workspace = useWorkspace();
  workspaceRef = workspace;
  const graphs = workspace.windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.GRAPH);
  const Tab = { info: GraphInfoTab, filter: GraphFilterTab, settings: WorkspaceSettingsTab }[tab];
  return (
    <>
      {graphs.map((item) => <GraphWindowBody key={item.id} windowItem={item} />)}
      <aside aria-label="Right panel"><Tab workspace={workspace} /></aside>
    </>
  );
}

const setup = (tab) => {
  getGraphStore('graph-1').replace({ nodes: NODES, edges: [{ from: 1, to: 2 }, { from: 2, to: 3 }] });
  render(
    <NotificationProvider>
      <SessionContext.Provider value={{ apiFetch: vi.fn(), configuration: { active_domain: 'bank' } }}>
        <WorkspaceProvider>
          <Shell tab={tab} />
        </WorkspaceProvider>
      </SessionContext.Provider>
    </NotificationProvider>,
  );
  act(() => {
    workspaceRef.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id: 'graph-1', title: 'Graph', customTitle: 'Evidence R-1', metadata: { evidence: { traceId: 't1', reportId: 7 } } });
  });
  return within(screen.getByRole('complementary', { name: 'Right panel' }));
};

describe('right panel bound to the active Graph window', () => {
  it('Info: names the window, describes its source and shows the selected node', () => {
    const panel = setup('info');
    expect(panel.getAllByText(/Graph 1 · Evidence R-1/).length).toBeGreaterThan(0);
    expect(panel.getByText('Evidence report')).toBeInTheDocument();
    expect(panel.getByText('No information to show. Select a node in the graph.')).toBeInTheDocument();
    act(() => getGraphStore('graph-1').setSelection(['3']));
    expect(panel.getByText('Almaz')).toBeInTheDocument();
    expect(panel.queryByText('#fff')).not.toBeInTheDocument();
  });

  it('Filter: a search replaces the view and reports the counts', async () => {
    const panel = setup('filter');
    await userEvent.type(panel.getByRole('textbox'), '>1000');
    await userEvent.click(panel.getByRole('checkbox', { name: 'amount' }));
    await userEvent.click(panel.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '2,3'));
    expect(panel.getByRole('status')).toHaveTextContent('Nodes found: 2 · Edges found: 1');
    await userEvent.click(panel.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '1,2,3'));
  });

  it('Settings: the actor profile card can be turned off for this graph', async () => {
    const panel = setup('settings');
    const box = panel.getByRole('checkbox', { name: 'Show actor profile on node click' });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(workspaceRef.windows.find((item) => item.id === 'graph-1').metadata.graphSettings.actorProfile).toBe(false);
  });

  it('Settings: the range and ordering apply to that window and are kept in it', async () => {
    const panel = setup('settings');
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Order by' }), 'amount');
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Direction' }), 'desc');
    const to = panel.getByRole('spinbutton', { name: 'To' });
    await userEvent.clear(to);
    await userEvent.type(to, '2{Enter}');
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '3,2'));
    const saved = workspaceRef.windows.find((item) => item.id === 'graph-1').metadata.graphSettings;
    expect(saved.limit).toEqual({ key: 'amount', sort: 'desc', min: 0, max: 2 });
  });

  it('Settings: choosing a label property turns labels on (production)', async () => {
    const panel = setup('settings');
    // New windows start in performance mode (production), which keeps labels off.
    expect(panel.getByRole('checkbox', { name: 'Performance mode' })).toBeChecked();
    expect(panel.getByRole('combobox', { name: 'Label by property' })).toBeDisabled();
    await userEvent.click(panel.getByRole('checkbox', { name: 'Performance mode' }));
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Label by property' }), 'name');
    const saved = workspaceRef.windows.find((item) => item.id === 'graph-1').metadata.graphSettings;
    expect(saved.labels.byKey).toBe('name');
    expect(saved.showLabels).toBe(true);
  });

  it('Settings: layout options follow the layout, physics follows performance mode', async () => {
    const panel = setup('settings');
    expect(panel.getByRole('checkbox', { name: 'Physics' })).toBeDisabled(); // performance mode on
    expect(panel.getByRole('combobox', { name: 'Edge weight' })).toBeDisabled();
    await userEvent.click(panel.getByRole('checkbox', { name: 'Performance mode' }));
    expect(panel.getByRole('checkbox', { name: 'Physics' })).toBeEnabled();

    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Layout' }), 'layered');
    expect(panel.getByRole('combobox', { name: 'Direction' })).toBeInTheDocument();
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Layers by' }), 'by_key');
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Layer property' }), 'amount');
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Layout' }), 'hierarchical');
    expect(panel.getByRole('combobox', { name: 'Order levels by' })).toHaveValue('directed');

    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Edge weight' }), 'amount');
    await userEvent.click(panel.getByRole('checkbox', { name: 'Show titles on hover' }));
    const saved = workspaceRef.windows.find((item) => item.id === 'graph-1').metadata.graphSettings;
    expect(saved.layout).toMatchObject({ type: 'hierarchical', direction: 'UD', sortMethod: 'directed', layerMode: 'by_key', layerKey: 'amount' });
    expect(saved).toMatchObject({ edgeWeight: 'amount', showTitles: true, performance: false });
  });
});
