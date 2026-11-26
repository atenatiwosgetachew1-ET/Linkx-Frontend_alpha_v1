import {
  WORKSPACE_ACTIONS,
  WORKSPACE_CONTEXT_TABS,
  WORKSPACE_ORIENTATIONS,
  WORKSPACE_WINDOW_LABELS,
  WORKSPACE_WINDOW_TYPES,
  getWindowLimitBlock,
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
  WORKSPACE_WINDOW_TYPES.TABLE,
]);

const buildWindowId = (type, index) => `${type}-${index}`;

// A window brought forward is no longer minimized.
const unminimize = (windows, id) => (windows.some((windowItem) => windowItem.id === id && windowItem.minimized)
  ? windows.map((windowItem) => (windowItem.id === id ? { ...windowItem, minimized: false } : windowItem))
  : windows);

// The Source window owns its defaults (features/source/lib/sourceModel.js
// defaultSourceState, applied by mergeSourceState); only the initial mode and
// any caller-provided state are stored here.
const createInitialSourceState = (metadata = {}) => ({
  mode: 'choose',
  ...metadata.sourceState,
});

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
    customTitle: metadata.customTitle || '',
    status: metadata.status || 'placeholder',
    instanceNumber,
    parentSessionId: metadata.parentSessionId || '',
    backendWindowId: metadata.backendWindowId || '',
    sourceSessionId: metadata.sourceSessionId || '',
    createdAt: now,
    updatedAt: now,
    metadata: metadata.metadata || {},
    sourceState: type === WORKSPACE_WINDOW_TYPES.SOURCE ? createInitialSourceState(metadata) : undefined,
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
        // Single windows are focused; a request's metadata (e.g. Reports
        // opened for a Vigilance run) is merged into the open window.
        const metadata = action.payload?.metadata;
        return {
          ...state,
          windows: unminimize(metadata && typeof metadata === 'object'
            ? state.windows.map((windowItem) => (windowItem.id === existingWindow.id
              ? { ...windowItem, metadata: { ...windowItem.metadata, ...metadata } }
              : windowItem))
            : state.windows, existingWindow.id),
          activeWindowId: existingWindow.id,
          contextTab: action.payload?.contextTab || state.contextTab,
        };
      }

      // Cap reached: focus the most recent window of that type (or of its
      // limit group, e.g. a Chart when Graph+Chart is full) instead.
      const limitBlock = getWindowLimitBlock(state.windows, windowType);
      if (limitBlock) {
        const latestOfType = state.windows.filter((windowItem) => windowItem.type === windowType).at(-1)
          || state.windows.filter((windowItem) => limitBlock.types.includes(windowItem.type)).at(-1);
        return latestOfType ? { ...state, windows: unminimize(state.windows, latestOfType.id), activeWindowId: latestOfType.id } : state;
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
      const windows = unminimize(state.windows, windowId);
      if (state.activeWindowId === windowId && windows === state.windows) return state;
      return {
        ...state,
        windows,
        activeWindowId: windowId,
      };
    }

    case WORKSPACE_ACTIONS.TOGGLE_MINIMIZE_ALL: {
      if (!state.windows.length) return state;
      const minimized = !state.windows.every((windowItem) => windowItem.minimized);
      return { ...state, windows: state.windows.map((windowItem) => ({ ...windowItem, minimized })) };
    }

    case WORKSPACE_ACTIONS.REORDER_WINDOWS: {
      const draggedId = action.payload?.draggedId;
      const targetId = action.payload?.targetId;
      if (!draggedId || !targetId || draggedId === targetId) return state;

      const draggedIndex = state.windows.findIndex((windowItem) => windowItem.id === draggedId);
      const targetIndex = state.windows.findIndex((windowItem) => windowItem.id === targetId);
      if (draggedIndex < 0 || targetIndex < 0) return state;

      const nextWindows = [...state.windows];
      const [draggedWindow] = nextWindows.splice(draggedIndex, 1);
      nextWindows.splice(targetIndex, 0, draggedWindow);

      return {
        ...state,
        windows: nextWindows,
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

    case WORKSPACE_ACTIONS.UPDATE_WINDOW_METADATA: {
      const windowId = action.payload?.id;
      if (!windowId) return state;
      return {
        ...state,
        windows: state.windows.map((windowItem) => (
          windowItem.id === windowId
            ? {
                ...windowItem,
                ...action.payload?.updates,
                metadata: {
                  ...windowItem.metadata,
                  ...(action.payload?.updates?.metadata || {}),
                },
                updatedAt: new Date().toISOString(),
              }
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
      const contextTab = action.payload?.tab || WORKSPACE_CONTEXT_TABS.OVERVIEW;
      if (state.contextTab === contextTab) return state;
      return {
        ...state,
        contextTab,
      };
    }

    // The last workspace, as offered (lib/workspaceCopy.js): every window gets
    // a new id, so what is linked by id (Table and Chart to their Graph) is
    // linked again. Limits and single windows apply as when opened by hand.
    case WORKSPACE_ACTIONS.RESTORE_WINDOWS: {
      const { windows: wanted = [], activeWindowId = '', orientation, contextTab } = action.payload || {};
      let windows = [...state.windows];
      let nextWindowIndex = state.nextWindowIndex;
      const ids = new Map();
      wanted.forEach((item) => {
        if (!Object.values(WORKSPACE_WINDOW_TYPES).includes(item?.type)) return;
        const sameType = windows.filter((windowItem) => windowItem.type === item.type);
        if (!MULTI_INSTANCE_WINDOW_TYPES.has(item.type) && sameType.length) {
          ids.set(item.id, sameType[0].id);
          return;
        }
        if (getWindowLimitBlock(windows, item.type)) return;
        const restored = createWindow(item.type, nextWindowIndex, {
          customTitle: item.customTitle,
          parentSessionId: item.parentSessionId,
          backendWindowId: item.backendWindowId,
          sourceSessionId: item.sourceSessionId,
          sourceState: item.sourceState,
          metadata: item.metadata,
        }, sameType.length + 1);
        ids.set(item.id, restored.id);
        windows = [...windows, restored];
        nextWindowIndex += 1;
      });
      const restoredIds = new Set(ids.values());
      const relink = (metadata, key) => (metadata[key] ? { [key]: ids.get(metadata[key]) || null } : {});
      return {
        ...state,
        windows: windows.map((windowItem) => (restoredIds.has(windowItem.id)
          ? { ...windowItem, metadata: { ...windowItem.metadata, ...relink(windowItem.metadata, 'tableGraph'), ...relink(windowItem.metadata, 'chartGraph') } }
          : windowItem)),
        activeWindowId: ids.get(activeWindowId) || windows.at(-1)?.id || null,
        orientation: Object.values(WORKSPACE_ORIENTATIONS).includes(orientation) ? orientation : state.orientation,
        contextTab: contextTab || state.contextTab,
        nextWindowIndex,
        nextSourceWindowId: state.nextSourceWindowId + wanted.filter((item) => item?.type === WORKSPACE_WINDOW_TYPES.SOURCE).length,
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