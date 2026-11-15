import { describe, expect, it } from 'vitest';

import { MAX_GLYPHS, glyphImage, glyphLayout, nodeGlyphs } from './graphGlyphs.js';
import { buildElements } from './graphElements.js';
import { createGraphStore } from './graphStore.js';

describe('node badges (G3.6, after i2 glyphs)', () => {
  it('picks the badges a node carries, in order, at most four', () => {
    expect(nodeGlyphs({ note: 'seen', isGroup: true }, { alert: true, pinned: true, flagged: true })).toEqual(['alert', 'pinned', 'flag', 'note']);
    expect(MAX_GLYPHS).toBe(4);
    expect(nodeGlyphs({ merged_from: ['2'] })).toEqual(['merged']);
    expect(nodeGlyphs({ note: '  ' })).toEqual([]);
    expect(nodeGlyphs({ annotationType: 'comment_box', note: 'x' }, { alert: true })).toEqual([]);
  });

  it('lays them out leftwards from the top-right corner, one size on screen', () => {
    // Zoom 1: 14 px, but never more than 42 % of the node.
    expect(glyphLayout(40, 2, 1)).toEqual([{ x: 26, y: 0, size: 14, visible: true }, { x: 11, y: 0, size: 14, visible: true }]);
    expect(glyphLayout(30, 1, 1)[0].size).toBeCloseTo(12.6);
    // Zoomed in 4×: still 14 px on screen (3.5 graph units), not a huge cropped badge.
    const zoomedIn = glyphLayout(30, 1, 4)[0];
    expect(zoomedIn.size * 4).toBeCloseTo(14);
    expect(zoomedIn.x).toBeCloseTo(26.5);
    // Zoomed far out: too small to read, hidden.
    expect(glyphLayout(30, 1, 0.2)[0].visible).toBe(false);
  });

  it('draws each badge once per colour as an SVG image', () => {
    const uri = glyphImage('alert', '#e74c3c');
    expect(uri).toMatch(/^data:image\/svg\+xml;charset=UTF-8,/);
    expect(decodeURIComponent(uri)).toContain('fill="#e74c3c"');
    expect(glyphImage('alert', '#e74c3c')).toBe(uri);
  });

  it('buildElements adds them only when badges are on (alerts, pins and node flags from the view)', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 1 }, { id: 2, note: 'n' }], edges: [{ from: 1, to: 2, edge_semantic: 'NODE_FLAG' }] });
    store.setMarkers('pinned', { nodes: ['1'] });
    const view = store.visibleView({ max: 10 });
    expect(buildElements(store, view).nodes[0].data.glyphs).toBeUndefined();
    const nodes = buildElements(store, view, { glyphColors: { pinned: '#f59e0b', flag: '#f39c12', note: '#64748b' } }).nodes;
    expect(nodes[0].data.glyphKinds).toEqual(['pinned', 'flag']);
    expect(nodes[1].data.glyphKinds).toEqual(['flag', 'note']);
  });
});
