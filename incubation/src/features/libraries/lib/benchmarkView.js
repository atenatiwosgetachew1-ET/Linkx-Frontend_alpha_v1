import { SMOOTH_FPS_MEASURED, USABLE_FPS } from '../../graph/lib/gpuBenchmark.js';

// How one measured size is worded.
export const benchStepVerdict = (step) => {
  if (step.error) return { word: 'Failed', tone: 'bad' };
  if (step.fps < USABLE_FPS) return { word: 'Too slow', tone: 'bad' };
  return step.fps >= SMOOTH_FPS_MEASURED ? { word: 'Smooth', tone: 'good' } : { word: 'Usable', tone: 'fair' };
};

// Plain text for support (Libraries ▸ Graph rendering ▸ Copy details).
export const gpuDetails = ({ capability, benchmark, limits, system, preferGpu, active, userAgent = navigator.userAgent, at = new Date() }) => [
  'Linkx graph rendering details',
  `Copied: ${at.toISOString()}`,
  `Browser: ${userAgent}`,
  `Screen: ${window.innerWidth} x ${window.innerHeight}, pixel ratio ${window.devicePixelRatio || 1}`,
  `GPU check: ${capability.status || capability.verdict}${capability.checkedAt ? ` (${capability.checkedAt})` : ''}`,
  ...(capability.failedAt ? [`GPU stopped: ${capability.failedAt}`] : []),
  ...[...(capability.reasons || []), ...(capability.cautions || [])].map((line) => `- ${line}`),
  `System setting: ${system}`,
  `GPU chosen: ${preferGpu ? 'yes' : 'no'}; graphs drawn with: ${active ? 'GPU' : 'standard drawing'}`,
  `GPU limit: ${limits.cap} nodes${limits.measured ? '' : ' (temporary)'}; may be slow above ${limits.warnAt}`,
  ...(benchmark ? [
    `Benchmark: ${benchmark.outcome} (${benchmark.at})${benchmark.renderer ? `, ${benchmark.renderer}` : ''}${benchmark.browser ? `, ${benchmark.browser}` : ''}`,
    ...(benchmark.stage ? [`Drawn at: ${benchmark.stage.width} x ${benchmark.stage.height}, pixel ratio ${benchmark.stage.ratio}`] : []),
    ...benchmark.steps.map((step) => `- ${step.nodes} nodes: ${step.error || `${step.fps} fps`}`),
  ] : ['Benchmark: not run']),
].join('\n');
