import { formatFigure, looksLikeId, parseAmount } from '../../../shared/numbers/values.js';
import { computeMeasure } from '../../graph/lib/networkMeasures.js';
import { MAX_BUCKETS, TIME_UNITS, unitFits, bucketStart, chooseUnit, formatBucket, nextBucket, parseTimelineDate } from '../../graph/lib/graphTimeline.js';

// Chart window metrics (G5; production's Chart window menu, A:10577-10614,
// whose values were mostly Math.random(); analyst decisions 2026-11-18):
// every value is computed, and checked against networkx in the tests
// (__fixtures__/chartMetrics.networkx.json). Conventions match the Graph
// window's Analyze measures: centralities over the links taken as
// undirected and unweighted (a pair counts once); metrics that are directed
// by definition (In / Out, PageRank, HITS, Reciprocity) follow the
// link direction.
//
// Pure, so the layout worker runs them (lib/layoutClient.js
// requestChartMetric) and the tests run them directly.
//
// input: { nodeIds: [id], edges: [{ key, source, target, weight? }],
// weightLabel? } (the scope's nodes and the links among them)
// result: { kind: 'node' | 'edge', form, series: [{ name, values: { id: number } }], summary? }
//       | { kind: 'global', form: 'figures', items: [{ label, value, hint }] }

// Every metric production offers, in its menu order. `slice`: the G5 slice
// that brings it (later ones are listed, unavailable, until then). `form`:
// production's chart type. `maxNodes`: above this the metric is refused
// (it grows with nodes x links).
// advanced: a specialist measure (it takes some network-analysis background
// to read), tagged "Advanced" in the menu and on its card (analyst decision
// 2026-11-18); listed in its level like the others.
//
// Removed (analyst decision 2026-11-18, after a review against i2 Analyst's
// Notebook): Katz (shows what PageRank and Eigenvector show), Local
// Eccentricity (little to read on fragmented evidence graphs), Edge
// Embeddedness and Edge Similarity (rarely acted on).
export const ADVANCED_HINT = 'A specialist network measure: read its footnote for what it shows.';

export const METRIC_GROUPS = Object.freeze([
  { id: 'global', label: 'Global-Level Charts' },
  { id: 'node', label: 'Node-Level Charts' },
  { id: 'edge', label: 'Edge-Level Charts' },
]);

export const CHART_METRICS = Object.freeze([
  { id: 'assortativity', label: 'Assortativity', group: 'global', slice: 'G5.4', form: 'pairs', advanced: true, hint: 'Whether linked entities have alike numbers of links (Newman\u2019s degree assortativity, -1 to 1); each link a point at its two ends\u2019 degrees.' },
  { id: 'reciprocity', label: 'Reciprocity', group: 'global', slice: 'G5.4', form: 'bar', hint: 'Share of links answered by a link back (overall, and for each entity).' },
  { id: 'globalMetrics', label: 'Global Metrics', group: 'global', slice: 'G5.4', form: 'figures', maxNodes: 5000, hint: 'The network as a whole: size, density, distances, clustering, assortativity, reciprocity.' },
  { id: 'cohesion', label: 'Cohesion Metrics', group: 'global', slice: 'G5.4', form: 'figures', hint: 'How the network holds together: parts, bridges and cut points, communities (as Analyze \u25b8 Detect Communities finds them), centralization.' },
  { id: 'temporal', label: 'Temporal Metrics', group: 'global', slice: 'G5.5', form: 'time', hint: 'The network period by period (the Graph window\u2019s timeline date field and slicing): churn, density, centralization, modularity, links.' },
  { id: 'heatMatrix', label: 'Heat Matrix (Day \u00d7 Hour)', group: 'global', slice: 'G6.0', form: 'heatmap', hint: 'Links by weekday and hour of day, from the timeline date field (as i2\u2019s Heat Matrix); a cell selects its links. Dates without a time of day show the weekday only.' },
  { id: 'histogram', label: 'Histogram', group: 'global', slice: 'G6.0', form: 'bins', param: true, hint: 'Entities or links counted by a property you choose (as i2\u2019s Histogram): numbers in ranges, dates by period, text by value; a bar selects its items.' },
  { id: 'degreeDistribution', label: 'Degree Distribution', group: 'global', slice: 'G6.0', form: 'bins', hint: 'How many entities have 1, 2, 3\u2026 links; a long tail shows hubs. A bar selects its entities.' },
  { id: 'communitySizes', label: 'Community Sizes', group: 'global', slice: 'G6.0', form: 'bins', hint: 'The communities Analyze \u25b8 Detect Communities finds over the scope, largest first (as i2\u2019s Find Clusters); a bar selects its members.' },
  { id: 'degree', label: 'Degree Centrality', group: 'node', slice: 'G5.1', form: 'bar', hint: 'Links each entity has in the scope (parallel links each count).' },
  { id: 'inOut', label: 'In / Out Degree', group: 'node', slice: 'G5.1', form: 'dualbar', hint: 'Links arriving at and leaving each entity.' },
  { id: 'moneyFlow', label: 'Flow In / Out / Net', group: 'node', slice: 'G6.0', form: 'dualbar', hint: 'Amount arriving at and leaving each entity, and the difference, from the links\u2019 weight (the Graph window\u2019s weight key, else weight or value). In \u2248 out with a small net: a pass-through.' },
  { id: 'fanInOut', label: 'Fan-in / Fan-out', group: 'node', slice: 'G6.0', form: 'dualbar', hint: 'Distinct entities sending to and receiving from each entity (parallel links count once): many in, one out collects; one in, many out spreads.' },
  { id: 'betweenness', label: 'Betweenness Centrality', group: 'node', slice: 'G5.1', form: 'bar', maxNodes: 5000, hint: 'How often an entity lies on the shortest paths between others (brokers, bridges); normalized.' },
  { id: 'closeness', label: 'Closeness Centrality', group: 'node', slice: 'G5.1', form: 'bar', maxNodes: 5000, hint: 'How near an entity is to all the others (harmonic, so separate parts count).' },
  { id: 'eigenvector', label: 'Eigenvector Centrality', group: 'node', slice: 'G5.1', form: 'line', hint: 'How well connected an entity is to other well-connected entities (largest = 1).' },
  { id: 'pagerank', label: 'PageRank', group: 'node', slice: 'G5.2', form: 'bar', hint: 'Importance from incoming links of important entities (damping 0.85; sums to 1).' },
  { id: 'clustering', label: 'Clustering Coefficient', group: 'node', slice: 'G5.2', form: 'scatter', hint: 'How many of an entity\u2019s neighbours are linked to each other (0 to 1).' },
  { id: 'hits', label: 'HITS (Authority / Hub Scores)', group: 'node', slice: 'G5.2', form: 'dualbar', advanced: true, hint: 'Authorities receive links from good hubs; hubs link to good authorities (each sums to 1).' },
  { id: 'constraint', label: 'Constraint (Structural Holes)', group: 'node', slice: 'G5.2', form: 'scatter', advanced: true, hint: 'Burt\u2019s constraint: low for brokers between unconnected neighbours (entities without links have none).' },
  { id: 'ego', label: 'Ego Network Size / Density', group: 'node', slice: 'G5.2', form: 'dualbar', hint: 'An entity with its neighbours: how many they are (with the entity) and how densely linked.' },
  { id: 'kcore', label: 'K-Core Number', group: 'node', slice: 'G5.2', form: 'bar', hint: 'The deepest core an entity belongs to (every member has at least k links in it). In production\u2019s code, not its menu.' },
  { id: 'edgeBetweenness', label: 'Edge Betweenness', group: 'edge', slice: 'G5.3', form: 'bar', maxNodes: 5000, hint: 'How often a link lies on the shortest paths between entities (bridges); normalized. Parallel links share their pair\u2019s value.' },
  { id: 'edgeWeight', label: 'Edge Weight', group: 'edge', slice: 'G5.3', form: 'bar', hint: 'Each link\u2019s weight from the Graph window\u2019s weight key (link aggregation total, else edge weight); else its weight or value field.' },
]);

export const AVAILABLE_SLICES = new Set(['G5.1', 'G5.2', 'G5.3', 'G5.4', 'G5.5', 'G6.0']);
export const metricById = (id) => CHART_METRICS.find((metric) => metric.id === id) || null;
export const isMetricAvailable = (metric) => Boolean(metric && AVAILABLE_SLICES.has(metric.slice));

const pairsOf = (edges) => edges.map((edge) => [edge.source, edge.target]);

// Every link counts at both ends (a self link twice), as production's
// calculateDegree and networkx's MultiGraph degree.
const degree = ({ nodeIds, edges }) => {
  const values = Object.fromEntries(nodeIds.map((id) => [id, 0]));
  edges.forEach(({ source, target }) => {
    if (source in values) values[source] += 1;
    if (target in values) values[target] += 1;
  });
  return { kind: 'node', form: 'bar', series: [{ name: 'Degree', values }] };
};

const inOut = ({ nodeIds, edges }) => {
  const inValues = Object.fromEntries(nodeIds.map((id) => [id, 0]));
  const outValues = Object.fromEntries(nodeIds.map((id) => [id, 0]));
  edges.forEach(({ source, target }) => {
    if (source in outValues) outValues[source] += 1;
    if (target in inValues) inValues[target] += 1;
  });
  return { kind: 'node', form: 'dualbar', series: [{ name: 'In', values: inValues }, { name: 'Out', values: outValues }] };
};

const measure = (name, label, form) => ({ nodeIds, edges }) => ({
  kind: 'node',
  form,
  series: [{ name: label, values: computeMeasure(name, nodeIds, pairsOf(edges)) }],
});

/* ── G5.2 node metrics (ports of networkx 3.4, the reference) ── */

// Undirected simple neighbour sets (a pair once, no self links) by id.
const undirectedOf = ({ nodeIds, edges }) => {
  const neighbours = new Map(nodeIds.map((id) => [id, new Set()]));
  edges.forEach(({ source, target }) => {
    if (source === target || !neighbours.has(source) || !neighbours.has(target)) return;
    neighbours.get(source).add(target);
    neighbours.get(target).add(source);
  });
  return neighbours;
};
// Directed simple successors / predecessors (each direction once, no self links).
const directedOf = ({ nodeIds, edges }) => {
  const out = new Map(nodeIds.map((id) => [id, new Set()]));
  const into = new Map(nodeIds.map((id) => [id, new Set()]));
  edges.forEach(({ source, target }) => {
    if (source === target || !out.has(source) || !out.has(target)) return;
    out.get(source).add(target);
    into.get(target).add(source);
  });
  return { out, into };
};
// (No spread into Math.max: large graphs pass the argument limit.)
const largest = (map) => {
  let top = -Infinity;
  map.forEach((value) => { if (value > top) top = value; });
  return top;
};
const notConverged = (label) => new Error(`${label} did not settle for this graph; try another scope.`);

// networkx pagerank (_pagerank_python): damping 0.85, uniform start and
// teleport, dangling entities spread evenly.
const pagerank = (input) => {
  const { out } = directedOf(input);
  const ids = input.nodeIds;
  const n = ids.length;
  if (!n) return node('PageRank', 'bar', {});
  const alpha = 0.85;
  const tolerance = 1e-12;
  let x = new Map(ids.map((id) => [id, 1 / n]));
  const dangling = ids.filter((id) => !out.get(id).size);
  for (let step = 0; step < 10000; step += 1) {
    const last = x;
    x = new Map(ids.map((id) => [id, 0]));
    const dangleSum = alpha * dangling.reduce((sum, id) => sum + last.get(id), 0);
    ids.forEach((id) => {
      const share = out.get(id).size;
      out.get(id).forEach((next) => { x.set(next, x.get(next) + (alpha * last.get(id)) / share); });
    });
    let error = 0;
    ids.forEach((id) => {
      x.set(id, x.get(id) + dangleSum / n + (1 - alpha) / n);
      error += Math.abs(x.get(id) - last.get(id));
    });
    if (error < n * tolerance) return node('PageRank', 'bar', Object.fromEntries(x));
  }
  throw notConverged('PageRank');
};

// networkx clustering (undirected, unweighted).
const clustering = (input) => {
  const neighbours = undirectedOf(input);
  const values = {};
  neighbours.forEach((set, id) => {
    const list = [...set];
    const k = list.length;
    if (k < 2) {
      values[id] = 0;
      return;
    }
    let links = 0;
    for (let i = 0; i < k; i += 1) {
      const near = neighbours.get(list[i]);
      for (let j = i + 1; j < k; j += 1) if (near.has(list[j])) links += 1;
    }
    values[id] = (2 * links) / (k * (k - 1));
  });
  return node('Clustering', 'scatter', values);
};

// Breadth-first distances from one entity (undirected).
const distancesFrom = (neighbours, start) => {
  const distance = new Map([[start, 0]]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    neighbours.get(current).forEach((next) => {
      if (distance.has(next)) return;
      distance.set(next, distance.get(current) + 1);
      queue.push(next);
    });
  }
  return distance;
};

// networkx hits (_hits_python): uniform start, max-scaled each step, each
// score set summing to 1 at the end.
const hits = (input) => {
  const { out } = directedOf(input);
  const ids = input.nodeIds;
  const n = ids.length;
  if (!n) return { kind: 'node', form: 'dualbar', series: [{ name: 'Authority', values: {} }, { name: 'Hub', values: {} }] };
  const tolerance = 1e-12;
  let h = new Map(ids.map((id) => [id, 1 / n]));
  let a = new Map();
  const scaleBy = (map, value) => { if (value > 0) map.forEach((score, id) => map.set(id, score / value)); };
  let settled = false;
  for (let step = 0; step < 10000; step += 1) {
    const last = h;
    h = new Map(ids.map((id) => [id, 0]));
    a = new Map(ids.map((id) => [id, 0]));
    ids.forEach((id) => out.get(id).forEach((next) => { a.set(next, a.get(next) + last.get(id)); }));
    ids.forEach((id) => out.get(id).forEach((next) => { h.set(id, h.get(id) + a.get(next)); }));
    scaleBy(h, largest(h));
    scaleBy(a, largest(a));
    let error = 0;
    ids.forEach((id) => { error += Math.abs(h.get(id) - last.get(id)); });
    if (error < tolerance) {
      settled = true;
      break;
    }
  }
  if (!settled) throw notConverged('HITS');
  const sum = (map) => [...map.values()].reduce((total, value) => total + value, 0);
  scaleBy(a, sum(a));
  scaleBy(h, sum(h));
  return { kind: 'node', form: 'dualbar', series: [{ name: 'Authority', values: Object.fromEntries(a) }, { name: 'Hub', values: Object.fromEntries(h) }] };
};

// networkx constraint (Burt), undirected and unweighted: each neighbour's
// share is 1 / degree; entities without links have none (left out).
const constraint = (input) => {
  const neighbours = undirectedOf(input);
  const share = (u, v) => (neighbours.get(u).has(v) ? 1 / neighbours.get(u).size : 0);
  const values = {};
  neighbours.forEach((set, v) => {
    if (!set.size) return;
    let total = 0;
    set.forEach((n) => {
      let indirect = 0;
      set.forEach((w) => { indirect += share(v, w) * share(w, n); });
      total += (share(v, n) + indirect) ** 2;
    });
    values[v] = total;
  });
  return node('Constraint', 'scatter', values);
};

// networkx ego_graph (radius 1, undirected): size with the entity itself,
// density of the links among them.
const ego = (input) => {
  const neighbours = undirectedOf(input);
  const size = {};
  const density = {};
  neighbours.forEach((set, id) => {
    const members = [id, ...set];
    const k = members.length;
    let links = set.size;
    const list = [...set];
    for (let i = 0; i < list.length; i += 1) {
      const near = neighbours.get(list[i]);
      for (let j = i + 1; j < list.length; j += 1) if (near.has(list[j])) links += 1;
    }
    size[id] = k;
    density[id] = k > 1 ? (2 * links) / (k * (k - 1)) : 0;
  });
  return { kind: 'node', form: 'dualbar', series: [{ name: 'Size', values: size }, { name: 'Density', values: density, axis: 1 }] };
};

// networkx core_number (Batagelj-Zaversnik), undirected, no self links.
const kcore = (input) => {
  const neighbours = undirectedOf(input);
  const degree = new Map([...neighbours].map(([id, set]) => [id, set.size]));
  const order = [...degree.keys()].sort((a, b) => degree.get(a) - degree.get(b));
  const position = new Map(order.map((id, index) => [id, index]));
  const binStart = [];
  let current = 0;
  order.forEach((id, index) => {
    const d = degree.get(id);
    while (current <= d) {
      binStart[current] = index;
      current += 1;
    }
  });
  const core = new Map(degree);
  order.forEach((_, index) => {
    const v = order[index];
    neighbours.get(v).forEach((u) => {
      if (core.get(u) > core.get(v)) {
        const du = core.get(u);
        const pu = position.get(u);
        const pw = binStart[du];
        const w = order[pw];
        if (u !== w) {
          order[pu] = w;
          order[pw] = u;
          position.set(u, pw);
          position.set(w, pu);
        }
        binStart[du] += 1;
        core.set(u, du - 1);
      }
    });
  });
  return node('K-core', 'bar', Object.fromEntries(core));
};

const node = (name, form, values) => ({ kind: 'node', form, series: [{ name, values }] });

/* ── G5.3 edge metrics (per link; self links have none) ── */

const edgeResult = (form, series) => ({ kind: 'edge', form, series });
const pairKey = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);

// networkx edge_betweenness_centrality (undirected, unweighted,
// normalized by n(n-1)); parallel links share their pair's value.
const edgeBetweenness = (input) => {
  const neighbours = undirectedOf(input);
  const ids = input.nodeIds;
  const credit = new Map(); // pair -> sum
  ids.forEach((source) => {
    const sigma = new Map([[source, 1]]);
    const distance = new Map([[source, 0]]);
    const preds = new Map([[source, []]]);
    const stack = [];
    const queue = [source];
    for (let head = 0; head < queue.length; head += 1) {
      const v = queue[head];
      stack.push(v);
      neighbours.get(v).forEach((w) => {
        if (!distance.has(w)) {
          distance.set(w, distance.get(v) + 1);
          sigma.set(w, 0);
          preds.set(w, []);
          queue.push(w);
        }
        if (distance.get(w) === distance.get(v) + 1) {
          sigma.set(w, sigma.get(w) + sigma.get(v));
          preds.get(w).push(v);
        }
      });
    }
    const delta = new Map(stack.map((id) => [id, 0]));
    while (stack.length) {
      const w = stack.pop();
      preds.get(w).forEach((v) => {
        const c = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
        const key = pairKey(v, w);
        credit.set(key, (credit.get(key) || 0) + c);
        delta.set(v, delta.get(v) + c);
      });
    }
  });
  const n = ids.length;
  const scale = n > 1 ? 1 / (n * (n - 1)) : 0;
  const values = {};
  input.edges.forEach(({ key, source, target }) => {
    if (source === target) return;
    values[key] = (credit.get(pairKey(source, target)) || 0) * scale;
  });
  return edgeResult('bar', [{ name: 'Edge betweenness', values }]);
};

// Each link's weight, as the window measured it (scopeInput: the Graph
// window's weight key, else weight / value); links without one are left out.
const edgeWeight = (input) => {
  const values = {};
  input.edges.forEach(({ key, weight }) => {
    if (typeof weight === 'number' && Number.isFinite(weight)) values[key] = weight;
  });
  const missing = input.edges.length - Object.keys(values).length;
  const result = edgeResult('bar', [{ name: input.weightLabel ? `Weight (${input.weightLabel})` : 'Weight', values }]);
  return missing && Object.keys(values).length ? { ...result, note: `${missing.toLocaleString('en-GB')} ${missing === 1 ? 'link' : 'links'} without a readable amount left out.` } : result;
};

/* ── G5.4 global metrics ── */

// { kind: 'global', form: 'figures', items: [{ label, value, hint }] }
// (value null: not defined for this graph).
const figures = (items) => ({ kind: 'global', form: 'figures', items });

// Every finite shortest distance between two different entities (undirected).
const allDistances = (neighbours) => {
  let sum = 0;
  let count = 0;
  let longest = 0;
  neighbours.forEach((_, id) => {
    distancesFrom(neighbours, id).forEach((steps, other) => {
      if (other === id) return;
      sum += steps;
      count += 1;
      if (steps > longest) longest = steps;
    });
  });
  return { average: count ? sum / count : 0, diameter: longest };
};

const pairsOfLinks = (neighbours) => {
  const pairs = [];
  neighbours.forEach((set, u) => set.forEach((v) => { if (u < v) pairs.push([u, v]); }));
  return pairs;
};

// Newman's degree assortativity: the Pearson correlation of the two ends'
// degrees over every link, both ways (networkx
// degree_assortativity_coefficient); null when the degrees do not vary.
const assortativityOf = (neighbours) => {
  const xs = [];
  const ys = [];
  pairsOfLinks(neighbours).forEach(([u, v]) => {
    const a = neighbours.get(u).size;
    const b = neighbours.get(v).size;
    xs.push(a, b);
    ys.push(b, a);
  });
  if (!xs.length) return null;
  const mean = (list) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const mx = mean(xs);
  const my = mean(ys);
  let cov = 0;
  let vx = 0;
  let vy = 0;
  xs.forEach((x, index) => {
    cov += (x - mx) * (ys[index] - my);
    vx += (x - mx) ** 2;
    vy += (ys[index] - my) ** 2;
  });
  return vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : null;
};

// networkx overall_reciprocity: links answered by a link back, over all
// directed links (each direction once, no self links).
const overallReciprocity = ({ out }) => {
  let total = 0;
  let answered = 0;
  out.forEach((set, u) => set.forEach((v) => {
    total += 1;
    if (out.get(v).has(u)) answered += 1;
  }));
  return total ? answered / total : null;
};

const transitivityOf = (neighbours) => {
  let triangles = 0;
  let triads = 0;
  neighbours.forEach((set) => {
    const list = [...set];
    const k = list.length;
    triads += (k * (k - 1)) / 2;
    for (let i = 0; i < k; i += 1) {
      const near = neighbours.get(list[i]);
      for (let j = i + 1; j < k; j += 1) if (near.has(list[j])) triangles += 1;
    }
  });
  return triads ? triangles / triads : 0;
};

const globalMetrics = (input) => {
  const neighbours = undirectedOf(input);
  const n = input.nodeIds.length;
  const pairs = pairsOfLinks(neighbours).length;
  const { average, diameter } = allDistances(neighbours);
  const clusteringValues = Object.values(clustering(input).series[0].values);
  return figures([
    { label: 'Number of Nodes', value: n, hint: 'Entities in the scope.' },
    { label: 'Number of Edges', value: input.edges.length, hint: 'Links in the scope (theme lines left out).' },
    { label: 'Density', value: n > 1 ? (2 * pairs) / (n * (n - 1)) : 0, hint: 'Linked pairs out of all possible pairs.' },
    { label: 'Average Degree', value: n ? (2 * input.edges.length) / n : 0, hint: 'Links per entity (the Degree Centrality average).' },
    { label: 'Average Path Length', value: average, hint: 'Mean steps between entities that can reach each other.' },
    { label: 'Diameter', value: diameter, hint: 'The longest of those shortest paths.' },
    { label: 'Average Clustering Coefficient', value: clusteringValues.length ? clusteringValues.reduce((sum, value) => sum + value, 0) / clusteringValues.length : 0, hint: 'The mean of each entity\u2019s clustering coefficient.' },
    { label: 'Transitivity', value: transitivityOf(neighbours), hint: 'Closed triangles out of all connected triples.' },
    { label: 'Assortativity', value: assortativityOf(neighbours), hint: 'Degree assortativity: positive when hubs link to hubs.' },
    { label: 'Reciprocity (directed)', value: overallReciprocity(directedOf(input)), hint: 'Links answered by a link back.' },
  ]);
};

// Assortativity: each link (a pair once) as a point at its two ends'
// degrees; the coefficient in the summary.
const assortativity = (input) => {
  const neighbours = undirectedOf(input);
  const values = {};
  const seen = new Set();
  input.edges.forEach(({ key, source, target }) => {
    if (source === target) return;
    const pair = pairKey(source, target);
    if (seen.has(pair)) return;
    seen.add(pair);
    values[key] = [neighbours.get(source).size, neighbours.get(target).size];
  });
  return { kind: 'edge', form: 'pairs', series: [{ name: 'Link ends', values }], summary: { label: 'Degree assortativity', value: assortativityOf(neighbours) } };
};

// Reciprocity per entity (networkx reciprocity: 2 x answered neighbours /
// (in + out); entities without links have none) and overall.
const reciprocity = (input) => {
  const graph = directedOf(input);
  const values = {};
  input.nodeIds.forEach((id) => {
    const into = graph.into.get(id);
    const out = graph.out.get(id);
    const total = into.size + out.size;
    if (!total) return;
    let both = 0;
    out.forEach((other) => { if (into.has(other)) both += 1; });
    values[id] = (2 * both) / total;
  });
  return { ...node('Reciprocity', 'bar', values), summary: { label: 'Overall reciprocity', value: overallReciprocity(graph) } };
};

// Connected parts (undirected).
const partsOf = (neighbours) => {
  const seen = new Set();
  const parts = [];
  neighbours.forEach((_, id) => {
    if (seen.has(id)) return;
    const part = [...distancesFrom(neighbours, id).keys()];
    part.forEach((member) => seen.add(member));
    parts.push(part);
  });
  return parts;
};

// Bridges and cut points (Tarjan, iterative), undirected simple.
const bridgesAndCutPoints = (neighbours) => {
  const discovery = new Map();
  const low = new Map();
  const cut = new Set();
  let bridges = 0;
  let time = 0;
  neighbours.forEach((_, root) => {
    if (discovery.has(root)) return;
    discovery.set(root, ++time);
    low.set(root, time);
    let rootChildren = 0;
    const stack = [{ node: root, parent: null, next: neighbours.get(root).values() }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const step = frame.next.next();
      if (!step.done) {
        const other = step.value;
        if (!discovery.has(other)) {
          if (frame.node === root) rootChildren += 1;
          discovery.set(other, ++time);
          low.set(other, time);
          stack.push({ node: other, parent: frame.node, next: neighbours.get(other).values() });
        } else if (other !== frame.parent) {
          low.set(frame.node, Math.min(low.get(frame.node), discovery.get(other)));
        }
        continue;
      }
      stack.pop();
      const { parent } = frame;
      if (parent == null) continue;
      low.set(parent, Math.min(low.get(parent), low.get(frame.node)));
      if (low.get(frame.node) > discovery.get(parent)) bridges += 1;
      if (parent !== root && low.get(frame.node) >= discovery.get(parent)) cut.add(parent);
    }
    if (rootChildren > 1) cut.add(root);
  });
  return { bridges, cutPoints: cut.size };
};

// networkx modularity (undirected, unweighted) of a grouping.
export const modularityOf = (neighbours, communities) => {
  const m = pairsOfLinks(neighbours).length;
  if (!m) return null;
  let q = 0;
  communities.forEach((members) => {
    const inside = new Set(members);
    let internal = 0;
    let degrees = 0;
    members.forEach((id) => {
      const set = neighbours.get(id);
      if (!set) return;
      degrees += set.size;
      set.forEach((other) => { if (inside.has(other)) internal += 1; });
    });
    q += internal / 2 / m - (degrees / (2 * m)) ** 2;
  });
  return q;
};

// Cohesion: parts, bridges and cut points, the communities the window found
// (input.communities: the Graph window's Detect Communities over the scope;
// entities outside them count as their own), centralization (Freeman,
// degree).
const cohesion = (input) => {
  const neighbours = undirectedOf(input);
  const n = input.nodeIds.length;
  const parts = partsOf(neighbours);
  const { bridges, cutPoints } = bridgesAndCutPoints(neighbours);
  const placed = new Set();
  const communities = (Array.isArray(input.communities) ? input.communities : [])
    .map((members) => members.map(String).filter((id) => neighbours.has(id) && !placed.has(id) && placed.add(id)))
    .filter((members) => members.length);
  input.nodeIds.forEach((id) => { if (!placed.has(id)) communities.push([id]); });
  const groups = communities.filter((members) => members.length > 1);
  const densityOf = (members) => {
    const inside = new Set(members);
    let links = 0;
    members.forEach((id) => neighbours.get(id).forEach((other) => { if (inside.has(other)) links += 1; }));
    return links / (members.length * (members.length - 1));
  };
  let top = 0;
  neighbours.forEach((set) => { if (set.size > top) top = set.size; });
  let spread = 0;
  neighbours.forEach((set) => { spread += top - set.size; });
  return figures([
    { label: 'Connected Components', value: parts.length, hint: 'Separate parts of the network.' },
    { label: 'Largest Component Ratio', value: n ? parts.reduce((top, part) => Math.max(top, part.length), 0) / n : 0, hint: 'Share of entities in the largest part.' },
    { label: 'Bridge Edges', value: bridges, hint: 'Links whose removal splits a part.' },
    { label: 'Cut Vertices', value: cutPoints, hint: 'Entities whose removal splits a part (Analyze \u25b8 Cut Points).' },
    { label: 'Modularity', value: modularityOf(neighbours, communities), hint: 'How cleanly the communities separate (networkx modularity).' },
    { label: 'Community Count', value: communities.length, hint: 'Communities, as Analyze \u25b8 Detect Communities finds them (lone entities count as their own).' },
    { label: 'Community Density', value: groups.length ? groups.reduce((sum, members) => sum + densityOf(members), 0) / groups.length : 0, hint: 'Mean density inside communities of two or more.' },
    { label: 'Network Centralization', value: n > 2 ? spread / ((n - 1) * (n - 2)) : 0, hint: 'How much the links gather on one entity (Freeman, degree; 0 to 1).' },
  ]);
};

/* ── G5.5 temporal metrics ── */

// Period by period (input.edges[].time: each link's date in ms, from the
// Graph window's timeline date field; input.timeUnit: its slicing, 'auto'
// picks from the span): the network of the links dated in each period and
// their ends. Entity / link churn: how much the active set changed since
// the previous period (changed / either, 0 to 1); density and degree
// centralization of the period's network; modularity of the scope's
// communities (input.communities) within it; the period's links. Not
// defined (null) where a period has nothing to measure.
// -> { kind: 'time', form: 'time', unit, periods: [{ start, label }],
//      series: [{ name, values: [number | null], axis? }], undated }
// Links without a date of their own take their entities' date: said.
const borrowedNote = ({ borrowedTimes }, before) => (borrowedTimes ? `${before}${borrowedTimes.toLocaleString('en-GB')} ${borrowedTimes === 1 ? 'link takes' : 'links take'} the date of an entity` : '');

const temporal = (input) => {
  const dated = input.edges.filter((edge) => typeof edge.time === 'number' && Number.isFinite(edge.time));
  if (!dated.length) throw new Error('No dated links in this scope: the Graph window\u2019s timeline finds no date field on them.');
  let min = Infinity;
  let max = -Infinity;
  dated.forEach(({ time }) => {
    if (time < min) min = time;
    if (time > max) max = time;
  });
  // A unit too fine for the span is widened until every period fits.
  const asked = TIME_UNITS.includes(input.timeUnit) ? input.timeUnit : chooseUnit(min, max);
  const unit = TIME_UNITS.slice(TIME_UNITS.indexOf(asked)).find((candidate) => unitFits(min, max, candidate)) || 'year';
  const periods = [];
  const index = new Map();
  for (let start = bucketStart(min, unit); start <= max && periods.length < MAX_BUCKETS; start = nextBucket(start, unit)) {
    index.set(start, periods.length);
    periods.push({ start, label: formatBucket(start, unit), edges: [] });
  }
  dated.forEach((edge) => periods[index.get(bucketStart(edge.time, unit))]?.edges.push(edge));
  const groupOf = new Map();
  (input.communities || []).forEach((members, group) => members.forEach((id) => { if (!groupOf.has(String(id))) groupOf.set(String(id), group); }));
  const series = { entityChurn: [], linkChurn: [], density: [], centralization: [], modularity: [], links: [] };
  const churn = (now, before) => {
    if (!before) return null;
    let changed = 0;
    now.forEach((item) => { if (!before.has(item)) changed += 1; });
    before.forEach((item) => { if (!now.has(item)) changed += 1; });
    const union = now.size + before.size - (now.size + before.size - changed) / 2;
    return union ? changed / union : null;
  };
  let lastNodes = null;
  let lastPairs = null;
  periods.forEach((period) => {
    const active = new Set();
    period.edges.forEach(({ source, target }) => { active.add(source); active.add(target); });
    const neighbours = undirectedOf({ nodeIds: [...active], edges: period.edges });
    const pairs = new Set(pairsOfLinks(neighbours).map(([u, v]) => pairKey(u, v)));
    const n = active.size;
    series.links.push(period.edges.length);
    if (n) {
      series.density.push(n > 1 ? (2 * pairs.size) / (n * (n - 1)) : 0);
      let top = 0;
      let spread = 0;
      neighbours.forEach((set) => { if (set.size > top) top = set.size; });
      neighbours.forEach((set) => { spread += top - set.size; });
      series.centralization.push(n > 2 ? spread / ((n - 1) * (n - 2)) : 0);
      const groups = new Map();
      active.forEach((id) => {
        const group = groupOf.has(id) ? `g${groupOf.get(id)}` : `own:${id}`;
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(id);
      });
      series.modularity.push(modularityOf(neighbours, [...groups.values()]));
    } else {
      series.density.push(null);
      series.centralization.push(null);
      series.modularity.push(null);
    }
    series.entityChurn.push(churn(active, lastNodes));
    series.linkChurn.push(churn(pairs, lastPairs));
    lastNodes = active;
    lastPairs = pairs;
  });
  const unitLabel = { hour: 'Hourly', day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Quarterly', year: 'Yearly' }[unit];
  return {
    kind: 'time',
    form: 'time',
    unit,
    note: `${unitLabel} periods${input.timeKey ? ` of ${input.timeKey}` : ''}${input.edges.length > dated.length ? ` · ${(input.edges.length - dated.length).toLocaleString('en-GB')} links without a readable date left out` : ''}${borrowedNote(input, ' · ')}${unit === asked ? '' : ' · wider periods than asked, to fit every link'}`,
    periods: periods.map(({ start, label }) => ({ start, label })),
    undated: input.edges.length - dated.length,
    series: [
      { name: 'Entity churn', values: series.entityChurn },
      { name: 'Link churn', values: series.linkChurn },
      { name: 'Density', values: series.density },
      { name: 'Centralization', values: series.centralization },
      { name: 'Modularity', values: series.modularity },
      { name: 'Links', values: series.links, axis: 1 },
    ],
  };
};

/* ── G6.0 (analyst decisions 2026-11-18): flows, fans, distributions,
   activity, after i2 Analyst's Notebook's Histogram, Heat Matrix and Find
   Clusters ── */

// Amount in, out and net per entity from the links' weight; entities
// without any flow left out; ordered by in + out. Self links carry nothing.
const moneyFlow = ({ nodeIds, edges, weightLabel }) => {
  const known = new Set(nodeIds);
  const inValues = {};
  const outValues = {};
  let weighted = 0;
  edges.forEach(({ source, target, weight }) => {
    if (typeof weight !== 'number') return;
    weighted += 1;
    if (source === target) return;
    if (known.has(target)) inValues[target] = (inValues[target] || 0) + weight;
    if (known.has(source)) outValues[source] = (outValues[source] || 0) + weight;
  });
  const ids = nodeIds.filter((id) => id in inValues || id in outValues);
  const of = (map) => Object.fromEntries(ids.map((id) => [id, map[id] || 0]));
  const flowIn = of(inValues);
  const flowOut = of(outValues);
  const net = Object.fromEntries(ids.map((id) => [id, flowIn[id] - flowOut[id]]));
  const order = [...ids].sort((a, b) => (flowIn[b] + flowOut[b]) - (flowIn[a] + flowOut[a]) || a.localeCompare(b, undefined, { numeric: true }));
  const unweighted = edges.length - weighted;
  return {
    kind: 'node',
    form: 'dualbar',
    order,
    series: [{ name: 'In', values: flowIn }, { name: 'Out', values: flowOut }, { name: 'Net', values: net }],
    note: weighted
      ? `Amounts from ${weightLabel || 'the links’ weight'}${unweighted ? `; ${unweighted.toLocaleString('en-GB')} ${unweighted === 1 ? 'link' : 'links'} without one left out` : ''}.`
      : `No link has an amount (${weightLabel || 'weight / value'}): set the Graph window’s weight (link aggregation total).`,
  };
};

// Distinct senders / receivers (directed, a neighbour once, no self links).
const fanInOut = ({ nodeIds, edges }) => {
  const senders = new Map(nodeIds.map((id) => [id, new Set()]));
  const receivers = new Map(nodeIds.map((id) => [id, new Set()]));
  edges.forEach(({ source, target }) => {
    if (source === target) return;
    senders.get(target)?.add(source);
    receivers.get(source)?.add(target);
  });
  const sizes = (map) => Object.fromEntries([...map].map(([id, set]) => [id, set.size]));
  return { kind: 'node', form: 'dualbar', series: [{ name: 'Fan-in', values: sizes(senders) }, { name: 'Fan-out', values: sizes(receivers) }] };
};

// Bins: [{ label, value (count), members: ids }]; a bar selects its members.
const binsResult = (kind, bins, { xName, yName, note, log = false }) => ({ kind, form: 'bins', bins, xName, yName, log, ...(note ? { note } : {}) });

// Entities per degree (Degree Centrality's count: every link at both ends).
const degreeDistribution = (input) => {
  const { values } = degree(input).series[0];
  const byDegree = new Map();
  Object.entries(values).forEach(([id, k]) => {
    if (!byDegree.has(k)) byDegree.set(k, []);
    byDegree.get(k).push(id);
  });
  const bins = [...byDegree].sort((a, b) => a[0] - b[0]).map(([k, members]) => ({ label: String(k), value: members.length, members }));
  const counts = bins.map((bin) => bin.value);
  return binsResult('node', bins, { xName: 'Links', yName: 'Entities', log: counts.length > 1 && Math.max(...counts) / Math.min(...counts) >= 50 });
};

// The scope's communities (the window's Detect Communities), largest first;
// lone entities together in one bar.
const communitySizes = ({ nodeIds, communities }) => {
  const known = new Set(nodeIds);
  const groups = communities.map((members) => members.map(String).filter((id) => known.has(id))).filter((members) => members.length);
  const placed = new Set(groups.flat());
  const alone = [...groups.filter((members) => members.length === 1).flat(), ...nodeIds.filter((id) => !placed.has(id))];
  const bins = groups.filter((members) => members.length > 1)
    .sort((a, b) => b.length - a.length)
    .map((members, index) => ({ label: `C${index + 1}`, value: members.length, members }));
  if (alone.length) bins.push({ label: 'Alone', value: alone.length, members: alone });
  return binsResult('node', bins, { xName: 'Community', yName: 'Members', note: `${(bins.length - (alone.length ? 1 : 0)).toLocaleString('en-GB')} communities of two or more${alone.length ? `; ${alone.length.toLocaleString('en-GB')} entities alone` : ''}.` });
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Links by weekday x hour (local time) from their dates; when no dated link
// has a time of day (all at midnight), by weekday only.
// -> { kind: 'edge', form: 'heatmap', days, hours, cells: [{ day, hour, value, members }], dateOnly, undated }
const heatMatrix = ({ edges, timeKey, borrowedTimes = 0 }) => {
  const dated = edges.filter((edge) => typeof edge.time === 'number');
  const dateOnly = dated.length > 0 && dated.every((edge) => {
    const at = new Date(edge.time);
    return at.getHours() === 0 && at.getMinutes() === 0 && at.getSeconds() === 0;
  });
  const hours = dateOnly ? ['All day'] : Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`);
  const cells = new Map();
  dated.forEach((edge) => {
    const at = new Date(edge.time);
    const day = (at.getDay() + 6) % 7; // Monday first
    const hour = dateOnly ? 0 : at.getHours();
    const key = day * 24 + hour;
    if (!cells.has(key)) cells.set(key, { day, hour, value: 0, members: [] });
    const cell = cells.get(key);
    cell.value += 1;
    cell.members.push(edge.key);
  });
  const undated = edges.length - dated.length;
  const notes = [];
  if (timeKey) notes.push(`From ${timeKey}`);
  if (dateOnly) notes.push('dates have no time of day: by weekday only');
  if (undated) notes.push(`${undated.toLocaleString('en-GB')} undated ${undated === 1 ? 'link' : 'links'} left out`);
  if (borrowedTimes) notes.push(borrowedNote({ borrowedTimes }, ''));
  if (!dated.length) notes.push(timeKey ? 'no dated links in this scope' : 'no date field found on these links');
  return { kind: 'edge', form: 'heatmap', days: WEEKDAYS, hours, cells: [...cells.values()], dateOnly, undated, note: `${notes.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()) };
};

// A step of 1, 2 or 5 x 10^n giving about `count` bins over the span.
const niceStep = (span, count) => {
  const raw = span / Math.max(1, count);
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * power).find((step) => step >= raw) || raw;
};
const HISTOGRAM_TOP = 25;
const formatNumber = formatFigure;
// Account numbers and other ids are counted by value, not in ranges: text
// with a leading zero or 16+ digits, or a column of nothing but long digits.
const areIds = (filled) => filled.some(([, raw]) => looksLikeId(raw))
  || (filled.length > 1 && filled.every(([, raw]) => /^\d{10,}$/.test(String(raw).trim())));

// input.values: [[id, raw value]] of the chosen property; input.subject:
// 'node' | 'edge'. Numbers (most values numeric) in ranges, dates by month
// (by day within two months), else text by value (the most used, the rest
// as Other); empty values in their own bar.
const histogram = ({ values = [], subject = 'node', paramLabel = '' }) => {
  const kind = subject === 'edge' ? 'edge' : 'node';
  const filled = values.filter(([, raw]) => raw != null && String(raw).trim() !== '');
  const empty = values.filter(([, raw]) => raw == null || String(raw).trim() === '').map(([id]) => id);
  const ids = areIds(filled);
  const numbers = filled.map(([id, raw]) => [id, ids ? null : parseAmount(raw)]).filter(([, n]) => n !== null);
  const dates = numbers.length >= filled.length * 0.8 ? [] : filled.map(([id, raw]) => [id, parseTimelineDate(raw)]).filter(([, ms]) => ms != null);
  const named = paramLabel ? ` by ${paramLabel}` : '';
  const yName = kind === 'edge' ? 'Links' : 'Entities';
  const withEmpty = (bins) => (empty.length ? [...bins, { label: '(empty)', value: empty.length, members: empty }] : bins);
  if (filled.length && numbers.length >= filled.length * 0.8) {
    // (No spread: large scopes pass the argument limit.)
    const low = numbers.reduce((least, [, n]) => Math.min(least, n), Infinity);
    const high = numbers.reduce((most, [, n]) => Math.max(most, n), -Infinity);
    if (low === high) return binsResult(kind, withEmpty([{ label: formatNumber(low), value: numbers.length, members: numbers.map(([id]) => id) }]), { xName: paramLabel, yName, note: `Every value${named} is ${formatNumber(low)}.` });
    const step = niceStep(high - low, Math.min(20, Math.max(5, Math.ceil(Math.sqrt(numbers.length)))));
    // Edges as whole multiples of the step, written out (0.1 + 0.2 is not 0.3).
    const first = Math.floor(low / step + 1e-9);
    const edgeAt = (index) => Number(((first + index) * step).toPrecision(12));
    const count = Math.max(1, Math.floor(high / step + 1e-9) - first + 1);
    const bins = Array.from({ length: count }, (_, index) => ({ label: `${formatNumber(edgeAt(index))} – ${formatNumber(edgeAt(index + 1))}`, value: 0, members: [] }));
    numbers.forEach(([id, n]) => {
      let at = Math.max(0, Math.min(count - 1, Math.floor(n / step) - first));
      while (at > 0 && n < edgeAt(at)) at -= 1;
      while (at < count - 1 && n >= edgeAt(at + 1)) at += 1;
      const bin = bins[at];
      bin.value += 1;
      bin.members.push(id);
    });
    const skipped = filled.length - numbers.length;
    return binsResult(kind, withEmpty(bins), { xName: paramLabel, yName, note: `Ranges of ${formatNumber(step)}${skipped ? `; ${skipped.toLocaleString('en-GB')} non-numeric ${skipped === 1 ? 'value' : 'values'} left out` : ''}.` });
  }
  if (filled.length && dates.length >= filled.length * 0.8) {
    const span = dates.reduce((most, [, ms]) => Math.max(most, ms), -Infinity) - dates.reduce((least, [, ms]) => Math.min(least, ms), Infinity);
    const byDay = span <= 62 * 864e5;
    const labelOf = (ms) => {
      const at = new Date(ms);
      const month = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}`;
      return byDay ? `${month}-${String(at.getDate()).padStart(2, '0')}` : month;
    };
    const map = new Map();
    dates.forEach(([id, ms]) => {
      const label = labelOf(ms);
      if (!map.has(label)) map.set(label, { label, value: 0, members: [] });
      map.get(label).value += 1;
      map.get(label).members.push(id);
    });
    const bins = [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
    const unread = filled.length - dates.length;
    return binsResult(kind, withEmpty(bins), { xName: paramLabel, yName, note: `By ${byDay ? 'day' : 'month'}${unread ? `; ${unread.toLocaleString('en-GB')} ${unread === 1 ? 'value' : 'values'} not read as a date left out` : ''}.` });
  }
  const map = new Map();
  filled.forEach(([id, raw]) => {
    const label = String(raw).trim().slice(0, 60);
    if (!map.has(label)) map.set(label, { label, value: 0, members: [] });
    map.get(label).value += 1;
    map.get(label).members.push(id);
  });
  const sorted = [...map.values()].sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, undefined, { numeric: true }));
  const shown = sorted.slice(0, HISTOGRAM_TOP);
  const rest = sorted.slice(HISTOGRAM_TOP);
  if (rest.length) shown.push({ label: `Other (${rest.length.toLocaleString('en-GB')})`, value: rest.reduce((sum, bin) => sum + bin.value, 0), members: rest.flatMap((bin) => bin.members) });
  return binsResult(kind, withEmpty(shown), {
    xName: paramLabel,
    yName,
    note: values.length ? `${map.size.toLocaleString('en-GB')} distinct ${map.size === 1 ? 'value' : 'values'}${rest.length ? `; the ${HISTOGRAM_TOP} most used shown, the rest as Other` : ''}.` : 'Choose a property to count by.',
  });
};

const RUN = {
  degree,
  inOut,
  betweenness: measure('betweenness', 'Betweenness', 'bar'),
  closeness: measure('closeness', 'Closeness', 'bar'),
  eigenvector: measure('eigenvector', 'Eigenvector', 'line'),
  pagerank,
  clustering,
  hits,
  constraint,
  ego,
  kcore,
  edgeBetweenness,
  edgeWeight,
  assortativity,
  reciprocity,
  globalMetrics,
  cohesion,
  temporal,
  moneyFlow,
  fanInOut,
  degreeDistribution,
  communitySizes,
  heatMatrix,
  histogram,
};

export const computeChartMetric = (metricId, input) => {
  const metric = metricById(metricId);
  const run = RUN[metricId];
  if (!metric || !run) throw new Error(`${metric?.label || metricId} is not available yet.`);
  const nodeIds = (input?.nodeIds || []).map(String);
  if (metric.maxNodes && nodeIds.length > metric.maxNodes) {
    throw new Error(`${metric.label} is limited to ${metric.maxNodes.toLocaleString('en-GB')} entities; this scope has ${nodeIds.length.toLocaleString('en-GB')}. Draw fewer, or choose Drawn or Selected.`);
  }
  const edges = (input?.edges || []).map((edge) => ({
    key: String(edge.key),
    source: String(edge.source),
    target: String(edge.target),
    ...(typeof edge.weight === 'number' ? { weight: edge.weight } : {}),
    ...(typeof edge.time === 'number' ? { time: edge.time } : {}),
  }));
  return run({
    nodeIds,
    edges,
    weightLabel: typeof input?.weightLabel === 'string' ? input.weightLabel.slice(0, 80) : '',
    communities: Array.isArray(input?.communities) ? input.communities.filter(Array.isArray) : [],
    timeUnit: typeof input?.timeUnit === 'string' ? input.timeUnit : 'auto',
    borrowedTimes: Number.isInteger(input?.borrowedTimes) ? input.borrowedTimes : 0,
    timeKey: typeof input?.timeKey === 'string' ? input.timeKey.slice(0, 80) : '',
    // Histogram: the chosen property's values ([[id, value]]) and subject.
    values: Array.isArray(input?.values) ? input.values.filter((entry) => Array.isArray(entry) && entry.length === 2).map(([id, value]) => [String(id), value]) : [],
    subject: input?.subject === 'edge' ? 'edge' : 'node',
    paramLabel: typeof input?.paramLabel === 'string' ? input.paramLabel.slice(0, 80) : '',
  });
};
