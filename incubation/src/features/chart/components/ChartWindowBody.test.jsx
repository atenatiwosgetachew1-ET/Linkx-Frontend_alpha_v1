// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { clearGraphStores, getGraphStore } from '../../graph/lib/graphStore.js';
import { getGraphState, handleGraphActions, publishGraphState, resetGraphLinkBus } from '../../graph/lib/graphLinkBus.js';

// ECharts draws on a canvas jsdom does not have: a stand-in keeps each
// chart's option and its click handlers.
const charts = [];
vi.mock('../lib/echarts.js', () => ({
  default: {
    init: () => {
      const handlers = {};
      const chart = {
        option: null,
        zoom: null,
        actions: [],
        // Replacing the option whole resets the zoom, as ECharts does.
        sets: 0,
        setOption: (option) => { chart.option = option; chart.zoom = null; chart.sets += 1; },
        getOption: () => ({ dataZoom: [chart.zoom || { start: 0, end: 100 }] }),
        dispatchAction: (action) => {
          chart.actions.push(action);
          if (action.type === 'dataZoom') chart.zoom = { start: action.start, end: action.end };
        },
        on: (name, handler) => { handlers[name] = handler; },
        fire: (name, params) => handlers[name]?.(params),
        resize: () => {},
        dispose: () => { chart.disposed = true; },
        getDataURL: () => 'data:image/png;base64,AAAA',
      };
      charts.push(chart);
      return chart;
    },
  },
}));

const { default: ChartWindowBody } = await import('./ChartWindowBody.jsx');
const { COLOR_SCHEMAS } = await import('../lib/chartColors.js');
const { toneStep } = await import('../lib/chartState.js');

afterEach(() => {
  cleanup();
  clearGraphStores();
  resetGraphLinkBus();
  charts.length = 0;
});

// a -> b, a -> c, b -> c, c -> d (plus d, e drawn; e isolated) and a theme line.
const GRAPH = {
  nodes: [
    { id: 'a', label: 'Abebe', color: { background: '#ff0000' } },
    { id: 'b', label: 'Bekele' },
    { id: 'c', label: 'Chala' },
    { id: 'd', label: 'Dawit' },
    { id: 'e', label: 'Eden' },
  ],
  edges: [
    { id: 'e1', from: 'a', to: 'b', amount: '2,500', label: 'paid', TRANSACTIONDATE: '2026-01-05' }, { id: 'e2', from: 'a', to: 'c', amount: 900, TRANSACTIONDATE: '2026-01-05' },
    { id: 'e3', from: 'b', to: 'c', TRANSACTIONDATE: '2026-01-07' }, { id: 'e4', from: 'c', to: 'd' },
    { id: 't1', from: 'a', to: 'e', edge_kind: 'theme_line' },
  ],
};

let workspaceRef;
function Harness({ chartMetadata, hidden = false }) {
  workspaceRef = useWorkspace();
  const { windows, openWindow } = workspaceRef;
  useEffect(() => {
    openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id: 'graph-1', title: 'Graph' });
    openWindow(WORKSPACE_WINDOW_TYPES.CHART, { id: 'chart-1', title: 'Chart', metadata: chartMetadata });
  }, [openWindow, chartMetadata]);
  const chart = windows.find((item) => item.id === 'chart-1');
  return chart ? <ChartWindowBody windowItem={chart} hidden={hidden} /> : null;
}

const setup = ({ drawn = ['a', 'b', 'c', 'd', 'e'], selection = { nodes: [], edges: [] }, chartMetadata = { chartGraph: 'graph-1', chartState: { mode: 'manual' } }, weightKey = '', timeSlice = 'auto' } = {}) => {
  const store = getGraphStore('graph-1');
  store.replace(GRAPH);
  publishGraphState('graph-1', { nodeIds: drawn, edgeIds: store.graph().edges(), selection, weightKey, timeSlice });
  const actions = vi.fn();
  handleGraphActions('graph-1', actions);
  const tree = (hidden) => (
    <NotificationProvider>
      <WorkspaceProvider>
        <Harness chartMetadata={chartMetadata} hidden={hidden} />
      </WorkspaceProvider>
    </NotificationProvider>
  );
  const view = render(tree(false));
  return { store, actions, setHidden: (hidden) => view.rerender(tree(hidden)) };
};

const addChart = async (label) => {
  await userEvent.click(screen.getByRole('button', { name: 'New chart' }));
  await userEvent.click(within(screen.getByRole('menu', { name: 'New chart' })).getByRole('menuitem', { name: label }));
};
// The counts at the start of the toolbar (the Graph window's toolbar).
const toolbarCounts = () => document.querySelector('.chart_toolbar .graph_window_counts').textContent;
// A new selection on the graph, the rest of what it publishes kept (as the
// Graph window does).
const reselect = (selection) => publishGraphState('graph-1', { ...getGraphState('graph-1'), selection });
const lastChart = () => charts.filter((chart) => !chart.disposed).at(-1);
const barsOf = (chart, index = 0) => chart.option.series[index].data.map((point) => [point.name, point.value]);

describe('ChartWindowBody', () => {
  it('offers the open Graph windows until linked', async () => {
    setup({ chartMetadata: {} });
    expect(await screen.findByText('Link a Graph window')).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('list', { name: 'Graph windows' })).getByRole('button'));
    expect(workspaceRef.windows.find((item) => item.id === 'chart-1').metadata.chartGraph).toBe('graph-1');
    expect(await screen.findByRole('button', { name: 'New chart' })).toBeEnabled();
  });

  it('unlinked: the tip, and right-click ▸ New Graph window opens one and links the chart window to it', async () => {
    setup({ chartMetadata: {} });
    await screen.findByText('Link a Graph window');
    expect(screen.getByText(/To start a new graph from here, open the context menu/)).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('status'));
    const item = screen.getByRole('menuitem', { name: 'New Graph window' });
    expect(item).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(item);
    const graphs = workspaceRef.windows.filter((entry) => entry.type === WORKSPACE_WINDOW_TYPES.GRAPH);
    expect(graphs).toHaveLength(2);
    expect(workspaceRef.windows.find((entry) => entry.id === 'chart-1').metadata.chartGraph).toBe(graphs[1].id);
    expect(screen.queryByRole('menu', { name: 'Chart actions' })).not.toBeInTheDocument();
  });

  it('linked with no charts: the placeholder and tip, and no context menu', async () => {
    setup();
    expect(await screen.findByText('No charts yet')).toBeInTheDocument();
    expect(screen.getByText(/To create a chart, choose/)).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('status'));
    expect(screen.queryByRole('menuitem', { name: 'New Graph window' })).not.toBeInTheDocument();
  });

  it('Automatic (the default): once linked, the Global-level charts come up by themselves, once', async () => {
    setup({ chartMetadata: { chartGraph: 'graph-1' } });
    const globals = ['Assortativity', 'Reciprocity', 'Global Metrics', 'Cohesion Metrics', 'Temporal Metrics', 'Heat Matrix (Day \u00d7 Hour)', 'Histogram', 'Degree Distribution', 'Community Sizes'];
    for (const name of globals) expect(await screen.findByRole('article', { name })).toBeInTheDocument();
    expect(screen.getAllByRole('article')).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Generation' })).toHaveTextContent('Automatic');
    // Closed charts stay closed (no refilling).
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(await screen.findByText('No charts yet')).toBeInTheDocument();
    // Manual leaves the board alone; back to Automatic fills it again.
    await userEvent.click(screen.getByRole('button', { name: 'Generation' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Manual/ }));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Generation' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /Automatic/ }));
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(9));
  });

  it('Manual: a category checked brings all its charts up (13 node-level); unchecked, they go; one at a time still works', async () => {
    setup();
    await screen.findByText('No charts yet');
    await userEvent.click(screen.getByRole('button', { name: 'New chart' }));
    const menu = screen.getByRole('menu', { name: 'New chart' });
    const nodeLevel = within(menu).getByRole('menuitemcheckbox', { name: /Node-Level Charts/ });
    expect(nodeLevel).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(nodeLevel);
    expect(screen.getAllByRole('article')).toHaveLength(13);
    expect(nodeLevel).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(nodeLevel);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    // One chart: the category is partly shown.
    await userEvent.click(within(menu).getByRole('menuitem', { name: /Edge Weight/ }));
    await userEvent.click(screen.getByRole('button', { name: 'New chart' }));
    expect(within(screen.getByRole('menu', { name: 'New chart' })).getByRole('menuitemcheckbox', { name: /Edge-Level Charts/ })).toHaveAttribute('aria-checked', 'mixed');
  });

  it('keeps a chart\u2019s zoom when the selection changes; Follow selection brings a selected entity out of sight into it', async () => {
    setup();
    await addChart('Degree Centrality');
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    const chart = lastChart();
    // Zoomed on the first fifth (Chala, the largest).
    act(() => chart.dispatchAction({ type: 'dataZoom', start: 0, end: 20 }));
    // Follow off: the zoom is kept while the colours change.
    await userEvent.click(screen.getByRole('button', { name: 'Follow selection' }));
    act(() => reselect({ nodes: ['e'], edges: [] }));
    await waitFor(() => expect(chart.option.series[0].data.at(-1).itemStyle.color).not.toBe('rgb(210,210,210)'));
    expect(chart.zoom).toEqual({ start: 0, end: 20 });
    // Follow on: Dawit (4th of 5) is brought into sight, the width kept.
    await userEvent.click(screen.getByRole('button', { name: 'Follow selection' }));
    act(() => reselect({ nodes: ['d'], edges: [] }));
    await waitFor(() => expect(chart.zoom).toEqual({ start: 60, end: 80 }));
    // The same chart throughout (recoloured, not recomputed).
    expect(lastChart()).toBe(chart);
    // In sight already: left alone.
    act(() => reselect({ nodes: ['d', 'e'], edges: [] }));
    await waitFor(() => expect(chart.option.series[0].data.at(-1).itemStyle.color).not.toBe('rgb(210,210,210)'));
    expect(chart.zoom).toEqual({ start: 60, end: 80 });
  });

  it("lists production's menu, later slices unavailable; charts the drawn entities, largest first, theme lines left out", async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'New chart' }));
    const menu = screen.getByRole('menu', { name: 'New chart' });
    expect(within(menu).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Global-Level Charts', 'Node-Level Charts', 'Edge-Level Charts']);
    // Every chart in its level, none folded away; the removed ones gone.
    expect(within(menu).getByRole('menuitem', { name: /Assortativity/ })).toBeInTheDocument();
    // Specialist measures tagged Advanced (menu and card); the others not.
    const tagged = within(menu).getAllByRole('menuitem').filter((item) => item.querySelector('.chart_advanced_tag')).map((item) => item.getAttribute('aria-description') && item.textContent);
    expect(tagged).toEqual(['AssortativityAdvanced', 'HITS (Authority / Hub Scores)Advanced', 'Constraint (Structural Holes)Advanced']);
    expect(within(menu).queryByRole('menuitem', { name: /Katz|Eccentricity|Embeddedness|Similarity/ })).not.toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem').every((item) => item.getAttribute('aria-disabled') === 'false')).toBe(true);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Degree Centrality' }));
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    expect(barsOf(lastChart())).toEqual([['Chala', 3], ['Abebe', 2], ['Bekele', 2], ['Dawit', 1], ['Eden', 0]]);
    expect(toolbarCounts()).toBe('5 entities · 4 links in scope');
    // Created once (production: "Chart already created.").
    await userEvent.click(screen.getByRole('button', { name: 'New chart' }));
    expect(within(screen.getByRole('menu', { name: 'New chart' })).getByRole('menuitem', { name: /Degree Centrality/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('in / out degree as two series; scope Selected charts the selection and the links among it', async () => {
    setup({ selection: { nodes: ['a', 'b'], edges: [] } });
    await addChart('In / Out Degree');
    await waitFor(() => expect(lastChart()?.option?.series).toHaveLength(2));
    expect(lastChart().option.series.map((series) => series.name)).toEqual(['In', 'Out']);
    await userEvent.click(screen.getByRole('button', { name: 'Scope' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^Selected/ }));
    await waitFor(() => expect(lastChart().option.series[0].data).toHaveLength(2));
    expect(barsOf(lastChart(), 1)).toEqual([['Abebe', 1], ['Bekele', 0]]);
    expect(toolbarCounts()).toBe('2 entities · 1 link in scope');
    expect(screen.getByText('1 chart · 2 selected on the graph')).toBeInTheDocument();
  });

  it("selection both ways: selected entities in their own colour; a click selects on the graph, a double click focuses", async () => {
    const { actions } = setup({ selection: { nodes: ['a'], edges: [] } });
    await addChart('Degree Centrality');
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    const points = lastChart().option.series[0].data;
    expect(points.find((point) => point.name === 'Abebe').itemStyle.color).toBe('#ff0000');
    // The others by the schema (on at first).
    expect(points.find((point) => point.name === 'Chala').itemStyle.color).toMatch(/^hsl\(/);
    act(() => lastChart().fire('click', { dataIndex: 0, event: { event: {} } }));
    expect(actions).toHaveBeenLastCalledWith({ type: 'select', nodes: ['c'], edges: [] });
    act(() => lastChart().fire('click', { dataIndex: 0, event: { event: { ctrlKey: true } } }));
    expect(actions).toHaveBeenLastCalledWith({ type: 'select', nodes: ['a', 'c'], edges: [] });
    act(() => lastChart().fire('dblclick', { dataIndex: 3 }));
    expect(actions).toHaveBeenLastCalledWith({ type: 'focus', nodes: ['d'], edges: [] });
  });

  it("edge charts: the graph's weight key, links named From → To, a bar click selects the link", async () => {
    const { store, actions } = setup({ weightKey: 'AMOUNT' });
    const [first] = store.graph().edges();
    await addChart('Edge Weight');
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    expect(lastChart().option.series[0].name).toBe('Weight (AMOUNT)');
    expect(barsOf(lastChart())).toEqual([['Abebe → Bekele (paid)', 2500], ['Abebe → Chala', 900]]);
    act(() => lastChart().fire('click', { dataIndex: 0, event: { event: {} } }));
    expect(actions).toHaveBeenLastCalledWith({ type: 'select', nodes: [], edges: [first] });
    act(() => lastChart().fire('dblclick', { dataIndex: 0 }));
    expect(actions).toHaveBeenLastCalledWith({ type: 'focus', nodes: [], edges: [first] });
  });

  it('global figures as a list (cohesion uses the Graph window\u2019s communities); summaries on assortativity / reciprocity', async () => {
    setup();
    await addChart('Cohesion Metrics');
    const card = await screen.findByRole('article', { name: 'Cohesion Metrics' });
    await waitFor(() => expect(within(card).getByText('Connected Components')).toBeInTheDocument());
    const value = (label) => within(card).getByText(label).nextElementSibling.textContent;
    expect(value('Connected Components')).toBe('2'); // a-b-c-d, and e alone (the theme line left out)
    expect(value('Cut Vertices')).toBe('1');
    expect(Number(value('Community Count'))).toBeGreaterThanOrEqual(2);
    expect(value('Modularity')).not.toBe('—');
    await addChart('Reciprocity');
    const reciprocity = await screen.findByRole('article', { name: 'Reciprocity' });
    // The card's structure: eyebrow and title; key figures, the overall value first.
    expect(within(reciprocity).getByText('Network · Bars')).toBeInTheDocument();
    await waitFor(() => expect(within(reciprocity).getByText('Overall reciprocity')).toBeInTheDocument());
    expect(within(reciprocity).getByText('Overall reciprocity').nextElementSibling.textContent).toBe('0');
    expect(within(reciprocity).getByText('Entities')).toBeInTheDocument();
  });

  it("temporal metrics over the timeline's date field and slicing (Daily); undated links counted", async () => {
    setup({ timeSlice: 'day' });
    await addChart('Temporal Metrics');
    const card = await screen.findByRole('article', { name: 'Temporal Metrics' });
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    expect(lastChart().option.xAxis.data).toHaveLength(3); // 5, 6 and 7 Jan
    const links = lastChart().option.series.find((series) => series.name === 'Links');
    expect(links).toMatchObject({ type: 'bar', yAxisIndex: 1, data: [2, 0, 1] });
    expect(lastChart().option.series.filter((series) => series.type === 'line').map((series) => series.name)).toEqual(['Entity churn', 'Link churn', 'Density', 'Centralization', 'Modularity']);
    expect(within(card).getByText('Daily periods of TRANSACTIONDATE · 1 undated links left out')).toBeInTheDocument();
  });

  it('zoom and slide need Ctrl (a plain wheel scrolls the board, with a subtle hint); each card its own tone', async () => {
    setup();
    await addChart('Degree Centrality');
    await addChart('Closeness Centrality');
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    const inside = lastChart().option.dataZoom.find((zoom) => zoom.type === 'inside');
    expect(inside).toMatchObject({ zoomOnMouseWheel: 'ctrl', moveOnMouseMove: 'ctrl', moveOnMouseWheel: false });
    const card = screen.getByRole('article', { name: 'Degree Centrality' });
    // A plain wheel never reaches the chart (ECharts would cancel the
    // scroll); Ctrl + wheel does.
    const reached = vi.fn();
    const box = card.querySelector('.chart_card_box');
    box.addEventListener('wheel', reached);
    fireEvent.wheel(box, { deltaY: 100 });
    expect(reached).not.toHaveBeenCalled();
    fireEvent.wheel(box, { deltaY: 100, ctrlKey: true });
    expect(reached).toHaveBeenCalledTimes(1);
    fireEvent.wheel(card.querySelector('.chart_card_body'), { deltaY: 100 });
    expect(within(card).getByText('Hold Ctrl and scroll to zoom · Ctrl + drag to slide')).toBeInTheDocument();
    const other = screen.getByRole('article', { name: 'Closeness Centrality' });
    fireEvent.wheel(other.querySelector('.chart_card_body'), { deltaY: 100, ctrlKey: true });
    expect(within(other).queryByText(/Hold Ctrl/)).not.toBeInTheDocument();
    // The newest card first; each card its own tone along the schema, given
    // when it was created (golden-ratio steps) and kept.
    expect(screen.getAllByRole('article').map((article) => article.getAttribute('aria-label'))).toEqual(['Closeness Centrality', 'Degree Centrality']);
    const degreeTone = COLOR_SCHEMAS.Viridis(toneStep(0));
    const closenessTone = COLOR_SCHEMAS.Viridis(toneStep(1));
    expect(card.style.getPropertyValue('--card-tone')).toBe(degreeTone);
    expect(other.style.getPropertyValue('--card-tone')).toBe(closenessTone);
    expect(degreeTone).not.toBe(closenessTone);
    // Adding and closing others leaves them as they were.
    await addChart('PageRank');
    await userEvent.click(screen.getByRole('button', { name: 'Close Closeness Centrality' }));
    expect(screen.getByRole('article', { name: 'Degree Centrality' }).style.getPropertyValue('--card-tone')).toBe(degreeTone);
    expect(screen.getByRole('article', { name: 'PageRank' }).style.getPropertyValue('--card-tone')).toBe(COLOR_SCHEMAS.Viridis(toneStep(2)));
  });

  it('the New chart menu stays inside a small Chart window (moved left, bounded, scrolling)', async () => {
    setup();
    const button = await screen.findByRole('button', { name: 'New chart' });
    const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) });
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure() {
      if (this.classList?.contains('chart_window')) return rect(100, 50, 400, 300);
      if (this === button) return rect(420, 60, 90, 28);
      return rect(0, 0, 0, 0);
    });
    await userEvent.click(button);
    const menu = screen.getByRole('menu', { name: 'New chart' });
    await waitFor(() => expect(menu.style.maxWidth).toBe('384px'));
    expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(400 - 8);
    expect(parseFloat(menu.style.left)).toBeGreaterThanOrEqual(8);
    expect(menu.style.top).toBe('42px'); // under the button, in the window
    expect(menu.style.maxHeight).toBe('250px'); // to the window's bottom, less 8
    spy.mockRestore();
  });

  it('card and global colour controls; full screen; close; reset; kept with the window', async () => {
    setup();
    await addChart('Betweenness Centrality');
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    // Coloured by the schema at first; off: grey by value (production).
    expect(lastChart().option.series[0].data[0].itemStyle.color).toMatch(/^hsl\(/);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Colour Betweenness Centrality' }));
    await waitFor(() => expect(lastChart().option.series[0].data[0].itemStyle.color).toMatch(/^rgb\(/));
    await addChart('Closeness Centrality');
    // The global control: in the Colours panel.
    await userEvent.click(screen.getByRole('button', { name: 'Colours' }));
    await userEvent.selectOptions(within(screen.getByRole('dialog', { name: 'Colours' })).getByRole('combobox', { name: 'Colour schema of every chart' }), 'Ocean');
    const saved = () => workspaceRef.windows.find((item) => item.id === 'chart-1').metadata.chartState;
    // The newest first.
    expect(saved().cards.map((card) => [card.metric, card.schema])).toEqual([['closeness', 'Ocean'], ['betweenness', 'Ocean']]);
    await userEvent.click(screen.getByRole('button', { name: 'Full screen Closeness Centrality' }));
    expect(screen.getByRole('article', { name: 'Closeness Centrality' })).toHaveClass('is-full');
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('article', { name: 'Closeness Centrality' })).not.toHaveClass('is-full');
    await userEvent.click(screen.getByRole('button', { name: 'Close Betweenness Centrality' }));
    expect(saved().cards.map((card) => card.metric)).toEqual(['closeness']);
    await userEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(saved().cards).toEqual([]);
    expect(screen.getByText('No charts yet')).toBeInTheDocument();
  });

  it('a docked tab switch (unmount, mount): the charts come back at once, not computed again, the board where it was', async () => {
    const view = setup();
    await addChart('Degree Centrality');
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    const grid = document.querySelector('.chart_grid');
    grid.scrollTop = 120;
    fireEvent.scroll(grid);
    const before = charts.length;
    const metadata = workspaceRef.windows.find((item) => item.id === 'chart-1').metadata;
    cleanup();
    render(
      <NotificationProvider>
        <WorkspaceProvider>
          <Harness chartMetadata={metadata} />
        </WorkspaceProvider>
      </NotificationProvider>,
    );
    // Drawn without a "Computing…" step: the kept result, no entry animation.
    await waitFor(() => expect(charts.length).toBe(before + 1));
    expect(screen.queryByText('Computing…')).not.toBeInTheDocument();
    // Drawn in the next frame (the chart scheduler).
    await waitFor(() => expect(lastChart().option?.animation).toBe(false));
    expect(barsOf(lastChart())[0]).toEqual(['Chala', 3]);
    expect(document.querySelector('.chart_grid').scrollTop).toBe(120);
    expect(view.store).toBeTruthy();
  });

  it('a pin over the selected entity; a click on it zooms to it', async () => {
    const { store, actions } = setup({ selection: { nodes: ['n20'], edges: [] } });
    // 41 entities: a hub linked to 40.
    act(() => store.replace({
      nodes: [{ id: 'hub', label: 'Hub' }, ...Array.from({ length: 40 }, (_, index) => ({ id: `n${index}`, label: `N${index}` }))],
      edges: Array.from({ length: 40 }, (_, index) => ({ id: `x${index}`, from: 'hub', to: `n${index}` })),
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Scope' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^All/ }));
    await addChart('Degree Centrality');
    await waitFor(() => expect(lastChart()?.option?.series?.[0]?.markPoint?.data).toHaveLength(1));
    const chart = lastChart();
    const pin = chart.option.series[0].markPoint.data[0];
    expect(pin.entity).toBe('n20');
    act(() => chart.fire('click', { componentType: 'markPoint', data: pin, dataIndex: 0, event: { event: {} } }));
    // About 15 of the 41 entities in sight, around it.
    const index = pin.coord[0];
    const at = ((index + 0.5) / 41) * 100;
    expect(chart.zoom.end - chart.zoom.start).toBeCloseTo((15 / 41) * 100, 5);
    expect(chart.zoom.start).toBeLessThanOrEqual(at);
    expect(chart.zoom.end).toBeGreaterThanOrEqual(at);
    // A pin zooms; it does not change the selection.
    expect(actions).not.toHaveBeenCalled();
  });

  it('hidden (docked, kept mounted): dormant while the graph changes its selection or republishes its view; catches up once shown', async () => {
    const { setHidden } = setup();
    await addChart('Degree Centrality');
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    const chart = lastChart();
    const metric = await import('../../graph/lib/layoutClient.js');
    const requests = vi.spyOn(metric, 'requestChartMetric');
    setHidden(true);
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const sets = chart.sets;
    // The graph selects, and publishes the same view again (new arrays, as
    // its remount does).
    act(() => reselect({ nodes: ['a'], edges: [] }));
    act(() => publishGraphState('graph-1', { ...getGraphState('graph-1'), nodeIds: [...getGraphState('graph-1').nodeIds], edgeIds: [...getGraphState('graph-1').edgeIds] }));
    act(() => reselect({ nodes: ['b'], edges: [] }));
    await new Promise((resolve) => { setTimeout(resolve, 80); });
    expect(chart.sets).toBe(sets);
    // Shown: one catch-up, with the latest selection; nothing computed again.
    setHidden(false);
    await waitFor(() => expect(chart.option.series[0].markPoint.data.map((pin) => pin.entity)).toEqual(['b']));
    expect(requests).not.toHaveBeenCalled();
    expect(lastChart()).toBe(chart);
    // (The spy sees requests: a new card asks for its metric.)
    await addChart('PageRank');
    await waitFor(() => expect(requests).toHaveBeenCalledWith('pagerank', expect.anything()));
    requests.mockRestore();
  });

  it('a bin selects its members (Ctrl adds); a double click focuses them', async () => {
    const { actions } = setup();
    await addChart('Degree Distribution');
    await waitFor(() => expect(lastChart()?.option?.series?.[0]?.type).toBe('bar'));
    const chart = lastChart();
    // Degrees: e 0; d 1; a, b 2; c 3 (theme line left out).
    expect(chart.option.xAxis.data).toEqual(['0', '1', '2', '3']);
    act(() => chart.fire('click', { dataIndex: 2, event: { event: {} } }));
    expect(actions).toHaveBeenLastCalledWith({ type: 'select', nodes: ['a', 'b'], edges: [] });
    act(() => chart.fire('dblclick', { dataIndex: 3 }));
    expect(actions).toHaveBeenLastCalledWith({ type: 'focus', nodes: ['c'], edges: [] });
  });

  it('histogram: links by type at first; another property recomputes it (the latest choice only)', async () => {
    setup();
    await addChart('Histogram');
    await waitFor(() => expect(lastChart()?.option?.series?.[0]?.data).toBeTruthy());
    const select = screen.getByRole('combobox', { name: 'Histogram: count by' });
    expect(select).toHaveValue('edge:@type');
    expect(within(select).getByRole('option', { name: 'TRANSACTIONDATE' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'edge:TRANSACTIONDATE');
    await waitFor(() => expect(lastChart().option.xAxis.data).toEqual(['2026-01-05', '2026-01-07', '(empty)']));
    expect(lastChart().option.series[0].data.map((point) => point.value)).toEqual([2, 1, 1]);
    const saved = workspaceRef.windows.find((item) => item.id === 'chart-1').metadata.chartState;
    expect(saved.cards[0].param).toEqual({ subject: 'edge', key: 'TRANSACTIONDATE' });
  });

  it('heat matrix: a cell selects its links', async () => {
    const { actions, store } = setup();
    await addChart('Heat Matrix (Day \u00d7 Hour)');
    await waitFor(() => expect(lastChart()?.option?.series?.[0]?.type).toBe('heatmap'));
    const chart = lastChart();
    // Dates without a time of day: by weekday only.
    expect(chart.option.xAxis.data).toEqual(['All day']);
    const keys = store.graph().edges();
    act(() => chart.fire('click', { dataIndex: 0, event: { event: {} } }));
    expect(actions).toHaveBeenLastCalledWith({ type: 'select', nodes: [], edges: [keys[0], keys[1]] });
  });

  it('newest first: one chart, a whole level (in menu order), then one more on top; nothing dropped', async () => {
    setup();
    await screen.findByText('No charts yet');
    const order = () => screen.getAllByRole('article').map((article) => article.getAttribute('aria-label'));
    await addChart('Degree Centrality');
    await userEvent.click(screen.getByRole('button', { name: 'New chart' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'New chart' })).getByRole('menuitemcheckbox', { name: /Edge-Level Charts/ }));
    expect(order()).toEqual(['Edge Betweenness', 'Edge Weight', 'Degree Centrality']);
    await userEvent.keyboard('{Escape}');
    await addChart('Assortativity');
    expect(order()).toEqual(['Assortativity', 'Edge Betweenness', 'Edge Weight', 'Degree Centrality']);
    expect(within(screen.getByRole('article', { name: 'Assortativity' })).getByText('Advanced')).toHaveClass('chart_advanced_tag');
    expect(within(screen.getByRole('article', { name: 'Degree Centrality' })).queryByText('Advanced')).not.toBeInTheDocument();
    // Every chart on the board at once: none dropped for room.
    await userEvent.click(screen.getByRole('button', { name: 'New chart' }));
    const menu = screen.getByRole('menu', { name: 'New chart' });
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /Global-Level Charts/ }));
    await userEvent.click(within(menu).getByRole('menuitemcheckbox', { name: /Node-Level Charts/ }));
    expect(order()).toHaveLength(24);
    // The last level added on top, in menu order (Degree was there already).
    expect(order().slice(0, 2)).toEqual(['In / Out Degree', 'Flow In / Out / Net']);
    expect(order().at(-1)).toBe('Degree Centrality');
  });

  it('a selection updates only the charts it changes: link charts only for links it touches, Temporal never', async () => {
    setup({ weightKey: 'AMOUNT' });
    await addChart('Degree Centrality');
    await addChart('Edge Weight');
    await addChart('Temporal Metrics');
    await waitFor(() => expect(charts.filter((chart) => !chart.disposed && chart.option)).toHaveLength(3));
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const byName = (name) => charts.find((chart) => !chart.disposed && chart.option?.series?.some((series) => String(series.name).startsWith(name)));
    const degree = byName('Degree');
    const weight = byName('Weight');
    const temporal = charts.find((chart) => !chart.disposed && chart.option?.yAxis?.[0]?.name === 'Measures');
    const sets = () => [degree.sets, weight.sets, temporal.sets];
    const settle = () => new Promise((resolve) => { setTimeout(resolve, 50); });
    const before = sets();
    // Eden has no links in scope (its theme line is left out): the node
    // charts only.
    act(() => reselect({ nodes: ['e'], edges: [] }));
    await waitFor(() => expect(degree.sets).toBe(before[0] + 1));
    await settle();
    expect(sets()).toEqual([before[0] + 1, before[1], before[2]]);
    // The same selection published again: nothing at all.
    act(() => reselect({ nodes: ['e'], edges: [] }));
    await settle();
    expect(sets()).toEqual([before[0] + 1, before[1], before[2]]);
    // Abebe has links: the node charts, and the link charts pin its links
    // (in its colour); Temporal never.
    act(() => reselect({ nodes: ['a'], edges: [] }));
    await waitFor(() => expect(weight.sets).toBe(before[1] + 1));
    await settle();
    expect(sets()).toEqual([before[0] + 2, before[1] + 1, before[2]]);
    expect(weight.option.series[0].markPoint.data.map((pin) => pin.itemStyle.color)).toEqual(['#ff0000', '#ff0000']);
  });

  it('an entity selected pins its links on link charts (Assortativity), in its colour', async () => {
    setup();
    await addChart('Assortativity');
    await waitFor(() => expect(lastChart()?.option?.series?.[0]?.type).toBe('scatter'));
    act(() => reselect({ nodes: ['a'], edges: [] }));
    // Abebe's two links, in Abebe's colour.
    await waitFor(() => expect(lastChart().option.series[0].markPoint.data).toHaveLength(2));
    expect(lastChart().option.series[0].markPoint.data.every((pin) => pin.itemStyle.color === '#ff0000')).toBe(true);
  });

  it('a card says what it measures for the selection: its value, rank and name first', async () => {
    setup();
    await addChart('Degree Centrality');
    await waitFor(() => expect(lastChart()?.option?.series).toBeTruthy());
    const card = screen.getByRole('article', { name: 'Degree Centrality' });
    expect(within(card).queryByText('Selected')).not.toBeInTheDocument();
    act(() => reselect({ nodes: ['a'], edges: [] }));
    await waitFor(() => expect(within(card).getByText('Selected')).toBeInTheDocument());
    const stat = within(card).getByText('Selected').closest('.chart_card_stat');
    expect(stat).toHaveClass('is-selected');
    expect(stat).toHaveTextContent('2');
    expect(stat).toHaveTextContent('#2 of 5 \u00b7 Abebe');
  });

  it('a bar click only recolours the charts: same chart, same layout, no update animation', async () => {
    const { actions } = setup();
    await addChart('Degree Centrality');
    await addChart('PageRank');
    await waitFor(() => expect(charts.filter((chart) => !chart.disposed && chart.option)).toHaveLength(2));
    const [first, second] = charts.filter((chart) => !chart.disposed);
    const tops = [first.option.grid.top, second.option.grid.top];
    act(() => second.fire('click', { dataIndex: 0, event: { event: {} } }));
    const [[selection]] = actions.mock.calls.slice(-1);
    act(() => reselect({ nodes: selection.nodes, edges: [] }));
    await waitFor(() => expect(first.option.series[0].markPoint.data).toHaveLength(1));
    await waitFor(() => expect(second.option.series[0].markPoint.data).toHaveLength(1));
    expect([first.option.grid.top, second.option.grid.top]).toEqual(tops);
    expect(first.option.animationDurationUpdate).toBe(0);
    expect(charts.filter((chart) => !chart.disposed)).toEqual([first, second]);
  });

  it('snaps name the entities by a chosen column, along the axis (paper has no tooltip); Print charts opens the same popup and prints A4 pages', async () => {
    const { store } = setup();
    act(() => store.updateNodes([['a', { ACCOUNT: '1000-01' }], ['c', { ACCOUNT: '1000-03' }]]));
    await addChart('Degree Centrality');
    await waitFor(() => expect(charts.filter((chart) => !chart.disposed && chart.option)).toHaveLength(1));
    const snaps = await import('../lib/chartSnaps.js');
    const cells = vi.spyOn(snaps, 'chartCell');
    const pages = vi.spyOn(snaps, 'framePages').mockResolvedValue(['data:image/png;base64,PAGE']);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Take snaps…' }));
    const dialog = screen.getByRole('dialog', { name: 'Take snaps' });
    const naming = within(dialog).getByRole('combobox', { name: 'Identify entities by' });
    expect(naming).toHaveValue('');
    expect(within(naming).getByRole('option', { name: 'ACCOUNT' })).toBeInTheDocument();
    // Download PDF is Print's (snaps are PNG pictures).
    expect(within(dialog).queryByRole('button', { name: 'Download PDF' })).not.toBeInTheDocument();
    await waitFor(() => expect(cells).toHaveBeenCalled(), { timeout: 4000 });
    // By label at first, named along the axis.
    expect(cells.mock.calls.at(-1)[0].option.xAxis.data).toEqual(['Chala', 'Abebe', 'Bekele', 'Dawit', 'Eden']);
    expect(cells.mock.calls.at(-1)[0].option.xAxis.axisLabel.show).toBe(true);
    await userEvent.selectOptions(naming, 'ACCOUNT');
    // By the column; entities without a value keep their label.
    await waitFor(() => expect(cells.mock.calls.at(-1)[0].option.xAxis.data).toEqual(['1000-03', '1000-01', 'Bekele', 'Dawit', 'Eden']), { timeout: 4000 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    // Print charts: the same popup, printing.
    const graphFile = await import('../../graph/lib/graphFile.js');
    const printed = vi.spyOn(graphFile, 'printImage').mockImplementation(() => {});
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Print charts…' }));
    const print = screen.getByRole('dialog', { name: 'Print charts' });
    expect(within(print).getByRole('radiogroup', { name: 'Layout type' })).toBeInTheDocument();
    expect(within(print).getByRole('combobox', { name: 'Identify entities by' })).toBeInTheDocument();
    await waitFor(() => expect(within(print).getByRole('img', { name: /on one page/ })).toBeInTheDocument(), { timeout: 4000 });
    await userEvent.click(within(print).getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(printed).toHaveBeenCalledWith(['data:image/png;base64,PAGE'], { pages: true }));
    expect(screen.queryByRole('dialog', { name: 'Print charts' })).not.toBeInTheDocument();
    // Download PDF beside Print: the pages as one PDF, nothing printed.
    const pdf = vi.spyOn(snaps, 'pagesToPdf').mockResolvedValue({ output: () => new Blob(['%PDF-1.3']) });
    const blobUrl = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = () => 'blob:pdf';
    URL.revokeObjectURL = () => {};
    const anchors = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    pages.mockResolvedValue(['data:image/png;base64,P1', 'data:image/png;base64,P2']);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Print charts…' }));
    const keep = screen.getByRole('dialog', { name: 'Print charts' });
    await userEvent.click(within(keep).getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(anchors).toHaveBeenCalledTimes(1));
    expect(pdf.mock.calls.at(-1)[0]).toEqual(['data:image/png;base64,P1', 'data:image/png;base64,P2']);
    expect(anchors.mock.contexts[0].download).toMatch(/^LinkxCharts_Chart-1_\d{8}-\d{4}\.pdf$/);
    expect(printed).toHaveBeenCalledTimes(1);
    URL.createObjectURL = blobUrl.create;
    URL.revokeObjectURL = blobUrl.revoke;
    anchors.mockRestore();
    pdf.mockRestore();
    cells.mockRestore();
    pages.mockRestore();
    printed.mockRestore();
  });

  it('a dense chart opens zoomed; a recolouring keeps where the analyst zoomed; a pin on a distribution zooms to its bar', async () => {
    const { store } = setup();
    act(() => store.replace({
      nodes: [{ id: 'hub', label: 'Hub' }, ...Array.from({ length: 99 }, (_, index) => ({ id: `n${index}`, label: `N${index}` }))],
      edges: Array.from({ length: 99 }, (_, index) => ({ id: `x${index}`, from: 'hub', to: `n${index}` })),
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Scope' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: /^All/ }));
    await addChart('Degree Centrality');
    await waitFor(() => expect(lastChart()?.option?.dataZoom?.[0]?.end).toBe(60));
    const chart = lastChart();
    act(() => chart.dispatchAction({ type: 'dataZoom', start: 30, end: 50 }));
    act(() => reselect({ nodes: ['n7'], edges: [] }));
    // Merged without its opening window: the analyst's zoom stays.
    await waitFor(() => expect(chart.option.series[0].markPoint.data).toHaveLength(1));
    expect(chart.option.dataZoom.every((zoom) => zoom.start === undefined)).toBe(true);
    // A distribution's pin: zoom to its bar (here 2 bars: nothing to narrow).
    await addChart('Degree Distribution');
    await waitFor(() => expect(lastChart()?.option?.series?.[0]?.markPoint?.data).toHaveLength(1));
    const bins = lastChart();
    const pin = bins.option.series[0].markPoint.data[0];
    expect(() => act(() => bins.fire('click', { componentType: 'markPoint', data: pin, dataIndex: 0, event: { event: {} } }))).not.toThrow();
  });

  it('take snaps: a popup (All and Group by default); Group downloads one picture of every chart, Individual one per chart', async () => {
    setup();
    await addChart('Degree Centrality');
    await addChart('PageRank');
    await waitFor(() => expect(charts.filter((chart) => !chart.disposed && chart.option)).toHaveLength(2));
    const snaps = await import('../lib/chartSnaps.js');
    const grouped = vi.spyOn(snaps, 'framePages').mockResolvedValue(['data:image/png;base64,GROUP']);
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Take snaps…' }));
    const dialog = screen.getByRole('dialog', { name: 'Take snaps' });
    // Defaults: every chart (All), Group.
    expect(within(dialog).getByRole('checkbox', { name: /^All/ })).toBeChecked();
    expect(within(within(dialog).getByRole('list', { name: 'Charts' })).getAllByRole('checkbox').map((box) => box.checked)).toEqual([true, true]);
    expect(within(dialog).getByRole('radio', { name: /Group/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Individual/ })).not.toBeChecked();
    // The preview: the composed picture.
    await waitFor(() => expect(within(dialog).getByRole('img', { name: 'The 2 chosen charts on one page' })).toHaveAttribute('src', 'data:image/png;base64,GROUP'), { timeout: 4000 });
    expect(within(dialog).getByText(/2 charts · 1 A4 page \(PNG\)/)).toBeInTheDocument();
    expect(grouped.mock.calls.at(-1)[0].map((picture) => picture.title)).toEqual(['PageRank', 'Degree Centrality']);
    // In the NBE frame: the logo, the source (the graph and the scope), the snap.
    const frame = grouped.mock.calls.at(-1)[1];
    expect(frame.layout).toBe('group');
    expect(frame.logoUrl).toMatch(/^data:image\/svg\+xml/);
    expect(frame.source).toBe('Source: Graph 1 \u00b7 Drawn scope');
    expect(frame.details).toMatch(/^Chart 1 \u00b7 2 charts \u00b7 /);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Take snap' }));
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
    expect(clicked.mock.contexts[0].download).toMatch(/^ChartSnap_Chart-1_\d{8}-\d{4}\.png$/);
    expect(clicked.mock.contexts[0].href).toBe('data:image/png;base64,GROUP');
    expect(screen.queryByRole('dialog', { name: 'Take snaps' })).not.toBeInTheDocument();
    // Individual, one chart left out (All then shows some): one file.
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Take snaps…' }));
    const again = screen.getByRole('dialog', { name: 'Take snaps' });
    await userEvent.click(within(again).getByRole('checkbox', { name: /PageRank/ }));
    expect(within(again).getByRole('checkbox', { name: /^All/ })).not.toBeChecked();
    expect(within(again).getByRole('checkbox', { name: /^All/ }).indeterminate).toBe(true);
    await userEvent.click(within(again).getByRole('radio', { name: /Individual/ }));
    await userEvent.click(within(again).getByRole('button', { name: 'Take snap' }));
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(2), { timeout: 4000 });
    expect(clicked.mock.contexts[1].download).toMatch(/^ChartSnap_Chart-1_Degree-Centrality_\d{8}-\d{4}\.png$/);
    // Individual: each chart on its own A4 page, at full width.
    expect(grouped.mock.calls.at(-1)[0].map((picture) => picture.title)).toEqual(['Degree Centrality']);
    expect(grouped.mock.calls.at(-1)[1]).toMatchObject({ layout: 'single' });
    expect(grouped.mock.calls.at(-1)[1].details).toMatch(/^Chart 1 \u00b7 1 chart \u00b7 /);
    // Group over several pages: a file each, numbered.
    grouped.mockResolvedValue(['data:image/png;base64,P1', 'data:image/png;base64,P2']);
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Take snaps…' }));
    const paged = screen.getByRole('dialog', { name: 'Take snaps' });
    await waitFor(() => expect(within(paged).getByRole('img', { name: /Page 1 of 2/ })).toBeInTheDocument(), { timeout: 4000 });
    await userEvent.click(within(paged).getByRole('button', { name: 'Take 2 snaps' }));
    await waitFor(() => expect(clicked).toHaveBeenCalledTimes(4));
    expect(clicked.mock.contexts.slice(2).map((anchor) => anchor.download.replace(/_\d{8}-\d{4}/, ''))).toEqual(['ChartSnap_Chart-1_p1of2.png', 'ChartSnap_Chart-1_p2of2.png']);
    // Nothing chosen: nothing to take.
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Take snaps…' }));
    const last = screen.getByRole('dialog', { name: 'Take snaps' });
    await userEvent.click(within(last).getByRole('checkbox', { name: /^All/ }));
    expect(within(last).getByRole('button', { name: 'Take snap' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Take snaps' })).not.toBeInTheDocument();
    clicked.mockRestore();
    grouped.mockRestore();
  });

});
