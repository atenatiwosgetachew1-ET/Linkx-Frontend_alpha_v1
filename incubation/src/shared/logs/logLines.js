// Parsing for LogLines.jsx.
//
// Backend lines read "[10:00:01] [Info] - message" (the stamp may carry the
// date); our own entries carry { at: 'YYYY-MM-DD HH:MM:SS', level }.

const BACKEND_LINE_RE = /^\s*\[([^\]]{4,32})\]\s*(?:\[([A-Za-z]+)\]\s*)?(?:-\s*)?([\s\S]*)$/;
const CLOCK_RE = /(\d{1,2}:\d{2}:\d{2})/;
const LEVELS = { warning: 'warn', warn: 'warn', error: 'error', critical: 'error', fatal: 'error', success: 'success', debug: 'debug' };
// Lines that carry the backend's flag counts (behind the Tasks verdict).
const FLAG_LINE_RE = /\bflags?\s*[:=]\s*\{\s*['"]/i;

export const MAX_RENDERED_LOG_LINES = 2000;

export const toLogLine = (entry = {}) => {
  let time = '';
  let level = String(entry.level || 'info').toLowerCase();
  let text = String(entry.message ?? '');
  if (entry.source === 'backend') {
    const match = BACKEND_LINE_RE.exec(text);
    if (match) {
      [, time, level = 'info', text] = match;
      level = level.toLowerCase();
    }
  } else {
    time = String(entry.at || '');
  }
  const clock = CLOCK_RE.exec(time);
  return {
    time: clock ? clock[1] : time,
    stamp: time,
    level: LEVELS[level] || 'info',
    text,
    flagged: FLAG_LINE_RE.test(text),
  };
};
