import { useEffect, useRef, useSyncExternalStore } from 'react';

import { TASK_STATUSES, getTasksSnapshot, subscribeTasks } from '../../features/tasks/lib/taskRegistry.js';
import { endedText } from '../../features/tasks/lib/taskFormat.js';
import { isTaskUnattended, lostSeats } from '../../features/tasks/lib/unattendedSeats.js';
import { takeEndedAwayRuns } from '../lib/awayRuns.js';
import { workspaceOwnerKey } from '../lib/workspaceCopy.js';

const WORD = { [TASK_STATUSES.COMPLETED]: 'finished', [TASK_STATUSES.FAILED]: 'failed', [TASK_STATUSES.TERMINATED]: 'was stopped' };

// "Ended while you were away": the runs an earlier page left (lib/awayRuns.js),
// as the Service's task list says how they ended.
export function useAwayRuns({ user, notify, openTask }) {
  const { tasks } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const owner = workspaceOwnerKey(user);
  useEffect(() => {
    const ended = takeEndedAwayRuns(owner);
    if (!ended.length) return;
    const bad = ended.some((task) => task.status !== TASK_STATUSES.COMPLETED);
    const lines = ended.slice(0, 5).map((task) => `${task.title}${task.input ? ` (${task.input})` : ''} ${WORD[task.status] || 'ended'}${endedText(task) ? `: ${endedText(task)}` : ''}`);
    notify({
      title: ended.length === 1 ? 'A run ended while you were away' : `${ended.length} runs ended while you were away`,
      message: `${lines.join('. ')}${ended.length > 5 ? `. And ${ended.length - 5} more` : ''}.`,
      level: bad ? 'warning' : 'success',
      source: 'Tasks',
      durationMs: 15000,
      action: { label: 'View tasks', onClick: () => openTask(ended.length === 1 ? ended[0].id : null) },
    });
  }, [notify, openTask, owner, tasks]);

  // The Service took a run's seat back: it will stop when its owner leaves.
  const seatedRef = useRef(new Set());
  useEffect(() => {
    lostSeats(seatedRef.current, tasks).forEach((task) => notify({
      title: 'A run lost its seat',
      message: `${task.title} #${task.number} goes on while you are here, and stops about 2 minutes after you leave. You can ask for a seat again.`,
      level: 'warning',
      source: 'Tasks',
      durationMs: 15000,
      action: { label: 'View task', onClick: () => openTask(task.id) },
    }));
    seatedRef.current = new Set(tasks.filter(isTaskUnattended).map((task) => task.serverId));
  }, [notify, openTask, tasks]);
}
