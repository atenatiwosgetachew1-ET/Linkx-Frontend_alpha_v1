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
