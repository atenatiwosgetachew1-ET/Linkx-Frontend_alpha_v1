import React, { useEffect, useState } from 'react';

import '../main.css';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { useAuth } from '../auth/useAuth.js';
import LoginPage from '../auth/LoginPage.jsx';
import WorkspaceFrame from '../workspace/components/WorkspaceFrame.jsx';
import { WorkspaceProvider } from '../workspace/state/WorkspaceContext.jsx';
import { initializeMainSession } from '../services/sessionApi.js';
import { appConfig } from './config.js';

const loginLogo = import.meta.env.BASE_URL + 'site_images/Linkx square Icon (256x256).png';

function IncubationShell() {
  const { user, token, logout } = useAuth();
  const [mainSessionId, setMainSessionId] = useState(() => localStorage.getItem('session') || '');
  const [sessionError, setSessionError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!token) return undefined;

    initializeMainSession(appConfig.apiUrl, token)
      .then(({ sessionId }) => {
        if (!cancelled) {
          setMainSessionId(sessionId);
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
        sessionError={sessionError}
        onSignOut={logout}
        logoSrc={loginLogo}
      />
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
    <AuthProvider apiUrl={appConfig.apiUrl} allowedSsoOrigins={appConfig.allowedSsoOrigins}>
      <IncubationApp />
    </AuthProvider>
  );
}
