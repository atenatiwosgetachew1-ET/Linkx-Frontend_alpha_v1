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
  applyServerTask,
  createTask,
  finishTask,
  holdTaskSession,
  markTaskRunning,
  requestTaskFocus,
  resetTasks,
  setTaskHandlers,
  updateTask,
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

const renderTasks = ({ permissions = null, apiFetch = async () => ({ message: 'success' }) } = {}) => render(
  <AuthContext.Provider value={authWith(permissions)}>
    <NotificationProvider>
      <SessionContext.Provider value={{ apiFetch, configuration: {} }}>
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

  it('opens one Graph window per task once results exist', async () => {
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

  });

  it('keeps Show graph disabled without graph:create (production gate)', () => {
    const id = createTask({ title: 'Link Analysis', sourceSessionId: 's7' });
    act(() => markTaskRunning(id));
    renderTasks({ permissions: ['analysis:run'] });
    expect(screen.getByRole('button', { name: /Show graph/ })).toBeDisabled();
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
    // No Source window: no graph to show.
    expect(within(screen.getByRole('group', { name: 'Task actions' })).queryByRole('button', { name: /Show graph/ })).not.toBeInTheDocument();
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

  it('selects the task asked for by Show task', () => {
    const first = createTask({ title: 'First run' });
    createTask({ title: 'Second run' });
    renderTasks();
    act(() => requestTaskFocus(first));
    expect(screen.getByRole('option', { name: /First run/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('lists kept sessions and saved runs in their own tabs', async () => {
    const kept = createTask({ title: 'Kept run' });
    const saved = createTask({ title: 'Saved run' });
    const plain = createTask({ title: 'Plain run' });
    [kept, saved, plain].forEach((id) => finishTask(id, TASK_STATUSES.COMPLETED));
    holdTaskSession(kept, vi.fn());
    updateTask(saved, { evidenceId: 'E1' });
    renderTasks();
    const tab = (name) => screen.getByRole('radio', { name });
    // (The scope dropdown has options too.)
    const listed = () => screen.queryAllByRole('option').map((row) => ['Kept run', 'Saved run', 'Plain run'].find((title) => row.textContent.includes(title))).filter(Boolean);
    expect(tab(/^Kept/)).toHaveTextContent('1');
    expect(tab(/^Saved/)).toHaveTextContent('1');
    await userEvent.click(tab(/^Saved/));
    expect(listed()).toEqual(['Saved run']);
    // No task is open until one is picked from this tab's list.
    expect(screen.getByText('No task selected')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /^Task / })).not.toBeInTheDocument();
    // The keyboard still reaches the list.
    expect(screen.getByRole('option', { name: /Saved run/ })).toHaveAttribute('tabindex', '0');
    await userEvent.click(tab(/^Kept/));
    // Opening Kept says its runs are using sessions.
    expect(screen.getByRole('dialog', { name: 'This run is using a session' })).toHaveTextContent('1 of your 3 analysis sessions');
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(listed()).toEqual(['Kept run']);
    // Released: it leaves the tab, which then says what it is for.
    await userEvent.click(screen.getByRole('option', { name: /Kept run/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Release session' }));
    expect(listed()).toEqual([]);
    expect(screen.getByText(/^No session is kept/)).toBeInTheDocument();
    // Nothing kept: opening it again needs no notice.
    await userEvent.click(tab(/^All/));
    await userEvent.click(tab(/^Kept/));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
  });

  describe('Show graph', () => {
    const button = () => screen.queryByRole('button', { name: /Show graph/ });
    const openSource = (id = 'source-1', session = '1_111378') => act(() => workspaceRef.openWindow('source', { id, sourceSessionId: session }));
    const run = (fields = {}) => {
      let id;
      act(() => {
        id = createTask({ title: 'Link Analysis', windowId: 'source-1', sourceSessionId: '1_111378', action: 'Link Analysis', ...fields });
        markTaskRunning(id);
        requestTaskFocus(id);
      });
      return id;
    };
    const end = (id, status = TASK_STATUSES.COMPLETED) => act(() => { finishTask(id, status); });

    it('a completed run: shown while its Source window is open, gone when it closes', async () => {
      const apiFetch = vi.fn(async () => ({ message: 'success' }));
      renderTasks({ apiFetch });
      openSource();
      const id = run();
      end(id);
      await userEvent.click(button());
      // Linked first, as production does, then loaded at once.
      expect(apiFetch).toHaveBeenCalledWith('/graph_link', expect.objectContaining({ body: expect.objectContaining({ id: 'link', source_id: '1_111378' }) }));
      const graph = workspaceRef.windows.find((item) => item.type === 'graph');
      expect(graph.metadata).toMatchObject({ taskId: id, graphLinkSource: '1_111378', graphFinishedRun: true });
      act(() => workspaceRef.closeWindow('source-1'));
      expect(button()).not.toBeInTheDocument();
    });

    it('links again after a failed link, in the same Graph window', async () => {
      let ok = false;
      const apiFetch = vi.fn(async (path) => (path === '/graph_link' && !ok ? { message: 'failed!' } : { message: 'success' }));
      renderTasks({ apiFetch });
      openSource();
      end(run());
      await userEvent.click(button());
      expect(workspaceRef.windows.find((item) => item.type === 'graph').metadata.graphLinkSource).toBeFalsy();
      ok = true;
      await userEvent.click(button());
      const graphs = workspaceRef.windows.filter((item) => item.type === 'graph');
      expect(graphs).toHaveLength(1);
      expect(graphs[0].metadata.graphLinkSource).toBe('1_111378');
    });

    it('a Graph window opened during the run is told to load once it has completed', async () => {
      renderTasks();
      openSource();
      const id = run();
      await userEvent.click(button());
      expect(workspaceRef.windows.find((item) => item.type === 'graph').metadata.graphFinishedRun).toBeUndefined();
      end(id);
      await userEvent.click(button());
      expect(workspaceRef.windows.filter((item) => item.type === 'graph')).toHaveLength(1);
      expect(workspaceRef.windows.find((item) => item.type === 'graph').metadata.graphFinishedRun).toBe(true);
    });

    it('a background run: shown while it runs, gone when it completes', () => {
      renderTasks();
      const id = run();
      expect(button()).toBeInTheDocument();
      end(id);
      expect(button()).not.toBeInTheDocument();
    });

    it.each([TASK_STATUSES.TERMINATED, TASK_STATUSES.FAILED])('a run that ended as %s has none', (status) => {
      renderTasks();
      openSource();
      end(run(), status);
      expect(button()).not.toBeInTheDocument();
    });

    it('a run listed by the Service has none, even when a new Source window reuses its session id', () => {
      renderTasks();
      openSource();
      act(() => {
        const id = applyServerTask({ task_id: 'T1', origin: 'analyst', status: 'completed', source_session_id: '1_111378' });
        requestTaskFocus(id);
      });
      expect(screen.getByRole('region', { name: /^Task / })).toBeInTheDocument();
      expect(button()).not.toBeInTheDocument();
    });

    it('only the latest run of a window has one: they share the session', () => {
      renderTasks();
      openSource();
      const first = run();
      end(first);
      end(run());
      expect(button()).toBeInTheDocument();
      act(() => requestTaskFocus(first));
      expect(button()).not.toBeInTheDocument();
    });
  });
});
