import { describe, expect, it } from 'vitest';

import {
  applyElementFilters,
  degreeEncoding,
  detectCommunities,
  findAllSimplePaths,
  findCutPoints,
  findShortestPath,
  hslToHex,
  inferNodeKeys,
  paletteColor,
  propertyEncoding,
  separateCommunities,
} from './graphAnalysis.js';
import { createGraphStore } from './graphStore.js';
// Seeded random graphs with the answers of production's own functions
// (graphs_adjuster.js run in Node): communities, cut points, path costs.
import productionCases from './__fixtures__/graphAnalysis.production.json';

const build = (nodes, edges) => {
  const store = createGraphStore();
  store.replace({ nodes: nodes.map((node) => (typeof node === 'object' ? node : { id: node })), edges });
  return store.graph();
};
const e = (from, to, extra = {}) => ({ from, to, ...extra });

describe('shortest path (GA findShortestPath)', () => {
  // a → b → c → d, plus a heavy shortcut a → d (weight 10)
  const graph = build(['a', 'b', 'c', 'd', 'z'], [e('a', 'b'), e('b', 'c'), e('c', 'd'), e('a', 'd', { weight: 10 })]);

  it('fewest hops takes the shortcut; lowest weight goes around', () => {
    expect(findShortestPath(graph, 'a', 'd').path).toEqual(['a', 'd']);
    const weighted = findShortestPath(graph, 'a', 'd', { weighted: true });
    expect(weighted.path).toEqual(['a', 'b', 'c', 'd']);
    expect(weighted.totalCost).toBe(3);
    expect(weighted.edgeIds).toHaveLength(3);
  });

  it('direction is respected only when asked; no path is reported as such', () => {
    expect(findShortestPath(graph, 'd', 'a').path).toEqual(['d', 'a']);
    expect(findShortestPath(graph, 'd', 'a', { directed: true }).path).toEqual([]);
    expect(findShortestPath(graph, 'a', 'z').totalCost).toBe(Infinity);
    expect(findShortestPath(graph, 'a', 'a')).toMatchObject({ path: ['a'], totalCost: 0 });
  });

  it('theme lines are skipped unless included', () => {
    const themed = build(['a', 'b', 'c'], [e('a', 'b', { edge_kind: 'theme_line' }), e('b', 'c')]);
    expect(findShortestPath(themed, 'a', 'c').path).toEqual([]);
    expect(findShortestPath(themed, 'a', 'c', { includeThemeLines: true }).path).toEqual(['a', 'b', 'c']);
  });
});

describe('all simple paths', () => {
  // square a-b-d, a-c-d, plus a-d
  const graph = build(['a', 'b', 'c', 'd'], [e('a', 'b'), e('b', 'd'), e('a', 'c'), e('c', 'd'), e('a', 'd')]);

  it('finds every path within the depth', () => {
    const { paths, truncated } = findAllSimplePaths(graph, 'a', 'd', { maxDepth: 6 });
    expect(paths.map((p) => p.path.join('')).sort()).toEqual(['abd', 'acd', 'ad']);
    expect(truncated).toBe(false);
  });

  it('depth and path count limits, and the step budget', () => {
    expect(findAllSimplePaths(graph, 'a', 'd', { maxDepth: 1 }).paths.map((p) => p.path.join(''))).toEqual(['ad']);
    expect(findAllSimplePaths(graph, 'a', 'd', { maxPaths: 1 })).toMatchObject({ truncated: true });
    expect(findAllSimplePaths(graph, 'a', 'd', { stepBudget: 2 }).truncated).toBe(true);
  });
});

describe('cut points', () => {
  it('finds articulation points of the visible graph', () => {
    // a-b-c chain with a triangle c-d-e: b and c are cut points
    const graph = build(['a', 'b', 'c', 'd', 'e'], [e('a', 'b'), e('b', 'c'), e('c', 'd'), e('d', 'e'), e('e', 'c')]);
    expect(findCutPoints(graph, ['a', 'b', 'c', 'd', 'e']).sort()).toEqual(['b', 'c']);
    // with a hidden, b is no longer a cut point
    expect(findCutPoints(graph, ['b', 'c', 'd', 'e'])).toEqual(['c']);
  });

  it('copes with a long chain (no recursion)', () => {
    const ids = Array.from({ length: 20000 }, (_, i) => `n${i}`);
    const graph = build(ids, ids.slice(1).map((id, i) => e(ids[i], id)));
    expect(findCutPoints(graph, ids)).toHaveLength(19998);
  });
});

describe('communities (relationship-weighted label propagation)', () => {
  it('matches production on recorded graphs', () => {
    productionCases.forEach(({ nodes, edges, expected }) => {
      const graph = build(nodes, edges);
      expect(detectCommunities(graph, graph.nodes(), graph.edges())).toEqual(expected);
    });
  });

  it('leaves separate pieces apart and skips annotations', () => {
    const graph = build(['a', 'b', 'c', 'd', { id: 'note', annotationType: 'label' }], [e('a', 'b'), e('c', 'd'), e('note', 'a')]);
    expect(detectCommunities(graph, graph.nodes(), graph.edges())).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('moves each community onto its own place on a ring', () => {
    const moved = separateCommunities([['a', 'b'], ['c']], () => ({ x: 0, y: 0 }));
    expect(moved.a).toEqual(moved.b);
    expect(Math.round(Math.hypot(moved.c.x, moved.c.y))).toBe(220);
  });
});

describe('visual encodings and colours', () => {
  it('real hex colours (production produced "#hsl(…)")', () => {
    expect(hslToHex(0, 100, 50)).toBe('#ff0000');
    expect(paletteColor(1, 3)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('degree: size 14–40, busiest node warmest', () => {
    const graph = build(['hub', 'a', 'b'], [e('hub', 'a'), e('hub', 'b')]);
    const byId = Object.fromEntries(degreeEncoding(graph, ['hub', 'a', 'b']));
    expect(byId.hub.size).toBe(40);
    expect(byId.a.size).toBe(27);
    expect(byId.hub.color.background).toBe(hslToHex(40, 70, 58));
    expect(byId.hub.color.border).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('property: numeric scale when enough nodes have numbers, else categories', () => {
    const graph = build([{ id: 'a', amount: 0, kind: 'x' }, { id: 'b', amount: 10, kind: 'y' }, { id: 'c', amount: 5 }, { id: 'd', amount: 10 }], []);
    const numeric = Object.fromEntries(propertyEncoding(graph, ['a', 'b', 'c', 'd'], 'amount'));
    expect(numeric.a.size).toBe(13);
    expect(numeric.b.size).toBe(37);
    const categorical = Object.fromEntries(propertyEncoding(graph, ['a', 'b', 'c', 'd'], 'kind'));
    expect(categorical.a.color.background).not.toBe(categorical.b.color.background);
    expect(categorical.c.color.background).toBe('#5a8ac6');
    expect(inferNodeKeys([{ amount: 1, kind: 'x' }, { amount: 2 }])).toEqual({ numeric: ['amount'], categorical: ['kind'] });
  });
});

describe('element type filter', () => {
  it('hides annotation types and theme lines; nothing hidden keeps the view', () => {
    const graph = build([{ id: 'n' }, { id: 'l', annotationType: 'label' }, { id: 'm' }], [e('n', 'm', { edge_kind: 'theme_line' }), e('n', 'l')]);
    const view = { nodeIds: ['n', 'l', 'm'], edgeIds: graph.edges() };
    expect(applyElementFilters(graph, view, {})).toBe(view);
    const filtered = applyElementFilters(graph, view, { labels: false, theme_lines: false });
    expect(filtered.nodeIds).toEqual(['n', 'm']);
    expect(filtered.edgeIds).toEqual([]);
  });
});

describe('parity with production on recorded graphs', () => {
  const cost = (value) => (value == null ? Infinity : value);
  it('cut points and shortest path costs (hops, weighted, directed)', () => {
    productionCases.forEach(({ nodes, edges, cutPoints, paths }) => {
      const graph = build(nodes, edges);
      expect(findCutPoints(graph, nodes).sort()).toEqual(cutPoints);
      paths.forEach(({ a, b, hops, weighted, directed }) => {
        expect(findShortestPath(graph, a, b).totalCost).toBe(cost(hops));
        expect(findShortestPath(graph, a, b, { weighted: true }).totalCost).toBe(cost(weighted));
        expect(findShortestPath(graph, a, b, { directed: true }).totalCost).toBe(cost(directed));
      });
    });
  });
});
