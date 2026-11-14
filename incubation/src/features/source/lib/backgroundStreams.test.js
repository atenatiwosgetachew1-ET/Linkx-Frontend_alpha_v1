import { afterEach, describe, expect, it, vi } from 'vitest';

import { TASK_STATUSES, createTask, getTask, resetTasks, terminateTask } from '../../tasks/lib/taskRegistry.js';
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
});
