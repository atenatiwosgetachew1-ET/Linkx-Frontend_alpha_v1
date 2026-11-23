import { useEffect } from 'react';

import { useSession } from '../../../shared/session/useSession.js';
import { setServerTaskOwner } from '../lib/taskRegistry.js';
import { getServerTaskScope, handleTaskUpdated, loadServerTasks } from '../lib/serverTasks.js';

// The signed-in user's tasks from the Service (H-2): loaded once per
// workspace and kept live with the task_updated socket event. Mounted in
// the workspace frame, so it runs whichever windows are open.
export function useServerTasks({ user }) {
  const { apiFetch, socket } = useSession();
  const userId = String(user?.id ?? user?.user_id ?? '');
  const username = String(user?.username || '');

  useEffect(() => {
    setServerTaskOwner({ userId, username });
    loadServerTasks(apiFetch, { scope: 'mine' });
  }, [apiFetch, userId, username]);

  useEffect(() => {
    if (!socket) return undefined;
    socket.on('task_updated', handleTaskUpdated);
    // A new socket (token renewal): what changed meanwhile.
    const reload = () => loadServerTasks(apiFetch, getServerTaskScope());
    socket.on('connect', reload);
    return () => {
      socket.off('task_updated', handleTaskUpdated);
      socket.off('connect', reload);
    };
  }, [socket, apiFetch]);
}
