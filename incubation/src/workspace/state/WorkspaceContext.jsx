import React, { useMemo, useReducer } from 'react';

import { initialWorkspaceState, workspaceReducer } from './workspaceReducer.js';
import { WORKSPACE_ACTIONS } from './workspaceTypes.js';
import { WorkspaceContext } from './workspaceContext.js';

export function WorkspaceProvider({ children }) {
  const [state, dispatch] = useReducer(workspaceReducer, initialWorkspaceState);

  const value = useMemo(() => {
    const activeWindow = state.windows.find((windowItem) => windowItem.id === state.activeWindowId) || null;

    return {
      ...state,
      activeWindow,
      openWindow: (type, options = {}) => dispatch({
        type: WORKSPACE_ACTIONS.OPEN_WINDOW,
        payload: { ...options, type },
      }),
      closeWindow: (id) => dispatch({
        type: WORKSPACE_ACTIONS.CLOSE_WINDOW,
        payload: { id },
      }),
      focusWindow: (id) => dispatch({
        type: WORKSPACE_ACTIONS.FOCUS_WINDOW,
        payload: { id },
      }),
      updateWindowCustomTitle: (id, customTitle) => dispatch({
        type: WORKSPACE_ACTIONS.UPDATE_WINDOW_CUSTOM_TITLE,
        payload: { id, customTitle },
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
  }, [state]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
