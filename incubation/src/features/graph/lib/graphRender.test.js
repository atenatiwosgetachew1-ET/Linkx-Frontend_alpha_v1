import { describe, expect, it } from 'vitest';

import { buildElements, edgeCurveFor, isDefaultEdgeColor, isDefaultNodeColor, toCyEdge, toCyNode, zoomedWidths } from './graphElements.js';
import { recolorSvgForDarkMode, resolveIconUrl } from './graphIcons.js';
import { semanticLegend } from './graphModel.js';
import { concentricLayout, layoutRadius, neighbourIndex } from './layouts.js';
import { createGraphStore } from './graphStore.js';
import { RENDERERS, decideRenderer, isGpuAllowedBySystem } from './rendererPreference.js';

describe('graph elements (production payload -> Cytoscape)', () => {
  it('treats production default colours as theme colours, keeps real ones', () => {
    expect(isDefaultNodeColor(undefined)).toBe(true);
    expect(isDefaultNodeColor('#FFFFFF')).toBe(true);
    expect(isDefaultNodeColor({ background: 'rgba(0,0,0,0)', border: '#555' })).toBe(true);
    expect(isDefaultNodeColor({ background: '#e11d48', border: '#555' })).toBe(false);
    expect(isDefaultEdgeColor('rgba(0, 0, 0, 1)')).toBe(true);
    expect(isDefaultEdgeColor({ color: '#2563eb' })).toBe(false);
  });

  it('maps shape, size, colours and labels like vis-network', () => {
    const node = toCyNode('7', { shape: 'box', size: 20, color: { background: '#16a34a', border: '#14532d' }, label: 'ACC-7' });
    expect(node.data).toMatchObject({ id: '7', shape: 'round-rectangle', diameter: 40, fill: '#16a34a', border: '#14532d', label: '' });
    expect(toCyNode('7', { label: 'ACC-7' }, { showLabels: true }).data).toMatchObject({ shape: 'ellipse', diameter: 30, label: 'ACC-7' });
    expect(toCyNode('7', { color: '#fff' }).data.fill).toBeUndefined();
  });

  it('resolves production icon forms to this app\'s graph_icons and drops outside URLs', () => {
    expect(resolveIconUrl('../graph_icons/Person.svg')).toBe('/graph_icons/Person.svg');
    expect(resolveIconUrl('graph_icons/Bank Account.svg')).toBe('/graph_icons/Bank%20Account.svg');
    expect(resolveIconUrl('Person Male.svg')).toBe('/graph_icons/Person%20Male.svg');
    expect(resolveIconUrl('Office')).toBe('/graph_icons/Office.svg');
    expect(resolveIconUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(resolveIconUrl('https://tracker.example/pixel.png')).toBe('');
    expect(resolveIconUrl('//evil.example/x.png')).toBe('');
    expect(resolveIconUrl('javascript:alert(1)')).toBe('');
  });

  it('draws circularImage icons inside the circle with production padding', () => {
    const node = toCyNode('1', { shape: 'circularImage', iconPath: '../graph_icons/Person.svg', size: 25, color: { background: '#4A90D9', border: '#2C6FAC' } });
    expect(node.data).toMatchObject({ image: '/graph_icons/Person.svg', imageSize: '60%', fill: '#4A90D9', border: '#2C6FAC', diameter: 50 });
    expect(toCyNode('2', { shape: 'image', image: 'Bank.svg' }).data).toMatchObject({ imageSize: '100%', imageOnly: 1 });
  });

  it('recolours built-in icons white for dark mode (production)', () => {
    expect(recolorSvgForDarkMode('<svg viewBox="0 0 1 1"><path d="M0"/></svg>')).toContain('fill:#ffffff');
  });

  it('maps edge semantics to line style, dash pattern and arrows', () => {
    expect(toCyEdge('e1', { from: 'a', to: 'b', edge_semantic: 'NODE_FLAG' }).data).toMatchObject({ lineStyle: 'dotted', dashPattern: [2, 3], arrow: 'none', color: '#f39c12' });
    expect(toCyEdge('e2', { from: 'a', to: 'b', financial_flow: false, directed_display: false }).data).toMatchObject({ lineStyle: 'dashed', dashPattern: [8, 4], arrow: 'none' });
    expect(toCyEdge('e3', { from: 'a', to: 'b', color: 'rgba(0,0,0,1)' }).data).toMatchObject({ lineStyle: 'solid', arrow: 'triangle' });
    expect(toCyEdge('e3', { from: 'a', to: 'b', color: 'rgba(0,0,0,1)' }).data.color).toBeUndefined();
    expect(toCyEdge('e4', { from: 'a', to: 'b', color: '#2563eb', weight: 40 }).data).toMatchObject({ color: '#2563eb', width: 12 });
  });

  it('builds the visible view with stored positions', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 1 }, { id: 2 }], edges: [{ from: 1, to: 2 }] });
    store.setPositions([['1', { x: 5, y: 6 }]]);
    const { nodes, edges } = buildElements(store, store.visibleView({}));
    expect(nodes[0].position).toEqual({ x: 5, y: 6 });
    expect(nodes[1].position).toBeUndefined();
    expect(edges[0].data).toMatchObject({ source: '1', target: '2' });
  });

  it('keeps vis-network on-screen widths at any zoom (crisp borders far out)', () => {
    const node = { data: (key) => ({ diameter: 30 }[key]) };
    const edge = { data: (key) => ({ width: 1 }[key]) };
    const far = zoomedWidths(0.25);
    expect(far.border(node) * 0.25).toBeCloseTo(1.3); // 1.3 px on screen
    expect(far.borderSelected(node) * 0.25).toBeCloseTo(2);
    expect(far.edge(edge) * 0.25).toBeCloseTo(0.3); // 1 × 0.25 = 0.25 px is below the 0.3 px minimum
    expect(zoomedWidths(0.5).edge(edge) * 0.5).toBeCloseTo(0.5); // above the minimum: scales with the graph
    expect(zoomedWidths(0.01).edge(edge) * 0.01).toBeCloseTo(0.3); // never thinner than 0.3 px
    expect(zoomedWidths(0.01).border(node)).toBe(30); // never wider than the node
    expect(zoomedWidths(2).border(node)).toBeCloseTo(0.65);
  });

  it('uses bezier edges (parallel edges apart) up to the canvas comfort limit', () => {
    expect(edgeCurveFor(300)).toBe('bezier');
    expect(edgeCurveFor(301)).toBe('straight');
  });
});

describe('concentric layout (production default)', () => {
  it('puts the best-connected node in the centre and fills rings of max(6, ring × 10)', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
    const pairs = ids.slice(1).map((id) => ['n5', id]); // n5 is the hub
    const positions = concentricLayout(ids, neighbourIndex(pairs));
    expect(positions.n5).toEqual({ x: 0, y: 0 });
    const gap = Math.max(90, Math.min(220, Math.round(layoutRadius(20, 180, 2, 320))));
    const radii = ids.filter((id) => id !== 'n5').map((id) => Math.round(Math.hypot(positions[id].x, positions[id].y)));
    expect(radii.filter((r) => r === gap)).toHaveLength(10); // ring 1: 10 nodes
    expect(radii.filter((r) => r === gap * 2)).toHaveLength(9); // ring 2: the rest
  });

  it('counts distinct neighbours and ignores self-loops', () => {
    const index = neighbourIndex([['a', 'b'], ['a', 'b'], ['a', 'a']]);
    expect([...index.get('a')]).toEqual(['b']);
  });
});

describe('renderer choice (GPU off by default)', () => {
  it('uses WebGL only when allowed, chosen and capable', () => {
    expect(decideRenderer({ allowedBySystem: true, preferGpu: true, verdict: 'capable' })).toBe(RENDERERS.WEBGL);
    expect(decideRenderer({ allowedBySystem: true, preferGpu: false, verdict: 'capable' })).toBe(RENDERERS.CANVAS);
    expect(decideRenderer({ allowedBySystem: false, preferGpu: true, verdict: 'capable' })).toBe(RENDERERS.CANVAS);
    expect(decideRenderer({ allowedBySystem: true, preferGpu: true, verdict: 'unknown' })).toBe(RENDERERS.CANVAS);
  });

  it('reads the system policy from the configuration', () => {
    expect(isGpuAllowedBySystem({})).toBe(true);
    expect(isGpuAllowedBySystem({ graph_gpu_allowed: false })).toBe(false);
    expect(isGpuAllowedBySystem({ graph_gpu_allowed: 'false' })).toBe(false);
  });
});

describe('semantic legend wording (graphs_basic.html updateGraphDomainTerminology)', () => {
  it('words the four entries for NBE and CDR as production', () => {
    expect(semanticLegend(false).map((entry) => entry.text)).toEqual([
      'Observed financial transfer', 'Time-ordered sequence (not a transfer)', 'Analytical grouping (shared property)', 'Node flag (property of transaction)',
    ]);
    expect(semanticLegend(true).map((entry) => entry.text)).toEqual([
      'Observed call / communication session', 'Time-ordered call sequence', 'Analytical grouping (shared tower / device)', 'Node flag (property of call record)',
    ]);
  });
});
