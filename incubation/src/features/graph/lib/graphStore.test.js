import { describe, expect, it } from 'vitest';

import { createGraphStore } from './graphStore.js';

describe('graphStore dataVersion', () => {
  it('moves with the data, not with a highlight (markers)', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e', from: 'a', to: 'b' }] });
    const first = store.getSnapshot();
    store.setMarkers('path', { nodes: ['a'], edges: ['e'] });
    const marked = store.getSnapshot();
    expect(marked.version).toBeGreaterThan(first.version);
    expect(marked.dataVersion).toBe(first.dataVersion);
    store.updateNodes([['a', { label: 'Abebe' }]]);
    expect(store.getSnapshot().dataVersion).toBeGreaterThan(marked.dataVersion);
  });

  it('stays for showing / hiding nodes (reveal, expand, hide, show) and the undo state', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ id: 'e', from: 'a', to: 'b' }, { id: 'f', from: 'b', to: 'c' }] });
    const start = store.getSnapshot();
    store.revealNodes(['c'], { viewKey: 'v', visibleIds: ['a', 'b'] });
    store.expandNode('b', { viewKey: 'v', visibleIds: ['a', 'b'] });
    store.hideNodes(['a'], { viewKey: 'v', visibleIds: ['a', 'b', 'c'] });
    store.showHidden('v');
    store.recordHistory({});
    const now = store.getSnapshot();
    expect(now.version).toBeGreaterThan(start.version);
    expect(now.dataVersion).toBe(start.dataVersion);
  });
});

describe('edits and the drawing limit', () => {
  const graphOf = (count) => ({ nodes: Array.from({ length: count }, (_, i) => ({ id: i + 1 })), edges: [] });
  const viewOf = (store, key, requested, cap) => {
    const plain = Math.min(requested, cap, store.editedCap(key) ?? cap);
    store.setDrawingCap(plain);
    return store.applyVisibility({ nodeIds: Array.from({ length: plain }, (_, i) => String(i + 1)), edgeIds: [], searched: false }, key, cap).nodeIds;
  };

  it('a higher limit keeps them exactly; a lower one draws fewer plain nodes, and they come back', () => {
    const store = createGraphStore();
    graphOf(40).nodes.forEach((node) => store.graph().addNode(String(node.id), node));
    expect(viewOf(store, 'v', 30, 10)).toHaveLength(10);
    store.hideNodes(['3'], { viewKey: 'v', visibleIds: viewOf(store, 'v', 30, 10) });
    store.revealNodes(['35'], { viewKey: 'v', visibleIds: viewOf(store, 'v', 30, 10), cap: 10 });
    const kept = viewOf(store, 'v', 30, 10);
    expect(kept).not.toContain('3');
    expect(kept).toContain('35');
    expect(viewOf(store, 'v', 30, 20)).toEqual(kept);
    const fewer = viewOf(store, 'v', 30, 4);
    expect(fewer).toHaveLength(4);
    expect(fewer).toContain('35');
    expect(viewOf(store, 'v', 30, 20)).toEqual(kept);
    // Without edits the new limit applies.
    expect(viewOf(store, 'other', 30, 20)).toHaveLength(20);
  });

  it('a lower limit made of added nodes only is still respected', () => {
    const store = createGraphStore();
    graphOf(40).nodes.forEach((node) => store.graph().addNode(String(node.id), node));
    store.restoreVisibility('v', ['1', '2'], Array.from({ length: 30 }, (_, i) => String(i + 5)), { cap: 30 });
    expect(store.applyVisibility({ nodeIds: ['1', '2'], edgeIds: [] }, 'v', 12).nodeIds).toHaveLength(12);
    expect(store.applyVisibility({ nodeIds: ['1', '2'], edgeIds: [] }, 'v', 30).nodeIds).toHaveLength(30);
  });
});
