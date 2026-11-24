// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GPU_STATUS, GPU_VERDICTS, decideGpuCapability, getGpuCapability, markGpuFailed, recheckGpuCapability, resetGpuCapability, subscribeGpuCapability } from './gpuCapability.js';

const good = { webgl2: true, renderer: 'ANGLE (NVIDIA GeForce RTX 3060)', deviceMemoryGb: 8, benchFrameMs: 2.1 };

describe('decideGpuCapability', () => {
  it('accepts a hardware GPU', () => {
    expect(decideGpuCapability(good)).toMatchObject({ verdict: GPU_VERDICTS.CAPABLE, status: GPU_STATUS.HARDWARE, cautions: [] });
  });

  it('tells missing WebGL2 and software drawing apart', () => {
    expect(decideGpuCapability({ webgl2: false }).status).toBe(GPU_STATUS.UNAVAILABLE);
    ['Google SwiftShader', 'llvmpipe (LLVM 15.0.7, 256 bits)', 'ANGLE (Microsoft Basic Render Driver)'].forEach((renderer) => {
      expect(decideGpuCapability({ ...good, renderer })).toMatchObject({ verdict: GPU_VERDICTS.NOT_CAPABLE, status: GPU_STATUS.SOFTWARE });
      expect(decideGpuCapability({ ...good, renderer, majorPerformanceCaveat: true }).status).toBe(GPU_STATUS.SOFTWARE);
    });
  });

  it('a refused hardware-only context is judged by what the normal one runs on', () => {
    expect(decideGpuCapability({ ...good, majorPerformanceCaveat: true })).toMatchObject({ verdict: GPU_VERDICTS.CAPABLE, status: GPU_STATUS.CAVEAT });
    expect(decideGpuCapability({ ...good, majorPerformanceCaveat: true }).cautions.length).toBe(1);
    expect(decideGpuCapability({ ...good, renderer: '', majorPerformanceCaveat: true })).toMatchObject({ verdict: GPU_VERDICTS.UNKNOWN, status: GPU_STATUS.UNCONFIRMED });
  });

  it('slow drawing or little memory only adds a caution', () => {
    [{ benchFrameMs: 40 }, { deviceMemoryGb: 2 }].forEach((weak) => {
      const result = decideGpuCapability({ ...good, ...weak });
      expect(result.verdict).toBe(GPU_VERDICTS.CAPABLE);
      expect(result.cautions.length).toBe(1);
    });
  });

  it('a draw test that did not finish rules it out', () => {
    expect(decideGpuCapability({ ...good, benchFrameMs: null, benchFailed: true })).toMatchObject({ verdict: GPU_VERDICTS.NOT_CAPABLE, status: GPU_STATUS.TEST_FAILED });
  });

  it('a hidden card name is said to be hidden', () => {
    ['', 'Mozilla', 'WebKit WebGL'].forEach((renderer) => {
      const result = decideGpuCapability({ ...good, renderer });
      expect(result.status).toBe(GPU_STATUS.UNNAMED);
      expect(result.reasons[0]).toMatch(/does not say which/);
    });
  });

  it('never claims there is no graphics card', () => {
    [{}, { ...good, renderer: 'SwiftShader' }, { ...good, benchFailed: true }, { ...good, renderer: '', majorPerformanceCaveat: true }].forEach((signals) => {
      expect(decideGpuCapability(signals).reasons.join(' ')).not.toMatch(/no (usable )?gpu|no graphics card/i);
    });
  });
});

describe('the current result', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    resetGpuCapability();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => vi.restoreAllMocks());

  it('ignores and removes the old permanent verdict', () => {
    localStorage.setItem('linkx.device.gpuCapability.v1', JSON.stringify({ verdict: 'capable' }));
    expect(getGpuCapability().status).toBe(GPU_STATUS.UNAVAILABLE);
    expect(localStorage.getItem('linkx.device.gpuCapability.v1')).toBeNull();
  });

  it('a failure is kept for the tab, keeps the last check time, and Check again clears it', () => {
    const first = getGpuCapability();
    const listener = vi.fn();
    const stop = subscribeGpuCapability(listener);
    markGpuFailed('lost');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getGpuCapability()).toMatchObject({ status: GPU_STATUS.GRAPH_FAILED, checkedAt: first.checkedAt });
    resetGpuCapability(); // a reload of the same tab
    expect(getGpuCapability().status).toBe(GPU_STATUS.GRAPH_FAILED);
    recheckGpuCapability();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(getGpuCapability().status).toBe(GPU_STATUS.UNAVAILABLE);
    stop();
  });

  it('an old result is checked again', () => {
    sessionStorage.setItem('linkx.device.gpuCapability.v2', JSON.stringify({ verdict: 'capable', status: 'hardware', checkedAt: '2020-01-01T00:00:00Z' }));
    expect(getGpuCapability().status).toBe(GPU_STATUS.UNAVAILABLE);
  });
});
