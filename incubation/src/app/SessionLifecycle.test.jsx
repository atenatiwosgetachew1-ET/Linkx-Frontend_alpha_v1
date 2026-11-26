// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const auth = { user: { username: 'analyst' }, token: 't', logout: vi.fn(), verifyToken: vi.fn() };
const session = {};
const notify = vi.fn();

vi.mock('../auth/useAuth.js', () => ({ useAuth: () => auth }));
vi.mock('../shared/session/useSession.js', () => ({ useSession: () => session }));
vi.mock('../shared/notifications/useNotifications.js', () => ({ useNotifications: () => ({ notify }) }));
vi.mock('../workspace/hooks/useWorkspace.js', () => ({ useWorkspace: () => ({ windows: [] }) }));
vi.mock('../auth/WorkspaceLockOverlay.jsx', () => ({
  default: ({ onUnlock, onLogout, isUnlocking }) => (
    <div role="dialog" aria-label="Workspace locked">
      <button type="button" disabled={isUnlocking} onClick={onUnlock}>Unlock Workspace</button>
      <button type="button" onClick={onLogout}>Sign Out</button>
    </div>
  ),
}));

const { applyServerTask, createTask, linkServerTask, resetTasks } = await import('../features/tasks/lib/taskRegistry.js');
const { default: SessionLifecycle } = await import('./SessionLifecycle.jsx');

function Harness({ initiallyLocked = true }) {
  const [locked, setLocked] = useState(initiallyLocked);
  return (
    <SessionLifecycle isLocked={locked} setLocked={setLocked} loginLogo="">
      {(performLogout) => <button type="button" onClick={() => performLogout('user_logout')}>Menu sign out</button>}
    </SessionLifecycle>
  );
}

beforeEach(() => {
  Object.assign(session, {
    socket: null,
    idleSettings: { enabled: false, warningMs: 1, lockMs: 2, timeoutMs: 3 },
    lockBackendSession: vi.fn(),
    unlockBackendSession: vi.fn(async () => ''),
    notifyBackendLogout: vi.fn(async () => {}),
    notifyIdleTimeout: vi.fn(async () => {}),
    reinitializeSession: vi.fn(async () => 'main-1'),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SessionLifecycle (production lock / unlock / logout flow)', () => {
  it('unlocks on the backend, re-binds the session, then hides the overlay', async () => {
    session.unlockBackendSession.mockResolvedValueOnce('fresh-token');
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Unlock Workspace' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(session.unlockBackendSession).toHaveBeenCalledWith({ reason: 'idle_lock' });
    expect(auth.verifyToken).toHaveBeenCalledWith('fresh-token');
    expect(session.reinitializeSession).toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('signs out when the backend refuses the unlock', async () => {
    session.unlockBackendSession.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 401 }));
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Unlock Workspace' }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
    expect(session.notifyBackendLogout).toHaveBeenCalledWith('unlock_failed');
  });

  it('releases the backend lock before logging out from the lock screen', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
    expect(session.unlockBackendSession).toHaveBeenCalledWith({ reason: 'logout_unlock', quiet: true });
    expect(session.notifyBackendLogout).toHaveBeenCalledWith('user_logout');
  });

  it('tells the backend about a normal sign-out without unlocking', async () => {
    render(<Harness initiallyLocked={false} />);
    await act(async () => { await userEvent.click(screen.getByRole('button', { name: 'Menu sign out' })); });
    await waitFor(() => expect(auth.logout).toHaveBeenCalled());
    expect(session.unlockBackendSession).not.toHaveBeenCalled();
    expect(session.notifyBackendLogout).toHaveBeenCalledWith('user_logout');
  });
});

describe('idle sign-out', () => {
  afterEach(() => {
    resetTasks();
    vi.useRealTimers();
  });
  it.each([
    ['no run', undefined, ''],
    ['a run without a seat', false, 'Signing out stops your running analysis.'],
    ['a run with a seat', true, ''],
  ])('%s', async (_name, unattended, said) => {
    vi.useFakeTimers();
    if (unattended !== undefined) {
      const id = createTask({ windowId: 'w1', sourceSessionId: '1_9' });
      linkServerTask(id, 'T1');
      applyServerTask({ task_id: 'T1', status: 'running', unattended });
    }
    Object.assign(session, { idleSettings: { enabled: true, warningMs: 1, lockMs: 2, timeoutMs: 3 } });
    render(<Harness initiallyLocked={false} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    const warning = notify.mock.calls.map(([notice]) => notice).find((notice) => notice.title === 'Inactivity warning').message;
    expect(warning.includes('Signing out stops')).toBe(Boolean(said));
    if (said) expect(warning).toContain(said);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(session.notifyIdleTimeout).toHaveBeenCalled();
  });
});

describe('a domain changed by an administrator (B-47)', () => {
  const setUp = (answer = { message: 'success', results: { configuration: { domain: 'bank', active_domain: 'bank', fetch_columns: ['NEW'] } } }) => {
    const handlers = {};
    Object.assign(session, {
      socket: { on: (name, handler) => { handlers[name] = handler; }, off: vi.fn(), emit: vi.fn(), connected: true },
      mainSessionId: 'main-1',
      configuration: { domain: 'bank', active_domain: 'bank', fetch_columns: ['OLD'] },
      setConfiguration: vi.fn(),
      apiFetch: vi.fn(async () => answer),
    });
    render(<Harness initiallyLocked={false} />);
    return (payload) => act(async () => { await handlers.domain_config_changed(payload); });
  };

  it('its column mapping: said, and the session’s configuration is loaded again', async () => {
    const send = setUp();
    await send({ domain: 'bank', section: 'mapping', version_id: 4 });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Banking settings changed', message: expect.stringContaining('must be made again') }));
    expect(session.apiFetch).toHaveBeenCalledWith('/configuration', expect.objectContaining({ body: { id: 'load', session_id: 'main-1' } }));
    expect(session.setConfiguration.mock.calls[0][0]({}).fetch_columns).toEqual(['NEW']);
  });

  it('a preset is said once; another domain’s change is not said', async () => {
    const send = setUp();
    await send({ domain: 'bank', section: 'sensitivity', version_id: 7 });
    await send({ domain: 'bank', section: 'thresholds', version_id: 7 });
    expect(notify).toHaveBeenCalledTimes(1);
    await send({ domain: 'cdr', section: 'mapping', version_id: 1 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(session.apiFetch).not.toHaveBeenCalled();
  });

  it('a configuration of another domain is not taken', async () => {
    const send = setUp({ message: 'success', results: { configuration: { domain: 'cdr', active_domain: 'cdr' } } });
    await send({ domain: 'bank', section: 'columns', version_id: 2 });
    expect(session.setConfiguration).not.toHaveBeenCalled();
  });
});
