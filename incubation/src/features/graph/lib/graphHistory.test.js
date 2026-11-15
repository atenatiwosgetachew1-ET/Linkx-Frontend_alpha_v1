import { describe, expect, it } from 'vitest';

import { HISTORY_ELEMENT_LIMIT, HISTORY_MAX, createGraphStore } from './graphStore.js';

const hub = (count) => ({
  nodes: Array.from({ length: count }, (_, i) => ({ id: i + 1 })),
  edges: Array.from({ length: count - 1 }, (_, i) => ({ from: 1, to: i + 2 })),
});
const view = (store, max = 5) => store.applyVisibility(store.visibleView({ min: 0, max }), 'k');

describe('undo / redo history (production GRAPH_HISTORY)', () => {
  it('undoes and redoes an expand, a style change and a path highlight', () => {
    const store = createGraphStore();
    store.replace(hub(20));
    expect(store.getSnapshot().history).toEqual({ canUndo: false, canRedo: false });

    store.recordHistory({ graphSettings: { limit: 5 } });
    store.expandNeighbourhood(['1'], { viewKey: 'k', visibleIds: view(store).nodeIds });
    expect(view(store).nodeIds).toHaveLength(20);
    store.recordHistory({ graphSettings: { limit: 6 } });
    store.patchNodes([['1', { size: 40, color: '#ff0000' }]]);
    store.setMarkers('path', { nodes: ['1', '2'], edges: [] });
    expect(store.getSnapshot().history).toEqual({ canUndo: true, canRedo: false });

    const first = store.undo({ graphSettings: { limit: 7 } });
    expect(first.context).toEqual({ graphSettings: { limit: 6 } });
    expect(store.getNode('1').size).toBeUndefined();
    expect(store.hasMarkers('path')).toBe(false);
    expect(store.hasNodePatches()).toBe(false);
    expect(view(store).nodeIds).toHaveLength(20);
    store.undo({ graphSettings: { limit: 6 } });
    expect(view(store).nodeIds).toHaveLength(5);
    expect(store.getSnapshot().history).toEqual({ canUndo: false, canRedo: true });
    expect(store.undo()).toBeNull();

    const back = store.redo({ graphSettings: { limit: 5 } });
    expect(back.context).toEqual({ graphSettings: { limit: 6 } });
    expect(view(store).nodeIds).toHaveLength(20);
    store.redo();
    expect(store.getNode('1')).toMatchObject({ size: 40, color: '#ff0000' });
    expect([...store.getMarkers().path.nodes]).toEqual(['1', '2']);
  });

  it('a new action clears redo; at most 50 steps; new data starts a new history', () => {
    const store = createGraphStore();
    store.replace(hub(5));
    for (let i = 0; i < HISTORY_MAX + 5; i += 1) {
      store.recordHistory({ step: i });
      store.patchNodes([['1', { size: i }]]);
    }
    let steps = 0;
    while (store.undo()) steps += 1;
    expect(steps).toBe(HISTORY_MAX);
    expect(store.getNode('1').size).toBe(4); // the oldest kept step
    store.recordHistory();
    expect(store.getSnapshot().history.canRedo).toBe(false);
    store.replace(hub(5));
    expect(store.getSnapshot().history).toEqual({ canUndo: false, canRedo: false });
  });

  it('snapshots are copies: later changes do not leak into history', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 1, meta: { tag: 'a' } }], edges: [] });
    store.recordHistory();
    store.patchNodes([['1', { meta: { tag: 'b' } }]]);
    store.getNode('1').meta.tag = 'mutated';
    store.undo();
    expect(store.getNode('1').meta).toEqual({ tag: 'a' });
  });

  it('is off above 4,500 nodes + edges', () => {
    const store = createGraphStore();
    store.replace(hub(Math.ceil(HISTORY_ELEMENT_LIMIT / 2) + 1));
    expect(store.historyAllowed()).toBe(false);
    expect(store.recordHistory()).toBe(false);
    expect(store.getSnapshot().history.canUndo).toBe(false);
  });
});
