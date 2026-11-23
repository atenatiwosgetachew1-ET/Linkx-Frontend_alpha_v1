// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// The chart library stands in (jsdom has no canvas): each chart a picture.
const drawn = [];
vi.mock('./echarts.js', () => ({
  default: {
    init: () => {
      const chart = { option: null, setOption: (option) => { chart.option = option; drawn.push(option); }, getDataURL: () => 'data:image/png;base64,CHART', dispose: () => {} };
      return chart;
    },
  },
}));

const { AUTO_REPORT_CHARTS, reportChartCells } = await import('./chartReport.js');
const { createGraphStore } = await import('../../graph/lib/graphStore.js');

const graphStore = ({ amounts = false, dates = false } = {}) => {
  const store = createGraphStore();
  store.replace({
    nodes: Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, label: `N${index}`, ACCOUNT: `A-${index}` })),
    edges: Array.from({ length: 16 }, (_, index) => ({
      id: `e${index}`, from: `n${index % 12}`, to: `n${(index * 5 + 1) % 12}`,
      ...(amounts ? { value: 100 + index } : {}),
      ...(dates ? { TRANSACTIONDATE: `2026-01-${String(1 + (index % 9)).padStart(2, '0')}` } : {}),
    })),
  });
  return store;
};
const linkOf = (store) => ({ nodeIds: store.graph().nodes(), edgeIds: store.graph().edges(), selection: { nodes: [], edges: [] }, weightKey: '', timeKey: '', timeSlice: 'auto' });

describe('report charts (Measures)', () => {
  it('the automatic set: those the data supports drawn, in order; the others named with why (no amounts, no dates)', async () => {
    drawn.length = 0;
    const store = graphStore();
    const { cells, skipped } = await reportChartCells({ store, link: linkOf(store), scope: 'all' });
    expect(AUTO_REPORT_CHARTS).toEqual(['globalMetrics', 'degree', 'betweenness', 'moneyFlow', 'degreeDistribution', 'communitySizes', 'heatMatrix']);
    // jsdom: the figures card cannot be drawn (no canvas), the charts can.
    expect(cells.map((cell) => cell.title)).toEqual(['Degree Centrality', 'Betweenness Centrality', 'Degree Distribution', 'Community Sizes']);
    expect(cells.every((cell) => cell.image === 'data:image/png;base64,CHART')).toBe(true);
    expect(skipped.join(' ')).toMatch(/Flow In \/ Out \/ Net: No link has an amount/);
    expect(skipped.join(' ')).toMatch(/Heat Matrix \(Day × Hour\): .*no date field found/i);
    // Drawn for paper: entities named along the axis.
    expect(drawn[0].xAxis.axisLabel.show).toBe(true);
  });

  it('with amounts and dates: flow and the heat matrix too; entities named by a chosen column; the linked window’s cards as given', async () => {
    drawn.length = 0;
    const store = graphStore({ amounts: true, dates: true });
    const auto = await reportChartCells({ store, link: { ...linkOf(store), timeKey: 'TRANSACTIONDATE' }, scope: 'all', nameKey: 'ACCOUNT' });
    expect(auto.cells.map((cell) => cell.title)).toContain('Flow In / Out / Net');
    expect(auto.cells.map((cell) => cell.title)).toContain('Heat Matrix (Day × Hour)');
    expect(drawn[0].xAxis.data[0]).toMatch(/^A-/);
    const linked = await reportChartCells({ store, link: linkOf(store), scope: 'all', cards: [{ metric: 'pagerank', colorful: false, schema: 'Viridis', tone: 0.5 }] });
    expect(linked.cells.map((cell) => cell.title)).toEqual(['PageRank']);
  });

  it('a chart of nothing but zeros is named, not drawn (no links in scope)', async () => {
    const store = createGraphStore();
    store.replace({ nodes: Array.from({ length: 6 }, (_, index) => ({ id: `z${index}`, label: `Z${index}` })), edges: [] });
    const { cells, skipped } = await reportChartCells({ store, link: linkOf(store), scope: 'all', cards: [{ metric: 'degree' }, { metric: 'betweenness' }] });
    expect(cells).toEqual([]);
    expect(skipped).toEqual(['Degree Centrality: every value is 0 in this scope.', 'Betweenness Centrality: every value is 0 in this scope.']);
  });
});
