// Figures are exact, over the same population everywhere, and say what they
// leave out (docs/integrity-audit-2026-11-24.md E1-E9).
import { describe, expect, it } from 'vitest';

import { formatFigure } from '../../../shared/numbers/values.js';
import { testCondition } from '../../graph/lib/conditionalFormatting.js';
import { createGraphStore } from '../../graph/lib/graphStore.js';
import { computeMeasure } from '../../graph/lib/networkMeasures.js';
import { draftFindings, reportFacts } from '../../graph/report/graphReportModel.js';
import { buildLinkRows, buildNodeRows, sortRows } from '../../table/lib/tableRows.js';
import { computeChartMetric } from './chartMetrics.js';
import { scopeInput } from './chartState.js';

const histogram = (values) => computeChartMetric('histogram', { values: values.map((value, i) => [`n${i}`, value]), subject: 'node', paramLabel: 'x' });

const store = createGraphStore();
store.replace({
  nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 't', annotationType: 'label', label: 'a note' }],
  edges: [{ id: 1, from: 'a', to: 'b', amount: '100' }, { id: 2, from: 'a', to: 'b', amount: '1.234,56' }, { id: 3, from: 'b', to: 'c', amount: 5 }, { id: 9, from: 'a', to: 'c', edge_kind: 'theme_line' }],
});
const graph = store.graph();
const all = { nodeIds: graph.nodes(), edgeIds: graph.edges(), selection: { nodes: ['a', 'b', 'c'], edges: [] }, weightKey: 'amount' };

describe('figures', () => {
  it('formatting rules keep accounts apart (E1)', () => {
    expect(testCondition({ op: 'eq', value: '12345' }, '0012345')).toBe(false);
    expect(testCondition({ op: 'eq', value: '1000123456789012345' }, '1000123456789012346')).toBe(false);
    expect(testCondition({ op: 'in', value: '1000, 16' }, '1E3')).toBe(false);
    expect(testCondition({ op: 'gt', value: '100' }, '1.234,56')).toBe(false);
  });

  it('the table orders dates and amounts with a unit (E2)', () => {
    const rows = ['2026-12-31', '2026-01-05', '2026-03-01'].map((value) => ({ id: value, sort: { at: value } }));
    expect(sortRows(rows, { key: 'at', dir: 'asc' }).map((row) => row.id)).toEqual(['2026-01-05', '2026-03-01', '2026-12-31']);
  });

  it('the report says from how many links a total is (E3)', () => {
    const facts = reportFacts(graph, all, { weightKey: 'amount' });
    expect(draftFindings({ graph, facts }).join(' ')).toContain('totalling 100 (1 of 2 links have an amount)');
  });

  it('amounts are shown to the cent (E5)', () => {
    expect([1234567.89, 12345.678, 3.14159, 0.000123456, 0, -2500.5].map(formatFigure)).toEqual(['1,234,567.89', '12,345.68', '3.1416', '0.0001235', '0', '-2,500.5']);
    expect(formatFigure(null)).toBe('—');
  });

  it('table, chart and report count the same entities and links (E6)', () => {
    const chart = scopeInput(store, all, 'drawn');
    expect(chart.nodeIds).toEqual(['a', 'b', 'c']);
    expect(chart.edges).toHaveLength(3);
    expect(buildNodeRows(graph, all.nodeIds, null).rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(buildLinkRows(graph, all.edgeIds, null).rows).toHaveLength(3);
    expect(reportFacts(graph, all).nodeIds).toEqual(['a', 'b', 'c']);
    // Links in the scope; a link that is not drawn counts nowhere.
    const drawn = graph.edges().filter((key) => graph.getEdgeAttribute(key, 'id') === 1);
    expect(buildNodeRows(graph, ['a'], null, { edgeKeys: drawn }).rows[0].sort['@degree']).toBe(1);
    expect(scopeInput(store, { ...all, edgeIds: drawn }, 'selected').edges).toHaveLength(1);
  });

  it('links without an amount are said (E3)', () => {
    expect(computeChartMetric('edgeWeight', scopeInput(store, all, 'drawn')).note).toBe('1 link without a readable amount left out.');
  });

  it('eigenvector centrality is settled (E8)', () => {
    // A long path settles slowly; the known values are sin(pi k / (n + 1)).
    const n = 60;
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    const scores = computeMeasure('eigenvector', ids, ids.slice(1).map((id, i) => [ids[i], id]));
    const top = Math.sin((Math.PI * 30) / 61);
    ids.forEach((id, i) => expect(scores[id]).toBeCloseTo(Math.sin((Math.PI * (i + 1)) / (n + 1)) / top, 4));
  });

  it('histogram: each value in its own range, ids by value, unread dates said (E9)', () => {
    const bins = histogram([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]).bins;
    expect(bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(10);
    bins.forEach((bin) => {
      const [low, high] = bin.label.split(' – ').map(Number);
      bin.members.forEach((id) => {
        const value = Number(id.slice(1)) / 10;
        expect(value >= low && (value < high || bin === bins[bins.length - 1])).toBe(true);
      });
    });
    expect(histogram(['1000100010001', '1000100010002', '1000100010002']).note).toContain('2 distinct values');
    expect(histogram(['2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09', 'soon']).note).toBe('By day; 1 value not read as a date left out.');
    expect(histogram([1234567, 1234568]).bins[0].label).toContain('1,234,567');
  });

  it('time: no period is cut off; widened instead, and borrowed dates are said (E9)', () => {
    const at = (year) => Date.UTC(year, 0, 1);
    const result = computeChartMetric('temporal', { nodeIds: ['a', 'b'], edges: [{ key: '1', source: 'a', target: 'b', time: at(2000) }, { key: '2', source: 'a', target: 'b', time: at(2026) }], timeUnit: 'hour', borrowedTimes: 1 });
    expect(result.series.find((series) => series.name === 'Links').values.reduce((sum, value) => sum + value, 0)).toBe(2);
    expect(result.note).toContain('wider periods than asked');
    expect(result.note).toContain('1 link takes the date of an entity');
  });
});
