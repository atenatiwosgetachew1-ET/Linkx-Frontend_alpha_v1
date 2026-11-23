import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useSession } from '../../../shared/session/useSession.js';
import { useCan } from '../../../auth/useCan.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { createMockAlertService } from '../mock/mockAlertService.js';
import { createLiveAlertService } from '../lib/alertService.js';
import { preferredAlertMode, subscribeAlertMode } from '../lib/alertMode.js';
import { setAlertEnvironment, startAlertService, stopAlertService } from '../lib/alertRuntime.js';

// Runs the STR alert service for the signed-in workspace (analysis-results
// -plan Phase 4): the mock or the Service's, by appConfig.parentAlerts or
// the development switch. Mounted once, in the workspace frame, so alerts
// and their notices arrive whichever windows are open.
//
// workspace: { windows, openWindow, focusWindow }; notify; user;
// onArrival(alert): a new or newly assigned alert (the Reports badge).
export function useParentAlerts({ workspace, notify, user, onArrival }) {
  const { apiFetch, socket } = useSession();
  const mode = useSyncExternalStore(subscribeAlertMode, preferredAlertMode);
  const windowsRef = useRef(workspace.windows);
  windowsRef.current = workspace.windows;
  const userId = String(user?.id ?? user?.user_id ?? user?.username ?? 'me');
  // Who "mine" is (H-3): the user id, and for SSO users the username and
  // the SSO subject too.
  const loginName = String(user?.username || '');
  const sub = String(user?.sub || user?.oidc_sub || user?.sso_sub || '');
  const username = String(user?.display_name || user?.username || 'You');
  const supervisor = useCan()('alerts:read_all');

  const { openWindow, focusWindow } = workspace;
  useEffect(() => {
    setAlertEnvironment({
      notify,
      openWindow,
      focusWindow,
      getWindows: () => windowsRef.current,
      onArrival: onArrival || (() => {}),
      username,
      apiFetch,
      supervisor,
      openReports: (alertId) => openWindow(WORKSPACE_WINDOW_TYPES.REPORTS, {
        title: 'Reports',
        metadata: { reportsTab: 'parent', reportsSelect: alertId ?? null, openSeq: Date.now() },
      }),
    });
  }, [notify, openWindow, focusWindow, onArrival, username, apiFetch, supervisor]);

  useEffect(() => {
    if (mode === 'mock') startAlertService(createMockAlertService({ userId, username }), { mode, userId });
    else if (mode === 'live' && socket) startAlertService(createLiveAlertService({ apiFetch, socket }), { mode, userId, username: loginName, sub });
    else startAlertService(null, { mode: 'off', userId });
    return () => stopAlertService();
  }, [mode, socket, apiFetch, userId, username, loginName, sub]);
}
