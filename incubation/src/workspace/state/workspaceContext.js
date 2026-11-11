import { createContext } from 'react';

export const WorkspaceContext = createContext(null);

// Stable action callbacks only; consumers of this context never re-render on state changes.
export const WorkspaceActionsContext = createContext(null);
