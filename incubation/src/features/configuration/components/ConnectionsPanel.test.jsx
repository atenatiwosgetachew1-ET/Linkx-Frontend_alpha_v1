// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { ConnectionsPanel } from './ConfigurationPanels.jsx';

afterEach(cleanup);

const DRAFT = {
  kafka_addresses: ['10.0.0.1:9092'],
  active_kafka_adress: '10.0.0.1:9092',
  kafka_topics: ['txn'],
  active_kafka_topic: 'txn',
  storage_addresses: ['10.0.0.2'],
  active_storage_address: '10.0.0.2',
  storage_tables: ['a', 'b', 'c'],
  search_api_endpoint: 'http://search',
  hive_port: '10000',
};

describe('Configuration · Connections', () => {
  it('sums the connections up in the header and lays the fields out in three cards', () => {
    render(<ConnectionsPanel draft={DRAFT} onChange={vi.fn()} canWrite />);
    const figures = screen.getByLabelText('Connection figures');
    expect(figures).toHaveTextContent('10.0.0.1:9092');
    expect(figures).toHaveTextContent('topic txn');
    expect(figures).toHaveTextContent('no database chosen');
    expect(within(figures).getByText('3')).toBeInTheDocument();
    expect(figures).toHaveTextContent('of 5 set · Hive / Spark');
    ['Broker', 'Storage', 'Search'].forEach((name) => expect(screen.getByRole('region', { name })).toBeInTheDocument());
    expect(screen.queryByText(/Read-only/)).not.toBeInTheDocument();
  });

  it('commits a field on Enter and a choice at once', async () => {
    const onChange = vi.fn();
    render(<ConnectionsPanel draft={DRAFT} onChange={onChange} canWrite />);
    const hive = screen.getByLabelText('Hive port');
    expect(hive).toHaveValue('10000');
    await userEvent.clear(hive);
    await userEvent.type(hive, '10001{Enter}');
    expect(onChange).toHaveBeenCalledWith('hive_port', '10001');
    expect(screen.getByLabelText(/Elasticsearch scroll limit/)).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText(/Large search retrieval/), 'elastic_scroll');
    expect(onChange).toHaveBeenCalledWith('large_search_backend', 'elastic_scroll');
  });

  it('is read-only without config:write, and says so', () => {
    render(<ConnectionsPanel draft={DRAFT} onChange={vi.fn()} canWrite={false} />);
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(screen.getByText(/you need config:write/)).toBeInTheDocument();
    expect(screen.getByLabelText('Hive port')).toBeDisabled();
    expect(screen.getByLabelText(/Storage path/)).toBeDisabled();
  });
});
