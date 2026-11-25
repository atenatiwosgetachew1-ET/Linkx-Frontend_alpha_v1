import React, { useEffect, useId, useState, useSyncExternalStore } from 'react';

import { useSession } from '../../../shared/session/useSession.js';
import { formatClock } from '../lib/taskFormat.js';
import { getTasksSnapshot, subscribeTasks } from '../lib/taskRegistry.js';
import { getSeats, handleSeatsUpdated, isTaskUnattended, loadSeats, mayAskForSeat, requestUnattended, seatBlocker, subscribeSeats } from '../lib/unattendedSeats.js';

const REFRESH_MS = 30000;

// "Keep running while I'm away" for one run (lib/unattendedSeats.js). Shown
// while the run is going; turned on only when the Service has a seat for it.
export default function UnattendedSwitch({ taskId, className = '' }) {
  const { apiFetch, socket } = useSession();
  const { tasks } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const seats = useSyncExternalStore(subscribeSeats, getSeats);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const hintId = useId();
  const task = tasks.find((item) => item.id === taskId) || null;
  const shown = mayAskForSeat(task);

  // How many seats are free, while this is in sight.
  useEffect(() => {
    if (!shown) return undefined;
    loadSeats(apiFetch);
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') loadSeats(apiFetch); }, REFRESH_MS);
    socket?.on?.('unattended_seats', handleSeatsUpdated);
    return () => {
      clearInterval(timer);
      socket?.off?.('unattended_seats', handleSeatsUpdated);
    };
  }, [apiFetch, shown, socket]);

  if (!shown) return null;
  const on = isTaskUnattended(task);
  const blocker = on ? '' : seatBlocker(task, seats, tasks);
  const change = async (event) => {
    const next = event.target.checked;
    setBusy(true);
    setMessage('');
    const result = await requestUnattended(apiFetch, taskId, next);
    setBusy(false);
    if (!result.ok) setMessage(result.message);
  };
  const hint = message || (busy ? 'Asking the Service…' : on
    ? `It goes on if you leave, sign out or lose the connection${task.unattendedUntil ? `, until ${formatClock(task.unattendedUntil)}` : ''}.`
    : blocker || `Off: it stops about 2 minutes after your last browser is gone. ${seats.available} of ${seats.total} seats free.`);
  return (
    <div className={'tasks_unattended' + (on ? ' is-on' : '') + (className ? ` ${className}` : '')}>
      <label className="settings_switch">
        <input type="checkbox" role="switch" checked={on} disabled={busy || Boolean(blocker)} aria-describedby={hintId} onChange={change} />
        <span>Keep running while I’m away</span>
      </label>
      <small id={hintId} role="status" className={message ? 'is-problem' : undefined}>{hint}</small>
    </div>
  );
}
