// Tiny leveled logger: one switch for all client logging.
// Level: VITE_LOG_LEVEL (debug | info | warn | error | silent); defaults to
// 'debug' in development and 'warn' in production builds. Payloads should be
// minimal (status codes, ids) — never secrets or backend bodies.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const resolveLevel = () => {
  const configured = String(import.meta.env?.VITE_LOG_LEVEL || '').toLowerCase();
  if (LEVELS[configured]) return LEVELS[configured];
  return import.meta.env?.DEV ? LEVELS.debug : LEVELS.warn;
};

const threshold = resolveLevel();

const emit = (level, scope, message, details) => {
  if (LEVELS[level] < threshold) return;
  const method = level === 'debug' ? 'log' : level;
  const prefix = `[${scope}]`;
  if (details === undefined) console[method](prefix, message);
  else console[method](prefix, message, details);
};

// createLogger('source') -> { debug, info, warn, error }
export const createLogger = (scope) => ({
  debug: (message, details) => emit('debug', scope, message, details),
  info: (message, details) => emit('info', scope, message, details),
  warn: (message, details) => emit('warn', scope, message, details),
  error: (message, details) => emit('error', scope, message, details),
});
