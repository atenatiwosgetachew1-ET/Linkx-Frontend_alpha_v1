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
  }
  if (String(payload?.status || '').toLowerCase() === 'error' && detail === 'neo4j_credential_persistence_failed') {
    return 'Connected check passed, but the session could not save the connection. Try again.';
  }
  return getSharedApiErrorMessage(input, fallback);
};

export const getDisconnectToolErrorMessage = (input, fallback = 'Could not disconnect tool. Try again.') => (
  getSharedApiErrorMessage(input, fallback)
);
