import React, { useEffect, useRef, useState } from 'react';

import WorkspaceWindowBody from './WorkspaceWindowBody.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

const tabIconPaths = {
  [WORKSPACE_WINDOW_TYPES.SOURCE]: 'M7 7h4m2 0h4M9 3v4m6-4v4M8 17h8a3 3 0 0 0 3-3V9H5v5a3 3 0 0 0 3 3Zm4 0v4',
  [WORKSPACE_WINDOW_TYPES.GRAPH]: 'M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm2.2-4.2 5.6-7.6M9.5 7.3l5 8.2',
  [WORKSPACE_WINDOW_TYPES.CHART]: 'M5 20V10m7 10V4m7 16v-7M3 20h18',
  [WORKSPACE_WINDOW_TYPES.CONFIGURATION]: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0-5v2M12 18.5v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2',
  [WORKSPACE_WINDOW_TYPES.SETTINGS]: 'M5 7h14M5 12h14M5 17h14M8 7v0M16 12v0M11 17v0',
};

function WindowTabIcon({ type }) {
  return (
    <svg className="workspace_window_dock_tab_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={tabIconPaths[type] || tabIconPaths[WORKSPACE_WINDOW_TYPES.SOURCE]} />
    </svg>
  );
}

export default function WindowDock({ workspace }) {
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);
  const tabsRef = useRef(null);
  const previousWindowCountRef = useRef(workspace.windows.length);
  const activeWindow = workspace.activeWindow || workspace.windows.at(-1);

  useEffect(() => {
    const previousWindowCount = previousWindowCountRef.current;
    const currentWindowCount = workspace.windows.length;
    previousWindowCountRef.current = currentWindowCount;

    if (currentWindowCount <= previousWindowCount) return;
    const tabsElement = tabsRef.current;
    if (!tabsElement) return;

    tabsElement.scrollTo({
      left: tabsElement.scrollWidth,
      behavior: 'smooth',
    });
  }, [workspace.windows.length]);

  if (!activeWindow) return null;

  return (
    <section className="workspace_window_dock" aria-label="Docked workspace windows">
      <div className="workspace_window_dock_header">
        <div ref={tabsRef} className="workspace_window_dock_tabs" role="tablist" aria-label="Open windows">
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
                className="workspace_window_dock_tab_focus"
                type="button"
                role="tab"
                aria-selected={isActive}
                title={tabLabel}
                onClick={() => workspace.focusWindow(windowItem.id)}
              >
                <WindowTabIcon type={windowItem.type} />
                <span>{windowItem.title}</span>
              </button>
              <input
                className="workspace_window_dock_tab_title_input"
                type="text"
                value={windowItem.customTitle ?? windowItem.status ?? 'Placeholder'}
                placeholder="Placeholder"
                aria-label={windowItem.title + ' custom title'}
                maxLength={120}
                onFocus={() => workspace.focusWindow(windowItem.id)}
                onChange={(event) => workspace.updateWindowCustomTitle(windowItem.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
              />
              <button
                className="workspace_window_dock_tab_close linkx_tooltip_anchor"
                type="button"
                data-tooltip={'Close ' + windowItem.title}
                aria-label={'Close ' + windowItem.title}
                onClick={() => workspace.closeWindow(windowItem.id)}
              >
                ×
              </button>
            </div>
          );
          })}
        </div>
        <div className="workspace_window_overview_slot">
          <button
            className="workspace_window_overview_button linkx_tooltip_anchor"
            type="button"
            data-tooltip="Show all windows"
            aria-label="Show all open windows"
            aria-expanded={isOverviewOpen}
            onClick={() => setIsOverviewOpen((current) => !current)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 13h6v6H4v-6Zm10 0h6v6h-6v-6Z" />
            </svg>
          </button>
          {isOverviewOpen && (
            <div className="workspace_window_overview_menu" role="menu" aria-label="Open windows overview">
              {workspace.windows.map((windowItem) => {
                const isActive = windowItem.id === activeWindow.id;
                return (
                  <button
                    key={windowItem.id}
                    className={'workspace_window_overview_item' + (isActive ? ' is-active' : '')}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      workspace.focusWindow(windowItem.id);
                      setIsOverviewOpen(false);
                    }}
                  >
                    <WindowTabIcon type={windowItem.type} />
                    <span>
                      <strong>{windowItem.title}</strong>
                      <small>{windowItem.customTitle || 'Placeholder'}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <article className="workspace_window_dock_panel" aria-label={activeWindow.title}>
        <WorkspaceWindowBody windowItem={activeWindow} />
      </article>
    </section>
  );
}