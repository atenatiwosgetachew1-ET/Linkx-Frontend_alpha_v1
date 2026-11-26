// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { AuthProvider } from './AuthContext.jsx';
import { useAuth } from './useAuth.js';

// A JWT whose exp is `seconds` from now.
const jwt = (name, seconds = 60) => `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds, name }))}.s`;
let auth;
function Probe() {
  auth = useAuth();
  return <p>{auth.user?.username || 'nobody'}|{auth.authMethod}|{auth.signInRequested ? 'page' : 'no-page'}</p>;
}

const answer = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  globalThis.fetch = vi.fn(async (url, options = {}) => {
    if (String(url).endsWith('/auth/auto-login')) return answer({ token: jwt('admin', 3600), user: { username: 'admin' } });
    if (String(url).endsWith('/auth/login')) return answer({ token: jwt('su', 60), user: { username: 'su', roles: ['superuser'] } });
    // /auth/me: the actor of the token sent.
    const sent = String(options.headers?.Authorization || '').split('.')[1] || '';
    return answer({ actor: { username: sent ? JSON.parse(atob(sent)).name : 'nobody' } });
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const calls = (path) => globalThis.fetch.mock.calls.filter(([url]) => String(url).endsWith(path)).length;

describe('auth · signing in as another user while auto-login is on (round 4)', () => {
  it('signs out to the sign-in page, not straight back into the default account', async () => {
    render(<AuthProvider apiUrl="http://s" autoLogin><Probe /></AuthProvider>);
    await screen.findByText('admin|auto|no-page');
    act(() => auth.logout());
    await screen.findByText('nobody|auto|page');
    expect(calls('/auth/auto-login')).toBe(1);
    act(() => auth.continueWithDefault());
    await screen.findByText('admin|auto|no-page');
    expect(calls('/auth/auto-login')).toBe(2);
  });

  it('keeps a password sign-in: auto-login never renews it', async () => {
    render(<AuthProvider apiUrl="http://s" autoLogin><Probe /></AuthProvider>);
    await screen.findByText('admin|auto|no-page');
    act(() => auth.logout());
    await screen.findByText('nobody|auto|page');
    await act(async () => { await auth.login('su', 'secret-pass'); });
    await screen.findByText('su|password|no-page');
    expect(localStorage.getItem('linkx_auth_method')).toBe('password');
    // Its token lapses in a minute: no auto-login renewal is scheduled.
    act(() => window.dispatchEvent(new Event('focus')));
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(calls('/auth/auto-login')).toBe(1);
  });

  it('a reload while on the sign-in page stays there', async () => {
    sessionStorage.setItem('linkx_sign_in_requested', '1');
    render(<AuthProvider apiUrl="http://s" autoLogin><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.isAuthReady).toBe(true));
    expect(screen.getByText('nobody|auto|page')).toBeInTheDocument();
    expect(calls('/auth/auto-login')).toBe(0);
  });

  it('without auto-login nothing changes', async () => {
    render(<AuthProvider apiUrl="http://s"><Probe /></AuthProvider>);
    await waitFor(() => expect(auth.isAuthReady).toBe(true));
    act(() => auth.logout());
    expect(screen.getByText('nobody|password|no-page')).toBeInTheDocument();
  });
});
