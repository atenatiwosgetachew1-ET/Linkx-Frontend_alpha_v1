import React, { useMemo, useReducer, useRef } from 'react';

import { initialWorkspaceState, workspaceReducer } from './workspaceReducer.js';
import { WORKSPACE_ACTIONS, getWindowLimitBlock } from './workspaceTypes.js';
import { WorkspaceActionsContext, WorkspaceContext } from './workspaceContext.js';
import { useNotifications } from '../../shared/notifications/useNotifications.js';

function createWorkspaceActions(dispatch, { getWindows, getNextWindowIndex, onLimitReached }) {
  return {
    // The id the next opened window of `type` will get (reducer buildWindowId),
    // for flows that must act on a window right after opening it.
    nextWindowId: (type) => `${type}-${getNextWindowIndex()}`,
    // Returns false when the per-type cap blocked a new window (the reducer
    // then focuses the most recent window of that type instead).
    openWindow: (type, options = {}) => {
      const block = getWindowLimitBlock(getWindows(), type);
      if (block) onLimitReached(block);
      dispatch({
        type: WORKSPACE_ACTIONS.OPEN_WINDOW,
        payload: { ...options, type },
      });
      return !block;
    },
    closeWindow: (id) => dispatch({
      type: WORKSPACE_ACTIONS.CLOSE_WINDOW,
      payload: { id },
    }),
    focusWindow: (id) => dispatch({
      type: WORKSPACE_ACTIONS.FOCUS_WINDOW,
      payload: { id },
    }),
    reorderWindows: (draggedId, targetId) => dispatch({
      type: WORKSPACE_ACTIONS.REORDER_WINDOWS,
      payload: { draggedId, targetId },
    }),
    updateWindowCustomTitle: (id, customTitle) => dispatch({
      type: WORKSPACE_ACTIONS.UPDATE_WINDOW_CUSTOM_TITLE,
      payload: { id, customTitle },
    }),
    updateWindowMetadata: (id, updates) => dispatch({
      type: WORKSPACE_ACTIONS.UPDATE_WINDOW_METADATA,
      payload: { id, updates },
    }),
    setOrientation: (orientation) => dispatch({
      type: WORKSPACE_ACTIONS.SET_ORIENTATION,
      payload: { orientation },
    }),
    toggleOrientation: () => dispatch({
      type: WORKSPACE_ACTIONS.TOGGLE_ORIENTATION,
    }),
    setContextTab: (tab) => dispatch({
      type: WORKSPACE_ACTIONS.SET_CONTEXT_TAB,
      payload: { tab },
    }),
    clearWindows: () => dispatch({ type: WORKSPACE_ACTIONS.CLEAR_WINDOWS }),
  };
}

export function WorkspaceProvider({ children }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);
  const { notify } = useNotifications();
  const windowsRef = useRef(state.windows);
  windowsRef.current = state.windows;
  const nextIndexRef = useRef(state.nextWindowIndex);
  nextIndexRef.current = state.nextWindowIndex;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const actions = useMemo(() => createWorkspaceActions(dispatch, {
    getWindows: () => windowsRef.current,
    getNextWindowIndex: () => nextIndexRef.current,
    onLimitReached: ({ limit, label }) => {
      notifyRef.current({
        title: label + ' window limit reached',
        message: `You can have up to ${limit} ${label} windows open at a time. Close one to open another.`,
        level: 'warning',
        source: 'Workspace',
      });
    },
  }), []);

  const value = useMemo(() => {
    const activeWindow = state.windows.find((windowItem) => windowItem.id === state.activeWindowId) || null;
    return { ...state, activeWindow, ...actions };
  }, [state, actions]);

  return (
    <WorkspaceActionsContext.Provider value={actions}>
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
    </WorkspaceActionsContext.Provider>
  );
}
