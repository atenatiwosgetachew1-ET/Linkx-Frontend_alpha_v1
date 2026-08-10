import React, { useState } from 'react';

export default function WorkspaceOverviewTab({ displayName, workspace }) {
  const [message, setMessage] = useState('');
  const [isAssistantResponding] = useState(false);

  const workspaceStats = [
    ['Open windows', String(workspace?.windows?.length || 0)],
    ['Active window', workspace?.activeWindow?.title || 'None'],
    ['Context tab', workspace?.contextTab || 'overview'],
  ];

  const trimmedMessage = message.trim();
  const isSubmitDisabled = !trimmedMessage || isAssistantResponding;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (isSubmitDisabled) return;
    setMessage('');
  };

  return (
    <div className="workspace_context_overview_wrapper">
      {/* Session Status Section */}
      <section className="workspace_context_section" aria-label="Session status">
        <h2>Session</h2>
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
      </section>

      {/* Workspace Telemetry Metrics Section */}
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

      {/* Recent Activity Log Section */}
      <section className="workspace_context_section" aria-label="Recent activity">
        <h2>Activity</h2>
        <p className="workspace_context_empty">No activity yet</p>
      </section>

      {/* AI Assistant Chat Section */}
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
          <button
            type="submit"
            className="linkx_tooltip_anchor"
            data-tooltip="Send message"
            disabled={isSubmitDisabled}
            aria-label="Send message"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M5 12h13m0 0-5-5m5 5-5 5" />
            </svg>
          </button>
        </form>
      </section>
    </div>
  );
}
