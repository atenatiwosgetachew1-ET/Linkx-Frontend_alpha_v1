// Synthetic graphs shaped like LinkX evidence graphs, for the GPU benchmark
// (gpuBenchmarkRun.js) and the developer one (src/dev/graphBench). Deterministic (seeded) so two machines
// draw exactly the same graph.

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const IDENTITIES = ['Entity Node', 'Source Node', 'Target Node'];
const COLORS = ['#2563eb', '#16a34a', '#dc2626', '#d97706', '#7c3aed', '#0891b2'];
const SHAPES = ['ellipse', 'ellipse', 'ellipse', 'round-rectangle', 'diamond'];

// Production edge semantics (GA:2899-2967): observed flow = solid arrow,
// temporal sequence = dashed arrow, grouping = dashed without arrow,
// node flag = dotted amber.
export const EDGE_SEMANTICS = [
  { id: 'flow', style: 'solid', arrow: 'triangle', color: '#475569', weight: 0.55 },
  { id: 'temporal', style: 'dashed', arrow: 'triangle', color: '#64748b', weight: 0.25 },
  { id: 'grouping', style: 'dashed', arrow: 'none', color: '#94a3b8', weight: 0.15 },
  { id: 'flag', style: 'dotted', arrow: 'none', color: '#f39c12', weight: 0.05 },
];

const pickSemantic = (r) => {
  let acc = 0;
  for (const semantic of EDGE_SEMANTICS) {
    acc += semantic.weight;
    if (r < acc) return semantic;
  }
  return EDGE_SEMANTICS[0];
};

// A small inline SVG icon (production nodes may carry icons).
export const ICON_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="#1e293b"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="#1e293b"/></svg>',
)}`;

// Preferential attachment (scale-free, a few hubs like real transaction
// graphs) with `edgesPerNode` edges per new node, a share of parallel edges,
// icons on ~5% of nodes.
export const makeSyntheticGraph = ({ nodes: nodeCount = 1000, edgesPerNode = 3, seed = 42, iconShare = 0.05, parallelShare = 0.03 } = {}) => {
  const random = mulberry32(seed);
  const nodes = [];
  const edges = [];
  const targets = []; // node index repeated by degree
  for (let i = 0; i < nodeCount; i += 1) {
    const identity = IDENTITIES[Math.floor(random() * IDENTITIES.length)];
    nodes.push({
      id: `n${i}`,
      label: `ACC-${String(100000 + i)}`,
      node_identity: identity,
      color: COLORS[i % COLORS.length],
      shape: SHAPES[Math.floor(random() * SHAPES.length)],
      size: 14 + Math.floor(random() * 10),
      icon: random() < iconShare ? ICON_DATA_URI : '',
      amount: Math.round(random() * 1_000_000) / 100,
    });
    const links = i === 0 ? 0 : Math.min(i, edgesPerNode);
    const chosen = new Set();
    for (let k = 0; k < links; k += 1) {
      const target = targets.length && random() < 0.85
        ? targets[Math.floor(random() * targets.length)]
        : Math.floor(random() * i);
      if (target === i || chosen.has(target)) continue;
      chosen.add(target);
      const semantic = pickSemantic(random());
      edges.push({ id: `e${edges.length}`, source: `n${i}`, target: `n${target}`, semantic: semantic.id, style: semantic.style, arrow: semantic.arrow, color: semantic.color, width: 1 + random() * 1.5 });
      if (random() < parallelShare) {
        edges.push({ id: `e${edges.length}`, source: `n${i}`, target: `n${target}`, semantic: 'temporal', style: 'dashed', arrow: 'triangle', color: '#64748b', width: 1 });
      }
      targets.push(i, target);
    }
  }
  return { nodes, edges };
};

// The style sample: every node shape, icon and edge semantic once, to check
// visually that both renderer modes draw them the same.
export const makeStyleSample = () => {
  const nodes = [
    { id: 's1', label: 'Ellipse', shape: 'ellipse', color: '#2563eb', size: 26, icon: '' },
    { id: 's2', label: 'Round rect', shape: 'round-rectangle', color: '#16a34a', size: 26, icon: '' },
    { id: 's3', label: 'Diamond', shape: 'diamond', color: '#dc2626', size: 26, icon: '' },
    { id: 's4', label: 'Icon', shape: 'ellipse', color: '#e2e8f0', size: 30, icon: ICON_DATA_URI },
    { id: 's5', label: 'Hub', shape: 'ellipse', color: '#7c3aed', size: 34, icon: '' },
    { id: 's6', label: 'Target', shape: 'ellipse', color: '#0891b2', size: 26, icon: '' },
  ].map((node) => ({ ...node, node_identity: 'Entity Node', amount: 0 }));
  const edges = EDGE_SEMANTICS.map((semantic, index) => ({
    id: `se${index}`, source: 's5', target: nodes[index].id, semantic: semantic.id, style: semantic.style, arrow: semantic.arrow, color: semantic.color, width: 2.5,
  }));
  edges.push({ id: 'se-par-1', source: 's5', target: 's6', semantic: 'flow', style: 'solid', arrow: 'triangle', color: '#475569', width: 2.5 });
  edges.push({ id: 'se-par-2', source: 's5', target: 's6', semantic: 'temporal', style: 'dashed', arrow: 'triangle', color: '#64748b', width: 2.5 });
  const positions = {
    s1: { x: -220, y: -120 }, s2: { x: 0, y: -200 }, s3: { x: 220, y: -120 }, s4: { x: -220, y: 120 }, s5: { x: 0, y: 0 }, s6: { x: 220, y: 120 },
  };
  return { nodes, edges, positions };
};

// Rings around the most connected node (what layout.worker.js does), for
// graphs drawn without the worker. -> { [id]: { x, y } }
export const concentricPositions = ({ nodes, edges }) => {
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  edges.forEach(({ source, target }) => {
    degree.set(source, degree.get(source) + 1);
    degree.set(target, degree.get(target) + 1);
  });
  const order = nodes.map((node) => node.id).sort((a, b) => degree.get(b) - degree.get(a));
  const positions = {};
  let placed = 0;
  for (let ring = 0; placed < order.length; ring += 1) {
    const capacity = ring === 0 ? 1 : Math.floor(2 * Math.PI * ring * 1.6);
    for (let k = 0; k < capacity && placed < order.length; k += 1, placed += 1) {
      const angle = (2 * Math.PI * k) / capacity;
      positions[order[placed]] = { x: ring * 60 * Math.cos(angle), y: ring * 60 * Math.sin(angle) };
    }
  }
  return positions;
};
