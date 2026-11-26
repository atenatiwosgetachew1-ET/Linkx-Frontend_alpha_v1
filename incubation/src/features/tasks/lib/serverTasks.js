// Loads the Service's tasks into the registry (H-2): the list on sign-in
// and when the Tasks window changes scope; task_updated keeps it live.

import { listTasks } from '../../../services/tasksApi.js';
import { endStreamRequest } from '../../../services/sourceApi.js';
import { applyServerTask, attachOwnRuns, dropRemoteTasks } from './taskRegistry.js';

let lastLoad = null;
let current = { scope: 'mine', archived: false };
// What the last load asked for (a reconnect reloads the same).
export const getServerTaskScope = () => current;

// The list request, for the Tasks window: loading (asked, not answered),
// loaded (answered once), error (why the last one failed, '' if it did not).
let loadState = { loading: false, loaded: false, error: '' };
const loadListeners = new Set();
const setLoadState = (patch) => {
  loadState = { ...loadState, ...patch };
  loadListeners.forEach((listener) => listener());
};
export const subscribeServerTaskLoad = (listener) => {
  loadListeners.add(listener);
  return () => loadListeners.delete(listener);
};
export const getServerTaskLoad = () => loadState;
// Tests and sign-out.
export const resetServerTaskLoad = () => setLoadState({ loading: false, loaded: false, error: '' });

// scope: 'mine' | 'all' (needs tasks:read_all); archived: also archived tasks.
// -> { ok, count, message? }
export const loadServerTasks = async (apiFetch, { scope = 'mine', archived = false } = {}) => {
  if (!apiFetch) return { ok: false, count: 0 };
  current = { scope, archived };
  lastLoad?.abort();
  const controller = new AbortController();
  lastLoad = controller;
  setLoadState({ loading: true, error: '' });
  try {
    const { tasks, count } = await listTasks(apiFetch, { scope, archived, signal: controller.signal });
    if (controller.signal.aborted) return { ok: false, count: 0 };
    // Oldest first, so the newest ends on top.
    [...tasks].reverse().forEach(applyServerTask);
    dropRemoteTasks(tasks.map((task) => task.task_id));
    attachOwnRuns((task) => endStreamRequest(apiFetch, { sourceSessionId: task.sourceSessionId, logFile: task.logFile }));
    setLoadState({ loading: false, loaded: true });
    return { ok: true, count };
  } catch (error) {
    // Aborted: a newer load is on its way and settles the state.
    if (error?.name === 'AbortError' || controller.signal.aborted) return { ok: false, count: 0 };
    const message = error?.status === 403 ? 'Your account cannot see every analyst’s tasks.' : 'The task list could not be loaded from the Service.';
    setLoadState({ loading: false, error: message });
    return { ok: false, count: 0, message };
  } finally {
    if (lastLoad === controller) lastLoad = null;
  }
};

export const handleTaskUpdated = (payload = {}) => {
  if (payload?.task && typeof payload.task === 'object') applyServerTask(payload.task);
};
