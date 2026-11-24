import cytoscape from 'cytoscape';

import { drawDashes, patchShaders } from './gpuEdgeDashes.js';

// Creating and releasing Cytoscape instances (GraphCanvas, offscreenSnapshot).
//
// Cytoscape 3.34 has two habits this works around, both at creation:
// - Its GPU mode asks for a WebGL context with no options, so on a computer
//   with two graphics cards the browser usually picks the slower one. The
//   faster one is asked for here (the GPU check asks for the same).
// - Once any graph has used GPU mode, every later standard graph also opens a
//   (never used) WebGL context, until the page is reloaded. Browsers drop the
//   oldest contexts past a limit, which would take a GPU graph down. A
//   standard graph gets a plain 2d layer there instead.

// GPU graphs also get their dashed links (gpuEdgeDashes.js).

export const GPU_CONTEXT_OPTIONS = Object.freeze({ powerPreference: 'high-performance' });

const isWebgl = (type) => type === 'webgl2' || type === 'webgl';

const loseContext = (gl) => {
  try {
    gl?.getExtension?.('WEBGL_lose_context')?.loseContext();
  } catch { /* already gone */ }
};

// Runs `create` (synchronous) with the two workarounds in place.
export const withGpuContexts = (gpu, create) => {
  const prototype = globalThis.HTMLCanvasElement?.prototype;
  const original = prototype?.getContext;
  if (!original) return create([]);
  const contexts = [];
  const undo = [];
  prototype.getContext = function getContext(type, ...rest) {
    if (!isWebgl(type)) return original.call(this, type, ...rest);
    if (!gpu) return original.call(this, '2d');
    const context = original.call(this, type, ...(rest.length ? rest : [GPU_CONTEXT_OPTIONS]));
    if (context) {
      contexts.push(context);
      undo.push(patchShaders(context));
    }
    return context;
  };
  try {
    return create(contexts);
  } finally {
    prototype.getContext = original;
    undo.forEach((stop) => stop());
  }
};

// `gpu`: draw with WebGL. Throws when the GPU context cannot be created,
// leaving nothing behind in the container.
export const createGraph = (options, { gpu = false } = {}) => withGpuContexts(gpu, (contexts) => {
  const { container } = options;
  const before = new Set(container ? container.children : []);
  try {
    const cy = cytoscape({ ...options, ...(gpu ? { renderer: { name: 'canvas', webgl: true } } : {}) });
    if (gpu) drawDashes(cy.renderer().drawing);
    return cy;
  } catch (error) {
    try {
      container?._cyreg?.cy?.destroy(); // the half-made instance
    } catch { /* it had nothing to take down */ }
    contexts.forEach(loseContext);
    [...(container?.children || [])].forEach((child) => { if (!before.has(child)) child.remove(); });
    throw error;
  }
});

// Destroys the instance and gives its GPU context back (Cytoscape's destroy()
// does not).
export const releaseGraph = (cy) => {
  if (!cy) return;
  const canvases = cy.container() ? [...cy.container().querySelectorAll('canvas')] : [];
  cy.destroy();
  // Returns the canvas's existing context of that type, or null for the 2d
  // layers, so nothing new is created.
  canvases.forEach((canvas) => loseContext(canvas.getContext('webgl2') || canvas.getContext('webgl')));
};
