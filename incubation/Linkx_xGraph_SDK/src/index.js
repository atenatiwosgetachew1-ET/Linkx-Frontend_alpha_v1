/**
 * @linkx/graph-preview — Public API
 *
 * This is the single entry point for the SDK.
 * Everything consumers need is exported from here.
 * vis-network is NOT re-exported.
 */

// ── Core (imperative / vanilla JS API) ──
export { GraphRenderer } from './core/GraphRenderer.js';

// ── React Component ──
export { LinkAnalysisPreview } from './react/LinkAnalysisPreview.jsx';
