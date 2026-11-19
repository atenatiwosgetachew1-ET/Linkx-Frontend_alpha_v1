import { describe, expect, it, vi } from 'vitest';

import { allPairsLinked, contextMenuItems, flattenMenuItems } from './graphContextMenu.js';
import { buildElements } from './graphElements.js';
import { createGraphStore, HIGHLIGHT_FLASH_MS } from './graphStore.js';
import { neighbourIndex, placeNear } from './layouts.js';

const labels = (menu) => flattenMenuItems(menu.items).map((entry) => entry.label);
const topLevel = (menu) => menu.items.map((entry) => entry.label);

describe('context menu items (production GB:2096)', () => {
  it('canvas: production order; Theme Line and Link Traversal need a selection', () => {
    const menu = contextMenuItems({ kind: 'canvas', selection: [] });
    expect(labels(menu).slice(0, 3)).toEqual(['Add Node', 'Label', 'Comment Box']);
    expect(labels(menu).at(-1)).toBe('Clear Pinned Evidence'); // grouped: Pinned Evidence is the last group
    expect(labels(menu)).not.toContain('Paste');
    expect(labels(menu)).not.toContain('Load View');
    expect(labels(contextMenuItems({ kind: 'canvas', hasClipboard: true, savedViewCount: 1 }))).toEqual(expect.arrayContaining(['Paste', 'Load View']));
  });

  it('one node: expand / collapse and the analysis tools available, the rest pending', () => {
    const menu = contextMenuItems({ kind: 'node', nodeId: 'Group_1', selection: ['Group_1'], nodeHasEdges: true });
    expect(labels(menu)).toEqual([
      'Expand Neighborhood', 'Collapse Neighborhood', 'Select Linked', 'Select Same Type', 'Hide Node', 'Copy', 'Delete Node', 'Ungroup', 'Unlink Node',
      'Bring to Front', 'Pin Evidence', 'Unpin Evidence', 'Link Traversal (5 degrees)', 'Cut Points',
    ]);
    const enabled = flattenMenuItems(menu.items).filter((entry) => entry.enabled).map((entry) => entry.label);
    expect(enabled).toEqual([
      'Expand Neighborhood', 'Collapse Neighborhood', 'Select Linked', 'Select Same Type', 'Hide Node', 'Copy', 'Delete Node', 'Ungroup', 'Unlink Node',
      'Bring to Front', 'Pin Evidence', 'Unpin Evidence', 'Link Traversal (5 degrees)', 'Cut Points',
    ]);
    // G3.5: every production item is ported; nothing is left pending.
    const canvasItems = flattenMenuItems(contextMenuItems({ kind: 'canvas', hasClipboard: true, savedViewCount: 1, selection: ['a', 'b'] }).items);
    expect(canvasItems.filter((entry) => entry.pending)).toEqual([]);
    expect(canvasItems.find((entry) => entry.action === 'toggle_edge_bundling').label).toBe('Enable Edge Bundling');
    expect(flattenMenuItems(contextMenuItems({ kind: 'canvas', edgeBundling: true }).items).find((entry) => entry.action === 'toggle_edge_bundling').label).toBe('Disable Edge Bundling');
    // Pin / Unpin follow what is already pinned.
    const pinnedOnly = flattenMenuItems(contextMenuItems({ kind: 'node', nodeId: 'a', selection: ['a'], canPin: false }).items);
    expect(pinnedOnly.find((entry) => entry.action === 'pin_evidence').enabled).toBe(false);
    expect(pinnedOnly.find((entry) => entry.action === 'unpin_evidence').enabled).toBe(true);
  });

  it('several nodes: link or unlink, shortest path only for two', () => {
    expect(labels(contextMenuItems({ kind: 'node', selection: ['a', 'b'] }))).toEqual(expect.arrayContaining(['Link Nodes', 'Find Shortest Path', 'Find All Paths']));
    const three = contextMenuItems({ kind: 'node', selection: ['a', 'b', 'c'], selectionFullyLinked: true, pathHighlighted: true });
    expect(labels(three)).toContain('Unlink Nodes');
    expect(labels(three)).not.toContain('Find Shortest Path');
    expect(labels(three).at(-1)).toBe('Clear Path Highlight');
  });

  it('groups into submenus so the menu stays short (production order kept inside)', () => {
    const canvas = contextMenuItems({ kind: 'canvas', hasClipboard: true });
    expect(topLevel(canvas)).toEqual(['Paste', 'Add', 'Select', 'Analyze', 'Open as', 'Views', 'Edge Bundling', 'Alert Rules', 'Pinned Evidence']);
    // The companion windows, twins, out of Analyze (not analysis).
    const openAs = canvas.items.find((entry) => entry.label === 'Open as');
    expect(openAs.items.map((entry) => entry.label)).toEqual(['Table', 'Chart']);
    expect(canvas.items.find((entry) => entry.label === 'Analyze').items.map((entry) => entry.label)).not.toContain('Show in Table');
    expect(canvas.items[1].items.map((entry) => entry.label)).toEqual(['Add Node', 'Label', 'Comment Box', 'Text Block', 'Event Frame', 'Theme Line', 'OLE Object']);
    // G3.1 / G3.3: everything under Add works; Theme Line needs two selected nodes.
    expect(canvas.items[1]).toMatchObject({ group: 'add', enabled: true });
    expect(canvas.items[1].items.filter((entry) => entry.enabled).map((entry) => entry.label)).toEqual(['Add Node', 'Label', 'Comment Box', 'Text Block', 'Event Frame', 'OLE Object']);
    const node = contextMenuItems({ kind: 'node', selection: ['a'], pathHighlighted: true });
    expect(topLevel(node)).toEqual(['Expand Neighborhood', 'Collapse Neighborhood', 'Select', 'Edit', 'Evidence', 'Analyze', 'Clear Path Highlight']);
    expect(topLevel(contextMenuItems({ kind: 'node', selection: ['a', 'b'] }))).toEqual(['Select', 'Edit', 'Paths', 'Evidence', 'Analyze']);
  });

  it('edge: the information block only', () => {
    const menu = contextMenuItems({ kind: 'edge', edge: { edge_semantic: 'transfer', financial_flow: true, reason: 'Fan-out' }, isCdr: true });
    expect(menu.items).toEqual([]);
    expect(menu.header.rows).toEqual([['Semantic', 'transfer'], ['Call Session Flow', 'Yes'], ['Directed Display', 'No'], ['Reason', 'Fan-out']]);
  });

  it('allPairsLinked: every pair, either direction', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'b' }, { from: 'c', to: 'b' }] });
    expect(allPairsLinked(store.graph(), ['a', 'b'])).toBe(true);
    expect(allPairsLinked(store.graph(), ['a', 'b', 'c'])).toBe(false);
  });
});

describe('expand / collapse (GA:3410, GA:3456, GA:5601)', () => {
  // hub 1 — 2..6; 6 — 7
  const make = () => {
    const store = createGraphStore();
    store.replace({
      nodes: [1, 2, 3, 4, 5, 6, 7].map((id) => ({ id })),
      edges: [2, 3, 4, 5, 6].map((to) => ({ from: 1, to })).concat({ from: 6, to: 7 }),
    });
    return store;
  };
  const viewOf = (store, key, max = 2) => store.applyVisibility(store.visibleView({ min: 0, max }), key);

  it('expand: seeds and neighbours become visible and are highlighted', () => {
    const store = make();
    const base = viewOf(store, 'k');
    expect(base.nodeIds).toEqual(['1', '2']);
    const result = store.expandNeighbourhood([1], { viewKey: 'k', visibleIds: base.nodeIds, depth: 1 });
    expect(result).toEqual({ added: 4, skipped: 0 });
    const view = viewOf(store, 'k');
    expect(view.nodeIds).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(view.edgeIds).toHaveLength(5);
    expect([...store.getMarkers().traversal.nodes].sort()).toEqual(['1', '2', '3', '4', '5', '6']);
    const elements = buildElements(store, view, {});
    expect(elements.nodes.find((node) => node.data.id === '3').data.marker).toBe('traversal');
    expect(elements.edges[0].data).toMatchObject({ marker: 'traversal', color: '#dc2626', width: 3.6 });
  });

  it('expand respects the drawing cap and reports what it skipped', () => {
    const store = make();
    const result = store.expandNeighbourhood([1], { viewKey: 'k', visibleIds: ['1', '2'], cap: 4 });
    expect(result).toEqual({ added: 2, skipped: 2 });
  });

  it('collapse hides visible neighbours, never the anchors', () => {
    const store = make();
    store.expandNeighbourhood([1], { viewKey: 'k', visibleIds: ['1', '2'] });
    const hidden = store.collapseNeighbourhood([6], { viewKey: 'k', visibleIds: viewOf(store, 'k').nodeIds });
    expect(hidden).toBe(1); // node 1 (7 is not visible)
    expect(viewOf(store, 'k').nodeIds).toEqual(['2', '3', '4', '5', '6']);
  });

  it('double-click: the first hidden neighbour only, past the limit', () => {
    const store = make();
    expect(store.expandNode(1, { viewKey: 'k', visibleIds: ['1', '2'] })).toBe('3');
    expect(viewOf(store, 'k').nodeIds).toEqual(['1', '2', '3']);
    expect(store.expandNode(2, { viewKey: 'k', visibleIds: ['1', '2', '3'] })).toBeNull();
  });

  it('edits are dropped when the view changes (production applyLimit)', () => {
    const store = make();
    store.expandNode(1, { viewKey: 'k', visibleIds: ['1', '2'] });
    expect(viewOf(store, 'other', 2).nodeIds).toEqual(['1', '2']);
  });
});

describe('expand / collapse highlight is a 1 s flash', () => {
  const make = () => {
    const store = createGraphStore();
    store.replace({ nodes: [1, 2, 3].map((id) => ({ id })), edges: [{ from: 1, to: 2 }, { from: 1, to: 3 }] });
    return store;
  };
  const marked = (store, key = 'k') => buildElements(store, store.applyVisibility(store.visibleView({ max: 3 }), key), {})
    .nodes.filter((node) => node.data.marker).map((node) => node.data.id);

  it('expand: highlighted, then back to normal after 1 s', () => {
    vi.useFakeTimers();
    try {
      const store = make();
      store.expandNeighbourhood([1], { viewKey: 'k', visibleIds: ['1'] });
      expect(marked(store)).toEqual(['1', '2', '3']);
      vi.advanceTimersByTime(HIGHLIGHT_FLASH_MS);
      expect(marked(store)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('collapse flashes the anchor; double-click flashes the shown neighbour', () => {
    vi.useFakeTimers();
    try {
      const store = make();
      store.collapseNeighbourhood([1], { viewKey: 'k', visibleIds: ['1', '2', '3'] });
      expect(store.hasMarkers('traversal', 'k')).toBe(true);
      expect([...store.getMarkers('k').traversal.nodes]).toEqual(['1']);
      store.expandNode(1, { viewKey: 'k', visibleIds: ['1'] });
      expect([...store.getMarkers('k').traversal.nodes]).toEqual(['2']);
      expect(store.getMarkers('k').traversal.edges.size).toBe(1);
      vi.advanceTimersByTime(HIGHLIGHT_FLASH_MS);
      expect(store.hasMarkers('traversal', 'k')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('nodes joining a drawn view (placeNear)', () => {
  it('keeps drawn nodes still and fans new ones around their neighbour', () => {
    const placed = { hub: { x: 100, y: 0 }, other: { x: -100, y: 0 } };
    const result = placeNear(['a', 'b', 'lonely'], placed, neighbourIndex([['hub', 'a'], ['hub', 'b']]));
    expect(Object.keys(result).sort()).toEqual(['a', 'b', 'lonely']);
    expect(Math.round(Math.hypot(result.a.x - 100, result.a.y))).toBe(120);
    expect(result.a.x).toBeGreaterThan(100); // away from the centre
    expect(Math.hypot(result.a.x - result.b.x, result.a.y - result.b.y)).toBeGreaterThan(44);
    expect(Math.hypot(result.lonely.x, result.lonely.y)).toBeGreaterThan(200);
  });
});
