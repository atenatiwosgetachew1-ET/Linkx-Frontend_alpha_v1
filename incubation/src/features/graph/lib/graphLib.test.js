import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_GRAPH_SETTINGS,
  applyPerformancePolicy,
  fromProductionSettings,
  normalizeGraphSettings,
  normalizeLimitRange,
  toProductionSettings,
} from './graphSettings.js';
import { compareNodeValues, getNodeValue, nodeInfoProperties, normalizeGraphId, resolveEdgeStyle } from './graphModel.js';
import { clearGraphStores, createGraphStore, getGraphStore, hasGraphStore } from './graphStore.js';

// Production DEFAULT_GRAPH_IFRAME_SETTINGS (src/App.jsx:39).
const PROD_DEFAULTS = ['', '', { min: 0, max: 25 }, '', '', '', false, false, false, false, 'concentric', 'UD', 'directed', 'hop_distance', ''];

describe('graph settings', () => {
  it('maps production defaults both ways', () => {
    const typed = fromProductionSettings(PROD_DEFAULTS);
    expect(typed).toEqual(normalizeGraphSettings(DEFAULT_GRAPH_SETTINGS));
    expect(toProductionSettings(typed)).toEqual(['', 'asc', { min: 0, max: 25 }, '', '', '', false, false, false, false, 'concentric', 'UD', 'directed', 'hop_distance', '']);
  });

  it('reads a customised production array and its "default" layout alias', () => {
    const typed = fromProductionSettings(['amount', 'desc', { min: 10, max: 60 }, 'Source Node', 'name', 'default', 'true', true, false, true, 'default', 'LR', 'hubsize', 'by_key', 'branch']);
    expect(typed.limit).toEqual({ key: 'amount', sort: 'desc', min: 10, max: 60 });
    expect(typed.labels).toEqual({ group: 'Source Node', byKey: 'name' });
    expect(typed.edgeWeight).toBe('default');
    expect(typed.showTitles).toBe(true);
    expect(typed.physics).toBe(true);
    expect(typed.layout).toEqual({ type: 'concentric', direction: 'LR', sortMethod: 'hubsize', layerMode: 'by_key', layerKey: 'branch' });
  });

  it('normalises limit ranges like production', () => {
    expect(normalizeLimitRange({ min: 5, max: 2 })).toEqual({ min: 5, max: 6 });
    expect(normalizeLimitRange([3, 9])).toEqual({ min: 3, max: 9 });
    expect(normalizeLimitRange(40)).toEqual({ min: 0, max: 40 });
    expect(normalizeLimitRange({ max: 500000 }).max).toBe(100000);
  });

  it('applies performance mode and the 300-node policy', () => {
    expect(DEFAULT_GRAPH_SETTINGS.performance).toBe(true); // production: new windows start in performance mood
    const busy = { ...DEFAULT_GRAPH_SETTINGS, performance: false, showLabels: true, showTitles: true, physics: true, edgeWeight: 'default', layout: { ...DEFAULT_GRAPH_SETTINGS.layout, type: 'hierarchical' } };
    const forced = applyPerformancePolicy({ ...busy, performance: true }, 10);
    expect([forced.showLabels, forced.showTitles, forced.physics, forced.edgeWeight]).toEqual([false, false, false, '']);
    const large = applyPerformancePolicy(busy, 300);
    expect(large.physics).toBe(false);
    expect(large.layout.type).toBe('layered');
    expect(large.showLabels).toBe(true);
    expect(applyPerformancePolicy(busy, 299).layout.type).toBe('hierarchical');
  });
});

describe('graph model rules', () => {
  it('canonicalises ids like production normalizeGraphId', () => {
    expect(normalizeGraphId(12)).toBe('12');
    expect(normalizeGraphId(' 12 ')).toBe('12');
    expect(normalizeGraphId('012')).toBe('012');
    expect(normalizeGraphId('ACC-1')).toBe('ACC-1');
    expect(normalizeGraphId('')).toBeNull();
  });

  it('reads properties ignoring case and sorts like production', () => {
    expect(getNodeValue({ Amount: 5 }, 'amount')).toBe(5);
    const values = [10, '9', null, 'abc', 2];
    expect([...values].sort((a, b) => compareNodeValues(a, b, 'asc'))).toEqual([2, '9', 10, 'abc', null]);
    // Mixed text and numbers fall back to text order, so descending puts
    // 'abc' first: production's comparator does the same (GA:5480).
    expect([...values].sort((a, b) => compareNodeValues(a, b, 'desc'))).toEqual(['abc', 10, '9', 2, null]);
    expect([10, '9', 2].sort((a, b) => compareNodeValues(a, b, 'desc'))).toEqual([10, '9', 2]);
  });

  it('hides display-only keys from node infos', () => {
    expect(nodeInfoProperties({ id: 'a', label: '  ', color: '#fff', x: 1, account_no: '100' })).toEqual({ id: 'a', label: '', account_no: '100' });
  });

  it('styles edges: rule labels, then semantics (semantics win)', () => {
    expect(resolveEdgeStyle({ label: 'HUB_AND_SPOKE' })).toMatchObject({ arrow: false, dashes: [5, 5] });
    expect(resolveEdgeStyle({ label: 'FUND_FLOW' })).toMatchObject({ arrow: true, dashes: [5, 5] });
    expect(resolveEdgeStyle({ label: 'CIRCULAR_FLOW', weight: 3 })).toMatchObject({ arrow: true, dashes: false, width: 1.2 });
    expect(resolveEdgeStyle({ weight: 4 })).toMatchObject({ arrow: true, dashes: false, width: 4, semantic: null });
    expect(resolveEdgeStyle({ edge_semantic: 'NODE_FLAG' })).toMatchObject({ arrow: false, dashes: [2, 3], color: '#f39c12', semantic: 'node_flag' });
    expect(resolveEdgeStyle({ label: 'HUB_AND_SPOKE', financial_flow: true, directed_display: true })).toMatchObject({ arrow: true, dashes: false, semantic: 'observed_flow' });
    expect(resolveEdgeStyle({ financial_flow: false, directed_display: true })).toMatchObject({ dashes: [5, 5], semantic: 'temporal_sequence' });
    expect(resolveEdgeStyle({ financial_flow: false, directed_display: false }, { isCdr: true })).toMatchObject({ arrow: false, dashes: [8, 4], tooltip: expect.stringContaining('tower') });
  });
});

describe('graph store', () => {
  const sample = {
    nodes: [
      { id: 1, label: 'A', amount: 30 },
      { id: '2', label: 'B', amount: 10 },
      { id: 3, label: 'C' },
      { id: 4, label: 'D', amount: 20 },
    ],
    edges: [
      { from: 1, to: 2, label: 'FUND_FLOW' },
      { from: 1, to: 2, label: 'FUND_FLOW' }, // parallel, no id: both kept
      { id: 'e9', from: 2, to: 4 },
      { from: 4, to: 4, edge_semantic: 'NODE_FLAG' }, // self-loop badge
      { from: 1, to: 99 }, // unknown end
    ],
  };

  it('keeps parallel edges and self-loops, counts dangling edges, merges by id', () => {
    const store = createGraphStore();
    store.replace(sample);
    expect(store.getSnapshot()).toMatchObject({ nodes: 4, edges: 4, danglingEdges: 1 });
    store.mergeChunk({ nodes: [{ id: '1', label: 'A2' }], edges: [{ id: 'e9', from: 2, to: 4, weight: 3 }] });
    expect(store.getSnapshot().nodes).toBe(4);
    expect(store.getSnapshot().edges).toBe(4);
    expect(store.getNode('1').label).toBe('A2');
    expect(store.getEdge('id:e9').weight).toBe(3);
  });

  it('shows nodes in arrival order without a key, edges only between visible nodes', () => {
    const store = createGraphStore();
    store.replace(sample);
    const view = store.visibleView({ min: 0, max: 2 });
    expect(view.nodeIds).toEqual(['1', '2']);
    expect(view.edgeIds).toHaveLength(2); // the two parallel 1→2 edges
    expect(store.visibleView({ min: 2, max: 4 }).nodeIds).toEqual(['3', '4']);
  });

  it('sorts by a key, leaving out nodes without it (production)', () => {
    const store = createGraphStore();
    store.replace(sample);
    expect(store.visibleView({ key: 'Amount', sort: 'desc', min: 0, max: 10 }).nodeIds).toEqual(['1', '4', '2']);
    expect(store.visibleView({ key: 'amount', sort: 'asc', min: 1, max: 3 }).nodeIds).toEqual(['4', '1']);
  });

  it('lists property keys without display-only ones, and notifies subscribers', () => {
    const store = createGraphStore();
    const listener = vi.fn();
    store.subscribe(listener);
    store.replace({ nodes: [{ id: 1, label: 'A', color: '#fff', amount: 1, account_no: 'x' }] });
    expect(store.propertyKeys().sort()).toEqual(['account_no', 'amount', 'id']);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('keeps one store per window and forgets them all on sign-out', () => {
    expect(getGraphStore('graph-1')).toBe(getGraphStore('graph-1'));
    expect(getGraphStore('graph-1')).not.toBe(getGraphStore('graph-2'));
    clearGraphStores();
    expect(hasGraphStore('graph-1')).toBe(false);
  });
});
