import { describe, expect, it } from 'vitest';

import { createGraphStore } from './graphStore.js';

// Graph editing in the store (G3.1), after production's handlers.
const chain = () => {
  const store = createGraphStore();
  store.replace({
    nodes: [1, 2, 3, 4].map((id) => ({ id, label: `N${id}` })),
    edges: [{ from: 1, to: 2 }, { id: 'e9', from: 2, to: 3 }],
  });
  return store;
};

describe('graph editing (production GA:2777-3310)', () => {
  it('adds a node with production-style id, placed and shown past the limit', () => {
    const store = chain();
    const id = store.addNode((nodeId) => ({ label: `Node ${nodeId}` }), { position: { x: 5, y: 6 }, viewKey: 'v', visibleIds: ['1'] });
    expect(id).toMatch(/^node_\d+/);
    expect(store.getNode(id)).toMatchObject({ id, label: `Node ${id}` });
    expect(store.getPosition(id)).toEqual({ x: 5, y: 6 });
    const view = store.applyVisibility(store.visibleView({ max: 1 }), 'v');
    expect(view.nodeIds).toEqual(['1', id]);
    // A second node in the same millisecond gets a suffix.
    expect(store.addNode({}, {})).not.toBe(id);
  });

  it('deletes a node with its links, and forgets its position and selection', () => {
    const store = chain();
    store.setPositions([['2', { x: 1, y: 1 }]]);
    store.setSelection(['2', '3']);
    expect(store.removeNodes(['2', 'missing'])).toBe(1);
    expect(store.getNode('2')).toBeNull();
    expect(store.graph().size).toBe(0);
    expect(store.getPosition('2')).toBeNull();
    expect(store.getSnapshot().selection).toEqual(['3']);
  });

  it('links every unlinked pair once, with production\'s edge defaults; never a node to itself', () => {
    const store = chain();
    expect(store.linkNodes(['1', '2', '3'])).toBe(1); // 1-2 and 2-3 exist; 1-3 is new
    const graph = store.graph();
    const key = graph.edges('1', '3')[0];
    expect(key).toMatch(/^id:edge_\d+/);
    expect(graph.getEdgeAttributes(key)).toMatchObject({ from: '1', to: '3', label: '', width: 1, arrows: 'to', dashes: false });
    expect(store.linkNodes(['1', '2', '3'])).toBe(0);
    expect(store.addEdge('4', '4')).toBeNull();
  });

  it('unlinks one node (all its links) or a selection (links among it)', () => {
    const store = chain();
    expect(store.unlinkNodes(['1', '3'])).toBe(0); // not linked to each other
    expect(store.unlinkNodes(['2', '3'])).toBe(1);
    expect(store.graph().hasEdge('id:e9')).toBe(false);
    expect(store.unlinkNode('1')).toBe(1);
    expect(store.graph().size).toBe(0);
  });

  it('copies nodes with the links among them, and pastes them with new ids 20 apart', () => {
    const store = chain();
    store.setPositions([['1', { x: 10, y: 10 }]]);
    const clip = store.copyNodes(['1', '2', '4']);
    expect(clip.nodes.map((node) => node.id)).toEqual(['1', '2', '4']);
    expect(clip.nodes[0]).toMatchObject({ x: 10, y: 10 });
    expect(clip.edges).toHaveLength(1); // 1-2 only (2-3 leaves the selection)
    const pasted = store.pasteNodes(clip, { position: { x: 100, y: 50 }, viewKey: 'v', visibleIds: [] });
    expect(pasted).toHaveLength(3);
    expect(pasted.every((id) => /^node_/.test(id))).toBe(true);
    expect(pasted.map((id) => store.getPosition(id))).toEqual([{ x: 100, y: 50 }, { x: 120, y: 70 }, { x: 140, y: 90 }]);
    expect(store.getNode(pasted[0]).label).toBe('N1');
    expect(store.getNode(pasted[0]).x).toBeUndefined();
    const graph = store.graph();
    const [edge] = graph.edges(pasted[0], pasted[1]);
    expect(edge).toMatch(/^id:paste_edge_0_\d+/);
    expect(graph.size).toBe(3);
  });

  it('a pasted group node stays a group (production "Group" prefix)', () => {
    const store = createGraphStore();
    const [id] = store.pasteNodes({ nodes: [{ id: 'Group_7', label: 'G' }], edges: [] });
    expect(id).toMatch(/^Group_\d+/);
  });

  it('edits are undone and redone like any recorded action', () => {
    const store = chain();
    store.recordHistory(null);
    store.removeNodes(['1']);
    store.recordHistory(null);
    store.linkNodes(['3', '4']);
    expect(store.graph().order).toBe(3);
    store.undo(null);
    expect(store.graph().areNeighbors('3', '4')).toBe(false);
    store.undo(null);
    expect(store.getNode('1')).not.toBeNull();
    store.redo(null);
    expect(store.getNode('1')).toBeNull();
  });
});

describe('group / ungroup / merge (production GA:3311-3690)', () => {
  // 1-2, 2-3 (e9), plus 3-4 and 1-4.
  const square = () => {
    const store = chain();
    store.addEdge('3', '4', { id: 'e34' });
    store.addEdge('1', '4', { id: 'e14' });
    store.setPositions([['1', { x: 0, y: 0 }], ['2', { x: 10, y: 0 }], ['3', { x: 10, y: 10 }], ['4', { x: 0, y: 10 }]]);
    return store;
  };

  it('groups nodes into one "Group" node at their centre, keeping members and inner links', () => {
    const store = square();
    const id = store.groupNodes(['1', '2'], { viewKey: 'v', visibleIds: [] });
    expect(id).toMatch(/^Group \d+/);
    const group = store.getNode(id);
    expect(group).toMatchObject({ label: 'Group', size: 40, isGroup: true });
    expect(group.members.map((node) => node.id)).toEqual(['1', '2']);
    expect(group.members[1]).toMatchObject({ label: 'N2', x: 10, y: 0 });
    expect(group.edges).toHaveLength(1);
    expect(store.getPosition(id)).toEqual({ x: 5, y: 0 });
    expect(store.getNode('1')).toBeNull();
    // Links to the rest move to the group (production dropped them).
    const graph = store.graph();
    expect(graph.neighbors(id).sort()).toEqual(['3', '4']);
    expect(graph.getEdgeAttributes(graph.edges(id, '3')[0]).groupedEdge).toBe('id:e9');
  });

  it('ungroups: members back where they were (moved with the group), inner and outer links restored', () => {
    const store = square();
    const id = store.groupNodes(['1', '2'], {});
    store.setPositions([[id, { x: 105, y: 0 }]]); // dragged 100 to the right
    const restored = store.ungroupNode(id, {});
    expect(restored).toEqual(['1', '2']);
    expect(store.getNode(id)).toBeNull();
    expect(store.getPosition('2')).toEqual({ x: 110, y: 0 });
    const graph = store.graph();
    expect(graph.areNeighbors('1', '2')).toBe(true);
    expect(graph.hasEdge('id:e9')).toBe(true);
    expect(graph.hasEdge('id:e14')).toBe(true);
    expect(graph.size).toBe(4);
  });

  it('ungroup gives a member a new id when its own is taken; non-groups are left alone', () => {
    const store = square();
    const id = store.groupNodes(['1', '2'], {});
    store.addNode({ id: '1', label: 'other' }, {});
    const restored = store.ungroupNode(id, {});
    expect(restored[0]).toMatch(/^restored_/);
    expect(store.ungroupNode('3', {})).toEqual([]);
  });

  it('merges into the first node: centre, merged_from / count, prefixed properties, links moved', () => {
    const store = square();
    store.updateNodes([['2', { amount: 5, label: 'Two' }], ['4', { amount: 7, city: 'X' }]]);
    expect(store.mergeKeys(['2', '4'])).toEqual(['amount', 'city']);
    const kept = store.mergeNodes(['1', '2', '4'], { keys: ['amount'], prefix: 'm' });
    expect(kept).toBe('1');
    const node = store.getNode('1');
    expect(node).toMatchObject({ label: 'N1', merged_from: ['2', '4'], merge_count: 3, m_amount: 5, m_amount_2: 7 });
    expect(node.m_city).toBeUndefined();
    expect(store.getPosition('1')).toEqual({ x: 10 / 3, y: 10 / 3 });
    const graph = store.graph();
    expect(graph.order).toBe(2);
    // 2-3 and 4-3 now from 1; links among the merged nodes are gone.
    expect([...new Set(graph.edges('1', '3').concat(graph.edges('3', '1')))].sort()).toEqual(['id:e34', 'id:e9']);
    expect(graph.size).toBe(2);
  });
});

describe('hide / show hidden (G3.6)', () => {
  it('hides drawn nodes in the view and shows them again', () => {
    const store = chain();
    const base = store.visibleView({ max: 10 });
    expect(store.hideNodes(['2', 'x'], { viewKey: 'v', visibleIds: base.nodeIds })).toBe(1);
    expect(store.applyVisibility(store.visibleView({ max: 10 }), 'v').nodeIds).toEqual(['1', '3', '4']);
    expect(store.hiddenCount('v')).toBe(1);
    expect(store.hiddenCount('other')).toBe(0);
    expect(store.showHidden('v')).toBe(1);
    expect(store.applyVisibility(store.visibleView({ max: 10 }), 'v').nodeIds).toEqual(['1', '2', '3', '4']);
  });
});
