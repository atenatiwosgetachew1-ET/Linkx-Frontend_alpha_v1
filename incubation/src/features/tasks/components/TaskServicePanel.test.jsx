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
import { createTask, getTask, linkServerTask, resetTasks, updateTask } from '../lib/taskRegistry.js';

afterEach(() => {
  cleanup();
  resetTasks();
});

const show = (apiFetch) => {
  const id = createTask({ title: 'Link Analysis' });
  linkServerTask(id, 'T1');
  updateTask(id, { status: 'completed' });
  const auth = { hasPermission: (permission) => permission === 'evidence:create' };
  render(
    <AuthContext.Provider value={auth}>
      <SessionContext.Provider value={{ apiFetch }}>
        <NotificationProvider><WorkspaceProvider><TaskServicePanel task={getTask(id)} /></WorkspaceProvider></NotificationProvider>
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
});
