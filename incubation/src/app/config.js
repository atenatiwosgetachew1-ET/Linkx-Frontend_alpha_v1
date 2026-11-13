export const appConfig = {
  // Dev server proxies /backend -> VITE_API_URL (vite.config.js) to avoid CORS.
  apiUrl: import.meta.env.DEV ? '/backend' : import.meta.env.VITE_API_URL,
  authDisabled: String(import.meta.env.VITE_DISABLE_AUTH || '').toLowerCase() === 'true',
  allowedSsoOrigins: [
    ...String(import.meta.env.VITE_SSO_ALLOWED_ORIGINS || '').split(','),
    ...String(import.meta.env.VITE_HEADER_ALLOWED_ORIGINS || '').split(','),
  ].map((origin) => origin.trim()).filter(Boolean),
};
