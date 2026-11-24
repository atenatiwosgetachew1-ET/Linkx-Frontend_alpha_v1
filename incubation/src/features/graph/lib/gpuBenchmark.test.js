// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { benchmarkChanges, browserVersion, getGpuBenchmark, getGpuLimits, getUnfinishedBenchmark, limitsFromSteps, markBenchmarkRunning, clearBenchmarkRunning, saveGpuBenchmark, shouldPromptBenchmark } from './gpuBenchmark.js';
import { visibleCapFor } from './graphSettings.js';

const steps = (...fps) => [1000, 2000, 5000, 10000, 20000].slice(0, fps.length).map((nodes, i) => (fps[i] === null ? { nodes, error: 'x' } : { nodes, fps: fps[i] }));

beforeEach(() => localStorage.clear());

describe('limitsFromSteps', () => {
  it('the limit is the largest usable size, the warning the largest smooth one', () => {
    expect(limitsFromSteps(steps(60, 55, 33, 16, 8))).toEqual({ outcome: 'ok', limit: 10000, warnAt: 5000 });
    // The test PC of the November benchmark: 54-56, 30-39, 6-11.
    expect(limitsFromSteps(steps(55, 45, 34, 12))).toEqual({ outcome: 'ok', limit: 5000, warnAt: 5000 });
    expect(limitsFromSteps(steps(60, 60, 60, 60, 60))).toEqual({ outcome: 'ok', limit: 20000, warnAt: 20000 });
  });

  it('a 30-frame screen measured just under still counts as smooth', () => {
    expect(limitsFromSteps(steps(29.8, 29.7, 16)).warnAt).toBe(2000);
  });

  it('stops at the first size that failed or was too slow', () => {
    expect(limitsFromSteps(steps(60, 60, null)).limit).toBe(2000);
    expect(limitsFromSteps(steps(60, 10, 50)).outcome).toBe('unsuitable');
  });

  it('never goes under what standard drawing shows, or gives a limit to nothing measured', () => {
    expect(limitsFromSteps(steps(60, 14.9))).toEqual({ outcome: 'unsuitable', limit: 0, warnAt: 0 });
    expect(limitsFromSteps(steps(null)).outcome).toBe('failed');
    expect(limitsFromSteps([]).outcome).toBe('failed');
  });
});

describe('the saved result', () => {
  const ok = { version: 1, at: 'x', outcome: 'ok', limit: 10000, warnAt: 5000, steps: steps(60) };

  it('sets the GPU limit; a temporary one until then; never the standard one', () => {
    expect(getGpuLimits()).toMatchObject({ cap: 5000, measured: false });
    saveGpuBenchmark(ok);
    expect(getGpuLimits()).toEqual({ cap: 10000, warnAt: 5000, measured: true });
    expect(getGpuLimits()).toBe(getGpuLimits());
    expect(visibleCapFor('webgl', getGpuLimits())).toBe(10000);
    expect(visibleCapFor('canvas', getGpuLimits())).toBe(2000);
  });

  it('ignores a damaged or out-of-range one', () => {
    ['{', JSON.stringify({ ...ok, limit: 900000 }), JSON.stringify({ ...ok, limit: 10 }), JSON.stringify({ ...ok, steps: [null] })].forEach((text) => {
      localStorage.setItem('linkx.device.gpuBenchmark.v1', text);
      expect(getGpuBenchmark()).toBeNull();
    });
  });

  it('prompts once, and not when measured', () => {
    expect(shouldPromptBenchmark()).toBe(true);
    expect(shouldPromptBenchmark()).toBe(false);
    localStorage.clear();
    saveGpuBenchmark(ok);
    expect(shouldPromptBenchmark()).toBe(false);
  });

  it('says what changed, and does not compare a hidden card name', () => {
    expect(benchmarkChanges({ renderer: 'A', browser: 'Chrome 157' }, { renderer: 'A', browser: 'Chrome 157' })).toEqual([]);
    expect(benchmarkChanges({ renderer: 'A', browser: 'Chrome 157' }, { renderer: 'B', browser: 'Chrome 158' })).toHaveLength(2);
    expect(benchmarkChanges({ renderer: '', browser: '' }, { renderer: 'B', browser: 'Chrome 158' })).toEqual([]);
  });

  it('reads the browser version', () => {
    expect(browserVersion('Mozilla/5.0 AppleWebKit/537.36 Chrome/157.0.0.0 Safari/537.36')).toBe('Chrome 157');
    expect(browserVersion('Mozilla/5.0 AppleWebKit/537.36 Chrome/157.0.0.0 Safari/537.36 Edg/157.0.1')).toBe('Edge 157');
    expect(browserVersion('Mozilla/5.0 Gecko/20100101 Firefox/140.0')).toBe('Firefox 140');
    expect(browserVersion('Mozilla/5.0 AppleWebKit/605 Version/18.1 Safari/605')).toBe('Safari 18');
    expect(browserVersion('')).toBe('');
  });

  it('a run going on here is not an unfinished one', () => {
    markBenchmarkRunning(5000);
    expect(getUnfinishedBenchmark()).toBe(0);
    clearBenchmarkRunning();
    localStorage.setItem('linkx.device.gpuBenchmark.running', JSON.stringify({ at: Date.now(), nodes: 5000 }));
    expect(getUnfinishedBenchmark()).toBe(0); // may be running in another tab
    localStorage.setItem('linkx.device.gpuBenchmark.running', JSON.stringify({ at: Date.now() - 120000, nodes: 5000 }));
    expect(getUnfinishedBenchmark()).toBe(5000);
  });
});
