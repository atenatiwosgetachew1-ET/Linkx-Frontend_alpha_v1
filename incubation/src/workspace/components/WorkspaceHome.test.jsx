// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import WorkspaceHome from './WorkspaceHome.jsx';
import { getTasks, resetTasks } from '../../features/tasks/lib/taskRegistry.js';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';
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

afterEach(() => {
  cleanup();
  resetTasks();
});

describe('Quick analysis panel', () => {
  it('runs nothing: says so, and records no task or finding', async () => {
    render(<WorkspaceHome />);
    const panel = screen.getByRole('region', { name: 'Quick analysis' });
    expect(within(panel).getByRole('note')).toHaveTextContent('Not connected to the Service yet');
    await userEvent.upload(panel.querySelector('input[type="file"]'), new File(['a,b'], 'rows.csv', { type: 'text/csv' }));
    expect(within(panel).getByText('rows.csv')).toBeInTheDocument();
    const analyze = within(panel).getByRole('button', { name: /Analyze/ });
    expect(analyze).toBeDisabled();
    await userEvent.click(analyze);
    expect(getTasks()).toEqual([]);
    expect(panel).not.toHaveTextContent(/Flagged|Smurfing|ACC-8892|Session #/);
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
  it('never shows the storage or graph tool address', () => {
    const text = JSON.stringify(quickReview({ defaults: resolveSourceDefaults(configuration), input: 'batch_hadoop' }));
    expect(text).toContain('Saved');
    expect(text).not.toMatch(/secret/);
  });

  it('says what is not set', () => {
    expect(quickReview({ defaults: resolveSourceDefaults({}), input: 'kafka' }).map((item) => item.value)).toEqual(['Not set', 'Not set', 'Not set', 'Not set']);
  });
});
