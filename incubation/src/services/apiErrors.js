// User-facing messages for backend failures. Ported from the production app's
// getApiProblem* / get*ErrorMessage helpers so both apps word errors the same.

export const getApiProblemPayload = (input) => {
  if (input?.data && typeof input.data === 'object') return input.data;
  if (input?.jobResponse && typeof input.jobResponse === 'object') return input.jobResponse;
  if (input && typeof input === 'object') return input;
  return {};
};

export const getApiProblemStatus = (input) => {
  const payload = getApiProblemPayload(input);
  const status = Number(input?.status ?? payload?.__httpStatus ?? 0);
  return Number.isFinite(status) ? status : 0;
};

const getApiProblemMessage = (input) => {
  const payload = getApiProblemPayload(input);
  return String(payload?.message ?? payload?.error ?? input?.message ?? '').trim();
};

export const getSharedApiErrorMessage = (input, fallback = 'Something went wrong. Please try again.') => {
  const status = getApiProblemStatus(input);
  const message = getApiProblemMessage(input).toLowerCase();
  if (status === 401 || message === 'unauthorized') return 'Your session expired. Please sign in again.';
  if (status === 403 || message === 'forbidden') return 'You do not have access to do that.';
  if (status === 413 || message === 'payload_too_large') return 'The request was too large. Reduce file size or payload size and try again.';
  return fallback;
};

// Strips internal identifiers/codes out of backend text before showing it.
export const sanitizeBackendUserMessage = (message, fallback = 'Operation failed.') => {
  const normalized = String(message || '').trim();
  if (!normalized) return fallback;
  // HTML pages, stack traces and very long dumps are never user-facing.
  if (/<\/?[a-z][^>]*>/i.test(normalized)) return fallback;
  if (/Traceback \(most recent call last\)|\bat [\w.$]+ \(|Exception:|\.py", line \d+/i.test(normalized)) return fallback;
  if (normalized.length > 300) return fallback;
  if (/tool_credentials/i.test(normalized)) return 'Neo4j connection details are missing for this session.';
  if (/password_ref/i.test(normalized)) return 'Please enter the Neo4j password again.';
  if (/(session_id|source_id|invalid_fields|validation_error|internal_server_error|payload_too_large|not_found)/i.test(normalized)) return fallback;
  if (/^failed!$/i.test(normalized)) return fallback;
  return normalized;
};

export const getConnectSourceErrorMessage = (input, fallback = 'Connection failed!') => {
  const payload = getApiProblemPayload(input);
  const candidates = [
    payload?.message,
    payload?.detail,
    payload?.error,
    payload?.results?.message,
    payload?.results?.detail,
    payload?.results?.error,
    typeof payload?.results === 'string' ? payload.results : '',
    input?.message,
    input?.error,
    typeof input === 'string' ? input : '',
  ];
  const directMessage = candidates.map((value) => String(value || '').trim()).find(Boolean);
  if (!directMessage || /^failed!$/i.test(directMessage)) return fallback;
  return sanitizeBackendUserMessage(directMessage, fallback);
};

export const getDisconnectSourceErrorMessage = (input, fallback = 'Could not disconnect source. Try again.') => {
  const detail = String(getApiProblemPayload(input)?.detail || '').trim();
  if (detail === 'session_id_required') return 'Missing session.';
  return getSharedApiErrorMessage(input, fallback);
};

export const getConnectToolErrorMessage = (input, fallback = 'Could not connect to Neo4j. Check the connection details and try again.') => {
  const payload = getApiProblemPayload(input);
  const status = getApiProblemStatus(input);
  const message = String(payload?.message || '').trim();
  const detail = String(payload?.detail || '').trim();
  if (status === 400 && message === 'validation_error') {
    if (detail === 'json_body_required') return 'Request body missing.';
    if (detail === 'json_object_required') return 'Connection payload must be an object.';
    if (detail === 'session_id_and_source_id_must_match_for_connect_to_tool') return 'Session mismatch. Refresh and try again.';
    if (detail === 'Neo4j password is masked but no password_ref is available') return 'Please enter the Neo4j password again.';
    if (detail === 'missing_required_connection_fields') return 'Please complete the required connection fields.';
    // H-10: no password typed and none saved for this host.
    if (detail === 'password_required') return 'Enter the Neo4j password: none is saved for this host yet.';
  }
  if (String(payload?.status || '').toLowerCase() === 'error' && detail === 'neo4j_credential_persistence_failed') {
    return 'Connected check passed, but the session could not save the connection. Try again.';
  }
  return getSharedApiErrorMessage(input, fallback);
};

export const getDisconnectToolErrorMessage = (input, fallback = 'Could not disconnect tool. Try again.') => (
  getSharedApiErrorMessage(input, fallback)
);

// The Service's coded refusals (frontend alignment 2026-11-20: H-4, H-5,
// H-6, H-8, H-2) as user-facing text. `detail` is ready to show where the
// Service says so (session_limit, intake_not_complete,
// invalid_dataframe_filter). Returns '' for anything uncoded.
const CODE_MESSAGES = {
  not_assignee: 'Only the assignee of this alert (or a supervisor) can do that.',
  intake_not_complete: 'The alert’s data has not fully arrived.',
  analysis_running: 'An analysis of this alert is already running.',
  feedback_already_sent: 'Feedback was already sent for this alert; it stays locked.',
  analysis_start_failed: 'The analysis could not be queued. Try again.',
  too_many_analyses: 'You already have the maximum number of alert analyses running. Wait for one to finish.',
  analysis_capacity_reached: 'The Service is running the maximum number of alert analyses. Try again in a few minutes.',
  alert_too_large: 'The alert has too many records to analyse.',
  reassigned: 'The alert was reassigned; you can no longer send its feedback.',
  stale_task: 'This is not the alert’s latest analysis. Run it again or refresh.',
  not_analysed: 'The alert has not been analysed yet.',
  task_expired: 'The run has expired. Reconfirm it in Tasks first.',
  delivery_in_progress: 'The feedback is already being sent.',
  delivery_failed: 'The parent service could not be reached.',
  image_too_large: 'An image is larger than 3 MB.',
  feedback_not_configured: 'The parent service’s address is not set on the Service.',
  task_not_completed: 'Only a run that finished successfully can be saved.',
  graph_unavailable: 'The run’s graph cannot be reached right now. Retry, or save without the graph.',
  session_limit: 'All analysis sessions are in use.',
  alerts_read_all_required: 'Your account cannot see every alert.',
  session_not_owned: 'This session belongs to another user.',
};
const SHOW_DETAIL = new Set(['session_limit', 'intake_not_complete', 'invalid_dataframe_filter', 'delivery_failed']);

export const getServiceRefusalCode = (input) => {
  const payload = getApiProblemPayload(input);
  const code = String(payload?.code || '').trim();
  if (code) return code;
  const message = String(payload?.message || '').trim();
  if (message === 'session_limit' || message === 'invalid_dataframe_filter') return message;
  const detail = String(payload?.detail || '').trim();
  if (detail === 'alerts_read_all_required' || detail === 'session_not_owned' || detail === 'password_required') return detail;
  if (payload?.permission) return 'permission';
  return '';
};

export const getServiceRefusalMessage = (input) => {
  const payload = getApiProblemPayload(input);
  const code = getServiceRefusalCode(input);
  if (!code) return '';
  if (code === 'permission') return `Your account lacks the “${String(payload.permission).slice(0, 60)}” permission.`;
  const detail = sanitizeBackendUserMessage(payload?.detail, '');
  if (SHOW_DETAIL.has(code) && detail) return detail;
  return CODE_MESSAGES[code] || detail || '';
};

// Users admin (/auth/admin/users): the Service answers a refused create or
// update with `400 validation_error` and puts the reason in `detail` (a
// code, a sentence, or a list of fields) or `invalid_fields`. Showing only
// "validation_error" hid the reason; this words it.
const USER_DETAIL_MESSAGES = [
  [/^(username_(taken|exists|already_exists|conflict)|user_(exists|already_exists)|duplicate_username)$/, 'That username is already taken.'],
  [/password/, 'The password does not meet the Service’s password rules.'],
  [/^(invalid|unknown|unsupported)_roles?$|^roles?_/, 'A selected role is not accepted by the Service.'],
  [/^(invalid|unknown|unsupported)_permissions?$|^permissions?_/, 'A selected permission is not accepted by the Service.'],
  [/^(invalid_)?username|^username_/, 'The username is not accepted (3–120 letters, digits, dots, dashes or underscores).'],
  [/display_name/, 'The display name is not accepted.'],
  [/^(cannot|forbidden_to)_.*(superuser|privilege|permission)|escalat/, 'Your account cannot grant that role or those permissions.'],
];
const humanizeCode = (code) => {
  const text = String(code).replace(/[_-]+/g, ' ').trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}.` : '';
};
const fieldName = (item) => {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  const loc = Array.isArray(item.loc) ? item.loc.filter((part) => part !== 'body').join('.') : '';
  return String(item.field || item.name || loc || '').trim();
};
const fieldLabel = (name) => String(name).replace(/_/g, ' ');

export const getUserAdminErrorMessage = (input, fallback = 'The user could not be saved.') => {
  const payload = getApiProblemPayload(input);
  const status = getApiProblemStatus(input);
  const refusal = getServiceRefusalMessage(input);
  if (refusal && status !== 400) return refusal;
  if (status === 409) return 'That username is already taken.';
  const detail = payload?.detail;
  const lists = [payload?.invalid_fields, payload?.fields, payload?.errors, Array.isArray(detail) ? detail : null].filter(Array.isArray);
  const names = [...new Set(lists.flat().map(fieldName).filter(Boolean))].slice(0, 6);
  if (typeof detail === 'string' && detail.trim()) {
    const text = detail.trim();
    if (/^[a-z][a-z0-9_:.-]*$/i.test(text)) {
      const known = USER_DETAIL_MESSAGES.find(([pattern]) => pattern.test(text.toLowerCase()));
      if (known) return known[1];
      if (text !== 'validation_error') return `The Service refused it: ${humanizeCode(text)}`;
    } else {
      const shown = sanitizeBackendUserMessage(text, '');
      if (shown) return shown;
    }
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const keys = Object.keys(detail).slice(0, 6);
    if (keys.length) return `The Service refused these fields: ${keys.map(fieldLabel).join(', ')}.`;
  }
  if (names.length) return `The Service refused these fields: ${names.map(fieldLabel).join(', ')}.`;
  if (status === 400) return `${fallback} The Service said the request was invalid but gave no reason.`;
  return getSharedApiErrorMessage(input, fallback);
};
