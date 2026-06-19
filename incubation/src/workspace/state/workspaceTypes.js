export const WORKSPACE_WINDOW_TYPES = Object.freeze({
  SOURCE: 'source',
  GRAPH: 'graph',
  CHART: 'chart',
  CONFIGURATION: 'configuration',
  SETTINGS: 'settings',
});

export const WORKSPACE_CONTEXT_TABS = Object.freeze({
  OVERVIEW: 'overview',
  INFO: 'info',
  FILTER: 'filter',
  SETTINGS: 'settings',
});

export const WORKSPACE_ACTIONS = Object.freeze({
  OPEN_WINDOW: 'workspace/openWindow',
  CLOSE_WINDOW: 'workspace/closeWindow',
  FOCUS_WINDOW: 'workspace/focusWindow',
  SET_CONTEXT_TAB: 'workspace/setContextTab',
  CLEAR_WINDOWS: 'workspace/clearWindows',
});

export const WORKSPACE_WINDOW_LABELS = Object.freeze({
  [WORKSPACE_WINDOW_TYPES.SOURCE]: 'Source',
  [WORKSPACE_WINDOW_TYPES.GRAPH]: 'Graph',
  [WORKSPACE_WINDOW_TYPES.CHART]: 'Chart',
  [WORKSPACE_WINDOW_TYPES.CONFIGURATION]: 'Configuration',
  [WORKSPACE_WINDOW_TYPES.SETTINGS]: 'Settings',
});
