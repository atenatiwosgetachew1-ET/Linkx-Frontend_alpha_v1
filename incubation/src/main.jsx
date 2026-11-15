import { StrictMode, Suspense, lazy } from 'react'
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

// G0 graph renderer benchmark (docs/graph-chart-plan.md): `?graph-bench`.
// Only in dev builds or builds made with VITE_GRAPH_BENCH=true; otherwise the
// condition is false at build time and the page is not bundled at all.
const GRAPH_BENCH_ENABLED = import.meta.env.DEV || import.meta.env.VITE_GRAPH_BENCH === 'true'
const showGraphBench = GRAPH_BENCH_ENABLED && new URLSearchParams(window.location.search).has('graph-bench')
const GraphBench = GRAPH_BENCH_ENABLED ? lazy(() => import('./dev/graphBench/GraphBench.jsx')) : null

createRoot(document.getElementById('root')).render(
  showGraphBench ? (
    <Suspense fallback={null}><GraphBench /></Suspense>
  ) : (
  // <StrictMode>
    <App />
  // </StrictMode>,
  ),
)
