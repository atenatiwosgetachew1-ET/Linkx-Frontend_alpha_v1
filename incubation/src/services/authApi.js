const trimBaseUrl = (apiUrl = '') => String(apiUrl || '').replace(/\/$/, '');

const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const normalizeAuthUser = (value) => {
  if (!value || typeof value !== 'object') return null;
  const actorType = value.actor_type || value.actorType || (value.client_id ? 'service' : 'user');
  return {
    ...value,
    actor_type: actorType,
    roles: Array.isArray(value.roles) ? value.roles : [],
    permissions: Array.isArray(value.permissions) ? value.permissions : [],
  };
};

export const parseAuthResponse = (data, fallbackToken = null) => {
  const directUser = data?.username || data?.client_id || data?.permissions || data?.roles ? data : null;
  const user = normalizeAuthUser(
    data?.actor ||
    data?.user ||
    data?.payload?.actor ||
    data?.payload?.user ||
    data?.results?.actor ||
    data?.results?.user ||
    data?.results ||
    directUser
  );
  const token = data?.token || data?.access_token || data?.payload?.token || fallbackToken;
  return { user, token };
};

export const authRequest = async (apiUrl, path, options = {}) => {
  const response = await fetch(`${trimBaseUrl(apiUrl)}${path}`, options);
  const data = await parseJsonResponse(response);

  if (!response.ok) {
    const message = data?.message || data?.error || (typeof data === 'string' ? data : '') || `Auth request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
};

export const loginWithPassword = async (apiUrl, username, password) => {
  const data = await authRequest(apiUrl, '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return parseAuthResponse(data);
};

export const exchangeSsoCodeForAuth = async (apiUrl, { code, state = '', redirectUri }) => {
  const data = await authRequest(apiUrl, '/auth/sso/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      state,
      client: 'linkx_frontend',
      redirect_uri: redirectUri,
    }),
  });
  return parseAuthResponse(data);
};

export const verifyAuthToken = async (apiUrl, token) => {
  const data = await authRequest(apiUrl, '/auth/verify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token }),
  });
  return parseAuthResponse(data, token);
};

export const fetchCurrentActor = async (apiUrl, token) => {
  const data = await authRequest(apiUrl, '/auth/me', {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseAuthResponse(data, token);
};
