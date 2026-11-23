// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import ActivityLogPanel from './ActivityLogPanel.jsx';

vi.mock('../../../services/configurationApi.js', () => ({
  fetchCleanupAudit: vi.fn(async () => ({
    items: [
      { id: 1, created_at: '2026-11-20T10:00:00Z', session_id: 's1', cleanup_type: 'window', status: 'succeeded', artifacts: { deleted_count: 3, count: 3 } },
      { id: 2, created_at: '2026-11-20T11:00:00Z', session_id: 's2', cleanup_type: 'run', status: 'failed', artifacts: { deleted_count: 1, count: 4 }, error_message: 'boom' },
    ],
    total: 42,
    limit: 20,
    offset: 0,
  })),
  requestSessionCleanup: vi.fn(async () => ({ cleanup_type: 'session', status: 'previewed', dry_run: true })),
}));

afterEach(cleanup);

const renderPanel = (props = {}) => render(
  <NotificationProvider>
    <ActivityLogPanel apiFetch={vi.fn()} canManage defaultSessionId="s1" {...props} />
  </NotificationProvider>,
);

describe('Configuration · Activity log', () => {
  it('sums the log up in the header and lists it with status tags and paging', async () => {
    renderPanel();
    // The Linkx load screen stands in for the table until the log arrives.
    expect(screen.getByRole('status')).toHaveTextContent('Loading cleanup activity…');
    const table = await screen.findByRole('table', { name: 'Cleanup activity' });
    expect(within(table).getByText('succeeded')).toHaveClass('is-ok');
    expect(within(table).getByText('failed')).toHaveClass('is-bad');
    const figures = screen.getByLabelText('Cleanup figures');
    expect(within(figures).getByText('42')).toBeInTheDocument();
    expect(within(figures).getByText('4')).toBeInTheDocument(); // artifacts removed on this page
    const log = screen.getByRole('region', { name: 'Cleanup activity' });
    expect(log).toHaveTextContent('1–2 of 42');
    expect(within(log).getByRole('button', { name: 'Prev' })).toBeDisabled();
    expect(within(log).getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('previews a cleanup and shows what came back', async () => {
    renderPanel();
    const form = screen.getByRole('region', { name: 'Manual cleanup' });
    expect(within(form).getByLabelText(/Session ID/)).toHaveValue('s1');
    expect(within(form).getByRole('switch', { name: /Preserve session configuration/ })).toBeChecked();
    await userEvent.click(within(form).getByRole('button', { name: 'Preview cleanup' }));
    expect(await within(form).findByRole('status')).toHaveTextContent('Cleanup preview completed.');
    expect(within(form).getByLabelText('Cleanup result')).toHaveTextContent('previewed');
  });

  it('explains itself without users:manage', () => {
    renderPanel({ canManage: false });
    expect(screen.getByText('Requires users:manage')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
