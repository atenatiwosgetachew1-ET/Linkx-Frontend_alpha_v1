import { SOURCE_PERMISSIONS } from '../../auth/permissions.js';
import { WORKSPACE_CONTEXT_TABS, WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

export const launcherItems = [
  {
    id: 'source',
    label: 'Source',
    windowType: WORKSPACE_WINDOW_TYPES.SOURCE,
    permission: SOURCE_PERMISSIONS.SOURCE_CREATE,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Zm4 2h8M8 12h8M8 16h5',
  },
  {
    id: 'graph',
    label: 'Graph',
    windowType: WORKSPACE_WINDOW_TYPES.GRAPH,
    permission: SOURCE_PERMISSIONS.GRAPH_CREATE,
    contextTab: WORKSPACE_CONTEXT_TABS.INFO,
    path: 'M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm2.2-4.2 5.6-7.6M9.5 7.3l5 8.2',
  },
  {
    id: 'chart',
    label: 'Chart',
    windowType: WORKSPACE_WINDOW_TYPES.CHART,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M5 20V10m7 10V4m7 16v-7M3 20h18',
  },
  {
    id: 'reports',
    label: 'Reports',
    windowType: WORKSPACE_WINDOW_TYPES.REPORTS,
    // Production gates the Reports launcher item with graph:create.
    permission: SOURCE_PERMISSIONS.GRAPH_CREATE,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    badgeKey: 'reports',
    badgeNoun: 'report',
    path: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    windowType: WORKSPACE_WINDOW_TYPES.TASKS,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    badgeKey: 'tasks',
    badgeNoun: 'task',
    path: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  },
  {
    id: 'libraries',
    label: 'Libraries',
    windowType: WORKSPACE_WINDOW_TYPES.LIBRARIES,
    contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
    path: 'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z',
  },
  {
    id: 'configuration',
    label: 'Configuration',
    windowType: WORKSPACE_WINDOW_TYPES.CONFIGURATION,
    permission: SOURCE_PERMISSIONS.CONFIG_READ,
    contextTab: WORKSPACE_CONTEXT_TABS.SETTINGS,
    path: 'M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z',
  },
  {
    id: 'settings',
    label: 'Settings',
    windowType: WORKSPACE_WINDOW_TYPES.SETTINGS,
    contextTab: WORKSPACE_CONTEXT_TABS.SETTINGS,
    path: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  },
];

// Production hides launcher items the user has no permission for
// (canAccess around the toggle menu entries).
export const getVisibleLauncherItems = (can) => launcherItems.filter((item) => !item.permission || can(item.permission));
