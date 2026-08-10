import React, { useEffect, useState } from 'react';

import '../main.css';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { useAuth } from '../auth/useAuth.js';
import LoginPage from '../auth/LoginPage.jsx';
import WorkspaceFrame from '../workspace/components/WorkspaceFrame.jsx';
import { WorkspaceProvider } from '../workspace/state/WorkspaceContext.jsx';
import { extractMainSessionConfiguration, initializeMainSession } from '../services/sessionApi.js';
import { NotificationProvider } from '../shared/notifications/NotificationContext.jsx';
import { ThemeProvider } from '../shared/theme/ThemeContext.jsx';
import VisualElementPicker from '../shared/theme/VisualElementPicker.jsx';
import { appConfig } from './config.js';

import WorkspaceLockOverlay from '../auth/WorkspaceLockOverlay.jsx';
import { useIdleTimeout } from '../auth/useIdleTimeout.js';

const loginLogo = import.meta.env.BASE_URL + 'site_images/Linkx square Icon (256x256).png';

function IncubationShell() {
  const { user, token, logout } = useAuth();
  const [mainSessionId, setMainSessionId] = useState(() => localStorage.getItem('session') || sessionStorage.getItem('session') || '');
  const [sessionConfiguration, setSessionConfiguration] = useState({});
  const [sessionError, setSessionError] = useState('');
  const [isWorkspaceLocked, setIsWorkspaceLocked] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);

  useIdleTimeout({
    enabled: Boolean(token),
    warningMs: 12 * 60 * 1000,
    lockMs: 15 * 60 * 1000,
    timeoutMs: 30 * 60 * 1000,
    isLocked: isWorkspaceLocked,
    onWarn: () => {},
    onLock: () => setIsWorkspaceLocked(true),
    onTimeout: () => logout(),
  });

  const handleUnlock = () => {
    setIsUnlocking(true);
    setTimeout(() => {
      setIsWorkspaceLocked(false);
      setIsUnlocking(false);
    }, 350);
  };

  useEffect(() => {
    let cancelled = false;
    if (!token) return undefined;

    initializeMainSession(appConfig.apiUrl, token)
      .then(({ data, sessionId }) => {
        if (!cancelled) {
          setMainSessionId(sessionId);
          setSessionConfiguration(extractMainSessionConfiguration(data));
          setSessionError('');
        }
      })
      .catch((error) => {
        if (!cancelled) setSessionError(error?.message || 'Session initialization failed.');
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <WorkspaceProvider>
      <WorkspaceFrame
        user={user}
        token={token}
        apiUrl={appConfig.apiUrl}
        mainSessionId={mainSessionId}
        sessionConfiguration={sessionConfiguration}
        sessionError={sessionError}
        onSignOut={logout}
        logoSrc={loginLogo}
      />
      {isWorkspaceLocked && (
        <WorkspaceLockOverlay
          user={user}
          isUnlocking={isUnlocking}
          lockMinutes={15}
          logoutMinutes={30}
          onUnlock={handleUnlock}
          onLogout={logout}
          logoSrc={loginLogo}
        />
      )}
    </WorkspaceProvider>
  );
}
function IncubationApp() {
  const { isAuthReady, isAuthenticated, isSsoAuthenticating, ssoError, login } = useAuth();

  if (!isAuthReady) {
    return (
      <main className="linkx_login_shell">
        <div className="linkx_login_overlay" aria-hidden="true" />
        <div className="linkx_login_content">
          <section className="linkx_login_panel" aria-label="Loading">
            <div className="linkx_login_brand">
              <div className="linkx_login_brand_mark">
                <img className="linkx_login_brand_logo" src={loginLogo} alt="Linkx logo" />
                <span>Linkx</span>
              </div>
              <small>Preparing login</small>
            </div>
          </section>
        </div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} ssoError={ssoError} isSsoAuthenticating={isSsoAuthenticating} />;
  }

  return <IncubationShell />;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider apiUrl={appConfig.apiUrl} allowedSsoOrigins={appConfig.allowedSsoOrigins}>
        <NotificationProvider>
          <IncubationApp />
        </NotificationProvider>
      </AuthProvider>
      <VisualElementPicker />
    </ThemeProvider>
  );
}
