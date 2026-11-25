import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ALERT_RULES,
  describeAlertRules,
  alertFocusNode,
  alertNodeName,
  alertPropertyKeys,
  alertSummary,
  describeGraphAlert,
  generateGraphAlerts,
  getPercentile,
  normalizeAlertRules,
} from './graphAlerts.js';
import { createGraphStore } from './graphStore.js';
// Seeded graphs with the answers of production's own generateGraphAlerts
// (graphs_adjuster.js run in Node), across six rule configurations.
import productionCases from './__fixtures__/graphAlerts.production.json';

const build = (nodes, edges) => {
  const store = createGraphStore();
  store.replace({ nodes: nodes.map((node) => (typeof node === 'object' ? node : { id: node })), edges });
  return store.graph();
};

describe('alert rules configuration (GA normalizeAlertRulesConfig)', () => {
  it('defaults are production’s', () => {
    expect(normalizeAlertRules()).toEqual({
      enableHighDegree: true,
      highDegreeMin: 3,
      highSeverityDegree: 8,
      maxHighDegreeAlerts: 5,
      enableHeavyEdge: true,
      heavyEdgePercentile: 95,
      heavyEdgeMinSamples: 4,
      maxHeavyEdgeAlerts: 5,
      heavyEdgeMinValue: 0,
    });
    expect(normalizeAlertRules()).toEqual(DEFAULT_ALERT_RULES);
  });

  it('clamps to the ranges, parses text, falls back on junk', () => {
    const rules = normalizeAlertRules({
      enableHighDegree: 'false',
      highDegreeMin: 0,
      highSeverityDegree: '12',
      maxHighDegreeAlerts: 5000,
      enableHeavyEdge: 'maybe',
      heavyEdgePercentile: 10,
      heavyEdgeMinSamples: 'x',
      maxHeavyEdgeAlerts: 2.9,
      heavyEdgeMinValue: -5,
    });
    expect(rules).toEqual({
      enableHighDegree: false,
      highDegreeMin: 1,
      highSeverityDegree: 12,
      maxHighDegreeAlerts: 1000,
      enableHeavyEdge: true,
      heavyEdgePercentile: 50,
      heavyEdgeMinSamples: 4,
      maxHeavyEdgeAlerts: 2,
      heavyEdgeMinValue: 0,
    });
    expect(normalizeAlertRules({ heavyEdgePercentile: 100 }).heavyEdgePercentile).toBe(99.99);
  });

  it('percentile interpolates linearly (GA getPercentile)', () => {
    expect(getPercentile([], 0.5)).toBe(1);
    expect(getPercentile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(getPercentile([10, 20, 30, 40], 0.95)).toBeCloseTo(38.5);
    expect(getPercentile([5], 0.95)).toBe(5);
  });
});

describe('generateGraphAlerts matches production', () => {
  productionCases.cases.forEach((testCase, index) => {
    it(`case ${index + 1}: ${testCase.expected.length} alert(s)`, () => {
      const graph = build(testCase.nodes, testCase.edges);
      const found = generateGraphAlerts(graph, {
        nodeIds: testCase.visibleNodes,
        edgeIds: testCase.visibleEdges.map((id) => `id:${id}`),
      }, testCase.config);
      const comparable = found.map((alert) => (alert.type === 'high_degree'
        ? { type: alert.type, severity: alert.severity, nodeId: alert.nodeId, message: alert.message }
        : { type: alert.type, severity: alert.severity, edgeId: alert.edgeId.replace(/^id:/, ''), value: alert.value }));
      const expected = testCase.expected.map((alert) => (alert.type === 'high_degree'
        ? alert
        : { type: alert.type, severity: alert.severity, edgeId: alert.edgeId, value: Number(/weight\s+(\S+)$/.exec(alert.message)[1]) }));
      expect(comparable).toEqual(expected);
    });
  });
});

describe('generateGraphAlerts rules', () => {
  // hub connected to 9 leaves; one heavy edge among weighted ones
  const leaves = Array.from({ length: 9 }, (_, i) => `l${i}`);
  const graph = build(['hub', ...leaves], leaves.map((leaf, i) => ({ id: `e${i}`, from: 'hub', to: leaf, weight: i === 4 ? 900 : 10 + i })));
  const view = { nodeIds: graph.nodes(), edgeIds: graph.edges() };

  it('a hub at or above the HIGH degree is high severity; leaves stay under the minimum', () => {
    const [hub, ...rest] = generateGraphAlerts(graph, view);
    expect(hub).toMatchObject({ type: 'high_degree', severity: 'high', nodeId: 'hub', degree: 9 });
    expect(rest.every((alert) => alert.type === 'heavy_edge')).toBe(true);
    expect(generateGraphAlerts(graph, view, { highSeverityDegree: 10 })[0].severity).toBe('medium');
  });

  it('the heaviest edge is flagged; theme lines and the minimum value are respected', () => {
    const heavy = generateGraphAlerts(graph, view, { enableHighDegree: false });
    expect(heavy).toEqual([{ type: 'heavy_edge', severity: 'medium', edgeId: 'id:e4', value: 900, message: 'Edge id:e4 has high weight 900' }]);
    expect(generateGraphAlerts(graph, view, { enableHighDegree: false, heavyEdgeMinValue: 1000 })).toEqual([]);
  });

  it('only visible neighbours count, and nothing is flagged on an empty view', () => {
    const few = generateGraphAlerts(graph, { nodeIds: ['hub', 'l0', 'l1'], edgeIds: [] });
    expect(few).toEqual([]);
    expect(generateGraphAlerts(graph, { nodeIds: [], edgeIds: view.edgeIds })).toEqual([]);
  });
});

describe('alerts that would mislead (audit A4)', () => {
  const graphWith = (edges) => {
    const ids = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    const store = createGraphStore();
    store.replace({ nodes: [...ids].map((id) => ({ id })), edges });
    return [store.graph(), { nodeIds: store.graph().nodes(), edgeIds: store.graph().edges() }];
  };
  it('equal weights raise no heavy-edge alert', () => {
    const [graph, view] = graphWith(Array.from({ length: 8 }, (_, i) => ({ id: `e${i}`, from: `n${i}`, to: `n${i + 1}`, weight: 250 })));
    expect(generateGraphAlerts(graph, view).filter((item) => item.type === 'heavy_edge')).toEqual([]);
  });
  it('says how many it does not list', () => {
    const edges = [];
    for (let hub = 0; hub < 20; hub += 1) for (let leaf = 0; leaf < 10; leaf += 1) edges.push({ id: `${hub}_${leaf}`, from: `H${hub}`, to: `H${hub}_${leaf}` });
    const alerts = generateGraphAlerts(...graphWith(edges));
    expect(alerts).toHaveLength(5);
    expect(alertSummary(alerts)).toBe('5 alerts · 5 high · 15 more not listed');
  });
});

describe('alert panel wording (GA describeGraphAlert)', () => {
  const graph = build(
    [{ id: 'a', label: 'Alpha', size: 30, account: 'ACC-1\nsecond line', bank: 'NBE' }, { id: 'b', name: 'Bravo' }, { id: 'c' }],
    [{ id: 'x', from: 'b', to: 'a', weight: 5 }],
  );

  it('names a node by the chosen key, else its first property with a value', () => {
    expect(alertNodeName(graph, 'a')).toBe('label : Alpha');
    expect(alertNodeName(graph, 'a', 'account')).toBe('account : ACC-1');
    expect(alertNodeName(graph, 'a', 'missing')).toBe('label : Alpha');
    expect(alertNodeName(graph, 'c')).toBe('c');
    expect(alertNodeName(graph, 'gone')).toBe('gone');
  });

  it('describes both alert types and points heavy edges at their source', () => {
    const hub = describeGraphAlert(graph, { type: 'high_degree', severity: 'high', nodeId: 'a', degree: 9 }, 'bank');
    expect(hub).toEqual({
      name: 'bank : NBE',
      category: 'Highly connected',
      severity: 'high',
      detail: 'Connected to 9 other nodes — a hub that can signal structuring, layering, or a shared intermediary. Review its neighbours.',
      short: 'Hub linked to 9 nodes.',
    });
    const edgeAlert = { type: 'heavy_edge', severity: 'medium', edgeId: 'id:x', value: 5 };
    expect(describeGraphAlert(graph, edgeAlert)).toMatchObject({ name: 'name : Bravo', category: 'High-value link', short: 'Unusually high value: 5.' });
    expect(alertFocusNode(graph, edgeAlert)).toBe('b');
    expect(alertPropertyKeys(graph, [edgeAlert])).toEqual(['name', 'label', 'account', 'bank']);
  });

  it('summarises counts, and what was looked at', () => {
    expect(alertSummary([])).toBe('No alerts in this graph.');
    expect(alertSummary([], { drawn: 25, total: 200 })).toBe('No alerts among the 25 drawn of 200 entities.');
    expect(alertSummary([], { rules: { enableHighDegree: false, enableHeavyEdge: false } })).toBe('No alert rule is on.');
    expect(alertSummary([], { scanned: false })).toMatch(/^Not scanned/);
    expect(alertSummary([{ severity: 'high' }], { drawn: 25, total: 200 })).toBe('1 alert · 1 high · 25 of 200 entities checked');
    expect(alertSummary([{ severity: 'high' }, { severity: 'medium' }, { severity: 'medium' }])).toBe('3 alerts · 1 high · 2 medium');
  });
});

describe('describeAlertRules (report cover)', () => {
  it('says what the window alerts on, or that they are off', () => {
    expect(describeAlertRules({}, true, 2)).toBe('High-degree: 3+ links (high from 8); Heavy-edge: top 5% of link weights · 2 alerts raised');
    expect(describeAlertRules({ enableHeavyEdge: false, highDegreeMin: 5 }, true, 1)).toBe('High-degree: 5+ links (high from 8) · 1 alert raised');
    expect(describeAlertRules({ enableHighDegree: false, enableHeavyEdge: false }, true)).toBe('No graph alert rule enabled');
    expect(describeAlertRules({}, false, 3)).toBe('Graph alerts off');
  });
});
