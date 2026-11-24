export const WORKSPACE_WINDOW_TYPES = Object.freeze({
  SOURCE: 'source',
  GRAPH: 'graph',
  CHART: 'chart',
  // A Graph window's data as rows, linked to it (G3.5 i2 #5; analyst decision 2026-11-17).
  TABLE: 'table',
  REPORTS: 'reports',
  TASKS: 'tasks',
  LIBRARIES: 'libraries',
  CONFIGURATION: 'configuration',
  SETTINGS: 'settings',
});

// Max simultaneously open windows, shared across the types in each group.
export const WORKSPACE_WINDOW_LIMITS = Object.freeze([
  Object.freeze({ types: Object.freeze([WORKSPACE_WINDOW_TYPES.SOURCE]), limit: 3, label: 'Source' }),
  Object.freeze({ types: Object.freeze([WORKSPACE_WINDOW_TYPES.GRAPH, WORKSPACE_WINDOW_TYPES.CHART, WORKSPACE_WINDOW_TYPES.TABLE]), limit: 5, label: 'Graph, Chart and Table' }),
]);

const findWindowLimitGroup = (type) => WORKSPACE_WINDOW_LIMITS.find((group) => group.types.includes(type)) || null;

// Null when the window may open, otherwise { type, types, limit, label, count }.
export const getWindowLimitBlock = (windows = [], type) => {
  const group = findWindowLimitGroup(type);
  if (!group) return null;
  const count = windows.filter((windowItem) => group.types.includes(windowItem.type)).length;
  return count >= group.limit ? { type, types: group.types, limit: group.limit, label: group.label, count } : null;
};

export const WORKSPACE_CONTEXT_TABS = Object.freeze({
  OVERVIEW: 'overview',
  INFO: 'info',
  FILTER: 'filter',
  SETTINGS: 'settings',
});

export const WORKSPACE_ORIENTATIONS = Object.freeze({
  FLOATING: 'floating',
  DOCKED: 'docked',
});

export const WORKSPACE_ACTIONS = Object.freeze({
  OPEN_WINDOW: 'workspace/openWindow',
  CLOSE_WINDOW: 'workspace/closeWindow',
  FOCUS_WINDOW: 'workspace/focusWindow',
  REORDER_WINDOWS: 'workspace/reorderWindows',
  UPDATE_WINDOW_CUSTOM_TITLE: 'workspace/updateWindowCustomTitle',
  UPDATE_WINDOW_METADATA: 'workspace/updateWindowMetadata',
  SET_ORIENTATION: 'workspace/setOrientation',
  TOGGLE_ORIENTATION: 'workspace/toggleOrientation',
  SET_CONTEXT_TAB: 'workspace/setContextTab',
  CLEAR_WINDOWS: 'workspace/clearWindows',
  RESTORE_WINDOWS: 'workspace/restoreWindows',
});

export const WORKSPACE_WINDOW_LABELS = Object.freeze({
  [WORKSPACE_WINDOW_TYPES.SOURCE]: 'Source',
  [WORKSPACE_WINDOW_TYPES.GRAPH]: 'Graph',
  [WORKSPACE_WINDOW_TYPES.CHART]: 'Chart',
  [WORKSPACE_WINDOW_TYPES.TABLE]: 'Table',
  [WORKSPACE_WINDOW_TYPES.REPORTS]: 'Reports',
  [WORKSPACE_WINDOW_TYPES.TASKS]: 'Tasks',
  [WORKSPACE_WINDOW_TYPES.LIBRARIES]: 'Libraries',
  [WORKSPACE_WINDOW_TYPES.CONFIGURATION]: 'Configuration',
  [WORKSPACE_WINDOW_TYPES.SETTINGS]: 'Settings',
});