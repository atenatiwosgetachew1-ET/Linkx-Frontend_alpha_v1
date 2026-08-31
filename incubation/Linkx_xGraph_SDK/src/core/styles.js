/**
 * SDK Styles — injected at mount time, no external CSS file needed by consumers.
 */

const STYLE_ID = '__linkx_graph_preview_styles__';

const CSS = `
.linkx-graph-preview {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  font-family: "Segoe UI", Roboto, Arial, sans-serif;
}

.linkx-graph-preview__canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

/* ── Loading State ── */
.linkx-graph-preview__loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.85);
  z-index: 10;
  transition: opacity 0.3s ease;
}

.linkx-graph-preview[data-theme="dark"] .linkx-graph-preview__loading {
  background: rgba(15, 23, 32, 0.85);
}

.linkx-graph-preview__spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(120, 120, 120, 0.2);
  border-top-color: #5684ac;
  border-radius: 50%;
  animation: linkx-spin 0.8s linear infinite;
}

@keyframes linkx-spin {
  to { transform: rotate(360deg); }
}

/* ── Empty State ── */
.linkx-graph-preview__empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #888;
  font-size: 14px;
  gap: 8px;
}

.linkx-graph-preview__empty-icon {
  font-size: 32px;
  opacity: 0.4;
}

/* ── Error State ── */
.linkx-graph-preview__error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #c0392b;
  font-size: 13px;
  gap: 6px;
  padding: 16px;
  text-align: center;
}

/* ── Explore Button ── */
.linkx-graph-preview__explore-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border: 1px solid rgba(86, 132, 172, 0.45);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.92);
  color: #2c4f6b;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
  font-family: "Segoe UI", Roboto, Arial, sans-serif;
}

.linkx-graph-preview__explore-btn:hover {
  background: rgba(223, 236, 247, 0.98);
  border-color: rgba(86, 132, 172, 0.7);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.linkx-graph-preview[data-theme="dark"] .linkx-graph-preview__explore-btn {
  background: rgba(30, 45, 58, 0.92);
  border-color: rgba(109, 143, 171, 0.5);
  color: #c8dae8;
}

.linkx-graph-preview[data-theme="dark"] .linkx-graph-preview__explore-btn:hover {
  background: rgba(45, 65, 82, 0.98);
}

/* ── Stats Badge ── */
.linkx-graph-preview__stats {
  position: absolute;
  bottom: 8px;
  left: 10px;
  z-index: 20;
  padding: 3px 10px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.8);
  color: #555;
  font-size: 10px;
  pointer-events: none;
}

.linkx-graph-preview[data-theme="dark"] .linkx-graph-preview__stats {
  background: rgba(20, 30, 40, 0.8);
  color: #99afc0;
}

/* ── vis-network canvas overrides ── */
.linkx-graph-preview .vis-network {
  outline: none !important;
}
`;

let injected = false;

/**
 * Injects the SDK styles into the document head (once).
 */
export function injectStyles() {
  if (injected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) {
    injected = true;
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  injected = true;
}

/**
 * Removes injected SDK styles (for cleanup in tests).
 */
export function removeStyles() {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
  injected = false;
}
