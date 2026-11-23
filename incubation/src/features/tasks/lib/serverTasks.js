// Loads the Service's tasks into the registry (H-2): the list on sign-in
// and when the Tasks window changes scope; task_updated keeps it live.

import { listTasks } from '../../../services/tasksApi.js';
import { applyServerTask, dropRemoteTasks } from './taskRegistry.js';

let lastLoad = null;
let current = { scope: 'mine', archived: false };
// What the last load asked for (a reconnect reloads the same).
export const getServerTaskScope = () => current;

// scope: 'mine' | 'all' (needs tasks:read_all); archived: also archived tasks.
// -> { ok, count, message? }
export const loadServerTasks = async (apiFetch, { scope = 'mine', archived = false } = {}) => {
  if (!apiFetch) return { ok: false, count: 0 };
  current = { scope, archived };
  lastLoad?.abort();
  const controller = new AbortController();
  lastLoad = controller;
  try {
    const { tasks, count } = await listTasks(apiFetch, { scope, archived, signal: controller.signal });
    if (controller.signal.aborted) return { ok: false, count: 0 };
    // Oldest first, so the newest ends on top.
    [...tasks].reverse().forEach(applyServerTask);
    dropRemoteTasks(tasks.map((task) => task.task_id));
    return { ok: true, count };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, count: 0 };
    return { ok: false, count: 0, message: error?.status === 403 ? 'Your account cannot see every analyst’s tasks.' : 'The task list could not be loaded from the Service.' };
  } finally {
    if (lastLoad === controller) lastLoad = null;
  }
};

export const handleTaskUpdated = (payload = {}) => {
  if (payload?.task && typeof payload.task === 'object') applyServerTask(payload.task);
};
