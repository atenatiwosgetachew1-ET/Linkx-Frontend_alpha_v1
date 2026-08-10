import React from 'react';

function OverviewTabIcon() {
  return (
    <svg className="workspace_tab_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function InfoTabIcon() {
  return (
    <svg className="workspace_tab_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function FilterTabIcon() {
  return (
    <svg className="workspace_tab_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
  );
}

function SettingsTabIcon() {
  return (
    <svg className="workspace_tab_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

const contextTabs = [
  { id: 'overview', label: 'Overview', icon: OverviewTabIcon, panelId: 'workspace-context-overview' },
  { id: 'info', label: 'Info', icon: InfoTabIcon, panelId: 'workspace-context-info' },
  { id: 'filter', label: 'Filter', icon: FilterTabIcon, panelId: 'workspace-context-filter' },
  { id: 'settings', label: 'Settings', icon: SettingsTabIcon, panelId: 'workspace-context-settings' },
];

export default function WorkspaceContextTabs({ activeTab, onSelectTab, isCollapsed = false }) {
  return (
    <div className={`workspace_context_tabs${isCollapsed ? ' is-collapsed' : ''}`} role="tablist" aria-label="Workspace context tabs">
      {contextTabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        const showTooltip = isCollapsed || !isActive;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`workspace-context-tab-${tab.id}`}
            aria-selected={isActive}
            aria-controls={tab.panelId}
            className={`workspace_context_tab_btn${isActive ? ' is-active' : ''}${showTooltip ? ' linkx_tooltip_anchor' : ''}`}
            data-tooltip={showTooltip ? tab.label : undefined}
            aria-label={tab.label}
            onClick={() => onSelectTab(tab.id)}
          >
            <Icon />
            {isActive && !isCollapsed && <span className="workspace_tab_label">{tab.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

export { contextTabs };
