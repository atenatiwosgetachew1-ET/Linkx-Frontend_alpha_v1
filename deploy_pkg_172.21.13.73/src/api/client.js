export class ApiError extends Error {
  constructor(message, { status, data } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

const joinUrl = (baseUrl, path) => {
  if (/^https?:\/\//i.test(path)) return path;
  return `${String(baseUrl || "").replace(/\/$/, "")}/${String(path || "").replace(/^\//, "")}`;
};

const sanitizeJsonPayload = (value) => {
  // eslint-disable-next-line no-control-regex
  if (typeof value === "string") return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (Array.isArray(value)) return value.map(sanitizeJsonPayload);
  if (value && typeof value === "object") {
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

export const createApiClient = ({ baseUrl, getToken, onUnauthorized, onForbidden, onLocked, onRateLimited, onSecurityPolicyBlocked, onPayloadTooLarge } = {}) => {
  return async function apiFetch(path, options = {}) {
    const headers = new Headers(options.headers || {});
    const token = typeof getToken === "function" ? getToken() : null;
    const isFormData = options.body instanceof FormData;
    const bodyIsPlainObject =
      options.body &&
      typeof options.body === "object" &&
      !isFormData &&
      !(options.body instanceof Blob) &&
      !(options.body instanceof ArrayBuffer);

    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    if (bodyIsPlainObject) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(joinUrl(baseUrl, path), {
      ...options,
      headers,
      body: bodyIsPlainObject ? JSON.stringify(sanitizeJsonPayload(options.body)) : options.body,
    });
    const data = await parseResponse(response);
    if (data && typeof data === "object") {
      Object.defineProperty(data, "__httpStatus", { value: response.status, enumerable: false });
    }

    if (!response.ok) {
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfter = Number(data?.retry_after ?? retryAfterHeader ?? 0) || 0;
      const requestMeta = {
        path: String(path || ""),
        method: String(options.method || "GET").toUpperCase(),
        status: response.status,
      };

      if (response.status === 401 && typeof onUnauthorized === "function" && !options.suppressUnauthorizedHandler) {
        onUnauthorized(data, requestMeta);
      }
      if (response.status === 403 && typeof onForbidden === "function" && !options.suppressForbiddenHandler) {
        onForbidden(data, requestMeta);
      }
      if (response.status === 400 && data?.message === "Connection rejected by security policy." && typeof onSecurityPolicyBlocked === "function" && !options.suppressSecurityPolicyHandler) {
        onSecurityPolicyBlocked(data, requestMeta);
      }
      if (response.status === 423 && typeof onLocked === "function" && !options.suppressLockedHandler) {
        onLocked(data, requestMeta);
      }
      if (response.status === 429 && typeof onRateLimited === "function" && !options.suppressRateLimitedHandler) {
        onRateLimited({ ...(data && typeof data === "object" ? data : {}), retry_after: retryAfter }, requestMeta);
      }
      if (response.status === 413 && typeof onPayloadTooLarge === "function" && !options.suppressPayloadTooLargeHandler) {
        onPayloadTooLarge(data, requestMeta);
      }

      console.error("[apiFetch non-ok response]", { path, status: response.status, data });

      const message = response.status === 429
        ? "Too many requests. Retry after " + (retryAfter || "a few") + " seconds."
        : data?.message ||
          data?.error ||
          (typeof data === "string" ? data : "") ||
          `Request failed with status ${response.status}`;
      throw new ApiError(message, { status: response.status, data: data && typeof data === "object" ? { ...data, retry_after: retryAfter } : data });
    }

    return data;
  };
};
