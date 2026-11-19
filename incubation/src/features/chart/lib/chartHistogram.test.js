import Graph from 'graphology';
import { describe, expect, it } from 'vitest';

import { histogramKeys, histogramLabel, histogramValues } from './chartHistogram.js';

const graph = () => {
  const g = new Graph({ multi: true, type: 'directed' });
  g.addNode('a', { label: 'Abebe', BANK: 'CBE', x: 1, color: '#f00' });
  g.addNode('b', { label: 'Bekele', BANK: 'Awash' });
  g.addEdgeWithKey('e1', 'a', 'b', { AMOUNT: 2500, rel_type: 'TRANSFER', width: 2, label: 'paid' });
  return g;
};

describe('chartHistogram', () => {
  it('properties: the type first, then plain properties (drawing keys left out)', () => {
    expect(histogramKeys(graph(), ['a', 'b'], ['e1'])).toEqual([
      { subject: 'edge', key: '@type', label: 'Type' },
      { subject: 'edge', key: 'AMOUNT', label: 'AMOUNT' },
      { subject: 'edge', key: 'rel_type', label: 'rel_type' },
      { subject: 'node', key: '@type', label: 'Type' },
      { subject: 'node', key: 'BANK', label: 'BANK' },
    ]);
  });

  it('values over the scope; the link type from its relationship', () => {
    expect(histogramValues(graph(), ['a', 'b'], ['e1'], { subject: 'edge', key: '@type' })).toEqual([['e1', 'TRANSFER']]);
    expect(histogramValues(graph(), ['a', 'b', 'gone'], [], { subject: 'node', key: 'BANK' })).toEqual([['a', 'CBE'], ['b', 'Awash']]);
    expect(histogramLabel({ subject: 'node', key: 'BANK' })).toBe('Entities · BANK');
  });
});
