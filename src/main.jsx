import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

const shouldKeepClientLogs = () => {
  if (!import.meta.env.PROD) return true;
  if (import.meta.env.VITE_ENABLE_CLIENT_LOGS === 'true') return true;
  if (typeof window === 'undefined') return false;

  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug_logs') === '1') return true;
  } catch (_error) {
    // Ignore malformed location state.
  }

  try {
    return window.localStorage?.getItem('linkx_enable_client_logs') === 'true';
  } catch (_error) {
    return false;
  }
};

const installProductionConsoleGuard = () => {
  if (shouldKeepClientLogs()) return;
  ['debug', 'log', 'info', 'warn', 'error'].forEach((method) => {
    if (typeof console[method] === 'function') {
      console[method] = () => {};
    }
  });
};

installProductionConsoleGuard();

if (typeof window !== 'undefined') {
  document.documentElement.setAttribute('data-theme', 'light');
}

/**
 * When embedded via a fixed iframe URL, force one versioned reload so
 * browser/proxy cache is bypassed for the document request.
 */
if (typeof window !== 'undefined' && window.self !== window.top) {
  const currentUrl = new URL(window.location.href);
  if (!currentUrl.searchParams.has('iframe_v')) {
    currentUrl.searchParams.set('iframe_v', Date.now().toString());
    window.location.replace(currentUrl.toString());
  }
}

createRoot(document.getElementById('root')).render(
  // <StrictMode>
    <App />
  // </StrictMode>,
)
