// Source window backend contract. Mirrors the production app's payloads
// (src/App.jsx): the source window id `${windowId}_${mainSessionId}` returned
// by /init_source is the `session_id` / `source_id` for every later call.

import { isSuccessResponse } from './apiClient.js';
import {
  getApiProblemPayload,
  getSharedApiErrorMessage,
  sanitizeBackendUserMessage,
  getConnectSourceErrorMessage,
  getConnectToolErrorMessage,
  getDisconnectSourceErrorMessage,
  getDisconnectToolErrorMessage,
  getServiceRefusalCode,
  getServiceRefusalMessage,
} from './apiErrors.js';
import { getQueuedJobId, getJobStatus, isQueuedJobResponse, getQueuedPollPath, pollJob, JOB_SUCCESS_STATUSES } from './jobs.js';
import { normalizeSessionId } from './sessionApi.js';
import { sanitizeSecret } from '../utils/inputSecurity.js';

const toBackendWindowId = (windowId) => {
  const clean = String(windowId || '').trim();
  return Number.isNaN(Number(clean)) ? clean : Number(clean);
};

export const buildSourceSessionId = (windowId, sessionId) => `${windowId}_${sessionId}`;

export const initializeSourceWindow = async (apiFetch, { sessionId, windowId }) => {
  const cleanSessionId = normalizeSessionId(sessionId);
  const cleanWindowId = String(windowId || '').trim();
  if (!cleanSessionId) throw new Error('Main session is not initialized.');
  if (!cleanWindowId) throw new Error('Source window id is not available.');

  const data = await apiFetch('/init_source', {
    method: 'POST',
    body: { id: 'source_window', session_id: cleanSessionId, window_id: toBackendWindowId(cleanWindowId) },
  });

  const sourceSessionId = normalizeSessionId(
    data?.results?.source_id ??
    data?.results?.session_id ??
    data?.source_id ??
    data?.session_id ??
    buildSourceSessionId(cleanWindowId, cleanSessionId)
  );

  return { data, sourceSessionId, parentSessionId: cleanSessionId, windowId: cleanWindowId };
};

export const closeSourceWindow = async (apiFetch, { sessionId, windowId, reason = 'user_closed_window', keepalive = false }) => {
  const cleanSessionId = normalizeSessionId(sessionId);
  const cleanWindowId = String(windowId || '').trim();
  if (!cleanSessionId || !cleanWindowId) return null;

  return apiFetch('/close_source_window', {
    method: 'POST',
    // Page gone or signed out: nobody is there for a sign-in notice.
    ...(keepalive ? { keepalive: true, suppressUnauthorizedHandler: true } : {}),
    body: { id: 'close_source_window', session_id: cleanSessionId, window_id: toBackendWindowId(cleanWindowId), reason },
  });
};

// ---------------------------------------------------------------- source ---

const isSourceConnectedResponse = (data) => {
  const message = String(data?.message || '').trim();
  if (String(data?.status || '').toLowerCase() === 'error') return false;
  return message === 'Connection established!' ||
    message.toLowerCase() === 'success' ||
    /established|successful/i.test(message) ||
    data?.status === 'success';
};

// payload: { addressType, address, broker, hdfs, storage, topic, mode, session_id }
export const connectSource = async (apiFetch, payload, { signal } = {}) => {
  try {
    const data = await apiFetch('/connect_to_source', { method: 'POST', body: payload, signal });
    const ok = isSourceConnectedResponse(data);
    return { data, ok, message: ok ? 'Connection established!' : getConnectSourceErrorMessage(data) };
  } catch (error) {
    return { data: error?.data, ok: false, message: getConnectSourceErrorMessage(error), error };
  }
};

export const disconnectSource = async (apiFetch, payload, { signal } = {}) => {
  const body = {
    ...payload,
    broker: payload?.broker ?? payload?.address ?? '',
    hdfs: payload?.hdfs ?? payload?.storage ?? '',
  };
  try {
    const data = await apiFetch('/disconnect_source', { method: 'POST', body, signal });
    const ok = String(data?.status || '').toLowerCase() !== 'error';
    return { data, ok, message: ok ? (data?.message || 'Disconnected!') : getDisconnectSourceErrorMessage(data) };
  } catch (error) {
    return { data: error?.data, ok: false, message: getDisconnectSourceErrorMessage(error), error };
  }
};

// ------------------------------------------------------------------ tool ---

const MASKED_SECRET_PATTERN = /^\*+$/;

export const isMaskedSecret = (value) => MASKED_SECRET_PATTERN.test(String(value || '').trim());

// Builds the /connect_to_tool body. When the password field still holds the
// masked "***" from saved configuration, the Service resolves the real secret
// from `password_ref`; without a ref the password goes empty and the Service
// uses the one saved to the account for that host, or answers
// password_required (H-10).
export const buildToolConnectPayload = ({ sourceSessionId, toolName = 'neo4j', url, username, password, passwordRef, database }) => {
  const sessionKey = normalizeSessionId(sourceSessionId);
  const cleanPassword = sanitizeSecret(password, { maxLength: 256 });
  const cleanPasswordRef = String(passwordRef || '').trim();
  const payload = {
    tool_name: toolName,
    url,
    username,
    password: cleanPassword,
    database,
    source_id: sessionKey,
    session_id: sessionKey,
  };

  if (isMaskedSecret(cleanPassword)) {
    if (cleanPasswordRef) payload.password_ref = cleanPasswordRef;
    else payload.password = '';
  }
  return { ok: true, payload };
};

export const connectTool = async (apiFetch, payload, { signal } = {}) => {
  try {
    const data = await apiFetch('/connect_to_tool', { method: 'POST', body: payload, signal });
    const ok = String(data?.message || '').trim() === 'Connected!';
    return { data, ok, message: ok ? 'Connected!' : getConnectToolErrorMessage(data) };
  } catch (error) {
    return { data: error?.data, ok: false, message: getConnectToolErrorMessage(error), error };
  }
};

export const disconnectTool = async (apiFetch, payload, { signal } = {}) => {
  try {
    const data = await apiFetch('/disconnect_tool', { method: 'POST', body: payload, signal });
    const ok = String(data?.status || '').toLowerCase() !== 'error';
    return { data, ok, message: ok ? (data?.message || 'Disconnected!') : getDisconnectToolErrorMessage(data) };
  } catch (error) {
    return { data: error?.data, ok: false, message: getDisconnectToolErrorMessage(error), error };
  }
};

// ---------------------------------------------------------------- upload ---

// Production limits (env-overridable the same way as the main app).
export const UPLOAD_LIMITS = Object.freeze({
  allowedExtensions: Object.freeze(['csv', 'json', 'parquet', 'xlsx']),
  maxFiles: Number(import.meta.env.VITE_MAX_UPLOAD_FILE_COUNT || 25),
  maxFileSizeBytes: Number(import.meta.env.VITE_MAX_UPLOAD_BYTES || 50 * 1024 * 1024),
  maxTotalSizeBytes: Number(import.meta.env.VITE_MAX_UPLOAD_TOTAL_BYTES || 50 * 1024 * 1024),
});

// POST /upload_batch_files — multipart, one `file` part per file plus the
// source window id as `session_id`.
export const uploadBatchFiles = async (apiFetch, { sourceSessionId, files, signal }) => {
  const formData = new FormData();
  files.forEach((file) => formData.append('file', file));
  formData.append('session_id', normalizeSessionId(sourceSessionId));
  try {
    const data = await apiFetch('/upload_batch_files', { method: 'POST', body: formData, signal });
    const ok = isSuccessResponse(data);
    return { data, ok, message: ok ? 'Dataset uploaded!' : sanitizeBackendUserMessage(data?.message, 'The dataset could not be uploaded.') };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { data: error?.data, ok: false, message: getSharedApiErrorMessage(error, 'The dataset could not be uploaded.'), error };
  }
};

// ------------------------------------------------------------- dataframe ---

const toList = (value) => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
};
const pickValue = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

// The backend answers create_DF either with a named object or the legacy
// positional array [actions, source, columns, totalColumns, totalRows, rules,
// storage, tool]; both become one named shape here.
export const normalizeDataframeInfo = (results) => {
  const source = results && typeof results === 'object' && !Array.isArray(results) ? results : {};
  // Positional fallback only for arrays (or {"0": ..} objects); named objects
  // must not have unrelated values picked up by index.
  const sourceKeys = Object.keys(source);
  const isIndexedObject = sourceKeys.length > 0 && sourceKeys.every((key) => /^\d+$/.test(key));
  const legacy = Array.isArray(results) ? results : isIndexedObject ? Object.values(source) : [];
  const asText = (value) => (value == null || typeof value === 'object' ? '' : String(value));
  const columns = toList(pickValue(source.columns, source.column_names, source.dataframe_columns, source.headers, legacy[2]))
    .map((column) => String(column));
  const totalColumns = Number(pickValue(source.total_columns, source.totalColumns, source.column_count, source.columnCount, source.columns_count, source.num_columns, legacy[3], columns.length));
  const totalRows = pickValue(source.total_rows, source.totalRows, source.row_count, source.rowCount, source.rows_count, source.num_rows, source.rows, legacy[4]);

  return {
    actions: toList(pickValue(source.actions, source.action_options, source.available_actions, legacy[0])).map(String),
    source: asText(pickValue(source.broker_api, source.brokerApi, source.broker, source.api, source.source, source.source_name, source.sourceName, legacy[1])),
    columns,
    totalColumns: Number.isFinite(totalColumns) ? totalColumns : columns.length,
    totalRows: totalRows ?? 0,
    rules: toList(pickValue(source.rules, source.analysis_rules, source.link_analysis_rules, legacy[5])).map(String),
    storage: asText(pickValue(source.storage, source.storage_name, source.storageName, source.dataset, source.dataframe, source.dataframe_name, source.dataframeName, legacy[6])),
    tool: asText(pickValue(source.tool, source.tool_name, source.toolName, source.graph_tool, legacy[7])),
  };
};

const normalizeCompletedDataframeJob = (data) => {
  const nestedResponse = data?.results?.result ?? data?.results?.response ?? data?.result?.result ?? data?.result?.response ?? data?.response;
  if (nestedResponse && typeof nestedResponse === 'object') {
    if (nestedResponse.results || nestedResponse.message) return { ...nestedResponse, message: nestedResponse.message || 'success' };
    return { ...data, message: data?.message || 'success', results: nestedResponse };
  }
  if (data?.results && !JOB_SUCCESS_STATUSES.has(getJobStatus(data?.results))) return { ...data, message: data.message || 'success' };
  return { ...data, message: data?.message || 'success', results: data?.data ?? data?.result?.data ?? data?.result ?? data?.results };
};

export const formatDataframeFailureMessage = (errorOrData, fallback) => {
  const data = errorOrData?.jobResult ?? errorOrData?.data ?? errorOrData;
  const results = data?.results ?? data?.result ?? data;
  const failedSources = Array.isArray(results?.failed_sources) ? results.failed_sources
    : Array.isArray(results?.failedSources) ? results.failedSources : [];
  const base = errorOrData?.message && String(errorOrData.message).toLowerCase() !== 'success'
    ? errorOrData.message
    : data?.message || fallback;
  const cleanBase = sanitizeBackendUserMessage(base, fallback);
  if (failedSources.length === 0) return cleanBase;
  const sourceText = failedSources.slice(0, 5)
    .map((item) => (typeof item === 'string' ? item : (item?.name || item?.source || item?.path || JSON.stringify(item))))
    .join('; ');
  const suffix = failedSources.length > 5 ? '; and ' + (failedSources.length - 5) + ' more' : '';
  return cleanBase + ' Failed sources: ' + sourceText + suffix;
};

// Broker / REST API input: the backend reads straight from the address.
export const buildAddressDataframePayload = ({ sourceSessionId, addressType, address, topic }) => {
  const cleanAddress = String(address || '').trim();
  return {
    id: 'create_DF',
    type: addressType,
    kind: 'address',
    session_id: normalizeSessionId(sourceSessionId),
    value: cleanAddress,
    address: cleanAddress,
    broker: cleanAddress,
    broker_url: cleanAddress,
    topic: topic == null ? null : String(topic).trim(),
  };
};

// Uploaded files ('files'), storage picks ('hdfs') or Elastic picks ('hybrid').
export const buildArrayDataframePayload = ({ sourceSessionId, kind, items }) => ({
  id: 'create_DF',
  type: 'array',
  kind,
  session_id: normalizeSessionId(sourceSessionId),
  value: items,
});

// POST /live_batch_files {id:'create_DF'}; follows a queued job when needed.
export const createDataframe = async (apiFetch, payload, { signal, onQueued } = {}) => {
  let data = await apiFetch('/live_batch_files', { method: 'POST', body: payload, signal });
  if (isQueuedJobResponse(data)) {
    onQueued?.({ jobId: getQueuedJobId(data), response: data });
    const result = await pollJob(apiFetch, getQueuedPollPath(data), { intervalMs: 2000, label: 'dataframe', signal });
    data = normalizeCompletedDataframeJob(result);
  }
  return { data, ok: isSuccessResponse(data), info: normalizeDataframeInfo(data?.results) };
};

// ---------------------------------------------------------------- search ---

export const SEARCH_PAGE_SIZE = 50;

// Search responses arrive in several envelopes (direct, results.result, data,
// completed job result); flattens them like production's normalizeSearchResponse.
export const normalizeSearchResponse = (data) => {
  const response = data?.results?.result && typeof data.results.result === 'object'
    ? data.results.result
    : data?.result && typeof data.result === 'object' && Array.isArray(data.result.results)
      ? data.result
      : data?.data && typeof data.data === 'object' && Array.isArray(data.data.results)
        ? data.data
        : Array.isArray(data?.results?.results)
          ? data.results
          : data;
  const results = Array.isArray(response?.results) ? response.results : [];
  const hasMore = response?.has_more === true || response?.has_more === 1 || response?.has_more === '1';
  const nextOffset = Number(response?.next_offset);
  return {
    results,
    hasMore,
    // Raw backend paging cursor when provided (backend request B-8).
    nextOffset: Number.isFinite(nextOffset) && response?.next_offset !== undefined && response?.next_offset !== null ? nextOffset : null,
    message: String(response?.message ?? data?.message ?? ''),
    // Raw (HDFS) searches report where they looked when nothing matched.
    diagnostics: {
      basePath: response?.base_path ?? null,
      storage: response?.storage ?? null,
      errors: response?.errors ?? null,
    },
  };
};

// Storage file entry as the backend expects it back in create_DF's `value`.
export const toStorageFileItem = (file) => ({
  name: String(file?.name || ''),
  size: file?.size ?? '',
  date: file?.date ?? '',
  path: file?.path ?? '',
  type: file?.type ?? '',
});

// Hybrid (Elastic + Hive) result as production sends it back in create_DF.
export const toHybridResultItem = (item, { strict = false, column = '' } = {}) => ({
  name: String(item?.name || ''),
  keyword: item?.keyword ?? '',
  size: item?.size ?? '',
  strict: item?.strict ?? strict,
  type: item?.type ?? '',
  column: item?.column ?? column,
});

export const storageFileKey = (file) => `${file?.name || ''}__${file?.size ?? ''}`;

// POST /live_batch_files {id:'search'}. `hybrid:false` is the raw HDFS file
// search; hybrid (Elastic + Hive) adds strict_mood / search_column.
export const searchSourceFiles = async (apiFetch, {
  sourceSessionId,
  keyword,
  date = '',
  dateFrom = '',
  dateTo = '',
  offset = 0,
  limit = SEARCH_PAGE_SIZE,
  hybrid = false,
  strictMode = false,
  searchColumn = '',
  signal,
  onQueued,
}) => {
  // A date range goes as start_date / end_date (backend request B-19); a
  // one-day range also fills the existing `date` field the backend already
  // filters on. Open-ended ranges (only a start or only an end) leave `date`
  // empty so they are not narrowed to a single day.
  const from = dateFrom || '';
  const to = dateTo || '';
  const singleDay = date || (from && from === to ? from : '');
  const value = { keyword, date: singleDay || null, hybrid, offset, limit };
  if (from || to) {
    value.start_date = from || null;
    value.end_date = to || null;
  }
  if (hybrid) {
    value.strict_mood = Boolean(strictMode);
    if (searchColumn) value.search_column = searchColumn;
  }
  const payload = { id: 'search', value, session_id: normalizeSessionId(sourceSessionId) };
  let data = await apiFetch('/live_batch_files', { method: 'POST', body: payload, signal });
  if (isQueuedJobResponse(data)) {
    onQueued?.({ jobId: getQueuedJobId(data), response: data });
    data = await pollJob(apiFetch, getQueuedPollPath(data), { intervalMs: 1500, label: 'search', signal });
  }
  return normalizeSearchResponse(data);
};

export { isSuccessResponse };

/* ── Streaming (production batch_input_form_swap page_IV / terminate) ── */

// Log file the backend streams over the socket (several response shapes).
export const resolveStreamLogFile = (response) => {
  if (typeof response?.results === 'string') return response.results.trim();
  return String(
    response?.results?.log_file ?? response?.results?.logFile ??
    response?.job?.payload?.log_file ?? response?.job?.payload?.logFile ??
    response?.results?.job?.payload?.log_file ?? response?.results?.job?.payload?.logFile ??
    response?.payload?.log_file ?? response?.payload?.logFile ??
    response?.log_file ?? response?.logFile ??
    response?.result?.log_file ?? response?.result?.logFile ?? ''
  ).trim();
};

export const getStreamingErrorMessage = (input, fallback = 'The streaming request failed. Please try again.') => {
  const payload = getApiProblemPayload(input);
  const message = String(payload?.message || input?.message || '').trim();
  const detail = String(payload?.detail || '').trim();
  const resultsText = typeof payload?.results === 'string' ? payload.results.trim() : '';
  if (message === 'Missing action_id or session_id') return 'Streaming request is missing required session state.';
  if (message === 'Invalid stream value') return 'Streaming settings were incomplete.';
  const refusal = getServiceRefusalCode(input);
  if (refusal) {
    const text = getServiceRefusalMessage(input);
    if (text) return text;
  }
  if (message === 'neo4j_not_connected_for_session') return detail ? `Neo4j is not connected for this session. ${sanitizeBackendUserMessage(detail, '')}`.trim() : 'Neo4j is not connected for this session.';
  if (message === 'failed!' && resultsText) return sanitizeBackendUserMessage(resultsText, fallback);
  if (String(payload?.error || '').startsWith('Invalid action:')) return 'Unsupported action.';
  return getSharedApiErrorMessage(input, fallback);
};

// Body for /live_batch_files {id:'stream'} (production payload).
// dataframeFilter: the analyst's filter as the Service reads it
// (features/source/lib/dataframeFilter.js filterPayload; B-27), or null.
export const buildStreamPayload = ({ sourceSessionId, mode, tool, action, rule, source, target, relationship, dataframeFilter = null }) => {
  const sessionKey = normalizeSessionId(sourceSessionId);
  const sourceMode = mode === 'realtime' ? 'realtime' : 'batch';
  const needsSourceTarget = action === 'Source / Target Relationship';
  return {
    id: 'stream',
    session_id: sessionKey,
    mode: sourceMode,
    source_mode: sourceMode,
    value: {
      window_id: sessionKey,
      session_id: sessionKey,
      mode: sourceMode,
      source_mode: sourceMode,
      tool,
      action,
      rule,
      ...(needsSourceTarget ? { source, target, relationship: relationship || 'HAS_RELATIONSHIP' } : {}),
      ...(dataframeFilter ? { dataframe_filter: dataframeFilter } : {}),
    },
  };
};

// The effect of a dataframe filter before ingestion (B-28): POST
// /live_batch_files { id: 'preview_DF_filter', session_id, value: {
// session_id, dataframe_filter, source?, target? } } (source and target so
// the Service also refuses stripping them). -> { available: true,
// totalRows, keptRows, keptColumns } or { available: false, message } (a
// live source, no saved dataframe, or a refusal with its reason).
export const previewDataframeFilter = async (apiFetch, { sourceSessionId, dataframeFilter, source = '', target = '' }, { signal } = {}) => {
  const sessionKey = normalizeSessionId(sourceSessionId);
  const unavailable = 'The Service cannot preview this filter; it is applied when the stream starts.';
  try {
    const data = await apiFetch('/live_batch_files', {
      method: 'POST',
      body: {
        id: 'preview_DF_filter',
        session_id: sessionKey,
        value: { session_id: sessionKey, dataframe_filter: dataframeFilter, ...(source ? { source } : {}), ...(target ? { target } : {}) },
      },
      signal,
    });
    if (String(data?.message || '') === 'preview_not_available') {
      const live = /live/i.test(String(data?.detail || ''));
      return { available: false, message: live ? 'A live (broker or API) source cannot be previewed; the filter is applied to each batch.' : sanitizeBackendUserMessage(data?.detail, unavailable) };
    }
    const results = data?.results ?? data?.result ?? data;
    const number = (...values) => {
      const found = values.find((value) => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value)));
      return found === undefined ? null : Number(found);
    };
    const totalRows = number(results?.total_rows, results?.totalRows);
    const keptRows = number(results?.kept_rows, results?.keptRows, results?.filtered_rows);
    if (!isSuccessResponse(data) || keptRows === null) {
      return { available: false, message: isSuccessResponse(data) ? unavailable : sanitizeBackendUserMessage(data?.message, unavailable) };
    }
    return { available: true, totalRows, keptRows, keptColumns: number(results?.kept_columns, results?.keptColumns) };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    if ([404, 405, 501].includes(Number(error?.status))) return { available: false, message: unavailable };
    return { available: false, message: getServiceRefusalMessage(error) || sanitizeBackendUserMessage(error?.data?.message || error?.message, unavailable) };
  }
};

// The run's task on the Service (H-7: the stream answer carries task_id).
export const resolveStreamTaskId = (response) => String(
  response?.results?.task_id ?? response?.task_id ?? response?.job?.payload?.task_id ?? response?.results?.job?.payload?.task_id ?? ''
).trim();

// Starts the stream. Returns { accepted, queued, logFile, pollPath, jobId, taskId, data, message }.
export const startStreamRequest = async (apiFetch, payload, { signal } = {}) => {
  try {
    const data = await apiFetch('/live_batch_files', { method: 'POST', body: payload, signal });
    const queued = isQueuedJobResponse(data) || data?.queued === true || String(data?.status || '').toLowerCase() === 'queued';
    const accepted = isSuccessResponse(data) || queued;
    return {
      accepted,
      queued,
      data,
      logFile: resolveStreamLogFile(data),
      pollPath: queued ? getQueuedPollPath(data) : null,
      jobId: getQueuedJobId(data),
      taskId: resolveStreamTaskId(data),
      message: accepted ? '' : getStreamingErrorMessage(data, 'The stream did not initialize. Check the selected action and try again.'),
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { accepted: false, queued: false, data: error?.data, message: getStreamingErrorMessage(error) };
  }
};

// Follows a queued stream job until the ingestion is running/finished.
export const waitForStreamJob = (apiFetch, pollPath, { signal } = {}) => pollJob(apiFetch, pollPath, { intervalMs: 1000, label: 'ingestion', signal });

// /live_batch_files {id:'end_session'}: stops the stream on the backend
// (production Terminate payload). `keepalive` lets the request finish after
// the page is gone (tab closed / signed out).
export const endStreamRequest = async (apiFetch, { sourceSessionId, logFile, keepalive = false }) => {
  const sessionKey = normalizeSessionId(sourceSessionId);
  try {
    const data = await apiFetch('/live_batch_files', {
      method: 'POST',
      ...(keepalive ? { keepalive: true } : {}),
      body: { id: 'end_session', session_id: sessionKey, value: { window_id: sessionKey, session_id: sessionKey, log_file: logFile || null } },
    });
    // Strict like production (data.message === "success"): a refusal such as
    // "No streaming found" also carries `results`, which isSuccessResponse
    // would accept.
    const message = String(data?.message || '').trim().toLowerCase();
    const ok = message === 'success' || message === 'success!' || data?.status === 'success' || data?.success === true;
    return { ok, data, message: ok ? '' : sanitizeBackendUserMessage(typeof data?.results === 'string' ? data.results : data?.message, 'No running stream was found for this session.') };
  } catch (error) {
    return { ok: false, data: error?.data, message: getSharedApiErrorMessage(error, 'The stream state could not be updated.') };
  }
};
