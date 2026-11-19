import { describe, expect, it } from 'vitest';
import { SVGRenderer } from 'echarts/renderers';

import echarts from './echarts.js';
import { computeChartMetric } from './chartMetrics.js';
import { buildChartOption } from './chartOption.js';

// The real (tree-shaken) library, rendered server-side to SVG: every part
// the chart options use must be registered, or ECharts drops it silently
// (the selection pins were missing: MarkPoint was not registered).
echarts.use([SVGRenderer]);

const star = (count) => ({
  nodeIds: ['hub', ...Array.from({ length: count }, (_, index) => `n${index}`)],
  edges: Array.from({ length: count }, (_, index) => ({ key: `e${index}`, source: 'hub', target: `n${index}` })),
});

describe('echarts (registered parts)', () => {
  it('draws the selection pins', () => {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 240 });
    const { option } = buildChartOption(computeChartMetric('degree', star(5)), { selectedColors: { n2: '#ff0000' } });
    chart.setOption({ ...option, animation: false });
    expect(chart.getModel().getComponent('markPoint')).toBeTruthy();
    const svg = chart.renderToSVGString();
    expect(svg).toMatch(/fill="#ff0000"|fill="rgb\(255,0,0\)"/i);
    chart.dispose();
  });

  it('every component a chart form uses is registered', () => {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 240 });
    const forms = ['degree', 'inOut', 'constraint', 'eigenvector', 'ego', 'hits', 'assortativity', 'moneyFlow', 'fanInOut', 'degreeDistribution'];
    forms.forEach((metric) => {
      const { option } = buildChartOption(computeChartMetric(metric, star(5)), { selectedColors: { n1: '#00ff00' } });
      chart.setOption(option, true);
      ['grid', 'tooltip', 'dataZoom'].forEach((type) => {
        if (option[type] && (!Array.isArray(option[type]) || option[type].length)) expect(chart.getModel().getComponent(type), `${metric}: ${type}`).toBeTruthy();
      });
      if (option.legend) expect(chart.getModel().getComponent('legend'), `${metric}: legend`).toBeTruthy();
      if (option.visualMap) expect(chart.getModel().getComponent('visualMap'), `${metric}: visualMap`).toBeTruthy();
    });
    chart.dispose();
  });
});

describe('echarts (zoom read from its model)', () => {
  it("the zoom's window is on the dataZoom model's option", () => {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 240 });
    const { option } = buildChartOption(computeChartMetric('degree', star(30)));
    chart.setOption({ ...option, animation: false });
    chart.dispatchAction({ type: 'dataZoom', start: 20, end: 40 });
    const zoom = chart.getModel().getComponent('dataZoom', 0).option;
    expect([zoom.start, zoom.end]).toEqual([20, 40]);
    chart.dispose();
  });
});

describe('echarts (heat matrix)', () => {
  it('draws the heatmap with its colour scale (both registered)', () => {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 240 });
    const time = new Date(2026, 0, 5, 9).getTime();
    const { option } = buildChartOption(computeChartMetric('heatMatrix', { nodeIds: [], edges: [{ key: 'e1', source: 'a', target: 'b', time }] }));
    chart.setOption({ ...option, animation: false });
    expect(chart.getModel().getComponent('visualMap')).toBeTruthy();
    expect(chart.getModel().getSeriesByType('heatmap')).toHaveLength(1);
    expect(chart.renderToSVGString()).toContain('<path');
    chart.dispose();
  });
});

describe('echarts (pins on every chart that shows a selection)', () => {
  it.each([
    ['hits', { n2: '#ff0000' }],
    ['constraint', { n2: '#ff0000' }],
    ['assortativity', { e2: '#ff0000' }],
    ['degreeDistribution', { n2: '#ff0000' }],
  ])('%s draws its pin', (metric, selectedColors) => {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 240 });
    const { option } = buildChartOption(computeChartMetric(metric, star(5)), { selectedColors, colorful: false });
    chart.setOption({ ...option, animation: false });
    expect(option.series.flatMap((series) => series.markPoint?.data || [])).toHaveLength(1);
    expect(chart.getModel().getComponent('markPoint')).toBeTruthy();
    expect(chart.renderToSVGString()).toMatch(/fill="#ff0000"|fill="rgb\(255,0,0\)"/i);
    chart.dispose();
  });

  it('heat matrix draws its pin', () => {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 240 });
    const time = new Date(2026, 0, 5, 9).getTime();
    const { option } = buildChartOption(computeChartMetric('heatMatrix', { nodeIds: [], edges: [{ key: 'e1', source: 'a', target: 'b', time }] }), { selectedColors: { e1: '#ff0000' } });
    chart.setOption({ ...option, animation: false });
    expect(chart.renderToSVGString()).toMatch(/fill="#ff0000"|fill="rgb\(255,0,0\)"/i);
    chart.dispose();
  });
});

describe('echarts (a snap redraws the live chart)', () => {
  it("a chart's live option drawn again keeps its zoom window and pins, without the slider", async () => {
    const { snapOption } = await import('./chartSnaps.js');
    const live = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 340, height: 200 });
    const { option } = buildChartOption(computeChartMetric('degree', star(40)), { selectedColors: { n5: '#ff0000' } });
    live.setOption({ ...option, animation: false }, true);
    live.dispatchAction({ type: 'dataZoom', start: 10, end: 30 });
    const snap = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 612, height: 320 });
    snap.setOption(snapOption(live.getOption()), true);
    const zoom = snap.getModel().getComponent('dataZoom', 0).option;
    expect([zoom.start, zoom.end]).toEqual([10, 30]);
    expect(snap.getOption().dataZoom.find((entry) => entry.type === 'slider').show).toBe(false);
    expect(snap.getOption().series[0].markPoint.data).toHaveLength(1);
    expect(snap.getOption().animation).toBe(false);
    live.dispose();
    snap.dispose();
  });
});

describe('echarts (the pin\u2019s label)', () => {
  it('draws the selected entity\u2019s name and value beside its pin', () => {
    const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 400, height: 240 });
    const { option } = buildChartOption(computeChartMetric('degree', star(5)), { names: { hub: 'Hub' }, selectedColors: { hub: '#ff0000' } });
    chart.setOption({ ...option, animation: false });
    expect(chart.renderToSVGString()).toContain('Hub \u00b7 5');
    chart.dispose();
  });
});
