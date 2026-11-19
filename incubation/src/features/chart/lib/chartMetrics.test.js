import { describe, expect, it } from 'vitest';

import { CHART_METRICS, computeChartMetric, isMetricAvailable, metricById, modularityOf } from './chartMetrics.js';
import fixtures from './__fixtures__/chartMetrics.networkx.json';

// Every computed metric matches networkx on the same graphs (the plan's
// rule: no random values). Fixtures: scratch script run with networkx
// (generator noted in the file).
const close = (actual, expected, tolerance) => {
  Object.entries(expected).forEach(([id, value]) => {
    expect(actual[id], id).toBeCloseTo(value, tolerance);
  });
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
};

describe.each(Object.entries(fixtures.graphs))('chart metrics on %s (vs %s)', (name, { nodes, edges, expected }) => {
  const input = { nodeIds: nodes, edges };
  it('degree: every link at both ends (parallel and self links count)', () => {
    const result = computeChartMetric('degree', input);
    expect(result).toMatchObject({ kind: 'node', form: 'bar' });
    close(result.series[0].values, expected.degree, 9);
  });
  it('in / out degree follow the link direction', () => {
    const result = computeChartMetric('inOut', input);
    expect(result.form).toBe('dualbar');
    close(result.series[0].values, expected.in, 9);
    close(result.series[1].values, expected.out, 9);
  });
  it('betweenness, closeness (harmonic / (n-1)) and eigenvector (largest = 1)', () => {
    close(computeChartMetric('betweenness', input).series[0].values, expected.betweenness, 9);
    close(computeChartMetric('closeness', input).series[0].values, expected.closeness, 9);
    const eigen = computeChartMetric('eigenvector', input);
    expect(eigen.form).toBe('line');
    close(eigen.series[0].values, expected.eigenvector, 4);
  });
});

describe.each(Object.entries(fixtures.graphs))('G5.2 node metrics on %s', (name, { nodes, edges, expected }) => {
  const input = { nodeIds: nodes, edges };
  const series = (metric, index = 0) => computeChartMetric(metric, input).series[index].values;
  it('pagerank (directed: each direction once, no self links)', () => {
    close(series('pagerank'), expected.pagerank, 9);
  });
  it('hits: authority and hub', () => {
    const result = computeChartMetric('hits', input);
    expect(result.form).toBe('dualbar');
    close(result.series[0].values, expected.authorities, 7);
    close(result.series[1].values, expected.hubs, 7);
  });
  it('clustering, k-core', () => {
    close(series('clustering'), expected.clustering, 9);
    close(series('kcore'), expected.kcore, 9);
  });
  it('constraint (entities without links left out) and ego size / density (density on its own axis)', () => {
    close(series('constraint'), expected.constraint, 9);
    const ego = computeChartMetric('ego', input);
    close(ego.series[0].values, expected.egoSize, 9);
    close(ego.series[1].values, expected.egoDensity, 9);
    expect(ego.series[1].axis).toBe(1);
  });
});

describe.each(Object.entries(fixtures.graphs))('G5.3 edge metrics on %s', (name, { nodes, edges, expected }) => {
  const input = { nodeIds: nodes, edges };
  it('edge betweenness per link (self links have none)', () => {
    const betweenness = computeChartMetric('edgeBetweenness', input);
    expect(betweenness.kind).toBe('edge');
    close(betweenness.series[0].values, expected.edgeBetweenness, 9);
  });
});

const figure = (result, label) => result.items.find((item) => item.label === label)?.value;

describe.each(Object.entries(fixtures.graphs))('G5.4 global metrics on %s', (name, { nodes, edges, expected }) => {
  const input = { nodeIds: nodes, edges };
  it('global metrics', () => {
    const result = computeChartMetric('globalMetrics', input);
    expect(result).toMatchObject({ kind: 'global', form: 'figures' });
    const want = expected.global;
    expect(figure(result, 'Number of Nodes')).toBe(want.nodes);
    expect(figure(result, 'Number of Edges')).toBe(want.links);
    [['Density', want.density], ['Average Degree', want.averageDegree], ['Average Path Length', want.averagePathLength],
      ['Diameter', want.diameter], ['Average Clustering Coefficient', want.averageClustering], ['Transitivity', want.transitivity],
      ['Assortativity', want.assortativity], ['Reciprocity (directed)', want.reciprocity]]
      .forEach(([label, value]) => expect(figure(result, label), label).toBeCloseTo(value, 9));
  });
  it('assortativity (each link once at its ends\u2019 degrees) and reciprocity per entity', () => {
    const assort = computeChartMetric('assortativity', input);
    expect(assort.summary.value).toBeCloseTo(expected.global.assortativity, 9);
    expect(Object.values(assort.series[0].values).every((pair) => pair.length === 2)).toBe(true);
    const recip = computeChartMetric('reciprocity', input);
    close(recip.series[0].values, expected.reciprocityByNode, 9);
    expect(recip.summary.value).toBeCloseTo(expected.global.reciprocity, 9);
  });
  it('cohesion with a given grouping (networkx modularity of the same grouping)', () => {
    const result = computeChartMetric('cohesion', { ...input, communities: expected.partition });
    const want = expected.cohesion;
    [['Connected Components', want.components], ['Largest Component Ratio', want.largestComponentRatio], ['Bridge Edges', want.bridges],
      ['Cut Vertices', want.cutVertices], ['Modularity', want.modularity], ['Community Count', want.communities],
      ['Community Density', want.communityDensity], ['Network Centralization', want.centralization]]
      .forEach(([label, value]) => expect(figure(result, label), label).toBeCloseTo(value, 9));
  });
});

describe.each(Object.entries(fixtures.graphs))('G5.5 temporal metrics on %s', (name, { nodes, edges, expected }) => {
  // Each link at local noon of its day (no time zone in the fixture).
  const want = expected.temporal;
  const dated = edges.map((edge, index) => ({ ...edge, time: new Date(2026, 0, 1 + want.days[index], 12).getTime() }));
  const input = { nodeIds: nodes, edges: dated, communities: expected.partition, timeUnit: 'day' };
  it('per period: churn, density, centralization, modularity and links match networkx', () => {
    const result = computeChartMetric('temporal', input);
    expect(result).toMatchObject({ kind: 'time', form: 'time', unit: 'day', undated: 0 });
    expect(result.periods).toHaveLength(want.links.length);
    const values = (label) => result.series.find((series) => series.name === label).values;
    expect(values('Links')).toEqual(want.links);
    [['Entity churn', want.entityChurn], ['Link churn', want.linkChurn], ['Density', want.density], ['Centralization', want.centralization], ['Modularity', want.modularity]]
      .forEach(([label, list]) => list.forEach((value, index) => {
        if (value === null) expect(values(label)[index], `${label} ${index}`).toBeNull();
        else expect(values(label)[index], `${label} ${index}`).toBeCloseTo(value, 9);
      }));
  });
});

describe('temporal metrics', () => {
  it('needs dated links; counts the undated; Auto picks the unit from the span', () => {
    expect(() => computeChartMetric('temporal', { nodeIds: ['a', 'b'], edges: [{ key: 'e', source: 'a', target: 'b' }] })).toThrow(/No dated links/);
    const result = computeChartMetric('temporal', {
      nodeIds: ['a', 'b', 'c'],
      edges: [
        { key: 'e1', source: 'a', target: 'b', time: new Date(2026, 0, 5, 9).getTime() },
        { key: 'e2', source: 'b', target: 'c', time: new Date(2026, 6, 20, 9).getTime() },
        { key: 'e3', source: 'a', target: 'c' },
      ],
    });
    expect(result.unit).toBe('week');
    expect(result.undated).toBe(1);
    expect(result.series.find((series) => series.name === 'Links').axis).toBe(1);
  });
});

describe('modularity', () => {
  it('is null without links; lone entities count as their own community', () => {
    expect(modularityOf(new Map([['a', new Set()]]), [['a']])).toBeNull();
    const result = computeChartMetric('cohesion', { nodeIds: ['a', 'b', 'c'], edges: [{ key: 'e', source: 'a', target: 'b' }], communities: [['a', 'b']] });
    expect(figure(result, 'Community Count')).toBe(2);
    expect(figure(result, 'Modularity')).toBeCloseTo(0, 9);
  });
});

describe('edge weight', () => {
  it("charts each link's measured weight, links without one left out", () => {
    const result = computeChartMetric('edgeWeight', {
      nodeIds: ['a', 'b', 'c'],
      edges: [{ key: 'e1', source: 'a', target: 'b', weight: 1200 }, { key: 'e2', source: 'b', target: 'c' }, { key: 'e3', source: 'a', target: 'c', weight: 0.5 }],
      weightLabel: 'AMOUNT',
    });
    expect(result).toMatchObject({ kind: 'edge', form: 'bar' });
    expect(result.series[0]).toEqual({ name: 'Weight (AMOUNT)', values: { e1: 1200, e3: 0.5 } });
  });
});

describe('chart metric catalog', () => {
  it("lists the catalogue: production's metrics in their menu order and groups (four removed), with the G6.0 additions", () => {
    expect(CHART_METRICS.map((metric) => metric.label)).toEqual([
      'Assortativity', 'Reciprocity', 'Global Metrics', 'Cohesion Metrics', 'Temporal Metrics',
      'Heat Matrix (Day \u00d7 Hour)', 'Histogram', 'Degree Distribution', 'Community Sizes',
      'Degree Centrality', 'In / Out Degree', 'Flow In / Out / Net', 'Fan-in / Fan-out', 'Betweenness Centrality', 'Closeness Centrality', 'Eigenvector Centrality',
      'PageRank', 'Clustering Coefficient', 'HITS (Authority / Hub Scores)',
      'Constraint (Structural Holes)', 'Ego Network Size / Density', 'K-Core Number',
      'Edge Betweenness', 'Edge Weight',
    ]);
    ['katz', 'eccentricity', 'edgeEmbeddedness', 'edgeSimilarity'].forEach((id) => expect(metricById(id)).toBeNull());
  });
  it('refuses metrics of later slices and oversized scopes', () => {
    expect(isMetricAvailable(metricById('degree'))).toBe(true);
    expect(CHART_METRICS.every(isMetricAvailable)).toBe(true);
    expect(() => computeChartMetric('nope', { nodeIds: [], edges: [] })).toThrow(/not available yet/);
    const nodeIds = Array.from({ length: 5001 }, (_, index) => `n${index}`);
    expect(() => computeChartMetric('betweenness', { nodeIds, edges: [] })).toThrow(/limited to 5,000 entities; this scope has 5,001/);
    expect(computeChartMetric('degree', { nodeIds, edges: [] }).series[0].values.n0).toBe(0);
  });
});

describe('G6.0 metrics (worked by hand)', () => {
  it('flow in / out / net from the weights; entities without flow left out; by in + out; self links carry nothing', () => {
    const result = computeChartMetric('moneyFlow', {
      nodeIds: ['a', 'b', 'c', 'd'],
      edges: [
        { key: '1', source: 'a', target: 'b', weight: 100 },
        { key: '2', source: 'a', target: 'c', weight: 50 },
        { key: '3', source: 'b', target: 'c', weight: 30 },
        { key: '4', source: 'c', target: 'a' },
        { key: '5', source: 'a', target: 'a', weight: 10 },
      ],
      weightLabel: 'AMOUNT',
    });
    expect(result.series.map((entry) => [entry.name, entry.values])).toEqual([
      ['In', { a: 0, b: 100, c: 80 }],
      ['Out', { a: 150, b: 30, c: 0 }],
      ['Net', { a: -150, b: 70, c: 80 }],
    ]);
    expect(result.order).toEqual(['a', 'b', 'c']);
    expect(result.note).toBe('Amounts from AMOUNT; 1 link without one left out.');
    expect(computeChartMetric('moneyFlow', { nodeIds: ['a', 'b'], edges: [{ key: '1', source: 'a', target: 'b' }] }).note).toMatch(/No link has an amount/);
  });

  it('fan-in / fan-out: distinct senders and receivers (parallel links once, no self links)', () => {
    const result = computeChartMetric('fanInOut', {
      nodeIds: ['a', 'b', 'c'],
      edges: [{ key: '1', source: 'a', target: 'b' }, { key: '2', source: 'a', target: 'b' }, { key: '3', source: 'a', target: 'c' }, { key: '4', source: 'b', target: 'a' }, { key: '5', source: 'a', target: 'a' }],
    });
    expect(result.series.map((entry) => [entry.name, entry.values])).toEqual([
      ['Fan-in', { a: 1, b: 1, c: 1 }],
      ['Fan-out', { a: 2, b: 1, c: 0 }],
    ]);
  });

  it('degree distribution: entities per degree, ascending, with their members', () => {
    const result = computeChartMetric('degreeDistribution', {
      nodeIds: ['hub', 'x', 'y', 'z', 'lone'],
      edges: [{ key: '1', source: 'hub', target: 'x' }, { key: '2', source: 'hub', target: 'y' }, { key: '3', source: 'hub', target: 'z' }],
    });
    expect(result.form).toBe('bins');
    expect(result.bins).toEqual([
      { label: '0', value: 1, members: ['lone'] },
      { label: '1', value: 3, members: ['x', 'y', 'z'] },
      { label: '3', value: 1, members: ['hub'] },
    ]);
  });

  it('community sizes: largest first, lone entities together', () => {
    const result = computeChartMetric('communitySizes', { nodeIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], edges: [], communities: [['e', 'f'], ['a', 'b', 'c'], ['d']] });
    expect(result.bins).toEqual([
      { label: 'C1', value: 3, members: ['a', 'b', 'c'] },
      { label: 'C2', value: 2, members: ['e', 'f'] },
      { label: 'Alone', value: 2, members: ['d', 'g'] },
    ]);
  });

  it('heat matrix: weekday (Monday first) x hour in local time; by weekday only when no date has a time of day', () => {
    const at = (...parts) => new Date(...parts).getTime();
    const timed = computeChartMetric('heatMatrix', {
      nodeIds: [],
      timeKey: 'TRANSACTIONDATE',
      edges: [
        { key: '1', source: 'a', target: 'b', time: at(2026, 0, 5, 9, 30) }, // Monday 09
        { key: '2', source: 'a', target: 'b', time: at(2026, 0, 12, 9, 5) }, // Monday 09
        { key: '3', source: 'a', target: 'b', time: at(2026, 0, 11, 23, 0) }, // Sunday 23
        { key: '4', source: 'a', target: 'b' },
      ],
    });
    expect(timed.hours).toHaveLength(24);
    expect(timed.cells).toEqual([{ day: 0, hour: 9, value: 2, members: ['1', '2'] }, { day: 6, hour: 23, value: 1, members: ['3'] }]);
    expect(timed.undated).toBe(1);
    expect(timed.note).toBe('From TRANSACTIONDATE; 1 undated link left out.');
    const dateOnly = computeChartMetric('heatMatrix', { nodeIds: [], edges: [{ key: '1', source: 'a', target: 'b', time: at(2026, 0, 6) }] });
    expect(dateOnly.dateOnly).toBe(true);
    expect(dateOnly.hours).toEqual(['All day']);
    expect(dateOnly.cells).toEqual([{ day: 1, hour: 0, value: 1, members: ['1'] }]);
  });

  it('histogram: numbers in nice ranges, text by value (the rest as Other), dates by month, empty apart', () => {
    const numeric = computeChartMetric('histogram', { subject: 'edge', paramLabel: 'AMOUNT', values: [['1', 5], ['2', '12'], ['3', '1,250'], ['4', 999], ['5', '']] });
    expect(numeric.kind).toBe('edge');
    expect(numeric.bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(5);
    expect(numeric.bins.at(-1)).toEqual({ label: '(empty)', value: 1, members: ['5'] });
    expect(numeric.bins.slice(0, -1).map((bin) => [bin.label, bin.value])).toEqual([['0 – 500', 2], ['500 – 1,000', 1], ['1,000 – 1,500', 1]]);
    expect(numeric.bins[0].members).toEqual(['1', '2']);
    const text = computeChartMetric('histogram', { values: Array.from({ length: 30 }, (_, index) => [`n${index}`, index < 5 ? 'Bank' : `Kind ${index}`]) });
    expect(text.bins[0]).toEqual({ label: 'Bank', value: 5, members: ['n0', 'n1', 'n2', 'n3', 'n4'] });
    expect(text.bins).toHaveLength(26);
    expect(text.bins.at(-1).label).toBe('Other (1)');
    const dates = computeChartMetric('histogram', { values: [['a', '2025-01-03'], ['b', '2025-01-20'], ['c', '2025-06-01']] });
    expect(dates.bins.map((bin) => [bin.label, bin.value])).toEqual([['2025-01', 2], ['2025-06', 1]]);
  });
});
