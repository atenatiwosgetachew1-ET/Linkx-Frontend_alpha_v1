import React, { useEffect, useState } from 'react';

const contextTabs = [
  { id: 'overview', label: 'Overview', panelId: 'workspace-context-overview' },
  { id: 'info', label: 'Info', panelId: 'workspace-context-info' },
  { id: 'filter', label: 'Filter', panelId: 'workspace-context-filter' },
  { id: 'settings', label: 'Settings', panelId: 'workspace-context-settings' },
];

function GraphInfoPanel() {
  return (
    <section className="workspace_context_section" aria-label="Graph information">
      <h2>Graph info</h2>
      <dl className="workspace_context_pairs">
        <div>
          <dt>Selected graph</dt>
          <dd>None</dd>
        </div>
        <div>
          <dt>Nodes</dt>
          <dd>0</dd>
        </div>
        <div>
          <dt>Edges</dt>
          <dd>0</dd>
        </div>
      </dl>
    </section>
  );
}

function GraphFilterPanel() {
  return (
    <section className="workspace_context_section" aria-label="Graph filters">
      <h2>Graph filters</h2>
      <div className="workspace_context_form_stack">
        <label>
          <span>Property</span>
          <input type="text" placeholder="Select a graph first" disabled />
        </label>
        <label>
          <span>Condition</span>
          <select disabled defaultValue="contains">
            <option value="contains">Contains</option>
          </select>
        </label>
        <button type="button" disabled>Apply filter</button>
      </div>
    </section>
  );
}

function GraphSettingsPanel() {
  return (
    <section className="workspace_context_section" aria-label="Graph settings">
      <h2>Graph settings</h2>
      <div className="workspace_context_form_stack">
        <label className="workspace_context_switch">
          <input type="checkbox" disabled />
          <span>Show labels</span>
        </label>
        <label className="workspace_context_switch">
          <input type="checkbox" disabled />
          <span>Graph physics</span>
        </label>
        <label>
          <span>Layout</span>
          <select disabled defaultValue="directed">
            <option value="directed">Directed</option>
          </select>
        </label>
      </div>
    </section>
  );
}

export default function WorkspaceContextPanel({ displayName, workspace }) {
  const [activeTab, setActiveTab] = useState('overview');
  const [message, setMessage] = useState('');
  const [isAssistantResponding] = useState(false);
  const activeTabConfig = contextTabs.find((tab) => tab.id === activeTab) || contextTabs[0];
  const workspaceStats = [
    ['Open windows', String(workspace?.windows?.length || 0)],
    ['Active window', workspace?.activeWindow?.title || 'None'],
    ['Context tab', workspace?.contextTab || 'overview'],
  ];
  const trimmedMessage = message.trim();

  useEffect(() => {
    if (!workspace?.contextTab || workspace.contextTab === activeTab) return;
    setActiveTab(workspace.contextTab);
  }, [activeTab, workspace?.contextTab]);
  const isSubmitDisabled = !trimmedMessage || isAssistantResponding;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isSubmitDisabled) return;
    setMessage('');
  };

  return (
    <div className="workspace_context_panel" aria-label="Workspace status">
      <div className="workspace_context_tabs" role="tablist" aria-label="Workspace context tabs">
        {contextTabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`workspace-context-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={tab.panelId}
            className={activeTab === tab.id ? 'is-active' : ''}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div
        id={activeTabConfig.panelId}
        className="workspace_context_tab_body"
        role="tabpanel"
        aria-labelledby={`workspace-context-tab-${activeTabConfig.id}`}
      >
        {activeTab === 'overview' && (
          <>
            <section className="workspace_context_section" aria-label="Session status">
              <h2>Session</h2>
              <dl className="workspace_context_pairs">
                <div>
                  <dt>Signed in as</dt>
                  <dd>{displayName}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd><span className="workspace_context_status">Active</span></dd>
                </div>
              </dl>
            </section>

            <section className="workspace_context_section" aria-label="Workspace summary">
              <h2>Workspace</h2>
              <dl className="workspace_context_pairs">
                {workspaceStats.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <section className="workspace_context_section" aria-label="Recent activity">
              <h2>Activity</h2>
              <p className="workspace_context_empty">No activity yet</p>
            </section>

            <section className="workspace_context_section workspace_context_chat" aria-label="Assistant chat">
              <h2>Assistant</h2>
              <div className="workspace_context_chat_body">
                <p>Ask about the current workspace when chat is enabled.</p>
              </div>
              <form className="workspace_context_chat_form" aria-label="Assistant message" onSubmit={handleSubmit}>
                <input
                  type="text"
                  value={message}
                  placeholder="Message assistant"
                  disabled={isAssistantResponding}
                  onChange={(event) => setMessage(event.target.value)}
                />
                <button type="submit" className="linkx_tooltip_anchor" data-tooltip="Send message" disabled={isSubmitDisabled} aria-label="Send message">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path d="M5 12h13m0 0-5-5m5 5-5 5" />
                  </svg>
                </button>
              </form>
            </section>
          </>
        )}
        {activeTab === 'info' && <GraphInfoPanel />}
        {activeTab === 'filter' && <GraphFilterPanel />}
        {activeTab === 'settings' && <GraphSettingsPanel />}
      </div>
    </div>
  );
}
