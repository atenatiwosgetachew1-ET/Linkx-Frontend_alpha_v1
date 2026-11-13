import React, { useState } from 'react';

import { SOURCE_MODES } from '../lib/sourceModel.js';
import { SessionBadge, SourceModeIcon, SourceWindowHeading } from './sourceUi.jsx';

const CONNECTION_TYPES = ['upload', 'storage', 'broker', 'search'];

// Reopens on the window's current input (initialMode / initialConnectionType)
// so Continue without changes keeps the existing connection.
export function ModeChooser({ sourceSessionId, initialMode, initialConnectionType, onSelectMode, onOpenConfiguration, onCopySession }) {
  const [selectedInputMode, setSelectedInputMode] = useState(
    initialMode === SOURCE_MODES.REALTIME ? SOURCE_MODES.REALTIME : SOURCE_MODES.BATCH,
  );
  const [selectedConnectionType, setSelectedConnectionType] = useState(() => {
    if (initialMode === SOURCE_MODES.REALTIME) return 'broker';
    return CONNECTION_TYPES.includes(initialConnectionType) ? initialConnectionType : 'upload';
  });
  const connectionOptions = [
    { id: 'upload', label: 'Upload file', badge: 'Upload local files', icon: 'upload' },
    { id: 'storage', label: 'Storage', badge: 'HDFS · Apache Hive · ClickHouse', icon: 'hadoop' },
    { id: 'broker', label: 'Message broker', badge: 'Apache Kafka · REST API', icon: 'kafka' },
    { id: 'search', label: 'Elasticsearch', badge: 'Hybrid search (Elasticsearch + Hive)', icon: 'elastic' },
    { id: 'cloud', label: 'Cloud dataset', badge: 'Coming soon', icon: 'cloud', disabled: true },
  ];
  const selectableConnections = connectionOptions.map((option) => ({
    ...option,
    disabled: option.disabled || (selectedInputMode === SOURCE_MODES.REALTIME && option.id !== 'broker'),
  }));

  const handleInputModeChange = (mode) => {
    setSelectedInputMode(mode);
    if (mode === SOURCE_MODES.REALTIME) {
      setSelectedConnectionType('broker');
    }
  };

  return (
    <div className="source_window_choose">
      <header className="source_window_choose_header">
        <SourceWindowHeading
          icon="source"
          title="Analysis Source"
          subtitle="Choose how data enters this workspace. You can change settings later."
          tags={[{ label: 'Setup' }]}
        >
          <SessionBadge sessionId={sourceSessionId} onCopySession={onCopySession} />
        </SourceWindowHeading>
      </header>

      <div className="source_window_choose_board">
        <div className="source_window_choose_step">
          <div className="source_window_choose_step_label">
            <span>1</span>
            <strong>Input mode</strong>
            <small>Select how your data will arrive.</small>
          </div>
          <div className="source_window_mode_grid source_window_input_mode_grid" role="group" aria-label="Input mode">
            <button
              type="button"
              className={selectedInputMode === SOURCE_MODES.BATCH ? 'is-selected' : ''}
              aria-pressed={selectedInputMode === SOURCE_MODES.BATCH}
              onClick={() => handleInputModeChange(SOURCE_MODES.BATCH)}
            >
              <SourceModeIcon type="batch" />
              <span>
                <strong>Batch / historical data</strong>
                <small>Import, search, or load data in batches. Best for historical data.</small>
              </span>
            </button>
            <button
              type="button"
              className={selectedInputMode === SOURCE_MODES.REALTIME ? 'is-selected' : ''}
              aria-pressed={selectedInputMode === SOURCE_MODES.REALTIME}
              onClick={() => handleInputModeChange(SOURCE_MODES.REALTIME)}
            >
              <SourceModeIcon type="realtime" />
              <span>
                <strong>Live / streaming data</strong>
                <small>Ingest events in real time from APIs, brokers, or streaming sources.</small>
              </span>
            </button>
          </div>
        </div>

        <div className="source_window_choose_step">
          <div className="source_window_choose_step_label">
            <span>2</span>
            <strong>Connection type</strong>
            <small>Choose a source to connect your data.</small>
          </div>
          <div className="source_window_connection_grid" role="group" aria-label="Connection type">
            {selectableConnections.map((option) => (
              <button
                key={option.id}
                type="button"
                className={selectedConnectionType === option.id ? 'is-selected' : ''}
                aria-pressed={selectedConnectionType === option.id}
                disabled={option.disabled}
                onClick={() => setSelectedConnectionType(option.id)}
              >
                <SourceModeIcon type={option.icon} />
                <strong>{option.label}</strong>
                {option.badge && <small>{option.badge}</small>}
              </button>
            ))}
          </div>
        </div>

        <div className="source_window_choose_step">
          <div className="source_window_choose_step_label">
            <span>3</span>
            <strong>Configure</strong>
            <small>Set up your source connection.</small>
          </div>
          <button type="button" className="source_window_config_preview" onClick={onOpenConfiguration}>
            <SourceModeIcon type="configure" />
            <span>
              <strong>Open configuration</strong>
              <small>Optional. Use saved settings to prefill later source and tool connection fields.</small>
            </span>
          </button>
        </div>
      </div>

      <footer className="source_window_choose_footer">
        <span>
          <svg className="window_footer_info_icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          Learn more about data input options
        </span>
        <div>
          <button type="button" disabled>Back</button>
          <button type="button" onClick={() => onSelectMode(selectedInputMode, selectedConnectionType)}>Continue</button>
        </div>
      </footer>
    </div>
  );
}
