// "Keep running while I'm away" (analyst decision 2026-11-25; B-38): a run
// goes on without its owner's browser only with a seat the Service granted.
// The Service owns the seats: how many, who holds one, and when one is lost.
// Off by default, turned on per run, one run per user, for a limited time
// (60 minutes; `unattended_until`), then taken back. Until the Service
// answers with seats, it cannot be turned on (and a run stops when its owner
// leaves).

import { fetchUnattendedSeats, setTaskUnattended } from '../../../services/tasksApi.js';
import { getServiceRefusalCode, getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { TASK_ORIGINS, TASK_STATUSES, applyServerTask, getTask, getTasks, isTaskActive } from './taskRegistry.js';

export const SEAT_STATES = Object.freeze({ UNKNOWN: 'unknown', READY: 'ready', NONE: 'none', UNSUPPORTED: 'unsupported', ERROR: 'error' });
const UNKNOWN = Object.freeze({ state: SEAT_STATES.UNKNOWN, total: null, available: null, message: '' });
let seats = UNKNOWN;
const listeners = new Set();
const set = (next) => {
  seats = next;
  listeners.forEach((listener) => listener());
};
export const getSeats = () => seats;
export const subscribeSeats = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const resetSeats = () => {
  turnedOff.clear();
  set(UNKNOWN);
};
const turnedOff = new Set(); // Service task ids turned off from here

const count = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
// { seats: { total, available } }; anything else is not an answer.
const applySeats = (data) => {
  const total = count(data?.seats?.total);
  const available = count(data?.seats?.available);
  if (total === null || available === null) return false;
  set({ state: SEAT_STATES.READY, total, available: Math.min(total, available), message: '' });
  return true;
};
export const handleSeatsUpdated = (payload) => { applySeats(payload); };

export const loadSeats = async (apiFetch) => {
  try {
    if (!applySeats(await fetchUnattendedSeats(apiFetch))) set({ ...UNKNOWN, state: SEAT_STATES.UNSUPPORTED });
  } catch (error) {
    if (error?.name === 'AbortError') return;
    const unsupported = [404, 405, 501].includes(Number(error?.status));
    const none = getServiceRefusalCode(error) === 'not_offered';
    set({ ...UNKNOWN, state: none ? SEAT_STATES.NONE : unsupported ? SEAT_STATES.UNSUPPORTED : SEAT_STATES.ERROR, message: getServiceRefusalMessage(error) });
  }
};

/* ── The runs ───────────────────────────────────────────────────────── */

// Granted by the Service (never assumed from here) and still going.
export const isTaskUnattended = (task) => Boolean(task) && isTaskActive(task) && task.unattended === true;
const isMine = (task) => Boolean(task) && !task.foreign && (!task.remote || task.own) && task.origin !== TASK_ORIGINS.PARENT;
// One run per user.
export const getUnattendedTask = (tasks = getTasks()) => tasks.find((task) => isMine(task) && isTaskUnattended(task)) || null;
// Windows of this page whose run keeps going.
export const unattendedWindowIds = (tasks = getTasks()) => new Set(tasks.filter((task) => !task.remote && isMine(task) && isTaskUnattended(task)).map((task) => String(task.windowId)));
// A run of this user that is going and may ask for a seat.
export const mayAskForSeat = (task) => isMine(task) && isTaskActive(task);

// Why it cannot be turned on now ('' when it can).
export const seatBlocker = (task, current = seats, tasks = getTasks()) => {
  // As the Service grants them (R2-19): batch runs that have started.
  if (task && (task.mode === 'realtime' || task.quick || task.origin === TASK_ORIGINS.QUICK)) return 'Only a batch run can keep going without you.';
  if (!task?.serverId) return 'Available once the Service has accepted the run.';
  if (task.status === TASK_STATUSES.STARTING || task.serverStatus === 'queued') return 'Available once the run has started.';
  const other = getUnattendedTask(tasks);
  if (other && other.id !== task.id) return `You can keep one run going, and task #${other.number} is it.`;
  if (current.state === SEAT_STATES.UNKNOWN) return 'Checking the Service for a free seat…';
  if (current.state === SEAT_STATES.NONE) return 'No seats are offered now: the workers are needed for running work.';
  if (current.state === SEAT_STATES.UNSUPPORTED) return 'The Service does not offer this yet.';
  if (current.state === SEAT_STATES.ERROR) return current.message || 'The Service could not be asked for a seat.';
  // (0 also while an analysis waits for a worker, with no seat taken.)
  if (current.available < 1) return 'No seat is free now: running work comes first. Try again later.';
  return '';
};

// Asks the Service. -> { ok, message }; ok only when it confirmed.
export const requestUnattended = async (apiFetch, taskId, on) => {
  const task = getTask(taskId);
  if (!mayAskForSeat(task)) return { ok: false, message: 'The run has ended.' };
  const blocker = on ? seatBlocker(task) : '';
  if (blocker) return { ok: false, message: blocker };
  if (!on) turnedOff.add(task.serverId);
  else turnedOff.delete(task.serverId);
  try {
    const data = await setTaskUnattended(apiFetch, task.serverId, on);
    applySeats(data);
    const raw = data?.task;
    if (!raw || String(raw.task_id) !== task.serverId || raw.unattended !== on) {
      turnedOff.delete(task.serverId);
      return { ok: false, message: 'The Service did not confirm it.' };
    }
    applyServerTask(raw);
    return { ok: true, message: '' };
  } catch (error) {
    turnedOff.delete(task.serverId);
    await loadSeats(apiFetch);
    return { ok: false, message: getServiceRefusalMessage(error) || 'The Service refused the seat.' };
  }
};

// Runs that had a seat in `before` (Service ids) and lost it without being
// turned off here: they will stop when their owner leaves.
export const lostSeats = (before, tasks = getTasks()) => tasks.filter((task) => before.has(task.serverId) && mayAskForSeat(task) && task.unattended === false && !turnedOff.has(task.serverId));
