import { TASK_ORIGINS, TASK_STATUSES } from './taskRegistry.js';

export const TASK_FILTERS = Object.freeze([
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'completed', label: 'Completed' },
  { id: 'stopped', label: 'Stopped / failed' },
  // Analyst decision 2026-11-24: background runs whose session is kept for
  // their graph, and runs saved as evidence.
  { id: 'kept', label: 'Kept', hint: 'Background runs whose session is kept for their graph', empty: 'No session is kept. A background run that completes is listed here until you save it with its graph or release it.' },
  { id: 'saved', label: 'Saved', hint: 'Runs saved as evidence', empty: 'No run in this list is saved as evidence.' },
]);

export const matchesTaskFilter = (task, filter) => {
  if (filter === 'active') return task.status === TASK_STATUSES.STARTING || task.status === TASK_STATUSES.RUNNING;
  if (filter === 'completed') return task.status === TASK_STATUSES.COMPLETED;
  if (filter === 'stopped') return task.status === TASK_STATUSES.TERMINATED || task.status === TASK_STATUSES.FAILED;
  if (filter === 'kept') return Boolean(task.heldSession);
  if (filter === 'saved') return Boolean(task.evidenceId);
  return true;
};

export const taskStatusLabel = (task) => ({
  [TASK_STATUSES.STARTING]: task.origin === TASK_ORIGINS.SOURCE ? 'Queued' : 'Starting',
  [TASK_STATUSES.RUNNING]: 'Running',
  [TASK_STATUSES.COMPLETED]: 'Completed',
  [TASK_STATUSES.TERMINATED]: 'Stopped',
  [TASK_STATUSES.FAILED]: 'Failed',
})[task.status] || task.status;

// Why a run ended, as the Service says (R2-20); '' when it finished or is not said.
const ENDED = {
  error: 'It failed.',
  time_limit: 'It reached its time limit.',
  quick_limit: 'It reached the limits of a quick analysis.',
  user: 'It was stopped on request.',
  browser_disconnected: 'Its owner’s browser was gone.',
  session_closed: 'Its Source window was closed.',
  signed_out: 'Its owner signed out.',
  account_deactivated: 'Its owner’s account was deactivated.',
  worker_lost: 'Its worker was lost. Run it again.',
  cancelled: 'It was cancelled.',
};
export const endedText = (task) => task?.message || ENDED[task?.endedReason] || '';

export const taskOriginLabel = (task) => (task.origin === TASK_ORIGINS.QUICK || task.quick
  ? 'Quick analysis panel'
  : task.windowTitle || 'Source window');

// 0:42 · 3m 05s · 1h 02m
export const formatDuration = (ms) => {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
};

export const taskDuration = (task, now = Date.now()) => formatDuration((task.endedAt || now) - task.startedAt);

const pad = (value) => String(value).padStart(2, '0');

export const formatClock = (timestamp) => {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

export const formatDateTime = (timestamp) => {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatClock(timestamp)}`;
};

// "Rule: R1" / "account_from → account_to [HAS_RELATIONSHIP]"
export const taskParameters = (task) => {
  const rows = [];
  if (task.rule) rows.push(['Rule', task.rule]);
  if (task.sourceColumn || task.targetColumn) {
    rows.push(['Columns', `${task.sourceColumn || '?'} → ${task.targetColumn || '?'}`]);
  }
  if (task.relationship) rows.push(['Relationship', task.relationship]);
  return rows;
};

export const taskLogFileName = (task) => {
  const stamp = formatDateTime(task.startedAt).replace(/[-: ]/g, '').slice(0, 14);
  const who = task.sourceSessionId || task.origin;
  return `linkx-task-${String(who).replace(/[^\w.-]+/g, '_')}-${stamp}.log`;
};
