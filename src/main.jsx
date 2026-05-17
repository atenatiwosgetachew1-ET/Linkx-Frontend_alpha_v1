import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

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
