// Live stream logs for Source windows (production's log_stream_plug /
// stream_logs / log_stream_unplug socket protocol).
//
// Lines live here, per window, outside workspace state: a busy stream would
// otherwise re-render the whole workspace on every line. Windows read them
// with useSyncExternalStore (subscribe/getLines). Listeners are notified at
// most every FLUSH_MS, and the buffer is capped at MAX_LINES.

import { formatLogTimestamp } from './sourceModel.js';

const FLUSH_MS = 200;
const MAX_LINES = 5000;
const EMPTY = Object.freeze([]);

const streams = new Map(); // windowId -> entry
let boundSocket = null;

const entryFor = (windowId) => {
  const key = String(windowId);
  if (!streams.has(key)) {
    streams.set(key, { sessionId: '', filename: '', lines: [], snapshot: EMPTY, listeners: new Set(), timer: null });
  }
  return streams.get(key);
};

const flush = (entry) => {
  entry.timer = null;
  entry.snapshot = entry.lines.slice();
  entry.listeners.forEach((listener) => listener());
};

const push = (entry, line) => {
  entry.lines.push(line);
  if (entry.lines.length > MAX_LINES) entry.lines.splice(0, entry.lines.length - MAX_LINES);
  if (!entry.timer) entry.timer = setTimeout(() => flush(entry), FLUSH_MS);
};

const handleStreamLogs = (payload = {}) => {
  const sessionId = String(payload.session_id ?? '').trim();
  if (!sessionId) return;
  streams.forEach((entry) => {
    if (entry.sessionId !== sessionId || !entry.filename) return;
    if (payload.error) {
      push(entry, { at: formatLogTimestamp(), level: 'warn', message: 'Log stream error.' });
      return;
    }
    // Backend lines end with a newline (that produced blank gaps) and carry
    // their own timestamp, so they are kept verbatim, one entry per line.
    String(payload.data ?? '').split(/\r?\n/).forEach((text) => {
      const line = text.trimEnd();
      if (line) push(entry, { at: formatLogTimestamp(), level: 'info', message: line, source: 'backend' });
    });
  });
};

// After a reconnect the backend forgets subscriptions: plug them again.
const replugAll = () => {
  streams.forEach((entry) => {
    if (entry.sessionId && entry.filename) boundSocket?.emit('log_stream_plug', { session_id: entry.sessionId, filename: entry.filename });
  });
};

const attachSocket = (socket) => {
  if (!socket || boundSocket === socket) return;
  if (boundSocket) {
    boundSocket.off('stream_logs', handleStreamLogs);
    boundSocket.off('connect', replugAll);
  }
  boundSocket = socket;
  socket.on('stream_logs', handleStreamLogs);
  socket.on('connect', replugAll);
};

export const plugStreamLog = (windowId, { socket, sessionId, filename }) => {
  if (!filename || !sessionId) return;
  attachSocket(socket);
  const entry = entryFor(windowId);
  if (entry.filename === filename && entry.sessionId === sessionId) return;
  if (entry.filename && boundSocket?.connected) {
    boundSocket.emit('log_stream_unplug', { session_id: entry.sessionId, filename: entry.filename });
  }
  entry.sessionId = String(sessionId);
  entry.filename = String(filename);
  if (boundSocket?.connected) boundSocket.emit('log_stream_plug', { session_id: entry.sessionId, filename: entry.filename });
};

export const unplugStreamLog = (windowId) => {
  const entry = streams.get(String(windowId));
  if (!entry?.filename) return;
  if (boundSocket?.connected) boundSocket.emit('log_stream_unplug', { session_id: entry.sessionId, filename: entry.filename });
  entry.filename = '';
};

export const getStreamLogFile = (windowId) => streams.get(String(windowId))?.filename || '';

// Local status lines (start, terminate, errors) share the same log.
export const appendStreamLog = (windowId, message, level = 'info') => {
  push(entryFor(windowId), { at: formatLogTimestamp(), level, message: String(message) });
};

export const clearStreamLog = (windowId) => {
  const entry = entryFor(windowId);
  entry.lines = [];
  flush(entry);
};

export const subscribeStreamLog = (windowId, listener) => {
  const entry = entryFor(windowId);
  entry.listeners.add(listener);
  return () => entry.listeners.delete(listener);
};

export const getStreamLogLines = (windowId) => streams.get(String(windowId))?.snapshot || EMPTY;

// Every line so far, including ones not yet flushed to listeners (used when
// a run's log is copied into its task).
export const peekStreamLogLines = (windowId) => streams.get(String(windowId))?.lines.slice() || [];

// Window closed: stop the stream subscription and forget the buffer.
export const disposeStreamLog = (windowId) => {
  const key = String(windowId);
  unplugStreamLog(key);
  const entry = streams.get(key);
  if (entry?.timer) clearTimeout(entry.timer);
  streams.delete(key);
};
