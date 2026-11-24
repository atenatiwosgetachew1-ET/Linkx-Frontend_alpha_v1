// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import TaskServicePanel from './TaskServicePanel.jsx';
import { AuthContext } from '../../../auth/authContext.js';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { createTask, getTask, holdTaskSession, linkServerTask, resetTasks, updateTask } from '../lib/taskRegistry.js';

afterEach(() => {
  cleanup();
  resetTasks();
});

const show = (apiFetch, props = {}) => {
  const id = createTask({ title: 'Link Analysis' });
  linkServerTask(id, 'T1');
  updateTask(id, { status: 'completed' });
  const auth = { hasPermission: (permission) => permission === 'evidence:create' };
  render(
    <AuthContext.Provider value={auth}>
      <SessionContext.Provider value={{ apiFetch }}>
        <NotificationProvider><WorkspaceProvider><TaskServicePanel task={getTask(id)} {...props} /></WorkspaceProvider></NotificationProvider>
      </SessionContext.Provider>
    </AuthContext.Provider>,
  );
  return id;
};

describe('Save as evidence (H-6)', () => {
  it('opens the popup, offers saving without the graph when it cannot be reached, then saves', async () => {
    const apiFetch = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503, data: { code: 'graph_unavailable' } }))
      .mockResolvedValueOnce({ evidence: { id: 'E1' }, created: true });
    const id = show(apiFetch);
    await userEvent.click(screen.getByRole('button', { name: 'Save as evidence' }));
    const dialog = screen.getByRole('dialog', { name: 'Save as evidence' });
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('Link Analysis #1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/save without the graph/i);
    await userEvent.click(screen.getByRole('button', { name: 'Save without the graph' }));
    expect(apiFetch.mock.calls[1][1].body).toMatchObject({ task_id: 'T1', include_graph: false, title: 'Link Analysis #1' });
    expect(dialog).not.toBeInTheDocument();
    expect(getTask(id).evidenceId).toBe('E1');
  });

  const save = async (apiFetch, props) => {
    show(apiFetch, props);
    await userEvent.click(screen.getByRole('button', { name: 'Save as evidence' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
  };

  it('does not ask for a graph that cannot be kept, and says why', async () => {
    const apiFetch = vi.fn().mockResolvedValue({ evidence: { id: 'E1', has_graph: false } });
    show(apiFetch, { graphMissing: 'Its Source window is closed, so its graph can no longer be reached.' });
    await userEvent.click(screen.getByRole('button', { name: 'Save as evidence' }));
    const box = screen.getByRole('checkbox', { name: 'Keep a snapshot of the graph' });
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(box).toHaveAccessibleDescription(/Source window is closed/);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(apiFetch.mock.calls[0][1].body.include_graph).toBe(false);
    expect(screen.getByRole('status')).toHaveTextContent('Saved as evidence, without its graph');
  });

  it.each([
    [{ id: 'E1', has_graph: true }, 'Saved as evidence, with its graph'],
    [{ id: 'E1', has_graph: false }, 'but the Service kept no graph with it'],
    [{ id: 'E1' }, 'Saved as evidence (Reports'],
  ])('says what the Service kept: %j', async (evidence, text) => {
    const apiFetch = vi.fn().mockResolvedValue({ evidence });
    await save(apiFetch);
    expect(apiFetch.mock.calls[0][1].body.include_graph).toBe(true);
    expect(await screen.findByRole('status')).toHaveTextContent(text);
  });

  it.each([[true, 1], [false, 0]])('a kept session is freed once the graph is in the record (has_graph %s)', async (hasGraph, times) => {
    const release = vi.fn();
    const id = show(vi.fn().mockResolvedValue({ evidence: { id: 'E1', has_graph: hasGraph } }));
    holdTaskSession(id, release);
    await userEvent.click(screen.getByRole('button', { name: 'Save as evidence' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByRole('status');
    expect(release).toHaveBeenCalledTimes(times);
  });
});
