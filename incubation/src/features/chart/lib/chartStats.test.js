import { describe, expect, it } from 'vitest';

import { computeChartMetric } from './chartMetrics.js';
import { cardStats } from './chartStats.js';

const star = { nodeIds: ['hub', 'a', 'b', 'c'], edges: ['a', 'b', 'c'].map((id) => ({ key: `e-${id}`, source: 'hub', target: id })) };

describe('cardStats', () => {
  it('entities, the highest (named), mean and lowest', () => {
    expect(cardStats(computeChartMetric('degree', star), { hub: 'Hub' })).toEqual([
      { label: 'Entities', value: 4 },
      { label: 'Highest', value: 3, detail: 'Hub' },
      { label: 'Mean', value: 1.5 },
      { label: 'Lowest', value: 1 },
    ]);
  });
  it('two series: of the first; links for link metrics; the overall value first', () => {
    expect(cardStats(computeChartMetric('inOut', star)).map((stat) => stat.label)).toEqual(['Entities', 'Highest (In)', 'Mean (In)', 'Lowest (In)']);
    expect(cardStats(computeChartMetric('edgeBetweenness', star))[0]).toEqual({ label: 'Links', value: 3 });
    expect(cardStats(computeChartMetric('reciprocity', star))[0]).toEqual({ label: 'Overall reciprocity', value: 0, emphasis: true });
    expect(cardStats(computeChartMetric('assortativity', star)).map((stat) => stat.label)).toEqual(['Degree assortativity', 'Links']);
  });
  it('temporal: periods, dated and undated links; none for figure cards', () => {
    const day = (n) => new Date(2026, 0, n, 12).getTime();
    const result = computeChartMetric('temporal', { ...star, edges: [{ ...star.edges[0], time: day(1) }, { ...star.edges[1], time: day(3) }, star.edges[2]], timeUnit: 'day' });
    expect(cardStats(result)).toEqual([{ label: 'Periods', value: 3 }, { label: 'Dated links', value: 2 }, { label: 'Undated', value: 1 }]);
    expect(cardStats(computeChartMetric('cohesion', star))).toEqual([]);
  });

  it('bins: items, bars, the largest bin; heat matrix: dated links, the busiest cell, undated', () => {
    expect(cardStats({ kind: 'node', form: 'bins', yName: 'Entities', bins: [{ label: '1', value: 3, members: [] }, { label: '3', value: 1, members: [] }] })).toEqual([
      { label: 'Entities', value: 4 }, { label: 'Bars', value: 2 }, { label: 'Largest', value: 3, detail: '1' },
    ]);
    expect(cardStats({ kind: 'edge', form: 'heatmap', days: ['Mon'], hours: ['09:00'], undated: 2, cells: [{ day: 0, hour: 0, value: 5, members: [] }] })).toEqual([
      { label: 'Dated links', value: 5 }, { label: 'Busiest', value: 5, detail: 'Mon 09:00' }, { label: 'Undated', value: 2 },
    ]);
  });

  it('the selection first: one (value, rank, name), several (how many, their mean); bins and cells; nothing when not measured here', () => {
    const result = { kind: 'node', form: 'bar', series: [{ name: 'Degree', values: { a: 3, b: 5, c: 1, d: 3 } }] };
    expect(cardStats(result, { a: 'Abebe' }, ['a'])[0]).toEqual({ label: 'Selected', value: 3, detail: '#2 of 4 \u00b7 Abebe', selected: true });
    expect(cardStats(result, {}, ['a', 'c'])[0]).toEqual({ label: 'Selected (2)', value: 2, detail: 'mean', selected: true });
    expect(cardStats(result, {}, ['zz'])[0].label).toBe('Entities');
    const bins = { kind: 'node', form: 'bins', yName: 'Entities', bins: [{ label: '1', value: 3, members: ['x', 'y', 'z'] }, { label: '3', value: 1, members: ['hub'] }] };
    expect(cardStats(bins, { hub: 'Hub' }, ['hub'])[0]).toEqual({ label: 'Selected', value: 1, detail: 'Hub \u00b7 in 3', selected: true });
    const heat = { kind: 'edge', form: 'heatmap', days: ['Mon'], hours: ['09:00'], cells: [{ day: 0, hour: 0, value: 2, members: ['e1', 'e2'] }] };
    expect(cardStats(heat, {}, ['e2'])[0]).toEqual({ label: 'Selected', value: 1, detail: 'Mon 09:00', selected: true });
    expect(cardStats({ kind: 'time', form: 'time', periods: [], series: [] }, {}, ['a']).some((stat) => stat.selected)).toBe(false);
  });
});
