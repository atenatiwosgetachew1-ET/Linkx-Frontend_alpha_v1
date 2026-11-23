export const appConfig = {
  // Dev server proxies /backend -> VITE_API_URL (vite.config.js) to avoid CORS.
  apiUrl: import.meta.env.DEV ? '/backend' : import.meta.env.VITE_API_URL,
  authDisabled: String(import.meta.env.VITE_DISABLE_AUTH || '').toLowerCase() === 'true',
  allowedSsoOrigins: [
    ...String(import.meta.env.VITE_SSO_ALLOWED_ORIGINS || '').split(','),
    ...String(import.meta.env.VITE_HEADER_ALLOWED_ORIGINS || '').split(','),
  ].map((origin) => origin.trim()).filter(Boolean),
  // STR alerts from the parent service (analysis-results-plan Phase 4):
  // 'mock' feeds the workflow from a mock service; 'live' listens for the
  // Service's events (backend handoff H-3…H-5); anything else is off. In
  // development a switch in Reports ▸ Alert reports turns the mock on too.
  parentAlerts: String(import.meta.env.VITE_PARENT_ALERTS || (String(import.meta.env.VITE_MOCK_PARENT_ALERTS || '').toLowerCase() === 'true' ? 'mock' : '')).toLowerCase(),
  isDev: Boolean(import.meta.env.DEV),
};
