// Production physics (graphs_basic.html STABLE_PHYSICS on vis-network's
// barnesHut solver), ported force for force so a graph settles the way it
// does in production:
//   central gravity  F = centralGravity / d × (−x, −y)
//   repulsion        F = G × m1 × m2 / d³ × (dx, dy)   (G < 0, exact sum,
//                    which Barnes–Hut approximates; physics is limited to
//                    fewer than 300 shown nodes, so n² stays small)
//   springs          F = k × (L − d) / d × (dx, dy)
//   integration      v += (F − damping × v) / m × dt, |v| ≤ maxVelocity,
//                    x += v × dt; settled when every |v| < minVelocity.
// vis's "dynamic" edge support nodes and adaptive timestep are not modelled.
export const PRODUCTION_PHYSICS = Object.freeze({
  gravitationalConstant: -14500,
  centralGravity: 0.3, // vis barnesHut default
  springLength: 12,
  springConstant: 0.06,
  damping: 0.85,
  maxVelocity: 18,
  minVelocity: 2.5,
  timestep: 0.6,
  stabilizationIterations: 350,
});

export const createSimulation = ({ nodeIds = [], edgePairs = [], positions = {}, fixed = [] }, options = PRODUCTION_PHYSICS) => {
  const n = nodeIds.length;
  const index = new Map(nodeIds.map((id, i) => [id, i]));
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  const pinned = new Uint8Array(n);
  nodeIds.forEach((id, i) => {
    const position = positions[id] || { x: Math.cos(i) * 100, y: Math.sin(i) * 100 };
    x[i] = position.x;
    y[i] = position.y;
  });
  fixed.forEach((id) => {
    if (index.has(id)) pinned[index.get(id)] = 1;
  });
  const springs = [];
  edgePairs.forEach(([source, target]) => {
    const a = index.get(source);
    const b = index.get(target);
    if (a !== undefined && b !== undefined && a !== b) springs.push(a, b);
  });

  const { gravitationalConstant: G, centralGravity, springLength, springConstant, damping, maxVelocity, timestep: dt } = options;

  const velocity = (v, force) => {
    const next = v + (force - damping * v) * dt; // mass 1
    return Math.abs(next) > maxVelocity ? Math.sign(next) * maxVelocity : next;
  };

  // One physics step; returns the largest node speed.
  const step = () => {
    for (let i = 0; i < n; i += 1) {
      const d = Math.hypot(x[i], y[i]);
      const g = d === 0 ? 0 : centralGravity / d;
      fx[i] = -x[i] * g;
      fy[i] = -y[i] * g;
    }
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        let dx = x[j] - x[i];
        const dy = y[j] - y[i];
        let d = Math.sqrt(dx * dx + dy * dy);
        if (d === 0) {
          d = 0.1;
          dx = d;
        }
        const f = G / (d * d * d);
        fx[i] += dx * f;
        fy[i] += dy * f;
        fx[j] -= dx * f;
        fy[j] -= dy * f;
      }
    }
    for (let s = 0; s < springs.length; s += 2) {
      const a = springs[s];
      const b = springs[s + 1];
      const dx = x[a] - x[b];
      const dy = y[a] - y[b];
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.01);
      const f = (springConstant * (springLength - d)) / d;
      fx[a] += dx * f;
      fy[a] += dy * f;
      fx[b] -= dx * f;
      fy[b] -= dy * f;
    }
    let fastest = 0;
    for (let i = 0; i < n; i += 1) {
      if (pinned[i]) {
        vx[i] = 0;
        vy[i] = 0;
        continue;
      }
      vx[i] = velocity(vx[i], fx[i]);
      vy[i] = velocity(vy[i], fy[i]);
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      fastest = Math.max(fastest, Math.hypot(vx[i], vy[i]));
    }
    return fastest;
  };

  const readPositions = () => {
    const out = {};
    nodeIds.forEach((id, i) => {
      out[id] = { x: x[i], y: y[i] };
    });
    return out;
  };

  // Moves and/or pins one node (production pins a node while it is dragged).
  const setNode = (id, { position, fixed: fix } = {}) => {
    const i = index.get(id);
    if (i === undefined) return;
    if (position) {
      x[i] = position.x;
      y[i] = position.y;
    }
    if (fix !== undefined) pinned[i] = fix ? 1 : 0;
  };

  return { step, positions: readPositions, setNode, isSettled: (speed) => speed < options.minVelocity };
};
