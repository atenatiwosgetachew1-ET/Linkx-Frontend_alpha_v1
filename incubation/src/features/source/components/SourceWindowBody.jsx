import React, { useMemo, useState } from 'react';

import { useAuth } from '../../../auth/useAuth.js';
import { appConfig } from '../../../app/config.js';
import {
  connectSource,
  connectTool,
  disconnectSource,
  disconnectTool,
} from '../../../services/sourceApi.js';
import {
  compactValidationErrors,
  sanitizeConnectionValue,
  sanitizeIdentifier,
  sanitizeKafkaTopic,
  sanitizeSecret,
  sanitizeText,
  validateConnectionValue,
  validateKafkaTopic,
} from '../../../utils/inputSecurity.js';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';

const SOURCE_MODES = {
  CHOOSE: 'choose',
  BATCH: 'batch',
  REALTIME: 'realtime',
};

const BATCH_TIMELINE_STEPS = [
  { id: 'upload', label: 'Upload', value: 'Select source files' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

const BATCH_STORAGE_TIMELINE_STEPS = [
  { id: 'upload', label: 'Storage', value: 'Connect table or path' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

const BATCH_BROKER_TIMELINE_STEPS = [
  { id: 'upload', label: 'Broker', value: 'Connect message source' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

const BATCH_SEARCH_TIMELINE_STEPS = [
  { id: 'upload', label: 'Search', value: 'Find source files' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

const REALTIME_TIMELINE_STEPS = [
  { id: 'connect', label: 'Connect', value: 'Broker/API and tool' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

const SOURCE_STATUSES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
  UPLOADED: 'uploaded',
};

const TOOL_STATUSES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
};

const STREAM_STATUSES = {
  IDLE: 'idle',
  RUNNING: 'running',
};

const UPLOAD_LIMITS = Object.freeze({
  maxFiles: 10,
  maxFileSizeBytes: 100 * 1024 * 1024,
  maxTotalSizeBytes: 250 * 1024 * 1024,
  allowedExtensions: new Set(['csv', 'json', 'parquet', 'xlsx', 'xls', 'txt', 'zip']),
});

const uploadAcceptValue = Array.from(UPLOAD_LIMITS.allowedExtensions).map((extension) => '.' + extension).join(',');

const formatBytes = (value) => {
  if (value >= 1024 * 1024) return Math.round(value / (1024 * 1024)) + ' MB';
  if (value >= 1024) return Math.round(value / 1024) + ' KB';
  return value + ' bytes';
};

const modeLabels = {
  [SOURCE_MODES.BATCH]: 'Batch input',
  [SOURCE_MODES.REALTIME]: 'Real-time input',
};

const defaultSourceState = {
  mode: SOURCE_MODES.CHOOSE,
  batch: {
    step: 'upload',
    selectedConnectionType: 'upload',
    sourceAddressType: 'broker',
    brokerAddress: '',
    topic: '',
    storageAddress: '',
    storageUseDefault: true,
    storageType: 'hdfs',
    storagePort: '',
    storageDatabase: '',
    storagePath: '',
    storageTable: '',
    storageSearchQuery: '',
    storageSearchStatus: 'idle',
    storageDateFrom: '',
    storageDateTo: '',
    selectedStorageFiles: [],
    sourceStatus: SOURCE_STATUSES.IDLE,
    sourceMessage: 'Not connected.',
    toolStatus: TOOL_STATUSES.IDLE,
    toolMessage: 'Not connected.',
    selectedFiles: [],
    searchQuery: '',
    searchDate: '',
    searchMode: 'raw',
    dataframeAction: '',
    sourceColumn: '',
    targetColumn: '',
    relationship: '',
    rule: '',
    toolUrl: '',
    toolUsername: '',
    toolPassword: '',
    toolDatabase: '',
    streamStatus: STREAM_STATUSES.IDLE,
  },
  realtime: {
    step: 'connect',
    sourceAddressType: 'broker',
    brokerAddress: '',
    topic: '',
    sourceStatus: SOURCE_STATUSES.IDLE,
    sourceMessage: 'Not connected.',
    toolStatus: TOOL_STATUSES.IDLE,
    toolMessage: 'Not connected.',
    dataframeAction: '',
    sourceColumn: '',
    targetColumn: '',
    relationship: '',
    rule: '',
    toolUrl: '',
    toolUsername: '',
    toolPassword: '',
    toolDatabase: '',
    streamStatus: STREAM_STATUSES.IDLE,
  },
  upload: {
    selectedFiles: [],
    status: 'idle',
  },
};

const mergeSourceState = (sourceState = {}) => ({
  ...defaultSourceState,
  ...sourceState,
  batch: { ...defaultSourceState.batch, ...(sourceState.batch || {}) },
  realtime: { ...defaultSourceState.realtime, ...(sourceState.realtime || {}) },
  upload: { ...defaultSourceState.upload, ...(sourceState.upload || {}) },
});

const sourceStatusFromMessage = (message) => {
  if (message === 'Connection established!' || message === 'success') return SOURCE_STATUSES.CONNECTED;
  if (message === 'Disconnected!') return SOURCE_STATUSES.DISCONNECTED;
  if (String(message || '').toLowerCase().includes('failed')) return SOURCE_STATUSES.FAILED;
  return SOURCE_STATUSES.IDLE;
};

const toolStatusFromMessage = (message) => {
  if (message === 'Connected!' || message === 'Connection established!' || message === 'success') return TOOL_STATUSES.CONNECTED;
  if (message === 'Disconnected!') return TOOL_STATUSES.DISCONNECTED;
  if (String(message || '').toLowerCase().includes('failed')) return TOOL_STATUSES.FAILED;
  return TOOL_STATUSES.IDLE;
};

const displaySourceMessage = (status) => {
  if (status === SOURCE_STATUSES.CONNECTING) return 'Connecting...';
  if (status === SOURCE_STATUSES.CONNECTED) return 'Connection established.';
  if (status === SOURCE_STATUSES.DISCONNECTING) return 'Disconnecting...';
  if (status === SOURCE_STATUSES.DISCONNECTED) return 'Disconnected.';
  if (status === SOURCE_STATUSES.FAILED) return 'Connection failed. Please check the values and try again.';
  return 'Not connected.';
};

const displayToolMessage = (status) => {
  if (status === TOOL_STATUSES.CONNECTING) return 'Connecting...';
  if (status === TOOL_STATUSES.CONNECTED) return 'Connected.';
  if (status === TOOL_STATUSES.DISCONNECTING) return 'Disconnecting...';
  if (status === TOOL_STATUSES.DISCONNECTED) return 'Disconnected.';
  if (status === TOOL_STATUSES.FAILED) return 'Connection failed. Please check the values and try again.';
  return 'Not connected.';
};

const isSourceBusy = (state) => [SOURCE_STATUSES.CONNECTING, SOURCE_STATUSES.DISCONNECTING].includes(state.sourceStatus);
const isToolBusy = (state) => [TOOL_STATUSES.CONNECTING, TOOL_STATUSES.DISCONNECTING].includes(state.toolStatus);
const isSourceReady = (state) => state.sourceStatus === SOURCE_STATUSES.CONNECTED || state.sourceStatus === SOURCE_STATUSES.UPLOADED;
const isToolReady = (state) => state.toolStatus === TOOL_STATUSES.CONNECTED;

const canStream = (state) => {
  if (state.dataframeAction === 'Store data') return true;
  if (state.dataframeAction === 'Source / Target Mapping') return Boolean(state.sourceColumn && state.targetColumn);
  if (state.dataframeAction === 'Link Analysis') return Boolean(state.rule);
  return false;
};

const getWorkflowSteps = (mode, state) => {
  if (mode === SOURCE_MODES.REALTIME) return REALTIME_TIMELINE_STEPS;
  if (state.selectedConnectionType === 'storage') return BATCH_STORAGE_TIMELINE_STEPS;
  if (state.selectedConnectionType === 'broker') return BATCH_BROKER_TIMELINE_STEPS;
  if (state.selectedConnectionType === 'search') return BATCH_SEARCH_TIMELINE_STEPS;
  return BATCH_TIMELINE_STEPS;
};

const getAccessibleSteps = (mode, state) => {
  if (mode === SOURCE_MODES.BATCH) {
    const steps = new Set(['upload']);
    if ((state.selectedFiles || []).length > 0 || isSourceReady(state)) steps.add('dataframe');
    if (steps.has('dataframe') && canStream(state)) steps.add('stream');
    if (state.streamStatus === STREAM_STATUSES.RUNNING) steps.add('stream');
    return steps;
  }

  const steps = new Set(['connect']);
  if (isSourceReady(state) && isToolReady(state)) steps.add('dataframe');
  if (steps.has('dataframe') && canStream(state)) steps.add('stream');
  if (state.streamStatus === STREAM_STATUSES.RUNNING) steps.add('stream');
  return steps;
};

const normalizeWindowSessionId = (windowItem) => String(windowItem.sourceSessionId || '').trim();

function SourceModeIcon({ type }) {
  const icons = {
    source: (
      <>
        <path d="M7 7h4" />
        <path d="M13 7h4" />
        <path d="M9 3v4" />
        <path d="M15 3v4" />
        <path d="M8 17h8a3 3 0 0 0 3-3V9H5v5a3 3 0 0 0 3 3Z" />
        <path d="M12 17v4" />
      </>
    ),
    batch: (
      <>
        <ellipse cx="12" cy="6" rx="6.5" ry="2.7" />
        <path d="M5.5 6v5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7V6" />
        <path d="M5.5 11v5c0 1.5 2.9 2.7 6.5 2.7s6.5-1.2 6.5-2.7v-5" />
      </>
    ),
    realtime: (
      <>
        <path d="M6.5 16.5a7.8 7.8 0 0 1 0-9" />
        <path d="M9.5 14a3.9 3.9 0 0 1 0-4" />
        <path d="M17.5 7.5a7.8 7.8 0 0 1 0 9" />
        <path d="M14.5 10a3.9 3.9 0 0 1 0 4" />
        <circle cx="12" cy="12" r="1.6" />
      </>
    ),
    upload: (
      <>
        <path d="M12 15V4" />
        <path d="M8 8l4-4 4 4" />
        <path d="M5 16v2.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V16" />
      </>
    ),
    storage: (
      <>
        <path d="M3.5 6.5h6.2l2.1 2.2h8.7v9.8h-17z" />
        <path d="M3.5 10h17" />
      </>
    ),
    broker: (
      <>
        <circle cx="6" cy="7" r="2.4" />
        <circle cx="18" cy="7" r="2.4" />
        <circle cx="12" cy="18" r="2.4" />
        <path d="M8.1 8.3l2.9 7.4" />
        <path d="M15.9 8.3l-2.9 7.4" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.2" />
        <path d="M15.1 15.1 20 20" />
      </>
    ),
    cloud: (
      <>
        <path d="M7.2 18h9.8a4 4 0 0 0 .2-8 5.8 5.8 0 0 0-11.1-1.9A4.9 4.9 0 0 0 7.2 18Z" />
      </>
    ),
    configure: (
      <>
        <path d="M4 7h7" />
        <path d="M15 7h5" />
        <circle cx="13" cy="7" r="2" />
        <path d="M4 12h3" />
        <path d="M11 12h9" />
        <circle cx="9" cy="12" r="2" />
        <path d="M4 17h9" />
        <path d="M17 17h3" />
        <circle cx="15" cy="17" r="2" />
      </>
    ),
    table: (
      <>
        <rect x="4" y="4" width="16" height="16" rx="1.8" />
        <path d="M4 9h16" />
        <path d="M4 14h16" />
        <path d="M9 4v16" />
        <path d="M15 4v16" />
      </>
    ),
    tool: (
      <>
        <path d="M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z" />
      </>
    ),
    bolt: (
      <>
        <path d="M13 2 5 13h6l-1 9 8-12h-6z" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="11" height="11" rx="1.8" />
        <path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1" />
      </>
    ),
    clear: (
      <>
        <path d="M6 6l12 12" />
        <path d="M18 6 6 18" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.3" />
        <path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 0 0 7.1 7.1l.8-.8" />
      </>
    ),
  };

  return (
    <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {icons[type] || icons.batch}
    </svg>
  );
}

function StatusPill({ label, status = 'idle' }) {
  return (
    <span className={'source_window_status_pill is-' + status}>
      <span>{label}</span>
      <strong>{status.replace('-', ' ')}</strong>
    </span>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={'source_window_field' + (className ? ' ' + className : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function DataframeField({ label, icon = 'table', children }) {
  return (
    <label className="source_window_field source_window_dataframe_field">
      <span className="source_window_dataframe_field_label">
        <SourceModeIcon type={icon} />
        <strong>{label}</strong>
        <i aria-hidden="true">?</i>
      </span>
      {children}
    </label>
  );
}

function SessionBadge({ sessionId, onCopySession }) {
  const displaySessionId = sessionId || 'Pending';

  return (
    <dl>
      <div className="source_window_session_chip">
        <dt>Session</dt>
        <dd>{displaySessionId}</dd>
        <span className="source_window_session_actions">
          <button
            type="button"
            aria-label="Copy window ID"
            className="source_window_tooltip_anchor"
            data-tooltip="Copy window ID"
            disabled={!sessionId}
            onClick={() => onCopySession(sessionId)}
          >
            <SourceModeIcon type="copy" />
          </button>
          <button
            type="button"
            aria-label="Link to Graph Window"
            className="source_window_tooltip_anchor"
            data-tooltip="Link to Graph Window"
            disabled
          >
            <SourceModeIcon type="link" />
          </button>
        </span>
      </div>
    </dl>
  );
}


function WorkflowTimeline({ activeStep, steps, accessibleSteps, onStepChange }) {
  return (
    <aside className="source_window_timeline" aria-label="Source workflow timeline">
      {steps.map((step, index) => {
        const isLocked = !accessibleSteps.has(step.id);
        return (
          <button
            key={step.id}
            type="button"
            className={(activeStep === step.id ? 'is-active' : '') + (isLocked ? ' is-locked' : '')}
            disabled={isLocked}
            onClick={() => onStepChange(step.id)}
          >
            <span>{index + 1}</span>
            <strong>{step.label}</strong>
            <small>{step.value}</small>
          </button>
        );
      })}
    </aside>
  );
}

function ModeChooser({ sourceSessionId, onSelectMode, onOpenConfiguration, onCopySession }) {
  const [selectedInputMode, setSelectedInputMode] = useState(SOURCE_MODES.BATCH);
  const [selectedConnectionType, setSelectedConnectionType] = useState('upload');
  const connectionOptions = [
    { id: 'upload', label: 'Upload file', badge: 'Recommended', icon: 'upload' },
    { id: 'storage', label: 'Storage', icon: 'storage' },
    { id: 'broker', label: 'Message broker', icon: 'broker' },
    { id: 'search', label: 'Elastic Search', icon: 'search' },
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
        <SourceModeIcon type="source" />
        <div>
          <h2>Analysis Source</h2>
          <p>Choose how data enters this workspace. You can change settings later.</p>
          <SessionBadge sessionId={sourceSessionId} onCopySession={onCopySession} />
        </div>
      </header>

      <div className="source_window_choose_board">
        <div className="source_window_choose_step">
          <div className="source_window_choose_step_label">
            <span>1</span>
            <strong>Input mode</strong>
            <small>Select how your data will arrive.</small>
          </div>
          <div className="source_window_mode_grid source_window_input_mode_grid">
            <button
              type="button"
              className={selectedInputMode === SOURCE_MODES.BATCH ? 'is-selected' : ''}
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
          <div className="source_window_connection_grid">
            {selectableConnections.map((option) => (
              <button
                key={option.id}
                type="button"
                className={selectedConnectionType === option.id ? 'is-selected' : ''}
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
        <span>Learn more about data input options</span>
        <div>
          <button type="button" disabled>Back</button>
          <button type="button" onClick={() => onSelectMode(selectedInputMode, selectedConnectionType)}>Continue</button>
        </div>
      </footer>
    </div>
  );
}

function ConnectStep({ mode, state, windowId, validationMessage, onPatchModeState, onSourceAction, onToolAction }) {
  const isRealtime = mode === SOURCE_MODES.REALTIME;
  const addressTypeName = 'source-address-type-' + windowId + '-' + mode;
  const sourceConnected = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  const toolConnected = state.toolStatus === TOOL_STATUSES.CONNECTED;
  const sourceDisabled = isSourceBusy(state) || state.streamStatus === STREAM_STATUSES.RUNNING;
  const toolDisabled = isToolBusy(state) || !isSourceReady(state) || state.streamStatus === STREAM_STATUSES.RUNNING;

  return (
    <div className="source_window_step_body">
      <section className="source_window_section">
        <header>
          <h3>{isRealtime ? 'Broker/API connection' : 'Source connection'}</h3>
          <StatusPill label="Source" status={state.sourceStatus} />
        </header>
        <p className="source_window_status_text">{state.sourceMessage || displaySourceMessage(state.sourceStatus)}</p>
        <div className="source_window_radio_group" role="radiogroup" aria-label="Source address type">
          <label>
            <input
              type="radio"
              name={addressTypeName}
              checked={state.sourceAddressType === 'broker'}
              disabled={sourceConnected || sourceDisabled}
              onChange={() => onPatchModeState({ sourceAddressType: 'broker' })}
            />
            <span>Kafka Broker</span>
          </label>
          <label>
            <input
              type="radio"
              name={addressTypeName}
              checked={state.sourceAddressType === 'api'}
              disabled={sourceConnected || sourceDisabled}
              onChange={() => onPatchModeState({ sourceAddressType: 'api' })}
            />
            <span>REST API</span>
          </label>
          {!isRealtime && (
            <label>
              <input
                type="radio"
                name={addressTypeName}
                checked={state.sourceAddressType === 'storage'}
                disabled={sourceConnected || sourceDisabled}
                onChange={() => onPatchModeState({ sourceAddressType: 'storage' })}
              />
              <span>Hadoop Cluster</span>
            </label>
          )}
        </div>
        <div className="source_window_form_grid">
          {state.sourceAddressType !== 'storage' && (
            <>
              <Field label="Broker/API address">
                <input
                  type="text"
                  value={state.brokerAddress}
                  placeholder="Enter Broker/API address"
                  disabled={sourceConnected || sourceDisabled}
                  onChange={(event) => onPatchModeState({ brokerAddress: sanitizeConnectionValue(event.target.value) })}
                />
              </Field>
              {state.sourceAddressType === 'broker' && (
                <Field label="Kafka topic">
                  <input
                    type="text"
                    value={state.topic}
                    placeholder="Enter Kafka topic"
                    disabled={sourceConnected || sourceDisabled}
                    onChange={(event) => onPatchModeState({ topic: sanitizeKafkaTopic(event.target.value) })}
                  />
                </Field>
              )}
            </>
          )}
          {!isRealtime && (
            <Field label="HDFS address">
              <input
                type="text"
                value={state.storageAddress}
                placeholder="Enter HDFS address"
                disabled={sourceConnected || sourceDisabled}
                onChange={(event) => onPatchModeState({ storageAddress: sanitizeConnectionValue(event.target.value) })}
              />
            </Field>
          )}
        </div>
        <div className="source_window_actions">
          <button type="button" disabled={sourceDisabled} onClick={onSourceAction}>
            {sourceConnected ? 'Disconnect source' : isSourceBusy(state) ? displaySourceMessage(state.sourceStatus) : 'Connect source'}
          </button>
        </div>
      </section>
      <section className="source_window_section">
        <header>
          <h3>Tool integration</h3>
          <StatusPill label="Tool" status={state.toolStatus} />
        </header>
        <p className="source_window_status_text">{state.toolMessage || displayToolMessage(state.toolStatus)}</p>
        <div className="source_window_form_grid">
          <Field label="Tool">
            <select defaultValue="neo4j" disabled>
              <option value="neo4j">Neo4j</option>
            </select>
          </Field>
          <Field label="URL">
            <input
              type="text"
              value={state.toolUrl}
              placeholder="neo4j://host:7687"
              disabled={toolConnected || toolDisabled}
              onChange={(event) => onPatchModeState({ toolUrl: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          <Field label="Username">
            <input
              type="text"
              value={state.toolUsername}
              placeholder="Username"
              disabled={toolConnected || toolDisabled}
              onChange={(event) => onPatchModeState({ toolUsername: sanitizeIdentifier(event.target.value) })}
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={state.toolPassword}
              placeholder="Password"
              disabled={toolConnected || toolDisabled}
              onChange={(event) => onPatchModeState({ toolPassword: sanitizeSecret(event.target.value) })}
            />
          </Field>
          <Field label="Database">
            <input
              type="text"
              value={state.toolDatabase}
              placeholder="Database name"
              disabled={toolConnected || toolDisabled}
              onChange={(event) => onPatchModeState({ toolDatabase: sanitizeIdentifier(event.target.value) })}
            />
          </Field>
        </div>
        <div className="source_window_actions">
          <button type="button" disabled={toolDisabled} onClick={onToolAction}>
            {toolConnected ? 'Disconnect tool' : isToolBusy(state) ? displayToolMessage(state.toolStatus) : 'Connect tool'}
          </button>
        </div>
        {validationMessage && <p className="source_window_validation" role="status">{validationMessage}</p>}
      </section>
    </div>
  );
}

function UploadStep({ state, onPatchModeState }) {
  const selectedFiles = state.selectedFiles || [];
  const [uploadError, setUploadError] = useState('');

  const applyFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    if (files.length > UPLOAD_LIMITS.maxFiles) {
      setUploadError('Select ' + UPLOAD_LIMITS.maxFiles + ' files or fewer.');
      return;
    }

    const totalSize = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (totalSize > UPLOAD_LIMITS.maxTotalSizeBytes) {
      setUploadError('Total staged upload size must be ' + formatBytes(UPLOAD_LIMITS.maxTotalSizeBytes) + ' or less.');
      return;
    }

    const rejectedFile = files.find((file) => {
      const fileName = String(file.name || '');
      const extension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
      return !UPLOAD_LIMITS.allowedExtensions.has(extension) || Number(file.size || 0) > UPLOAD_LIMITS.maxFileSizeBytes;
    });

    if (rejectedFile) {
      setUploadError('Only supported files up to ' + formatBytes(UPLOAD_LIMITS.maxFileSizeBytes) + ' each can be staged.');
      return;
    }

    const nextFiles = files
      .map((file) => sanitizeText(file.name, { maxLength: 160 }))
      .filter(Boolean);
    if (nextFiles.length === 0) return;
    setUploadError('');
    onPatchModeState({
      selectedFiles: nextFiles,
      sourceStatus: SOURCE_STATUSES.UPLOADED,
      sourceMessage: nextFiles.length === 1 ? '1 file staged for dataframe creation.' : nextFiles.length + ' files staged for dataframe creation.',
    });
  };

  return (
    <div className="source_window_step_body source_window_step_body_single">
      <section className="source_window_section source_window_upload_page">
        <header>
          <h3>Upload source files</h3>
          <span className="source_window_hint">Drag and drop files, or browse from this workstation.</span>
        </header>
        <label
          className="source_window_upload_drop"
          htmlFor="source-window-upload-input"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            applyFiles(event.dataTransfer.files);
          }}
        >
          <input
            id="source-window-upload-input"
            type="file"
            multiple
            accept={uploadAcceptValue}
            onChange={(event) => applyFiles(event.target.files)}
          />
          <span className="source_window_upload_mark">
            <SourceModeIcon type="upload" />
          </span>
          <span className="source_window_upload_text">
            <strong>File upload</strong>
            <small>Drop source files here or browse to stage them for dataframe creation.</small>
          </span>
        </label>
        <div className="source_window_upload_summary">
          <strong>{selectedFiles.length ? selectedFiles.length + ' file(s) selected' : 'No files selected yet'}</strong>
          {uploadError && <p className="source_window_validation" role="status">{uploadError}</p>}
          {selectedFiles.length > 0 && (
            <ul>
              {selectedFiles.slice(0, 5).map((fileName) => <li key={fileName}>{fileName}</li>)}
            </ul>
          )}
        </div>

      </section>
    </div>
  );
}

function BrokerStep({ mode, state, windowId, validationMessage, onPatchModeState, onSourceAction }) {
  const addressTypeName = 'broker-source-address-type-' + windowId + '-' + mode;
  const sourceConnected = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  const sourceDisabled = isSourceBusy(state) || state.streamStatus === STREAM_STATUSES.RUNNING;
  const isBroker = state.sourceAddressType !== 'api';

  return (
    <div className="source_window_step_body source_window_step_body_broker">
      <section className="source_window_broker_panel">
        <header className="source_window_broker_header">
          <span className="source_window_panel_title">
            <SourceModeIcon type="broker" />
            <h3>Message broker</h3>
          </span>
          <StatusPill label="Source" status={state.sourceStatus} />
        </header>

        <div className="source_window_broker_summary">
          <p>{state.sourceMessage || displaySourceMessage(state.sourceStatus)}</p>
          <span>Connect a Kafka broker or compatible API before creating the dataframe.</span>
        </div>

        <div className="source_window_broker_type_group" role="radiogroup" aria-label="Broker source type">
          <label className={isBroker ? 'is-selected' : ''}>
            <input
              type="radio"
              name={addressTypeName}
              checked={isBroker}
              disabled={sourceConnected || sourceDisabled}
              onChange={() => onPatchModeState({ sourceAddressType: 'broker' })}
            />
            <SourceModeIcon type="broker" />
            <span>Kafka Broker</span>
          </label>
          <label className={!isBroker ? 'is-selected' : ''}>
            <input
              type="radio"
              name={addressTypeName}
              checked={!isBroker}
              disabled={sourceConnected || sourceDisabled}
              onChange={() => onPatchModeState({ sourceAddressType: 'api' })}
            />
            <SourceModeIcon type="source" />
            <span>REST API</span>
          </label>
        </div>

        <div className="source_window_broker_fields">
          <Field label={isBroker ? 'Broker address' : 'API address'}>
            <input
              type="text"
              value={state.brokerAddress}
              placeholder={isBroker ? 'Kafka / broker address' : 'REST API address'}
              disabled={sourceConnected || sourceDisabled}
              onChange={(event) => onPatchModeState({ brokerAddress: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          {isBroker && (
            <Field label="Kafka topic">
              <input
                type="text"
                value={state.topic}
                placeholder="Enter Kafka topic"
                disabled={sourceConnected || sourceDisabled}
                onChange={(event) => onPatchModeState({ topic: sanitizeKafkaTopic(event.target.value) })}
              />
            </Field>
          )}
          <button type="button" disabled={sourceDisabled} onClick={onSourceAction}>
            {sourceConnected ? 'Disconnect' : isSourceBusy(state) ? displaySourceMessage(state.sourceStatus) : 'Connect'}
          </button>
        </div>

        {validationMessage && <p className="source_window_validation" role="status">{validationMessage}</p>}

        <div className="source_window_broker_preview">
          <span />
          <p>No broker messages to show.</p>
        </div>
      </section>
    </div>
  );
}

function StorageStep({ state, onPatchModeState, onSourceAction }) {
  const selectedFiles = state.selectedStorageFiles || [];
  const storageUsesDefault = state.storageUseDefault !== false;
  const storageConnected = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  const storageBusy = isSourceBusy(state);
  const storageLoading = storageBusy || state.storageSearchStatus === 'loading';
  const storageEmptyMessage = storageLoading ? 'Loading...' : 'No files to show.';

  return (
    <div className="source_window_step_body source_window_step_body_storage">
      <section className="source_window_storage_browser">
        <header className="source_window_storage_browser_header">
          <div className="source_window_storage_title">
            <h3>Storage source</h3>
            <StatusPill label="Storage" status={state.sourceStatus} />
          </div>
          <div className="source_window_storage_type_buttons" role="group" aria-label="Storage source type">
            <button type="button" className="is-selected" onClick={() => onPatchModeState({ storageType: 'hdfs' })}>
              <SourceModeIcon type="storage" />
              <span>HDFS path</span>
            </button>
            <button type="button" disabled>
              <SourceModeIcon type="table" />
              <span>Hive table</span>
            </button>
          </div>
        </header>

        <div className="source_window_storage_fields">
          <label className="source_window_storage_default_toggle">
            <input
              type="checkbox"
              checked={storageUsesDefault}
              onChange={(event) => onPatchModeState({ storageUseDefault: event.target.checked })}
            />
            <span>Use Default</span>
          </label>
          <Field label="Storage address">
            <input
              type="text"
              value={state.storageAddress}
              placeholder="HDFS/Hive host address"
              disabled={storageUsesDefault || storageBusy || storageConnected}
              onChange={(event) => onPatchModeState({ storageAddress: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          <Field label="RPC/Web port">
            <input
              type="text"
              value={state.storagePort}
              placeholder="9870"
              disabled={storageUsesDefault || storageBusy || storageConnected}
              onChange={(event) => onPatchModeState({ storagePort: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          <Field label="Path">
            <input
              type="text"
              value={state.storagePath}
              placeholder="user/data/path"
              disabled={storageUsesDefault || storageBusy || storageConnected}
              onChange={(event) => onPatchModeState({ storagePath: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          <button
            type="button"
            className="source_window_storage_connect_button"
            disabled={storageBusy}
            onClick={onSourceAction}
          >
            {storageConnected ? 'Disconnect' : storageBusy ? displaySourceMessage(state.sourceStatus) : 'Connect'}
          </button>
        </div>

        <div className="source_window_storage_file_panel">
          <div className="source_window_storage_file_browser" aria-label="Storage file browser">
            <div className="source_window_storage_parent_row">
              <button
                type="button"
                className="source_window_storage_parent_button linkx_tooltip_anchor"
                data-tooltip="Return to parent directory"
                aria-label="Return to parent directory"
              >
                ..
              </button>
              <div className="source_window_storage_search_input">
                <input
                  type="text"
                  value={state.storageSearchQuery}
                  placeholder="Search by file name"
                  onChange={(event) => onPatchModeState({ storageSearchQuery: sanitizeText(event.target.value, { maxLength: 160, allowNewlines: true }) })}
                />
                <button type="button" aria-label="Search storage files" disabled>
                  <SourceModeIcon type="search" />
                </button>
              </div>
              <div className="source_window_storage_date_range">
                <input
                  type="date"
                  value={state.storageDateFrom}
                  onChange={(event) => onPatchModeState({ storageDateFrom: event.target.value })}
                />
                <b aria-hidden="true">-</b>
                <input
                  type="date"
                  value={state.storageDateTo}
                  onChange={(event) => onPatchModeState({ storageDateTo: event.target.value })}
                />
              </div>
              <span className="source_window_storage_selection_tools">
                <span className="source_window_storage_selected_count">
                  {selectedFiles.length} Selected files
                </span>
                <button
                  type="button"
                  className="source_window_storage_discard_button linkx_tooltip_anchor"
                  data-tooltip="Discard selection"
                  aria-label="Discard selection"
                  disabled={selectedFiles.length === 0}
                  onClick={() => onPatchModeState({ selectedStorageFiles: [] })}
                >
                  <SourceModeIcon type="clear" />
                </button>
              </span>
            </div>
            <div className="source_window_storage_file_header" aria-hidden="true">
              <span />
              <span>File name</span>
              <span>Last modified Date</span>
              <span>Size</span>
            </div>
            <div className="source_window_storage_placeholder_row" role="status" aria-live="polite">
              <span />
              <span>{storageEmptyMessage}</span>
              <small />
              <small />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
function SearchStep({ state, windowId, onPatchModeState }) {
  const selectedFiles = state.selectedFiles || [];
  const searchModeName = 'source-search-mode-' + windowId;

  return (
    <div className="source_window_step_body">
      <section className="source_window_section">
        <header>
          <h3>Search from storage</h3>
          <span className="source_window_hint">Backend search will attach here.</span>
        </header>
        <div className="source_window_search_bar">
          <input
            type="text"
            value={state.searchQuery}
            placeholder="Type here to search"
            onChange={(event) => onPatchModeState({ searchQuery: event.target.value })}
          />
          <input
            type="date"
            value={state.searchDate}
            onChange={(event) => onPatchModeState({ searchDate: event.target.value })}
          />
          <button type="button" disabled>Search</button>
        </div>
        <div className="source_window_radio_group is-compact" role="radiogroup" aria-label="Search type">
          <label>
            <input
              type="radio"
              name={searchModeName}
              checked={state.searchMode === 'raw'}
              onChange={() => onPatchModeState({ searchMode: 'raw' })}
            />
            <span>Raw files</span>
          </label>
          <label>
            <input
              type="radio"
              name={searchModeName}
              checked={state.searchMode === 'hybrid'}
              onChange={() => onPatchModeState({ searchMode: 'hybrid' })}
            />
            <span>Hybrid search</span>
          </label>
        </div>
      </section>
      <section className="source_window_section source_window_file_board">
        <header>
          <h3>Selected files</h3>
          <span>{selectedFiles.length} selected</span>
        </header>
        <p>No files selected yet. Search results and upload results will populate this area.</p>
      </section>
    </div>
  );
}

function DataframeStep({ mode, state, onPatchModeState, onOpenConfiguration }) {
  const sampleColumns = ['ACCOUNTNO', 'BENACCOUNTNO', 'AMOUNT', 'TRANSACTIONDATE'];
  const sampleActions = ['Store data', 'Source / Target Mapping', 'Link Analysis'];
  const actionIconTypes = {
    'Store data': 'batch',
    'Source / Target Mapping': 'broker',
    'Link Analysis': 'link',
  };
  const actionDescriptions = {
    'Store data': {
      text: 'Stores the prepared dataframe in the selected tool without creating relationships.',
      detail: 'Use this when the dataframe only needs to be persisted for later analysis.',
    },
    'Source / Target Mapping': {
      text: 'Maps columns from your source to target and selects the relationship label used to create graph relationships.',
      detail: 'This step uses the selected source and target columns along with the provided label.',
    },
    'Link Analysis': {
      text: 'Applies a saved rule to the dataframe so analysis flags can create relationships.',
      detail: 'Use this when rule results should become graph-ready links.',
    },
  };
  const selectedActionDescription = actionDescriptions[state.dataframeAction] || {
    text: 'Please select a dataframe action to continue.',
    detail: 'Required fields will appear below based on the selected action.',
  };
  const showsMappingFields = state.dataframeAction === 'Source / Target Mapping';
  const showsRuleField = state.dataframeAction === 'Link Analysis';

  return (
    <div className="source_window_step_body source_window_step_body_dataframe">
      <section className="source_window_dataframe_card source_window_dataframe_info">
        <header className="source_window_dataframe_card_header">
          <span className="source_window_panel_title">
            <SourceModeIcon type="table" />
            <h3>Dataframe information</h3>
          </span>
          <span className="source_window_panel_pill">
            <SourceModeIcon type="clock" />
            Waiting for dataframe creation
          </span>
        </header>
        <dl className="source_window_dataframe_metrics">
          <div>
            <SourceModeIcon type={mode === SOURCE_MODES.REALTIME ? 'realtime' : 'batch'} />
            <dl><dt>Source mode</dt><dd>{modeLabels[mode]}</dd></dl>
          </div>
          <div>
            <SourceModeIcon type="table" />
            <dl><dt>Total rows</dt><dd>0</dd></dl>
          </div>
          <div>
            <SourceModeIcon type="table" />
            <dl><dt>Total columns</dt><dd>0</dd></dl>
          </div>
          <div>
            <SourceModeIcon type="tool" />
            <dl><dt>Tool</dt><dd>Neo4j</dd></dl>
          </div>
        </dl>
      </section>
      <section className="source_window_dataframe_card source_window_dataframe_actions_card">
        <header className="source_window_dataframe_card_header">
          <span className="source_window_panel_title source_window_panel_title_stack">
            <span>
              <SourceModeIcon type="bolt" />
              <h3>Actions</h3>
            </span>
            <small>Define how the dataframe columns will be used.</small>
          </span>
          <span className="source_window_panel_pill">
            <SourceModeIcon type="clock" />
            Matches the old mandatory action area.
          </span>
        </header>
        <div className="source_window_dataframe_form_grid">
          <div className="source_window_dataframe_action_area">
            <div className="source_window_dataframe_action_group" role="group" aria-label="Dataframe action">
              {sampleActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={state.dataframeAction === action ? 'is-selected' : ''}
                  onClick={() => onPatchModeState({ dataframeAction: action })}
                >
                  <SourceModeIcon type={actionIconTypes[action]} />
                  <span>{action}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="source_window_dataframe_action_description">
            <span className="source_window_dataframe_info_mark" aria-hidden="true">i</span>
            <div>
              <p>{selectedActionDescription.text}</p>
              <small>{selectedActionDescription.detail}</small>
            </div>
          </div>

          {showsMappingFields && (
            <div className="source_window_dataframe_relation_grid">
              <DataframeField label="Source column" icon="batch">
                <select value={state.sourceColumn} onChange={(event) => onPatchModeState({ sourceColumn: event.target.value })}>
                  <option value="">Select source</option>
                  {sampleColumns.map((column) => <option key={column} value={column}>{column}</option>)}
                </select>
              </DataframeField>
              <DataframeField label="Target column" icon="batch">
                <select value={state.targetColumn} onChange={(event) => onPatchModeState({ targetColumn: event.target.value })}>
                  <option value="">Select target</option>
                  {sampleColumns.map((column) => <option key={column} value={column}>{column}</option>)}
                </select>
              </DataframeField>
              <DataframeField label="Relationship label" icon="link">
                <input
                  type="text"
                  value={state.relationship}
                  placeholder="HAS_RELATIONSHIP"
                  onChange={(event) => onPatchModeState({ relationship: sanitizeIdentifier(event.target.value).toUpperCase() })}
                />
              </DataframeField>
            </div>
          )}

          {showsRuleField && (
            <div className="source_window_dataframe_rule_area">
              <DataframeField label="Rule to apply" icon="table">
                <select value={state.rule} onChange={(event) => onPatchModeState({ rule: event.target.value })}>
                  <option value="">Select analysis rule</option>
                  <option value="bank transactions">bank transactions</option>
                </select>
              </DataframeField>
              <button type="button" className="source_window_manage_rules_button" onClick={onOpenConfiguration}>Manage rules</button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StreamStep({ state }) {
  return (
    <div className="source_window_step_body source_window_step_body_single">
      <section className="source_window_section">
        <header>
          <h3>Streaming</h3>
          <StatusPill label="Stream" status={state.streamStatus} />
        </header>
        <textarea
          className="source_window_log"
          readOnly
          value={'Session log will appear here after streaming integration is restored.\nNo streaming request is sent from this step yet.'}
        />
      </section>
    </div>
  );
}

function WorkflowBody({ mode, modeState, windowId, validationMessage, handlers, onPatchModeState, onOpenConfiguration }) {
  if (mode === SOURCE_MODES.BATCH && modeState.step === 'upload' && modeState.selectedConnectionType === 'storage') {
    return <StorageStep state={modeState} onPatchModeState={onPatchModeState} onSourceAction={handlers.onSourceAction} />;
  }
  if (mode === SOURCE_MODES.BATCH && modeState.step === 'upload' && modeState.selectedConnectionType === 'broker') {
    return <BrokerStep mode={mode} state={modeState} windowId={windowId} validationMessage={validationMessage} onPatchModeState={onPatchModeState} onSourceAction={handlers.onSourceAction} />;
  }
  if (mode === SOURCE_MODES.BATCH && modeState.step === 'upload') return <UploadStep state={modeState} onPatchModeState={onPatchModeState} />;
  if (modeState.step === 'search') return <SearchStep state={modeState} windowId={windowId} onPatchModeState={onPatchModeState} />;
  if (modeState.step === 'dataframe') return <DataframeStep mode={mode} state={modeState} onPatchModeState={onPatchModeState} onOpenConfiguration={onOpenConfiguration} />;
  if (modeState.step === 'stream') return <StreamStep state={modeState} />;
  return (
    <ConnectStep
      mode={mode}
      state={modeState}
      windowId={windowId}
      validationMessage={validationMessage}
      onPatchModeState={onPatchModeState}
      onSourceAction={handlers.onSourceAction}
      onToolAction={handlers.onToolAction}
    />
  );
}

export default function SourceWindowBody({ windowItem }) {
  const workspace = useWorkspace();
  const { notify } = useNotifications();
  const { token } = useAuth();
  const [validationMessage, setValidationMessage] = useState('');
  const sourceState = mergeSourceState(windowItem.sourceState);
  const activeMode = sourceState.mode;
  const modeKey = activeMode === SOURCE_MODES.REALTIME ? 'realtime' : 'batch';
  const modeState = sourceState[modeKey];
  const isChoosing = activeMode === SOURCE_MODES.CHOOSE;
  const accessibleSteps = useMemo(() => getAccessibleSteps(activeMode, modeState), [activeMode, modeState]);

  const updateSourceState = (nextSourceState) => {
    workspace.updateWindowMetadata(windowItem.id, { sourceState: nextSourceState });
  };

  const patchModeState = (patch) => {
    updateSourceState({
      ...sourceState,
      [modeKey]: {
        ...modeState,
        ...patch,
      },
    });
  };

  const selectMode = (mode, connectionType = '') => {
    setValidationMessage('');
    const addressTypePatch = ['broker', 'storage'].includes(connectionType)
      ? { sourceAddressType: connectionType }
      : {};
    const nextModeKey = mode === SOURCE_MODES.REALTIME ? 'realtime' : 'batch';

    updateSourceState({
      ...sourceState,
      mode,
      [nextModeKey]: {
        ...sourceState[nextModeKey],
        step: mode === SOURCE_MODES.REALTIME ? 'connect' : 'upload',
        selectedConnectionType: connectionType,
        ...(connectionType === 'storage' ? { sourceStatus: SOURCE_STATUSES.IDLE, sourceMessage: 'Not connected.' } : {}),
        ...addressTypePatch,
      },
    });
  };

  const copySessionId = async (sessionId) => {
    if (!sessionId) return;
    try {
      await navigator.clipboard.writeText(sessionId);
      notify({
        title: 'Session copied',
        message: 'The source session id was copied to the clipboard.',
        level: 'success',
        source: windowItem.title,
      });
    } catch (error) {
      console.error('Session id copy failed', { name: error?.name });
      notify({
        title: 'Copy failed',
        message: 'The session id could not be copied from this browser context.',
        level: 'warning',
        source: windowItem.title,
      });
    }
  };

  const openConfigurationWindow = () => {
    workspace.openWindow(WORKSPACE_WINDOW_TYPES.CONFIGURATION, {
      customTitle: 'Source defaults',
    });
  };

  const changeInputSelection = () => {
    setValidationMessage('');
    updateSourceState({
      ...sourceState,
      mode: SOURCE_MODES.CHOOSE,
    });
  };

  const workflowSteps = getWorkflowSteps(activeMode, modeState);
  const activeStepIndex = workflowSteps.findIndex((step) => step.id === modeState.step);
  const activeWorkflowStep = activeStepIndex >= 0 ? workflowSteps[activeStepIndex] : workflowSteps[0];
  const previousStep = activeStepIndex > 0 ? workflowSteps[activeStepIndex - 1] : null;
  const nextStep = activeStepIndex >= 0 && activeStepIndex < workflowSteps.length - 1 ? workflowSteps[activeStepIndex + 1] : null;
  const canContinueWorkflow = Boolean(nextStep && accessibleSteps.has(nextStep.id));
  const workflowFooterMessage = activeMode === SOURCE_MODES.BATCH && modeState.step === 'upload'
    ? modeState.selectedConnectionType === 'storage'
      ? 'Connected storage will be used to create the dataframe.'
      : modeState.selectedConnectionType === 'search'
        ? 'Selected search results will be used to create the dataframe.'
        : 'Selected files will be used to create the dataframe.'
    : nextStep
      ? 'Continue to the next source workflow step.'
      : 'This source workflow is ready for the next integration.';
  const streamActionLabels = {
    'Store data': 'Store data',
    'Source / Target Mapping': 'Map Data',
    'Link Analysis': 'Analyze',
  };
  const continueButtonLabel = modeState.step === 'stream' ? streamActionLabels[modeState.dataframeAction] || 'Analyze' : 'Continue';

  const goBackInWorkflow = () => {
    setValidationMessage('');
    if (!previousStep) {
      changeInputSelection();
      return;
    }
    patchModeState({ step: previousStep.id });
  };

  const continueWorkflow = () => {
    if (!canContinueWorkflow) return;
    setValidationMessage('');
    patchModeState({ step: nextStep.id });
  };

  const validateSourcePayload = () => {
    if (!token) return 'Authentication is required.';
    if (!normalizeWindowSessionId(windowItem)) return 'Source session is not ready yet.';
    if (modeState.sourceAddressType === 'storage') {
      if (modeState.storageUseDefault !== false) return '';
      return compactValidationErrors(
        validateConnectionValue(modeState.storageAddress, 'Storage address'),
        modeState.storagePath ? '' : 'Storage path is required.'
      );
    }
    return compactValidationErrors(
      validateConnectionValue(modeState.brokerAddress, 'Broker/API address'),
      modeState.sourceAddressType === 'broker' ? validateKafkaTopic(modeState.topic, 'Kafka topic') : ''
    );
  };

  const validateToolPayload = () => {
    if (!token) return 'Authentication is required.';
    if (!normalizeWindowSessionId(windowItem)) return 'Source session is not ready yet.';
    if (!isSourceReady(modeState)) return 'Connect the source first.';
    return compactValidationErrors(
      validateConnectionValue(modeState.toolUrl, 'Tool URL'),
      modeState.toolUsername ? '' : 'Tool username is required.',
      modeState.toolPassword ? '' : 'Tool password is required.'
    );
  };

  const buildSourcePayload = () => {
    const sourceSessionId = normalizeWindowSessionId(windowItem);
    const brokerAddress = sanitizeConnectionValue(modeState.brokerAddress);
    const storageAddress = sanitizeConnectionValue(modeState.storageAddress);
    const topic = modeState.sourceAddressType === 'broker' ? sanitizeKafkaTopic(modeState.topic) : null;
    const storageType = sanitizeIdentifier(modeState.storageType || 'hdfs');
    const activeAddress = modeState.sourceAddressType === 'storage' ? storageAddress : brokerAddress;

    return {
      addressType: modeState.sourceAddressType,
      address: activeAddress,
      broker: brokerAddress,
      storage: storageAddress,
      hdfs: storageAddress,
      storage_use_default: modeState.storageUseDefault !== false,
      storage_type: storageType,
      storage_port: sanitizeConnectionValue(modeState.storagePort),
      storage_database: sanitizeIdentifier(modeState.storageDatabase),
      storage_path: sanitizeConnectionValue(modeState.storagePath),
      storage_table: sanitizeIdentifier(modeState.storageTable),
      topic,
      session_id: sourceSessionId,
    };
  };

  const buildToolConnectPayload = () => ({
    tool_name: 'neo4j',
    url: sanitizeConnectionValue(modeState.toolUrl),
    username: sanitizeIdentifier(modeState.toolUsername),
    password: sanitizeSecret(modeState.toolPassword),
    database: sanitizeIdentifier(modeState.toolDatabase),
    source_id: normalizeWindowSessionId(windowItem),
  });

  const buildToolDisconnectPayload = () => ({
    tool_name: 'neo4j',
    source_id: normalizeWindowSessionId(windowItem),
  });

  const handleSourceAction = async () => {
    setValidationMessage('');
    const isDisconnecting = modeState.sourceStatus === SOURCE_STATUSES.CONNECTED;
    const validationError = isDisconnecting ? '' : validateSourcePayload();
    if (validationError) {
      setValidationMessage(validationError);
      return;
    }

    const pendingStatus = isDisconnecting ? SOURCE_STATUSES.DISCONNECTING : SOURCE_STATUSES.CONNECTING;
    patchModeState({ sourceStatus: pendingStatus, sourceMessage: displaySourceMessage(pendingStatus) });

    try {
      if (isDisconnecting && modeState.toolStatus === TOOL_STATUSES.CONNECTED) {
        patchModeState({ toolStatus: TOOL_STATUSES.DISCONNECTING, toolMessage: displayToolMessage(TOOL_STATUSES.DISCONNECTING) });
        await disconnectTool(appConfig.apiUrl, token, buildToolDisconnectPayload());
      }

      const request = isDisconnecting ? disconnectSource : connectSource;
      const result = await request(appConfig.apiUrl, token, buildSourcePayload());
      const nextStatus = !result.ok
        ? SOURCE_STATUSES.FAILED
        : isDisconnecting
          ? SOURCE_STATUSES.DISCONNECTED
          : sourceStatusFromMessage(result.message || 'Connection established!');
      patchModeState({
        sourceStatus: nextStatus,
        sourceMessage: displaySourceMessage(nextStatus),
        ...(isDisconnecting ? { toolStatus: TOOL_STATUSES.IDLE, toolMessage: displayToolMessage(TOOL_STATUSES.IDLE), step: activeMode === SOURCE_MODES.BATCH ? 'upload' : 'connect' } : {}),
      });
      notify({
        title: isDisconnecting ? 'Source disconnected' : 'Source connected',
        message: isDisconnecting ? 'The source connection was closed.' : 'The source connection is ready.',
        level: nextStatus === SOURCE_STATUSES.FAILED ? 'error' : 'success',
        source: windowItem.title,
      });
    } catch (error) {
      console.error('Source connection action failed', { status: error?.status });
      patchModeState({ sourceStatus: SOURCE_STATUSES.FAILED, sourceMessage: displaySourceMessage(SOURCE_STATUSES.FAILED) });
      notify({
        title: 'Source connection failed',
        message: 'The source connection could not be completed. Please review the values and try again.',
        level: 'error',
        source: windowItem.title,
      });
    }
  };

  const handleToolAction = async () => {
    setValidationMessage('');
    const isDisconnecting = modeState.toolStatus === TOOL_STATUSES.CONNECTED;
    const validationError = isDisconnecting ? '' : validateToolPayload();
    if (validationError) {
      setValidationMessage(validationError);
      return;
    }

    const pendingStatus = isDisconnecting ? TOOL_STATUSES.DISCONNECTING : TOOL_STATUSES.CONNECTING;
    patchModeState({ toolStatus: pendingStatus, toolMessage: displayToolMessage(pendingStatus) });

    try {
      const request = isDisconnecting ? disconnectTool : connectTool;
      const payload = isDisconnecting ? buildToolDisconnectPayload() : buildToolConnectPayload();
      const result = await request(appConfig.apiUrl, token, payload);
      const nextStatus = !result.ok
        ? TOOL_STATUSES.FAILED
        : isDisconnecting
          ? TOOL_STATUSES.DISCONNECTED
          : toolStatusFromMessage(result.message || 'Connected!');
      patchModeState({
        toolStatus: nextStatus,
        toolMessage: displayToolMessage(nextStatus),
        ...(!isDisconnecting ? { toolPassword: '' } : {}),
        ...(isDisconnecting ? { step: activeMode === SOURCE_MODES.BATCH ? 'upload' : 'connect' } : {}),
      });
      notify({
        title: isDisconnecting ? 'Tool disconnected' : 'Tool connected',
        message: isDisconnecting ? 'The tool connection was closed.' : 'The tool is ready for this source window.',
        level: nextStatus === TOOL_STATUSES.FAILED ? 'error' : 'success',
        source: windowItem.title,
      });
    } catch (error) {
      console.error('Tool connection action failed', { status: error?.status });
      patchModeState({ toolStatus: TOOL_STATUSES.FAILED, toolMessage: displayToolMessage(TOOL_STATUSES.FAILED), toolPassword: '' });
      notify({
        title: 'Tool connection failed',
        message: 'The tool connection could not be completed. Please review the values and try again.',
        level: 'error',
        source: windowItem.title,
      });
    }
  };

  if (isChoosing) {
    return (
      <div className="workspace_window_body source_window_body">
        <ModeChooser
          sourceSessionId={normalizeWindowSessionId(windowItem)}
          onSelectMode={selectMode}
          onOpenConfiguration={openConfigurationWindow}
          onCopySession={copySessionId}
        />
      </div>
    );
  }

  return (
    <div className="workspace_window_body source_window_body">
      <div className="source_window_workspace">
        <header className="source_window_choose_header">
          <SourceModeIcon type={modeState.step === 'upload' ? modeState.selectedConnectionType === 'storage' ? 'storage' : modeState.selectedConnectionType === 'search' ? 'search' : 'upload' : activeMode === SOURCE_MODES.REALTIME ? 'realtime' : 'source'} />
          <div>
            <h2>Analysis Source</h2>
            <p>{activeWorkflowStep?.value || 'Continue configuring this source window.'}</p>
            <SessionBadge sessionId={normalizeWindowSessionId(windowItem)} onCopySession={copySessionId} />
          </div>
        </header>
        <div className="source_window_workflow_shell">
          <WorkflowTimeline
            activeStep={modeState.step}
            steps={workflowSteps}
            accessibleSteps={accessibleSteps}
            onStepChange={(step) => patchModeState({ step })}
          />
          <WorkflowBody
          mode={activeMode}
          modeState={modeState}
          windowId={windowItem.id}
          validationMessage={validationMessage}
          handlers={{ onSourceAction: handleSourceAction, onToolAction: handleToolAction }}
          onPatchModeState={patchModeState}
          onOpenConfiguration={openConfigurationWindow}
        />
        </div>
        <footer className="source_window_choose_footer">
          <span>{workflowFooterMessage}</span>
          <div>
            <button type="button" onClick={goBackInWorkflow}>Back</button>
            <button type="button" disabled={!canContinueWorkflow} onClick={continueWorkflow}>{continueButtonLabel}</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
