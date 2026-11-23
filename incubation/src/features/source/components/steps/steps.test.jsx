// @vitest-environment jsdom
// Interaction tests for the Source window forms: every input is driven the
// way an analyst would (type, click, pick) through a controlled harness that
// applies patches like the real window, then checked for the visible value,
// the enabled/disabled state and the patch sent upward.
import React, { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { resolveSourceDefaults } from '../../lib/sourceConfig.js';
import { DATAFRAME_STATUSES, defaultSourceState, SOURCE_MODES, SOURCE_STATUSES, TOOL_STATUSES } from '../../lib/sourceModel.js';
import { getSecret, disposeSourceRuntime } from '../../lib/sourceRuntime.js';
import { ModeChooser } from '../ModeChooser.jsx';
import { BrokerStep } from './BrokerStep.jsx';
import { DataframeStep } from './DataframeStep.jsx';
import { ElasticSearchStep } from './ElasticSearchStep.jsx';
import { StorageStep } from './StorageStep.jsx';
import { ToolConnectionPanel } from './ToolConnectionPanel.jsx';
import { UploadStep } from './UploadStep.jsx';

afterEach(() => {
  cleanup();
  disposeSourceRuntime('w1');
});

const baseDefaults = resolveSourceDefaults({});
const makeDefaults = (overrides = {}) => ({
  ...baseDefaults,
  ...overrides,
  storage: { ...baseDefaults.storage, ...(overrides.storage || {}) },
  search: { ...baseDefaults.search, ...(overrides.search || {}) },
  dataframe: { ...baseDefaults.dataframe, ...(overrides.dataframe || {}) },
});

// Renders `Component` with live state; returns the patch spy and a state reader.
function renderStep(Component, { state: initial = {}, mode = SOURCE_MODES.BATCH, ...props } = {}) {
  const patches = vi.fn();
  let current;
  function Harness() {
    const [state, setState] = useState(() => ({ ...defaultSourceState.batch, ...initial }));
    current = state;
    const onPatchModeState = useCallback((patch) => {
      patches(patch);
      setState((previous) => ({ ...previous, ...patch }));
    }, []);
    return <Component mode={mode} windowId="w1" state={state} onPatchModeState={onPatchModeState} {...props} />;
  }
  render(<Harness />);
  return { patches, state: () => current, user: userEvent.setup() };
}

describe('StorageStep', () => {
  const defaults = makeDefaults({
    domain: 'bank',
    domains: [{ key: 'bank', storagePath: 'data/bank' }, { key: 'microfinance', storagePath: 'data/mf' }],
    storage: { address: '10.0.0.5', port: '5000', path: 'data/bank' },
  });
  const props = (extra = {}) => ({ defaults, onSourceAction: vi.fn(), onSearch: vi.fn(), onSwitchDomain: vi.fn(), ...extra });

  it('hides and locks address, port and domain while "Use Default" is on', () => {
    renderStep(StorageStep, { state: { storageAddress: '10.0.0.5', storagePort: '5000' }, ...props() });
    const address = screen.getByLabelText('Storage address');
    const port = screen.getByLabelText('RPC/Web port');
    expect(screen.getByLabelText('Use Default')).toBeChecked();
    expect(address).toHaveValue('');
    expect(address).toHaveAttribute('placeholder', 'Default');
    expect(address).toBeDisabled();
    expect(port).toHaveValue('');
    expect(port).toBeDisabled();
    expect(screen.getByLabelText('Domain / path')).toBeDisabled();
  });

  it('unlocks the fields for a custom target and keeps what is typed (even the default value)', async () => {
    const onSwitchDomain = vi.fn();
    const { user, state } = renderStep(StorageStep, { ...props({ onSwitchDomain }) });
    await user.click(screen.getByLabelText('Use Default'));
    expect(state().storageUseDefault).toBe(false);
    const address = screen.getByLabelText('Storage address');
    const port = screen.getByLabelText('RPC/Web port');
    expect(address).toBeEnabled();
    await user.type(address, '10.0.0.5');
    expect(address).toHaveValue('10.0.0.5');
    await user.type(port, '50a0x07999');
    expect(port).toHaveValue('50007');
    const domain = screen.getByLabelText('Domain / path');
    expect(domain).toBeEnabled();
    await user.selectOptions(domain, 'microfinance');
    expect(onSwitchDomain).toHaveBeenCalledWith('microfinance');
  });

  it('locks the connection fields while connected and enables search', async () => {
    const onSearch = vi.fn();
    const { user, state } = renderStep(StorageStep, {
      state: { sourceStatus: SOURCE_STATUSES.CONNECTED, selectedConnectionType: 'storage', storageToolbarCollapsed: false },
      ...props({ onSearch }),
    });
    expect(screen.getByLabelText('Use Default')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
    const query = screen.getByLabelText('Search storage files by keyword');
    const run = screen.getByRole('button', { name: 'Search' });
    expect(run).toBeDisabled();
    await user.type(query, 'tx  2024');
    expect(state().storageSearchQuery).toBe('tx 2024');
    expect(run).toBeEnabled();
    await user.type(query, '{Enter}');
    expect(onSearch).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText('File date'), { target: { value: '2024-05-01' } });
    expect(state().storageSearchDate).toBe('2024-05-01');
  });

  it('starts with the connection form collapsed and toggles it from the header', async () => {
    const { user, state } = renderStep(StorageStep, { ...props() });
    const toggle = screen.getByRole('button', { name: 'Show connection form' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Storage address')).not.toBeVisible();
    expect(screen.getByLabelText('Search storage files by keyword')).toBeInTheDocument();
    await user.click(toggle);
    expect(state().storageToolbarCollapsed).toBe(false);
    expect(screen.getByLabelText('Storage address')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Hide connection form' }));
    expect(screen.getByLabelText('Storage address')).not.toBeVisible();
  });

  it('toggles result rows and clears the selection', async () => {
    const results = [{ name: 'a.csv', path: '/a.csv', size: 10 }, { name: 'b.csv', path: '/b.csv', size: 20 }];
    const { user, state } = renderStep(StorageStep, {
      state: { sourceStatus: SOURCE_STATUSES.CONNECTED, storageSearchStatus: 'done', storageSearchResults: results },
      ...props(),
    });
    const rowA = screen.getByRole('button', { name: /a\.csv/ });
    await user.click(rowA);
    expect(rowA).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /b\.csv/ }));
    expect(state().selectedStorageFiles).toHaveLength(2);
    expect(screen.getByText('2 selected files')).toBeInTheDocument();
    await user.click(rowA);
    expect(state().selectedStorageFiles.map((file) => file.name)).toEqual(['b.csv']);
    await user.click(screen.getByRole('button', { name: 'Discard selection' }));
    expect(state().selectedStorageFiles).toEqual([]);
    expect(screen.getByRole('button', { name: 'Discard selection' })).toBeDisabled();
  });
});

describe('ElasticSearchStep', () => {
  const defaults = makeDefaults({
    domain: 'bank',
    search: { strictColumns: ['account_number', 'phone'], fuzzyColumns: ['full_name'] },
  });
  const connected = { sourceStatus: SOURCE_STATUSES.CONNECTED, selectedConnectionType: 'search', storageToolbarCollapsed: false };

  it('lists the configured fuzzy columns by default, with "All columns" allowed', async () => {
    const { user } = renderStep(ElasticSearchStep, { state: connected, defaults, onSourceAction: vi.fn(), onSearch: vi.fn() });
    const column = screen.getByLabelText('Fuzzy column');
    expect(within(column).getAllByRole('option').map((option) => option.textContent)).toEqual(['All columns (auto)', 'full name']);
    await user.type(screen.getByLabelText('Elasticsearch keyword'), 'abebe');
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled();
  });

  it('strict search needs a strict column before it can run', async () => {
    const onSearch = vi.fn();
    const { user, state } = renderStep(ElasticSearchStep, {
      state: { ...connected, elasticSearchStatus: 'done', elasticSearchResults: [{ name: 'r1', size: 3 }] },
      defaults, onSourceAction: vi.fn(), onSearch,
    });
    await user.click(screen.getByLabelText('Strict'));
    expect(state().searchMode).toBe('strict');
    expect(state().elasticSearchResults).toEqual([]); // new search context
    const column = screen.getByLabelText('Strict column');
    expect(within(column).getAllByRole('option').map((option) => option.value)).toEqual(['', 'account_number', 'phone']);
    await user.type(screen.getByLabelText('Elasticsearch keyword'), '1000');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    await user.selectOptions(column, 'phone');
    expect(state().elasticColumn).toBe('phone');
    const run = screen.getByRole('button', { name: 'Search' });
    expect(run).toBeEnabled();
    await user.click(run);
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('offers a start/end date range and no leading row icon', () => {
    const { state } = renderStep(ElasticSearchStep, { state: connected, defaults, onSourceAction: vi.fn(), onSearch: vi.fn() });
    expect(document.querySelector('.source_window_storage_file_icon')).toBeNull();
    const start = screen.getByLabelText('Start date');
    const end = screen.getByLabelText('End date');
    fireEvent.change(start, { target: { value: '2026-01-01' } });
    fireEvent.change(end, { target: { value: '2026-01-31' } });
    expect(state()).toMatchObject({ elasticSearchDateFrom: '2026-01-01', elasticSearchDateTo: '2026-01-31' });
    expect(end).toHaveAttribute('min', '2026-01-01');
    expect(start).toHaveAttribute('max', '2026-01-31');
  });

  it('disables the column select when the domain has no columns configured', () => {
    renderStep(ElasticSearchStep, { state: connected, defaults: makeDefaults({ domain: 'bank' }), onSourceAction: vi.fn(), onSearch: vi.fn() });
    expect(screen.getByLabelText('Fuzzy column')).toBeDisabled();
    expect(screen.getByText(/No fuzzy search columns are configured for the Bank domain/)).toBeInTheDocument();
  });
});

describe('BrokerStep', () => {
  it('switches between Kafka and REST API and sanitises the inputs', async () => {
    const { user, state } = renderStep(BrokerStep, { state: { selectedConnectionType: 'broker' }, onSourceAction: vi.fn(), onToolAction: vi.fn() });
    await user.type(screen.getByLabelText('Kafka broker address'), ' kafka:9092 ');
    expect(state().brokerAddress).toBe('kafka:9092');
    await user.type(screen.getByLabelText('Kafka topic'), 'my topic!');
    expect(state().topic).toBe('mytopic');
    await user.click(screen.getByLabelText('REST API'));
    expect(state().sourceAddressType).toBe('api');
    expect(screen.queryByLabelText('Kafka topic')).not.toBeInTheDocument();
    expect(screen.getByLabelText('REST API address')).toHaveValue('kafka:9092');
  });

  it('locks the broker fields while connected', () => {
    renderStep(BrokerStep, { state: { sourceStatus: SOURCE_STATUSES.CONNECTED }, onSourceAction: vi.fn(), onToolAction: vi.fn() });
    expect(screen.getByLabelText('Kafka broker address')).toBeDisabled();
    expect(screen.getByLabelText('Apache Kafka')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled();
  });
});

describe('ToolConnectionPanel', () => {
  it('stays locked until the source is ready', () => {
    renderStep(ToolConnectionPanel, { onToolAction: vi.fn() });
    expect(screen.getByLabelText('URL')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Connect tool' })).toBeDisabled();
  });

  it('keeps the typed password out of window state', async () => {
    const onToolAction = vi.fn();
    const { user, state } = renderStep(ToolConnectionPanel, {
      state: { selectedConnectionType: 'broker', sourceStatus: SOURCE_STATUSES.CONNECTED },
      onToolAction,
    });
    await user.type(screen.getByLabelText('URL'), 'neo4j://db:7687');
    await user.type(screen.getByLabelText('Username'), 'neo 4j');
    await user.type(screen.getByLabelText('Password'), 's3cret');
    await user.type(screen.getByLabelText('Database'), 'graph');
    expect(state()).toMatchObject({ toolUrl: 'neo4j://db:7687', toolUsername: 'neo4j', toolDatabase: 'graph', toolPasswordTyped: true });
    expect(state().toolPassword).toBe('');
    expect(getSecret('w1', 'batch')).toBe('s3cret');
    expect(screen.getByLabelText('Password')).toHaveValue('s3cret');
    await user.click(screen.getByRole('button', { name: 'Connect tool' }));
    expect(onToolAction).toHaveBeenCalledTimes(1);
  });

  it('locks the fields once the tool is connected', () => {
    renderStep(ToolConnectionPanel, {
      state: { selectedConnectionType: 'broker', sourceStatus: SOURCE_STATUSES.CONNECTED, toolStatus: TOOL_STATUSES.CONNECTED },
      onToolAction: vi.fn(),
    });
    expect(screen.getByLabelText('Password')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Disconnect tool' })).toBeEnabled();
  });
});

describe('UploadStep', () => {
  const file = (name, size = 100) => new File(['x'.repeat(size)], name, { lastModified: 1700000000000 });

  it('stages supported files, removes one, then clears them all', async () => {
    const { user, state } = renderStep(UploadStep, {});
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, [file('a.csv'), file('b.json')]);
    expect(state().selectedFiles).toEqual(['a.csv', 'b.json']);
    expect(state().sourceStatus).toBe(SOURCE_STATUSES.UPLOADED);
    expect(screen.getByText('2 files staged')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Drop a.csv' }));
    expect(state().selectedFiles).toEqual(['b.json']);
    await user.click(screen.getByRole('button', { name: 'Drop all staged files' }));
    expect(state().selectedFiles).toEqual([]);
    expect(state().sourceStatus).toBe(SOURCE_STATUSES.IDLE);
  });

  it('rejects unsupported files with a visible message', () => {
    const { state } = renderStep(UploadStep, {});
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file('virus.exe')] } });
    expect(state().selectedFiles).toEqual([]);
    expect(screen.getByText(/Only supported files/)).toBeInTheDocument();
  });

  it('shows pipeline validation messages from the window', () => {
    renderStep(UploadStep, { validationMessage: 'The staged files are no longer available. Select them again.' });
    expect(screen.getByRole('alert')).toHaveTextContent('no longer available');
  });
});

describe('DataframeStep', () => {
  const ready = (info = {}) => ({
    dataframeStatus: DATAFRAME_STATUSES.READY,
    dataframeInfo: { columns: ['from_acc', 'to_acc', 'amount'], rules: ['rule_a', 'rule_b'], actions: [], totalRows: 5, totalColumns: 3, ...info },
  });
  const props = { defaults: makeDefaults(), onOpenConfiguration: vi.fn(), onOpenLibrary: vi.fn() };

  it('switches actions and shows the matching fields', async () => {
    const { user, state } = renderStep(DataframeStep, { state: ready(), ...props });
    expect(screen.getByRole('button', { name: 'Link Analysis' })).toHaveAttribute('aria-pressed', 'true');
    await user.selectOptions(screen.getByLabelText(/Rule to apply/), 'rule_b');
    expect(state().rule).toBe('rule_b');
    await user.click(screen.getByRole('button', { name: 'Source / Target Mapping' }));
    expect(state().dataframeAction).toBe('Source / Target Mapping');
    expect(screen.queryByLabelText(/Rule to apply/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Store data' }));
    expect(screen.queryByLabelText(/Source column/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open configuration/ })).not.toBeInTheDocument();
  });

  it('prevents picking the same source and target column and normalises the label', async () => {
    const { user, state } = renderStep(DataframeStep, { state: { ...ready(), dataframeAction: 'Source / Target Mapping' }, ...props });
    await user.selectOptions(screen.getByLabelText(/Source column/), 'from_acc');
    const target = screen.getByLabelText(/Target column/);
    expect(within(target).getByRole('option', { name: 'from_acc' })).toBeDisabled();
    await user.selectOptions(target, 'to_acc');
    expect(state()).toMatchObject({ sourceColumn: 'from_acc', targetColumn: 'to_acc' });
    await user.type(screen.getByLabelText(/Relationship label/), 'sends-to x.y');
    expect(state().relationship).toBe('SENDS_TOX_Y');
  });

  it('Filter (top-right of the information card) opens the filter and counts those applied (analyst decision 2026-11-19)', async () => {
    const onOpenFilter = vi.fn();
    const { user } = renderStep(DataframeStep, { state: ready(), ...props, onOpenFilter });
    const button = screen.getByRole('button', { name: 'Filter dataframe' });
    expect(button.closest('header')).toHaveClass('source_window_dataframe_card_header');
    expect(screen.queryByText(/No filter/)).not.toBeInTheDocument();
    await user.click(button);
    expect(onOpenFilter).toHaveBeenCalled();
    cleanup();
    // One stripped column, one condition and duplicates removed: 3 applied.
    renderStep(DataframeStep, { state: { ...ready(), dataframeFilter: { dropColumns: ['amount'], rows: { conditions: [{ column: 'from_acc', operator: 'is_empty' }] }, dropDuplicates: true } }, ...props, onOpenFilter });
    const counted = screen.getByRole('button', { name: 'Filter dataframe (3 applied)' });
    expect(counted).toHaveTextContent('Filter3');
    expect(counted).toHaveAttribute('title', 'Filtered: 1 column stripped · 1 row condition (remove matching) · clean-up');
    cleanup();
    // Not before the dataframe exists.
    renderStep(DataframeStep, { state: {}, ...props, onOpenFilter });
    expect(screen.getByRole('button', { name: 'Filter dataframe' })).toBeDisabled();
  });

  it('clears a rule or column this dataframe no longer offers', () => {
    const { state } = renderStep(DataframeStep, { state: { ...ready(), rule: 'old_rule', sourceColumn: 'gone', targetColumn: 'to_acc' }, ...props });
    expect(state()).toMatchObject({ rule: '', sourceColumn: '', targetColumn: 'to_acc' });
  });

  it('falls back to an offered action when the selected one is not available', () => {
    const { state } = renderStep(DataframeStep, { state: { ...ready({ actions: ['Store data'] }), dataframeAction: 'Link Analysis' }, ...props });
    expect(state().dataframeAction).toBe('Store data');
    expect(screen.getByRole('button', { name: 'Link Analysis' })).toBeDisabled();
  });

  it('shows stream validation messages', () => {
    renderStep(DataframeStep, { state: ready(), validationMessage: 'The relationship must start with a letter.', ...props });
    expect(screen.getByRole('alert')).toHaveTextContent('relationship must start');
  });
});

describe('ModeChooser', () => {
  const renderChooser = (extra = {}) => {
    const onSelectMode = vi.fn();
    render(<ModeChooser sourceSessionId="s1" onSelectMode={onSelectMode} onOpenConfiguration={vi.fn()} onCopySession={vi.fn()} {...extra} />);
    return { onSelectMode, user: userEvent.setup() };
  };

  it('reopens on the input the window was using', async () => {
    const { onSelectMode, user } = renderChooser({ initialMode: SOURCE_MODES.BATCH, initialConnectionType: 'storage' });
    expect(screen.getByRole('button', { name: /Storage/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSelectMode).toHaveBeenCalledWith(SOURCE_MODES.BATCH, 'storage');
  });

  it('realtime only offers the message broker', async () => {
    const { onSelectMode, user } = renderChooser();
    await user.click(screen.getByRole('button', { name: /Live \/ streaming data/ }));
    expect(screen.getByRole('button', { name: /Upload file/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Message broker/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSelectMode).toHaveBeenCalledWith(SOURCE_MODES.REALTIME, 'broker');
  });
});
