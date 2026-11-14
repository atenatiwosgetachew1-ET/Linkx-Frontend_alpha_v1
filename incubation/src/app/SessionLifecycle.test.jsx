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
