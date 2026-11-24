// @vitest-environment jsdom
import { clearImmediate, setImmediate } from 'node:timers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A pretend card: how long each size's frames take (ms).
const card = { frameMs: {}, fail: 0, now: 0, nodes: 0, released: 0 };
vi.mock('./cytoscapeInstance.js', () => ({
  createGraph: ({ elements }) => {
    card.nodes = elements.filter((element) => element.group === 'nodes').length;
    if (card.nodes === card.fail) throw new Error('no context');
    return { fit() {}, zoom: () => 1, pan: () => ({ x: 0, y: 0 }), viewport() {} };
  },
  releaseGraph: (cy) => { if (cy) card.released += 1; card.nodes = 0; },
}));
const { runGpuBenchmark } = await import('./gpuBenchmarkRun.js');

let hidden = false;
beforeEach(() => {
  Object.assign(card, { frameMs: {}, fail: 0, now: 0, nodes: 0, released: 0 });
  hidden = false;
  localStorage.clear();
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  vi.spyOn(performance, 'now').mockImplementation(() => card.now);
  vi.stubGlobal('requestAnimationFrame', (callback) => setImmediate(() => {
    card.now += card.frameMs[card.nodes] || 1000 / 60;
    callback(card.now);
  }));
  vi.stubGlobal('cancelAnimationFrame', (id) => clearImmediate(id));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const run = (options = {}) => runGpuBenchmark({ container: document.createElement('div'), gpuName: 'Card', sizes: [1000, 2000, 5000], ...options });

describe('runGpuBenchmark', () => {
  it('measures each size and stops at the first too slow', async () => {
    card.frameMs = { 2000: 40, 5000: 100 };
    const seen = [];
    const result = await run({ sizes: [1000, 2000, 5000, 10000], onProgress: ({ nodes, phase }) => seen.push(`${nodes} ${phase}`) });
    expect(result.steps.map((step) => step.nodes)).toEqual([1000, 2000, 5000]);
    expect(Math.round(result.steps[0].fps)).toBe(60);
    expect(Math.round(result.steps[1].fps)).toBe(25);
    expect(result).toMatchObject({ outcome: 'ok', limit: 2000, warnAt: 1000, renderer: 'Card' });
    expect(seen).not.toContain('10000 building');
    expect(card.released).toBe(3);
    expect(localStorage.getItem('linkx.device.gpuBenchmark.running')).toBeNull();
  });

  it('a size that cannot be drawn ends the run with what worked', async () => {
    card.fail = 5000;
    expect(await run()).toMatchObject({ outcome: 'ok', limit: 2000 });
  });

  it('a hidden tab, a cancel and a throttled browser give no result', async () => {
    hidden = true;
    await expect(run()).rejects.toMatchObject({ reason: 'hidden' });
    hidden = false;
    const controller = new AbortController();
    await expect(run({ signal: controller.signal, onProgress: () => controller.abort('cancelled') })).rejects.toMatchObject({ reason: 'cancelled' });
    const away = new AbortController();
    await expect(run({ signal: away.signal, onProgress: ({ phase }) => { if (phase === 'measuring') away.abort('hidden'); } })).rejects.toMatchObject({ reason: 'hidden' });
    card.frameMs = { 0: 100 };
    await expect(run()).rejects.toMatchObject({ reason: 'throttled' });
    expect(localStorage.getItem('linkx.device.gpuBenchmark.running')).toBeNull();
  });
});
