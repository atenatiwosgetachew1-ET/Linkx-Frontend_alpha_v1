import React, { useLayoutEffect, useRef, useState } from 'react';

import WorkspaceWindowBody from './WorkspaceWindowBody.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';
import { CHART_ICON, TABLE_ICON } from '../../shared/icons/windowIcons.js';
import { windowDetail } from '../lib/windowSwitcher.js';

const tabIconPaths = {
  [WORKSPACE_WINDOW_TYPES.SOURCE]: 'M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Zm4 2h8M8 12h8M8 16h5',
  [WORKSPACE_WINDOW_TYPES.GRAPH]: 'M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm2.2-4.2 5.6-7.6M9.5 7.3l5 8.2',
  [WORKSPACE_WINDOW_TYPES.CHART]: CHART_ICON,
  [WORKSPACE_WINDOW_TYPES.TABLE]: TABLE_ICON,
  [WORKSPACE_WINDOW_TYPES.REPORTS]: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l5.414 5.414a1 1 0 0 1 .293.707V19a2 2 0 0 1-2 2z',
  [WORKSPACE_WINDOW_TYPES.TASKS]: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
  [WORKSPACE_WINDOW_TYPES.LIBRARIES]: 'M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z',
  [WORKSPACE_WINDOW_TYPES.CONFIGURATION]: 'M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z',
  [WORKSPACE_WINDOW_TYPES.SETTINGS]: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
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
  const [draggedWindowId, setDraggedWindowId] = useState(null);
  const [dropTargetWindowId, setDropTargetWindowId] = useState(null);
  const tabsRef = useRef(null);
  const activeWindow = workspace.activeWindow || workspace.windows.at(-1);
  const activeWindowId = activeWindow?.id;

  useLayoutEffect(() => {
    if (!activeWindowId) return;
    const tabsElement = tabsRef.current;
    if (!tabsElement) return;

    const activeTabElement = tabsElement.querySelector('[data-window-tab-id="' + activeWindowId + '"]');
    if (!activeTabElement) return;

    activeTabElement.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeWindowId, workspace.windows.length]);

  // Chart windows shown at least once: kept mounted (hidden) while open.
  const [keptCharts, setKeptCharts] = useState(() => new Set());
  const activeIsChart = activeWindow?.type === WORKSPACE_WINDOW_TYPES.CHART;
  useLayoutEffect(() => {
    if (!activeIsChart || keptCharts.has(activeWindowId)) return;
    setKeptCharts((current) => new Set(current).add(activeWindowId));
  }, [activeIsChart, activeWindowId, keptCharts]);

  if (!activeWindow) return null;
  const bodies = workspace.windows.filter((windowItem) => windowItem.id === activeWindow.id || (windowItem.type === WORKSPACE_WINDOW_TYPES.CHART && keptCharts.has(windowItem.id)));

  const handleTabDragStart = (windowId) => {
    setDraggedWindowId(windowId);
    setDropTargetWindowId(windowId);
  };

  const handleTabDrop = (targetWindowId) => {
    if (!draggedWindowId || !targetWindowId || draggedWindowId === targetWindowId) {
      setDraggedWindowId(null);
      setDropTargetWindowId(null);
      return;
    }

    workspace.reorderWindows(draggedWindowId, targetWindowId);
    setDraggedWindowId(null);
    setDropTargetWindowId(null);
  };

  const resetDragState = () => {
    setDraggedWindowId(null);
    setDropTargetWindowId(null);
  };

  return (
    <section className="workspace_window_dock" aria-label="Docked workspace windows">
      <div className="workspace_window_dock_header">
        <div ref={tabsRef} className="workspace_window_dock_tabs" role="tablist" aria-label="Open windows">
          {workspace.windows.map((windowItem) => {
          const isActive = windowItem.id === activeWindow.id;
          const detail = windowDetail(windowItem);
          const tabLabel = detail ? `${windowItem.title} - ${detail}`
            : windowItem.title;

          return (
            <div
              key={windowItem.id}
              data-window-tab-id={windowItem.id}
              className={
                'workspace_window_dock_tab' +
                (isActive ? ' is-active' : '') +
                (draggedWindowId === windowItem.id ? ' is-dragging' : '') +
                (dropTargetWindowId === windowItem.id && draggedWindowId !== windowItem.id ? ' is-drop-target' : '')
              }
              role="presentation"
              draggable
              onDragStart={() => handleTabDragStart(windowItem.id)}
              onDragOver={(event) => {
                event.preventDefault();
                if (draggedWindowId && draggedWindowId !== windowItem.id && dropTargetWindowId !== windowItem.id) {
                  setDropTargetWindowId(windowItem.id);
                }
              }}
              onDrop={() => handleTabDrop(windowItem.id)}
              onDragEnd={resetDragState}
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
                value={windowItem.customTitle ?? ''}
                placeholder="Add a label"
                aria-label={windowItem.title + ' custom title'}
                maxLength={120}
                onFocus={() => workspace.focusWindow(windowItem.id)}
                onChange={(event) => workspace.updateWindowCustomTitle(windowItem.id, event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onDragStart={(event) => event.stopPropagation()}
              />
              <button
                className="workspace_window_dock_tab_close linkx_tooltip_anchor"
                type="button"
                data-tooltip={'Close ' + windowItem.title}
                aria-label={'Close ' + windowItem.title}
                onClick={() => workspace.closeWindow(windowItem.id)}
                onDragStart={(event) => event.stopPropagation()}
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
                      {windowDetail(windowItem) ? <small>{windowDetail(windowItem)}</small> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <article className="workspace_window_dock_panel" aria-label={activeWindow.title}>
        {/* Keyed per window: without it React reuses one body instance for
            every docked tab and window state (refs, local state, async
            flows) leaks between windows. */}
        {/* Chart windows stay mounted, hidden, once shown (analyst report
            2026-11-18: rebuilding every chart on a tab switch was slow);
            the others mount with their tab as before. A hidden one is
            dormant: it follows nothing until shown again. */}
        {bodies.map((windowItem) => (
          <div key={windowItem.id} className="workspace_window_dock_body" style={{ display: windowItem.id === activeWindow.id ? 'contents' : 'none' }}>
            <WorkspaceWindowBody windowItem={windowItem} hidden={windowItem.id !== activeWindow.id} />
          </div>
        ))}
      </article>
    </section>
  );
}