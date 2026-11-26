import { useEffect } from 'react';

import { useSession } from '../../../shared/session/useSession.js';
import { hasTaskAwaitingService, setServerTaskOwner } from '../lib/taskRegistry.js';
import { getServerTaskScope, handleTaskUpdated, loadServerTasks, resetServerTaskLoad } from '../lib/serverTasks.js';

// The signed-in user's tasks from the Service (H-2): loaded once per
// workspace and kept live with the task_updated socket event. Mounted in
// the workspace frame, so it runs whichever windows are open.
export function useServerTasks({ user }) {
  const { apiFetch, socket } = useSession();
  const userId = String(user?.id ?? user?.user_id ?? '');
  const username = String(user?.username || '');

  useEffect(() => {
    setServerTaskOwner({ userId, username });
    // Another user's list is a first load again (the window shows its loader).
    resetServerTaskLoad();
    loadServerTasks(apiFetch, { scope: 'mine' });
  }, [apiFetch, userId, username]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.on('task_updated', handleTaskUpdated);
    // A new socket (token renewal): what changed meanwhile.
    const reload = () => loadServerTasks(apiFetch, getServerTaskScope());
    socket.on('connect', reload);
    // A run waiting for the Service's word is asked about too, in case an
    // event was missed.
    const timer = setInterval(() => { if (hasTaskAwaitingService()) reload(); }, 30000);
    return () => {
      clearInterval(timer);
      socket.off('task_updated', handleTaskUpdated);
      socket.off('connect', reload);
    };
  }, [socket, apiFetch]);
}
