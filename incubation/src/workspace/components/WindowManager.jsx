import React from 'react';

import WorkspaceWindow from './WorkspaceWindow.jsx';

export default function WindowManager({ workspace }) {
  if (workspace.windows.length === 0) return null;

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
            onClose={workspace.closeWindow}
          />
        ))}
      </div>
    </div>
  );
}
