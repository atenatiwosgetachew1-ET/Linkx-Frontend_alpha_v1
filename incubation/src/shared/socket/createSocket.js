import { io } from 'socket.io-client';

// Opens the backend Socket.IO connection (log streaming, graph status,
// notifications). In dev the API lives behind the Vite `/backend` proxy, so the
// socket must use the page origin with a prefixed engine path — passing
// '/backend' straight to io() would be treated as a namespace.
export const createBackendSocket = (apiUrl, token) => {
  const base = String(apiUrl || '').trim().replace(/\/$/, '');
  const options = {
    auth: token ? { token } : {},
    transports: ['websocket'],
  };

  if (!base || base.startsWith('/')) {
    return io(window.location.origin, { ...options, path: `${base}/socket.io` });
  }
  return io(base, options);
};

// Resolves with the socket id once connected, or null after `timeoutMs`, so
// /init can register the socket without blocking the session on it.
export const waitForSocketId = (socket, timeoutMs = 2500) => new Promise((resolve) => {
  if (!socket) return resolve(null);
  if (socket.connected) return resolve(socket.id || null);
  const timer = setTimeout(() => {
    socket.off('connect', handleConnect);
    resolve(null);
  }, timeoutMs);
  function handleConnect() {
    clearTimeout(timer);
    resolve(socket.id || null);
  }
  socket.once('connect', handleConnect);
});
