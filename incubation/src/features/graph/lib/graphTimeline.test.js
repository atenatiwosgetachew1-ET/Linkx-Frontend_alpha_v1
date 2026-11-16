import { describe, expect, it } from 'vitest';

import {
  applyTimeFilter, bucketStart, chooseUnit, nextBucket, parseTimelineDate, timelineBuckets, timelineItems, timelineKeys,
} from './graphTimeline.js';
import { createGraphStore } from './graphStore.js';

const day = (text) => new Date(`${text}T00:00:00`).getTime();

describe('timeline dates', () => {
  it('reads ISO dates and date-times; numbers only for date-named keys', () => {
    expect(parseTimelineDate('2026-03-05')).toBe(day('2026-03-05'));
    expect(parseTimelineDate('2026-03-05 14:30:00')).toBe(new Date('2026-03-05T14:30:00').getTime());
    expect(parseTimelineDate('2026-03-05T14:30:00Z')).toBe(Date.UTC(2026, 2, 5, 14, 30));
    expect(parseTimelineDate(1772668800)).toBeNull(); // could be an amount
    expect(parseTimelineDate(1772668800, { numeric: true })).toBe(1772668800000);
    expect(parseTimelineDate('1772668800000', { numeric: true })).toBe(1772668800000);
    expect(parseTimelineDate('5 March')).toBeNull();
    expect(parseTimelineDate('0001-01-01')).toBeNull();
  });

  it('finds the date keys of a view, production\'s TRANSACTIONDATE first', () => {
    const store = createGraphStore();
    store.replace({
      nodes: [
        { id: 1, opened: '2020-01-01', TRANSACTIONDATE: '2026-01-02', amount: 1772668800 },
        { id: 2, opened: '2021-01-01', TRANSACTIONDATE: '2026-01-03', note: '2026-01-01 is when' },
        { id: 3, opened: '2022-01-01' },
      ],
      edges: [{ from: 1, to: 2, created_at: 1772668800 }],
    });
    const keys = timelineKeys(store.graph(), store.visibleView({ max: 10 }));
    expect(keys.map((entry) => entry.key)).toEqual(['TRANSACTIONDATE', 'opened', 'created_at']);
    expect(keys[1].count).toBe(3);
  });
});

describe('timeline buckets', () => {
  it('chooses the bar size from the span', () => {
    expect(chooseUnit(day('2026-01-01'), day('2026-01-02'))).toBe('hour');
    expect(chooseUnit(day('2026-01-01'), day('2026-03-01'))).toBe('day');
    expect(chooseUnit(day('2026-01-01'), day('2027-01-01'))).toBe('week');
    expect(chooseUnit(day('2020-01-01'), day('2026-01-01'))).toBe('month');
    expect(chooseUnit(day('2000-01-01'), day('2026-01-01'))).toBe('year');
  });

  it('aligns bars (weeks start on Monday) and counts every date, empty bars included', () => {
    expect(bucketStart(day('2026-03-05'), 'week')).toBe(day('2026-03-02'));
    expect(nextBucket(day('2026-01-01'), 'month')).toBe(day('2026-02-01'));
    expect(nextBucket(day('2026-03-02'), 'week')).toBe(day('2026-03-09'));
    const { unit, buckets } = timelineBuckets([day('2026-03-01'), day('2026-03-01'), day('2026-03-04')], 'day');
    expect(unit).toBe('day');
    expect(buckets.map((bucket) => bucket.count)).toEqual([2, 0, 0, 1]);
    expect(timelineBuckets([]).buckets).toEqual([]);
  });

  it('slices by quarter (Q1 starts in January) and tells which units fit a span', async () => {
    const { formatBucket, unitFits } = await import('./graphTimeline.js');
    expect(bucketStart(day('2026-05-20'), 'quarter')).toBe(day('2026-04-01'));
    expect(nextBucket(day('2026-10-01'), 'quarter')).toBe(day('2027-01-01'));
    const { buckets } = timelineBuckets([day('2026-01-10'), day('2026-03-31'), day('2026-08-01')], 'quarter');
    expect(buckets.map((bucket) => bucket.count)).toEqual([2, 0, 1]);
    expect(formatBucket(buckets[2].start, 'quarter')).toBe('Q3 2026');
    expect(unitFits(day('2026-01-01'), day('2026-12-31'), 'day')).toBe(true);
    expect(unitFits(day('2000-01-01'), day('2026-01-01'), 'hour')).toBe(false);
  });
});

describe('timeline filter', () => {
  const store = createGraphStore();
  store.replace({
    nodes: [
      { id: 1, TRANSACTIONDATE: '2026-03-01' },
      { id: 2, TRANSACTIONDATE: '2026-03-10' },
      { id: 3 },
    ],
    edges: [
      { id: 'a', from: 1, to: 3, TRANSACTIONDATE: '2026-03-02' },
      { id: 'b', from: 3, to: 2 },
      { id: 'c', from: 1, to: 3, TRANSACTIONDATE: '2026-04-01' },
    ],
  });
  const view = store.visibleView({ max: 10 });

  it('lists the dated items', () => {
    const items = timelineItems(store.graph(), view, 'TRANSACTIONDATE');
    expect(items.nodes.size).toBe(2);
    expect(items.edges.size).toBe(2);
  });

  it('keeps what is dated inside the period and the undated items', () => {
    const filtered = applyTimeFilter(store.graph(), view, { key: 'TRANSACTIONDATE', from: day('2026-03-01'), to: day('2026-03-05') });
    expect(filtered.nodeIds).toEqual(['1', '3']);
    expect(filtered.edgeIds).toEqual(['id:a']); // b loses node 2; c is outside
  });

  it('can hide undated items too; no period and no option is the view itself', () => {
    const filtered = applyTimeFilter(store.graph(), view, { key: 'TRANSACTIONDATE', hideUndated: true });
    expect(filtered.nodeIds).toEqual(['1', '2']);
    expect(filtered.edgeIds).toEqual([]);
    expect(applyTimeFilter(store.graph(), view, { key: 'TRANSACTIONDATE' })).toBe(view);
  });
});
