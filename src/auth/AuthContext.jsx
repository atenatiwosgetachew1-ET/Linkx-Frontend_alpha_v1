import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AUTH_TOKEN_KEY = "linkx_auth_token";
const PARENT_PROJECT_PKCE_KEY = "linkx_parent_project_pkce";
const PARENT_PROJECT_CALLBACK_PATH = "/auth/callback";
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
  return { user, token, parent: data?.parent || data?.results?.parent || null };
};

const base64UrlEncode = (bytes) => btoa(String.fromCharCode(...bytes))
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

const generatePkceString = (byteLength = 32) => {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
};

const createS256Challenge = async (codeVerifier) => {
  const bytes = new TextEncoder().encode(codeVerifier);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64UrlEncode(new Uint8Array(digest));
};

const readParentProjectConfig = () => ({
  authorizeUrl: String(import.meta.env.VITE_PARENT_PROJECT_AUTHORIZE_URL || "").trim(),
  clientId: String(import.meta.env.VITE_PARENT_PROJECT_CLIENT_ID || "").trim(),
  scope: String(import.meta.env.VITE_PARENT_PROJECT_SCOPE || "").trim(),
  redirectUri: String(import.meta.env.VITE_PARENT_PROJECT_REDIRECT_URI || "").trim(),
});

const getParentProjectRedirectUri = (configuredRedirectUri = "") => (
  configuredRedirectUri || `${window.location.origin}${PARENT_PROJECT_CALLBACK_PATH}`
);

const readParentProjectTransaction = () => {
  try {
    const raw = sessionStorage.getItem(PARENT_PROJECT_PKCE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const clearParentProjectTransaction = () => {
  sessionStorage.removeItem(PARENT_PROJECT_PKCE_KEY);
};

const clearParentProjectCallbackParams = () => {
  window.history.replaceState({}, document.title, import.meta.env.BASE_URL || "/");
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
export function AuthProvider({ apiUrl, children }) {
  const [token, setToken] = useState(() => localStorage.getItem(AUTH_TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSsoAuthenticating, setIsSsoAuthenticating] = useState(false);
  const [ssoError, setSsoError] = useState("");


  const applyAuth = useCallback((nextToken, nextUser) => {
    const normalizedUser = normalizeUser(nextUser);
    if (!nextToken || !normalizedUser) {
      localStorage.removeItem(AUTH_TOKEN_KEY);
      setToken("");
      setUser(null);
      return;
    }
    localStorage.setItem(AUTH_TOKEN_KEY, nextToken);
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

  const startParentProjectLogin = useCallback(async () => {
    const config = readParentProjectConfig();
    if (!config.authorizeUrl || !config.clientId) {
      const message = "Parent project login is not configured.";
      setSsoError(message);
      throw new Error(message);
    }
    if (!window.crypto?.subtle || !window.crypto?.getRandomValues) {
      const message = "Secure browser crypto is required for Parent project login.";
      setSsoError(message);
      throw new Error(message);
    }

    const codeVerifier = generatePkceString(64);
    const codeChallenge = await createS256Challenge(codeVerifier);
    const state = generatePkceString(32);
    const redirectUri = getParentProjectRedirectUri(config.redirectUri);

    sessionStorage.setItem(PARENT_PROJECT_PKCE_KEY, JSON.stringify({
      state,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      created_at: Date.now(),
    }));

    const authorizeUrl = new URL(config.authorizeUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", config.clientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    if (config.scope) authorizeUrl.searchParams.set("scope", config.scope);

    setIsSsoAuthenticating(true);
    setSsoError("");
    window.location.assign(authorizeUrl.toString());
  }, []);

  const exchangeParentProjectCode = useCallback(async ({ code, state }) => {
    const transaction = readParentProjectTransaction();
    const cleanCode = String(code || "").trim();
    const cleanState = String(state || "").trim();

    if (!transaction?.state || !transaction?.code_verifier || !transaction?.redirect_uri) {
      throw new Error("Parent project login session was not found. Please start sign-in again.");
    }
    if (!cleanCode) {
      throw new Error("Parent project did not return an authorization code.");
    }
    if (!cleanState || cleanState !== transaction.state) {
      throw new Error("Parent project login state could not be verified.");
    }

    setIsSsoAuthenticating(true);
    setSsoError("");
    try {
      const data = await authRequest(apiUrl, "/api/auth/exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: cleanCode,
          code_verifier: transaction.code_verifier,
          redirect_uri: transaction.redirect_uri,
        }),
      });
      const auth = parseAuthResponse(data);
      applyAuth(auth.token, auth.user);
      clearParentProjectTransaction();
      return auth.user;
    } catch (err) {
      setSsoError(err?.message || "Parent project sign-in failed.");
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
      if (window.location.pathname === PARENT_PROJECT_CALLBACK_PATH) {
        const params = new URLSearchParams(window.location.search);
        try {
          if (params.get("error")) {
            throw new Error(params.get("error_description") || params.get("error") || "Parent project sign-in was cancelled.");
          }
          await exchangeParentProjectCode({ code: params.get("code"), state: params.get("state") });
        } catch (err) {
          clearParentProjectTransaction();
          setSsoError(err?.message || "Parent project sign-in failed.");
          if (!cancelled) logout();
        } finally {
          clearParentProjectCallbackParams();
          if (!cancelled) setIsAuthReady(true);
        }
        return;
      }

      if (!token) {
        setIsAuthReady(true);
        return;
      }

      try {
        await verifyToken(token);
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
  }, [exchangeParentProjectCode, logout, token, verifyToken]);

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
    startParentProjectLogin,
    hasRole: (role) => roles.includes(role),
    hasPermission: (permission) => permissions.includes(permission),
  }), [user, token, roles, permissions, isAuthReady, isSsoAuthenticating, ssoError, login, logout, verifyToken, startParentProjectLogin]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
};
