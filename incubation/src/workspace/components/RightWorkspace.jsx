import React, { useState, useEffect } from 'react';
import WorkspaceContextTabs, { contextTabs } from './right/WorkspaceContextTabs.jsx';
import WorkspaceRightCollapsedRail from './right/WorkspaceRightCollapsedRail.jsx';
import WorkspaceOverviewTab from './right/WorkspaceOverviewTab.jsx';
import WorkspaceAssistantTab from './right/WorkspaceAssistantTab.jsx';
import GraphInfoTab from './right/GraphInfoTab.jsx';
import GraphFilterTab from './right/GraphFilterTab.jsx';
import WorkspaceSettingsTab from './right/WorkspaceSettingsTab.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

function ChevronIcon({ isCollapsed }) {
  return (
    <svg
      className={`workspace_collapse_icon${isCollapsed ? ' is-collapsed' : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points={isCollapsed ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
    </svg>
  );
}

export default function RightWorkspace({ displayName, workspace, logoSrc, isRightCollapsed = false, onToggleCollapse }) {
  // Independent user-controlled tab state
  const [activeTab, setActiveTab] = useState('overview');
  const activeTabConfig = contextTabs.find((tab) => tab.id === activeTab) || contextTabs[0];

  // 1. The entire panel is disabled if NO Source, Graph, or Chart window is open
  const hasAnalysisWindow = Boolean(
    workspace?.windows?.some((w) =>
      [WORKSPACE_WINDOW_TYPES.SOURCE, WORKSPACE_WINDOW_TYPES.GRAPH, WORKSPACE_WINDOW_TYPES.CHART].includes(w.type)
    )
  );
  const isPanelDisabled = !hasAnalysisWindow;

  // 2. Identify the currently active (top focused) window
  const activeWindow = workspace?.activeWindow || workspace?.windows?.find((w) => w.id === workspace?.activeWindowId) || workspace?.windows?.at(-1) || null;

  // 3. Determine if the active window is Graph or Chart
  const isGraphOrChartActive = Boolean(
    activeWindow && (activeWindow.type === WORKSPACE_WINDOW_TYPES.GRAPH || activeWindow.type === WORKSPACE_WINDOW_TYPES.CHART)
  );

  // 4. Per-tab disabled rules:
  // - If panel is disabled: all tabs disabled
  // - If Graph or Chart window is active: ALL tabs enabled ([])
  // - If Source or other window is active: ONLY 'overview' is enabled, so assistant, info, filter, settings are disabled
  const disabledTabs = isPanelDisabled
    ? ['overview', 'assistant', 'info', 'filter', 'settings']
    : (isGraphOrChartActive ? [] : ['assistant', 'info', 'filter', 'settings']);

  // If active window changes and current activeTab becomes disabled, automatically fall back to 'overview'
  useEffect(() => {
    if (!isPanelDisabled && disabledTabs.includes(activeTab)) {
      setActiveTab('overview');
    }
  }, [disabledTabs, activeTab, isPanelDisabled]);

  const handleSelectTab = (tabId) => {
    if (isPanelDisabled || disabledTabs.includes(tabId)) return;
    setActiveTab(tabId);
    if (isRightCollapsed && onToggleCollapse) {
      onToggleCollapse();
    }
  };

  return (
    <aside
      className={`workspace_zone workspace_zone_right${isRightCollapsed ? ' is-collapsed' : ''}${isPanelDisabled ? ' is-disabled' : ''}`}
      aria-label="Workspace context"
      aria-disabled={isPanelDisabled}
    >
      {/* Dedicated Vertical Collapsed Rail (Pinned to Far-Right Edge) */}
      <WorkspaceRightCollapsedRail
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        onExpand={onToggleCollapse}
        logoSrc={logoSrc}
        isPanelDisabled={isPanelDisabled}
        disabledTabs={disabledTabs}
      />

      {/* Expanded Right Workspace Context Panel */}
      <div className={`workspace_context_panel${isPanelDisabled ? ' is-disabled' : ''}`} aria-label="Workspace status">
        {/* Header Tabs Wrapper */}
        <div className="workspace_right_tabs_wrapper">
          <WorkspaceContextTabs
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            isCollapsed={false}
            isPanelDisabled={isPanelDisabled}
            disabledTabs={disabledTabs}
          />
          <button
            type="button"
            className="workspace_right_collapse_btn linkx_tooltip_anchor"
            data-tooltip="Collapse right panel"
            aria-label="Collapse right panel"
            aria-expanded="true"
            onClick={onToggleCollapse}
          >
            <ChevronIcon isCollapsed={false} />
          </button>
        </div>

        {/* Active Tab Body Router */}
        <div
          id={activeTabConfig.panelId}
          className={`workspace_context_tab_body${activeTab === 'assistant' ? ' is-assistant-active' : ''}${isPanelDisabled ? ' is-disabled' : ''}`}
          role="tabpanel"
          aria-labelledby={`workspace-context-tab-${activeTabConfig.id}`}
        >
          {isPanelDisabled ? (
            <div className="workspace_panel_disabled_notice" role="status">
              <div className="workspace_panel_disabled_icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                </svg>
              </div>
              <h4 className="workspace_panel_disabled_title">Analysis Panel Inactive</h4>
              <p className="workspace_panel_disabled_desc">
                Open a <strong>Source</strong>, <strong>Graph</strong>, or <strong>Chart</strong> workspace window to activate session controls, Co-Analyst, filters, and analysis settings.
              </p>
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <WorkspaceOverviewTab
                  displayName={displayName}
                  workspace={workspace}
                  logoSrc={logoSrc}
                  onSwitchTab={handleSelectTab}
                />
              )}

              {activeTab === 'assistant' && (
                <WorkspaceAssistantTab
                  displayName={displayName}
                  workspace={workspace}
                  logoSrc={logoSrc}
                />
              )}

              {activeTab === 'info' && (
                <GraphInfoTab workspace={workspace} />
              )}

              {activeTab === 'filter' && (
                <GraphFilterTab workspace={workspace} />
              )}

              {activeTab === 'settings' && (
                <WorkspaceSettingsTab workspace={workspace} />
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
