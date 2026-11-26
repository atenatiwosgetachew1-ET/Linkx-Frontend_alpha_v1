// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import SystemDashboard from './SystemDashboard.jsx';
import { createTask, markTaskRunning, resetTasks } from '../../features/tasks/lib/taskRegistry.js';
import { resetSeats } from '../../features/tasks/lib/unattendedSeats.js';

vi.mock('../../shared/session/useSession.js', () => ({
  useSession: () => ({ configuration: { active_domain: 'bank', active_rule: 'FUND_FLOW' }, isSocketConnected: true, mainSessionId: 's-1' }),
}));
const permissions = vi.hoisted(() => ({ granted: [] }));
vi.mock('../../auth/useCan.js', () => ({ useCan: () => (permission) => permissions.granted.includes(permission) }));

afterEach(() => {
  cleanup();
  permissions.granted = [];
  resetTasks();
  resetSeats();
});

const usage = { used: 1, limit: 3, openWindows: 1, background: 0, quick: 0, held: 0 };

describe('System panel', () => {
  it('an analyst sees their own work and the session, not the team or the Service', () => {
    render(<SystemDashboard sessionUsage={usage} openWindowsCount={2} />);
    expect(screen.getByRole('tab', { name: /Your work/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('article', { name: 'Analysis sessions' })).toHaveTextContent('1 of 3');
    // Its chart says the same figures in words.
    expect(screen.getByRole('figure', { name: /^Analysis sessions: Source windows 1, Background 0/ })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: /^Your tasks ended, last 7 days/ })).toBeInTheDocument();
    expect(screen.queryByRole('article', { name: 'Session' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: /Session and this computer/ }));
    expect(screen.getByRole('article', { name: 'Session' })).toHaveTextContent('Connected');
    expect(screen.getByRole('article', { name: 'Session' })).toHaveTextContent('FUND_FLOW');
    expect(screen.getByText('Analyst view')).toBeInTheDocument();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([expect.stringMatching(/^Your work/), expect.stringMatching(/^Session and this computer/)]);
  });

  it('a chart mark tells its figure in a tooltip, on the pointer and on focus', () => {
    render(<SystemDashboard sessionUsage={usage} />);
    const mark = screen.getByRole('img', { name: 'Place 1 of 3: Taken Source windows' });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.pointerEnter(mark);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Place 1 of 3TakenSource windows');
    fireEvent.pointerLeave(mark);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole('img', { name: 'Place 3 of 3: Open Free' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Place 3 of 3OpenFree');
  });

  it('scrolling sideways past the last cards turns to the next tab, and back past the first', () => {
    render(<SystemDashboard sessionUsage={usage} />);
    fireEvent.wheel(screen.getByRole('group', { name: 'Your work cards' }), { deltaX: 120 });
    expect(screen.getByRole('tab', { name: /Session and this computer/ })).toHaveAttribute('aria-selected', 'true');
    // Up and down is left to the central panels.
    fireEvent.wheel(screen.getByRole('group', { name: 'Session and this computer cards' }), { deltaY: 300 });
    expect(screen.getByRole('tab', { name: /Session and this computer/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.wheel(screen.getByRole('group', { name: 'Session and this computer cards' }), { deltaX: -120 });
    expect(screen.getByRole('tab', { name: /Your work/ })).toHaveAttribute('aria-selected', 'true');
  });

  it('counts the tasks the registry holds; nothing else', () => {
    render(<SystemDashboard sessionUsage={usage} />);
    const card = screen.getByRole('article', { name: 'Your tasks' });
    expect(card).toHaveTextContent('0running');
    expect(card).toHaveTextContent('No tasks yet.');
    act(() => { markTaskRunning(createTask({ title: 'Run A' }).id); });
    expect(card).toHaveTextContent('1running');
    expect(card).toHaveTextContent('Latest: Run A');
  });

  it('a supervisor sees the team section, filled only once all tasks are loaded', () => {
    permissions.granted = ['tasks:read_all'];
    render(<SystemDashboard sessionUsage={usage} />);
    fireEvent.click(screen.getByRole('tab', { name: /Team/ }));
    const team = screen.getByRole('tabpanel', { name: /^Team/ });
    expect(within(team).getByRole('article', { name: 'Team tasks' })).toHaveTextContent('Shown once All tasks is opened');
  });

  it('an administrator gets users and the feed from the Service, only while shown', async () => {
    permissions.granted = ['users:manage'];
    const apiFetch = vi.fn(async (path) => (path.startsWith('/auth/admin/users')
      ? [{ is_active: true }, { is_active: false }]
      : path.includes('/health') ? { success: true, checkpoint: { status: 'running', total_graph_analyzed: 4 }, recent_runs: [] } : { seats: { total: 2, available: 1 } }));
    const { rerender } = render(<SystemDashboard sessionUsage={usage} apiFetch={apiFetch} />);
    expect(apiFetch).not.toHaveBeenCalled();
    rerender(<SystemDashboard visible sessionUsage={usage} apiFetch={apiFetch} />);
    await waitFor(() => expect(screen.getByRole('article', { name: 'Unattended runs' })).toHaveTextContent('1 of 2 free'));
    fireEvent.click(screen.getByRole('tab', { name: /Administration/ }));
    const users = await screen.findByRole('article', { name: 'Users' });
    await waitFor(() => expect(users).toHaveTextContent('2accounts'));
    expect(users).toHaveTextContent('Turned off1');
    await waitFor(() => expect(screen.getByRole('article', { name: 'xVigilance feed' })).toHaveTextContent('Graphs analysed4'));
    // Arrow keys move between the tabs.
    fireEvent.keyDown(screen.getByRole('tab', { name: /Administration/ }), { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Your work/ })).toHaveAttribute('aria-selected', 'true');
  });
});
