// This computer's GPU drawing limits (Libraries ▸ Graph rendering; analyst
// decision 2026-11-24). Turning GPU drawing on needs a short benchmark; its
// result sets how many nodes a GPU graph may show and from where "may be
// slow" is said. Kept in this browser. The run: gpuBenchmarkRun.js.

import { GRAPH_LIMITS } from './graphSettings.js';

export const BENCH_SIZES = Object.freeze([1000, 2000, 5000, 10000, 20000]);
export const USABLE_FPS = 15;
export const SMOOTH_FPS = 30;
// Screens and battery savers that draw exactly 30 a second measure just under.
export const SMOOTH_FPS_MEASURED = 28.5;
// Below this the browser itself is holding frames back: nothing to measure.
export const MIN_IDLE_FPS = 25;

const STORAGE_KEY = 'linkx.device.gpuBenchmark.v1';
const RUNNING_KEY = 'linkx.device.gpuBenchmark.running';
const PROMPTED_KEY = 'linkx.device.gpuBenchmark.prompted';
// A run updates its mark at every step; older than this, it never finished.
const RUN_LOST_AFTER_MS = 60 * 1000;

export const BENCH_OUTCOMES = Object.freeze({ OK: 'ok', UNSUITABLE: 'unsuitable', FAILED: 'failed' });

const usable = (step) => !step.error && step.fps >= USABLE_FPS;

// Pure (unit-tested): the measured steps, smallest first -> the limits.
// FAILED: nothing could be measured. UNSUITABLE: 2 000 nodes (what standard
// drawing allows) is already too slow.
export const limitsFromSteps = (steps = []) => {
  if (!steps.length || steps[0].error) return { outcome: BENCH_OUTCOMES.FAILED, limit: 0, warnAt: 0 };
  let limit = 0;
  let smooth = 0;
  for (const step of steps) {
    if (!usable(step)) break;
    limit = step.nodes;
  }
  for (const step of steps) {
    if (!usable(step) || step.fps < SMOOTH_FPS_MEASURED) break;
    smooth = step.nodes;
  }
  if (limit < GRAPH_LIMITS.CANVAS_HARD_CAP) return { outcome: BENCH_OUTCOMES.UNSUITABLE, limit: 0, warnAt: 0 };
  return {
    outcome: BENCH_OUTCOMES.OK,
    limit: Math.min(limit, GRAPH_LIMITS.WEBGL_HARD_CAP),
    warnAt: smooth || GRAPH_LIMITS.WARNING,
  };
};

/* ── The saved result ────────────────────────────────────────────────── */

const listeners = new Set();
export const subscribeGpuBenchmark = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const emit = () => listeners.forEach((listener) => listener());

const isValid = (value) => value && value.version === 1 && Array.isArray(value.steps)
  && value.steps.every((step) => Number.isFinite(step?.nodes))
  && Object.values(BENCH_OUTCOMES).includes(value.outcome)
  && (value.outcome !== BENCH_OUTCOMES.OK || (value.limit >= GRAPH_LIMITS.CANVAS_HARD_CAP && value.limit <= GRAPH_LIMITS.WEBGL_HARD_CAP && value.warnAt > 0));

// Same object until the saved text changes (useSyncExternalStore).
let cachedText;
let cachedResult = null;
let memoryResult = null; // storage unavailable
export const getGpuBenchmark = () => {
  let text = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryResult;
  }
  if (text === null) return memoryResult;
  if (text !== cachedText) {
    cachedText = text;
    try {
      const value = JSON.parse(text);
      cachedResult = isValid(value) ? value : null;
    } catch {
      cachedResult = null;
    }
  }
  return cachedResult;
};

export const saveGpuBenchmark = (result) => {
  memoryResult = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {
    memoryResult = result;
  }
  emit();
};

export const hasGpuBenchmark = () => getGpuBenchmark()?.outcome === BENCH_OUTCOMES.OK;

// What a GPU graph uses now: this computer's, or a temporary limit until it
// has been benchmarked (GPU drawing turned on before benchmarks existed).
const TEMPORARY_LIMITS = Object.freeze({ cap: GRAPH_LIMITS.WEBGL_WARNING, warnAt: 1000, measured: false });
let limitsFor;
let limits = TEMPORARY_LIMITS;
export const getGpuLimits = () => {
  const result = getGpuBenchmark();
  if (result !== limitsFor) {
    limitsFor = result;
    limits = result?.outcome === BENCH_OUTCOMES.OK
      ? Object.freeze({ cap: result.limit, warnAt: result.warnAt, measured: true })
      : TEMPORARY_LIMITS;
  }
  return limits;
};

// "Chrome 157": enough to see that the browser was updated.
export const browserVersion = (userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent) => {
  // Edge and Opera also say "Chrome", so they come first.
  const families = [['Edge', /Edg\/(\d+)/], ['Opera', /OPR\/(\d+)/], ['Firefox', /Firefox\/(\d+)/], ['Chrome', /Chrome\/(\d+)/], ['Safari', /Version\/(\d+).*Safari/]];
  const found = families.map(([name, pattern]) => [name, pattern.exec(userAgent)?.[1]]).find(([, version]) => version);
  return found ? found.join(' ') : '';
};

// Why the result may no longer hold ([] when nothing changed). A hidden card
// name cannot be compared.
export const benchmarkChanges = (result, { renderer = '', browser = browserVersion() } = {}) => {
  const changes = [];
  if (result?.renderer && renderer && result.renderer !== renderer) changes.push('the graphics card in use changed');
  if (result?.browser && browser && result.browser !== browser) changes.push(`the browser was updated (${result.browser} to ${browser})`);
  return changes;
};

/* ── A run that never finished (the browser froze or closed) ─────────── */

let runningHere = false;
export const markBenchmarkRunning = (nodes) => {
  runningHere = true;
  try {
    localStorage.setItem(RUNNING_KEY, JSON.stringify({ at: Date.now(), nodes }));
  } catch { /* cannot be noticed next time */ }
};
export const clearBenchmarkRunning = () => {
  runningHere = false;
  try {
    localStorage.removeItem(RUNNING_KEY);
  } catch { /* nothing kept */ }
  emit();
};
// The size it stopped at, or 0.
export const getUnfinishedBenchmark = () => {
  if (runningHere) return 0;
  try {
    const mark = JSON.parse(localStorage.getItem(RUNNING_KEY) || 'null');
    return mark && Date.now() - mark.at > RUN_LOST_AFTER_MS ? Number(mark.nodes) || 0 : 0;
  } catch {
    return 0;
  }
};

/* ── One notice for GPU graphs without a benchmark ───────────────────── */

export const shouldPromptBenchmark = () => {
  if (hasGpuBenchmark()) return false;
  try {
    if (localStorage.getItem(PROMPTED_KEY) === '1') return false;
    localStorage.setItem(PROMPTED_KEY, '1');
    return true;
  } catch {
    return false;
  }
};
