import React from 'react';
import { contextTabs } from './WorkspaceContextTabs.jsx';

export default function WorkspaceRightCollapsedRail({ activeTab, onSelectTab, onExpand, isPanelDisabled = false, disabledTabs = [] }) {
  return (
    <nav className={`workspace_right_collapsed_rail${isPanelDisabled ? ' is-disabled' : ''}`} aria-label="Right workspace navigation rail">
      {/* Main Tab Navigation Icons */}
      <div className="workspace_collapsed_rail_main" role="tablist" aria-label="Collapsed workspace tabs">
        {contextTabs.map((tab) => {
          const Icon = tab.icon;
          const isTabDisabled = isPanelDisabled || disabledTabs.includes(tab.id);
          
          let tooltipText = tab.tooltip || tab.label;
          if (isPanelDisabled) {
            tooltipText = `${tab.tooltip || tab.label} (Disabled)`;
          } else if (isTabDisabled) {
            tooltipText = `${tab.tooltip || tab.label} (Requires Graph or Chart active window)`;
          }

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`workspace-collapsed-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-disabled={isTabDisabled}
              disabled={isTabDisabled}
              aria-controls={tab.panelId}
              className={`workspace_collapsed_rail_btn${isTabDisabled ? ' is-disabled' : ''} linkx_tooltip_anchor`}
              data-tooltip={tooltipText}
              aria-label={tooltipText}
              onClick={() => {
                if (!isTabDisabled) {
                  onSelectTab(tab.id);
                }
              }}
            >
              <Icon />
            </button>
          );
        })}
      </div>
    </nav>
  );
}
