import { describe, expect, it } from 'vitest';

import { computeMeasure, topScores } from './networkMeasures.js';
import { scoreEncoding } from './graphAnalysis.js';

const path = [['a', 'b'], ['b', 'c']];
const star = [['h', 'x'], ['h', 'y'], ['h', 'z'], ['h', 'w']];

describe('network measures (i2 #3)', () => {
  it('betweenness: normalized; the middle of a path and the hub of a star are 1', () => {
    expect(computeMeasure('betweenness', ['a', 'b', 'c'], path)).toEqual({ a: 0, b: 1, c: 0 });
    const hub = computeMeasure('betweenness', ['h', 'x', 'y', 'z', 'w'], star);
    expect(hub.h).toBeCloseTo(1);
    expect(hub.x).toBe(0);
  });

  it('betweenness: two shortest paths share the credit; parallel and self links count once', () => {
    // a square a-b-c-d-a: each node lies on one of the two a-c (or b-d) paths.
    const square = computeMeasure('betweenness', ['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd'], ['d', 'a'], ['a', 'b'], ['a', 'a']]);
    Object.values(square).forEach((value) => expect(value).toBeCloseTo(1 / 6));
  });

  it('closeness: harmonic, so a separate node scores 0 and does not break the others', () => {
    const scores = computeMeasure('closeness', ['a', 'b', 'c', 'lone'], path);
    expect(scores.b).toBeCloseTo(2 / 3);
    expect(scores.a).toBeCloseTo(1.5 / 3);
    expect(scores.lone).toBe(0);
  });

  it('eigenvector: the hub highest (1), leaves equal; converges on a bipartite graph; isolated 0', () => {
    const scores = computeMeasure('eigenvector', ['h', 'x', 'y', 'z', 'w', 'lone'], star);
    expect(scores.h).toBe(1);
    expect(scores.x).toBeCloseTo(scores.y);
    expect(scores.x).toBeLessThan(1);
    expect(scores.x).toBeGreaterThan(0);
    expect(scores.lone).toBe(0);
  });

  it('top scores and the degree-like encoding', () => {
    const scores = { a: 0.2, b: 0.9, c: 0 };
    expect(topScores(scores, 2)).toEqual([['b', 0.9], ['a', 0.2]]);
    const sizes = Object.fromEntries(scoreEncoding(scores).map(([id, patch]) => [id, patch.size]));
    expect(sizes.b).toBe(40);
    expect(sizes.c).toBe(14);
  });

  it('rejects an unknown measure', () => {
    expect(() => computeMeasure('pagerank', [], [])).toThrow('Unknown measure');
  });
});
