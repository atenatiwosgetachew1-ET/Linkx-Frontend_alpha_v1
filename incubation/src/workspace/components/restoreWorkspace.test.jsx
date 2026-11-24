// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import { useWorkspace } from '../hooks/useWorkspace.js';
import { WorkspaceProvider } from '../state/WorkspaceContext.jsx';
import { createTask, markTaskRunning, resetTasks } from '../../features/tasks/lib/taskRegistry.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  resetTasks();
});

let ws;
function Probe() {
  ws = useWorkspace();
  return null;
}
const settle = (ms = 700) => act(async () => { await new Promise((resolve) => { setTimeout(resolve, ms); }); });

const open = ({ user = { id: 1, username: 'ana' }, main = '9', refuse = null, permissions = null } = {}) => {
  const calls = [];
  const apiFetch = vi.fn(async (path, options = {}) => {
    calls.push([path, options.body]);
    if (path === '/init_source') {
      if (refuse) throw Object.assign(new Error('x'), refuse);
      return { results: { source_id: `${options.body.window_id}_${options.body.session_id}` } };
    }
    return { message: 'success', data: [] };
  });
  const onSignOut = vi.fn();
  const auth = { user, hasRole: () => false, hasPermission: (permission) => !permissions || permissions.includes(permission) };
  const view = render(
    <AuthContext.Provider value={auth}>
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch, socket: null, configuration: {}, mainSessionId: main }}>
          <WorkspaceProvider>
            <Probe />
            <WorkspaceFrame user={user} token="t" mainSessionId={main} onSignOut={onSignOut} logoSrc="logo.png" />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>
    </AuthContext.Provider>,
  );
  return { ...view, onSignOut, of: (path) => calls.filter(([name]) => name === path).map(([, body]) => body) };
};
const fill = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Source' }));
  await waitFor(() => expect(frame.windows).toHaveLength(1));
  act(() => {
    frame.openWindow('graph', { id: 'graph-a', customTitle: 'Evidence 7', metadata: { evidence: { traceId: 't7' }, windowPosition: { x: 10, y: 20 } } });
    frame.openWindow('graph', { id: 'graph-b', metadata: { graphLinkSource: '1_9' } });
    frame.openWindow('table', { metadata: { tableGraph: 'graph-a' } });
    frame.openWindow('tasks', {});
  });
};
const offer = () => screen.queryByRole('dialog', { name: 'Restore your last workspace?' });
const reopen = async (first, options) => {
  first.unmount();
  const next = open(options);
  await settle(400);
  return next;
};

describe('restoring the last workspace', () => {
  it('asks, says what comes back, and restores into new sessions', async () => {
    const first = open();
    await settle(400);
    expect(offer()).not.toBeInTheDocument();
    await fill();
    await settle();
    const next = await reopen(first);
    const pills = within(screen.getByRole('list', { name: 'Windows' })).getAllByRole('note');
    expect(pills).toHaveLength(5);
    // Every pill says in its tooltip, and to a screen reader, what comes back.
    const tooltips = pills.map((pill) => pill.dataset.tooltip);
    expect(tooltips[0]).toMatch(/^Comes back in part\. Its setup returns in a new session/);
    expect(tooltips[1]).toMatch(/^Comes back\. Loaded again from the saved evidence/);
    expect(tooltips[2]).toMatch(/^Cannot come back\. .*session has ended/);
    expect(tooltips[4]).toBe('Comes back. Where it was, as it was.');
    pills.forEach((pill, index) => {
      expect(pill).toHaveAccessibleName(expect.stringContaining(tooltips[index]));
      expect(pill).toHaveAttribute('tabindex', '0');
    });
    expect(pills[1]).toHaveTextContent('Evidence 7');
    // Escape is not an answer.
    await userEvent.keyboard('{Escape}');
    expect(offer()).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(frame.windows).toHaveLength(5));
    expect(offer()).not.toBeInTheDocument();
    const [source, evidence, lost, table, tasks] = frame.windows;
    // A number the main session never used.
    expect(next.of('/init_source')).toEqual([expect.objectContaining({ window_id: 2, session_id: '9' })]);
    expect(source).toMatchObject({ type: 'source', sourceSessionId: '2_9', backendWindowId: expect.anything() });
    expect(evidence).toMatchObject({ customTitle: 'Evidence 7', metadata: { evidence: { traceId: 't7' }, windowPosition: { x: 10, y: 20 } } });
    expect(lost.metadata).toMatchObject({ restoredNote: expect.stringContaining('session has ended') });
    expect(lost.metadata.graphLinkSource).toBeUndefined();
    // Linked again, by its new id.
    expect(table.metadata.tableGraph).toBe(evidence.id);
    expect(tasks.type).toBe('tasks');
    expect(new Set(frame.windows.map((item) => item.id)).size).toBe(5);
  });

  it('starting fresh forgets it', async () => {
    const first = open();
    await settle(400);
    act(() => frame.openWindow('tasks', {}));
    await settle();
    const second = await reopen(first);
    await userEvent.click(screen.getByRole('button', { name: 'Start fresh' }));
    expect(frame.windows).toHaveLength(0);
    await reopen(second);
    expect(offer()).not.toBeInTheDocument();
  });

  it('is kept until answered, offered after a new sign-in, and to its user only', async () => {
    const first = open();
    await settle(400);
    act(() => frame.openWindow('tasks', {}));
    await settle();
    const other = await reopen(first, { user: { id: 2, username: 'ben' }, main: '10' });
    expect(offer()).not.toBeInTheDocument();
    const again = await reopen(other, { main: '11' });
    expect(offer()).toBeInTheDocument();
    await reopen(again, { main: '12' });
    expect(offer()).toBeInTheDocument();
  });

  it('says what was refused, and restores the rest', async () => {
    const first = open();
    await settle(400);
    await fill();
    await settle();
    await reopen(first, { refuse: { status: 429, data: { code: 'session_limit', detail: 'Three sessions are open.' } } });
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(frame.windows).toHaveLength(4));
    expect(screen.getByText(/Three sessions are open/)).toBeInTheDocument();
  });

  it('does not open what the account may not', async () => {
    const first = open();
    await settle(400);
    act(() => { frame.openWindow('configuration', {}); frame.openWindow('tasks', {}); });
    await settle();
    await reopen(first, { permissions: ['graph:create'] });
    await userEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(frame.windows.map((item) => item.type)).toEqual(['tasks']));
  });

  it('does nothing when the setting is off', async () => {
    localStorage.setItem('linkx_settings_remember_layout', 'false');
    const first = open();
    await settle(400);
    act(() => frame.openWindow('tasks', {}));
    await settle();
    await reopen(first);
    expect(offer()).not.toBeInTheDocument();
  });
});

describe('leaving', () => {
  const beforeUnload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  const running = () => act(() => { markTaskRunning(createTask({ title: 'LA', windowId: 'x', sourceSessionId: '1_9' })); });

  it('warns on reload and sign-out only when something would be lost', async () => {
    const { onSignOut } = open();
    await settle(400);
    expect(beforeUnload()).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    running();
    expect(beforeUnload()).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('dialog', { name: 'Sign out now?' })).toHaveTextContent('1 running analysis will be stopped.');
    await userEvent.click(screen.getByRole('button', { name: 'Stay' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out anyway' }));
    expect(onSignOut).toHaveBeenCalledTimes(2);
  });

  it('closes the Source sessions of a page that goes away', async () => {
    const page = open();
    await settle(400);
    await userEvent.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(ws.windows).toHaveLength(1));
    act(() => { window.dispatchEvent(new Event('pagehide')); });
    expect(page.of('/close_source_window')).toEqual([expect.objectContaining({ window_id: 1, session_id: '9', reason: 'page_closed' })]);
  });
});
