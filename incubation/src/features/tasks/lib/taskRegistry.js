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
// stream ends), every completed background run whose session is held for its
// graph (holdTaskSession) and every running quick-panel analysis. See
// getSessionUsage.
//
// The Service records every run as a task (frontend alignment 2026-11-20,
// H-2): applyServerTask() merges its records (the list on load and each
// task_updated event) into this registry. A run started in this browser is
// tied to its Service task by linkServerTask() (the stream answer's
// task_id); a Service task with no local run (an earlier page load, a
// supervisor's view of all tasks) is shown read-only.

import { describeFilterPayload } from '../../source/lib/dataframeFilter.js';
import { readSettingsUsed, settingsRemark } from '../../../shared/runSettings.js';

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
const heldReleases = new Map(); // taskId -> release({ keepalive })

const emit = () => {
  snapshot = { tasks, focus };
  listeners.forEach((listener) => listener());
};

const trim = (list) => {
  if (list.length <= MAX_TASKS) return list;
  const keep = [];
  let finishedKept = 0;
  // (A run whose session is held is kept: dropping it would leak the session.)
  const stays = (task) => isTaskActive(task) || task.heldSession;
  const finishedBudget = MAX_TASKS - list.filter(stays).length;
  list.forEach((task) => {
    if (stays(task)) keep.push(task);
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
    quick: false, // the quick analysis panel's (limits: the Service's, B-35)
    domain: '', // the session's domain when it was sent
    unattended: false, // the Service granted it a seat: it goes on without its owner (unattendedSeats.js)
    jobFollowed: false, // its queued job is being polled: the job's end ends the run
    rowsIn: false, // the log says it is over; the Service has not yet said how it ended
    filter: [], // the dataframe filter it was sent with, in words
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

// The log's "Injection finished" line: the run is over, but the line comes for
// a failed or stopped run too (Service answer 2026-11-25, R2-17). A run the
// Service has a task for, or whose job is followed, ends when those say how.
// Only a run with neither ends at the line. -> true when the run ended
export const rowsFinished = (id) => {
  const task = getTask(id);
  if (!task || !isTaskActive(task)) return false;
  if (task.serverId || task.jobFollowed) {
    if (!task.rowsIn) updateTask(id, { rowsIn: true, status: TASK_STATUSES.RUNNING, hasResults: true });
    return false;
  }
  return finishTask(id, TASK_STATUSES.COMPLETED);
};

// Runs of this page that only the Service's task list can end (no job is
// followed): the list is asked again while there are any.
export const hasTaskAwaitingService = () => tasks.some((task) => !task.remote && isTaskActive(task) && task.serverId && !task.jobFollowed);

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

// A completed background run keeps its Service session until the analyst
// saves it with its graph or releases it (analyst decision 2026-11-24), so
// its graph can be shown and saved. Nothing is stored for it. It counts as
// one of the analysis sessions meanwhile.
export const holdTaskSession = (id, release) => {
  if (!getTask(id)) {
    release({});
    return;
  }
  heldReleases.set(id, release);
  updateTask(id, { heldSession: true });
};

export const releaseTaskSession = (id, options = {}) => {
  const release = heldReleases.get(id);
  if (!release) return false;
  heldReleases.delete(id);
  updateTask(id, { heldSession: false });
  release(options);
  return true;
};

// Page gone or signed out: nobody can reach their graphs any more.
export const releaseAllTaskSessions = (options = {}) => [...heldReleases.keys()].forEach((id) => releaseTaskSession(id, options));

export const getActiveTaskForWindow = (windowId) => tasks.find(
  (task) => String(task.windowId) === String(windowId) && isTaskActive(task),
) || null;

export const getLatestTaskForWindow = (windowId) => tasks.find((task) => String(task.windowId) === String(windowId)) || null;

// Tasks that hold an analysis session without an open Source window.
export const countDetachedSessions = (list = tasks) => list.filter((task) => isOwnTask(task)
  && (task.heldSession || (isTaskActive(task) && (task.origin === TASK_ORIGINS.QUICK || task.background)))).length;

export const countActiveTasks = (list = tasks) => list.filter((task) => isTaskActive(task) && isOwnTask(task)).length;

// { used, limit, available, openWindows, background, quick, held }.
export const getSessionUsage = (openSourceWindows = 0, list = tasks) => {
  const own = list.filter(isOwnTask);
  const background = own.filter((task) => isTaskActive(task) && task.origin === TASK_ORIGINS.SOURCE && task.background).length;
  // Quick-panel runs and parent-alert runs each hold a session (H-8).
  const quick = own.filter((task) => isTaskActive(task) && (task.origin === TASK_ORIGINS.QUICK || task.origin === TASK_ORIGINS.PARENT)).length;
  const held = own.filter((task) => task.heldSession).length;
  const used = openSourceWindows + background + quick + held;
  return {
    used,
    limit: MAX_ANALYSIS_SESSIONS,
    available: Math.max(0, MAX_ANALYSIS_SESSIONS - used),
    openWindows: openSourceWindows,
    background,
    quick,
    held,
  };
};

export const sessionLimitMessage = (usage) => {
  const parts = [];
  if (usage.openWindows) parts.push(`${usage.openWindows} Source window${usage.openWindows === 1 ? '' : 's'}`);
  if (usage.background) parts.push(`${usage.background} background stream${usage.background === 1 ? '' : 's'}`);
  if (usage.quick) parts.push(`${usage.quick} quick analys${usage.quick === 1 ? 'is' : 'es'}`);
  if (usage.held) parts.push(`${usage.held} finished background run${usage.held === 1 ? '' : 's'} kept for ${usage.held === 1 ? 'its graph' : 'their graphs'}`);
  return `All ${usage.limit} analysis sessions are in use (${parts.join(', ') || 'none free'}). `
    + `Wait for a task to finish, stop ${usage.held ? 'or release ' : ''}one in the Tasks window, or close a Source window.`;
};

// Asks the Tasks window to select a task (it may not be open yet).
export const requestTaskFocus = (id) => {
  focus = { taskId: id, seq: focus.seq + 1 };
  emit();
};

export const removeFinishedTasks = () => {
  const stays = (task) => isTaskActive(task) || task.heldSession;
  const next = tasks.filter(stays);
  if (next.length === tasks.length) return;
  tasks.filter((task) => !stays(task)).forEach((task) => handlers.delete(task.id));
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
// { RULE: count | null } (older records name the rule without a count, or
// send a list of names).
const flagsOf = (input) => {
  const value = Array.isArray(input) ? Object.fromEntries(input.filter((rule) => typeof rule === 'string' && rule.trim()).map((rule) => [rule.trim(), null])) : input;
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([rule, count]) => [String(rule).slice(0, 80), count === null || count === undefined || !Number.isFinite(Number(count)) ? null : Number(count)])) : null;
};

const rowCountOf = (value) => (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0 ? null : Number(value));
// Rules that could not run, with the fields they lacked: [{ rule, fields }].
const skippedRulesOf = (value) => Object.entries(value).slice(0, 200).map(([rule, fields]) => ({
  rule: String(rule).slice(0, 80),
  fields: (Array.isArray(fields) ? fields : [fields]).filter((field) => typeof field === 'string' && field).map((field) => field.slice(0, 80)).slice(0, 40),
}));

// { thresholds, preset, mapping, columns }: a version, or null for the built-in.
const versionsOf = (value) => Object.fromEntries(['thresholds', 'preset', 'mapping', 'columns'].filter((key) => key in value).map((key) => [key, value[key] === null || value[key] === undefined ? null : String(value[key]).slice(0, 40)]));

let serverOwner = { userId: '', username: '' };
const pendingServer = new Map(); // serverId -> raw task that arrived before its local run was linked
// Who is signed in, to tell their tasks from others' in "All tasks".
export const setServerTaskOwner = ({ userId = '', username = '' } = {}) => {
  serverOwner = { userId: String(userId || ''), username: String(username || '') };
};

// The filter a Service task was run with (H-18), in words; a shape it does
// not know is named rather than left out.
const describeServiceFilter = (filter) => {
  const lines = describeFilterPayload(filter);
  return lines.length ? lines : ['A dataframe filter was applied.'];
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
    ...(typeof raw.domain === 'string' && raw.domain ? { domain: raw.domain } : {}),
    ...(raw.dataframe_filter && typeof raw.dataframe_filter === 'object' ? { filter: describeServiceFilter(raw.dataframe_filter) } : {}),
    ...(rowCountOf(raw.rows_done) !== null ? { rowsDone: rowCountOf(raw.rows_done) } : {}),
    ...(rowCountOf(raw.rows_total) !== null ? { rowsTotal: rowCountOf(raw.rows_total) } : {}),
    ...(raw.rules_not_applicable && typeof raw.rules_not_applicable === 'object' && !Array.isArray(raw.rules_not_applicable) ? { rulesSkipped: skippedRulesOf(raw.rules_not_applicable) } : {}),
    ...(raw.filter_result && typeof raw.filter_result === 'object' ? { filterResult: raw.filter_result } : {}),
    ...(typeof raw.unattended === 'boolean' ? { unattended: raw.unattended, unattendedUntil: raw.unattended ? time(raw.unattended_until) : null } : {}),
    // Its graph, kept by the Service for a while (B-37).
    ...(typeof raw.graph_saved === 'boolean' ? { graphSaved: raw.graph_saved, graphExpiresAt: time(raw.graph_expires_at) } : {}),
    ...(typeof raw.ended_reason === 'string' && raw.ended_reason ? { endedReason: raw.ended_reason.slice(0, 40) } : {}),
    ...(rowCountOf(raw.limit_seconds) ? { limitSeconds: rowCountOf(raw.limit_seconds) } : {}),
    ...(raw.config_versions && typeof raw.config_versions === 'object' && !Array.isArray(raw.config_versions) ? { configVersions: versionsOf(raw.config_versions) } : {}),
    // What it was made with (B-42); null: not recorded.
    ...('settings_used' in raw ? { settingsUsed: readSettingsUsed(raw.settings_used), settingsKnown: true } : {}),
    ...(raw.quick === true ? { quick: true, windowStart: time(raw.window_start), windowEnd: time(raw.window_end) } : {}),
    // Not started by this page: what the Service has of it (R2-2).
    ...(typeof raw.status === 'string' ? { serverStatus: raw.status } : {}),
    ownerName,
    foreign,
    own: Boolean((owner && owner === serverOwner.userId) || (ownerName && ownerName === serverOwner.username)),
  };
};

// The remark of a task's run: null until the Service has recorded the task
// (a run just started here), and for one that analyses nothing it knows.
export const taskRemark = (task) => (task?.serverId && (task.settingsKnown || !isTaskActive(task)) ? settingsRemark(task.settingsUsed || null) : null);

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
  } else if (!local.remote && !isTaskActive(local) && status && !ACTIVE_STATUSES.has(status) && status !== local.status
    && local.status !== TASK_STATUSES.TERMINATED) {
    // It had ended here otherwise (the job, or a lost connection): the
    // Service's word stands. A run stopped here stays stopped.
    updateTask(local.id, { status, message: String(raw.message || (status === TASK_STATUSES.COMPLETED ? '' : local.message) || ''), progress: status === TASK_STATUSES.COMPLETED ? 100 : local.progress });
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

// The signed-in user's runs an earlier page (or another tab) started and that
// still go on: they can be stopped from here. terminate(task) -> { ok, message }
export const attachOwnRuns = (terminate) => {
  tasks.filter((task) => task.remote && task.own && isTaskActive(task) && task.origin !== TASK_ORIGINS.PARENT && task.sourceSessionId && !handlers.get(task.id)?.terminate)
    .forEach(({ id }) => {
      handlers.set(id, {
        terminate: async () => {
          const task = getTask(id);
          const result = await terminate(task);
          if (result?.ok) finishTask(id, TASK_STATUSES.TERMINATED);
          else updateTask(id, { message: result?.message || 'The run could not be stopped.' });
        },
      });
      updateTask(id, {});
    });
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
  heldReleases.clear();
  emit();
};
