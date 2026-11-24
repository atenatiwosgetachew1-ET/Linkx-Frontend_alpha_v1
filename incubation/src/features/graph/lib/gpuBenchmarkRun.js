// One GPU benchmark run: the sample graph at growing sizes, drawn as a Graph
// window draws it, panned and zoomed, stopping at the first size too slow.
// Smallest first, so a weak card is found out before a heavy graph is drawn.

import { MIN_IDLE_FPS, BENCH_SIZES, USABLE_FPS, browserVersion, clearBenchmarkRunning, limitsFromSteps, markBenchmarkRunning } from './gpuBenchmark.js';
import { createGraph, releaseGraph } from './cytoscapeInstance.js';
import { concentricPositions, makeSyntheticGraph } from './syntheticGraph.js';

const IDLE_MS = 400;
const WARMUP_MS = 500;
const MEASURE_MS = 2000;
// A size whose first picture takes longer than this is too slow to use.
const FIRST_PAINT_MAX_MS = 15000;
const FRAME_MAX_MS = 1500;

// Why a run has no result: 'cancelled' | 'hidden' | 'throttled'.
export class BenchmarkStopped extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

const STYLE = [
  {
    selector: 'node',
    style: { 'background-color': 'data(color)', shape: 'data(shape)', width: 'data(size)', height: 'data(size)', 'border-width': 1.3, 'border-color': '#555555' },
  },
  { selector: 'node[icon != ""]', style: { 'background-image': 'data(icon)', 'background-fit': 'contain' } },
  {
    selector: 'edge',
    style: { 'curve-style': 'straight', 'line-color': 'data(color)', 'line-style': 'data(style)', width: 'data(width)', 'target-arrow-shape': 'data(arrow)', 'target-arrow-color': 'data(color)', 'arrow-scale': 0.8 },
  },
];

const toElements = (graph) => {
  const positions = concentricPositions(graph);
  return [
    ...graph.nodes.map((node) => ({ group: 'nodes', data: node, position: positions[node.id] })),
    ...graph.edges.map((edge) => ({ group: 'edges', data: edge })),
  ];
};

const round = (value) => Math.round(value * 10) / 10;

// `signal`: an AbortSignal; its reason says why ('hidden' or cancelled).
export const runGpuBenchmark = async ({ container, signal, gpuName = '', onProgress = () => {}, sizes = BENCH_SIZES }) => {
  const check = () => {
    if (signal?.aborted) throw new BenchmarkStopped(signal.reason === 'hidden' ? 'hidden' : 'cancelled');
    if (document.hidden) throw new BenchmarkStopped('hidden');
  };
  // Rejects when stopped: frames do not come while the tab is hidden.
  const frame = () => new Promise((resolve, reject) => {
    const onAbort = () => {
      cancelAnimationFrame(id);
      try {
        check();
      } catch (error) {
        reject(error);
      }
    };
    const id = requestAnimationFrame(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(performance.now());
    });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  const frames = async (duration, each) => {
    const start = await frame();
    let last = start;
    let count = 0;
    let longest = 0;
    while (last - start < duration) {
      each?.((last - start) / duration);
      const now = await frame();
      check();
      count += 1;
      longest = Math.max(longest, now - last);
      last = now;
      if (longest > FRAME_MAX_MS) break;
    }
    return { fps: round((count * 1000) / Math.max(1, last - start)), longestMs: Math.round(longest) };
  };

  const measure = async (nodes) => {
    let cy = null;
    let lost = false;
    const onLost = () => { lost = true; };
    let canvases = [];
    const graph = makeSyntheticGraph({ nodes });
    const step = { nodes, edges: graph.edges.length };
    try {
      const elements = toElements(graph);
      const start = performance.now();
      cy = createGraph({ container, elements, style: STYLE, layout: { name: 'preset' }, motionBlur: false, autoungrabify: true, userPanningEnabled: false, userZoomingEnabled: false, boxSelectionEnabled: false }, { gpu: true });
      canvases = [...container.querySelectorAll('canvas')];
      canvases.forEach((canvas) => canvas.addEventListener('webglcontextlost', onLost));
      cy.fit(undefined, 20);
      await frame();
      await frame();
      check();
      step.firstPaintMs = Math.round(performance.now() - start);
      if (step.firstPaintMs > FIRST_PAINT_MAX_MS) return { ...step, error: 'It took too long to draw.' };
      const zoom = cy.zoom();
      const pan = { ...cy.pan() };
      const move = (t) => cy.viewport({
        zoom: zoom * (1 + 0.6 * Math.sin(t * Math.PI * 2)),
        pan: { x: pan.x + 120 * Math.sin(t * Math.PI * 4), y: pan.y + 80 * Math.cos(t * Math.PI * 4) },
      });
      await frames(WARMUP_MS, move);
      onProgress({ nodes, phase: 'measuring' });
      Object.assign(step, await frames(MEASURE_MS, move));
      return lost ? { ...step, error: 'The browser lost the graphics card while drawing.' } : step;
    } catch (error) {
      if (error instanceof BenchmarkStopped) throw error;
      return { ...step, error: 'It could not be drawn with the GPU.' };
    } finally {
      canvases.forEach((canvas) => canvas.removeEventListener('webglcontextlost', onLost));
      releaseGraph(cy);
    }
  };

  const steps = [];
  try {
    check();
    const idle = await frames(IDLE_MS);
    if (idle.fps < MIN_IDLE_FPS) throw new BenchmarkStopped('throttled');
    for (const nodes of sizes) {
      markBenchmarkRunning(nodes);
      onProgress({ nodes, phase: 'building' });
      await frame(); // the progress shows before the page is busy
      await frame();
      check();
      const step = await measure(nodes);
      check();
      steps.push(step);
      onProgress({ nodes, phase: 'measured', step });
      if (step.error || step.fps < USABLE_FPS) break;
    }
    return {
      version: 1,
      at: new Date().toISOString(),
      renderer: gpuName,
      browser: browserVersion(),
      stage: { width: container.clientWidth, height: container.clientHeight, ratio: window.devicePixelRatio || 1 },
      idleFps: idle.fps,
      steps,
      ...limitsFromSteps(steps),
    };
  } finally {
    clearBenchmarkRunning();
  }
};
