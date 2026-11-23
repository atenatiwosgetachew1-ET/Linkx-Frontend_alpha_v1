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
// The Service records every run as a task (frontend alignment 2026-11-20,
// H-2): applyServerTask() merges its records (the list on load and each
// task_updated event) into this registry. A run started in this browser is
// tied to its Service task by linkServerTask() (the stream answer's
// task_id); a Service task with no local run (an earlier page load, a
// supervisor's view of all tasks) is shown read-only.

export const MAX_ANALYSIS_SESSIONS = 3;
const MAX_TASKS = 50; // finished tasks beyond this are dropped, oldest first

export const TASK_STATUSES = Object.freeze({
  STARTING: 'starting',
  RUNNING: 'running',
  COMPLETED: 'completed',
  TERMINATED: 'terminated',
  FAILED: 'failed',
});

// The Service's lifecycle of a task (H-2).
export const TASK_LIFECYCLES = Object.freeze({ ACTIVE: 'active', EXPIRING: 'expiring', EXPIRED: 'expired', ARCHIVED: 'archived' });

export const TASK_ORIGINS = Object.freeze({
  SOURCE: 'source',
  QUICK: 'quick',
  // A parent STR alert's link analysis (analysis-results-plan Phase 4).
  PARENT: 'parent',
});

const ACTIVE_STATUSES = new Set([TASK_STATUSES.STARTING, TASK_STATUSES.RUNNING]);
export const isTaskActive = (task) => Boolean(task) && ACTIVE_STATUSES.has(task.status);
// Another analyst's task (a supervisor's "All tasks"): shown, never counted.
const isOwnTask = (task) => !task.foreign;

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
export const countDetachedSessions = (list = tasks) => list.filter((task) => isTaskActive(task) && isOwnTask(task)
  && (task.origin === TASK_ORIGINS.QUICK || task.background)).length;

export const countActiveTasks = (list = tasks) => list.filter((task) => isTaskActive(task) && isOwnTask(task)).length;

// { used, limit, available, openWindows, background, quick }.
export const getSessionUsage = (openSourceWindows = 0, list = tasks) => {
  const own = list.filter(isOwnTask);
  const background = own.filter((task) => isTaskActive(task) && task.origin === TASK_ORIGINS.SOURCE && task.background).length;
  // Quick-panel runs and parent-alert runs each hold a session (H-8).
  const quick = own.filter((task) => isTaskActive(task) && (task.origin === TASK_ORIGINS.QUICK || task.origin === TASK_ORIGINS.PARENT)).length;
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

/* ── The Service's tasks (H-2, H-7) ─────────────────────────────────── */

const SERVER_STATUS = {
  queued: TASK_STATUSES.STARTING,
  running: TASK_STATUSES.RUNNING,
  completed: TASK_STATUSES.COMPLETED,
  failed: TASK_STATUSES.FAILED,
  terminated: TASK_STATUSES.TERMINATED,
};
const VERDICTS = new Set(['suspicious', 'clean', 'undetermined']);
const time = (value) => {
  const ts = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(ts) ? ts : null;
};
// { RULE: count | null } (older records name the rule without a count).
const flagsOf = (value) => (value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).map(([rule, count]) => [String(rule).slice(0, 80), count === null || count === undefined || !Number.isFinite(Number(count)) ? null : Number(count)]))
  : null);

let serverOwner = { userId: '', username: '' };
const pendingServer = new Map(); // serverId -> raw task that arrived before its local run was linked
// Who is signed in, to tell their tasks from others' in "All tasks".
export const setServerTaskOwner = ({ userId = '', username = '' } = {}) => {
  serverOwner = { userId: String(userId || ''), username: String(username || '') };
};

// The Service fields every task carries once it is known there.
const serverFields = (raw) => {
  const lifecycle = Object.values(TASK_LIFECYCLES).includes(raw.lifecycle) ? raw.lifecycle : TASK_LIFECYCLES.ACTIVE;
  const owner = String(raw.user_id ?? '');
  const ownerName = String(raw.username ?? '');
  const foreign = Boolean((owner || ownerName) && (serverOwner.userId || serverOwner.username))
    && !(owner && owner === serverOwner.userId) && !(ownerName && ownerName === serverOwner.username);
  return {
    serverId: String(raw.task_id),
    lifecycle,
    expiresAt: time(raw.expires_at),
    archivedAt: time(raw.archived_at),
    reconfirmedAt: time(raw.reconfirmed_at),
    evidenceId: raw.evidence_id ? String(raw.evidence_id) : '',
    ...(VERDICTS.has(raw.verdict) ? { verdict: raw.verdict } : {}),
    ...(flagsOf(raw.flags) ? { flags: flagsOf(raw.flags) } : {}),
    ...(raw.filter_result && typeof raw.filter_result === 'object' ? { filterResult: raw.filter_result } : {}),
    ownerName,
    foreign,
  };
};

// A Service task with no local run, in the registry's shape.
const fromServer = (raw) => {
  seq += 1;
  const status = SERVER_STATUS[raw.status] || TASK_STATUSES.COMPLETED;
  const origin = raw.origin === 'parent' ? TASK_ORIGINS.PARENT : raw.origin === 'quick' ? TASK_ORIGINS.QUICK : TASK_ORIGINS.SOURCE;
  const frame = raw.dataframe && typeof raw.dataframe === 'object' ? raw.dataframe : null;
  return {
    id: `server-${raw.task_id}`,
    number: seq,
    origin,
    title: String(raw.action || (origin === TASK_ORIGINS.PARENT ? 'STR link analysis' : 'Analysis')),
    action: String(raw.action || ''),
    input: String(raw.input || raw.external_reference_id || ''),
    mode: String(raw.mode || ''),
    windowId: '',
    windowTitle: String(raw.external_reference_id || raw.source_session_id || ''),
    sourceSessionId: String(raw.source_session_id || ''),
    logFile: String(raw.log_file || ''),
    rule: String(raw.rule || ''),
    sourceColumn: String(raw.source || ''),
    targetColumn: String(raw.target || ''),
    relationship: String(raw.relationship || ''),
    dataframe: frame ? {
      totalRows: frame.total_rows ?? frame.totalRows ?? null,
      totalColumns: frame.total_columns ?? frame.totalColumns ?? null,
      columns: Array.isArray(frame.columns) ? frame.columns.map(String) : [],
      name: String(frame.name || ''),
      tool: String(frame.tool || ''),
    } : null,
    alertId: origin === TASK_ORIGINS.PARENT ? String(raw.external_reference_id || '') : '',
    externalReferenceId: String(raw.external_reference_id || ''),
    status,
    background: false,
    hasResults: status !== TASK_STATUSES.STARTING,
    progress: status === TASK_STATUSES.COMPLETED ? 100 : null,
    statusText: '',
    message: String(raw.message || ''),
    log: [],
    frozenLog: null,
    startedAt: time(raw.started_at) || Date.now(),
    endedAt: time(raw.ended_at),
    remote: true, // no run in this browser: read-only
    ...serverFields(raw),
  };
};

// Merges a Service task (GET /api/v1/tasks, task_updated) into the registry.
export const applyServerTask = (raw) => {
  if (!raw || typeof raw !== 'object' || !raw.task_id) return null;
  const serverId = String(raw.task_id);
  const local = tasks.find((task) => task.serverId === serverId);
  if (!local) {
    // Its local run may link it in a moment (the stream answer).
    pendingServer.set(serverId, raw);
    if (pendingServer.size > 200) pendingServer.delete(pendingServer.keys().next().value);
    // Archived tasks are only shown when asked for (the list with archived=true).
    const task = fromServer(raw);
    tasks = trim([task, ...tasks.filter((item) => item.id !== task.id)]);
    emit();
    return task.id;
  }
  const patch = serverFields(raw);
  const status = SERVER_STATUS[raw.status];
  if (local.remote) {
    patch.status = status || local.status;
    patch.message = String(raw.message || local.message || '');
    patch.endedAt = time(raw.ended_at) || local.endedAt;
    patch.hasResults = local.hasResults || (status && status !== TASK_STATUSES.STARTING);
  }
  updateTask(local.id, patch);
  // A run in this browser that the Service ended (failed, terminated).
  if (!local.remote && isTaskActive(local) && status && !ACTIVE_STATUSES.has(status)) {
    finishTask(local.id, status, { message: String(raw.message || '') });
  }
  return local.id;
};

// Ties a run started here to its Service task (stream answer task_id, or
// an alert run's task); a record that already arrived is merged.
export const linkServerTask = (localId, serverId) => {
  const id = String(serverId || '');
  if (!id || !getTask(localId)) return;
  // A read-only copy that arrived first gives way to the local run.
  const remoteCopy = tasks.find((task) => task.remote && task.serverId === id);
  if (remoteCopy) {
    tasks = tasks.filter((task) => task !== remoteCopy);
    emit();
  }
  updateTask(localId, { serverId: id });
  const raw = pendingServer.get(id);
  pendingServer.delete(id);
  if (raw) applyServerTask(raw);
};

export const getTaskByServerId = (serverId) => tasks.find((task) => task.serverId === String(serverId)) || null;

// Read-only Service tasks not in a list just loaded (another scope).
export const dropRemoteTasks = (keepServerIds = []) => {
  const keep = new Set(keepServerIds.map(String));
  const next = tasks.filter((task) => !task.remote || keep.has(task.serverId));
  if (next.length === tasks.length) return;
  tasks = next;
  emit();
};

// Signed out: forget everything.
export const resetTasks = () => {
  pendingServer.clear();
  serverOwner = { userId: '', username: '' };
  tasks = [];
  focus = { taskId: null, seq: 0 };
  handlers.clear();
  emit();
};
