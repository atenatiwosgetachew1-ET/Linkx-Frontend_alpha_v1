// Central API client. Ported from the production client (src/api/client.js):
// bearer auth, JSON/FormData bodies, control-char sanitising and status hooks
// (401/403/413/423/429 + security-policy rejections). Feature services call
// the returned `apiFetch` instead of assembling fetch() calls themselves.

export class ApiError extends Error {
  constructor(message, { status, data } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

const joinUrl = (baseUrl, path) => {
  if (/^https?:\/\//i.test(path)) return path;
  return `${String(baseUrl || '').replace(/\/$/, '')}/${String(path || '').replace(/^\//, '')}`;
};

const sanitizeJsonPayload = (value) => {
  // eslint-disable-next-line no-control-regex
  if (typeof value === 'string') return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (Array.isArray(value)) return value.map(sanitizeJsonPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeJsonPayload(item)]));
  }
  return value;
};

const parseResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const isPlainObjectBody = (body) => (
  body &&
  typeof body === 'object' &&
  !(body instanceof FormData) &&
  !(body instanceof Blob) &&
  !(body instanceof ArrayBuffer) &&
  !(body instanceof URLSearchParams)
);

export const createApiClient = ({
  baseUrl,
  getToken,
  onUnauthorized,
  onForbidden,
  onLocked,
  onRateLimited,
  onSecurityPolicyBlocked,
  onPayloadTooLarge,
} = {}) => async function apiFetch(path, options = {}) {
  const {
    responseType,
    suppressUnauthorizedHandler,
    suppressForbiddenHandler,
    suppressLockedHandler,
    suppressRateLimitedHandler,
    suppressSecurityPolicyHandler,
    suppressPayloadTooLargeHandler,
    ...fetchOptions
  } = options;
  const headers = new Headers(fetchOptions.headers || {});
  const token = typeof getToken === 'function' ? getToken() : null;
  const plainBody = isPlainObjectBody(fetchOptions.body);

  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
  if (plainBody) headers.set('Content-Type', 'application/json');

  // String bodies (already JSON.stringify'd by a caller) are sanitised too.
  let body = fetchOptions.body;
  if (plainBody) body = JSON.stringify(sanitizeJsonPayload(body));

  let response;
  try {
    response = await fetch(joinUrl(baseUrl, path), { ...fetchOptions, headers, body });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // Network failure ("Failed to fetch"): one fixed, user-safe message.
    throw new ApiError('The server could not be reached. Check the connection and try again.', { status: 0, data: null });
  }
  const data = response.ok && responseType === 'blob' ? await response.blob() : await parseResponse(response);
  if (data && typeof data === 'object' && !(data instanceof Blob)) {
    Object.defineProperty(data, '__httpStatus', { value: response.status, enumerable: false });
  }

  if (response.ok) return data;

  const retryAfter = Number(data?.retry_after ?? response.headers.get('Retry-After') ?? 0) || 0;
  const requestMeta = {
    path: String(path || ''),
    method: String(fetchOptions.method || 'GET').toUpperCase(),
    status: response.status,
  };

  if (response.status === 401 && !suppressUnauthorizedHandler) onUnauthorized?.(data, requestMeta);
  if (response.status === 403 && !suppressForbiddenHandler) onForbidden?.(data, requestMeta);
  if (response.status === 400 && data?.message === 'Connection rejected by security policy.' && !suppressSecurityPolicyHandler) {
    onSecurityPolicyBlocked?.(data, requestMeta);
  }
  if (response.status === 423 && !suppressLockedHandler) onLocked?.(data, requestMeta);
  if (response.status === 429 && !suppressRateLimitedHandler) {
    onRateLimited?.({ ...(data && typeof data === 'object' ? data : {}), retry_after: retryAfter }, requestMeta);
  }
  if (response.status === 413 && !suppressPayloadTooLargeHandler) onPayloadTooLarge?.(data, requestMeta);

  const message = response.status === 429
    ? `Too many requests. Retry after ${retryAfter || 'a few'} seconds.`
    // Non-JSON bodies (proxy/HTML error pages, stack traces) are never shown.
    : (data && typeof data === 'object' ? data.message || data.error : '') || `Request failed with status ${response.status}.`;
  throw new ApiError(message, {
    status: response.status,
    data: data && typeof data === 'object' ? { ...data, retry_after: retryAfter } : data,
  });
};

// Shared success check used by the production app (isSuccessResponse).
export const isSuccessResponse = (data) => {
  const message = String(data?.message || '').trim().toLowerCase();
  return message === 'success' ||
    message === 'success!' ||
    data?.status === 'success' ||
    data?.success === true ||
    (Boolean(data?.results) && !data?.error);
};
