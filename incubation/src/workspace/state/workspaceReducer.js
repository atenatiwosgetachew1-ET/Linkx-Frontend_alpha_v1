import {
  WORKSPACE_ACTIONS,
  WORKSPACE_CONTEXT_TABS,
  WORKSPACE_ORIENTATIONS,
  WORKSPACE_WINDOW_LABELS,
  WORKSPACE_WINDOW_TYPES,
} from './workspaceTypes.js';

export const initialWorkspaceState = Object.freeze({
  windows: [],
  activeWindowId: null,
  contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
  orientation: WORKSPACE_ORIENTATIONS.FLOATING,
  nextWindowIndex: 1,
  nextSourceWindowId: 1,
});

const MULTI_INSTANCE_WINDOW_TYPES = new Set([
  WORKSPACE_WINDOW_TYPES.SOURCE,
  WORKSPACE_WINDOW_TYPES.GRAPH,
  WORKSPACE_WINDOW_TYPES.CHART,
]);

const buildWindowId = (type, index) => `${type}-${index}`;

const createWindow = (type, index, metadata = {}, instanceNumber = 1) => {
  const now = new Date().toISOString();
  const baseTitle = metadata.title || WORKSPACE_WINDOW_LABELS[type] || 'Workspace';
  const isMultiInstance = MULTI_INSTANCE_WINDOW_TYPES.has(type);
  const titleIdentity = metadata.sourceSessionId || metadata.displayId || instanceNumber;
  const defaultTitle = isMultiInstance ? `${baseTitle} ${titleIdentity}` : baseTitle;

  return {
    id: metadata.id || buildWindowId(type, index),
    type,
    title: defaultTitle,
    customTitle: metadata.customTitle || metadata.status || 'Placeholder',
    status: metadata.status || 'placeholder',
    instanceNumber,
    parentSessionId: metadata.parentSessionId || '',
    backendWindowId: metadata.backendWindowId || '',
    sourceSessionId: metadata.sourceSessionId || '',
    createdAt: now,
    updatedAt: now,
    metadata: metadata.metadata || {},
  };
};

export function workspaceReducer(state, action) {
  switch (action.type) {
    case WORKSPACE_ACTIONS.OPEN_WINDOW: {
      const windowType = action.payload?.type;
      if (!windowType) return state;

      const isMultiInstance = MULTI_INSTANCE_WINDOW_TYPES.has(windowType);
      const existingWindow = state.windows.find((windowItem) => windowItem.type === windowType);
      if (!isMultiInstance && existingWindow) {
        return {
          ...state,
          activeWindowId: existingWindow.id,
          contextTab: action.payload?.contextTab || state.contextTab,
        };
      }

      const instanceNumber = state.windows.filter((windowItem) => windowItem.type === windowType).length + 1;
      const nextWindow = createWindow(windowType, state.nextWindowIndex, action.payload, instanceNumber);
      return {
        ...state,
        windows: [...state.windows, nextWindow],
        activeWindowId: nextWindow.id,
        contextTab: action.payload?.contextTab || state.contextTab,
        nextWindowIndex: state.nextWindowIndex + 1,
        nextSourceWindowId: windowType === WORKSPACE_WINDOW_TYPES.SOURCE
          ? state.nextSourceWindowId + 1
          : state.nextSourceWindowId,
      };
    }

    case WORKSPACE_ACTIONS.CLOSE_WINDOW: {
      const windowId = action.payload?.id;
      if (!windowId) return state;
      const nextWindows = state.windows.filter((windowItem) => windowItem.id !== windowId);
      const activeWindowWasClosed = state.activeWindowId === windowId;
      return {
        ...state,
        windows: nextWindows,
        activeWindowId: activeWindowWasClosed ? nextWindows.at(-1)?.id || null : state.activeWindowId,
      };
    }

    case WORKSPACE_ACTIONS.FOCUS_WINDOW: {
      const windowId = action.payload?.id;
      if (!windowId || !state.windows.some((windowItem) => windowItem.id === windowId)) return state;
      return {
        ...state,
        activeWindowId: windowId,
      };
    }

    case WORKSPACE_ACTIONS.UPDATE_WINDOW_CUSTOM_TITLE: {
      const windowId = action.payload?.id;
      if (!windowId) return state;
      const nextCustomTitle = String(action.payload?.customTitle || '').slice(0, 120);
      return {
        ...state,
        windows: state.windows.map((windowItem) => (
          windowItem.id === windowId
            ? { ...windowItem, customTitle: nextCustomTitle, updatedAt: new Date().toISOString() }
            : windowItem
        )),
      };
    }

    case WORKSPACE_ACTIONS.SET_ORIENTATION: {
      const orientation = action.payload?.orientation;
      if (!Object.values(WORKSPACE_ORIENTATIONS).includes(orientation)) return state;
      return {
        ...state,
        orientation,
      };
    }

    case WORKSPACE_ACTIONS.TOGGLE_ORIENTATION: {
      return {
        ...state,
        orientation: state.orientation === WORKSPACE_ORIENTATIONS.FLOATING
          ? WORKSPACE_ORIENTATIONS.DOCKED
          : WORKSPACE_ORIENTATIONS.FLOATING,
      };
    }

    case WORKSPACE_ACTIONS.SET_CONTEXT_TAB: {
      return {
        ...state,
        contextTab: action.payload?.tab || WORKSPACE_CONTEXT_TABS.OVERVIEW,
      };
    }

    case WORKSPACE_ACTIONS.CLEAR_WINDOWS:
      return {
        ...state,
        windows: [],
        activeWindowId: null,
        contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
        nextSourceWindowId: 1,
      };

    default:
      return state;
  }
}