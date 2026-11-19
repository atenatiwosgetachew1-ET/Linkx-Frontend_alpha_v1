import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';

// Main-thread side of the layout worker. One shared worker; requests are
// matched by id, and a newer request for the same window supersedes older
// ones (their results are ignored).
let worker = null;
let seq = 0;
const pending = new Map(); // requestId -> { resolve, reject }
const latestByOwner = new Map(); // owner -> requestId

const ensureWorker = () => {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/layout.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const { requestId, positions, scores, error, simId, done, stabilized } = event.data || {};
    if (simId != null) {
      const sim = sims.get(simId);
      if (!sim) return;
      if (stabilized) sim.onStabilized?.(positions);
      else sim.onFrame?.(positions);
      if (done) sim.onSettled?.(positions);
      return;
    }
    const entry = pending.get(requestId);
    if (!entry) return;
    pending.delete(requestId);
    if (error) entry.reject(new Error(error));
    else entry.resolve(scores ?? positions);
  };
  worker.onerror = (event) => {
    pending.forEach((entry) => entry.reject(new Error(event?.message || 'Layout worker failed.')));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
};

// Hierarchical "directed" (vis-network hierarchical, production default
// sort) runs in ELK's own worker. Production switches hierarchical to layered
// at 300 visible nodes, so ELK only sees small graphs (G0: ~0.65 s at 300).
let elk = null;
const elkLayout = async (nodeIds, edgePairs, direction) => {
  if (!elk) elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': direction === 'LR' ? 'RIGHT' : 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '120',
      'elk.spacing.nodeNode': '70',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: nodeIds.map((id) => ({ id, width: 30, height: 30 })),
    edges: edgePairs.filter(([source, target]) => source !== target).map(([source, target], index) => ({ id: `e${index}`, sources: [source], targets: [target] })),
  });
  const positions = {};
  (result.children || []).forEach((child) => {
    positions[child.id] = { x: child.x + child.width / 2, y: child.y + child.height / 2 };
  });
  return positions;
};

// Resolves to { id: {x, y} }, or null when superseded by a newer request of
// the same owner (a Graph window id). `layout` is a settings layout type;
// `options` carries direction, sort method, layer mode and per-node info.
export const requestLayout = (owner, layout, nodeIds, edgePairs, options = {}) => {
  const requestId = ++seq;
  latestByOwner.set(owner, requestId);
  const current = (positions) => (latestByOwner.get(owner) === requestId ? positions : null);
  if (layout === 'hierarchical' && options.sortMethod !== 'hubsize') {
    return elkLayout(nodeIds, edgePairs, options.direction).then(current);
  }
  const workerLayout = layout === 'hierarchical' ? 'hubsize' : layout;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve: (positions) => resolve(current(positions)), reject });
    ensureWorker().postMessage({ requestId, layout: workerLayout, nodeIds, edgePairs, options });
  });
};

export const forgetLayoutOwner = (owner) => {
  latestByOwner.delete(owner);
  sims.forEach((sim, simId) => {
    if (sim.owner === owner) stopPhysicsSim(simId);
  });
};

/* ── Physics (production vis-network barnesHut, lib/physics.js) ──────── */

const sims = new Map(); // simId -> { owner, onStabilized, onFrame, onSettled }
let simSeq = 0;

const stopPhysicsSim = (simId) => {
  if (!sims.has(simId)) return;
  sims.delete(simId);
  worker?.postMessage({ type: 'physics-stop', simId });
};

// One simulation per owner at a time. With `stabilize`, `onStabilized` gets
// the positions after production's 350 silent iterations; `onFrame` then
// gets each live frame and `onSettled` the positions once nodes stop.
// Returns { stop, moveNode(id, position, fixed) }: a dragged node is pinned
// at the pointer and wakes the simulation, as in vis-network.
export const startPhysics = (owner, { nodeIds, edgePairs, positions, stabilize = false }, { onStabilized, onFrame, onSettled } = {}) => {
  sims.forEach((sim, simId) => {
    if (sim.owner === owner) stopPhysicsSim(simId);
  });
  const simId = ++simSeq;
  sims.set(simId, { owner, onStabilized, onFrame, onSettled });
  ensureWorker().postMessage({ type: 'physics-start', simId, nodeIds, edgePairs, positions, stabilize });
  return {
    stop: () => stopPhysicsSim(simId),
    moveNode: (id, position, fixed) => {
      if (sims.has(simId)) worker?.postMessage({ type: 'physics-node', simId, id, position, fixed });
    },
  };
};

// Chart window metrics (G5) in the worker; without a Worker they run here.
// input: { nodeIds, edges: [{ key, source, target }] } -> the metric's result
// (features/chart/lib/chartMetrics.js).
export const requestChartMetric = (metric, input) => {
  if (typeof Worker === 'undefined') return import('../../chart/lib/chartMetrics.js').then(({ computeChartMetric }) => computeChartMetric(metric, input));
  seq += 1;
  const requestId = seq;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    ensureWorker().postMessage({ type: 'chart-metric', requestId, metric, input });
  });
};

// Network measures (G3.5 i2 #3) in the worker, off the main thread; without
// a Worker (tests, old browsers) they run here. -> { [nodeId]: score }
export const requestMeasure = (measure, nodeIds, edgePairs) => {
  if (typeof Worker === 'undefined') return import('./networkMeasures.js').then(({ computeMeasure }) => computeMeasure(measure, nodeIds, edgePairs));
  seq += 1;
  const requestId = seq;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    ensureWorker().postMessage({ type: 'measure', requestId, measure, nodeIds, edgePairs });
  });
};
