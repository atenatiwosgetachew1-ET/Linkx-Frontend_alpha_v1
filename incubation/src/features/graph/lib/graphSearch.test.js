import { describe, expect, it } from 'vitest';

import { parseSearchExpression, searchNodeIds, valueMatchesSearchExpression } from './graphSearch.js';
import { createGraphStore } from './graphStore.js';
import { labelFor } from './graphElements.js';
import { formatPropertyKeyLabel, formatPropertyValue } from './graphFormat.js';

describe('search expressions (production parseSearchExpression)', () => {
  it('recognises range, comparisons, exact numbers and text', () => {
    expect(parseSearchExpression('10 - 20')).toEqual({ mode: 'range', min: 10, max: 20 });
    expect(parseSearchExpression('20-10')).toEqual({ mode: 'range', min: 10, max: 20 });
    expect(parseSearchExpression('>= 1,500')).toEqual({ mode: 'compare', op: '>=', target: 1500 });
    // Could be 1.5 or 15: never guessed (production took 15).
    expect(parseSearchExpression('>= 1,5').mode).toBe('text');
    expect(parseSearchExpression('==3')).toEqual({ mode: 'compare', op: '=', target: 3 });
    expect(parseSearchExpression('42')).toEqual({ mode: 'number_exact', target: 42, text: '42' });
    expect(parseSearchExpression('  Abebe ')).toEqual({ mode: 'text', textLower: 'abebe' });
  });

  it('matches values like production', () => {
    expect(valueMatchesSearchExpression('Mr ABEBE K', parseSearchExpression('abebe'))).toBe(true);
    expect(valueMatchesSearchExpression('1,200', parseSearchExpression('>1000'))).toBe(true);
    expect(valueMatchesSearchExpression('n/a', parseSearchExpression('>1000'))).toBe(false);
    expect(valueMatchesSearchExpression(15, parseSearchExpression('10-20'))).toBe(true);
    expect(valueMatchesSearchExpression(null, parseSearchExpression('x'))).toBe(false);
  });
});

describe('accounts and amounts (audit E1)', () => {
  const matches = (typed, value) => valueMatchesSearchExpression(value, parseSearchExpression(typed));
  it('finds the account typed, not another', () => {
    expect(matches('12345', '0012345')).toBe(false);
    expect(matches('0012345', '0012345')).toBe(true);
    expect(matches('1000123456789012345', '1000123456789012346')).toBe(false);
    expect(matches('1000123456789012345', '1000123456789012345')).toBe(true);
    expect(matches('=16', '0x10')).toBe(false);
    expect(matches('1,000,000', 1000000)).toBe(true);
  });
});

describe('searchNodeIds (production graphSearch)', () => {
  const nodes = [
    ['1', { id: '1', name: 'Abebe', amount: 500, x: 999 }],
    ['2', { id: '2', name: 'Kebede', amount: 1500 }],
    ['3', { id: '3', name: 'Almaz', amount: 2500 }],
    ['4', { id: '4', name: 'Tigist', amount: 50 }],
  ];
  const links = { 1: ['2'], 2: ['1', '3'], 3: ['2'], 4: [] };
  const run = (options) => searchNodeIds({ nodes, neighbours: (id) => links[id] || [], min: 0, max: 25, ...options });

  it('searches every property except positions when no key is chosen', () => {
    expect(run({ keyword: 'ab' })).toEqual(['1']);
    expect(run({ keyword: '999' })).toEqual([]); // x is skipped
  });

  it('searches only the chosen keys (exact key names)', () => {
    expect(run({ keyword: '>1000', keys: ['amount'] })).toEqual(['2', '3']);
    expect(run({ keyword: '>1000', keys: ['Amount'] })).toEqual([]);
  });

  it('adds linked nodes for text and exact numbers, not for ranges or comparisons', () => {
    expect(run({ keyword: 'abebe', includeLinked: true })).toEqual(['1', '2']);
    expect(run({ keyword: '>1000', keys: ['amount'], includeLinked: true })).toEqual(['2', '3']);
  });

  it('slices the results with the current range', () => {
    // "a" matches Abebe (1) and Almaz (3); results [1, 3] sliced from 1.
    expect(run({ keyword: 'a', min: 0, max: 25 })).toEqual(['1', '3']);
    expect(run({ keyword: 'a', min: 1, max: 3 })).toEqual(['3']);
  });

  it('is the normal limit view when the keyword is empty', () => {
    const store = createGraphStore();
    store.replace({ nodes: nodes.map(([, node]) => node) });
    expect(store.searchView({ keyword: '', min: 0, max: 2 })).toMatchObject({ nodeIds: ['1', '2'], searched: false });
    expect(store.searchView({ keyword: 'almaz' })).toMatchObject({ nodeIds: ['3'], searched: true });
  });
});

describe('labels and Info formatting', () => {
  it('labels nodes of the chosen identity by a property (production labelNodesWith)', () => {
    const node = { label: 'ACC-1', node_identity: 'Source Node', name: 'Abebe' };
    expect(labelFor(node, { byKey: 'name', group: 'Source Node' })).toBe('Abebe');
    expect(labelFor(node, { byKey: 'name', group: '' })).toBe('ACC-1'); // default group is Entity Node
    expect(labelFor(node, { byKey: 'missing', group: 'Source Node' })).toBe('ACC-1');
  });

  it('formats CDR keys and durations, removing currency words only', () => {
    expect(formatPropertyKeyLabel('account_no', true)).toBe('Calling Number (MSISDN)');
    expect(formatPropertyKeyLabel('account_no', false)).toBe('account_no');
    expect(formatPropertyValue('DURATION', '125', true)).toBe('125 sec (2m 5s)');
    expect(formatPropertyValue('amount', '1,200 Birr', true)).toBe('1200 sec (20m 0s)');
    // Production's character class would have stripped letters from text.
    expect(formatPropertyValue('BRANCH', 'Bole Tower', true)).toBe('Bole Tower');
    expect(formatPropertyValue('meta', { a: 1 }, false)).toBe('{"a":1}');
  });
});
