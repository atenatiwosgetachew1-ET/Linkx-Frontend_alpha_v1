import { SMOOTH_FPS_MEASURED, USABLE_FPS } from '../../graph/lib/gpuBenchmark.js';

// How one measured size is worded.
export const benchStepVerdict = (step) => {
  if (step.error) return { word: 'Failed', tone: 'bad' };
  if (step.fps < USABLE_FPS) return { word: 'Too slow', tone: 'bad' };
  return step.fps >= SMOOTH_FPS_MEASURED ? { word: 'Smooth', tone: 'good' } : { word: 'Usable', tone: 'fair' };
};
