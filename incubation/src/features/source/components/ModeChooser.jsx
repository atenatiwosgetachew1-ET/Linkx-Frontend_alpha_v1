import React, { useState } from 'react';
import { SOURCE_FLOW, SOURCE_FRAME_CLASS, SOURCE_RESTYLED } from '../lib/sourceFrame.js';

import { SOURCE_CONNECTIONS } from '../lib/sourceConnections.js';
import { SOURCE_MODES } from '../lib/sourceModel.js';
import { SessionBadge, SourceModeIcon, SourceWindowHeading } from './sourceUi.jsx';
import { SourceStartFlow } from './SourceStartFlow.jsx';

const CONNECTION_TYPES = ['upload', 'storage', 'broker', 'search'];
const INPUT_OPTIONS_TIP = 'Batch makes one dataframe from uploaded files, a storage search or an Elasticsearch search; live analyses events from a message broker as they arrive.';

// Glyphs for the labels over the options (24px grid, stroked).
const OPTION_ICONS = {
  // Data arriving: an arrow into a tray.
  mode: 'M12 3v11M7.5 9.5L12 14l4.5-4.5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4',
  // A plug.
  connection: 'M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v5',
  // Sliders.
  configure: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
};

// A step's options under a short label. With the restyle off
// (src/features/source/lib/sourceFrame.js), the options alone, as before.
function StepOptions({ icon, title, children }) {
  if (!SOURCE_RESTYLED) return children;
  return (
    <div className="source_window_choice">
      <h4 className="source_window_choice_title">
        <svg className="source_window_choice_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={OPTION_ICONS[icon]} /></svg>
        {title}
      </h4>
      {children}
    </div>
  );
}

// Reopens on the window's current input (initialMode / initialConnectionType)
// so Continue without changes keeps the existing connection.
export function ModeChooser({ sourceSessionId, initialMode, initialConnectionType, defaults = null, capacity = null, onSelectMode, onOpenConfiguration, onSetUpConnection, onCopySession }) {
  const [selectedInputMode, setSelectedInputMode] = useState(
    initialMode === SOURCE_MODES.REALTIME ? SOURCE_MODES.REALTIME : SOURCE_MODES.BATCH,
  );
  const [selectedConnectionType, setSelectedConnectionType] = useState(() => {
    if (initialMode === SOURCE_MODES.REALTIME) return 'broker';
    return CONNECTION_TYPES.includes(initialConnectionType) ? initialConnectionType : 'upload';
  });
  const selectableConnections = SOURCE_CONNECTIONS.map((option) => ({
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
    <div className={`source_window_choose${SOURCE_FRAME_CLASS}`}>
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

      {SOURCE_FLOW ? (
        <SourceStartFlow
          connections={selectableConnections}
          inputMode={selectedInputMode}
          connectionType={selectedConnectionType}
          onInputMode={handleInputModeChange}
          onConnection={setSelectedConnectionType}
          onOpenConfiguration={onOpenConfiguration}
          defaults={defaults}
          capacity={capacity}
          onSetUpConnection={onSetUpConnection}
        />
      ) : (
      <div className="source_window_choose_board">
        <div className="source_window_choose_step">
          <div className="source_window_choose_step_label">
            <span>1</span>
            <strong>Input mode</strong>
            <small>Select how your data will arrive.</small>
          </div>
          <StepOptions icon="mode" title="Choose input mode">
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
          </StepOptions>
        </div>

        <div className="source_window_choose_step">
          <div className="source_window_choose_step_label">
            <span>2</span>
            <strong>Connection type</strong>
            <small>Choose a source to connect your data.</small>
          </div>
          <StepOptions icon="connection" title="Choose connection type">
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
          </StepOptions>
        </div>

        <div className="source_window_choose_step">
          <div className="source_window_choose_step_label">
            <span>3</span>
            <strong>Configure</strong>
            <small>Set up your source connection.</small>
          </div>
          <StepOptions icon="configure" title="Configure connection">
            <button type="button" className="source_window_config_preview" onClick={onOpenConfiguration}>
              <SourceModeIcon type="configure" />
              <span>
                <strong>Open configuration</strong>
                <small>Optional. Use saved settings to prefill later source and tool connection fields.</small>
              </span>
            </button>
          </StepOptions>
        </div>
      </div>
      )}

      <footer className="source_window_choose_footer">
        {/* Not a link: what the choices mean, in the app's tooltip. */}
        <span className="linkx_tooltip_anchor" role="note" tabIndex={0} data-tooltip={INPUT_OPTIONS_TIP} aria-label={INPUT_OPTIONS_TIP}>
          <svg className="window_footer_info_icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          Learn more about data input options
        </span>
        <div>
          {/* The first page: nothing to go back to. */}
          <button type="button" onClick={() => onSelectMode(selectedInputMode, selectedConnectionType)}>Continue</button>
        </div>
      </footer>
    </div>
  );
}
