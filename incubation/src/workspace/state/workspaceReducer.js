import {
  WORKSPACE_ACTIONS,
  WORKSPACE_CONTEXT_TABS,
  WORKSPACE_WINDOW_LABELS,
} from './workspaceTypes.js';

export const initialWorkspaceState = Object.freeze({
  windows: [],
  activeWindowId: null,
  contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW,
  nextWindowIndex: 1,
});

const buildWindowId = (type, index) => `${type}-${index}`;

const createWindow = (type, index, metadata = {}) => {
  const now = new Date().toISOString();
  return {
    id: metadata.id || buildWindowId(type, index),
    type,
    title: metadata.title || WORKSPACE_WINDOW_LABELS[type] || 'Workspace',
    status: metadata.status || 'placeholder',
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

      const existingWindow = state.windows.find((windowItem) => windowItem.type === windowType);
      if (existingWindow) {
        return {
          ...state,
          activeWindowId: existingWindow.id,
          contextTab: action.payload?.contextTab || state.contextTab,
        };
      }

      const nextWindow = createWindow(windowType, state.nextWindowIndex, action.payload);
      return {
        ...state,
        windows: [...state.windows, nextWindow],
        activeWindowId: nextWindow.id,
        contextTab: action.payload?.contextTab || state.contextTab,
        nextWindowIndex: state.nextWindowIndex + 1,
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
      };

    default:
      return state;
  }
}
