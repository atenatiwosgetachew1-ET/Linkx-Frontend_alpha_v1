// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createGraph, releaseGraph } from './cytoscapeInstance.js';
import { dashesOf, patchShader } from './gpuEdgeDashes.js';

// A WebGL stand-in that keeps the shaders Cytoscape compiles.
const compiled = [];
const makeGl = () => new Proxy({ shaderSource: (shader, source) => compiled.push(source) }, {
  get: (target, key) => {
    if (key in target) return target[key];
    if (typeof key === 'string' && /^[A-Z0-9_]+$/.test(key)) return key === 'FLOAT' ? 5126 : key === 'INT' ? 5124 : 16;
    if (key === 'checkFramebufferStatus') return () => 16;
    if (key === 'getParameter') return () => 16;
    if (key === 'getAttribLocation') return () => 0;
    return () => ({});
  },
});

let native;
let cy = null;
beforeEach(() => {
  compiled.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  native = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(type) {
    return type === '2d' ? new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true }) : makeGl();
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  cy = createGraph({
    container,
    layout: { name: 'preset' },
    style: [{ selector: 'edge', style: { 'curve-style': 'straight', 'line-style': 'data(style)', 'line-dash-pattern': 'data(dashes)' } }],
    elements: [
      { data: { id: 'a' }, position: { x: 0, y: 0 } },
      { data: { id: 'b' }, position: { x: 100, y: 0 } },
      { data: { id: 'solid', source: 'a', target: 'b', style: 'solid', dashes: [6, 3] } },
      { data: { id: 'dashed', source: 'a', target: 'b', style: 'dashed', dashes: [5, 5] } },
      { data: { id: 'flag', source: 'a', target: 'b', style: 'dotted', dashes: [2, 3] } },
    ],
  }, { gpu: true });
});
afterEach(() => {
  releaseGraph(cy);
  HTMLCanvasElement.prototype.getContext = native;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('dashed links in GPU mode', () => {
  it('this Cytoscape version’s shaders take the pattern; the picking one keeps whole links', () => {
    const screen = compiled.filter((source) => source.includes('in float vDashAt;'));
    const vertex = compiled.filter((source) => source.includes('out float vDashAt;'));
    const picking = compiled.filter((source) => source.includes('outColor = vIndex;'));
    expect(screen).toHaveLength(1);
    expect(vertex).toHaveLength(2);
    expect(picking).toHaveLength(1);
    expect(picking[0]).not.toContain('vDash');
  });

  it('refuses shaders it does not know rather than drawing dashed links solid', () => {
    expect(() => patchShader('in vec4 aPointAPointB; void main(void) {}')).toThrow(/dashed/);
    expect(patchShader('something else')).toBe('something else');
  });

  const matrixOf = (points, style, dashes) => {
    const { drawing } = cy.renderer();
    drawing.instanceCount = 0;
    const edge = {
      visible: () => true,
      pstyle: (name) => ({ 'line-style': { value: style }, 'line-dash-pattern': { pfValue: dashes }, opacity: { value: 1 }, 'line-opacity': { value: 1 }, width: { pfValue: 1 }, 'line-color': { value: [0, 0, 0] } }[name]),
      _private: { rscratch: { allpts: points } },
    };
    drawing.drawEdgeLine(edge, 1);
    const count = drawing.instanceCount;
    return Array.from({ length: count }, (_, i) => [...drawing.transformBuffer.getMatrixView(i)].slice(0, 5));
  };

  it('gives each link its pattern, and a curved one its distance along', () => {
    expect(matrixOf([0, 0, 100, 0], 'dashed', [5, 5])).toEqual([[5, 5, 0, 0, 0]]);
    expect(matrixOf([0, 0, 100, 0], 'dotted', [2, 3])).toEqual([[1, 1, 0, 0, 0]]);
    expect(matrixOf([0, 0, 100, 0], 'solid', [6, 3])).toEqual([[0, 0, 0, 0, 0]]);
    const curve = matrixOf([0, 0, 50, 60, 100, 0], 'dashed', [8, 4]);
    expect(curve).toHaveLength(15);
    curve.forEach((row, i) => {
      expect(row.slice(0, 2)).toEqual([8, 4]);
      if (i) expect(row[2]).toBeGreaterThan(curve[i - 1][2]);
    });
  });

  it('keeps dash-dot, and never makes a pattern of nothing', () => {
    expect(dashesOf('dashed', [10, 4, 2, 4])).toEqual([10, 4, 2, 4]);
    expect(dashesOf('dashed', [7])).toEqual([7, 7, 0, 0]);
    [[0, 0], [], ['x'], [-1, 2]].forEach((bad) => expect(dashesOf('dashed', bad)).toEqual([0, 0, 0, 0]));
  });
});
