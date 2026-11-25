// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { clearGraphStores, getGraphStore } from '../../../features/graph/lib/graphStore.js';
import { createTask, finishTask, resetTasks, TASK_STATUSES } from '../../../features/tasks/lib/taskRegistry.js';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import WorkspaceOverviewTab from './WorkspaceOverviewTab.jsx';

afterEach(() => {
  cleanup();
  clearGraphStores();
  resetTasks();
});

const GRAPH = { id: 'graph-1', type: 'graph', title: 'Graph 1', customTitle: 'Case 7', metadata: {} };
const show = (workspace, { connected = true, ...props } = {}) => render(
  <SessionContext.Provider value={{ configuration: { active_domain: 'bank' }, isSocketConnected: connected }}>
    <WorkspaceOverviewTab displayName="Analyst" workspace={workspace} {...props} />
  </SessionContext.Provider>,
);

describe('right panel overview', () => {
  it('says what the windows hold, and nothing made up', () => {
    getGraphStore('graph-1').replace({ nodes: [{ id: 1 }, { id: 2 }], edges: [{ from: 1, to: 2 }] });
    getGraphStore('graph-1').setViewStats({ nodes: 1, edges: 0 });
    show({ windows: [GRAPH, { id: 's', type: 'source', title: 'Source 1' }], activeWindow: GRAPH });
    expect(screen.getByRole('heading', { name: 'Graph 1 · Case 7' })).toBeInTheDocument();
    const graph = within(screen.getByRole('region', { name: 'Graph' }));
    expect(graph.getByText('1 of 2')).toBeInTheDocument();
    expect(graph.getByText('0 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand Session' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.queryByText(/Main Gateway|Review Ready/)).not.toBeInTheDocument();
  });

  it('the co-analyst card says the graph\u2019s alerts as their tooltip does, and opens with a question', () => {
    const store = getGraphStore('graph-1');
    store.replace({ nodes: [{ id: 1 }, { id: 2 }], edges: [] });
    const onSwitchTab = vi.fn();
    show({ windows: [GRAPH], activeWindow: GRAPH }, { canOpenAssistant: true, onSwitchTab });
    const card = within(screen.getByRole('region', { name: 'Co-analyst' }));
    expect(card.getByText('Not scanned yet')).toBeInTheDocument();
    expect(card.queryByText('Suspicious')).not.toBeInTheDocument();
    act(() => store.setAlertReport({ summary: '3 alerts · 1 high · 2 medium', total: 3, high: 1 }));
    const alerts = within(card.getByRole('group', { name: 'Graph alerts' }));
    expect(alerts.getByText('3 alerts · 1 high · 2 medium')).toBeInTheDocument();
    expect(card.getByText('Suspicious')).toBeInTheDocument();
    expect(alerts.getByText('1 high')).toBeInTheDocument();
    expect(alerts.getByText('2 medium')).toBeInTheDocument();
    fireEvent.click(card.getByRole('button', { name: 'Open co-analyst' }));
    expect(onSwitchTab).toHaveBeenLastCalledWith('assistant', { draft: 'This graph has 3 alerts (1 high). Which should I look at first, and why?' });
  });

  it('a value too long for its line has the whole of it in a tooltip', () => {
    const long = 'A very long case name that does not fit on one line of the panel';
    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function width() { return this.textContent.length; });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(20);
    show({ windows: [{ ...GRAPH, customTitle: long }], activeWindow: { ...GRAPH, customTitle: long } });
    const graph = within(screen.getByRole('region', { name: 'Graph' }));
    expect(graph.getByText(`Graph 1 · ${long}`)).toHaveAttribute('data-tooltip', `Graph 1 · ${long}`);
    expect(graph.getByText('Nodes shown')).not.toHaveAttribute('data-tooltip');
    vi.restoreAllMocks();
  });

  it('cards collapse and expand; activity lists three runs', () => {
    ['a', 'b', 'c', 'd'].forEach((title) => createTask({ title }));
    show({ windows: [], activeWindow: null });
    expect(within(screen.getByRole('list', { name: 'Recent analyses' })).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('1 more in Tasks.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Activity' }));
    expect(screen.queryByRole('list', { name: 'Recent analyses' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand Activity' }));
    expect(screen.getByRole('list', { name: 'Recent analyses' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Collapse / })).toHaveLength(2);
  });

  it('follows the connection, the tasks and which tabs are open', () => {
    const id = createTask({ title: 'March transfers', windowTitle: 'Source 1' });
    finishTask(id, TASK_STATUSES.FAILED, { message: 'No rows' });
    const onSwitchTab = vi.fn();
    show({ windows: [], activeWindow: null }, { connected: false, onSwitchTab });
    expect(screen.getByText('Offline')).toBeInTheDocument();
    const row = within(screen.getByRole('list', { name: 'Recent analyses' })).getByRole('listitem');
    expect(row).toHaveTextContent('March transfers');
    expect(row).toHaveTextContent('Failed');
    expect(screen.getByRole('button', { name: 'Open co-analyst' })).toBeDisabled();
  });
});
