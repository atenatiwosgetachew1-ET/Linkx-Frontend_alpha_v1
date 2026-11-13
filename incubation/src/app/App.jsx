import React, { Suspense, lazy, useState } from 'react';

import '../styles/themes/index.css';
import '../main.css';
// Feature styles split out of main.css (same cascade order as before).
import '../styles/features/loader.css';
import '../styles/features/configuration.css';
import '../styles/features/settings.css';
import '../styles/features/source.css';
import '../styles/features/tasks.css';
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

import WorkspaceLockOverlay from '../auth/WorkspaceLockOverlay.jsx';
import { useIdleTimeout } from '../auth/useIdleTimeout.js';
import { DEFAULT_IDLE_SETTINGS } from '../shared/session/idlePolicy.js';

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
  const [isWorkspaceLocked, setIsWorkspaceLocked] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  // Follows the backend session policy once SessionProvider has loaded it.
  const [idleSettings, setIdleSettings] = useState(DEFAULT_IDLE_SETTINGS);

  useIdleTimeout({
    enabled: Boolean(token) && idleSettings.enabled,
    warningMs: idleSettings.warningMs,
    lockMs: idleSettings.lockMs,
    timeoutMs: idleSettings.timeoutMs,
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


  return (
    <SessionProvider
      apiUrl={appConfig.apiUrl}
      token={token}
      onLogout={logout}
      onLocked={() => setIsWorkspaceLocked(true)}
      onIdleSettingsChange={setIdleSettings}
    >
    <WorkspaceProvider>
      <SessionWorkspaceFrame user={user} token={token} onSignOut={logout} />
      {isWorkspaceLocked && (
        <WorkspaceLockOverlay
          user={user}
          isUnlocking={isUnlocking}
          lockMinutes={Math.max(1, Math.round(idleSettings.lockMs / 60000))}
          logoutMinutes={Math.max(1, Math.round(idleSettings.timeoutMs / 60000))}
          onUnlock={handleUnlock}
          onLogout={logout}
          logoSrc={loginLogo}
        />
      )}
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
