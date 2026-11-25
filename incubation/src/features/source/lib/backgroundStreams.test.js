import { afterEach, describe, expect, it, vi } from 'vitest';

import { TASK_STATUSES, applyServerTask, attachOwnRuns, canTerminateTask, setServerTaskOwner, createTask, finishTask, getTask, linkServerTask, resetTasks, terminateTask, updateTask } from '../../tasks/lib/taskRegistry.js';
import { endedText } from '../../tasks/lib/taskFormat.js';
import { taskFlagVerdict } from '../../tasks/lib/taskFlags.js';
import { isRunGraphKept } from '../../graph/lib/graphLinkFlow.js';
import { getActiveStream, markStreamActive, markStreamEnded } from './activeStreams.js';
import { continueStreamInBackground, watchStreamTask } from './backgroundStreams.js';
import { disposeStreamLog } from './streamLogs.js';

// Backend lines reach the log through the socket; a fake socket feeds them.
const makeSocket = () => {
  const handlers = {};
  return {
    connected: true,
    on: (event, handler) => { handlers[event] = handler; },
    off: vi.fn(),
    emit: vi.fn(),
    push: (data) => handlers.stream_logs?.({ session_id: 's1', data }),
  };
};

afterEach(() => {
  vi.useRealTimers();
  markStreamEnded('w9');
  disposeStreamLog('w9');
  resetTasks();
});

const startBackground = async ({ apiFetch = vi.fn(async () => ({ message: 'success' })) } = {}) => {
  const { plugStreamLog } = await import('./streamLogs.js');
  const socket = makeSocket();
  plugStreamLog('w9', { socket, sessionId: 's1', filename: 'ingest.log' });
  markStreamActive('w9', { sourceSessionId: 's1', logFile: 'ingest.log' });
  const taskId = createTask({ windowId: 'w9', sourceSessionId: 's1' });
  const release = vi.fn();
  continueStreamInBackground({ windowId: 'w9', taskId, apiFetch, release });
  return { socket, taskId, release, apiFetch };
};

describe('continueStreamInBackground', () => {
  it('follows the backend log to completion, then releases the window session', async () => {
    vi.useFakeTimers();
    const { socket, taskId, release } = await startBackground();
    expect(getTask(taskId).background).toBe(true);

    socket.push('[10:00:01] [Info] - Injection started\n');
    vi.advanceTimersByTime(250);
    expect(getTask(taskId).status).toBe(TASK_STATUSES.RUNNING);

    socket.push('[10:05:00] [Info] - Injection finished for action Link Analysis\n');
    vi.advanceTimersByTime(250);
    expect(getTask(taskId).status).toBe(TASK_STATUSES.COMPLETED);
    expect(getActiveStream('w9')).toBeNull();

    vi.advanceTimersByTime(500);
    expect(release).toHaveBeenCalledTimes(1);
    expect(getTask(taskId).frozenLog.some((line) => /Injection finished/.test(line.message))).toBe(true);
  });

  it('terminates from the Tasks window with the production end_session request', async () => {
    const { taskId, apiFetch } = await startBackground();
    await terminateTask(taskId);
    expect(apiFetch).toHaveBeenCalledWith('/live_batch_files', expect.objectContaining({
      body: expect.objectContaining({ id: 'end_session', session_id: 's1' }),
    }));
    expect(getTask(taskId).status).toBe(TASK_STATUSES.TERMINATED);
  });
});

describe('watchStreamTask', () => {
  it('completes a stream task without its Source window mounted', async () => {
    vi.useFakeTimers();
    const { plugStreamLog } = await import('./streamLogs.js');
    const socket = makeSocket();
    plugStreamLog('w9', { socket, sessionId: 's1', filename: 'ingest.log' });
    markStreamActive('w9', { sourceSessionId: 's1' });
    const taskId = createTask({ origin: 'source', title: 'Link Analysis', windowId: 'w9' });
    watchStreamTask('w9', taskId);

    socket.push('[10:00:00] [Info] - batch 1 loaded\n');
    vi.advanceTimersByTime(250);
    expect(getTask(taskId).status).toBe(TASK_STATUSES.RUNNING);

    socket.push('[10:05:00] [Info] - Injection finished for action Link Analysis\n');
    vi.advanceTimersByTime(250);
    expect(getTask(taskId).status).toBe(TASK_STATUSES.COMPLETED);
    expect(getActiveStream('w9')).toBeFalsy();
  });

  // The full analysis follows the rows (Service answer 2026-11-25, B-32).
  const follow = async (setup) => {
    vi.useFakeTimers();
    const { plugStreamLog } = await import('./streamLogs.js');
    const socket = makeSocket();
    plugStreamLog('w9', { socket, sessionId: 's1', filename: 'ingest.log' });
    markStreamActive('w9', { sourceSessionId: 's1' });
    const taskId = createTask({ origin: 'source', windowId: 'w9' });
    setup(taskId);
    watchStreamTask('w9', taskId);
    socket.push('[10:05:00] [Info] - Injection finished for action Link Analysis\n');
    vi.advanceTimersByTime(250);
    return taskId;
  };

  it('a run the Service has a task for ends when the Service says so', async () => {
    const taskId = await follow((id) => linkServerTask(id, 'T1'));
    expect(getTask(taskId)).toMatchObject({ status: TASK_STATUSES.RUNNING, rowsIn: true });
    expect(getActiveStream('w9')).toBeTruthy();
    applyServerTask({ task_id: 'T1', status: 'failed', message: 'The analysis failed.' });
    expect(getTask(taskId)).toMatchObject({ status: TASK_STATUSES.FAILED, message: 'The analysis failed.' });
    expect(getActiveStream('w9')).toBeFalsy();
  });

  it('a run whose job is followed ends with its job', async () => {
    const taskId = await follow((id) => updateTask(id, { jobFollowed: true }));
    expect(getTask(taskId).status).toBe(TASK_STATUSES.RUNNING);
  });

  it('the Service corrects a run that ended otherwise here, but not one stopped here', () => {
    const ended = createTask({ origin: 'source', windowId: 'w1' });
    linkServerTask(ended, 'T2');
    finishTask(ended, TASK_STATUSES.COMPLETED);
    applyServerTask({ task_id: 'T2', status: 'failed', message: 'Out of memory.' });
    expect(getTask(ended)).toMatchObject({ status: TASK_STATUSES.FAILED, message: 'Out of memory.' });
    const stopped = createTask({ origin: 'source', windowId: 'w2' });
    linkServerTask(stopped, 'T3');
    finishTask(stopped, TASK_STATUSES.TERMINATED);
    applyServerTask({ task_id: 'T3', status: 'completed' });
    expect(getTask(stopped).status).toBe(TASK_STATUSES.TERMINATED);
  });
});

describe('a run an earlier page started', () => {
  afterEach(() => setServerTaskOwner({}));
  it('can be stopped by its owner only', async () => {
    setServerTaskOwner({ userId: '1', username: 'ana' });
    const own = applyServerTask({ task_id: 'A', status: 'running', user_id: 1, source_session_id: '4_9', log_file: 'a.log' });
    const other = applyServerTask({ task_id: 'B', status: 'running', user_id: 2, username: 'bob', source_session_id: '5_9' });
    const alert = applyServerTask({ task_id: 'C', status: 'running', user_id: 1, origin: 'parent', source_session_id: '6_9' });
    const terminate = vi.fn(async () => ({ ok: true }));
    attachOwnRuns(terminate);
    expect([own, other, alert].map(canTerminateTask)).toEqual([true, false, false]);
    await terminateTask(own);
    expect(terminate).toHaveBeenCalledWith(expect.objectContaining({ sourceSessionId: '4_9', logFile: 'a.log' }));
    expect(getTask(own).status).toBe(TASK_STATUSES.TERMINATED);
  });
  it('a refused stop says so and leaves it going', async () => {
    setServerTaskOwner({ userId: '1' });
    const own = applyServerTask({ task_id: 'A', status: 'running', user_id: 1, source_session_id: '4_9' });
    attachOwnRuns(async () => ({ ok: false, message: 'No streaming found' }));
    await terminateTask(own);
    expect(getTask(own)).toMatchObject({ status: TASK_STATUSES.RUNNING, message: 'No streaming found' });
  });
});

it('what the Service says of a run: why it ended, its graph, limits and settings', () => {
  const id = applyServerTask({
    task_id: 'A', status: 'terminated', ended_reason: 'browser_disconnected', graph_saved: true, graph_expires_at: new Date(Date.now() + 36e5).toISOString(), limit_seconds: 7200,
    config_versions: { thresholds: 12, preset: 'baseline', mapping: null, columns: null }, domain: 'cdr',
  });
  expect(getTask(id)).toMatchObject({ endedReason: 'browser_disconnected', graphSaved: true, limitSeconds: 7200, domain: 'cdr', configVersions: { thresholds: '12', preset: 'baseline', mapping: null, columns: null } });
  expect(endedText(getTask(id))).toBe('Its owner’s browser was gone.');
  expect(isRunGraphKept(getTask(id))).toBe(true);
  expect(isRunGraphKept(getTask(id), Date.now() + 2 * 36e5)).toBe(false);
  const clean = applyServerTask({ task_id: 'B', status: 'completed', verdict: 'clean', flags: {}, ended_reason: 'time_limit' });
  expect(taskFlagVerdict(getTask(clean), []).detail).toContain('before its time limit');
});
