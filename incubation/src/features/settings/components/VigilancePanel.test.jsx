// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import VigilancePanel from './VigilancePanel.jsx';

afterEach(cleanup);

const health = (checkpoint = {}) => ({
  success: true,
  checkpoint: { feed_name: 'BDR Transactions', last_window_end: '2026-11-20 08:00:00', total_graph_analyzed: 12500, status: 'active', is_paused: false, ...checkpoint },
  recent_runs: [
    { run_id: 'r1', window_start: '2026-11-20 07:00:00', window_end: '2026-11-20 07:30:00', duration_ms: 1200, records_count: 40, status: 'success' },
    { run_id: 'r2', window_start: '2026-11-20 07:30:00', window_end: '2026-11-20 08:00:00', duration_ms: 800, records_count: 10, status: 'failed', error_message: 'Boom' },
    { run_id: 'r3', window_start: '2026-11-20 08:00:00', window_end: '2026-11-20 08:30:00', duration_ms: null, records_count: 0, status: 'running' },
  ],
});

const renderPanel = (props = {}, payload = health()) => {
  const apiFetch = vi.fn(async (url, options) => (options?.method === 'POST' ? { success: true } : payload));
  const onOpenFindings = vi.fn();
  const notify = vi.fn();
  render(<VigilancePanel apiFetch={apiFetch} canManage isCdr={false} notify={notify} onOpenFindings={onOpenFindings} {...props} />);
  return { apiFetch, onOpenFindings, notify };
};

describe('VigilancePanel', () => {
  it('shows the engine state, its figures and the audit log', async () => {
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'BDR Transactions' })).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    const figures = screen.getByLabelText('Engine figures');
    expect(figures).toHaveTextContent((12500).toLocaleString());
    expect(within(figures).getByText('Succeeded').parentElement).toHaveTextContent('1');
    expect(within(figures).getByText('Failed').parentElement).toHaveTextContent('1');
    expect(within(figures).getByText('Average duration').parentElement).toHaveTextContent((1000).toLocaleString());
    // The running run leads the log.
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('r3');
    expect(rows).toHaveLength(3);
  });

  it('pauses the engine, opens findings and shows a run error', async () => {
    const { apiFetch, onOpenFindings } = renderPanel();
    await userEvent.click(await screen.findByRole('switch'));
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/reports/xvigilance/state', { method: 'POST', body: { is_paused: true } });

    await userEvent.click(screen.getByRole('button', { name: 'Show findings' }));
    expect(onOpenFindings).toHaveBeenCalledWith({ tab: 'xvigilance' });

    await userEvent.click(screen.getByRole('button', { name: 'View error' }));
    expect(screen.getByText('Boom')).toBeInTheDocument();
    // Opening the error does not open the run's findings.
    expect(onOpenFindings).toHaveBeenCalledTimes(1);
  });

  it('hides the engine controls without the manage permission', async () => {
    renderPanel({ canManage: false });
    await screen.findByRole('heading', { name: 'BDR Transactions' });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Re-analyze/ })).not.toBeInTheDocument();
  });
});
