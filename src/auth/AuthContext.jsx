import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AUTH_TOKEN_KEY = "linkx_auth_token";
const SSO_CODE_PARAM = "sso_code";
const SSO_STATE_PARAM = "sso_state";
const PARENT_ACCESS_TOKEN_PARAM = "parent_access_token";
const AuthContext = createContext(null);
const AUTH_REQUEST_TIMEOUT_MS = 20000;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeUser = (value) => {
  if (!value || typeof value !== "object") return null;
  const actorType = value.actor_type || value.actorType || (value.client_id ? "service" : "user");
  return {
    ...value,
    actor_type: actorType,
    roles: Array.isArray(value.roles) ? value.roles : [],
    permissions: Array.isArray(value.permissions) ? value.permissions : [],
  };
};

const parseAuthResponse = (data, fallbackToken = null) => {
  const directUser = data?.username || data?.client_id || data?.permissions || data?.roles ? data : null;
  const user = normalizeUser(data?.actor || data?.user || data?.payload?.actor || data?.payload?.user || data?.results?.actor || data?.results?.user || data?.results || directUser);
  const token = data?.token || data?.access_token || data?.payload?.token || fallbackToken;
  return { user, token };
};

const authRequest = async (apiUrl, path, options = {}) => {
  const runRequest = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(String(apiUrl || "").replace(/\/$/, "") + path, {
        ...options,
        signal: controller.signal,
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;

      if (!response.ok) {
        const retryAfterSeconds = Number(data?.retry_after ?? response.headers.get("Retry-After") ?? 0) || 0;
        const error = new Error(
          response.status === 429
            ? "Too many sign-in attempts. Retry after " + (retryAfterSeconds || "a few") + " seconds."
            : data?.message || data?.error || "Auth request failed with status " + response.status
        );
        error.status = response.status;
        error.retryAfter = retryAfterSeconds;
        throw error;
      }

      return data;
    } catch (err) {
      if (err?.name === "AbortError") {
        throw new Error("Authentication service did not respond. Please try again later.");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  try {
    return await runRequest();
  } catch (err) {
    if (err?.status === 429 && err.retryAfter > 0 && options.retryOnRateLimit !== false) {
      await delay(Math.min(err.retryAfter, 30) * 1000);
      return runRequest();
    }
    throw err;
  }
};
const normalizeAllowedOrigins = (origins = []) => (
  Array.isArray(origins) ? origins : String(origins || "").split(",")
).map((origin) => String(origin || "").trim()).filter(Boolean);

const isTrustedSsoOrigin = (event, allowedOrigins = []) => {
  const origin = String(event?.origin || "");
  return origin && (origin === window.location.origin || allowedOrigins.includes(origin));
};

const readSsoParams = () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get(SSO_CODE_PARAM) || "";
  const state = params.get(SSO_STATE_PARAM) || params.get("state") || "";
  return { code, state };
};

const readParentAccessTokenParam = () => {
  const params = new URLSearchParams(window.location.search);
  return params.get(PARENT_ACCESS_TOKEN_PARAM) || params.get("access_token") || "";
};

const clearSsoParams = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete(SSO_CODE_PARAM);
  url.searchParams.delete(SSO_STATE_PARAM);
  url.searchParams.delete("state");
  url.searchParams.delete("sso_error");
  url.searchParams.delete(PARENT_ACCESS_TOKEN_PARAM);
  url.searchParams.delete("access_token");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
};

export function AuthProvider({ apiUrl, allowedSsoOrigins = [], children }) {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSsoAuthenticating, setIsSsoAuthenticating] = useState(false);
  const [ssoError, setSsoError] = useState("");

  const trustedSsoOrigins = useMemo(() => normalizeAllowedOrigins(allowedSsoOrigins), [allowedSsoOrigins]);

  useEffect(() => {
    // Clear any access token persisted by older frontend builds.
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }, []);

  const applyAuth = useCallback((nextToken, nextUser) => {
    const normalizedUser = normalizeUser(nextUser);
    if (!nextToken || !normalizedUser) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setToken("");
      setUser(null);
      return;
    }
    setToken(nextToken);
    setUser(normalizedUser);
    setSsoError("");
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setToken("");
    setUser(null);
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await authRequest(apiUrl, "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const auth = parseAuthResponse(data);
    applyAuth(auth.token, auth.user);
    return auth.user;
  }, [apiUrl, applyAuth]);

  const exchangeSsoCode = useCallback(async (code, state = "") => {
    const cleanCode = String(code || "").trim();
    const cleanState = String(state || "").trim();
    if (!cleanCode) return null;

    setIsSsoAuthenticating(true);
    setSsoError("");
    try {
      const data = await authRequest(apiUrl, "/auth/sso/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: cleanCode,
          state: cleanState,
          client: "linkx_frontend",
          redirect_uri: `${window.location.origin}${window.location.pathname}`,
        }),
      });
      const auth = parseAuthResponse(data);
      applyAuth(auth.token, auth.user);
      return auth.user;
    } catch (err) {
      setSsoError(err?.message || "Single sign-on failed.");
      throw err;
    } finally {
      setIsSsoAuthenticating(false);
    }
  }, [apiUrl, applyAuth]);

  const exchangeParentToken = useCallback(async (parentAccessToken, { useAuthorizationHeader = false } = {}) => {
    const cleanToken = String(parentAccessToken || "").trim();
    if (!cleanToken) return null;

    setIsSsoAuthenticating(true);
    setSsoError("");
    try {
      const data = await authRequest(apiUrl, "/auth/parent-token", {
        method: "POST",
        headers: useAuthorizationHeader
          ? { Authorization: `Bearer ${cleanToken}` }
          : { "Content-Type": "application/json" },
        body: useAuthorizationHeader ? undefined : JSON.stringify({ access_token: cleanToken }),
      });
      const auth = parseAuthResponse(data);
      applyAuth(auth.token, auth.user);
      return auth.user;
    } catch (err) {
      setSsoError(err?.message || "Parent sign-on failed.");
      throw err;
    } finally {
      setIsSsoAuthenticating(false);
    }
  }, [apiUrl, applyAuth]);

  const verifyToken = useCallback(async (incomingToken) => {
    const candidateToken = incomingToken || token;
    if (!candidateToken) return null;

    const data = await authRequest(apiUrl, "/auth/verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${candidateToken}`,
      },
      body: JSON.stringify({ token: candidateToken }),
    });
    const auth = parseAuthResponse(data, candidateToken);
    applyAuth(auth.token, auth.user);
    return auth.user;
  }, [apiUrl, applyAuth, token]);

  useEffect(() => {
    let cancelled = false;

    const restoreAuth = async () => {
      const parentAccessToken = readParentAccessTokenParam();
      if (parentAccessToken) {
        try {
          await exchangeParentToken(parentAccessToken);
        } catch {
          if (!cancelled) logout();
        } finally {
          clearSsoParams();
          if (!cancelled) setIsAuthReady(true);
        }
        return;
      }

      const sso = readSsoParams();
      if (sso.code) {
        try {
          await exchangeSsoCode(sso.code, sso.state);
        } catch {
          if (!cancelled) logout();
        } finally {
          clearSsoParams();
          if (!cancelled) setIsAuthReady(true);
        }
        return;
      }

      if (!token) {
        setIsAuthReady(true);
        return;
      }

      try {
        const data = await authRequest(apiUrl, "/auth/me", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
        });
        const auth = parseAuthResponse(data, token);
        if (!cancelled) applyAuth(auth.token, auth.user);
      } catch {
        if (!cancelled) logout();
      } finally {
        if (!cancelled) setIsAuthReady(true);
      }
    };

    restoreAuth();
    return () => {
      cancelled = true;
    };
  }, [apiUrl, applyAuth, exchangeParentToken, exchangeSsoCode, logout, token]);

  useEffect(() => {
    const handleSsoMessage = async (event) => {
      const data = event?.data || {};
      const messageType = data.type || data.action || "";
      if (!["linkx_sso", "linkx_sso_code", "authenticate"].includes(messageType)) return;
      if (!isTrustedSsoOrigin(event, trustedSsoOrigins)) return;

      const payload = data.payload && typeof data.payload === "object" ? data.payload : data;
      const code = payload.sso_code || payload.code || "";
      const state = payload.sso_state || payload.state || "";
      const parentAccessToken = payload.parent_access_token || payload.access_token || "";
      const incomingToken = payload.token || "";
      const tokenType = String(payload.token_type || payload.tokenType || "").toLowerCase();

      try {
        const verifiedUser = parentAccessToken || tokenType === "parent_access" || tokenType === "access"
          ? await exchangeParentToken(parentAccessToken || incomingToken)
          : code
            ? await exchangeSsoCode(code, state)
            : await verifyToken(incomingToken);
        event.source?.postMessage(
          { type: "linkx_sso_result", payload: { ok: !!verifiedUser, username: verifiedUser?.username || null } },
          event.origin
        );
      } catch (err) {
        event.source?.postMessage(
          { type: "linkx_sso_result", payload: { ok: false, message: err?.message || "Single sign-on failed." } },
          event.origin
        );
      }
    };

    window.addEventListener("message", handleSsoMessage);
    return () => window.removeEventListener("message", handleSsoMessage);
  }, [exchangeParentToken, exchangeSsoCode, trustedSsoOrigins, verifyToken]);

  const roles = user?.roles || [];
  const permissions = user?.permissions || [];

  const value = useMemo(() => ({
    user,
    actor: user,
    token,
    roles,
    permissions,
    isAuthenticated: Boolean(token && user),
    isAuthReady,
    isSsoAuthenticating,
    ssoError,
    login,
    logout,
    verifyToken,
    exchangeSsoCode,
    exchangeParentToken,
    hasRole: (role) => roles.includes(role),
    hasPermission: (permission) => permissions.includes(permission),
  }), [user, token, roles, permissions, isAuthReady, isSsoAuthenticating, ssoError, login, logout, verifyToken, exchangeSsoCode, exchangeParentToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
};
