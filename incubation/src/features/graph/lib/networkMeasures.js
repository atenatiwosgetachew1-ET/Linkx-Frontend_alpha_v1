// Network measures (G3.5 i2 benchmark #3; after IBM i2 Analyst's Notebook,
// not in production; analyst decision 2026-11-16): betweenness, closeness
// and eigenvector centrality of the drawn nodes, over the drawn links taken
// as undirected and unweighted (one link per pair counts once). Pure, so the
// layout worker runs them (lib/layoutClient.js requestMeasure) and tests run
// them directly. Results size and colour the nodes like Visualize by Degree.

export const MEASURES = Object.freeze({
  betweenness: { label: 'Betweenness', hint: 'How often a node lies on the shortest paths between others (brokers, bridges).' },
  closeness: { label: 'Closeness', hint: 'How near a node is to all the others (harmonic, so separate parts count).' },
  eigenvector: { label: 'Eigenvector', hint: 'How well connected a node is to other well-connected nodes (influence).' },
});

// nodeIds + [[from, to]] -> neighbour lists by index.
const adjacencyOf = (nodeIds, edgePairs) => {
  const index = new Map(nodeIds.map((id, i) => [String(id), i]));
  const sets = nodeIds.map(() => new Set());
  edgePairs.forEach(([from, to]) => {
    const a = index.get(String(from));
    const b = index.get(String(to));
    if (a === undefined || b === undefined || a === b) return;
    sets[a].add(b);
    sets[b].add(a);
  });
  return sets.map((set) => [...set]);
};

// Brandes (2001), unweighted; normalized by (n-1)(n-2)/2 (undirected).
const betweenness = (adjacency) => {
  const n = adjacency.length;
  const score = new Float64Array(n);
  const sigma = new Float64Array(n);
  const distance = new Int32Array(n);
  const delta = new Float64Array(n);
  const stack = new Int32Array(n);
  const queue = new Int32Array(n);
  const preds = Array.from({ length: n }, () => []);
  for (let s = 0; s < n; s += 1) {
    sigma.fill(0);
    distance.fill(-1);
    delta.fill(0);
    for (let i = 0; i < n; i += 1) preds[i].length = 0;
    sigma[s] = 1;
    distance[s] = 0;
    let head = 0;
    let tail = 0;
    let top = 0;
    queue[tail] = s;
    tail += 1;
    while (head < tail) {
      const v = queue[head];
      head += 1;
      stack[top] = v;
      top += 1;
      adjacency[v].forEach((w) => {
        if (distance[w] < 0) {
          distance[w] = distance[v] + 1;
          queue[tail] = w;
          tail += 1;
        }
        if (distance[w] === distance[v] + 1) {
          sigma[w] += sigma[v];
          preds[w].push(v);
        }
      });
    }
    while (top > 0) {
      top -= 1;
      const w = stack[top];
      preds[w].forEach((v) => {
        delta[v] += (sigma[v] / sigma[w]) * (1 + delta[w]);
      });
      if (w !== s) score[w] += delta[w];
    }
  }
  // Each pair was counted from both ends.
  const scale = n > 2 ? 1 / ((n - 1) * (n - 2)) : 0;
  return Array.from(score, (value) => value * scale);
};

// Harmonic closeness: mean of 1 / distance to every other node (0 when
// unreachable), so nodes in separate parts still compare.
const closeness = (adjacency) => {
  const n = adjacency.length;
  const distance = new Int32Array(n);
  const queue = new Int32Array(n);
  return adjacency.map((_, s) => {
    distance.fill(-1);
    distance[s] = 0;
    let head = 0;
    let tail = 0;
    queue[tail] = s;
    tail += 1;
    let sum = 0;
    while (head < tail) {
      const v = queue[head];
      head += 1;
      adjacency[v].forEach((w) => {
        if (distance[w] >= 0) return;
        distance[w] = distance[v] + 1;
        sum += 1 / distance[w];
        queue[tail] = w;
        tail += 1;
      });
    }
    return n > 1 ? sum / (n - 1) : 0;
  });
};

// Power iteration on A + I (the shift keeps bipartite graphs from
// oscillating; same eigenvectors), scaled so the largest is 1.
const eigenvector = (adjacency, { iterations = 200, tolerance = 1e-9 } = {}) => {
  const n = adjacency.length;
  if (!n) return [];
  let x = new Float64Array(n).fill(1 / Math.sqrt(n));
  for (let step = 0; step < iterations; step += 1) {
    const next = new Float64Array(n);
    for (let v = 0; v < n; v += 1) {
      let sum = x[v];
      adjacency[v].forEach((w) => { sum += x[w]; });
      next[v] = sum;
    }
    // (No spread into Math.hypot: large graphs pass the argument limit.)
    let squares = 0;
    for (let v = 0; v < n; v += 1) squares += next[v] * next[v];
    const norm = Math.sqrt(squares) || 1;
    let change = 0;
    for (let v = 0; v < n; v += 1) {
      next[v] /= norm;
      change += Math.abs(next[v] - x[v]);
    }
    x = next;
    if (change < tolerance * n) break;
  }
  // Isolated nodes keep only their own share: count them as 0.
  const values = Array.from(x, (value, v) => (adjacency[v].length ? value : 0));
  const max = values.reduce((top, value) => (value > top ? value : top), 0);
  return values.map((value) => (max > 0 ? value / max : 0));
};

const RUN = { betweenness, closeness, eigenvector };

// -> { [nodeId]: score } for the measure.
export const computeMeasure = (measure, nodeIds, edgePairs) => {
  const run = RUN[measure];
  if (!run) throw new Error(`Unknown measure: ${measure}`);
  const ids = nodeIds.map(String);
  const scores = run(adjacencyOf(ids, edgePairs));
  return Object.fromEntries(ids.map((id, i) => [id, scores[i]]));
};

// The highest scores first: [[id, score]].
export const topScores = (scores, count = 5) => Object.entries(scores)
  .sort(([, a], [, b]) => b - a)
  .slice(0, count);
