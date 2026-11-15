import { describe, expect, it } from 'vitest';

import {
  brightenColor, buildNodeColor, clampEdgeWidth, darkenColor, edgeBoxValues, edgeColorPatch, edgeStylePatch, edgeWidthPatch,
  nodeBoxValues, nodeColorPatches, nodeIconPatch, nodeShapePatch,
} from './graphEditing.js';
import { toCyEdge } from './graphElements.js';

describe('adjust box colours (production GA:1807-2075)', () => {
  it('darkens and brightens per channel like production', () => {
    expect(darkenColor('#DC143C', 20)).toBe('#b01030');
    expect(brightenColor('#DC143C', 12)).toBe('#e03053');
    expect(darkenColor('ffffff', 0)).toBe('#ffffff');
  });

  it('builds production\'s node colour object', () => {
    expect(buildNodeColor('DC143C')).toEqual({
      background: '#DC143C',
      border: '#b01030',
      hover: { background: '#e03053', border: '#b01030' },
      highlight: { background: brightenColor('#DC143C', 18), border: '#b01030' },
      focus: { background: brightenColor('#DC143C', 25), border: darkenColor('#DC143C', 25) },
    });
  });

  it('colours the nodes; "link" behaviour adds neighbours and the edges among them', () => {
    const behavior = { a: 'link', b: 'individual' };
    const options = {
      behaviorOf: (id) => behavior[id],
      neighbours: (id) => ({ a: ['c'], b: ['d'] }[id] || []),
      edges: [['e1', 'a', 'c'], ['e2', 'b', 'd'], ['e3', 'a', 'b']],
    };
    const result = nodeColorPatches(['a', 'b'], '#00BFFF', options);
    expect(result.nodes.map(([id]) => id)).toEqual(['a', 'c', 'b']);
    expect(result.nodes[0][1]).toMatchObject({ baseColor: '#00BFFF', color: { background: '#00BFFF' } });
    expect(result.edges.map(([key]) => key)).toEqual(['e1', 'e3']);
    expect(result.edges[0][1]).toMatchObject({ color: { color: '#00BFFF' }, __edits: { color: '#00BFFF' } });
  });
});

describe('adjust box node patches', () => {
  it('reads the box values from a node', () => {
    expect(nodeBoxValues({ label: 'A', color: { background: '#123456' }, shape: 'circularImage', iconPath: 'x.svg' }))
      .toEqual({ label: 'A', note: '', color: '#123456', shape: 'dot', colorBehavior: 'individual', icon: 'x.svg' });
    expect(nodeBoxValues({ color: { background: 'rgba(0,0,0,0)' }, shape: 'star' })).toMatchObject({ color: '#000000', shape: 'dot' });
  });

  it('a circle keeps the node\'s icon (production UpdateNodeShape)', () => {
    expect(nodeShapePatch({ iconPath: 'i.svg', size: 22 }, 'dot')).toEqual({ shape: 'circularImage', size: 22, image: 'i.svg', imagePadding: 10, iconPath: 'i.svg' });
    expect(nodeShapePatch({}, 'diamond')).toEqual({ shape: 'diamond', size: 15, iconPath: null });
  });

  it('an icon makes a circular image', () => {
    expect(nodeIconPatch('../graph_icons/Bank.svg')).toEqual({ shape: 'circularImage', image: '../graph_icons/Bank.svg', imagePadding: 10, iconPath: '../graph_icons/Bank.svg' });
  });
});

describe('adjust box edge patches', () => {
  it('reads the box values from an edge', () => {
    expect(edgeBoxValues({ label: 'pays', color: { color: '#00ff00' }, edgeStyle: 'dotted', width: 3 }))
      .toEqual({ label: 'pays', color: '#00ff00', style: 'dotted', width: 3 });
    expect(edgeBoxValues({})).toEqual({ label: '', color: '#000000', style: 'solid', width: 1 });
  });

  it('style, colour and width use production\'s values; width stays 1-6', () => {
    expect(edgeStylePatch({}, 'dashdot')).toEqual({ dashes: [10, 4, 2, 4], edgeStyle: 'dashdot', __edits: { dashes: [10, 4, 2, 4] } });
    expect(edgeStylePatch({}, 'wavy')).toBeNull();
    expect(edgeColorPatch({ __edits: { width: 2 } }, '#abcdef')).toEqual({
      color: { color: '#abcdef', highlight: '#abcdef', hover: '#abcdef', inherit: false },
      baseColor: '#abcdef',
      __edits: { width: 2, color: '#abcdef' },
    });
    expect([clampEdgeWidth(0), clampEdgeWidth(9), clampEdgeWidth('4')]).toEqual([1, 6, 4]);
    expect(edgeWidthPatch({}, 12)).toMatchObject({ width: 6, __edits: { width: 6 } });
  });

  it('edits win over the semantic styling when drawn, and labels are drawn', () => {
    const semantic = { from: 'a', to: 'b', financial_flow: false, directed_display: false, label: 'Shared' };
    const plain = toCyEdge('k', semantic);
    expect(plain.data).toMatchObject({ lineStyle: 'dashed', label: 'Shared' });
    const edited = toCyEdge('k', { ...semantic, __edits: { dashes: false, width: 5, color: '#ff0000' } });
    expect(edited.data).toMatchObject({ lineStyle: 'solid', width: 5, color: '#ff0000' });
    expect(toCyEdge('k', { from: 'a', to: 'b' }).data.label).toBeUndefined();
  });
});

describe('edge bundling (production GA:4461 applyEdgeBundlingLite)', () => {
  const entries = [
    ['k3', { id: 'e3', from: 'a', to: 'b', label: 'PAYS' }],
    ['k1', { id: 'e1', from: 'b', to: 'a', label: 'PAYS' }],
    ['k2', { id: 'e2', from: 'a', to: 'b' }],
    ['t1', { id: 't1', from: 'a', to: 'b', edge_kind: 'theme_line', label: 'Theme' }],
    ['k9', { id: 'e9', from: 'b', to: 'c', label: 'CALLS' }],
  ];

  it('draws parallel edges (either direction) as the first by id, labelled with the count', async () => {
    const { bundleEdges } = await import('./graphElements.js');
    const { primary, hidden } = bundleEdges(entries, 2);
    expect([...primary.keys()]).toEqual(['k1']);
    expect(primary.get('k1')).toEqual({ label: 'PAYS x3', width: 3, color: '#4b5563' });
    expect([...hidden].sort()).toEqual(['k2', 'k3']);
  });

  it('theme lines bundle apart; a higher minimum leaves smaller groups alone', async () => {
    const { bundleEdges } = await import('./graphElements.js');
    expect(bundleEdges(entries, 4).primary.size).toBe(0);
    const twoThemes = bundleEdges([...entries, ['t2', { id: 't2', from: 'b', to: 'a', edge_kind: 'theme_line' }]], 2);
    expect(twoThemes.primary.get('t1').label).toBe('Theme x2');
  });

  it('buildElements hides the bundled edges only when bundling is on', async () => {
    const { buildElements } = await import('./graphElements.js');
    const { createGraphStore } = await import('./graphStore.js');
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 1, from: 'a', to: 'b', label: 'X' }, { id: 2, from: 'b', to: 'a', label: 'X' }] });
    const view = store.visibleView({ max: 10 });
    expect(buildElements(store, view).edges).toHaveLength(2);
    const bundled = buildElements(store, view, { edgeBundling: true }).edges;
    expect(bundled).toHaveLength(1);
    expect(bundled[0].data).toMatchObject({ label: 'X x2', color: '#4b5563' });
  });
});
