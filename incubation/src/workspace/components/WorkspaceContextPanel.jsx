import React, { useEffect, useState } from 'react';
import { useTheme } from '../../shared/theme/ThemeContext.jsx';
import { useBackgroundAnimations } from '../../utils/backgroundAnimations.js';

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

function WorkspaceSettingsPanel() {
  const { theme, setTheme, themes } = useTheme();
  const { areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled } = useBackgroundAnimations();

  return (
    <div className="workspace_context_settings_wrapper">
      <section className="workspace_context_section" aria-label="Theme settings">
        <h2>Appearance & Theme</h2>
        <div className="workspace_theme_picker_grid">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`workspace_theme_option ${theme === t.id ? 'is-selected' : ''}`}
              onClick={() => setTheme(t.id)}
            >
              <div className="workspace_theme_preview_header">
                <span className="workspace_theme_color_badge" style={{ backgroundColor: t.previewColor }} />
                <span className="workspace_theme_name">{t.name}</span>
                {theme === t.id && <span className="workspace_theme_active_badge">Active</span>}
              </div>
              <small className="workspace_theme_desc">{t.description}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="workspace_context_section" aria-label="Visual effects settings">
        <h2>Visual Effects</h2>
        <div className="workspace_context_form_stack">
          <label className="workspace_context_switch">
            <input
              type="checkbox"
              checked={areBackgroundAnimationsEnabled}
              onChange={(e) => setBackgroundAnimationsEnabled(e.target.checked)}
            />
            <span>Background Motion Effects</span>
          </label>
        </div>
      </section>

      <section className="workspace_context_section" aria-label="Graph settings">
        <h2>Graph Settings</h2>
        <div className="workspace_context_form_stack">
          <label className="workspace_context_switch">
            <input type="checkbox" disabled />
            <span>Show node labels</span>
          </label>
          <label className="workspace_context_switch">
            <input type="checkbox" disabled />
            <span>Enable graph physics</span>
          </label>
          <label>
            <span>Layout algorithm</span>
            <select disabled defaultValue="directed">
              <option value="directed">Force Directed</option>
            </select>
          </label>
        </div>
      </section>
    </div>
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
        {activeTab === 'settings' && <WorkspaceSettingsPanel />}
      </div>
    </div>
  );
}
