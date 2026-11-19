// Graph layout worker (docs/graph-chart-plan.md §3.3): layouts and physics
// never run on the main thread.
//
// Layout:  { requestId, layout, nodeIds, edgePairs, options }
//       -> { requestId, positions: { id: {x, y} }, ms } | { requestId, error }
// Measure: { type: 'measure', requestId, measure, nodeIds, edgePairs }
//       -> { requestId, scores: { id: number } } | { requestId, error }
//          (network measures, lib/networkMeasures.js)
// Chart:   { type: 'chart-metric', requestId, metric, input }
//       -> { requestId, scores: result } | { requestId, error }
//          (Chart window metrics, features/chart/lib/chartMetrics.js)
// Physics (production vis-network barnesHut, lib/physics.js):
//   { type: 'physics-start', simId, nodeIds, edgePairs, positions, fixed, stabilize }
//       -> with `stabilize`, production's 350 stabilisation iterations run
//          first and post once ({ stabilized: true }); the simulation then
//          runs live, posting { simId, positions } each frame, and posts
//          { done: true } when every node is slower than minVelocity.
//          A settled simulation stays loaded so a drag can wake it.
//   { type: 'physics-node', simId, id, position, fixed } moves / pins a node
//          (a dragged node is pinned, as vis does) and wakes the simulation.
//   { type: 'physics-stop', simId } ends it.
import { computeMeasure } from '../lib/networkMeasures.js';
import { computeChartMetric } from '../../chart/lib/chartMetrics.js';
import { createSimulation, PRODUCTION_PHYSICS } from '../lib/physics.js';
import { LAYOUTS, neighbourIndex } from '../lib/layouts.js';

const STEPS_PER_FRAME = 2;
const FRAME_MS = 16;
const LIVE_STEP_BUDGET = 2000; // safety stop for a graph that never settles
const sims = new Map(); // simId -> { sim, timer, steps, dragging }

const tick = (simId) => {
  const entry = sims.get(simId);
  if (!entry) return;
  entry.timer = null;
  let speed = 0;
  for (let i = 0; i < STEPS_PER_FRAME; i += 1) speed = entry.sim.step();
  entry.steps += STEPS_PER_FRAME;
  const settled = !entry.dragging && (entry.sim.isSettled(speed) || entry.steps >= LIVE_STEP_BUDGET);
  self.postMessage({ simId, positions: entry.sim.positions(), done: settled });
  if (!settled) entry.timer = setTimeout(() => tick(simId), FRAME_MS);
};

const wake = (simId) => {
  const entry = sims.get(simId);
  if (!entry || entry.timer) return;
  entry.steps = 0;
  entry.timer = setTimeout(() => tick(simId), FRAME_MS);
};

const startPhysics = ({ simId, nodeIds, edgePairs, positions, fixed = [], stabilize = false }) => {
  const sim = createSimulation({ nodeIds, edgePairs, positions, fixed });
  sims.set(simId, { sim, timer: null, steps: 0, dragging: false });
  if (stabilize) {
    for (let i = 0; i < PRODUCTION_PHYSICS.stabilizationIterations; i += 1) {
      if (sim.isSettled(sim.step())) break;
    }
    self.postMessage({ simId, positions: sim.positions(), stabilized: true });
  }
  wake(simId);
};

self.onmessage = (event) => {
  const data = event.data || {};
  if (data.type === 'physics-start') {
    startPhysics(data);
    return;
  }
  if (data.type === 'physics-node') {
    const entry = sims.get(data.simId);
    if (!entry) return;
    entry.sim.setNode(data.id, { position: data.position, fixed: data.fixed });
    if (data.fixed !== undefined) entry.dragging = Boolean(data.fixed);
    wake(data.simId);
    return;
  }
  if (data.type === 'physics-stop') {
    const entry = sims.get(data.simId);
    if (entry?.timer) clearTimeout(entry.timer);
    sims.delete(data.simId);
    return;
  }
  // Network measures (G3.5 i2 #3).
  if (data.type === 'chart-metric') {
    try {
      self.postMessage({ requestId: data.requestId, scores: computeChartMetric(data.metric, data.input) });
    } catch (error) {
      self.postMessage({ requestId: data.requestId, error: String(error?.message || error) });
    }
    return;
  }
  if (data.type === 'measure') {
    try {
      self.postMessage({ requestId: data.requestId, scores: computeMeasure(data.measure, data.nodeIds || [], data.edgePairs || []) });
    } catch (error) {
      self.postMessage({ requestId: data.requestId, error: String(error?.message || error) });
    }
    return;
  }
  const { requestId, layout, nodeIds, edgePairs, options } = data;
  const start = performance.now();
  try {
    const run = LAYOUTS[layout] || LAYOUTS.concentric;
    const positions = run(nodeIds || [], neighbourIndex(edgePairs || []), options || {});
    self.postMessage({ requestId, positions, ms: performance.now() - start });
  } catch (error) {
    self.postMessage({ requestId, error: String(error?.message || error) });
  }
};
