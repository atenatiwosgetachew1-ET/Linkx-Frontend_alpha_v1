// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

let frame;
vi.mock('./WindowManager.jsx', () => ({ default: ({ workspace }) => { frame = workspace; return null; } }));
vi.mock('./WorkspaceHome.jsx', () => ({ default: () => null }));
vi.mock('./RightWorkspace.jsx', () => ({ default: () => null }));
vi.mock('./NetworkBackground.jsx', () => ({ default: () => null }));

import WorkspaceFrame from './WorkspaceFrame.jsx';
import { AuthContext } from '../../auth/authContext.js';
import { SessionContext } from '../../shared/session/sessionContext.js';
import { NotificationProvider } from '../../shared/notifications/NotificationContext.jsx';
import { isRunGraphAvailable } from '../../features/graph/lib/graphLinkFlow.js';
import { markStreamActive } from '../../features/source/lib/activeStreams.js';
import { WorkspaceProvider } from '../state/WorkspaceContext.jsx';
import { createTask, finishTask, getSessionUsage, getTask, linkServerTask, markTaskRunning, releaseTaskSession, removeFinishedTasks, resetTasks, updateTask } from '../../features/tasks/lib/taskRegistry.js';

afterEach(() => {
  cleanup();
  resetTasks();
});

const start = ({ evidence = { id: 'E1', has_graph: true }, permissions = null } = {}) => {
  const calls = [];
  const apiFetch = vi.fn(async (path, options = {}) => {
    calls.push([path, options.body]);
    if (path === '/api/v1/reports/evidence') return { evidence };
    return { message: 'success', data: [] };
  });
  const auth = { user: { username: 'a' }, hasRole: () => false, hasPermission: (permission) => !permissions || permissions.includes(permission) };
  render(
    <AuthContext.Provider value={auth}>
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch, socket: null, configuration: {}, mainSessionId: '9' }}>
          <WorkspaceProvider>
            <WorkspaceFrame user={{ username: 'a' }} token="t" mainSessionId="9" onSignOut={() => {}} logoSrc="logo.png" />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>
    </AuthContext.Provider>,
  );
  act(() => frame.openWindow('source', { id: 'source-1', title: 'Source', sourceSessionId: '1_9', parentSessionId: '9', backendWindowId: '1' }));
  return { of: (path) => calls.filter(([name]) => name === path).map(([, body]) => body) };
};
const completed = (fields = {}) => {
  let id;
  act(() => {
    id = createTask({ title: 'Link Analysis', windowId: 'source-1', sourceSessionId: '1_9' });
    markTaskRunning(id);
    linkServerTask(id, 'T1');
    finishTask(id, 'completed');
    updateTask(id, fields);
  });
  return id;
};
const close = () => act(() => frame.closeWindow('source-1'));
const isOpen = () => frame.windows.some((item) => item.id === 'source-1');
const prompt = () => screen.queryByRole('dialog', { name: 'Save this run first?' });

describe('closing a Source window whose completed run is not saved', () => {
  it('asks first; saving keeps the graph, then closes', async () => {
    const service = start();
    const id = completed();
    close();
    expect(prompt()).toBeInTheDocument();
    expect(isOpen()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Save as evidence' }));
    expect(screen.getByRole('checkbox', { name: 'Keep a snapshot of the graph' })).toBeChecked();
    expect(service.of('/close_source_window')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(isOpen()).toBe(false));
    expect(service.of('/api/v1/reports/evidence')[0]).toMatchObject({ task_id: 'T1', include_graph: true });
    expect(getTask(id).evidenceId).toBe('E1');
    await waitFor(() => expect(service.of('/close_source_window')).toHaveLength(1));
  });

  it('closes without saving, or not at all', async () => {
    const service = start();
    completed();
    close();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(isOpen()).toBe(true);
    close();
    await userEvent.keyboard('{Escape}');
    expect(isOpen()).toBe(true);
    close();
    await userEvent.click(screen.getByRole('button', { name: 'Close without saving' }));
    expect(isOpen()).toBe(false);
    expect(service.of('/api/v1/reports/evidence')).toHaveLength(0);
  });

  it('leaves the window open when the Service kept no graph', async () => {
    const service = start({ evidence: { id: 'E1', has_graph: false } });
    completed();
    close();
    await userEvent.click(screen.getByRole('button', { name: 'Save as evidence' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved without its graph')).toBeInTheDocument();
    expect(isOpen()).toBe(true);
    expect(service.of('/close_source_window')).toHaveLength(0);
    // Saved now, so closing again does not ask.
    close();
    expect(prompt()).not.toBeInTheDocument();
    expect(isOpen()).toBe(false);
  });

  it.each([
    ['already saved', {}, { evidenceId: 'E0' }],
    ['another analyst’s run', {}, { foreign: true }],
    ['expired', {}, { lifecycle: 'expired' }],
    ['no evidence:create', { permissions: ['source:create'] }, {}],
  ])('does not ask: %s', (_name, options, fields) => {
    start(options);
    completed(fields);
    close();
    expect(prompt()).not.toBeInTheDocument();
    expect(isOpen()).toBe(false);
  });

  it('does not ask when nothing was run', () => {
    start();
    close();
    expect(prompt()).not.toBeInTheDocument();
    expect(isOpen()).toBe(false);
  });
});

describe('a background run and its session', () => {
  const background = async () => {
    let id;
    act(() => {
      id = createTask({ title: 'Link Analysis', windowId: 'source-1', sourceSessionId: '1_9' });
      markTaskRunning(id);
      linkServerTask(id, 'T1');
      markStreamActive('source-1', { sourceSessionId: '1_9' });
    });
    close();
    await userEvent.click(screen.getByRole('button', { name: 'Keep running in background' }));
    expect(isOpen()).toBe(false);
    return id;
  };
  const end = async (id, status) => {
    act(() => { finishTask(id, status); });
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 500); }); });
  };

  it('keeps the session of a completed run until it is released', async () => {
    const service = start();
    const id = await background();
    await end(id, 'completed');
    expect(service.of('/close_source_window')).toHaveLength(0);
    expect(isRunGraphAvailable(getTask(id), frame.windows)).toBe(true);
    // It counts as a session, and Clear does not drop it.
    expect(getSessionUsage(0)).toMatchObject({ used: 1, held: 1, background: 0 });
    act(() => removeFinishedTasks());
    expect(getTask(id)).not.toBeNull();
    act(() => { releaseTaskSession(id); });
    expect(service.of('/close_source_window')).toEqual([expect.objectContaining({ window_id: 1, reason: 'background_task_released' })]);
    expect(isRunGraphAvailable(getTask(id), frame.windows)).toBe(false);
    expect(getSessionUsage(0).used).toBe(0);
    // Once only.
    act(() => { releaseTaskSession(id); });
    expect(service.of('/close_source_window')).toHaveLength(1);
  });

  it.each(['failed', 'terminated'])('frees the session of a run that %s', async (status) => {
    const service = start();
    const id = await background();
    await end(id, status);
    expect(service.of('/close_source_window')).toHaveLength(1);
    expect(getSessionUsage(0).used).toBe(0);
  });

  it('frees a kept session when the page goes away', async () => {
    const service = start();
    await end(await background(), 'completed');
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(service.of('/close_source_window')).toHaveLength(1);
  });
});
