// The system panel's figures (central workspace, second page). Every figure
// is counted from what the app already holds: tasks, STR alerts, the Service's
// answers. Nothing here is estimated or made up.
import { RESPONSE } from '../../features/alerts/lib/alertModel.js';
import { MAX_TASKS, TASK_STATUSES, isTaskActive } from '../../features/tasks/lib/taskRegistry.js';

// What the signed-in user may see, from their permissions (never from role
// names; frontend alignment H-9 / H-16).
export const dashboardLevelOf = (can) => {
  const team = can('tasks:read_all') || can('alerts:read_all');
  const admin = can('users:manage');
  return {
    team,
    admin,
    label: admin ? 'Administrator' : team ? 'Supervisor' : 'Analyst',
  };
};

const startOfToday = (now) => {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

// { running, finishedToday, stopped, suspicious, latest } of a list of tasks.
export const countTasks = (tasks = [], now = Date.now()) => {
  const today = startOfToday(now);
  const ended = (task) => Number(task.endedAt) >= today;
  return {
    running: tasks.filter(isTaskActive).length,
    finishedToday: tasks.filter((task) => task.status === TASK_STATUSES.COMPLETED && ended(task)).length,
    stopped: tasks.filter((task) => (task.status === TASK_STATUSES.FAILED || task.status === TASK_STATUSES.TERMINATED) && ended(task)).length,
    suspicious: tasks.filter((task) => task.verdict === 'suspicious').length,
    latest: tasks[0] || null,
  };
};

export const ownTasks = (tasks = []) => tasks.filter((task) => !task.foreign);
export const teamTasks = (tasks = []) => tasks.filter((task) => task.foreign);

// The last `days` days, oldest first: [{ label, title, finished, stopped }] by the
// day a task ended (the registry keeps the last 50 finished tasks).
export const tasksByDay = (tasks = [], now = Date.now(), days = 7) => {
  const today = startOfToday(now);
  const dayLength = 24 * 60 * 60 * 1000;
  return Array.from({ length: days }, (_, index) => {
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1 - index));
    const from = start.getTime();
    const to = from + dayLength;
    const inDay = tasks.filter((task) => Number(task.endedAt) >= from && Number(task.endedAt) < to);
    return {
      label: start.toLocaleDateString(undefined, { weekday: 'short' }),
      title: start.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }),
      finished: inDay.filter((task) => task.status === TASK_STATUSES.COMPLETED).length,
      stopped: inDay.filter((task) => task.status === TASK_STATUSES.FAILED || task.status === TASK_STATUSES.TERMINATED).length,
    };
  });
};

// The app holds at most MAX_TASKS tasks (`all`); when it is full and the
// oldest ended one of `tasks` is still inside the last `days` days, earlier
// tasks of those days may have been dropped: the days' counts may be short.
export const weekMayBeShort = (tasks = [], all = tasks, now = Date.now(), days = 7) => {
  if (all.length < MAX_TASKS) return false;
  const from = new Date(startOfToday(now));
  from.setDate(from.getDate() - (days - 1));
  const ended = tasks.map((task) => Number(task.endedAt)).filter((at) => at > 0);
  return ended.length > 0 && Math.min(...ended) >= from.getTime();
};

// { awaiting, arriving, toSend, failed, total } of STR alerts.
export const countAlerts = (alerts = []) => {
  const real = alerts.filter((alert) => alert.isAlert);
  return {
    total: real.length,
    awaiting: real.filter((alert) => alert.response === RESPONSE.AWAITING && alert.intake !== 'receiving').length,
    arriving: real.filter((alert) => alert.intake === 'receiving').length,
    toSend: real.filter((alert) => alert.response === RESPONSE.ANALYSED).length,
    failed: real.filter((alert) => alert.response === RESPONSE.FAILED).length,
    unassigned: real.filter((alert) => !alert.assigneeName).length,
  };
};

// GET /auth/admin/users → { total, active } (null when it is not a list).
export const countUsers = (data) => {
  const rows = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.users) ? data.users : null;
  if (!rows) return null;
  return { total: rows.length, active: rows.filter((row) => row?.is_active !== false).length };
};

// GET /api/v1/reports/xvigilance/health → the feed's state, or null.
export const readFeedHealth = (data) => {
  if (!data?.success) return null;
  const checkpoint = data.checkpoint || {};
  const runs = Array.isArray(data.recent_runs) ? data.recent_runs : [];
  const last = runs[0] || null;
  return {
    name: String(checkpoint.feed_name || 'xVigilance'),
    paused: Boolean(checkpoint.is_paused),
    status: String(checkpoint.status || ''),
    lastWindowEnd: checkpoint.last_window_end || '',
    analysed: Number.isFinite(Number(checkpoint.total_graph_analyzed)) ? Number(checkpoint.total_graph_analyzed) : null,
    lastRun: last ? { status: String(last.status || ''), durationMs: Number(last.duration_ms) || 0 } : null,
    failedRuns: runs.filter((run) => /fail|error/i.test(String(run?.status || ''))).length,
    // Oldest first, at most 16: how long each recent run took.
    recent: runs.slice(0, 16).reverse().map((run) => ({ status: String(run?.status || ''), durationMs: Number(run?.duration_ms) || 0, failed: /fail|error/i.test(String(run?.status || '')) })),
    runs: runs.length,
  };
};
