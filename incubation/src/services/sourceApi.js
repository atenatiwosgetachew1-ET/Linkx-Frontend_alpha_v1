import { authRequest } from './authApi.js';

export const buildSourceSessionId = (windowId, sessionId) => `${windowId}_${sessionId}`;

export const initializeSourceWindow = async (apiUrl, token, { sessionId, windowId }) => {
  const cleanSessionId = String(sessionId || '').trim();
  const cleanWindowId = String(windowId || '').trim();
  if (!cleanSessionId) throw new Error('Main session is not initialized.');
  if (!cleanWindowId) throw new Error('Source window id is not available.');

  const payload = {
    id: 'source_window',
    session_id: cleanSessionId,
    window_id: Number.isNaN(Number(cleanWindowId)) ? cleanWindowId : Number(cleanWindowId),
  };

  const data = await authRequest(apiUrl, '/init_source', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requireBearerToken(token),
    },
    body: JSON.stringify(payload),
  });

  const sourceSessionId = String(
    data?.results?.source_id ??
    data?.results?.session_id ??
    data?.source_id ??
    data?.session_id ??
    buildSourceSessionId(cleanWindowId, cleanSessionId)
  );

  return {
    data,
    sourceSessionId,
    parentSessionId: cleanSessionId,
    windowId: cleanWindowId,
  };
};

const requireBearerToken = (token) => {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) throw new Error('Authentication is required.');
  return { Authorization: `Bearer ${cleanToken}` };
};

const successMessages = new Set(['success', 'Connection established!', 'Connected!', 'Disconnected!']);

const isSourceSuccess = (data) => (
  successMessages.has(data?.message) ||
  data?.status === 'success' ||
  data?.results?.status === 'success'
);

export const connectSource = async (apiUrl, token, payload) => {
  const data = await authRequest(apiUrl, '/connect_to_source', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requireBearerToken(token),
    },
    body: JSON.stringify(payload),
  });
  return { data, ok: isSourceSuccess(data), message: data?.message || '' };
};

export const disconnectSource = async (apiUrl, token, payload) => {
  const data = await authRequest(apiUrl, '/disconnect_source', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requireBearerToken(token),
    },
    body: JSON.stringify(payload),
  });
  return { data, ok: isSourceSuccess(data), message: data?.message || '' };
};

export const connectTool = async (apiUrl, token, payload) => {
  const data = await authRequest(apiUrl, '/connect_to_tool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requireBearerToken(token),
    },
    body: JSON.stringify(payload),
  });
  return { data, ok: isSourceSuccess(data), message: data?.message || '' };
};

export const disconnectTool = async (apiUrl, token, payload) => {
  const data = await authRequest(apiUrl, '/disconnect_tool', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requireBearerToken(token),
    },
    body: JSON.stringify(payload),
  });
  return { data, ok: isSourceSuccess(data), message: data?.message || '' };
};

export const closeSourceWindow = async (apiUrl, token, { sessionId, windowId, reason = 'user_closed_window' }) => {
  const cleanSessionId = String(sessionId || '').trim();
  const cleanWindowId = String(windowId || '').trim();
  if (!cleanSessionId || !cleanWindowId) return null;

  return authRequest(apiUrl, '/close_source_window', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...requireBearerToken(token),
    },
    body: JSON.stringify({
      id: 'close_source_window',
      session_id: cleanSessionId,
      window_id: Number.isNaN(Number(cleanWindowId)) ? cleanWindowId : Number(cleanWindowId),
      reason,
    }),
  });
};
