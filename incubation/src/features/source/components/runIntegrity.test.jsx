// @vitest-environment jsdom
// The run that is sent is what the Source window shows, and what the task
// records (docs/integrity-audit-2026-11-24.md B1, B2, B3, B5, B6).
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import SourceWindowBody from './SourceWindowBody.jsx';
import TasksWindowBody from '../../tasks/components/TasksWindowBody.jsx';
import { AuthContext } from '../../../auth/authContext.js';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { disposeAllSourceRuntimes } from '../lib/sourceRuntime.js';
import { disposeAllStreamLogs } from '../lib/streamLogs.js';
import { applyServerTask, getTasks, resetTasks } from '../../tasks/lib/taskRegistry.js';

globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
afterEach(() => {
  cleanup();
  disposeAllSourceRuntimes();
  resetTasks();
  disposeAllStreamLogs();
});

let ws;
let setConfiguration;
function Windows() {
  ws = useWorkspace();
  return ws.windows.filter((item) => item.type === 'source').map((item) => <SourceWindowBody key={item.id} windowItem={item} />);
}
const CONFIG = {
  active_domain: 'bank', domain: 'bank', domain_connections: { bank: { storage_path: '/bank' }, cdr: { storage_path: '/cdr' } },
  active_kafka_adress: 'kafkaA:9092', active_kafka_topic: 'topicA', active_tool_url: 'bolt://t', active_tool_username: 'neo', storage_address: 'hdfs://h', active_tool_password_ref: 'r',
};
const CDR = { ...CONFIG, active_domain: 'cdr', domain: 'cdr' };
const settle = (ms = 250) => act(async () => { await new Promise((resolve) => { setTimeout(resolve, ms); }); });
const mount = async (sourceState, { configuration = CONFIG, dataframe = null, extra = null, can = () => true, stream = null } = {}) => {
  const calls = [];
  const apiFetch = vi.fn(async (path, options = {}) => {
    calls.push([path, options.body]);
    if (path === '/connect_to_source') return { message: 'Connection established!' };
    if (path === '/connect_to_tool') return { message: 'Connected!' };
    if (path === '/configuration') return { message: 'success', results: { configuration: CONFIG } };
    if (options.body?.id === 'create_DF') return dataframe ? dataframe() : { message: 'success', results: { columns: ['A', 'B'], total_rows: 100, rules: ['R_FIRST', 'R_ACTIVE'], tool: 'neo4j' } };
    if (options.body?.id === 'stream' && stream) return stream();
    if (options.body?.id === 'stream') return { message: 'success', results: { log_file: 'x.log', task_id: 'T9' } };
    return { message: 'success' };
  });
  function App() {
    const [value, set] = useState(configuration);
    setConfiguration = set;
    return (
      <AuthContext.Provider value={{ hasPermission: can, hasRole: () => false, user: {} }}>
        <NotificationProvider>
          <SessionContext.Provider value={{ apiFetch, socket: null, configuration: value, setConfiguration: set, mainSessionId: '9' }}>
            <WorkspaceProvider><Windows />{extra}</WorkspaceProvider>
          </SessionContext.Provider>
        </NotificationProvider>
      </AuthContext.Provider>
    );
  }
  render(<App />);
  act(() => ws.openWindow('source', { sourceSessionId: '5_9', sourceState }));
  await settle();
  return {
    streams: () => calls.filter(([, body]) => body?.id === 'stream').map(([, body]) => body.value),
    of: (name) => calls.filter(([path, body]) => path === name || body?.id === name).map(([, body]) => body),
  };
};
const FILTER = { dropColumns: ['B'], rows: { match: 'all', action: 'keep', conditions: [{ column: 'A', operator: 'equals', value: 'x', value2: '' }] }, trimWhitespace: false, dropEmptyIn: [], dropDuplicates: false };
const READY = {
  selectedConnectionType: 'upload', selectedFiles: ['a.csv'], uploadedFiles: ['a.csv'], uploadStatus: 'uploaded', sourceStatus: 'uploaded', toolStatus: 'connected',
  dataframeStatus: 'ready', dataframeInfo: { actions: [], columns: ['A', 'B'], totalColumns: 2, totalRows: 100, rules: ['R1'], source: '', storage: 'a.csv', tool: 'neo4j' },
  dataframeFilter: FILTER, dataframeAction: 'Link Analysis', rule: 'R1',
};
const NEW = { ...READY, dataframeStatus: 'none', dataframeInfo: null, dataframeFilter: null, rule: '', step: 'upload' };
const state = (mode = 'batch') => ws.windows.find((item) => item.type === 'source').sourceState[mode];
// The run completes (the window's state, as the watcher sets it).
const finishRun = () => {
  const item = ws.windows.find((entry) => entry.type === 'source');
  ws.updateWindowMetadata(item.id, { sourceState: { ...item.sourceState, batch: { ...item.sourceState.batch, streamStatus: 'completed' } } });
};
const press = async (name) => {
  await userEvent.click(screen.getByRole('button', { name }));
  await settle();
};
const batch = (fields) => ({ mode: 'batch', autofillApplied: true, batch: fields });

describe('the run that is sent', () => {
  it('a domain switch keeps the dataframe, labelled, and never analyses it under the other domain (Q1, Q19)', async () => {
    const service = await mount(batch({ ...READY, dataframeDomain: 'bank', step: 'dataframe' }));
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
    act(() => setConfiguration(CDR));
    await settle();
    expect(state()).toMatchObject({ dataframeStatus: 'ready', dataframeDomain: 'bank', step: 'dataframe', dataframeFilter: FILTER });
    expect(screen.getByText(/made under Bank.*Switch back/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
    expect(service.streams()).toEqual([]);
    // Switched back: it can be analysed again, filter and all.
    act(() => setConfiguration({ ...CONFIG }));
    await settle();
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled();
  });

  it('a dataframe of another domain is made again from the input step', async () => {
    const service = await mount(batch({ ...READY, dataframeDomain: 'bank', step: 'upload' }), { configuration: CDR });
    await press('Continue');
    expect(service.of('create_DF')).toHaveLength(1);
    expect(state()).toMatchObject({ dataframeDomain: 'cdr', step: 'dataframe' });
  });

  it('a mapping change asks to make it again (Q2)', async () => {
    await mount(batch({ ...READY, dataframeDomain: 'bank', dataframeMapping: JSON.stringify({ A: 'X' }), step: 'dataframe' }), { configuration: { ...CONFIG, column_mapping: { A: 'Y' } } });
    expect(screen.getByText(/column mapping has changed/)).toBeInTheDocument();
  });

  it('the Service refuses another domain’s dataframe: said, and labelled', async () => {
    await mount(batch({ ...READY, dataframeDomain: '', step: 'dataframe' }), { stream: () => { throw Object.assign(new Error('x'), { status: 409, data: { code: 'configuration_changed', dataframe_domain: 'cdr', domain: 'bank' } }); } });
    await press('Analyze');
    expect(state().dataframeDomain).toBe('cdr');
    expect(getTasks()[0].message).toContain('made under cdr');
  });

  it('a dataframe answered for the previous domain is refused (B1)', async () => {
    let answer;
    const service = await mount(batch(NEW), { dataframe: () => new Promise((resolve) => { answer = () => resolve({ message: 'success', results: { columns: ['ACCOUNT'], total_rows: 100, rules: ['BANK_RULE'] } }); }) });
    await press('Continue');
    act(() => setConfiguration(CDR));
    await settle();
    await act(async () => answer());
    await settle();
    expect(state().dataframeStatus).not.toBe('ready');
    expect(service.streams()).toEqual([]);
  });

  it.each([['queued', 'starting'], ['running', 'running']])('a %s run is untouched by a domain change; it applies after it', async (_name, streamStatus) => {
    const broker = { selectedConnectionType: 'broker', sourceAddressType: 'broker', sourceStatus: 'connected', connectedKind: 'broker' };
    const service = await mount(batch({ ...READY, ...broker, dataframeDomain: 'bank', step: 'stream', streamStatus, streamLogFile: 'x.log' }));
    act(() => setConfiguration(CDR));
    await settle();
    expect(state()).toMatchObject({ streamStatus, step: 'stream', dataframeStatus: 'ready', sourceStatus: 'connected', toolStatus: 'connected', streamLogFile: 'x.log' });
    expect(service.of('end_session')).toEqual([]);
    expect(service.of('/end_session')).toEqual([]);
    expect(service.of('/connect_to_source')).toEqual([]);
    expect(screen.getByRole('button', { name: 'Terminate' })).toBeInTheDocument();
    // Finished: still shown as it was made.
    act(() => finishRun());
    await settle();
    expect(state()).toMatchObject({ step: 'stream', streamStatus: 'completed', dataframeStatus: 'ready', sourceStatus: 'connected' });
    // Back to prepare the next one: now the new domain applies.
    await press('Back');
    expect(state()).toMatchObject({ dataframeStatus: 'ready', step: 'dataframe' });
    expect(service.of('/connect_to_source')).toHaveLength(1);
  });

  it('an upload run keeps its live step and Terminate after a domain change', async () => {
    await mount(batch({ ...READY, step: 'stream', streamStatus: 'running', streamLogFile: 'x.log' }));
    act(() => setConfiguration(CDR));
    await settle();
    expect(state()).toMatchObject({ step: 'stream', streamStatus: 'running', dataframeStatus: 'ready' });
    expect(screen.getByRole('button', { name: 'Terminate' })).toBeInTheDocument();
  });

  it('a change made and undone during a run leaves everything as it was', async () => {
    await mount(batch({ ...READY, step: 'stream', streamStatus: 'running', streamLogFile: 'x.log' }));
    act(() => setConfiguration(CDR));
    await settle();
    act(() => setConfiguration({ ...CONFIG }));
    await settle();
    act(() => finishRun());
    await settle();
    await press('Back');
    expect(state()).toMatchObject({ dataframeStatus: 'ready', step: 'dataframe' });
  });

  it('reads the broker it connected to, whatever the default is now (B2)', async () => {
    const service = await mount({ mode: 'batch', autofillApplied: false, batch: { selectedConnectionType: 'broker', sourceAddressType: 'broker', step: 'upload' } });
    expect(service.of('/connect_to_source').map((body) => [body.address, body.topic])).toEqual([['kafkaA:9092', 'topicA']]);
    act(() => setConfiguration({ ...CONFIG, active_kafka_adress: 'kafkaB:9092', active_kafka_topic: 'topicB' }));
    await settle();
    await press('Continue');
    expect(service.of('create_DF').map((body) => [body.address, body.topic])).toEqual([['kafkaA:9092', 'topicA']]);
  });

  it('preselects the configured rule, or none (B5)', async () => {
    await mount(batch(NEW), { configuration: { ...CONFIG, active_rule: 'R_ACTIVE' } });
    await press('Continue');
    expect(state().rule).toBe('R_ACTIVE');
    cleanup();
    disposeAllSourceRuntimes();
    await mount(batch(NEW));
    await press('Continue');
    expect(state().rule).toBe('');
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  });

  it('a realtime start saves no configuration (R2-18)', async () => {
    const service = await mount({ mode: 'realtime', autofillApplied: false, realtime: { sourceAddressType: 'broker', step: 'connect' } }, { configuration: { ...CONFIG, active_rule: 'R_ACTIVE', column_mapping: { OLD: 'X' } } });
    await press('Continue');
    act(() => setConfiguration({ ...CONFIG, active_rule: 'R_ACTIVE', column_mapping: { NEW: 'X' } }));
    await settle();
    await press('Analyze');
    expect(service.of('/configuration')).toEqual([]);
    expect(service.of('/connect_to_tool')).toHaveLength(1);
    expect(service.streams()).toHaveLength(1);
  });
});

describe('what the task records (B3)', () => {
  it('the rule and the filter, and the rows the filter kept', async () => {
    const service = await mount(batch({ ...READY, step: 'dataframe' }), { extra: <TasksWindowBody /> });
    await press('Analyze');
    expect(service.streams()[0]).toMatchObject({ rule: 'R1', dataframe_filter: { drop_columns: ['B'] } });
    act(() => applyServerTask({ task_id: 'T9', status: 'running', filter_result: { total_rows: 100, kept_rows: 3 } }));
    await settle();
    expect(getTasks()[0]).toMatchObject({ rule: 'R1', filter: ['Strip 1 column: B.', 'Keep only the rows where A is "x".'] });
    const shown = document.querySelector('.tasks_summary').textContent;
    expect(shown).toContain('R1');
    expect(shown).toContain('Keep only the rows where A is "x".');
    expect(shown).toContain('3 of 100 rows analysed');
  });

  it('the columns of a mapping', async () => {
    await mount(batch({ ...READY, dataframeFilter: null, dataframeAction: 'Source / Target Mapping', sourceColumn: 'A', targetColumn: 'B', relationship: 'PAID', step: 'dataframe' }));
    await press('Map network');
    expect(getTasks()[0]).toMatchObject({ sourceColumn: 'A', targetColumn: 'B', relationship: 'PAID' });
  });
});

describe('how a run ends (Service answer 2026-11-25)', () => {
  it.each([['failed', 'failed'], ['terminated', 'terminated'], ['completed', 'completed']])('the Service says %s: the window follows', async (status, streamStatus) => {
    await mount(batch({ ...READY, step: 'dataframe' }));
    await press('Analyze');
    expect(getTasks()[0]).toMatchObject({ serverId: 'T9' });
    expect(['starting', 'running']).toContain(state().streamStatus);
    act(() => applyServerTask({ task_id: 'T9', status, message: 'Said by the Service.' }));
    await settle();
    expect(state().streamStatus).toBe(streamStatus);
    expect(getTasks()[0].status).toBe(status);
  });
});

describe('a domain switch', () => {
  const pick = async (can) => {
    const service = await mount({ mode: 'batch', autofillApplied: true, batch: { ...NEW, selectedConnectionType: 'storage', sourceAddressType: 'storage', sourceStatus: 'disconnected', storageUseDefault: false, selectedFiles: [] } }, { can });
    await userEvent.selectOptions(screen.getAllByRole('combobox', { hidden: true }).find((select) => [...select.options].some((option) => option.value === 'cdr')), 'cdr');
    await settle();
    return service;
  };
  it('is an analyst’s without config:write, and sends the domain only (R2-18)', async () => {
    const service = await pick((permission) => permission !== 'config:write');
    expect(service.of('/configuration')[0]).toEqual({ id: 'save', session_id: '9', domain: 'cdr' });
  });
  it('is refused to a viewer', async () => {
    const service = await pick((permission) => !['config:write', 'analysis:run'].includes(permission));
    expect(service.of('/configuration')).toEqual([]);
    expect(screen.getAllByText(/You need config:write to switch the domain/).length).toBeGreaterThan(0);
  });
});

describe('a column mapping for one dataframe (B-41)', () => {
  const INFO = { ...READY.dataframeInfo, missingFields: ['ACCOUNTNO', 'TRANSACTIONTIME'], sourceColumns: ['PAYER ACC', 'WHEN'], ownMapping: {} };
  const AT = { ...READY, dataframeInfo: INFO, step: 'dataframe', dataframeDomain: 'bank' };
  const made = (more = {}) => () => ({ message: 'success', results: { columns: ['A', 'B', 'ACCOUNTNO'], total_rows: 100, rules: ['R1'], tool: 'neo4j', source_columns: ['PAYER ACC', 'WHEN'], missing_fields: ['TRANSACTIONTIME'], dataframe_mapping: { 'PAYER ACC': 'ACCOUNTNO' }, ...more } });
  const map = async (field, column) => {
    await press(/^Map columns/);
    await userEvent.selectOptions(screen.getByLabelText(`Column for ${field}`), column);
    await press('Make it again');
  };

  it('is sent with that create_DF only, shown from the Service’s answer, and clears the filter', async () => {
    const service = await mount(batch(AT), { dataframe: made() });
    expect(screen.getByText(/Fields this data does not have/).closest('p')).toHaveTextContent('ACCOUNTNO, TRANSACTIONTIME');
    await map('ACCOUNTNO', 'PAYER ACC');
    expect(service.of('create_DF')[0]).toMatchObject({ kind: 'files', dataframe_mapping: { 'PAYER ACC': 'ACCOUNTNO' } });
    expect(state()).toMatchObject({ step: 'dataframe', dataframeStatus: 'ready', dataframeFilter: null });
    expect(state().dataframeInfo.ownMapping).toEqual({ 'PAYER ACC': 'ACCOUNTNO' });
    expect(screen.getByText('Own column mapping:').closest('p')).toHaveTextContent('PAYER ACC → ACCOUNTNO');
    // Without it again: the key is left out.
    await press(/^Map columns/);
    await userEvent.selectOptions(screen.getByLabelText('Column for ACCOUNTNO'), '');
    await press('Make it again');
    expect(service.of('create_DF')[1]).not.toHaveProperty('dataframe_mapping');
  });

  it('a refusal says why, keeps the dataframe there was and what was picked', async () => {
    await mount(batch(AT), { dataframe: () => { throw Object.assign(new Error('failed'), { jobStatus: 'failed', jobResponse: { code: 'target_present', fields: ['ACCOUNTNO'], results: { source_columns: [], missing_fields: [] } } }); } });
    await map('ACCOUNTNO', 'PAYER ACC');
    expect(screen.getByRole('alert')).toHaveTextContent('The data has this field already: ACCOUNTNO');
    expect(screen.getByLabelText('Column for ACCOUNTNO')).toHaveValue('PAYER ACC');
    expect(state()).toMatchObject({ step: 'dataframe', dataframeStatus: 'ready', dataframeFilter: FILTER });
  });

  it('any other failure leaves no dataframe to analyse, back at the input', async () => {
    await mount(batch(AT), { dataframe: () => { throw new Error('boom'); } });
    await map('ACCOUNTNO', 'PAYER ACC');
    expect(state()).toMatchObject({ step: 'upload', dataframeStatus: 'failed' });
  });

  it('one column fills one field; not offered without the permission, the columns, or for a live source', async () => {
    await mount(batch(AT), { dataframe: made() });
    await press(/^Map columns/);
    await userEvent.selectOptions(screen.getByLabelText('Column for ACCOUNTNO'), 'WHEN');
    expect(within(screen.getByLabelText('Column for TRANSACTIONTIME')).getByRole('option', { name: 'WHEN' })).toBeDisabled();
    for (const [fields, options] of [[AT, { can: (key) => key !== 'mapping:override' }], [{ ...AT, dataframeInfo: { ...INFO, sourceColumns: null } }, {}]]) {
      cleanup();
      disposeAllSourceRuntimes();
      await mount(batch(fields), options);
      expect(screen.queryByRole('button', { name: /^Map columns/ })).toBeNull();
    }
  });

  it('a dataframe of another domain is not mapped; Continue makes it without a mapping', async () => {
    const service = await mount(batch({ ...AT, dataframeInfo: { ...INFO, ownMapping: { 'PAYER ACC': 'ACCOUNTNO' } } }), { configuration: CDR, dataframe: made() });
    expect(screen.queryByRole('button', { name: /^Map columns/ })).toBeNull();
    await press('Back');
    await press('Continue');
    expect(service.of('create_DF')[0]).not.toHaveProperty('dataframe_mapping');
  });
});
