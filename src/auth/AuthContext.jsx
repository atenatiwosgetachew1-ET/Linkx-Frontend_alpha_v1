import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const AUTH_TOKEN_KEY = "linkx_auth_token";
const AuthContext = createContext(null);

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
  const response = await fetch(`${String(apiUrl || "").replace(/\/$/, "")}${path}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.message || data?.error || `Auth request failed with status ${response.status}`);
  }

  return data;
};

export function AuthProvider({ apiUrl, children }) {
  const [token, setToken] = useState(() => localStorage.getItem(AUTH_TOKEN_KEY) || "");
  const [user, setUser] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

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
  }, [apiUrl]);

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
    login,
    logout,
    verifyToken,
    hasRole: (role) => roles.includes(role),
    hasPermission: (permission) => permissions.includes(permission),
  }), [user, token, roles, permissions, isAuthReady, login, logout, verifyToken]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return value;
};
