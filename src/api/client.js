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

export const createApiClient = ({ baseUrl, getToken, onUnauthorized, onForbidden, onLocked } = {}) => {
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

    if (!response.ok) {
      if (response.status === 401 && typeof onUnauthorized === "function") {
        onUnauthorized(data);
      }
      if (response.status === 403 && typeof onForbidden === "function") {
        onForbidden(data);
      }
      if (response.status === 423 && typeof onLocked === "function") {
        onLocked(data);
      }

      const message =
        data?.message ||
        data?.error ||
        (typeof data === "string" ? data : "") ||
        `Request failed with status ${response.status}`;
      throw new ApiError(message, { status: response.status, data });
    }

    return data;
  };
};
