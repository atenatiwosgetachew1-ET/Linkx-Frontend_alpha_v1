import { describe, expect, it } from 'vitest';

import { GPU_VERDICTS, decideGpuCapability } from './gpuCapability.js';

const good = { webgl2: true, renderer: 'ANGLE (NVIDIA GeForce RTX 3060)', maxTextureSize: 16384, deviceMemoryGb: 8, benchFrameMs: 2.1 };

describe('decideGpuCapability', () => {
  it('accepts a hardware GPU', () => {
    expect(decideGpuCapability(good).verdict).toBe(GPU_VERDICTS.CAPABLE);
  });

  it('rejects missing WebGL2 and software fallbacks', () => {
    expect(decideGpuCapability({ webgl2: false }).verdict).toBe(GPU_VERDICTS.NOT_CAPABLE);
    expect(decideGpuCapability({ ...good, majorPerformanceCaveat: true }).verdict).toBe(GPU_VERDICTS.NOT_CAPABLE);
    expect(decideGpuCapability({ ...good, renderer: 'Google SwiftShader' }).verdict).toBe(GPU_VERDICTS.NOT_CAPABLE);
    expect(decideGpuCapability({ ...good, renderer: 'llvmpipe (LLVM 15.0.7, 256 bits)' }).verdict).toBe(GPU_VERDICTS.NOT_CAPABLE);
  });

  it('rejects weak devices', () => {
    expect(decideGpuCapability({ ...good, maxTextureSize: 2048 }).verdict).toBe(GPU_VERDICTS.NOT_CAPABLE);
    expect(decideGpuCapability({ ...good, deviceMemoryGb: 2 }).verdict).toBe(GPU_VERDICTS.NOT_CAPABLE);
    expect(decideGpuCapability({ ...good, benchFrameMs: 40 }).verdict).toBe(GPU_VERDICTS.NOT_CAPABLE);
  });

  it('is unknown when hardware WebGL works but nothing identifies the GPU', () => {
    expect(decideGpuCapability({ webgl2: true, maxTextureSize: 16384 }).verdict).toBe(GPU_VERDICTS.UNKNOWN);
  });
});
