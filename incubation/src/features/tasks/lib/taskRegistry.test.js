import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_ANALYSIS_SESSIONS,
  TASK_ORIGINS,
  TASK_STATUSES,
  canTerminateTask,
  countActiveTasks,
  countDetachedSessions,
  createTask,
  finishTask,
  freezeWindowTaskLogs,
  getActiveTaskForWindow,
  getSessionUsage,
  getTask,
  getTasksSnapshot,
  markTaskRunning,
  onTaskEnded,
  removeFinishedTasks,
  requestTaskFocus,
  resetTasks,
  sessionLimitMessage,
  setTaskBackground,
  setTaskHandlers,
  subscribeTasks,
  terminateTask,
} from './taskRegistry.js';
import { formatDuration, matchesTaskFilter, taskParameters, taskStatusLabel } from './taskFormat.js';

afterEach(() => resetTasks());

describe('taskRegistry', () => {
  it('records a run from start to completion, newest first', () => {
    const first = createTask({ windowId: 'w1', title: 'Link Analysis' });
    const second = createTask({ windowId: 'w2', title: 'Store data' });
    expect(getTasksSnapshot().tasks.map((task) => task.id)).toEqual([second, first]);
    expect(getTask(first).status).toBe(TASK_STATUSES.STARTING);

    markTaskRunning(first);
    expect(getTask(first)).toMatchObject({ status: TASK_STATUSES.RUNNING, hasResults: true });
    expect(finishTask(first, TASK_STATUSES.COMPLETED)).toBe(true);
    expect(getTask(first).endedAt).toBeTypeOf('number');
    expect(getActiveTaskForWindow('w1')).toBeNull();
    expect(getActiveTaskForWindow('w2').id).toBe(second);
  });

  it('ends a task only once (job poll and log line may both report it)', () => {
    const ended = vi.fn();
    const stop = onTaskEnded(ended);
    const id = createTask();
    finishTask(id, TASK_STATUSES.COMPLETED);
    finishTask(id, TASK_STATUSES.FAILED, { message: 'late' });
    stop();
    expect(ended).toHaveBeenCalledTimes(1);
    expect(getTask(id).status).toBe(TASK_STATUSES.COMPLETED);
  });

  it('notifies subscribers with a new snapshot on every change', () => {
    const listener = vi.fn();
    const stop = subscribeTasks(listener);
    const before = getTasksSnapshot();
    createTask();
    stop();
    expect(listener).toHaveBeenCalled();
    expect(getTasksSnapshot()).not.toBe(before);
  });

  it('terminates through the handler registered by whoever runs the task', async () => {
    const id = createTask();
    expect(canTerminateTask(id)).toBe(false);
    const terminate = vi.fn(() => finishTask(id, TASK_STATUSES.TERMINATED));
    setTaskHandlers(id, { terminate });
    expect(canTerminateTask(id)).toBe(true);
    expect(await terminateTask(id)).toBe(true);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(canTerminateTask(id)).toBe(false);
    expect(await terminateTask(id)).toBe(false);
  });

  it('copies the window log into its tasks once', () => {
    const id = createTask({ windowId: 'w1' });
    freezeWindowTaskLogs('w1', [{ message: 'a' }]);
    freezeWindowTaskLogs('w1', [{ message: 'b' }]);
    expect(getTask(id).frozenLog).toEqual([{ message: 'a' }]);
  });

  it('carries focus requests for the Tasks window', () => {
    const id = createTask();
    requestTaskFocus(id);
    const { focus } = getTasksSnapshot();
    requestTaskFocus(id);
    expect(getTasksSnapshot().focus).toEqual({ taskId: id, seq: focus.seq + 1 });
  });

  it('clears finished tasks but keeps running ones', () => {
    const running = createTask();
    finishTask(createTask(), TASK_STATUSES.FAILED);
    removeFinishedTasks();
    expect(getTasksSnapshot().tasks.map((task) => task.id)).toEqual([running]);
  });
});

describe('analysis session cap', () => {
  it('is three sessions', () => {
    expect(MAX_ANALYSIS_SESSIONS).toBe(3);
  });

  it('counts open Source windows, background streams and running quick analyses', () => {
    const foreground = createTask({ windowId: 'w1' }); // its window is open: counted as a window
    const background = createTask({ windowId: 'w2' });
    setTaskBackground(background, true);
    createTask({ origin: TASK_ORIGINS.QUICK });
    finishTask(createTask({ origin: TASK_ORIGINS.QUICK }), TASK_STATUSES.COMPLETED); // finished: frees its session

    expect(countDetachedSessions()).toBe(2);
    expect(countActiveTasks()).toBe(3);
    const usage = getSessionUsage(1);
    expect(usage).toMatchObject({ used: 3, available: 0, openWindows: 1, background: 1, quick: 1 });
    expect(sessionLimitMessage(usage)).toContain('1 Source window, 1 background stream, 1 quick analysis');

    finishTask(background, TASK_STATUSES.COMPLETED);
    expect(getSessionUsage(1).available).toBe(1);
    expect(foreground).toBeTruthy();
  });
});

describe('taskFormat', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(185_000)).toBe('3m 05s');
    expect(formatDuration(3_720_000)).toBe('1h 02m');
  });

  it('labels statuses and filters', () => {
    const queued = { status: TASK_STATUSES.STARTING, origin: TASK_ORIGINS.SOURCE };
    expect(taskStatusLabel(queued)).toBe('Queued');
    expect(taskStatusLabel({ status: TASK_STATUSES.TERMINATED })).toBe('Stopped');
    expect(matchesTaskFilter(queued, 'active')).toBe(true);
    expect(matchesTaskFilter({ status: TASK_STATUSES.FAILED }, 'stopped')).toBe(true);
    expect(matchesTaskFilter({ status: TASK_STATUSES.FAILED }, 'completed')).toBe(false);
  });

  it('lists the run parameters', () => {
    expect(taskParameters({ rule: 'R1' })).toEqual([['Rule', 'R1']]);
    expect(taskParameters({ sourceColumn: 'from', targetColumn: 'to', relationship: 'PAYS' }))
      .toEqual([['Columns', 'from → to'], ['Relationship', 'PAYS']]);
  });
});
