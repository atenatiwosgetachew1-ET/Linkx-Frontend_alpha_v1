import { authRequest } from './authApi.js';

const SESSION_STORAGE_KEY = 'session';

export const extractMainSessionId = (data = {}) => (
  data?.results?.session_id ??
  data?.results?.sessionId ??
  data?.session_id ??
  data?.sessionId ??
  data?.configurations?.session_id ??
  data?.configurations?.sessionId ??
  null
);

export const extractMainSessionConfiguration = (data = {}) => (
  data?.results?.configuration ??
  data?.results?.configurations ??
  data?.configuration ??
  data?.configurations ??
  {}
);

export const initializeMainSession = async (apiUrl, token, { socketId = null } = {}) => {
  const existingSession = localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY) || null;
  const payload = {
    id: 'init',
    existing_session: existingSession,
    socket_id: socketId,
  };

  const data = await authRequest(apiUrl, '/init', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const sessionId = extractMainSessionId(data);
  if (sessionId) {
    localStorage.setItem(SESSION_STORAGE_KEY, String(sessionId));
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }

  return { data, sessionId: sessionId ? String(sessionId) : '' };
};