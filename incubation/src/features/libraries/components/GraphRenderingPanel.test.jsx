// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const capability = { current: { verdict: 'capable', reasons: ['GPU: Test GPU.'], checkedAt: '2026-11-14T10:00:00Z' } };
vi.mock('../../../shared/device/gpuCapability.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGpuCapability: vi.fn(() => capability.current),
}));

const { default: GraphRenderingPanel } = await import('./GraphRenderingPanel.jsx');
const { getGpuPreference, markGpuSuggested, resolveRenderer, setGpuPreference, shouldSuggestGpu } = await import('../../graph/lib/rendererPreference.js');

afterEach(() => {
  cleanup();
  localStorage.clear();
  capability.current = { verdict: 'capable', reasons: ['GPU: Test GPU.'], checkedAt: '2026-11-14T10:00:00Z' };
});

describe('Libraries → Graph rendering', () => {
  it('is off by default and turns GPU rendering on for this device', async () => {
    render(<GraphRenderingPanel configuration={{}} />);
    const toggle = screen.getByRole('switch', { name: /Use the GPU for graphs/ });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('standard drawing')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(getGpuPreference()).toBe(true);
    expect(resolveRenderer({})).toBe('webgl');
    expect(screen.getByText('the GPU')).toBeInTheDocument();
  });

  it('cannot be turned on when the device is not capable', () => {
    capability.current = { verdict: 'not_capable', reasons: ['Software renderer detected (SwiftShader).'] };
    render(<GraphRenderingPanel configuration={{}} />);
    expect(screen.getByRole('switch', { name: /Use the GPU for graphs/ })).toBeDisabled();
    expect(screen.getAllByText('This device cannot draw graphs with its GPU.').length).toBeGreaterThan(0);
    expect(screen.getByText('Software renderer detected (SwiftShader).')).toBeInTheDocument();
  });

  it('respects the system policy even when chosen on the device', () => {
    setGpuPreference(true);
    render(<GraphRenderingPanel configuration={{ graph_gpu_allowed: false }} />);
    expect(screen.getByRole('switch', { name: /Use the GPU for graphs/ })).toBeDisabled();
    expect(screen.getByText(/turned off for everyone by the system configuration/)).toBeInTheDocument();
    expect(resolveRenderer({ graph_gpu_allowed: false })).toBe('canvas');
  });
});

describe('one-time GPU suggestion', () => {
  it('is offered once per capable device while GPU rendering is off', () => {
    expect(shouldSuggestGpu({})).toBe(true);
    markGpuSuggested();
    expect(shouldSuggestGpu({})).toBe(false);
  });

  it('is not offered when GPU is on, forbidden or not capable', () => {
    setGpuPreference(true);
    expect(shouldSuggestGpu({})).toBe(false);
    setGpuPreference(false);
    expect(shouldSuggestGpu({ graph_gpu_allowed: false })).toBe(false);
    capability.current = { verdict: 'unknown', reasons: [] };
    expect(shouldSuggestGpu({})).toBe(false);
  });
});
