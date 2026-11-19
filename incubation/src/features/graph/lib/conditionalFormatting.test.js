import { describe, expect, it } from 'vitest';

import {
  describeRule, formatFor, lockedStyles, matchCounts, matchingIds, normalizeFormatting, normalizeRule, ruleMatches, testCondition,
} from './conditionalFormatting.js';
import { buildElements } from './graphElements.js';
import { createGraphStore } from './graphStore.js';

const rule = (input) => normalizeRule({ id: input.id || 'r', ...input });

describe('conditional formatting: conditions (i2 #4)', () => {
  it('text, number-aware equality, lists, contains, starts with', () => {
    expect(testCondition({ op: 'eq', value: 'pep' }, 'PEP')).toBe(true);
    expect(testCondition({ op: 'eq', value: '2500' }, '2,500')).toBe(true);
    expect(testCondition({ op: 'neq', value: 'x' }, 'y')).toBe(true);
    expect(testCondition({ op: 'contains', value: 'bank' }, 'Awash Bank')).toBe(true);
    expect(testCondition({ op: 'starts', value: '+251' }, '+251911')).toBe(true);
    expect(testCondition({ op: 'in', value: 'Risk, PEP' }, 'pep')).toBe(true);
    expect(testCondition({ op: 'in', value: '1, 2' }, 3)).toBe(false);
  });

  it('numbers, ranges, dates, presence', () => {
    expect(testCondition({ op: 'gt', value: '1000' }, '1,500')).toBe(true);
    expect(testCondition({ op: 'lte', value: '10' }, 10)).toBe(true);
    expect(testCondition({ op: 'between', value: '10', value2: '5' }, 7)).toBe(true);
    expect(testCondition({ op: 'gt', value: '10' }, 'abc')).toBe(false);
    expect(testCondition({ op: 'before', value: '2026-01-01' }, '2025-06-01T10:00:00')).toBe(true);
    expect(testCondition({ op: 'after', value: '2026-01-01' }, '2025-06-01')).toBe(false);
    expect(testCondition({ op: 'dateBetween', value: '2026-01-01', value2: '2026-12-31' }, '2026-03-04')).toBe(true);
    expect(testCondition({ op: 'exists' }, '')).toBe(false);
    expect(testCondition({ op: 'empty' }, null)).toBe(true);
    expect(testCondition({ op: 'eq', value: 'x' }, null)).toBe(false);
  });

  it('all / any, built-in facts, off rules, other target', () => {
    const ctx = { degree: (id) => (id === 'h' ? 5 : 1), typeOf: (node) => node.node_identity, alerted: (kind, id) => id === 'h' };
    const hub = rule({ conditions: [{ key: '@degree', op: 'gte', value: '3' }, { key: '@alerted', op: 'eq', value: 'yes' }] });
    expect(ruleMatches(hub, 'node', 'h', {}, ctx)).toBe(true);
    expect(ruleMatches(hub, 'node', 'x', {}, ctx)).toBe(false);
    expect(ruleMatches({ ...hub, match: 'any' }, 'node', 'x', {}, { ...ctx, alerted: () => true })).toBe(true);
    expect(ruleMatches(rule({ conditions: [{ key: '@type', op: 'eq', value: 'source node' }] }), 'node', 'n', { node_identity: 'Source Node' }, ctx)).toBe(true);
    expect(ruleMatches({ ...hub, on: false }, 'node', 'h', {}, ctx)).toBe(false);
    expect(ruleMatches(hub, 'edge', 'h', {}, ctx)).toBe(false);
    // Property names ignore case, as production's getNodeValue.
    expect(ruleMatches(rule({ conditions: [{ key: 'category', op: 'eq', value: 'pep' }] }), 'node', 'n', { CATEGORY: 'PEP' })).toBe(true);
    // No conditions: everything of the target.
    expect(ruleMatches(rule({}), 'node', 'n', {})).toBe(true);
  });
});

describe('conditional formatting: styles', () => {
  const rules = [
    rule({ id: 'top', conditions: [{ key: 'risk', op: 'eq', value: 'high' }], style: { fill: '#ff0000' } }),
    rule({ id: 'low', conditions: [{ key: 'risk', op: 'exists' }], style: { fill: '#00ff00', size: 30 } }),
  ];

  it('the higher rule wins a style; others still add theirs; manual edits are left alone', () => {
    expect(formatFor(rules, 'node', 'a', { risk: 'high' })).toEqual({ style: { fill: '#ff0000', size: 30 }, rules: ['top', 'low'] });
    expect(formatFor(rules, 'node', 'a', { risk: 'low' })).toEqual({ style: { fill: '#00ff00', size: 30 }, rules: ['low'] });
    expect(formatFor(rules, 'node', 'a', {})).toBeNull();
    expect(formatFor(rules, 'node', 'a', { risk: 'high' }, {}, new Set(['fill'])).style).toEqual({ size: 30 });
    expect(lockedStyles('node', { __customized: { fill: true, size: false } })).toEqual(new Set(['fill']));
    expect(lockedStyles('edge', { __edits: { color: '#111111', dashes: false } })).toEqual(new Set(['color', 'lineStyle']));
  });

  it('counts, matching ids, descriptions and normalizing', () => {
    const items = { node: [['a', { risk: 'high' }], ['b', { risk: 'low' }], ['c', {}]] };
    expect(matchCounts(rules, items)).toEqual({ top: 1, low: 2 });
    expect(matchingIds(rules[1], items)).toEqual(['a', 'b']);
    expect(describeRule(rules[0])).toBe('Nodes where risk equals high');
    expect(describeRule(rule({ target: 'edge' }))).toBe('All links');
    const normalized = normalizeFormatting({ rules: [{ target: 'edge', style: { color: 'red', width: 99, lineStyle: 'dotted', fill: '#123456' }, conditions: [{ key: 'x', op: 'nope' }] }] });
    expect(normalized.rules[0]).toMatchObject({ target: 'edge', on: true, match: 'all', style: { width: 12, lineStyle: 'dotted' }, conditions: [{ key: 'x', op: 'eq', value: '', value2: '' }] });
    expect(normalized.rules[0].id).toMatch(/^rule_/);
  });

  it('applied when drawing: fills, sizes, hides; links coloured and dashed; the data unchanged', () => {
    const store = createGraphStore();
    store.replace({
      nodes: [{ id: 'a', risk: 'high' }, { id: 'b', risk: 'low' }, { id: 'c', hide: 'yes' }],
      edges: [{ id: 'e1', from: 'a', to: 'b', amount: 5000 }, { id: 'e2', from: 'b', to: 'c', amount: 1 }],
    });
    const view = { nodeIds: ['a', 'b', 'c'], edgeIds: store.graph().edges(), viewKey: 'v' };
    const formatting = {
      rules: [
        ...rules,
        rule({ id: 'gone', conditions: [{ key: 'hide', op: 'eq', value: 'yes' }], style: { hide: true } }),
        rule({ id: 'big', target: 'edge', conditions: [{ key: 'amount', op: 'gt', value: '1000' }], style: { color: '#0000ff', width: 4, lineStyle: 'dashed' } }),
      ],
    };
    const { nodes, edges } = buildElements(store, view, { formatting });
    const byId = Object.fromEntries([...nodes, ...edges].map((element) => [element.data.id, element.data]));
    expect(byId.a).toMatchObject({ fill: '#ff0000', diameter: 60, formatted: 'top low' });
    expect(byId.c.ruleHidden).toBe(1);
    const big = edges.find((edge) => edge.data.formatted === 'big').data;
    expect(big).toMatchObject({ color: '#0000ff', width: 4, lineStyle: 'dashed' });
    expect(store.getNode('a').color).toBeUndefined();
  });
});
