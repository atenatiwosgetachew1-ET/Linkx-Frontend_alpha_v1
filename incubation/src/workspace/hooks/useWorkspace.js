import { useContext } from 'react';

import { WorkspaceActionsContext, WorkspaceContext } from '../state/workspaceContext.js';

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
}

/** Stable workspace actions without subscribing to workspace state changes. */
export function useWorkspaceActions() {
  const context = useContext(WorkspaceActionsContext);
  if (!context) {
    throw new Error('useWorkspaceActions must be used within a WorkspaceProvider');
  }
  return context;
}
