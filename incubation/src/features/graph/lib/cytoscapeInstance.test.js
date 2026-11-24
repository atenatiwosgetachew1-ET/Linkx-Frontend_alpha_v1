// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GPU_CONTEXT_OPTIONS, createGraph, releaseGraph, withGpuContexts } from './cytoscapeInstance.js';

const calls = [];
let native;

beforeEach(() => {
  calls.length = 0;
  native = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(type, options) {
    calls.push([type, options]);
    return { type };
  };
});
afterEach(() => {
  HTMLCanvasElement.prototype.getContext = native;
  vi.restoreAllMocks();
});

describe('withGpuContexts', () => {
  it('GPU graphs ask for the faster card', () => {
    withGpuContexts(true, () => document.createElement('canvas').getContext('webgl2'));
    expect(calls).toEqual([['webgl2', GPU_CONTEXT_OPTIONS]]);
  });

  it('standard graphs never open a WebGL context', () => {
    const context = withGpuContexts(false, () => document.createElement('canvas').getContext('webgl2'));
    expect(context.type).toBe('2d');
    expect(calls.map(([type]) => type)).toEqual(['2d']);
  });

  it('puts getContext back, also after an error', () => {
    const before = HTMLCanvasElement.prototype.getContext;
    expect(() => withGpuContexts(true, () => { throw new Error('x'); })).toThrow('x');
    expect(HTMLCanvasElement.prototype.getContext).toBe(before);
  });
});

describe('createGraph', () => {
  it('a standard graph made after a failed GPU one opens no WebGL context, and the failure leaves nothing behind', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // No WebGL here: Cytoscape's GPU mode throws.
    HTMLCanvasElement.prototype.getContext = function getContext(type) {
      calls.push([type]);
      return type === '2d' ? new Proxy({}, { get: () => () => ({ width: 0 }), set: () => true }) : null;
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    expect(() => createGraph({ container, layout: { name: 'preset' } }, { gpu: true })).toThrow();
    expect(container.children.length).toBe(0);
    expect(calls.some(([type]) => type === 'webgl2')).toBe(true);
    calls.length = 0;
    const cy = createGraph({ container, layout: { name: 'preset' } });
    expect(container.querySelectorAll('canvas').length).toBe(4); // Cytoscape's leftover 4th layer
    expect(calls.every(([type]) => type === '2d')).toBe(true);
    releaseGraph(cy);
    container.remove();
  });
});
