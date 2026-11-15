// Layout worker for the G0 benchmark: graphology + ForceAtlas2, plus the
// simple production layouts. Positions go back as one transferable array.
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

const concentric = (ids, degree) => {
  const order = ids.map((id, index) => index).sort((a, b) => degree[b] - degree[a]);
  const positions = new Float32Array(ids.length * 2);
  let ring = 0;
  let placed = 0;
  while (placed < order.length) {
    const capacity = ring === 0 ? 1 : Math.floor(2 * Math.PI * ring * 1.6);
    const radius = ring * 60;
    for (let k = 0; k < capacity && placed < order.length; k += 1, placed += 1) {
      const angle = (2 * Math.PI * k) / capacity;
      positions[order[placed] * 2] = radius * Math.cos(angle);
      positions[order[placed] * 2 + 1] = radius * Math.sin(angle);
    }
    ring += 1;
  }
  return positions;
};

const grid = (count) => {
  const side = Math.ceil(Math.sqrt(count));
  const positions = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    positions[i * 2] = (i % side) * 50;
    positions[i * 2 + 1] = Math.floor(i / side) * 50;
  }
  return positions;
};

self.onmessage = (event) => {
  const { requestId, layout, nodeIds, edges, iterations = 100 } = event.data;
  const start = performance.now();
  const index = new Map(nodeIds.map((id, i) => [id, i]));
  const degree = new Float32Array(nodeIds.length);
  edges.forEach(([source, target]) => {
    degree[index.get(source)] += 1;
    degree[index.get(target)] += 1;
  });

  let positions;
  if (layout === 'grid') {
    positions = grid(nodeIds.length);
  } else if (layout === 'concentric') {
    positions = concentric(nodeIds, degree);
  } else {
    // ForceAtlas2, seeded from the concentric layout.
    const seedPositions = concentric(nodeIds, degree);
    const graph = new Graph({ multi: true, type: 'directed' });
    nodeIds.forEach((id, i) => graph.addNode(id, { x: seedPositions[i * 2], y: seedPositions[i * 2 + 1] }));
    edges.forEach(([source, target]) => graph.addEdge(source, target));
    const settings = { ...forceAtlas2.inferSettings(graph), barnesHutOptimize: nodeIds.length > 2000 };
    forceAtlas2.assign(graph, { iterations, settings });
    positions = new Float32Array(nodeIds.length * 2);
    nodeIds.forEach((id, i) => {
      positions[i * 2] = graph.getNodeAttribute(id, 'x') * 4;
      positions[i * 2 + 1] = graph.getNodeAttribute(id, 'y') * 4;
    });
  }
  const ms = performance.now() - start;
  self.postMessage({ requestId, positions, ms }, [positions.buffer]);
};
