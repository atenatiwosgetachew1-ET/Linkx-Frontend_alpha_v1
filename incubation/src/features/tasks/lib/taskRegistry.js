// Analysis tasks: one record per analysis run (a Source window stream or a
// quick-panel analysis), kept for the Tasks window.
//
// The registry lives outside React/workspace state so a task outlives the
// window that started it (a stream kept running in the background after its
// Source window closed) and so busy updates (progress, elapsed time) never
// re-render the whole workspace. Components read it with
// useSyncExternalStore(subscribeTasks, getTasksSnapshot).
//
// Analysis sessions are capped at MAX_ANALYSIS_SESSIONS for backend resource
// efficiency. A session is held by every open Source window, every running
// background stream (its window closed, its backend session kept until the
// stream ends) and every running quick-panel analysis. See getSessionUsage.
//
// Tasks are in-memory: they are lost on reload until the backend offers a
// task list (docs/backend-requests.md B-20).

export const MAX_ANALYSIS_SESSIONS = 3;
const MAX_TASKS = 50; // finished tasks beyond this are dropped, oldest first

export const TASK_STATUSES = Object.freeze({
  STARTING: 'starting',
  RUNNING: 'running',
  COMPLETED: 'completed',
  TERMINATED: 'terminated',
  FAILED: 'failed',
});

export const TASK_ORIGINS = Object.freeze({
  SOURCE: 'source',
  QUICK: 'quick',
});

const ACTIVE_STATUSES = new Set([TASK_STATUSES.STARTING, TASK_STATUSES.RUNNING]);
export const isTaskActive = (task) => Boolean(task) && ACTIVE_STATUSES.has(task.status);

let tasks = []; // newest first
let focus = { taskId: null, seq: 0 };
let snapshot = { tasks, focus };
let seq = 0;
const listeners = new Set();
const endListeners = new Set();
const handlers = new Map(); // taskId -> { terminate }

const emit = () => {
  snapshot = { tasks, focus };
  listeners.forEach((listener) => listener());
};

const trim = (list) => {
  if (list.length <= MAX_TASKS) return list;
  const keep = [];
  let finishedKept = 0;
  const finishedBudget = MAX_TASKS - list.filter(isTaskActive).length;
  list.forEach((task) => {
    if (isTaskActive(task)) keep.push(task);
    else if (finishedKept < finishedBudget) {
      keep.push(task);
      finishedKept += 1;
    } else handlers.delete(task.id);
  });
  return keep;
};

export const subscribeTasks = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getTasksSnapshot = () => snapshot;
export const getTasks = () => tasks;
export const getTask = (id) => tasks.find((task) => task.id === id) || null;

// Creates a task and returns its id. `fields` are display/context data:
// { origin, title, action, input, mode, windowId, windowTitle,
//   sourceSessionId, rule, sourceColumn, targetColumn, relationship }.
export const createTask = (fields = {}) => {
  seq += 1;
  const id = `task-${Date.now().toString(36)}-${seq}`;
  const task = {
    id,
    number: seq,
    origin: TASK_ORIGINS.SOURCE,
    title: 'Analysis',
    action: '',
    input: '',
    mode: '',
    windowId: '',
    windowTitle: '',
    sourceSessionId: '',
    logFile: '',
    rule: '',
    sourceColumn: '',
    targetColumn: '',
    relationship: '',
    dataframe: null, // { totalRows, totalColumns, columns, name, tool }
    ...fields,
    status: TASK_STATUSES.STARTING,
    background: false,
    hasResults: false, // the run reached the backend (graph/chart may show data)
    progress: null,
    statusText: '',
    message: '',
    log: [], // own lines (quick tasks); stream tasks read their window's log
    frozenLog: null, // stream log copied once the window log moves on
    startedAt: Date.now(),
    endedAt: null,
  };
  tasks = trim([task, ...tasks]);
  emit();
  return id;
};

export const updateTask = (id, patch) => {
  let changed = false;
  tasks = tasks.map((task) => {
    if (task.id !== id) return task;
    changed = true;
    return { ...task, ...patch };
  });
  if (changed) emit();
};

export const markTaskRunning = (id) => {
  const task = getTask(id);
  if (!task || task.status !== TASK_STATUSES.STARTING) return;
  updateTask(id, { status: TASK_STATUSES.RUNNING, hasResults: true });
};

// Ends a task once; later calls are ignored (completion may be seen by both
// the job poll and the backend log line).
export const finishTask = (id, status, { message = '' } = {}) => {
  const task = getTask(id);
  if (!task || !isTaskActive(task)) return false;
  const ended = {
    ...task,
    status,
    message: message || task.message,
    endedAt: Date.now(),
    hasResults: task.hasResults || status === TASK_STATUSES.COMPLETED,
    progress: status === TASK_STATUSES.COMPLETED ? 100 : task.progress,
  };
  tasks = tasks.map((item) => (item.id === id ? ended : item));
  handlers.delete(id);
  emit();
  endListeners.forEach((listener) => {
    try { listener(ended); } catch { /* a listener must not break the others */ }
  });
  return true;
};

export const appendTaskLog = (id, message, level = 'info') => {
  const task = getTask(id);
  if (!task) return;
  const at = new Date().toISOString().replace('T', ' ').slice(0, 19);
  updateTask(id, { log: [...task.log, { at, level, message: String(message) }].slice(-500) });
};

// Stream tasks show their window's live log; once the window starts another
// run (or goes away) the lines are copied into the task.
export const freezeWindowTaskLogs = (windowId, lines) => {
  const key = String(windowId);
  let changed = false;
  tasks = tasks.map((task) => {
    if (String(task.windowId) !== key || task.frozenLog) return task;
    changed = true;
    return { ...task, frozenLog: Array.from(lines || []) };
  });
  if (changed) emit();
};

export const setTaskBackground = (id, background = true) => updateTask(id, { background });

// Called with the ended task whenever any task ends.
export const onTaskEnded = (listener) => {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
};

// Whoever runs the task registers how to stop it (the Source window while it
// is open, the workspace once the stream runs in the background, the quick
// panel for its analyses).
export const setTaskHandlers = (id, next) => {
  if (!getTask(id)) return;
  handlers.set(id, { ...handlers.get(id), ...next });
};

export const canTerminateTask = (id) => isTaskActive(getTask(id)) && typeof handlers.get(id)?.terminate === 'function';

export const terminateTask = async (id) => {
  const handler = handlers.get(id)?.terminate;
  if (!isTaskActive(getTask(id)) || typeof handler !== 'function') return false;
  await handler();
  return true;
};

export const getActiveTaskForWindow = (windowId) => tasks.find(
  (task) => String(task.windowId) === String(windowId) && isTaskActive(task),
) || null;

export const getLatestTaskForWindow = (windowId) => tasks.find((task) => String(task.windowId) === String(windowId)) || null;

// Running tasks that hold an analysis session without an open Source window.
export const countDetachedSessions = (list = tasks) => list.filter((task) => isTaskActive(task)
  && (task.origin === TASK_ORIGINS.QUICK || task.background)).length;

export const countActiveTasks = (list = tasks) => list.filter(isTaskActive).length;

// { used, limit, available, openWindows, background, quick }.
export const getSessionUsage = (openSourceWindows = 0, list = tasks) => {
  const background = list.filter((task) => isTaskActive(task) && task.origin === TASK_ORIGINS.SOURCE && task.background).length;
  const quick = list.filter((task) => isTaskActive(task) && task.origin === TASK_ORIGINS.QUICK).length;
  const used = openSourceWindows + background + quick;
  return {
    used,
    limit: MAX_ANALYSIS_SESSIONS,
    available: Math.max(0, MAX_ANALYSIS_SESSIONS - used),
    openWindows: openSourceWindows,
    background,
    quick,
  };
};

export const sessionLimitMessage = (usage) => {
  const parts = [];
  if (usage.openWindows) parts.push(`${usage.openWindows} Source window${usage.openWindows === 1 ? '' : 's'}`);
  if (usage.background) parts.push(`${usage.background} background stream${usage.background === 1 ? '' : 's'}`);
  if (usage.quick) parts.push(`${usage.quick} quick analys${usage.quick === 1 ? 'is' : 'es'}`);
  return `All ${usage.limit} analysis sessions are in use (${parts.join(', ') || 'none free'}). `
    + 'Wait for a task to finish, stop one in the Tasks window, or close a Source window.';
};

// Asks the Tasks window to select a task (it may not be open yet).
export const requestTaskFocus = (id) => {
  focus = { taskId: id, seq: focus.seq + 1 };
  emit();
};

export const removeFinishedTasks = () => {
  const next = tasks.filter(isTaskActive);
  if (next.length === tasks.length) return;
  tasks.filter((task) => !isTaskActive(task)).forEach((task) => handlers.delete(task.id));
  tasks = next;
  emit();
};

// Signed out: forget everything.
export const resetTasks = () => {
  tasks = [];
  focus = { taskId: null, seq: 0 };
  handlers.clear();
  emit();
};
