// Streams kept running after their Source window closed ("Keep running in
// background"). The window is gone from the workspace, but its runtime, live
// log subscription, stream job and backend source session stay alive until
// the stream ends; the task then copies the log and `release` frees the rest
// (runtime, log buffer, /close_source_window).
//
// Sign-out and closing the tab still end background streams: they stay in
// activeStreams.js, which those paths drain.

import {
  TASK_STATUSES,
  finishTask,
  freezeWindowTaskLogs,
  getTask,
  isTaskActive,
  markTaskRunning,
  onTaskEnded,
  setTaskBackground,
  setTaskHandlers,
} from '../../tasks/lib/taskRegistry.js';
import { endAbandonedStream, markStreamEnded } from './activeStreams.js';
import { appendStreamLog, getStreamLogLines, peekStreamLogLines, subscribeStreamLog } from './streamLogs.js';

export const STREAM_FINISHED_RE = /Injection finished for action/i;

// Final lines arrive in the next log flush (200 ms); wait for them before
// copying the log into the task.
const RELEASE_DELAY_MS = 400;

// Follows a stream's backend log for its task, whether or not its Source
// window body is mounted (docked mode mounts only the active tab): the first
// backend line marks the task running, "Injection finished" completes it.
// Stops by itself when the task ends.
export const watchStreamTask = (windowId, taskId) => {
  const check = () => {
    if (!isTaskActive(getTask(taskId))) return;
    const backend = getStreamLogLines(windowId).filter((line) => line.source === 'backend');
    if (backend.some((line) => STREAM_FINISHED_RE.test(line.message))) {
      markStreamEnded(windowId);
      finishTask(taskId, TASK_STATUSES.COMPLETED);
    } else if (backend.length) {
      markTaskRunning(taskId);
    }
  };
  const stopLog = subscribeStreamLog(windowId, check);
  const stopEnd = onTaskEnded((task) => {
    if (task.id !== taskId) return;
    stopLog();
    stopEnd();
  });
  return () => { stopLog(); stopEnd(); };
};

export const continueStreamInBackground = ({ windowId, taskId, apiFetch, release }) => {
  if (!isTaskActive(getTask(taskId))) return false;
  setTaskBackground(taskId, true);
  appendStreamLog(windowId, 'Source window closed: the stream keeps running in the background.');

  // The window's own log watcher is unmounted: follow the backend lines here.
  const check = () => {
    const backend = getStreamLogLines(windowId).filter((line) => line.source === 'backend');
    if (backend.some((line) => STREAM_FINISHED_RE.test(line.message))) {
      markStreamEnded(windowId);
      finishTask(taskId, TASK_STATUSES.COMPLETED);
    } else if (backend.length) {
      markTaskRunning(taskId);
    }
  };
  const stopLog = subscribeStreamLog(windowId, check);

  setTaskHandlers(taskId, {
    terminate: async () => {
      appendStreamLog(windowId, 'Terminating the stream…', 'warn');
      const result = await endAbandonedStream(apiFetch, windowId, { reason: 'terminated_from_tasks' });
      const ok = Boolean(result?.ok);
      appendStreamLog(windowId, ok ? 'Streaming terminated by user.' : (result?.message || 'The stream end could not be confirmed.'), ok ? 'info' : 'warn');
      finishTask(taskId, TASK_STATUSES.TERMINATED, { message: ok ? '' : result?.message });
    },
  });

  let released = false;
  const stopEnd = onTaskEnded((task) => {
    if (task.id !== taskId || released) return;
    released = true;
    stopLog();
    stopEnd();
    setTimeout(() => {
      freezeWindowTaskLogs(windowId, peekStreamLogLines(windowId));
      release(task);
    }, RELEASE_DELAY_MS);
  });

  check();
  return true;
};
