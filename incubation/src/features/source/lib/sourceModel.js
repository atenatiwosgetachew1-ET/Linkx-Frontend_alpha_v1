
import { UPLOAD_LIMITS as BACKEND_UPLOAD_LIMITS } from '../../../services/sourceApi.js';

export const SOURCE_MODES = {
  CHOOSE: 'choose',
  BATCH: 'batch',
  REALTIME: 'realtime',
};

export const BATCH_TIMELINE_STEPS = [
  { id: 'upload', label: 'Upload', value: 'Select source files' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

export const BATCH_STORAGE_TIMELINE_STEPS = [
  { id: 'upload', label: 'Storage', value: 'Connect table or path' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

export const BATCH_BROKER_TIMELINE_STEPS = [
  { id: 'upload', label: 'Broker', value: 'Connect message source' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

export const BATCH_SEARCH_TIMELINE_STEPS = [
  { id: 'upload', label: 'Search', value: 'Find source files' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

export const REALTIME_TIMELINE_STEPS = [
  { id: 'connect', label: 'Connect', value: 'Connect broker or API' },
  { id: 'dataframe', label: 'Dataframe', value: 'Prepare columns and action' },
  { id: 'stream', label: 'Stream', value: 'Run ingestion' },
];

export const SOURCE_STATUSES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
  UPLOADED: 'uploaded',
};

export const TOOL_STATUSES = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
  DISCONNECTED: 'disconnected',
  FAILED: 'failed',
};

export const DATAFRAME_STATUSES = {
  NONE: 'none',
  CREATING: 'creating',
  READY: 'ready',
  FAILED: 'failed',
};

export const UPLOAD_STATUSES = {
  IDLE: 'idle',
  UPLOADING: 'uploading',
  UPLOADED: 'uploaded',
  FAILED: 'failed',
};

// UI action label -> value the backend expects in create_DF results / stream.
export const DATAFRAME_ACTION_BACKEND_VALUES = Object.freeze({
  'Store data': 'Store data',
  'Source / Target Mapping': 'Source / Target Relationship',
  'Link Analysis': 'Link Analysis',
});

export const STREAM_STATUSES = {
  IDLE: 'idle',
  STARTING: 'starting', // request accepted, queued ingestion job pending
  RUNNING: 'running',
  TERMINATING: 'terminating',
  TERMINATED: 'terminated',
  COMPLETED: 'completed', // the ingestion job finished on the backend
  FAILED: 'failed',
};

// A stream that the backend may still be running (Terminate applies).
export const isStreamActive = (state) => [STREAM_STATUSES.STARTING, STREAM_STATUSES.RUNNING].includes(state.streamStatus);

export const pad2 = (value) => String(value).padStart(2, '0');

export const formatLogTimestamp = (date = new Date()) => (
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
);

export const createStreamLogEntry = (message, level = 'info') => ({ at: formatLogTimestamp(), level, message });

export const formatStreamLog = (entries = []) => entries
  .map((entry) => {
    if (entry.source === 'backend') return entry.message;
    const level = String(entry.level || 'info').toLowerCase();
    return `[${entry.at}] ${level === 'info' ? '' : level.toUpperCase() + ' '}${entry.message}`;
  })
  .join('\n');

// Same limits the production app enforces before /upload_batch_files.
export const UPLOAD_LIMITS = Object.freeze({
  ...BACKEND_UPLOAD_LIMITS,
  allowedExtensions: new Set(BACKEND_UPLOAD_LIMITS.allowedExtensions),
});

export const uploadAcceptValue = Array.from(UPLOAD_LIMITS.allowedExtensions).map((extension) => '.' + extension).join(',');

export const UPLOAD_FILE_TYPES = Object.freeze({
  csv: 'Comma-separated values',
  json: 'JSON structured data',
  parquet: 'Parquet columnar dataset',
  xlsx: 'Excel workbook',
});

export const getFileExtension = (fileName) => {
  const name = String(fileName || '');
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
};

export const formatFileSize = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1) + ' KB';
  return bytes + ' B';
};

export const formatDomainLabel = (key) => String(key || '')
  .split(/[_\s-]+/)
  .filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join(' ');

export const formatDomainOption = (key, path) => {
  const label = formatDomainLabel(key) || 'Default';
  return path ? `${label} · /${String(path).replace(/^\/+/, '')}` : label;
};

// Storage search reports sizes in KB (production renders "{size} Kb").
export const formatStorageSize = (value) => {
  const kb = Number(value);
  if (value === '' || value === null || value === undefined || !Number.isFinite(kb)) return value ? String(value) : '—';
  if (kb >= 1024 * 1024) return (kb / (1024 * 1024)).toFixed(1) + ' GB';
  if (kb >= 1024) return (kb / 1024).toFixed(kb >= 10 * 1024 ? 0 : 1) + ' MB';
  return kb + ' KB';
};

export const formatFileDate = (timestamp) => {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '';
  return new Date(value).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export const modeLabels = {
  [SOURCE_MODES.BATCH]: 'Batch input',
  [SOURCE_MODES.REALTIME]: 'Real-time input',
};

export const defaultSourceState = {
  mode: SOURCE_MODES.CHOOSE,
  // Mode in use before going back to the chooser (preselected there).
  lastMode: '',
  autofillApplied: false,
  batch: {
    step: 'upload',
    selectedConnectionType: 'upload',
    sourceAddressType: 'broker',
    brokerAddress: '',
    topic: '',
    // `brokerUseDefault` stays unset until chosen (brokerUsesDefault).
    brokerToolbarCollapsed: true,
    storageAddress: '',
    storageUseDefault: true,
    // Storage / Elastic connection toolbar hidden to free vertical space.
    // Starts collapsed: the page auto-connects with the configured default
    // storage, and the form opens by itself only when that needs attention.
    storageToolbarCollapsed: true,
    storagePort: '',
    storageDatabase: '',
    storagePath: '',
    storageSearchQuery: '',
    storageSearchDate: '',
    storageSearchStatus: 'idle',
    storageSearchResults: [],
    storageSearchHasMore: false,
    storageSearchMessage: '',
    storageSearchLast: null,
    selectedStorageFiles: [],
    elasticColumn: '',
    // Elastic search record date range (YYYY-MM-DD; either end optional).
    elasticSearchDateFrom: '',
    elasticSearchDateTo: '',
    elasticSearchStatus: 'idle',
    elasticSearchResults: [],
    elasticSearchHasMore: false,
    elasticSearchMessage: '',
    elasticSearchLast: null,
    selectedSearchFiles: [],
    sourceStatus: SOURCE_STATUSES.IDLE,
    sourceMessage: 'Not connected.',
    toolStatus: TOOL_STATUSES.IDLE,
    toolMessage: 'Not connected.',
    selectedFiles: [],
    selectedFileDetails: [],
    searchQuery: '',
    searchMode: 'fuzzy',
    dataframeAction: 'Link Analysis',
    sourceColumn: '',
    targetColumn: '',
    relationship: '',
    rule: '',
    toolUrl: '',
    toolUsername: '',
    toolPassword: '',
    toolPasswordRef: '',
    toolDatabase: '',
    uploadStatus: UPLOAD_STATUSES.IDLE,
    uploadedFiles: [],
    dataframeStatus: DATAFRAME_STATUSES.NONE,
    dataframeInfo: null,
    dataframeFilter: null,
    dataframeMessage: '',
    preparing: '',
    streamStatus: STREAM_STATUSES.IDLE,
    streamLogFile: '',
    realtimeConfigSavedFor: '',
    realtimeConfigMessage: '',
  },
  realtime: {
    step: 'connect',
    sourceAddressType: 'broker',
    brokerAddress: '',
    topic: '',
    // `brokerUseDefault` stays unset until chosen (brokerUsesDefault).
    brokerToolbarCollapsed: true,
    sourceStatus: SOURCE_STATUSES.IDLE,
    sourceMessage: 'Not connected.',
    toolStatus: TOOL_STATUSES.IDLE,
    toolMessage: 'Not connected.',
    dataframeAction: 'Link Analysis',
    sourceColumn: '',
    targetColumn: '',
    relationship: '',
    rule: '',
    toolUrl: '',
    toolUsername: '',
    toolPassword: '',
    toolPasswordRef: '',
    toolDatabase: '',
    dataframeStatus: DATAFRAME_STATUSES.NONE,
    dataframeInfo: null,
    dataframeFilter: null,
    dataframeMessage: '',
    preparing: '',
    streamStatus: STREAM_STATUSES.IDLE,
    streamLogFile: '',
    realtimeConfigSavedFor: '',
    realtimeConfigMessage: '',
  },
};

// After a domain switch: fields that still hold the previous domain's
// defaults move to the new domain's defaults; analyst-typed values stay.
// Storage address/port are never written (they stay hidden behind Use Default).
export const domainDefaultsPatch = (state, previousDefaults, nextDefaults) => {
  const patch = {};
  const swap = (field, oldValue, newValue) => {
    if (newValue && (!state[field] || state[field] === oldValue) && state[field] !== newValue) patch[field] = newValue;
  };
  // Manual entry ("Use Default" off): what the analyst typed, or left empty.
  if (state.brokerUseDefault !== false) {
    swap('brokerAddress', previousDefaults.broker.address, nextDefaults.broker.address);
    swap('topic', previousDefaults.broker.topic, nextDefaults.broker.topic);
  }
  swap('toolUrl', previousDefaults.tool.url, nextDefaults.tool.url);
  swap('toolUsername', previousDefaults.tool.username, nextDefaults.tool.username);
  swap('toolDatabase', previousDefaults.tool.database, nextDefaults.tool.database);
  return patch;
};

// The session configuration changed (Configuration save / reset / import,
// or a domain switch): fields still holding the previous defaults move to the
// new ones, and so does the saved Neo4j password reference, unless the
// analyst typed a password or the mode holds its own saved realtime ref.
export const configDefaultsPatch = (state, previousDefaults, nextDefaults, { hasTypedPassword = false, onlyChanged = false } = {}) => {
  const patch = domainDefaultsPatch(state, previousDefaults, nextDefaults);
  // Same domain: only defaults that actually changed move (a field the
  // analyst cleared is not refilled when the window remounts).
  if (onlyChanged) {
    const defaultsOf = (defaults) => ({
      brokerAddress: defaults.broker.address,
      topic: defaults.broker.topic,
      toolUrl: defaults.tool.url,
      toolUsername: defaults.tool.username,
      toolDatabase: defaults.tool.database,
    });
    const before = defaultsOf(previousDefaults);
    const after = defaultsOf(nextDefaults);
    Object.keys(patch).forEach((field) => { if (before[field] === after[field]) delete patch[field]; });
  }
  // With autofill off, empty fields stay empty: only values that came from
  // the previous defaults move.
  if (!nextDefaults.autoFill) {
    Object.keys(patch).forEach((field) => { if (!state[field]) delete patch[field]; });
  }
  const previousRef = previousDefaults.tool.passwordRef || '';
  const nextRef = nextDefaults.tool.passwordRef || '';
  const stateRef = state.toolPasswordRef || '';
  const holdsConfigRef = stateRef ? stateRef === previousRef : Boolean(nextDefaults.autoFill);
  if (!hasTypedPassword && stateRef !== nextRef && holdsConfigRef) {
    patch.toolPasswordRef = nextRef;
    patch.toolPassword = nextRef ? '***' : '';
  }
  return patch;
};

export const mergeSourceState = (sourceState = {}) => ({
  ...defaultSourceState,
  ...sourceState,
  batch: { ...defaultSourceState.batch, ...(sourceState.batch || {}) },
  realtime: { ...defaultSourceState.realtime, ...(sourceState.realtime || {}) },
});

export const sourceStatusFromMessage = (message) => {
  if (message === 'Connection established!' || message === 'success') return SOURCE_STATUSES.CONNECTED;
  if (message === 'Disconnected!') return SOURCE_STATUSES.DISCONNECTED;
  if (String(message || '').toLowerCase().includes('failed')) return SOURCE_STATUSES.FAILED;
  return SOURCE_STATUSES.IDLE;
};

export const toolStatusFromMessage = (message) => {
  if (message === 'Connected!' || message === 'Connection established!' || message === 'success') return TOOL_STATUSES.CONNECTED;
  if (message === 'Disconnected!') return TOOL_STATUSES.DISCONNECTED;
  if (String(message || '').toLowerCase().includes('failed')) return TOOL_STATUSES.FAILED;
  return TOOL_STATUSES.IDLE;
};

export const displaySourceMessage = (status) => {
  if (status === SOURCE_STATUSES.CONNECTING) return 'Connecting...';
  if (status === SOURCE_STATUSES.CONNECTED) return 'Connection established.';
  if (status === SOURCE_STATUSES.DISCONNECTING) return 'Disconnecting...';
  if (status === SOURCE_STATUSES.DISCONNECTED) return 'Disconnected.';
  if (status === SOURCE_STATUSES.FAILED) return 'Connection failed. Please check the values and try again.';
  return 'Not connected.';
};

export const displayToolMessage = (status) => {
  if (status === TOOL_STATUSES.CONNECTING) return 'Connecting...';
  if (status === TOOL_STATUSES.CONNECTED) return 'Connected.';
  if (status === TOOL_STATUSES.DISCONNECTING) return 'Disconnecting...';
  if (status === TOOL_STATUSES.DISCONNECTED) return 'Disconnected.';
  if (status === TOOL_STATUSES.FAILED) return 'Connection failed. Please check the values and try again.';
  return 'Not connected.';
};

export const isSourceBusy = (state) => [SOURCE_STATUSES.CONNECTING, SOURCE_STATUSES.DISCONNECTING].includes(state.sourceStatus);

export const isToolBusy = (state) => [TOOL_STATUSES.CONNECTING, TOOL_STATUSES.DISCONNECTING].includes(state.toolStatus);

// Which backend connection an input needs. Storage and Elastic search share
// the storage connection; realtime always uses the broker.
export const connectionKindOf = (state) => {
  const type = state.selectedConnectionType;
  if (type === 'upload') return 'upload';
  if (type === 'storage' || type === 'search') return 'storage';
  return 'broker';
};

// Ready only when the live connection belongs to the selected input, so a
// storage connection never satisfies Upload/Broker (and an upload never
// satisfies a connection-based input).
export const isSourceReady = (state) => {
  const kind = connectionKindOf(state);
  if (state.sourceStatus === SOURCE_STATUSES.UPLOADED) return kind === 'upload';
  if (state.sourceStatus !== SOURCE_STATUSES.CONNECTED) return false;
  return !state.connectedKind || state.connectedKind === kind;
};

// The Message broker page's "Use Default" (its flow page, sourceFrame.js).
// Not chosen yet: on, unless the window already holds values of its own.
const isBrokerDefault = (value, ...defaults) => !value || defaults.includes(value);
export const brokerUsesDefault = (state, defaults) => {
  if (typeof state.brokerUseDefault === 'boolean') return state.brokerUseDefault;
  const { address, apiAddress, topic } = defaults.broker;
  return isBrokerDefault(state.brokerAddress, address, apiAddress) && isBrokerDefault(state.topic, topic);
};

// What it connects to: the configured address and topic, or the typed ones.
export const resolveBrokerTarget = (state, defaults) => {
  const isApi = state.sourceAddressType === 'api';
  if (!brokerUsesDefault(state, defaults)) return { address: state.brokerAddress || '', topic: isApi ? '' : state.topic || '' };
  return { address: (isApi ? defaults.broker.apiAddress : defaults.broker.address) || '', topic: isApi ? '' : defaults.broker.topic || '' };
};

// The typed values as shown: a prefilled default is never among them.
export const typedBrokerValues = (state, defaults) => ({
  brokerAddress: isBrokerDefault(state.brokerAddress, defaults.broker.address, defaults.broker.apiAddress) ? '' : state.brokerAddress,
  topic: isBrokerDefault(state.topic, defaults.broker.topic) ? '' : state.topic,
});

// Staged files, search picks or a live connection are enough on their own:
// every input connects the tool on Continue (analyst decision 2026-11-23;
// production's broker page asks for the tool first).
export const isBatchInputReady = (state) => {
  if (state.selectedConnectionType === 'broker') return isSourceReady(state);
  if (state.selectedConnectionType === 'storage') return isSourceReady(state) && (state.selectedStorageFiles || []).length > 0;
  if (state.selectedConnectionType === 'search') return isSourceReady(state) && (state.selectedSearchFiles || []).length > 0;
  return (state.selectedFiles || []).length > 0;
};

// How the dataframe is produced for the current input (create_DF `kind`).
export const getDataframeFlow = (mode, state) => {
  if (mode === SOURCE_MODES.REALTIME) return 'address';
  if (state.selectedConnectionType === 'broker') return 'address';
  if (state.selectedConnectionType === 'storage') return 'hdfs';
  if (state.selectedConnectionType === 'search') return 'hybrid';
  return 'files';
};

export const isInputStep = (state) => state.step === 'upload' || state.step === 'connect';

// Input ready -> Continue may run the upload / tool / create_DF pipeline.
export const canPrepareDataframe = (mode, state) => (
  mode === SOURCE_MODES.REALTIME ? isSourceReady(state) : isBatchInputReady(state)
);

// Storage search results/selection belong to one storage connection.
export const ELASTIC_SEARCH_RESET_PATCH = Object.freeze({
  elasticSearchStatus: 'idle',
  elasticSearchResults: [],
  elasticSearchHasMore: false,
  elasticSearchMessage: '',
  elasticSearchLast: null,
  selectedSearchFiles: [],
});

export const STORAGE_SEARCH_RESET_PATCH = Object.freeze({
  storageSearchStatus: 'idle',
  storageSearchResults: [],
  storageSearchHasMore: false,
  storageSearchMessage: '',
  storageSearchLast: null,
  selectedStorageFiles: [],
  // Elastic results come from the same storage connection.
  ...ELASTIC_SEARCH_RESET_PATCH,
});

// Fields to reset whenever the input changes and the dataframe is stale.
export const STALE_DATAFRAME_PATCH = Object.freeze({
  dataframeStatus: DATAFRAME_STATUSES.NONE,
  dataframeInfo: null,
  dataframeFilter: null,
  dataframeMessage: '',
});

export const canStream = (state) => {
  if (state.dataframeAction === 'Store data') return true;
  if (state.dataframeAction === 'Source / Target Mapping') {
    return Boolean(state.sourceColumn && state.targetColumn) && state.sourceColumn !== state.targetColumn;
  }
  if (state.dataframeAction === 'Link Analysis') return Boolean(state.rule);
  return false;
};

// Human-readable reasons the Continue button is locked on the current step.
export const getContinueBlockers = (mode, state) => {
  if (state.step === 'dataframe') {
    if (!state.dataframeAction) return ['Choose a dataframe action'];
    if (state.dataframeAction === 'Source / Target Mapping') {
      return [
        !state.sourceColumn && 'Select a source column',
        !state.targetColumn && 'Select a target column',
        state.sourceColumn && state.sourceColumn === state.targetColumn && 'Pick different source and target columns',
      ].filter(Boolean);
    }
    if (state.dataframeAction === 'Link Analysis' && !state.rule) return ['Select a rule to apply'];
    return [];
  }

  if (mode === SOURCE_MODES.BATCH && state.step === 'upload') {
    if (isBatchInputReady(state)) return [];
    if (state.selectedConnectionType === 'storage') {
      return [
        !isSourceReady(state) && 'Connect to the storage',
        !(state.selectedStorageFiles || []).length && 'Select at least one file',
      ].filter(Boolean);
    }
    if (state.selectedConnectionType === 'search') {
      return [
        !isSourceReady(state) && 'Connect to the storage',
        !(state.selectedSearchFiles || []).length && 'Select at least one search result',
      ].filter(Boolean);
    }
    if (state.selectedConnectionType === 'broker') {
      return ['Connect the broker'];
    }
    return ['Stage at least one file'];
  }

  if (state.step === 'connect') {
    return isSourceReady(state) ? [] : ['Connect the source'];
  }

  return [];
};

export const getWorkflowSteps = (mode, state) => {
  if (mode === SOURCE_MODES.REALTIME) return REALTIME_TIMELINE_STEPS;
  if (state.selectedConnectionType === 'storage') return BATCH_STORAGE_TIMELINE_STEPS;
  if (state.selectedConnectionType === 'broker') return BATCH_BROKER_TIMELINE_STEPS;
  if (state.selectedConnectionType === 'search') return BATCH_SEARCH_TIMELINE_STEPS;
  return BATCH_TIMELINE_STEPS;
};

// While a stream may still be running only the stream step is reachable
// (its footer offers Terminate); a finished run stays reachable only while
// the dataframe it was built from still exists.
const STREAM_LOCKING_STATUSES = [STREAM_STATUSES.STARTING, STREAM_STATUSES.RUNNING, STREAM_STATUSES.TERMINATING];
const STREAM_DONE_STATUSES = [STREAM_STATUSES.COMPLETED, STREAM_STATUSES.TERMINATED];

export const getAccessibleSteps = (mode, state) => {
  if (STREAM_LOCKING_STATUSES.includes(state.streamStatus)) return new Set(['stream']);
  const steps = new Set([mode === SOURCE_MODES.REALTIME ? 'connect' : 'upload']);
  if (state.dataframeStatus === DATAFRAME_STATUSES.READY) {
    steps.add('dataframe');
    if (canStream(state) || STREAM_DONE_STATUSES.includes(state.streamStatus)) steps.add('stream');
  }
  return steps;
};

export const normalizeWindowSessionId = (windowItem) => String(windowItem.sourceSessionId || '').trim();

// Tool (graph database) connection. Used by the broker/API step and the
// legacy connect step. A masked "***" password means the saved configuration
// holds the secret server-side (sent back as `password_ref`).
export const secretScopeOf = (mode) => (mode === SOURCE_MODES.REALTIME || mode === 'realtime' ? 'realtime' : 'batch');

export const elasticResultKey = (item) => `${item?.name || ''}__${item?.size ?? ''}__${item?.column || ''}`;

export const formatRowCount = (size) => {
  const count = Number(size);
  if (size === '' || size === null || size === undefined || !Number.isFinite(count)) return size ? String(size) : '—';
  return `${count.toLocaleString()} rows`;
};
