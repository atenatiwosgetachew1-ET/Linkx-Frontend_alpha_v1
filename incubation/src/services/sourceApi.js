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
      Authorization: `Bearer ${token}`,
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