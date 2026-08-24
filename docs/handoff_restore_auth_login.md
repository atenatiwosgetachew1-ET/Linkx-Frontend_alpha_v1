# LinkX Frontend Authentication Handoff Guide

This document details the modifications made to enable **Auto-Login Admin Access** and provides step-by-step instructions to **restore the original authentication guards and login screen** whenever required.

---

## 1. Quick Restoration via Git (Recommended)

If working in a clean git repository without other uncommitted changes to `src/App.jsx` and `src/auth/AuthContext.jsx`, you can revert back to the original login flow instantly with:

```bash
git checkout src/App.jsx src/auth/AuthContext.jsx
npm run build
```

---

## 2. Manual Code Restoration Steps

If you need to manually revert the changes line-by-line, follow the steps below.

### A. Restore `AuthenticatedApp` Guard in [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx)

**Location**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L12762-L12775)

Replace the `AuthenticatedApp` component with the following original code to re-enable `<LoginPage />`:

```jsx
function AuthenticatedApp() {
  const auth = useAuth();

  if (!auth.isAuthReady) {
    const isParentProjectCallback = typeof window !== "undefined" && window.location.pathname === "/auth/callback";
    const loadingText = isParentProjectCallback
      ? "Completing Parent project sign-in"
      : auth.isSsoAuthenticating
        ? "Completing single sign-on"
        : "Checking authentication";
    return <Loadscreen loadingText={loadingText} />;
  }

  if (!auth.isAuthenticated) {
    return <LoginPage onLogin={auth.login} onParentProjectLogin={auth.startParentProjectLogin} ssoError={auth.ssoError} isSsoAuthenticating={auth.isSsoAuthenticating} />;
  }

  return <LinkxWorkspace />;
}
```

---

### B. Restore `NavBar` Action Buttons in [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx)

**Location**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L913-L921)

Replace `NavBar` with the original version that includes the `Logout` button:

```jsx
function NavBar({ onNavAction, user }) {
  const label = user?.display_name || user?.username || "User";
  return (
    <nav id="nav_bar">
      <span onClick={() => onNavAction("logout")}>Logout ({label})</span>
      <span onClick={() => onNavAction("about")}>About</span>
    </nav>
  );
}
```

---

### C. Restore Socket.IO Initialization in [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx)

**Location**: [`src/App.jsx`](file:///var/www/linkx-frontend/src/App.jsx#L7685-L7690)

Revert the `useEffect` hook to require a valid token before connecting to Socket.IO:

```jsx
  useEffect(() => {
    if (!token) return;
    const socket = io(API_URL, {
      auth: { token },
    });
    socketRef.current = socket;
```

---

### D. Restore Auth Provider & State in [`src/auth/AuthContext.jsx`](file:///var/www/linkx-frontend/src/auth/AuthContext.jsx)

**Location**: [`src/auth/AuthContext.jsx`](file:///var/www/linkx-frontend/src/auth/AuthContext.jsx#L141-L315)

1. Remove `fetchAutoLogin` function.
2. Restore standard `logout`:

```javascript
  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    setToken("");
    setUser(null);
  }, []);
```

3. Restore `restoreAuth` effect logic:

```javascript
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
```

4. Restore `isAuthenticated` check in context value:

```javascript
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
```

---

## 3. Verification after Restoration

After restoring the code, run a production build to confirm clean compilation:

```bash
npm run build
```

When opened in a clean browser session, the frontend will once again present the login page (`LoginPage`) and require user credentials to access the workspace.
