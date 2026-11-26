// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { NotificationProvider } from '../../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../../shared/session/sessionContext.js';
import { WorkspaceProvider } from '../../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../../workspace/state/workspaceTypes.js';
import { getGraphDefaults, resetGraphDefaults, setGraphDefaults } from '../../lib/graphDefaults.js';
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
    expect(panel.getByRole('status')).toHaveTextContent('2 matches · showing 2 nodes and 1 edge');
    await userEvent.click(panel.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '1,2,3'));
  });

  it('Filter: the cards fold; a button in a heading does not fold its card', async () => {
    const panel = setup('filter');
    await userEvent.click(panel.getByRole('checkbox', { name: 'amount' }));
    await userEvent.click(panel.getByRole('button', { name: 'All properties' }));
    expect(panel.getByRole('checkbox', { name: 'amount' })).not.toBeChecked();
    await userEvent.click(panel.getByRole('button', { name: 'Collapse Search' }));
    expect(panel.queryByRole('textbox')).not.toBeInTheDocument();
    await userEvent.click(panel.getByRole('button', { name: 'Expand Search' }));
    expect(panel.getByRole('textbox')).toBeInTheDocument();
  });

  it('Filter: says what will be looked for', async () => {
    const panel = setup('filter');
    await userEvent.type(panel.getByRole('textbox'), '>=1000');
    expect(panel.getByRole('textbox')).toHaveAccessibleDescription(/^Values at least 1.?000$/);
    await userEvent.click(panel.getByRole('button', { name: 'Clear' }));
    expect(panel.getByRole('textbox')).toHaveValue('');
    expect(panel.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('Filter: the range goes from 0 to the largest value of the chosen properties', async () => {
    const panel = setup('filter');
    expect(panel.getByRole('slider', { name: 'To' })).toBeDisabled();
    expect(panel.getByText('Choose a number property under Search in.')).toBeInTheDocument();
    await userEvent.click(panel.getByRole('checkbox', { name: 'name' }));
    expect(panel.getByText('The chosen properties hold no amounts.')).toBeInTheDocument();
    await userEvent.click(panel.getByRole('checkbox', { name: 'amount' }));
    const from = panel.getByRole('slider', { name: 'From' });
    const to = panel.getByRole('slider', { name: 'To' });
    expect(to).toHaveAttribute('aria-valuetext', (2500).toLocaleString());
    fireEvent.change(from, { target: { value: '400' } });
    expect(panel.getByRole('textbox')).toHaveValue('1000-2500');
    fireEvent.pointerUp(from);
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '2,3'));
    // The handles do not cross; from end to end is no search.
    fireEvent.change(to, { target: { value: '100' } });
    expect(panel.getByRole('textbox')).toHaveValue('1000-1000');
    fireEvent.change(to, { target: { value: '1000' } });
    fireEvent.change(from, { target: { value: '0' } });
    fireEvent.pointerUp(from);
    expect(panel.getByRole('textbox')).toHaveValue('');
    await waitFor(() => expect(screen.getByTestId('canvas')).toHaveAttribute('data-nodes', '1,2,3'));
  });

  it('Filter: counts every match, not only the shown ones, and says what else narrows the view', async () => {
    const panel = setup('filter');
    act(() => {
      const item = workspaceRef.windows.find((entry) => entry.id === 'graph-1');
      workspaceRef.updateWindowMetadata('graph-1', { metadata: { ...item.metadata, graphSettings: { limit: { min: 0, max: 1 } }, graphSearch: { keyword: '>1000', includeLinked: false, keys: ['amount'] } } });
    });
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('2 matches · showing 1 node and 0 edges'));
    expect(panel.queryByText(/Also applied in the window/)).not.toBeInTheDocument();
    act(() => workspaceRef.updateWindowMetadata('graph-1', { metadata: { graphElementFilters: { edges: false } } }));
    await waitFor(() => expect(panel.getByText(/Also applied in the window: Filter Elements hides/)).toBeInTheDocument());
  });

  it('Filter: a search after an empty one is not called empty from the old figures', async () => {
    const panel = setup('filter');
    const box = panel.getByRole('textbox');
    await userEvent.type(box, 'nobody{Enter}');
    expect(await screen.findAllByText('No result found.')).toHaveLength(1);
    await userEvent.clear(box);
    await userEvent.type(box, 'Abebe{Enter}');
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('1 match'));
    expect(screen.getAllByText('No result found.')).toHaveLength(1);
  });

  it('Info: a run\u2019s kept graph and an imported file are named as the source', () => {
    const panel = setup('info');
    act(() => workspaceRef.updateWindowMetadata('graph-1', { metadata: { evidence: null, graphBlank: true, graphImported: 'case.json' } }));
    expect(panel.getByText('Imported file')).toBeInTheDocument();
    expect(panel.getByText('case.json')).toBeInTheDocument();
    expect(panel.queryByText('Not linked')).not.toBeInTheDocument();
  });

  it('the window tells the panel its graph alerts, in the words of its own card', async () => {
    setup('info');
    const hub = { nodes: Array.from({ length: 11 }, (_, i) => ({ id: i, label: `N${i}` })), edges: Array.from({ length: 10 }, (_, i) => ({ from: 0, to: i + 1 })) };
    act(() => getGraphStore('graph-1').replace(hub));
    await waitFor(() => expect(getGraphStore('graph-1').getSnapshot().alertReport?.high).toBe(1));
    const { alertReport } = getGraphStore('graph-1').getSnapshot();
    expect(alertReport.total).toBeGreaterThan(0);
    expect(alertReport.summary).toMatch(/alert/);
  });

  it('Settings: the range warns under the same limit as the window', async () => {
    const panel = setup('settings');
    const to = panel.getByRole('spinbutton', { name: 'To' });
    await userEvent.clear(to);
    await userEvent.type(to, '5000{Enter}');
    expect(await panel.findByText(/Limited to 2,000/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Limited to 2,000')).toBeInTheDocument());
  });

  it('Settings: Reset goes back to Libraries ▸ Graph defaults', async () => {
    setGraphDefaults({ ...getGraphDefaults(), layout: { ...getGraphDefaults().layout, type: 'grid' } });
    const panel = setup('settings');
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Layout' }), 'circle');
    await userEvent.click(panel.getByRole('button', { name: 'Reset this graph' }));
    expect(panel.getByRole('combobox', { name: 'Layout' })).toHaveValue('grid');
    resetGraphDefaults();
  });

  it('Settings: the actor profile card can be turned off for this graph', async () => {
    const panel = setup('settings');
    const box = panel.getByRole('checkbox', { name: 'Show actor profile on node click' });
    expect(box).toBeChecked();
    await userEvent.click(box);
    expect(workspaceRef.windows.find((item) => item.id === 'graph-1').metadata.graphSettings.actorProfile).toBe(false);
  });

  it('Settings: Aggregate links, with its mode and the total of a numeric link property', async () => {
    const panel = setup('settings');
    act(() => { getGraphStore('graph-1').replace({ nodes: NODES, edges: [{ from: 1, to: 2, amount: 5, kind: 'x' }, { from: 1, to: 2, amount: '7' }] }); });
    expect(panel.queryByRole('combobox', { name: 'Total of' })).not.toBeInTheDocument();
    await userEvent.click(panel.getByRole('checkbox', { name: 'Aggregate links' }));
    const total = panel.getByRole('combobox', { name: 'Total of' });
    expect(within(total).getAllByRole('option').map((option) => option.textContent)).toEqual(['No total (count only)', 'amount']);
    await userEvent.selectOptions(total, 'amount');
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Aggregate' }), 'direction');
    expect(workspaceRef.windows.find((item) => item.id === 'graph-1').metadata.graphSettings.linkAggregation).toEqual({ on: true, mode: 'direction', totalKey: 'amount' });
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

  it('Settings: the nodes-shown slider runs 0 to the node count and fills the From/To fields', async () => {
    const panel = setup('settings');
    const from = panel.getByRole('slider', { name: 'From' });
    const to = panel.getByRole('slider', { name: 'To' });
    expect(to).toHaveAttribute('max', '3');
    expect(to).toHaveValue('3');
    // Only the lower handle moved: "To" keeps its value past the node count.
    const before = panel.getByRole('spinbutton', { name: 'To' }).value;
    fireEvent.change(from, { target: { value: '1' } });
    expect(panel.getByRole('spinbutton', { name: 'From' })).toHaveValue(1);
    expect(panel.getByRole('spinbutton', { name: 'To' }).value).toBe(before);
    fireEvent.change(to, { target: { value: '2' } });
    expect(panel.getByRole('spinbutton', { name: 'To' })).toHaveValue(2);
    fireEvent.pointerUp(to);
    await waitFor(() => expect(workspaceRef.windows.find((item) => item.id === 'graph-1').metadata.graphSettings.limit).toMatchObject({ min: 1, max: 2 }));
    // Typed numbers move the handles.
    const typed = panel.getByRole('spinbutton', { name: 'From' });
    await userEvent.clear(typed);
    await userEvent.type(typed, '0{Enter}');
    expect(panel.getByRole('slider', { name: 'From' })).toHaveValue('0');
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

  it('Settings: Peacock and Grouped layouts (i2 #6); Grouped groups by node type or a property', async () => {
    const panel = setup('settings');
    const saved = () => workspaceRef.windows.find((item) => item.id === 'graph-1').metadata.graphSettings;
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Layout' }), 'peacock');
    expect(saved().layout.type).toBe('peacock');
    expect(panel.queryByRole('combobox', { name: 'Group by' })).not.toBeInTheDocument();
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Layout' }), 'grouped');
    const groupBy = panel.getByRole('combobox', { name: 'Group by' });
    expect(groupBy).toHaveValue('node_identity');
    expect(panel.queryByRole('combobox', { name: 'Group property' })).not.toBeInTheDocument();
    await userEvent.selectOptions(groupBy, 'by_key');
    await userEvent.selectOptions(panel.getByRole('combobox', { name: 'Group property' }), 'amount');
    expect(saved().layout).toMatchObject({ type: 'grouped', layerMode: 'by_key', layerKey: 'amount' });
  });
});
