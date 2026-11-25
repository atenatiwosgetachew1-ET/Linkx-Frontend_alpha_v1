// Streams the backend may still be running, per Source window.
//
// A stream is "active" from the moment /live_batch_files {id:'stream'} is sent
// until it completes, fails or is terminated. Any other way out of the window
// abandons it: the window closes, the analyst signs out (or the idle timeout
// does), or the start request is cancelled. Each sends the same closing
// request the production Terminate button sends (log_stream_unplug +
// end_session), unless the Service granted the run a seat to go on without its
// owner (tasks/lib/unattendedSeats.js). A closed or reloaded page sends
// nothing: the Service stops a run without a seat 2 minutes after its owner's
// last browser is gone (R2-19).
//
// Kept outside React/window state so it is readable from the workspace frame
// (close, sign-out, pagehide) without the Source window being mounted.

import { endStreamRequest } from '../../../services/sourceApi.js';
import { createLogger } from '../../../shared/logger.js';
import { unplugStreamLog } from './streamLogs.js';

const log = createLogger('source.streams');
const active = new Map(); // windowId -> { sourceSessionId, logFile }

export const markStreamActive = (windowId, { sourceSessionId, logFile = '' }) => {
  if (!sourceSessionId) return;
  active.set(String(windowId), { sourceSessionId: String(sourceSessionId), logFile: String(logFile || '') });
};

export const setActiveStreamLogFile = (windowId, logFile) => {
  const entry = active.get(String(windowId));
  if (entry && logFile) entry.logFile = String(logFile);
};

export const markStreamEnded = (windowId) => {
  active.delete(String(windowId));
};

export const getActiveStream = (windowId) => active.get(String(windowId)) || null;

export const hasActiveStreams = () => active.size > 0;

// Sends the closing request for one window's stream, if it has one.
// `keepalive` lets the request outlive the page (pagehide / sign-out).
// Resolves to the endStreamRequest result, or null when nothing was running.
export const endAbandonedStream = async (apiFetch, windowId, { reason, keepalive = false } = {}) => {
  const entry = getActiveStream(windowId);
  if (!entry) return null;
  markStreamEnded(windowId);
  unplugStreamLog(windowId);
  const result = await endStreamRequest(apiFetch, { sourceSessionId: entry.sourceSessionId, logFile: entry.logFile, keepalive });
  if (result.ok) log.info('Abandoned stream closed', { reason, sessionId: entry.sourceSessionId });
  else log.warn('Abandoned stream close not confirmed', { reason, sessionId: entry.sourceSessionId, message: result.message });
  return result;
};

// Signed out: runs with a seat go on at the Service; this page is done with them.
export const forgetActiveStreams = () => active.clear();

// Every running stream at once (sign-out, tab closed), but those of the
// windows in `except` (they have a seat).
export const endAllAbandonedStreams = (apiFetch, { reason, keepalive = true, except = new Set() } = {}) => Promise.all(
  [...active.keys()].filter((windowId) => !except.has(windowId)).map((windowId) => endAbandonedStream(apiFetch, windowId, { reason, keepalive })),
);
