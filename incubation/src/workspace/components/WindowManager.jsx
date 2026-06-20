import React from 'react';

import WindowDock from './WindowDock.jsx';
import WorkspaceWindow from './WorkspaceWindow.jsx';
import { WORKSPACE_ORIENTATIONS } from '../state/workspaceTypes.js';

export default function WindowManager({ workspace }) {
  if (workspace.windows.length === 0) return null;

  if (workspace.orientation === WORKSPACE_ORIENTATIONS.DOCKED) {
    return <WindowDock workspace={workspace} />;
  }

  return (
    <div className="workspace_window_manager" aria-label="Workspace windows">
      <div className="workspace_window_layer">
        {workspace.windows.map((windowItem, index) => (
          <WorkspaceWindow
            key={windowItem.id}
            windowItem={windowItem}
            stackIndex={index}
            isActive={workspace.activeWindowId === windowItem.id}
            onFocus={workspace.focusWindow}
            onCustomTitleChange={workspace.updateWindowCustomTitle}
            onClose={workspace.closeWindow}
          />
        ))}
      </div>
    </div>
  );
}
