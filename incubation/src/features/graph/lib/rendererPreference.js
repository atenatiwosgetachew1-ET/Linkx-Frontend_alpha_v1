// Which renderer a Graph window uses (graph-chart-plan §3.9, libraries-plan
// §2). GPU (WebGL) is OFF by default, and each browser's own choice (B-36
// refused: the configuration cannot forbid it). Used only when both agree:
// - Device: the user switched it on in this browser (Libraries → Graph rendering)
// - Device: this browser can draw with the graphics card now (gpuCapability.js)

import { GPU_VERDICTS, getGpuCapability, subscribeGpuCapability } from '../../../shared/device/gpuCapability.js';

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

// Pure decision (unit-tested).
export const decideRenderer = ({ preferGpu, verdict }) => (
  preferGpu && verdict === GPU_VERDICTS.CAPABLE ? RENDERERS.WEBGL : RENDERERS.CANVAS
);

export const resolveRenderer = () => decideRenderer({
  preferGpu: getGpuPreference(),
  // Only probed when the user asked for GPU (the probe costs a WebGL context).
  verdict: getGpuPreference() ? getGpuCapability().verdict : GPU_VERDICTS.UNKNOWN,
});

// Anything resolveRenderer depends on, besides the configuration.
export const subscribeRenderer = (listener) => {
  const stops = [subscribeGpuPreference(listener), subscribeGpuCapability(listener)];
  return () => stops.forEach((stop) => stop());
};

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

// True once per device: GPU off, allowed, and usable without cautions. The
// capability probe (a short WebGL context) only runs when the rest holds.
export const shouldSuggestGpu = () => {
  if (wasSuggested() || getGpuPreference()) return false;
  const capability = getGpuCapability();
  return capability.verdict === GPU_VERDICTS.CAPABLE && !capability.cautions?.length;
};
