export const appConfig = {
  apiUrl: import.meta.env.VITE_API_URL,
  allowedSsoOrigins: [
    ...String(import.meta.env.VITE_SSO_ALLOWED_ORIGINS || '').split(','),
    ...String(import.meta.env.VITE_HEADER_ALLOWED_ORIGINS || '').split(','),
  ].map((origin) => origin.trim()).filter(Boolean),
};
