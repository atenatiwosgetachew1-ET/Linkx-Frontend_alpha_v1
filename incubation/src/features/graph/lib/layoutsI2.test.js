import { describe, expect, it } from 'vitest';

import { groupedLayout, LAYOUTS, neighbourIndex, peacockLayout } from './layouts.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const closestPair = (positions) => {
  const points = Object.values(positions);
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) best = Math.min(best, distance(points[i], points[j]));
  }
  return best;
};

// Hubs h1 (12 leaves) and h2 (40 leaves, two rings) linked through c; a
// pair p1-p2 linked only to each other; two nodes without links.
const peacockGraph = () => {
  const edges = [['h1', 'c'], ['c', 'h2'], ['p1', 'p2']];
  const nodes = ['h1', 'h2', 'c', 'p1', 'p2', 'lone1', 'lone2'];
  for (let i = 0; i < 12; i += 1) { nodes.push(`a${i}`); edges.push(['h1', `a${i}`]); }
  for (let i = 0; i < 40; i += 1) { nodes.push(`b${i}`); edges.push([`b${i}`, 'h2']); }
  return { nodes, edges };
};

describe('peacock layout (i2 #6)', () => {
  it('places every node, none on top of another', () => {
    const { nodes, edges } = peacockGraph();
    const positions = peacockLayout(nodes, neighbourIndex(edges));
    expect(Object.keys(positions).sort()).toEqual([...nodes].sort());
    Object.values(positions).forEach(({ x, y }) => {
      expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
    });
    expect(closestPair(positions)).toBeGreaterThan(25);
  });

  it('fans each hub\'s leaves round it, closer to it than to any other hub', () => {
    const { nodes, edges } = peacockGraph();
    const positions = peacockLayout(nodes, neighbourIndex(edges));
    for (let i = 0; i < 12; i += 1) {
      const leaf = positions[`a${i}`];
      expect(distance(leaf, positions.h1)).toBeLessThan(distance(leaf, positions.h2));
      expect(distance(leaf, positions.h1)).toBeCloseTo(70, 0); // one ring
    }
    // 40 leaves: more than one ring.
    const rings = new Set(Array.from({ length: 40 }, (_, i) => Math.round(distance(positions[`b${i}`], positions.h2))));
    expect(rings.size).toBeGreaterThan(1);
    // The biggest hub is in the middle; the pair: one fanned round the other.
    expect(positions.h2).toEqual({ x: 0, y: 0 });
    expect(distance(positions.p1, positions.p2)).toBeCloseTo(70, 0);
  });

  it('puts nodes without links in a grid under the rest', () => {
    const { nodes, edges } = peacockGraph();
    const positions = peacockLayout(nodes, neighbourIndex(edges));
    const lowest = Math.max(...nodes.filter((id) => !id.startsWith('lone')).map((id) => positions[id].y));
    expect(positions.lone1.y).toBeGreaterThan(lowest);
    expect(positions.lone2.y).toBe(positions.lone1.y);
  });

  it('copes with nothing, one node and a plain chain', () => {
    expect(peacockLayout([], new Map())).toEqual({});
    expect(peacockLayout(['x'], new Map())).toEqual({ x: { x: 0, y: 120 } });
    const chain = peacockLayout(['1', '2', '3', '4'], neighbourIndex([['1', '2'], ['2', '3'], ['3', '4']]));
    expect(Object.keys(chain)).toHaveLength(4);
    expect(closestPair(chain)).toBeGreaterThan(25);
  });
});

describe('grouped layout (i2 #6)', () => {
  const nodes = ['p1', 'p2', 'p3', 'p4', 'a1', 'a2', 'x'];
  const edges = [['p1', 'p2'], ['p1', 'a1'], ['a1', 'a2'], ['p3', 'p4']];
  const info = { p1: { group: 'Person' }, p2: { group: 'Person' }, p3: { group: 'Person' }, p4: { group: 'Person' }, a1: { group: 'Account' }, a2: { group: 'Account' }, x: {} };

  it('keeps each group together and apart from the others', () => {
    const positions = groupedLayout(nodes, neighbourIndex(edges), { info });
    expect(Object.keys(positions).sort()).toEqual([...nodes].sort());
    const centre = (ids) => ({ x: ids.reduce((sum, id) => sum + positions[id].x, 0) / ids.length, y: ids.reduce((sum, id) => sum + positions[id].y, 0) / ids.length });
    const persons = ['p1', 'p2', 'p3', 'p4'];
    const accounts = ['a1', 'a2'];
    const spread = (ids) => Math.max(...ids.map((id) => distance(positions[id], centre(ids))));
    // Groups further apart than their own size.
    expect(distance(centre(persons), centre(accounts))).toBeGreaterThan(spread(persons) + spread(accounts));
    // The node with no group value sits in its own cluster.
    expect(distance(positions.x, centre(persons))).toBeGreaterThan(spread(persons));
    expect(closestPair(positions)).toBeGreaterThan(25);
  });

  it('is in the worker\'s table with peacock', () => {
    expect(LAYOUTS.grouped).toBe(groupedLayout);
    expect(LAYOUTS.peacock).toBe(peacockLayout);
  });
});
