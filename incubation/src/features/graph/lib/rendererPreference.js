// Which renderer a Graph window uses (graph-chart-plan §3.9, libraries-plan
// §2). GPU (WebGL) is OFF by default. It is used only when all three agree:
// - System: the configuration does not forbid it (graph_gpu_allowed !== false)
// - Device: the user switched it on in this browser (Libraries → Graph rendering)
// - Device: this device is capable (gpuCapability.js)

import { GPU_VERDICTS, getGpuCapability } from '../../../shared/device/gpuCapability.js';

const STORAGE_KEY = 'linkx.device.graphRenderer.v1';
const listeners = new Set();

export const RENDERERS = Object.freeze({ CANVAS: 'canvas', WEBGL: 'webgl' });

export const getGpuPreference = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === RENDERERS.WEBGL;
  } catch {
    return false;
  }
};

export const setGpuPreference = (enabled) => {
  try {
    if (enabled) localStorage.setItem(STORAGE_KEY, RENDERERS.WEBGL);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* storage unavailable: stays canvas */ }
  listeners.forEach((listener) => listener());
};

export const subscribeGpuPreference = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const isGpuAllowedBySystem = (configuration) => configuration?.graph_gpu_allowed !== false
  && String(configuration?.graph_gpu_allowed).toLowerCase() !== 'false';

// Pure decision (unit-tested).
export const decideRenderer = ({ allowedBySystem, preferGpu, verdict }) => (
  allowedBySystem && preferGpu && verdict === GPU_VERDICTS.CAPABLE ? RENDERERS.WEBGL : RENDERERS.CANVAS
);

export const resolveRenderer = (configuration) => decideRenderer({
  allowedBySystem: isGpuAllowedBySystem(configuration),
  preferGpu: getGpuPreference(),
  // Only probed when the user asked for GPU (the probe costs a WebGL context).
  verdict: getGpuPreference() ? getGpuCapability().verdict : GPU_VERDICTS.UNKNOWN,
});

/* ── One-time suggestion (graph-chart-plan §3.9) ─────────────────────── */

const SUGGESTED_KEY = 'linkx.device.gpuSuggested.v1';

const wasSuggested = () => {
  try {
    return localStorage.getItem(SUGGESTED_KEY) === '1';
  } catch {
    return true; // no storage: never nag
  }
};

export const markGpuSuggested = () => {
  try {
    localStorage.setItem(SUGGESTED_KEY, '1');
  } catch { /* storage unavailable */ }
};

// True once per device: GPU off, allowed, and this device is capable. The
// capability probe (a short WebGL context) only runs when the rest holds.
export const shouldSuggestGpu = (configuration) => {
  if (wasSuggested() || getGpuPreference() || !isGpuAllowedBySystem(configuration)) return false;
  return getGpuCapability().verdict === GPU_VERDICTS.CAPABLE;
};
