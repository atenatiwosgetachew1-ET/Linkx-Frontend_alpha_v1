import { describe, expect, it } from 'vitest';

import { aggregateLinks, linkGroupOf, normalizeLinkAggregation } from './linkAggregation.js';
import { buildElements } from './graphElements.js';
import { createGraphStore } from './graphStore.js';

const links = [
  ['e1', { id: 'e1', from: 'a', to: 'b', amount: 100, label: 'pays' }],
  ['e2', { id: 'e2', from: 'a', to: 'b', amount: '2,500', label: 'pays' }],
  ['e3', { id: 'e3', from: 'b', to: 'a', amount: 'n/a', label: 'pays' }],
  ['e4', { id: 'e4', from: 'a', to: 'c', amount: 7 }],
  ['t1', { id: 't1', from: 'a', to: 'b', edge_kind: 'theme_line' }],
];

describe('link aggregation (i2 #2)', () => {
  it('groups by pair, combined or per direction', () => {
    expect(linkGroupOf({ from: 'b', to: 'a' })).toBe('a<->b');
    expect(linkGroupOf({ from: 'b', to: 'a' }, 'direction')).toBe('b->a');
  });

  it('combined: one drawn link with the count and the total; theme lines and single links untouched', () => {
    const result = aggregateLinks(links, { totalKey: 'amount' });
    expect(result.groups.get('a<->b')).toMatchObject({ key: 'e1', members: ['e1', 'e2', 'e3'], count: 3, total: 2600, forward: 2, backward: 1 });
    expect(result.primary.get('e1')).toMatchObject({ label: 'pays ×3 · 2,600 (2 of 3)', aggregated: 3, bothWays: 1 });
    expect([...result.hidden]).toEqual(['e2', 'e3']);
    expect(result.memberOf.has('e4')).toBe(false);
    expect(result.memberOf.has('t1')).toBe(false);
  });

  it('per direction: each way apart; no total without numbers; an expanded pair shows all its links', () => {
    const result = aggregateLinks(links, { mode: 'direction' });
    expect(result.groups.get('a->b').count).toBe(2);
    expect(result.groups.has('b->a')).toBe(false);
    expect(result.primary.get('e1').label).toBe('pays ×2');
    expect(result.primary.get('e1').bothWays).toBeUndefined();
    const open = aggregateLinks(links, { mode: 'direction', expanded: ['a->b'] });
    expect(open.hidden.size).toBe(0);
    expect(open.primary.size).toBe(0);
    expect(open.memberOf.get('e2')).toBe('a->b');
  });

  it('never adds what it cannot read, and says so (audit E3)', () => {
    const of = (...amounts) => aggregateLinks(amounts.map((amount, i) => [`e${i}`, { id: `e${i}`, from: 'a', to: 'b', amount }]), { totalKey: 'amount' }).primary.get('e0').label;
    expect(of('1.234,56', '100')).toBe('×2 · 100 (1 of 2)');
    expect(of('$1,200', 'ETB 500', '300')).toBe('×3 · 300 (1 of 3)');
    expect(of('(50)', '200')).toBe('×2 · 150');
  });

  it('normalizes its setting', () => {
    expect(normalizeLinkAggregation({ on: 'true', mode: 'x', totalKey: ' amount ' })).toEqual({ on: true, mode: 'combined', totalKey: 'amount' });
    expect(normalizeLinkAggregation(undefined)).toEqual({ on: false, mode: 'combined', totalKey: '' });
  });

  it('replaces edge bundling when on, in the drawn elements', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: links.map(([, edge]) => edge) });
    const view = { nodeIds: ['a', 'b', 'c'], edgeIds: store.graph().edges(), viewKey: 'v' };
    const { edges } = buildElements(store, view, { edgeBundling: true, aggregation: { on: true, mode: 'combined', totalKey: 'amount', expanded: [] } });
    const drawn = edges.find((edge) => edge.data.aggregated);
    expect(drawn.data).toMatchObject({ label: 'pays ×3 · 2,600 (2 of 3)', aggregated: 3 });
    expect(drawn.data.bundled).toBeUndefined();
    expect(edges).toHaveLength(3); // the aggregate, a->c and the theme line
  });
});
