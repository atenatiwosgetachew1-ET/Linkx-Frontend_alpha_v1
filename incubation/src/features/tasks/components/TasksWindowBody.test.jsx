// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { AuthContext } from '../../../auth/authContext.js';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import {
  TASK_ORIGINS,
  TASK_STATUSES,
  appendTaskLog,
  createTask,
  finishTask,
  markTaskRunning,
  requestTaskFocus,
  resetTasks,
  setTaskHandlers,
} from '../lib/taskRegistry.js';
import TasksWindowBody from './TasksWindowBody.jsx';

afterEach(() => {
  cleanup();
  act(() => resetTasks());
});

let workspaceRef;
function Probe() {
  workspaceRef = useWorkspace();
  return null;
}

const authWith = (permissions = null) => ({
  user: { username: 'analyst' },
  hasRole: () => false,
  hasPermission: (permission) => (permissions ? permissions.includes(permission) : true),
});

const renderTasks = ({ permissions = null } = {}) => render(
  <AuthContext.Provider value={authWith(permissions)}>
    <NotificationProvider>
      <SessionContext.Provider value={{ apiFetch: async () => ({ message: 'success' }), configuration: {} }}>
        <WorkspaceProvider>
          <Probe />
          <TasksWindowBody />
        </WorkspaceProvider>
      </SessionContext.Provider>
    </NotificationProvider>
  </AuthContext.Provider>,
);

describe('TasksWindowBody', () => {
  it('explains the window when there are no tasks', () => {
    renderTasks();
    expect(screen.getByText('No analysis tasks yet')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Analysis sessions in use' })).toHaveAttribute('aria-valuenow', '0');
  });

  it('lists active and finished tasks and shows the selected one', async () => {
    const done = createTask({ title: 'Store data', input: 'Batch upload: 1 file', windowTitle: 'Source 1' });
    finishTask(done, TASK_STATUSES.COMPLETED);
    const live = createTask({ origin: TASK_ORIGINS.QUICK, title: 'Quick analysis', input: 'Batch · HDFS' });
    appendTaskLog(live, 'Ingesting...');
    renderTasks();

    const active = screen.getByRole('group', { name: 'Active' });
    const history = screen.getByRole('group', { name: 'History' });
    expect(within(active).getByRole('option', { name: /Quick analysis/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(history).getByRole('option', { name: /Store data/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Activity log')).toHaveTextContent('Ingesting...');
    // The quick analysis holds one of the three sessions.
    expect(screen.getByRole('meter')).toHaveAttribute('aria-valuenow', '1');

    await userEvent.click(within(history).getByRole('option', { name: /Store data/ }));
    expect(screen.getByRole('region', { name: /Task Store data/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /Active/ }));
    expect(screen.queryByRole('group', { name: 'History' })).not.toBeInTheDocument();
  });

  it('opens one Graph / Chart / Table window per task once results exist', async () => {
    const id = createTask({ title: 'Link Analysis', sourceSessionId: 's7', action: 'Link Analysis' });
    renderTasks();
    const graphButton = screen.getByRole('button', { name: /Show graph/ });
    expect(graphButton).toBeDisabled();

    act(() => markTaskRunning(id));
    await userEvent.click(graphButton);
    await userEvent.click(graphButton);
    const graphs = workspaceRef.windows.filter((windowItem) => windowItem.type === 'graph');
    expect(graphs).toHaveLength(1);
    expect(graphs[0].metadata).toMatchObject({ taskId: id, graphLinkSource: 's7', graphLinkAction: 'Link Analysis' });

    await userEvent.click(screen.getByRole('button', { name: /Show chart/ }));
    const charts = workspaceRef.windows.filter((windowItem) => windowItem.type === 'chart');
    expect(charts).toHaveLength(1);
    expect(charts[0].metadata.chartGraph).toBe(graphs[0].id);
    // Its twin: Show table, following the task's graph too.
    await userEvent.click(screen.getByRole('button', { name: /Show table/ }));
    const tables = workspaceRef.windows.filter((windowItem) => windowItem.type === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0].metadata.tableGraph).toBe(graphs[0].id);
    expect(tables[0].title).toBe('Table 1');
  });

  it('keeps Show graph disabled without graph:create (production gate)', () => {
    const id = createTask({ title: 'Link Analysis', sourceSessionId: 's7' });
    act(() => markTaskRunning(id));
    renderTasks({ permissions: ['analysis:run'] });
    expect(screen.getByRole('button', { name: /Show graph/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Show chart/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Show table/ })).toBeEnabled();
  });

  it('terminates a running task through its handler', async () => {
    const id = createTask({ title: 'Link Analysis' });
    const terminate = vi.fn(() => finishTask(id, TASK_STATUSES.TERMINATED));
    setTaskHandlers(id, { terminate });
    renderTasks();
    await userEvent.click(screen.getByRole('button', { name: 'Terminate' }));
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('option', { name: /Link Analysis/ })).toHaveTextContent('Stopped');
  });

  it('shows the dataframe rows, columns and tool', () => {
    createTask({ title: 'Link Analysis', dataframe: { totalRows: 12500, totalColumns: 12, columns: [], name: 'tx', tool: 'neo4j' } });
    renderTasks();
    const frame = screen.getByLabelText('Dataframe');
    expect(frame).toHaveTextContent((12500).toLocaleString());
    expect(frame).toHaveTextContent('12');
    expect(frame).toHaveTextContent('neo4j');
    expect(frame).not.toHaveTextContent('tx');
  });

  it('shows the verdict from the log next to the task actions', () => {
    const id = createTask({ origin: TASK_ORIGINS.QUICK, title: 'Quick analysis' });
    appendTaskLog(id, 'Flagged rules: Smurfing, Dormant to Active');
    appendTaskLog(id, 'Rule smurfing triggered');
    finishTask(id, TASK_STATUSES.COMPLETED);
    renderTasks();
    const verdict = screen.getByRole('status', { name: /Analysis verdict: Suspicious: Smurfing \(2\), Dormant to Active/ });
    expect(verdict).toHaveTextContent('Smurfing2');
    expect(within(screen.getByRole('group', { name: 'Task actions' })).getByRole('button', { name: /Show graph/ })).toBeInTheDocument();
  });

  it('filters the log and collapses the run details', async () => {
    const id = createTask({ origin: TASK_ORIGINS.QUICK, title: 'Quick analysis', action: 'Link Analysis', input: 'Batch · HDFS' });
    appendTaskLog(id, 'Ingesting batch 1');
    appendTaskLog(id, 'Disk almost full', 'warning');
    renderTasks();

    const log = screen.getByRole('log', { name: 'Activity log' });
    expect(within(log).getByText('warn')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter log' }), 'disk');
    expect(log).toHaveTextContent('Disk almost full');
    expect(log).not.toHaveTextContent('Ingesting batch 1');
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Run details/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Link Analysis');
    expect(toggle).toHaveTextContent('Batch · HDFS');
    await userEvent.click(toggle);
  });

  it('collapses and expands the activity log', async () => {
    const id = createTask({ origin: TASK_ORIGINS.QUICK, title: 'Quick analysis' });
    appendTaskLog(id, 'Ingesting batch 1');
    renderTasks();
    const toggle = screen.getByRole('button', { name: 'Activity log' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(screen.getByText('1 line')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(screen.getByRole('log', { name: 'Activity log' })).toHaveTextContent('Ingesting batch 1');
  });

  it('selects the task asked for by Show results', () => {
    const first = createTask({ title: 'First run' });
    createTask({ title: 'Second run' });
    renderTasks();
    act(() => requestTaskFocus(first));
    expect(screen.getByRole('option', { name: /First run/ })).toHaveAttribute('aria-selected', 'true');
  });
});
