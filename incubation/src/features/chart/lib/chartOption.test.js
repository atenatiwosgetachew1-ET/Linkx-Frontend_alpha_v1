import { describe, expect, it } from 'vitest';

import { computeChartMetric } from './chartMetrics.js';
import { CALLOUT_MAX, DENSE_BARS, PIN_MAX, buildChartOption } from './chartOption.js';

const star = (count) => ({
  nodeIds: ['hub', ...Array.from({ length: count }, (_, index) => `n${index}`)],
  edges: Array.from({ length: count }, (_, index) => ({ key: `e${index}`, source: 'hub', target: `n${index}` })),
});

describe('buildChartOption', () => {
  it('bars: largest first, named, coloured grey by value unless selected', () => {
    const result = computeChartMetric('degree', star(3));
    const { option, ids, empty } = buildChartOption(result, { names: { hub: 'Hub' }, selectedColors: { n1: '#00ff00' } });
    expect(empty).toBe(false);
    expect(ids[0]).toBe('hub');
    expect(option.xAxis.data[0]).toBe('Hub');
    expect(option.series[0].data[0].itemStyle.color).toBe('rgb(210,210,210)');
    expect(option.series[0].data.find((point) => point.name === 'n1').itemStyle.color).toBe('#00ff00');
  });

  it('pins: one over each selected entity, in its colour, tip on the bar; room always kept above; none without a selection', () => {
    const result = computeChartMetric('degree', star(3));
    const plain = buildChartOption(result).option;
    expect(plain.series[0].markPoint.data).toEqual([]);
    const { option, ids } = buildChartOption(result, { names: { hub: 'Hub' }, selectedColors: { hub: '#ff0000', n2: '#00ff00' } });
    const pins = option.series[0].markPoint;
    expect(pins.symbol).toBe('pin');
    expect(pins.symbolOffset).toEqual([0, '-50%']);
    expect(pins.data.map((pin) => [pin.entity, pin.name, pin.coord, pin.itemStyle.color])).toEqual([
      ['hub', 'Hub', [0, 3], '#ff0000'],
      ['n2', 'n2', [ids.indexOf('n2'), 1], '#00ff00'],
    ]);
    // Room for a pin always kept: a selection does not move the bars.
    expect(option.grid.top).toBe(plain.grid.top);
    expect(plain.grid.top).toBe(14 + 26);
    expect(option.tooltip.formatter({ componentType: 'markPoint', marker: '', name: 'Hub' })).toContain('click to zoom');
  });

  it('pins carry a label (the entity and its values here) while at most CALLOUT_MAX are shown, beside the pin towards the middle', () => {
    const result = computeChartMetric('inOut', star(9));
    const one = buildChartOption(result, { names: { hub: 'Hub' }, selectedColors: { hub: '#ff0000' } }).option.series[0].markPoint.data[0];
    expect(one.label).toMatchObject({ show: true, formatter: 'Hub \u00b7 In 0 \u00b7 Out 9', position: 'right' });
    expect(one.callout).toBeUndefined();
    // The last entity: its label to the left (inside the chart).
    const last = buildChartOption(result, { selectedColors: { n8: '#00ff00' } }).option.series[0].markPoint.data[0];
    expect(last.label.position).toBe('left');
    const many = Object.fromEntries(['n0', 'n1', 'n2', 'n3'].map((id) => [id, '#123456']));
    expect(CALLOUT_MAX).toBe(3);
    expect(buildChartOption(result, { selectedColors: many }).option.series[0].markPoint.data.every((pin) => !pin.label)).toBe(true);
    // A bin names the selected entity in it.
    const bins = buildChartOption(computeChartMetric('degreeDistribution', star(3)), { names: { hub: 'Hub' }, selectedColors: { hub: '#ff0000' } }).option;
    expect(bins.series[0].markPoint.data[0].label.formatter).toBe('Hub \u00b7 3 (1 entity)');
  });

  it('pins: at most PIN_MAX; scatter at its point; two series on the main axis only', () => {
    const many = computeChartMetric('degree', star(60));
    const all = Object.fromEntries(many.series[0].values ? Object.keys(many.series[0].values).map((id) => [id, '#123456']) : []);
    expect(buildChartOption(many, { selectedColors: all }).option.series[0].markPoint.data).toHaveLength(PIN_MAX);
    const scatter = buildChartOption(computeChartMetric('constraint', star(3)), { selectedColors: { n0: '#00ff00' } });
    const pin = scatter.option.series[0].markPoint.data[0];
    expect(pin.coord).toEqual(scatter.option.series[0].data[scatter.ids.indexOf('n0')].value);
    const ego = buildChartOption(computeChartMetric('ego', star(3)), { selectedColors: { hub: '#ff0000' } }).option;
    expect(ego.series[0].markPoint.data[0].coord).toEqual([0, 4]);
    expect(ego.series[1].markPoint).toBeUndefined();
  });

  it('tooltips are compact: small type, tight padding, one line per item', () => {
    const { option } = buildChartOption(computeChartMetric('degree', star(3)), { names: { hub: 'Hub' }, theme: { surface: '#101820', border: '#334', text: '#eee' } });
    expect(option.tooltip).toMatchObject({ padding: [3, 7], backgroundColor: '#101820', borderColor: '#334', textStyle: { color: '#eee', fontSize: 11 } });
    const line = option.tooltip.formatter({ marker: '', name: 'Hub', seriesName: 'Degree', value: 3 });
    expect(line).not.toContain('<br');
    expect(line).toContain('Hub');
    expect(line).toContain('<b>3</b>');
  });

  it('dense charts open zoomed on the largest DENSE_BARS (slider and inside zoom alike); sparse ones on everything', () => {
    const dense = buildChartOption(computeChartMetric('degree', star(239))).option;
    expect(dense.dataZoom.map((zoom) => [zoom.type, zoom.start, zoom.end])).toEqual([['slider', 0, (DENSE_BARS / 240) * 100], ['inside', 0, (DENSE_BARS / 240) * 100]]);
    const sparse = buildChartOption(computeChartMetric('degree', star(20))).option;
    expect(sparse.dataZoom.every((zoom) => zoom.start === undefined)).toBe(true);
    // Bins: the slider (and the opening zoom) past 30 / DENSE_BARS bins.
    const many = { kind: 'node', form: 'bins', bins: Array.from({ length: 120 }, (_, index) => ({ label: String(index), value: 1, members: [`n${index}`] })) };
    expect(buildChartOption(many).option.dataZoom[0]).toMatchObject({ type: 'slider', start: 0, end: 50 });
  });

  it('a recolouring reuses the sort (same result: the same order, worked out once)', () => {
    const result = computeChartMetric('degree', star(50));
    const first = buildChartOption(result).ids;
    const again = buildChartOption(result, { selectedColors: { n3: '#ff0000' } }).ids;
    expect(again).toBe(first);
    expect(first[0]).toBe('hub');
  });

  it('5 000 entities: built in well under a frame budget per recolouring', () => {
    const result = computeChartMetric('degree', star(5000));
    buildChartOption(result);
    const start = performance.now();
    for (let i = 0; i < 5; i += 1) buildChartOption(result, { selectedColors: { [`n${i}`]: '#ff0000' }, colorful: true });
    expect((performance.now() - start) / 5).toBeLessThan(100);
  });

  it("scatter (production's Clustering / Constraint): a point per entity along a hidden axis", () => {
    const result = computeChartMetric('constraint', star(3));
    const { option, ids } = buildChartOption(result);
    expect(option.series[0].type).toBe('scatter');
    expect(option.xAxis.show).toBe(false);
    expect(option.series[0].data.map((point) => point.value[0])).toEqual([0, 1, 2, 3]);
    expect(ids).toHaveLength(4);
  });

  it('ego: density on its own axis beside size', () => {
    const { option } = buildChartOption(computeChartMetric('ego', star(3)));
    expect(option.yAxis).toHaveLength(2);
    expect(option.series.map((series) => [series.name, series.yAxisIndex])).toEqual([['Size', 0], ['Density', 1]]);
  });

  it('hits: authority and hub as two bar series over the entities (the radar was hard to read)', () => {
    const { option, ids, empty } = buildChartOption(computeChartMetric('hits', star(40)));
    expect(empty).toBe(false);
    expect(ids).toHaveLength(41);
    expect(option.radar).toBeUndefined();
    expect(option.series.map((series) => [series.type, series.name])).toEqual([['bar', 'Authority'], ['bar', 'Hub']]);
    expect(option.legend).toBeTruthy();
  });

  it('bins: a labelled bar per bin, its members for the click; a bin holding a selected item in its colour; log scale when asked', () => {
    const result = computeChartMetric('degreeDistribution', star(3));
    const { option, members, ids, empty } = buildChartOption(result, { selectedColors: { hub: '#ff0000' } });
    expect(empty).toBe(false);
    expect(ids).toEqual([]);
    expect(option.xAxis.data).toEqual(['1', '3']);
    expect(members).toEqual([['n0', 'n1', 'n2'], ['hub']]);
    expect(option.series[0].data.map((point) => point.value)).toEqual([3, 1]);
    expect(option.series[0].data[1].itemStyle.color).toBe('#ff0000');
    expect(option.yAxis.type).toBe('value');
    expect(buildChartOption({ ...result, log: true }).option.yAxis.type).toBe('log');
    expect(option.tooltip.formatter({ marker: '', name: '3', value: 1 })).toContain('click to select');
  });

  it('heat matrix: hours across, weekdays down, a shade per cell; a cell with a selected link outlined; members per cell', () => {
    const time = new Date(2026, 0, 5, 9).getTime();
    const result = computeChartMetric('heatMatrix', { nodeIds: [], edges: [{ key: 'e1', source: 'a', target: 'b', time }, { key: 'e2', source: 'a', target: 'b', time }] });
    const { option, members } = buildChartOption(result, { selectedColors: { e2: '#00ff00' } });
    expect(option.xAxis.data).toHaveLength(24);
    expect(option.yAxis.data).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(option.series[0].type).toBe('heatmap');
    expect(option.series[0].data[0].value).toEqual([9, 0, 2]);
    expect(option.series[0].data[0].itemStyle.borderColor).toBe('#00ff00');
    expect(option.visualMap.max).toBe(2);
    expect(members).toEqual([['e1', 'e2']]);
  });

  it('flow: the metric\u2019s own order (by in + out), three series', () => {
    const result = computeChartMetric('moneyFlow', { nodeIds: ['a', 'b', 'c'], edges: [{ key: '1', source: 'a', target: 'b', weight: 10 }, { key: '2', source: 'b', target: 'c', weight: 9 }] });
    const { option, ids } = buildChartOption(result);
    expect(ids).toEqual(['b', 'a', 'c']);
    expect(option.series.map((series) => series.name)).toEqual(['In', 'Out', 'Net']);
  });

  it('pins on assortativity (a selected link\u2019s point), bins (a bin holding a selected item) and the heat matrix (its cell)', () => {
    const pairs = buildChartOption(computeChartMetric('assortativity', star(3)), { selectedColors: { e1: '#ff0000' } }).option;
    expect(pairs.series[0].markPoint.data).toEqual([expect.objectContaining({ coord: [3, 1], itemStyle: { color: '#ff0000' } })]);
    const bins = buildChartOption(computeChartMetric('degreeDistribution', star(3)), { selectedColors: { n2: '#00ff00' } }).option;
    expect(bins.series[0].markPoint.data).toEqual([expect.objectContaining({ name: '1', coord: [0, 3], itemStyle: { color: '#00ff00' } })]);
    const time = new Date(2026, 0, 5, 9).getTime();
    const heat = buildChartOption(computeChartMetric('heatMatrix', { nodeIds: [], edges: [{ key: 'e1', source: 'a', target: 'b', time }] }), { selectedColors: { e1: '#0000ff' } }).option;
    expect(heat.series[0].markPoint.data).toEqual([expect.objectContaining({ name: 'Mon 09:00', coord: [9, 0] })]);
    expect(heat.series[0].markPoint.symbolSize).toBe(18);
    // Their tooltips name the pin (no entity axis to zoom along).
    expect(heat.tooltip.formatter({ componentType: 'markPoint', marker: '', name: 'Mon 09:00' })).toContain('selected');
    // None without a selection; the room for them kept.
    const plain = buildChartOption(computeChartMetric('degreeDistribution', star(3))).option;
    expect(plain.series[0].markPoint.data).toEqual([]);
    expect(plain.grid.top).toBe(bins.grid.top);
  });

  it('assortativity: each link a point at its two ends\u2019 degrees, clickable as the link', () => {
    const result = computeChartMetric('assortativity', star(3));
    const { option, ids } = buildChartOption(result, { names: { e0: 'Hub → n0' } });
    expect(ids).toEqual(['e0', 'e1', 'e2']);
    expect(option.series[0].data[0]).toMatchObject({ name: 'Hub → n0', value: [3, 1] });
    expect(option.xAxis.name).toBe('Degree (one end)');
  });

  it('nothing in scope is empty', () => {
    expect(buildChartOption(computeChartMetric('degree', { nodeIds: [], edges: [] })).empty).toBe(true);
  });
});
