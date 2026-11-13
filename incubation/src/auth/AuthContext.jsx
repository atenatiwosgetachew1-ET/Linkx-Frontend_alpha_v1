import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./authContext.js";
import {
  exchangeSsoCodeForAuth,
  fetchAutoLoginAuth,
  fetchCurrentActor,
  loginWithPassword,
  normalizeAuthUser,
  verifyAuthToken,
} from "../services/authApi.js";
import { createLogger } from '../shared/logger.js';

const log = createLogger('auth');

const AUTH_TOKEN_KEY = "linkx_auth_token";
const SESSION_STORAGE_KEY = "session";

const readStoredToken = () => (
  localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY) || ""
);

const clearClientSessionState = () => {
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(SESSION_STORAGE_KEY);
};

const TOKEN_RENEW_LEAD_MS = 2 * 60 * 1000;

// Reads the JWT `exp` claim (ms since epoch); 0 when the token isn't a JWT.
const readTokenExpiry = (jwt) => {
  try {
    const part = String(jwt || "").split(".")[1];
    if (!part) return 0;
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const exp = Number(JSON.parse(json)?.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  } catch {
    return 0;
  }
};

const SSO_CODE_PARAM = "sso_code";
const SSO_STATE_PARAM = "sso_state";

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

const clearSsoParams = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete(SSO_CODE_PARAM);
  url.searchParams.delete(SSO_STATE_PARAM);
  url.searchParams.delete("state");
  url.searchParams.delete("sso_error");
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
};

export function AuthProvider({ apiUrl, allowedSsoOrigins = [], autoLogin = false, children }) {
  const [token, setToken] = useState(readStoredToken);
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSsoAuthenticating, setIsSsoAuthenticating] = useState(false);
  const [ssoError, setSsoError] = useState("");

  const trustedSsoOrigins = useMemo(() => normalizeAllowedOrigins(allowedSsoOrigins), [allowedSsoOrigins]);

  const applyAuth = useCallback((nextToken, nextUser) => {
    const normalizedUser = normalizeAuthUser(nextUser);
    if (!nextToken || !normalizedUser) {
      clearClientSessionState();
      setToken("");
      setUser(null);
      return;
    }

    localStorage.setItem(AUTH_TOKEN_KEY, nextToken);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    setToken(nextToken);
    setUser(normalizedUser);
    setSsoError("");
  }, []);

  const logout = useCallback(() => {
    clearClientSessionState();
    setToken("");
    setUser(null);
  }, []);

  const login = useCallback(async (username, password) => {
    const auth = await loginWithPassword(apiUrl, username, password);
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
      const auth = await exchangeSsoCodeForAuth(apiUrl, {
        code: cleanCode,
        state: cleanState,
        redirectUri: `${window.location.origin}${window.location.pathname}`,
      });
      applyAuth(auth.token, auth.user);
      return auth.user;
    } catch (err) {
      setSsoError(err?.message || "Single sign-on failed.");
      throw err;
    } finally {
      setIsSsoAuthenticating(false);
    }
  }, [apiUrl, applyAuth]);

  const verifyToken = useCallback(async (incomingToken) => {
    const candidateToken = incomingToken || token;
    if (!candidateToken) return null;

    const auth = await verifyAuthToken(apiUrl, candidateToken);
    applyAuth(auth.token, auth.user);
    return auth.user;
  }, [apiUrl, applyAuth, token]);

  useEffect(() => {
    let cancelled = false;

    const restoreAuth = async () => {
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
        // With the login page disabled, sign in through the backend's
        // auto-login endpoint so session/source calls carry a real token.
        if (autoLogin) {
          try {
            const auth = await fetchAutoLoginAuth(apiUrl);
            if (!cancelled) applyAuth(auth.token, auth.user);
          } catch (err) {
            log.warn('Auto-login failed', { status: err?.status, message: err?.message });
          }
        }
        if (!cancelled) setIsAuthReady(true);
        return;
      }

      try {
        const auth = await fetchCurrentActor(apiUrl, token);
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
  }, [apiUrl, applyAuth, autoLogin, exchangeSsoCode, logout, token]);

  // Auto-login tokens are short-lived JWTs (≈30 min) and the backend answers
  // expired tokens with 403 "forbidden" rather than 401. Renew shortly before
  // `exp`, and again whenever the tab regains focus after the token lapsed
  // (timers are throttled/suspended in background tabs).
  useEffect(() => {
    if (!autoLogin || !token) return undefined;

    let cancelled = false;
    const renew = async () => {
      try {
        const auth = await fetchAutoLoginAuth(apiUrl);
        if (!cancelled) applyAuth(auth.token, auth.user);
      } catch (err) {
        log.warn('Auto-login renewal failed', { status: err?.status, message: err?.message });
      }
    };

    const expiresAt = readTokenExpiry(token);
    if (!expiresAt) return undefined;

    const renewAt = expiresAt - TOKEN_RENEW_LEAD_MS;
    const timer = window.setTimeout(renew, Math.max(0, renewAt - Date.now()));
    const handleWake = () => {
      if (document.visibilityState === 'visible' && Date.now() >= renewAt) renew();
    };
    document.addEventListener('visibilitychange', handleWake);
    window.addEventListener('focus', handleWake);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', handleWake);
      window.removeEventListener('focus', handleWake);
    };
  }, [apiUrl, applyAuth, autoLogin, token]);

  useEffect(() => {
    const handleSsoMessage = async (event) => {
      const data = event?.data || {};
      const messageType = data.type || data.action || "";
      if (!["linkx_sso", "linkx_sso_code", "authenticate"].includes(messageType)) return;
      if (!isTrustedSsoOrigin(event, trustedSsoOrigins)) return;

      const payload = data.payload && typeof data.payload === "object" ? data.payload : data;
      const code = payload.sso_code || payload.code || "";
      const state = payload.sso_state || payload.state || "";

      try {
        if (!code) throw new Error("Single sign-on code is required.");
        const verifiedUser = await exchangeSsoCode(code, state);
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
  }, [exchangeSsoCode, trustedSsoOrigins]);

  const value = useMemo(() => {
    const roles = user?.roles || [];
    const permissions = user?.permissions || [];

    return {
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
      hasRole: (role) => roles.includes(role),
      hasPermission: (permission) => permissions.includes(permission),
    };
  }, [user, token, isAuthReady, isSsoAuthenticating, ssoError, login, logout, verifyToken, exchangeSsoCode]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

