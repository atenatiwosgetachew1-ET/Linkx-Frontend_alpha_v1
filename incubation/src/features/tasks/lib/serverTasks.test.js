import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TASK_LIFECYCLES, TASK_ORIGINS, TASK_STATUSES, applyServerTask, countActiveTasks, createTask, getTask, getTaskByServerId, getTasks,
  linkServerTask, resetTasks, setServerTaskOwner,
} from './taskRegistry.js';
import { taskFlagVerdict } from './taskFlags.js';
import { loadServerTasks } from './serverTasks.js';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';

afterEach(() => resetTasks());

const serverTask = (fields = {}) => ({
  task_id: 'T1', origin: 'analyst', user_id: 'u1', username: 'me', action: 'Link Analysis', status: 'running', lifecycle: 'active', flags: {}, ...fields,
});

describe('the Service’s tasks (H-2, H-7)', () => {
  it('shows a task with no run here read-only, and ties a run started here to its task', () => {
    setServerTaskOwner({ userId: 'u1', username: 'me' });
    applyServerTask(serverTask({ task_id: 'OLD', status: 'completed', verdict: 'clean' }));
    expect(getTaskByServerId('OLD')).toMatchObject({ remote: true, status: TASK_STATUSES.COMPLETED, verdict: 'clean', foreign: false });

    const local = createTask({ origin: TASK_ORIGINS.SOURCE, title: 'Link Analysis' });
    // task_updated may arrive before the stream answer names the task.
    applyServerTask(serverTask({ flags: { FUND_FLOW: 2 } }));
    linkServerTask(local, 'T1');
    expect(getTasks().filter((task) => task.serverId === 'T1')).toHaveLength(1);
    expect(getTask(local)).toMatchObject({ serverId: 'T1', flags: { FUND_FLOW: 2 } });

    // The Service ends it (terminated before it started, H-12).
    applyServerTask(serverTask({ status: 'terminated', verdict: 'undetermined', lifecycle: 'expiring' }));
    expect(getTask(local)).toMatchObject({ status: TASK_STATUSES.TERMINATED, lifecycle: TASK_LIFECYCLES.EXPIRING, verdict: 'undetermined' });
  });

  it('never counts another analyst’s running task (a supervisor’s All tasks)', () => {
    setServerTaskOwner({ userId: 'u1', username: 'me' });
    applyServerTask(serverTask({ task_id: 'X', user_id: 'u9', username: 'other', origin: 'parent' }));
    expect(getTaskByServerId('X')).toMatchObject({ foreign: true, ownerName: 'other' });
    expect(countActiveTasks()).toBe(0);
  });

  it('takes the verdict and flags from the task, not the log; old records name rules without counts', () => {
    const verdict = (fields) => taskFlagVerdict({ status: TASK_STATUSES.COMPLETED, ...fields }, ['[Info] … flags: {}']);
    expect(verdict({ verdict: 'suspicious', flags: { FUND_FLOW: 3, STRUCTURING: 0 } })).toMatchObject({ state: 'suspicious', flags: [{ name: 'FUND_FLOW', count: 3 }] });
    expect(verdict({ verdict: 'suspicious', flags: { SMURFING: null } }).flags).toEqual([{ name: 'SMURFING', count: 0 }]);
    expect(verdict({ verdict: 'clean', flags: {} }).state).toBe('clean');
    expect(taskFlagVerdict({ status: TASK_STATUSES.RUNNING, flags: { FUND_FLOW: 1 } }).detail).toBe('Provisional');
  });

  it('loads the list for a scope and explains a refused All tasks', async () => {
    setServerTaskOwner({ userId: 'u1' });
    const apiFetch = vi.fn().mockResolvedValue({ data: [serverTask({ task_id: 'A', status: 'completed' })], count: 1 });
    expect(await loadServerTasks(apiFetch, { scope: 'mine' })).toMatchObject({ ok: true, count: 1 });
    expect(apiFetch.mock.calls[0][0]).toBe('/api/v1/tasks?scope=mine&limit=50&offset=0');
    expect(getTaskByServerId('A')).toBeTruthy();
    const refused = vi.fn().mockRejectedValue(Object.assign(new Error('forbidden'), { status: 403 }));
    expect((await loadServerTasks(refused, { scope: 'all' })).message).toMatch(/cannot see every/);
  });

  it('explains the Service’s coded refusals', () => {
    expect(getServiceRefusalMessage({ data: { code: 'task_expired' } })).toMatch(/Reconfirm/);
    expect(getServiceRefusalMessage({ data: { message: 'session_limit', code: 'session_limit', detail: '3 of 3 analyses are running.' } })).toBe('3 of 3 analyses are running.');
    expect(getServiceRefusalMessage({ data: { message: 'invalid_dataframe_filter', detail: "column 'X' does not exist in the dataframe" } })).toBe("column 'X' does not exist in the dataframe");
    expect(getServiceRefusalMessage({ data: { permission: 'analysis:run' } })).toMatch(/analysis:run/);
    expect(getServiceRefusalMessage({ data: { message: 'nope' } })).toBe('');
  });
});
