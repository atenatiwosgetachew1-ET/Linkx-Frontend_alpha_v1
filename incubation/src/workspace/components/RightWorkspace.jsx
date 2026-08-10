import React, { useState } from 'react';
import WorkspaceContextTabs, { contextTabs } from './right/WorkspaceContextTabs.jsx';
import WorkspaceOverviewTab from './right/WorkspaceOverviewTab.jsx';
import GraphInfoTab from './right/GraphInfoTab.jsx';
import GraphFilterTab from './right/GraphFilterTab.jsx';
import WorkspaceSettingsTab from './right/WorkspaceSettingsTab.jsx';

function ChevronIcon() {
  return (
    <svg
      className="workspace_collapse_icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function RightWorkspace({ displayName, workspace, isRightCollapsed = false, onToggleCollapse }) {
  // Independent user-controlled tab state: user clicks set the active tab and it never gets forcibly hijacked by window focus
  const [activeTab, setActiveTab] = useState('overview');
  const activeTabConfig = contextTabs.find((tab) => tab.id === activeTab) || contextTabs[0];

  const handleSelectTab = (tabId) => {
    setActiveTab(tabId);
    if (isRightCollapsed && onToggleCollapse) {
      onToggleCollapse();
    }
  };

  return (
    <aside className={`workspace_zone workspace_zone_right${isRightCollapsed ? ' is-collapsed' : ''}`} aria-label="Workspace context">
      <div className="workspace_context_panel" aria-label="Workspace status">
        {/* Header Tabs Wrapper */}
        <div className="workspace_right_tabs_wrapper">
          <WorkspaceContextTabs
            activeTab={activeTab}
            onSelectTab={handleSelectTab}
            isCollapsed={isRightCollapsed}
          />
          {/* Hide collapse button when collapsed; clicking any tab in collapsed strip expands panel */}
          {!isRightCollapsed && (
            <button
              type="button"
              className="workspace_right_collapse_btn linkx_tooltip_anchor"
              data-tooltip="Collapse right panel"
              aria-label="Collapse right panel"
              aria-expanded="true"
              onClick={onToggleCollapse}
            >
              <ChevronIcon />
            </button>
          )}
        </div>

        {/* Active Tab Body Router (kept mounted for smooth CSS fade/slide transition) */}
        <div
          id={activeTabConfig.panelId}
          className={`workspace_context_tab_body${isRightCollapsed ? ' is-hidden' : ''}`}
          role="tabpanel"
          aria-labelledby={`workspace-context-tab-${activeTabConfig.id}`}
          aria-hidden={isRightCollapsed}
        >
          {activeTab === 'overview' && (
            <WorkspaceOverviewTab displayName={displayName} workspace={workspace} />
          )}
          {activeTab === 'info' && <GraphInfoTab />}
          {activeTab === 'filter' && <GraphFilterTab />}
          {activeTab === 'settings' && <WorkspaceSettingsTab />}
        </div>
      </div>
    </aside>
  );
}
