import { describe, expect, it } from 'vitest';

import {
  circleLayout,
  gridLayout,
  hubsizeLayout,
  layeredLayout,
  layoutRadius,
  neighbourIndex,
  placeLayers,
  radialLayout,
  spiralLayout,
  starLayout,
} from './layouts.js';
import { adaptiveWeightScale, defaultEdgeWidth, edgeTitle, edgeWidthsFor, nodeTitle, weightToWidth } from './graphModel.js';
import { buildElements } from './graphElements.js';
import { createGraphStore } from './graphStore.js';
import { createSimulation, PRODUCTION_PHYSICS } from './physics.js';

const ids = (n) => Array.from({ length: n }, (_, i) => `n${i}`);
const dist = (p) => Math.round(Math.hypot(p.x, p.y));

describe('production manual layouts (graphs_adjuster applyManualLayout)', () => {
  it('circle: one ring of max(220, n × 15) up to 1600', () => {
    const positions = circleLayout(ids(20));
    expect(new Set(Object.values(positions).map(dist))).toEqual(new Set([300]));
    expect(circleLayout(['solo'])).toEqual({ solo: { x: 0, y: 0 } });
  });

  it('star: the hub in the middle, the rest on one ring', () => {
    const pairs = ids(8).slice(1).map((id) => ['n3', id]);
    const positions = starLayout(ids(8), neighbourIndex(pairs));
    expect(positions.n3).toEqual({ x: 0, y: 0 });
    expect(new Set(Object.entries(positions).filter(([id]) => id !== 'n3').map(([, p]) => dist(p)))).toEqual(new Set([230]));
  });

  it('radial: rings by hops from the centre, unreachable nodes last', () => {
    const pairs = [['a', 'b'], ['b', 'c']];
    const positions = radialLayout(['a', 'b', 'c', 'z'], neighbourIndex(pairs));
    const gap = layoutRadius(4, 140, 2, 260);
    expect(positions.b).toEqual({ x: 0, y: 0 }); // b has the most neighbours
    expect(dist(positions.a)).toBe(gap);
    expect(dist(positions.z)).toBe(2 * gap);
  });

  it('grid and spiral follow production spacing', () => {
    const grid = gridLayout(ids(4));
    expect(grid.n0).toEqual({ x: -130, y: -120 });
    expect(grid.n3).toEqual({ x: 130, y: 120 });
    const spiral = spiralLayout(ids(3));
    expect(dist(spiral.n0)).toBe(14);
    expect(dist(spiral.n2)).toBe(32);
  });

  it('layered: hop distance from the source node, as rows or columns', () => {
    const pairs = [['src', 'a'], ['a', 'b']];
    const info = { src: { identity: 'Source Node' }, a: { identity: 'Entity Node' }, b: { identity: 'Target Node' } };
    const ud = layeredLayout(['b', 'a', 'src'], neighbourIndex(pairs), { info });
    expect(ud.src.y).toBeLessThan(ud.a.y);
    expect(ud.a.y).toBeLessThan(ud.b.y);
    const lr = layeredLayout(['b', 'a', 'src'], neighbourIndex(pairs), { info, direction: 'LR' });
    expect(lr.src.x).toBeLessThan(lr.b.x);
  });

  it('layered: by node type (source, entity, target) and by a property', () => {
    const info = { t: { identity: 'Target Node', layerValue: 'x' }, s: { identity: 'Source Node', layerValue: 10 }, e: { identity: 'Entity Node', layerValue: 2 } };
    const byType = layeredLayout(['t', 's', 'e'], neighbourIndex([]), { layerMode: 'node_identity', info });
    expect(byType.s.y).toBeLessThan(byType.e.y);
    expect(byType.e.y).toBeLessThan(byType.t.y);
    const byKey = layeredLayout(['t', 's', 'e'], neighbourIndex([]), { layerMode: 'by_key', info });
    expect(byKey.e.y).toBeLessThan(byKey.s.y); // numbers ascending
    expect(byKey.s.y).toBeLessThan(byKey.t.y); // then text
  });

  it('hierarchical hub size: the biggest hub on the first level', () => {
    const pairs = [['hub', 'a'], ['hub', 'b'], ['hub', 'c'], ['c', 'd']];
    const positions = hubsizeLayout(['a', 'b', 'c', 'd', 'hub'], neighbourIndex(pairs));
    expect(positions.hub.y).toBeLessThan(positions.a.y);
    expect(positions.c.y).toBeLessThan(positions.d.y);
  });

  it('places layers with production gaps', () => {
    const positions = placeLayers([['a'], ['b', 'c']], 3, 'UD');
    expect(positions.b.y - positions.a.y).toBe(180);
    expect(positions.c.x - positions.b.x).toBe(200);
  });
});

describe('edge weights (graphs_adjuster weightEdges)', () => {
  it('Default uses the edge width / weight / value, at least 1', () => {
    expect(defaultEdgeWidth({ weight: 4 })).toBe(4);
    expect(defaultEdgeWidth({ value: '0.5' })).toBe(1);
    expect(defaultEdgeWidth({})).toBe(1);
  });

  it('by a property: endpoint values, percentile scale, widths 1–6', () => {
    const nodes = { a: { amount: 10 }, b: { amount: 30 }, c: { amount: 1000 }, d: {} };
    const edges = [['e1', { from: 'a', to: 'b' }], ['e2', { from: 'b', to: 'c' }], ['e3', { from: 'd', to: 'a' }]];
    const widths = edgeWidthsFor(edges, 'amount', (id) => nodes[id]);
    expect(widths.get('e1')).toBeGreaterThanOrEqual(1);
    expect(widths.get('e2')).toBeLessThanOrEqual(6);
    expect(widths.get('e2')).toBeGreaterThan(widths.get('e1'));
    // Log scale only when the 5th–95th percentile spread exceeds 30×.
    expect(adaptiveWeightScale([1, 1000]).useLog).toBe(false); // percentiles ~51 and ~950
    expect(adaptiveWeightScale([...Array(19).fill(1), 5000, 5000]).useLog).toBe(true);
    expect(weightToWidth(5, { min: 5, max: 5 })).toBe(1);
    expect(edgeWidthsFor(edges, '', () => ({}))).toBeNull();
  });
});

describe('hover titles', () => {
  it('node: label first, identity renamed, display keys left out', () => {
    expect(nodeTitle({ id: 1, label: 'ACC-1', node_identity: 'Source Node', color: '#fff', x: 3, amount: 5 }))
      .toBe('Label: ACC-1\nid: 1\nIdentity: Source Node\namount: 5');
  });

  it('edge: from / to / weight, then the meaning and the reason', () => {
    expect(edgeTitle({ from: 'a', to: 'b', weight: 3, reason: 'Fan-out' }, { label: 'A' }, { label: 'B' }, { semanticTooltip: 'Observed financial transfer' }))
      .toBe('From: A\nTo: B\nWeight: 3\n\nObserved financial transfer\nReason: Fan-out');
  });

  it('only when titles are on', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 1, label: 'A' }, { id: 2, label: 'B' }], edges: [{ from: 1, to: 2, weight: 2 }] });
    const off = buildElements(store, store.visibleView({}), {});
    expect(off.nodes[0].data.title).toBeUndefined();
    const on = buildElements(store, store.visibleView({}), { showTitles: true, edgeWeight: 'default' });
    expect(on.nodes[0].data.title).toContain('Label: A');
    expect(on.edges[0].data).toMatchObject({ width: 2, title: expect.stringContaining('From: A') });
  });
});

describe('production physics (vis barnesHut STABLE_PHYSICS)', () => {
  const run = (sim, steps) => {
    let speed = Infinity;
    for (let i = 0; i < steps && !sim.isSettled(speed); i += 1) speed = sim.step();
    return speed;
  };

  it('settles a connected pair at the repulsion/spring balance, around the centre', () => {
    const sim = createSimulation({ nodeIds: ['a', 'b'], edgePairs: [['a', 'b']], positions: { a: { x: -300, y: 0 }, b: { x: 300, y: 0 } } });
    expect(sim.isSettled(run(sim, 2000))).toBe(true);
    const { a, b } = sim.positions();
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    // 14500 / d² ≈ 0.06 (d − 12) (+ a little central gravity) → d ≈ 65.
    expect(d).toBeGreaterThan(50);
    expect(d).toBeLessThan(75);
    expect(Math.abs(a.x + b.x)).toBeLessThan(5);
  });

  it('keeps nodes apart instead of collapsing, and stays settled', () => {
    const nodeIds = ids(30);
    const edgePairs = nodeIds.slice(1).map((id) => ['n0', id]);
    const sim = createSimulation({ nodeIds, edgePairs, positions: Object.fromEntries(nodeIds.map((id, i) => [id, { x: (i % 6) * 5, y: Math.floor(i / 6) * 5 }])) });
    expect(sim.isSettled(run(sim, 3000))).toBe(true);
    const positions = sim.positions();
    const closest = Math.min(...nodeIds.slice(1).map((id) => Math.hypot(positions[id].x - positions.n0.x, positions[id].y - positions.n0.y)));
    expect(closest).toBeGreaterThan(30); // node diameter
    sim.step();
    const drift = Math.max(...nodeIds.map((id) => Math.hypot(sim.positions()[id].x - positions[id].x, sim.positions()[id].y - positions[id].y)));
    expect(drift).toBeLessThan(PRODUCTION_PHYSICS.minVelocity * PRODUCTION_PHYSICS.timestep * 2);
  });

  it('a pinned (dragged) node stays where it is put', () => {
    const sim = createSimulation({ nodeIds: ['a', 'b'], edgePairs: [['a', 'b']], positions: { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } } });
    sim.setNode('a', { position: { x: 400, y: 400 }, fixed: true });
    run(sim, 500);
    expect(sim.positions().a).toEqual({ x: 400, y: 400 });
    expect(Math.hypot(sim.positions().b.x - 400, sim.positions().b.y - 400)).toBeLessThan(120);
  });
});
