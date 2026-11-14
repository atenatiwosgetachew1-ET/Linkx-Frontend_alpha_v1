const SESSION_STORAGE_KEY = 'session';

const isRealSessionId = (value) => {
  const normalized = String(value ?? '').trim();
  return Boolean(normalized) && !['null', 'undefined', 'nan'].includes(normalized.toLowerCase());
};

export const normalizeSessionId = (value) => (isRealSessionId(value) ? String(value).trim() : '');

const scalarOrNull = (value) => (typeof value === 'string' || typeof value === 'number' ? value : null);

export const extractMainSessionId = (data = {}) => normalizeSessionId(
  data?.results?.session_id ??
  data?.results?.sessionId ??
  data?.results?.id ??
  data?.session_id ??
  data?.sessionId ??
  data?.configurations?.session_id ??
  data?.configurations?.sessionId ??
  scalarOrNull(data?.results)
);

export const extractMainSessionConfiguration = (data = {}) => (
  data?.results?.configuration ??
  data?.results?.configurations ??
  data?.configuration ??
  data?.configurations ??
  {}
);

export const readStoredSessionId = () => normalizeSessionId(
  localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY)
);

// POST /init — creates or resumes the main analysis session. `socketId` lets
// the backend route socket events (logs, graph status) to this browser.
export const initializeMainSession = async (apiFetch, { socketId = null, requestOptions = {} } = {}) => {
  const data = await apiFetch('/init', {
    ...requestOptions,
    method: 'POST',
    body: {
      id: 'init',
      existing_session: readStoredSessionId() || null,
      socket_id: socketId,
    },
  });
  const sessionId = extractMainSessionId(data);
  if (sessionId) {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
  return { data, sessionId, configuration: extractMainSessionConfiguration(data) };
};

const extractConfigurationPayload = (data) => (
  data?.results?.configuration ??
  data?.results?.configurations ??
  data?.configuration ??
  data?.configurations ??
  data?.results ??
  {}
);

// Session-scoped configuration (also used per source window id).
export const loadSessionConfiguration = async (apiFetch, sessionId) => {
  const data = await apiFetch('/configuration', {
    method: 'POST',
    body: { id: 'load', session_id: sessionId },
  });
  return { data, configuration: extractConfigurationPayload(data) };
};

export const saveSessionConfiguration = (apiFetch, sessionId, configuration) => apiFetch('/configuration', {
  method: 'POST',
  body: { id: 'save', session_id: sessionId, configuration },
});

// Switches the session's domain pillar (production's Configuration > Domain
// switch). The backend re-projects storage targets and connection settings
// from the domain, so this is the only way to change the storage path.
export const switchSessionDomain = async (apiFetch, sessionId, domain, { signal } = {}) => {
  const data = await apiFetch('/configuration', {
    method: 'POST',
    body: { id: 'save', session_id: sessionId, domain },
    signal,
  });
  return { data, configuration: extractConfigurationPayload(data) };
};
