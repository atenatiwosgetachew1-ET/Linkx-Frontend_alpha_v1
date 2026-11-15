import React, { Suspense, lazy, useState } from 'react';

import '../styles/themes/index.css';
import '../main.css';
// Feature styles split out of main.css (same cascade order as before).
import '../styles/features/loader.css';
import '../styles/features/configuration.css';
import '../styles/features/settings.css';
import '../styles/features/source.css';
import '../styles/features/tasks.css';
import '../styles/features/reports.css';
import '../styles/features/graph.css';
import '../styles/features/window-controls.css';
import { AuthProvider } from '../auth/AuthContext.jsx';
import { useAuth } from '../auth/useAuth.js';
import LoginPage from '../auth/LoginPage.jsx';
import WorkspaceFrame from '../workspace/components/WorkspaceFrame.jsx';
import { WorkspaceProvider } from '../workspace/state/WorkspaceContext.jsx';
import { SessionProvider } from '../shared/session/SessionProvider.jsx';
import { useSession } from '../shared/session/useSession.js';
import { NotificationProvider } from '../shared/notifications/NotificationContext.jsx';
import { ThemeProvider, useTheme } from '../shared/theme/ThemeContext.jsx';
import { appConfig } from './config.js';
import TooltipLayer from '../shared/components/TooltipLayer.jsx';

import SessionLifecycle from './SessionLifecycle.jsx';

const VisualElementPicker = lazy(() => import('../shared/theme/VisualElementPicker.jsx'));

// Only load and mount the inspector while it is active.
function ElementPickerGate() {
  const { inspectorActive } = useTheme();
  if (!inspectorActive) return null;
  return (
    <Suspense fallback={null}>
      <VisualElementPicker />
    </Suspense>
  );
}

const loginLogo = import.meta.env.BASE_URL + 'site_images/Linkx square Icon (256x256).png';

function IncubationShell() {
  const { user, token, logout } = useAuth();
  // Set by the idle timer and by any 423 answer (SessionProvider onLocked).
  const [isWorkspaceLocked, setIsWorkspaceLocked] = useState(false);

  return (
    <SessionProvider
      apiUrl={appConfig.apiUrl}
      token={token}
      onLogout={logout}
      onLocked={() => setIsWorkspaceLocked(true)}
    >
    <WorkspaceProvider>
      <SessionLifecycle isLocked={isWorkspaceLocked} setLocked={setIsWorkspaceLocked} loginLogo={loginLogo}>
        {(performLogout) => (
          <SessionWorkspaceFrame user={user} token={token} onSignOut={() => performLogout('user_logout')} />
        )}
      </SessionLifecycle>
    </WorkspaceProvider>
    </SessionProvider>
  );
}

function SessionWorkspaceFrame({ user, token, onSignOut }) {
  const { mainSessionId, configuration, sessionError, isSessionReady } = useSession();
  // Source windows are only opened against a session /init has confirmed.
  return (
    <WorkspaceFrame
      user={user}
      token={token}
      mainSessionId={isSessionReady ? mainSessionId : ''}
      sessionConfiguration={configuration}
      sessionError={sessionError}
      onSignOut={onSignOut}
      logoSrc={loginLogo}
    />
  );
}
function IncubationApp() {
  const { isAuthReady, isAuthenticated, isSsoAuthenticating, ssoError, login } = useAuth();

  if (appConfig.authDisabled) {
    return <IncubationShell />;
  }

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
      <AuthProvider apiUrl={appConfig.apiUrl} allowedSsoOrigins={appConfig.allowedSsoOrigins} autoLogin={appConfig.authDisabled}>
        <NotificationProvider>
          <IncubationApp />
        </NotificationProvider>
      </AuthProvider>
      <ElementPickerGate />
      <TooltipLayer />
    </ThemeProvider>
  );
}
