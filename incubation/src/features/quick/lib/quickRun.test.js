import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TASK_STATUSES, applyServerTask, finishTask, getTask, getTasks, resetTasks, terminateTask } from '../../tasks/lib/taskRegistry.js';
import { taskFlagVerdict } from '../../tasks/lib/taskFlags.js';
import { resolveSourceDefaults } from '../../source/lib/sourceConfig.js';
import { disposeAllStreamLogs, getStreamLogLines } from '../../source/lib/streamLogs.js';
import { forgetActiveStreams } from '../../source/lib/activeStreams.js';
import { cancelQuickPreparation, clearQuickRun, getQuickRun, isQuickRunGoing, quickBlocker, quickFileProblem, resetQuickRun, startQuickRun } from './quickRun.js';

const defaults = resolveSourceDefaults({
  active_domain: 'bank', active_kafka_adress: 'broker:9092', active_kafka_topic: 'tx', active_REST_API: 'http://api/live',
  active_tool: 'neo4j', active_tool_url: 'bolt://tool:7687', active_tool_username: 'neo', active_tool_password_ref: 'ref-1', active_tool_database: 'linkx',
  active_rule: 'FUND_FLOW',
});
const file = (size = 10, name = 'rows.csv') => ({ name, size });
const csv = () => new File(['a,b\n1,2'], 'rows.csv', { type: 'text/csv' });

// answers: path (or the body's id) -> answer | (body) => answer
const service = (answers = {}) => {
  const calls = [];
  const apiFetch = vi.fn(async (path, options = {}) => {
    const body = options.body;
    const key = body?.id && path === '/live_batch_files' ? body.id : path;
    calls.push([key, body]);
    const answer = key in answers ? answers[key] : {
      '/init_source': { message: 'success', window_id: 7, session_id: '7_main', source_session_id: '7_main' },
      '/connect_to_source': { message: 'Connection established!' },
      '/connect_to_tool': { message: 'Connected!' },
      '/upload_batch_files': { message: 'success' },
      create_DF: { message: 'success', results: { rules: ['FUND_FLOW'], columns: ['a', 'b'], total_rows: 1, tool: 'neo4j' } },
      stream: { message: 'success', results: { task_id: 't-1', log_file: 'x.log' } },
    }[key] ?? { message: 'success' };
    return typeof answer === 'function' ? answer(body) : answer;
  });
  return { apiFetch, calls, sent: (key) => calls.filter(([name]) => name === key).map(([, body]) => body) };
};
const start = (api, extra = {}) => startQuickRun({ apiFetch: api.apiFetch, socket: null, mainSessionId: 'main', defaults, input: 'upload', file: csv(), ...extra });

beforeEach(() => { resetQuickRun(); });
afterEach(() => {
  vi.useRealTimers();
  resetQuickRun();
  resetTasks();
  disposeAllStreamLogs();
  forgetActiveStreams();
});

describe('what a quick run needs', () => {
  it('takes one file of an accepted type, up to 5 MB', () => {
    expect(quickFileProblem(file())).toBe('');
    expect(quickFileProblem(file(5 * 1024 * 1024))).toBe('');
    expect(quickFileProblem(file(5 * 1024 * 1024 + 1))).toMatch(/over 5 MB/);
    expect(quickFileProblem(file(0))).toMatch(/empty/);
    expect(quickFileProblem(file(10, 'rows.exe'))).toMatch(/Only CSV/);
  });

  it('names the missing configuration, and refuses inputs that are not for it', () => {
    const none = resolveSourceDefaults({});
    expect(quickBlocker({ input: 'kafka', defaults: none })).toMatch(/Kafka broker and topic/);
    expect(quickBlocker({ input: 'rest_api', defaults: none })).toMatch(/REST API/);
    expect(quickBlocker({ input: 'upload', file: file(), defaults: none })).toMatch(/graph tool/);
    expect(quickBlocker({ input: 'upload', file: file(), defaults: { ...defaults, dataframe: { ...defaults.dataframe, activeRule: '' } } })).toMatch(/active rule/);
    expect(quickBlocker({ input: 'batch_hadoop', defaults })).not.toBe('');
    expect(quickBlocker({ input: 'kafka', defaults })).toBe('');
  });
});

describe('startQuickRun', () => {
  it('a file: upload, create_DF and stream marked quick, no limits of its own', async () => {
    const api = service();
    expect(await start(api)).toBe(true);
    expect(api.calls.map(([key]) => key)).toEqual(['/init_source', '/upload_batch_files', '/connect_to_tool', 'create_DF', 'stream']);
    expect(api.sent('create_DF')[0]).toMatchObject({ quick: true, kind: 'files', value: ['rows.csv'] });
    expect(api.sent('stream')[0].value).toMatchObject({ quick: true, action: 'Link Analysis', rule: 'FUND_FLOW', mode: 'batch' });
    expect(api.sent('stream')[0].value).not.toHaveProperty('listen_realtime');
    expect(JSON.stringify(api.calls)).not.toMatch(/limits|max_duration/);
    expect(api.sent('/connect_to_tool')[0]).toMatchObject({ password: '***', password_ref: 'ref-1' });
    const [task] = getTasks();
    expect(task).toMatchObject({ quick: true, background: true, serverId: 't-1', rule: 'FUND_FLOW', domain: 'bank', input: 'rows.csv' });
    expect(getQuickRun()).toMatchObject({ phase: 'started', taskId: task.id });
    expect(getStreamLogLines(task.windowId).some((line) => /Source window closed/.test(line.message))).toBe(false);
  });

  it('Kafka batch: the configured topic, by address', async () => {
    const api = service();
    expect(await start(api, { input: 'batch_kafka', file: null })).toBe(true);
    expect(api.sent('/connect_to_source')[0]).toMatchObject({ addressType: 'broker', broker: 'broker:9092', topic: 'tx', mode: 'batch' });
    expect(api.sent('create_DF')[0]).toMatchObject({ quick: true, kind: 'address', topic: 'tx' });
  });

  it('realtime: no dataframe, listen_realtime', async () => {
    for (const input of ['kafka', 'rest_api']) {
      const api = service();
      expect(await start(api, { input, file: null })).toBe(true);
      expect(api.sent('create_DF')).toEqual([]);
      expect(api.sent('stream')[0].value).toMatchObject({ quick: true, listen_realtime: true, mode: 'realtime' });
      expect(api.sent('/connect_to_source')[0].topic).toBe(input === 'kafka' ? 'tx' : null);
      finishTask(getQuickRun().taskId, TASK_STATUSES.COMPLETED);
    }
  });

  it('one at a time', async () => {
    const api = service();
    await start(api);
    expect(await start(api)).toBe(false);
    expect(getTasks()).toHaveLength(1);
    clearQuickRun();
    expect(getQuickRun().phase).toBe('started');
    finishTask(getQuickRun().taskId, TASK_STATUSES.COMPLETED);
    expect(isQuickRunGoing()).toBe(false);
    clearQuickRun();
    expect(getQuickRun().phase).toBe('idle');
  });

  it('a failed step: says why, records no task and closes the session', async () => {
    const api = service({ '/connect_to_tool': { status: 'error', message: 'Authentication failed' } });
    expect(await start(api)).toBe(false);
    expect(getQuickRun().phase).toBe('failed');
    expect(getQuickRun().message).not.toBe('');
    expect(getTasks()).toEqual([]);
    expect(api.sent('stream')).toEqual([]);
    expect(api.sent('/close_source_window')).toHaveLength(1);
  });

  it('shows the Service’s refusal of something over the limits', async () => {
    const api = service({ create_DF: () => { throw Object.assign(new Error('Bad request'), { status: 400, data: { code: 'quick_limit', detail: 'Over 20,000 rows.' } }); } });
    await start(api);
    expect(getQuickRun().message).toMatch(/20,000 rows/);
  });

  it('does not use an active rule the data does not offer', async () => {
    const api = service({ create_DF: { message: 'success', results: { rules: ['OTHER'], columns: ['a'], total_rows: 1 } } });
    expect(await start(api)).toBe(false);
    expect(getQuickRun().message).toMatch(/does not fit this data/);
    expect(api.sent('stream')).toEqual([]);
  });

  it('stops before it is sent when the domain is changed meanwhile', async () => {
    let now = defaults;
    const api = service({ create_DF: () => {
      now = { ...defaults, domain: 'insurance' };
      return { message: 'success', results: { rules: ['FUND_FLOW'], columns: [], total_rows: 1 } };
    } });
    expect(await start(api, { getDefaults: () => now })).toBe(false);
    expect(getQuickRun().message).toMatch(/domain or the active rule was changed/);
    expect(api.sent('stream')).toEqual([]);
  });

  it('cancelled while getting ready: nothing runs, the session is closed', async () => {
    const api = service({ '/connect_to_tool': () => { cancelQuickPreparation(); return { message: 'Connected!' }; } });
    expect(await start(api)).toBe(false);
    expect(getQuickRun().phase).toBe('idle');
    expect(api.sent('create_DF')).toEqual([]);
    expect(api.sent('/close_source_window')).toHaveLength(1);
  });

  it('cancelled while it was being started: the accepted run is ended', async () => {
    const api = service({ stream: () => { cancelQuickPreparation(); return { message: 'success', results: { task_id: 't-1', log_file: 'x.log' } }; } });
    expect(await start(api)).toBe(false);
    expect(api.sent('end_session')[0].value.log_file).toBe('x.log');
    expect(getTasks()).toEqual([]);
  });

  it('signed out while getting ready: nothing is shown or recorded', async () => {
    const api = service({ '/connect_to_tool': () => { resetQuickRun(); return { message: 'Connected!' }; } });
    expect(await start(api)).toBe(false);
    expect(getQuickRun().phase).toBe('idle');
    expect(getTasks()).toEqual([]);
  });

  it('closes its session once it has ended, and can be stopped', async () => {
    vi.useFakeTimers();
    const api = service();
    await start(api);
    const { taskId } = getQuickRun();
    expect(api.sent('/close_source_window')).toEqual([]);
    await terminateTask(taskId);
    expect(getTask(taskId).status).toBe(TASK_STATUSES.TERMINATED);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.sent('end_session')).toHaveLength(1);
    expect(api.sent('/close_source_window')).toHaveLength(1);
  });

  it('its end and result are the Service’s; never shown as Clean', async () => {
    const api = service();
    await start(api);
    const { taskId } = getQuickRun();
    applyServerTask({ task_id: 't-1', status: 'completed', verdict: 'undetermined', flags: {}, quick: true, ended_reason: 'finished', window_start: '2026-11-25T10:00:00Z', window_end: '2026-11-25T11:00:00Z' });
    const task = getTask(taskId);
    expect(task.status).toBe(TASK_STATUSES.COMPLETED);
    expect(task.windowStart).toBe(Date.parse('2026-11-25T10:00:00Z'));
    expect(taskFlagVerdict(task, []).label).toBe('No flags raised');
    expect(isQuickRunGoing()).toBe(false);
  });
});
