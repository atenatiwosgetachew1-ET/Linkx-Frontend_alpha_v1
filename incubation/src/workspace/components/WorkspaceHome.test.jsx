// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import WorkspaceHome from './WorkspaceHome.jsx';
import { applyServerTask, getTasks, markTaskRunning, resetTasks } from '../../features/tasks/lib/taskRegistry.js';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';
import { resetQuickRun, startQuickRun } from '../../features/quick/lib/quickRun.js';
import { quickReview } from '../lib/quickReview.js';
import { resolveSourceDefaults } from '../../features/source/lib/sourceConfig.js';

const configuration = {
  active_domain: 'bank',
  active_kafka_adress: 'broker:9092',
  active_kafka_topic: 'transactions',
  storage_address: 'hdfs://secret-host',
  active_tool: 'neo4j',
  active_tool_url: 'bolt://secret-tool:7687',
  active_tool_database: 'linkx',
  active_rule: 'FUND_FLOW',
};

vi.mock('../../shared/session/useSession.js', () => ({ useSession: () => ({ configuration }) }));

const permissions = vi.hoisted(() => ({ denied: [] }));
vi.mock('../../auth/useCan.js', () => ({ useCan: () => (permission) => !permissions.denied.includes(permission) }));

afterEach(() => {
  cleanup();
  permissions.denied = [];
  resetQuickRun();
  resetTasks();
});

describe('Quick analysis panel', () => {
  it('names what is missing, and records no task or finding by itself', async () => {
    render(<WorkspaceHome signedIn />);
    const panel = screen.getByRole('region', { name: 'Quick analysis' });
    await userEvent.upload(panel.querySelector('input[type="file"]'), new File(['a,b'], 'rows.csv', { type: 'text/csv' }));
    expect(within(panel).getByText('rows.csv')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /Analyze/ })).toBeDisabled();
    expect(within(panel).getByRole('status')).toHaveTextContent('graph tool’s address and user');
    expect(getTasks()).toEqual([]);
    expect(panel).not.toHaveTextContent(/Flagged|Smurfing|ACC-8892|Session #/);
  });

  it('refuses a file that is too large, and one it has no permission for', async () => {
    const { rerender } = render(<WorkspaceHome signedIn />);
    const panel = screen.getByRole('region', { name: 'Quick analysis' });
    const input = panel.querySelector('input[type="file"]');
    const big = new File(['a'], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    await userEvent.upload(input, big);
    expect(panel).toHaveTextContent('over 5 MB');
    permissions.denied = ['batch:upload'];
    await userEvent.upload(input, new File(['a,b'], 'rows.csv', { type: 'text/csv' }));
    rerender(<WorkspaceHome signedIn sessionsFull="" />);
    expect(within(panel).getByRole('status')).toHaveTextContent('needs batch:upload');
  });

  it('offers only Kafka for the last hour', async () => {
    render(<WorkspaceHome signedIn />);
    const panel = screen.getByRole('region', { name: 'Quick analysis' });
    await userEvent.click(within(panel).getByText('Batch Source (1hr)'));
    expect(within(panel).getByRole('button', { name: /Kafka Broker/ })).toBeEnabled();
    expect(within(panel).getByRole('button', { name: /REST API/ })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: /Hadoop/ })).toBeDisabled();
  });

  it('drops a refusal when another source is chosen', async () => {
    render(<WorkspaceHome signedIn />);
    const panel = screen.getByRole('region', { name: 'Quick analysis' });
    await startQuickRun({ input: 'rest_api', defaults: resolveSourceDefaults({}) });
    expect(await within(panel).findByText(/Set the REST API address/)).toBeInTheDocument();
    await userEvent.click(within(panel).getByText('Batch Source (1hr)'));
    await userEvent.click(within(panel).getByRole('button', { name: /Kafka Broker/ }));
    expect(panel).not.toHaveTextContent('Set the REST API address');
  });

  it('shows the rows and flags of a live run while it goes on', async () => {
    const answers = {
      '/init_source': { message: 'success', window_id: 7, source_session_id: '7_main' },
      '/connect_to_source': { message: 'Connection established!' },
      '/connect_to_tool': { message: 'Connected!' },
      '/live_batch_files': { message: 'success', results: { task_id: 'T9' } },
    };
    const defaults = resolveSourceDefaults({ ...configuration, active_tool_username: 'neo' });
    render(<WorkspaceHome signedIn />);
    const panel = screen.getByRole('region', { name: 'Quick analysis' });
    await act(() => startQuickRun({ apiFetch: async (path) => answers[path] || { message: 'success' }, socket: null, mainSessionId: 'main', defaults, input: 'kafka' }));
    act(() => { applyServerTask({ task_id: 'T9', status: 'running', rows_done: 1200 }); });
    const status = () => within(panel).getByRole('status');
    expect(status()).toHaveTextContent('1,200 rows');
    act(() => { markTaskRunning(getTasks()[0].id); });
    expect(status()).toHaveTextContent('No flags so far');
    act(() => { applyServerTask({ task_id: 'T9', status: 'running', rows_done: 2000, verdict: 'suspicious', flags: { FUND_FLOW: 9 } }); });
    expect(status()).toHaveTextContent('Flags so far: FUND_FLOW (9)');
    expect(status()).toHaveTextContent('2,000 rows');
    act(() => { applyServerTask({ task_id: 'T9', status: 'completed', verdict: 'suspicious', flags: { FUND_FLOW: 11 }, quick: true, ended_reason: 'finished' }); });
    expect(status()).toHaveTextContent('Suspicious: FUND_FLOW (11)');
  });

  it('says when no analysis session is free', async () => {
    render(<WorkspaceHome signedIn sessionsFull="All 3 analysis sessions are in use." />);
    const panel = screen.getByRole('region', { name: 'Quick analysis' });
    await userEvent.click(within(panel).getByText('Real-time Source'));
    await userEvent.click(within(panel).getByRole('button', { name: /Kafka broker/ }));
    expect(within(panel).getByRole('status')).toHaveTextContent('All 3 analysis sessions are in use.');
  });

  it('shows the session configuration the input would use', async () => {
    render(<WorkspaceHome />);
    const panel = screen.getByRole('region', { name: 'Quick analysis' });
    await userEvent.click(within(panel).getByText('Real-time Source'));
    await userEvent.click(within(panel).getByRole('button', { name: /Kafka broker/ }));
    expect(panel).toHaveTextContent('broker:9092 · transactions');
    expect(panel).toHaveTextContent('FUND_FLOW');
    expect(panel).not.toHaveTextContent('95.8%');
  });

  it('opens Reports at any time', async () => {
    const onOpenWindow = vi.fn();
    render(<WorkspaceHome onOpenWindow={onOpenWindow} />);
    await userEvent.click(screen.getByText('Reports'));
    expect(onOpenWindow).toHaveBeenCalledWith(WORKSPACE_WINDOW_TYPES.REPORTS);
  });
});

describe('quickReview', () => {
  it('never shows the graph tool address', () => {
    const text = JSON.stringify(quickReview({ defaults: resolveSourceDefaults(configuration), input: 'kafka' }));
    expect(text).toContain('broker:9092');
    expect(text).not.toMatch(/secret/);
  });

  it('says what is not set', () => {
    expect(quickReview({ defaults: resolveSourceDefaults({}), input: 'kafka' }).map((item) => item.value)).toEqual(['Not set', 'Not set', 'Not set', 'Not set']);
  });
});
