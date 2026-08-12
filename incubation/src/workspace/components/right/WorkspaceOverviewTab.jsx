import React, { useState } from 'react';

function ChevronIcon({ isCollapsed }) {
  return (
    <svg className={`workspace_section_chevron${isCollapsed ? ' is-collapsed' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function SectionHeader({ title, isCollapsed, onToggle }) {
  return (
    <div className="workspace_section_header" onClick={onToggle}>
      <h2>{title}</h2>
      <button
        type="button"
        className="workspace_section_toggle_btn linkx_tooltip_anchor"
        data-tooltip={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
        aria-label={isCollapsed ? `Expand ${title}` : `Collapse ${title}`}
        aria-expanded={!isCollapsed}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <ChevronIcon isCollapsed={isCollapsed} />
      </button>
    </div>
  );
}

export default function WorkspaceOverviewTab({ displayName, workspace, onSwitchTab }) {
  const [collapsedSections, setCollapsedSections] = useState({
    session: false,
    workspace: false,
    activity: false,
    assistantReview: false,
  });

  const toggleSection = (sectionKey) => {
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionKey]: !prev[sectionKey],
    }));
  };

  const workspaceStats = [
    ['Open windows', String(workspace?.windows?.length || 0)],
    ['Active window', workspace?.activeWindow?.title || 'None'],
    ['Context tab', workspace?.contextTab || 'overview'],
  ];

  return (
    <div className="workspace_context_overview_wrapper">
      {/* Session Status Section */}
      <section className={`workspace_context_section${collapsedSections.session ? ' is-collapsed' : ''}`} aria-label="Session status">
        <SectionHeader
          title="Session"
          isCollapsed={collapsedSections.session}
          onToggle={() => toggleSection('session')}
        />
        <div className="workspace_section_body">
          <dl className="workspace_context_pairs">
            <div>
              <dt>Signed in as</dt>
              <dd>{displayName}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <span className="workspace_context_status">Active</span>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* Workspace Telemetry Metrics Section */}
      <section className={`workspace_context_section${collapsedSections.workspace ? ' is-collapsed' : ''}`} aria-label="Workspace summary">
        <SectionHeader
          title="Workspace"
          isCollapsed={collapsedSections.workspace}
          onToggle={() => toggleSection('workspace')}
        />
        <div className="workspace_section_body">
          <dl className="workspace_context_pairs">
            {workspaceStats.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Recent Activity Log Section */}
      <section className={`workspace_context_section${collapsedSections.activity ? ' is-collapsed' : ''}`} aria-label="Recent activity">
        <SectionHeader
          title="Activity"
          isCollapsed={collapsedSections.activity}
          onToggle={() => toggleSection('activity')}
        />
        <div className="workspace_section_body">
          <p className="workspace_context_empty">No activity yet</p>
        </div>
      </section>

      {/* Executive Assistant Graph Review Summary Card */}
      <section className="workspace_context_section workspace_assistant_review_card" aria-label="Assistant review summary">
        <div className="workspace_assistant_header">
          <h2>Assistant Review</h2>
          <div className="workspace_assistant_actions">
            <button
              type="button"
              className="workspace_assistant_action_btn linkx_tooltip_anchor"
              data-tooltip="Open Assistant Chat Tab"
              aria-label="Open Assistant Chat Tab"
              onClick={() => onSwitchTab?.('assistant')}
            >
              <svg className="workspace_assistant_icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </button>
          </div>
        </div>

        <div className="workspace_section_body">
          <div className="workspace_assistant_summary_content">
            <div className="workspace_assistant_summary_badge">
              <span className="workspace_context_status">Review Ready</span>
            </div>
            <p className="workspace_assistant_summary_text">
              <strong>Executive Graph Review:</strong> 65 entity nodes mapped across 4 community clusters. 0 critical telemetry anomalies detected.
            </p>
            <div className="workspace_assistant_summary_key_finding">
              <span className="workspace_assistant_finding_label">Key Observation:</span>
              <span className="workspace_assistant_finding_val">Node #12 ("Main Gateway") identified as primary degree centrality bottleneck.</span>
            </div>
            <button
              type="button"
              className="workspace_assistant_review_btn"
              onClick={() => onSwitchTab?.('assistant')}
            >
              Open Full Assistant Chat →
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
