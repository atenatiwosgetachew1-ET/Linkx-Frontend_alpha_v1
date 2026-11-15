// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MAX_PINNED_EVIDENCE, PINNED_EVIDENCE_KEY, clearPinnedEvidence, edgeKeyForPinned, evidenceItems, getPinnedEvidence,
  pinEvidence, pinnedFitNodes, pinnedInGraph, resetPinnedEvidenceCache, subscribePinnedEvidence, unpinEvidence,
} from './pinnedEvidence.js';
import { createGraphStore } from './graphStore.js';

afterEach(() => {
  localStorage.clear();
  resetPinnedEvidenceCache();
});

const graphOf = () => {
  const store = createGraphStore();
  store.replace({
    nodes: [{ id: 1, label: 'One' }, { id: 2 }, { id: 3 }],
    edges: [{ id: 'e1', from: 1, to: 2, weight: 4 }, { from: 2, to: 3 }],
  });
  return store.graph();
};

describe('pinned evidence list (GA pushPinnedEvidenceItem / unpin / clear)', () => {
  it('pins newest first with a copy of the data, once each, and stores it under production\'s key', () => {
    const graph = graphOf();
    const listener = vi.fn();
    const unsubscribe = subscribePinnedEvidence(listener);
    expect(pinEvidence(evidenceItems(graph, { nodeIds: ['1', '2'] }))).toBe(2);
    expect(pinEvidence(evidenceItems(graph, { nodeIds: ['1'], edgeKeys: ['id:e1'] }))).toBe(1);
    const list = getPinnedEvidence();
    expect(list.map((item) => `${item.type}:${item.id}`)).toEqual(['edge:e1', 'node:2', 'node:1']);
    expect(list[2].data).toMatchObject({ id: '1', label: 'One' });
    expect(list[0].data).toMatchObject({ weight: 4 });
    expect(typeof list[0].pinnedAt).toBe('string');
    expect(JSON.parse(localStorage.getItem(PINNED_EVIDENCE_KEY))).toHaveLength(3);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('keeps at most 300, unpins and clears', () => {
    const many = Array.from({ length: MAX_PINNED_EVIDENCE + 5 }, (_, i) => ({ type: 'node', id: `n${i}` }));
    pinEvidence(many);
    expect(getPinnedEvidence()).toHaveLength(MAX_PINNED_EVIDENCE);
    expect(unpinEvidence([{ type: 'node', id: 'n304' }, { type: 'node', id: 'missing' }])).toBe(1);
    expect(clearPinnedEvidence()).toBe(MAX_PINNED_EVIDENCE - 1);
    expect(getPinnedEvidence()).toEqual([]);
  });

  it('reads production\'s stored list, dropping junk and duplicates', () => {
    localStorage.setItem(PINNED_EVIDENCE_KEY, JSON.stringify([
      { type: 'node', id: 7, data: {} }, { type: 'node', id: '7' }, { type: 'other', id: 1 }, null, { type: 'edge', id: 'e1' },
    ]));
    expect(getPinnedEvidence().map((item) => `${item.type}:${item.id}`)).toEqual(['node:7', 'edge:e1']);
  });

  it('maps stored ids onto a graph: backend edge ids and the window\'s own keys', () => {
    const graph = graphOf();
    const anonymous = graph.edges().find((key) => !key.startsWith('id:'));
    expect(edgeKeyForPinned(graph, 'e1')).toBe('id:e1');
    expect(edgeKeyForPinned(graph, anonymous)).toBe(anonymous);
    const items = [{ type: 'node', id: '3' }, { type: 'node', id: '99' }, { type: 'edge', id: 'e1' }];
    expect(pinnedInGraph(graph, items)).toEqual({ nodes: ['3'], edges: ['id:e1'] });
    expect(pinnedFitNodes(graph, items).sort()).toEqual(['1', '2', '3']);
  });
});
