import React from 'react';

import WorkspaceWindowBody from './WorkspaceWindowBody.jsx';

export default function WindowDock({ workspace }) {
  const activeWindow = workspace.activeWindow || workspace.windows.at(-1);
  if (!activeWindow) return null;

  return (
    <section className="workspace_window_dock" aria-label="Docked workspace windows">
      <div className="workspace_window_dock_tabs" role="tablist" aria-label="Open windows">
        {workspace.windows.map((windowItem) => {
          const isActive = windowItem.id === activeWindow.id;
          const tabLabel = windowItem.customTitle && windowItem.customTitle !== 'Placeholder'
            ? `${windowItem.title} - ${windowItem.customTitle}`
            : windowItem.title;

          return (
            <div
              key={windowItem.id}
              className={'workspace_window_dock_tab' + (isActive ? ' is-active' : '')}
              role="presentation"
            >
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                title={tabLabel}
                onClick={() => workspace.focusWindow(windowItem.id)}
              >
                <span>{windowItem.title}</span>
                {windowItem.customTitle && <small>{windowItem.customTitle}</small>}
              </button>
              <button
                className="workspace_window_dock_tab_close"
                type="button"
                aria-label={'Close ' + windowItem.title}
                onClick={() => workspace.closeWindow(windowItem.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <article className="workspace_window_dock_panel" aria-label={activeWindow.title}>
        <WorkspaceWindowBody windowItem={activeWindow} />
      </article>
    </section>
  );
}