import { MultiDirectedGraph } from 'graphology';
import { describe, expect, it } from 'vitest';

import { parseSearchExpression } from './graphSearch.js';
import { propertyValues, rangeOfExpression, searchRangeOf } from './searchRange.js';

describe('the Filter range', () => {
  it('goes from 0 to the largest number of the properties, ids left out', () => {
    const graph = new MultiDirectedGraph();
    graph.addNode('1', { amount: 500, account: '1000200030004000', code: '0099999' });
    graph.addNode('2', { amount: '2,500.75', fee: 9000 });
    expect(searchRangeOf(propertyValues(graph, ['amount'])).max).toBe(2500.75);
    expect(searchRangeOf(propertyValues(graph, ['amount', 'fee'])).max).toBe(9000);
    expect(searchRangeOf(propertyValues(graph, ['account', 'code']))).toBeNull();
    expect(searchRangeOf([])).toBeNull();
    expect(searchRangeOf([-5, 0, 'text'])).toBeNull();
  });

  it('steps by one over small whole numbers; the ends are exact', () => {
    const small = searchRangeOf([3, 40]);
    expect([small.steps, small.valueAt(7), small.valueAt(40)]).toEqual([40, 7, 40]);
    const large = searchRangeOf([1234567]);
    expect([large.valueAt(0), large.valueAt(1000), large.valueAt(500)]).toEqual([0, 1234567, 617284]);
    const decimal = searchRangeOf([0.75]);
    expect([decimal.valueAt(1000), decimal.valueAt(500)]).toEqual([0.75, 0.375]);
  });

  it('what it writes is read back as that range', () => {
    const range = searchRangeOf([2500.75]);
    const text = `${range.textOf(range.valueAt(250))}-${range.textOf(range.max)}`;
    expect(rangeOfExpression(parseSearchExpression(text), range.max)).toEqual([range.valueAt(250), 2500.75]);
    expect(rangeOfExpression(parseSearchExpression('>100'), 500)).toEqual([100, 500]);
    expect(rangeOfExpression(parseSearchExpression('<=100'), 500)).toEqual([0, 100]);
    expect(rangeOfExpression(parseSearchExpression('abebe'), 500)).toEqual([0, 500]);
  });
});
