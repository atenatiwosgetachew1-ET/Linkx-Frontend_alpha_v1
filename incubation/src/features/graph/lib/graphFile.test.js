import { describe, expect, it } from 'vitest';

import { createGraphStore } from './graphStore.js';
import { GRAPH_FILE_LIMITS, GraphFileError, buildGraphExport, parseGraphFile } from './graphFile.js';

const productionHtml = (data) => `<!DOCTYPE html>
<html><head><script src="https://unpkg.com/vis-network/standalone/umd/vis-network.min.js"></script></head>
<body><div id="mynetwork"></div><script>
  const { graphData, networkOptions } = ${JSON.stringify(data, null, 2)};
  const nodesData = new vis.DataSet(graphData.nodes);
</script></body></html>`;

describe('graph files (G4.1)', () => {
  it('reads production JSON exports and plain { nodes, edges }; HTML files are refused', () => {
    const graphData = { type: 'Graph', nodes: [{ id: 1, label: 'A' }, { id: 2 }], edges: [{ from: 1, to: 2 }] };
    expect(parseGraphFile('g.json', JSON.stringify({ graphData, networkOptions: {} }))).toMatchObject({
      nodes: [{ id: '1', label: 'A' }, { id: '2' }], edges: [{ from: '1', to: '2' }], positions: null,
    });
    expect(parseGraphFile('g.JSON', `\uFEFF${JSON.stringify({ nodes: graphData.nodes, edges: [] })}`).nodes).toHaveLength(2);
    expect(() => parseGraphFile('LinkxGraph_export_1.html', productionHtml({ graphData, networkOptions: {} }))).toThrow('Only .json graph files are allowed.');
  });

  it('cleans what a file holds: prototype and internal keys, bad ids, repeats, depth, long text', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { h: { i: 'too deep' } } } } } } } } };
    const text = `{"nodes": [
      {"id": "a", "label": "A", "__proto__": {"polluted": true}, "constructor": 1, "__customized": {"fill": true}, "deep": ${JSON.stringify(deep)}, "big": "${'x'.repeat(10)}"},
      {"id": "a", "label": "repeat"},
      {"id": {"no": 1}},
      {"id": "${'z'.repeat(GRAPH_FILE_LIMITS.idLength + 1)}"},
      {"id": 7, "members": [{"id": "m1", "__proto__": {"x": 1}, "label": "M"}]},
      "not an object"
    ], "edges": [
      {"from": "a", "to": 7, "__edits": {"color": "#ff0000"}, "__other": 1},
      {"from": "a"},
      {"from": ["a"], "to": "a"}
    ]}`;
    const { nodes, edges } = parseGraphFile('g.json', text);
    expect(nodes.map((node) => node.id)).toEqual(['a', '7']);
    expect(nodes[0].label).toBe('A');
    expect(Object.prototype.hasOwnProperty.call(nodes[0], '__proto__')).toBe(false);
    expect(nodes[0].constructor).toBe(Object); // the key was dropped, not kept
    expect(nodes[0].__customized).toBeUndefined();
    expect({}.polluted).toBeUndefined();
    expect(nodes[0].deep.a.b.c.d.e.f).toEqual({}); // g is past the depth limit
    expect(nodes[1].members).toEqual([{ id: 'm1', label: 'M' }]);
    expect(edges).toEqual([{ from: 'a', to: '7', __edits: { color: '#ff0000' } }]);
  });

  it('refuses files past the size limits', () => {
    const many = JSON.stringify({ nodes: Array.from({ length: GRAPH_FILE_LIMITS.nodes + 1 }, (_, i) => ({ id: i })), edges: [] });
    expect(() => parseGraphFile('g.json', many)).toThrow(/more than 100,000 nodes/);
  });

  it('keeps positions only when every node has one; drops nodes without an id and links without ends', () => {
    const placed = parseGraphFile('g.json', JSON.stringify({ nodes: [{ id: 'a', x: 1, y: 2 }, { id: 'b', x: '3', y: -4 }], edges: [{ from: 'a' }, { from: 'a', to: 'b' }] }));
    expect(placed.positions).toEqual([['a', { x: 1, y: 2 }], ['b', { x: 3, y: -4 }]]);
    // Coordinates past the limit: positions are not used.
    expect(parseGraphFile('g.json', JSON.stringify({ nodes: [{ id: 'a', x: 1e9, y: 0 }], edges: [] })).positions).toBeNull();
    expect(placed.edges).toHaveLength(1);
    const partly = parseGraphFile('g.json', JSON.stringify({ nodes: [{ id: 'a', x: 1, y: 2 }, { id: 'b' }, { label: 'no id' }], edges: [] }));
    expect(partly.positions).toBeNull();
    expect(partly.nodes).toHaveLength(2);
  });

  it('says why a file cannot be read (production messages)', () => {
    const reason = (name, text) => {
      try {
        parseGraphFile(name, text);
        return null;
      } catch (error) {
        expect(error).toBeInstanceOf(GraphFileError);
        return error.message;
      }
    };
    expect(reason('g.json', '{"foo": 1}')).toBe('This JSON file does not contain a valid graph.');
    expect(reason('g.json', '{oops')).toMatch(/could not be read/);
    expect(reason('g.html', '<html></html>')).toBe('Unsupported file type. Only .json graph files are allowed.');
    expect(reason('g.csv', 'a,b')).toBe('Unsupported file type. Only .json graph files are allowed.');
    expect(reason('g.json', '{"nodes": [], "edges": []}')).toBe('This file has no nodes.');
  });

  it('exports what is drawn, in production\'s shape, with positions; reads back the same', () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 'a', label: 'A', amount: 5 }, { id: 'b' }, { id: 'c' }], edges: [{ from: 'a', to: 'b', label: 'paid' }, { from: 'b', to: 'c' }] });
    store.setPositions([['a', { x: 10.123, y: -4 }], ['b', { x: 0, y: 0 }]]);
    const edgeKeys = store.graph().edges();
    const exported = buildGraphExport(store, { nodeIds: ['a', 'b'], edgeIds: [edgeKeys[0]] }, { limit: { max: 25 } });
    expect(exported.graphData.type).toBe('Graph');
    expect(exported.networkOptions).toEqual({});
    expect(exported.graphData.nodes).toEqual([
      expect.objectContaining({ id: 'a', label: 'A', amount: 5, x: 10.12, y: -4 }),
      expect.objectContaining({ id: 'b', x: 0, y: 0 }),
    ]);
    expect(exported.graphData.edges).toEqual([expect.objectContaining({ from: 'a', to: 'b', label: 'paid' })]);
    expect(exported.linkx).toMatchObject({ format: 1, settings: { limit: { max: 25 } } });
    const back = parseGraphFile('x.json', JSON.stringify(exported));
    expect(back.nodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(back.positions).toEqual([['a', { x: 10.12, y: -4 }], ['b', { x: 0, y: 0 }]]);
  });
});
