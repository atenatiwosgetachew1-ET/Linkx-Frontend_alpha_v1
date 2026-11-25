// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

const capability = { current: { verdict: 'capable', status: 'hardware', reasons: ['The browser draws with: Test GPU.'], cautions: [], checkedAt: '2026-11-14T10:00:00Z' } };
vi.mock('../../../shared/device/gpuCapability.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getGpuCapability: vi.fn(() => capability.current),
}));

const bench = vi.hoisted(() => ({ run: null }));
vi.mock('../../graph/lib/gpuBenchmarkRun.js', () => ({ runGpuBenchmark: (...args) => bench.run(...args) }));
const okResult = { version: 1, at: '2026-11-24T10:00:00Z', renderer: 'Test GPU', browser: '', outcome: 'ok', limit: 5000, warnAt: 2000, steps: [{ nodes: 1000, fps: 60 }, { nodes: 2000, fps: 40 }, { nodes: 5000, fps: 20 }, { nodes: 10000, fps: 8 }] };

const { saveGpuBenchmark, getGpuBenchmark, getGpuLimits } = await import('../../graph/lib/gpuBenchmark.js');
const { default: GraphRenderingPanel } = await import('./GraphRenderingPanel.jsx');
const { markGpuFailed } = await import('../../../shared/device/gpuCapability.js');
const { getGpuPreference, markGpuSuggested, resolveRenderer, setGpuPreference, shouldSuggestGpu } = await import('../../graph/lib/rendererPreference.js');

afterEach(() => {
  cleanup();
  localStorage.clear();
  capability.current = { verdict: 'capable', status: 'hardware', reasons: ['The browser draws with: Test GPU.'], cautions: [], checkedAt: '2026-11-14T10:00:00Z' };
});

describe('Libraries → Graph rendering', () => {
  it('is off by default and, once benchmarked, turns GPU rendering on for this device', async () => {
    saveGpuBenchmark(okResult);
    render(<GraphRenderingPanel configuration={{}} />);
    const toggle = screen.getByRole('switch', { name: /Use the GPU for graphs/ });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText('standard drawing')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(getGpuPreference()).toBe(true);
    expect(resolveRenderer({})).toBe('webgl');
    expect(screen.getByText('the GPU')).toBeInTheDocument();
  });

  it('turning it on needs the benchmark: off until it ends, then on with its limit', async () => {
    let finish;
    bench.run = vi.fn(({ onProgress }) => {
      onProgress({ nodes: 1000, phase: 'measured', step: { nodes: 1000, fps: 60 } });
      return new Promise((resolve) => { finish = resolve; });
    });
    render(<GraphRenderingPanel configuration={{}} />);
    await userEvent.click(screen.getByRole('switch', { name: /Use the GPU for graphs/ }));
    const page = screen.getByRole('dialog', { name: 'GPU benchmark' });
    await userEvent.click(within(page).getByRole('button', { name: 'Start benchmark' }));
    expect(await within(page).findByText('60 frames a second')).toBeInTheDocument();
    expect(getGpuPreference()).toBe(false);
    await act(async () => finish(okResult));
    expect(within(page).getByText('GPU drawing is now on.')).toBeInTheDocument();
    expect(getGpuPreference()).toBe(true);
    expect(getGpuLimits()).toEqual({ cap: 5000, warnAt: 2000, measured: true });
    await userEvent.click(within(page).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText(/Up to 5,000 nodes; may be slow above 2,000/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run again' })).toBeEnabled();
  });

  it('cancelling leaves it off and keeps the last result', async () => {
    saveGpuBenchmark({ ...okResult, outcome: 'unsuitable', limit: 0, warnAt: 0 });
    bench.run = vi.fn(({ signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error(), { reason: 'cancelled' })));
    }));
    render(<GraphRenderingPanel configuration={{}} />);
    await userEvent.click(screen.getByRole('switch', { name: /Use the GPU for graphs/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Start benchmark' }));
    await waitFor(() => expect(bench.run).toHaveBeenCalled());
    await userEvent.keyboard('{Escape}');
    expect(await screen.findByText(/was cancelled. Nothing was changed/)).toBeInTheDocument();
    expect(getGpuPreference()).toBe(false);
    expect(getGpuBenchmark().outcome).toBe('unsuitable');
  });

  it('a run whose 2,000 nodes are too slow turns GPU drawing off; a failed one changes nothing', async () => {
    saveGpuBenchmark(okResult);
    setGpuPreference(true);
    render(<GraphRenderingPanel configuration={{}} />);
    bench.run = vi.fn(async () => ({ ...okResult, outcome: 'failed', limit: 0, steps: [{ nodes: 1000, error: 'x' }] }));
    await userEvent.click(screen.getByRole('button', { name: 'Run again' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start benchmark' }));
    expect(await screen.findByText(/nothing was changed/)).toBeInTheDocument();
    expect(getGpuBenchmark().limit).toBe(5000);
    expect(getGpuPreference()).toBe(true);
    bench.run = vi.fn(async () => ({ ...okResult, outcome: 'unsuitable', limit: 0, warnAt: 0, steps: [{ nodes: 1000, fps: 10 }] }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Run again' }));
    expect(await screen.findByText('Standard drawing suits this computer better')).toBeInTheDocument();
    expect(getGpuPreference()).toBe(false);
  });

  it('already on without a benchmark: a temporary limit, and the prompt to run it', () => {
    setGpuPreference(true);
    render(<GraphRenderingPanel configuration={{}} />);
    expect(screen.getByText(/temporary limit of 5,000 nodes/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Run benchmark' })).toBeEnabled();
  });

  it('marks a result from another card, and a run that never finished', () => {
    saveGpuBenchmark(okResult);
    localStorage.setItem('linkx.device.gpuBenchmark.running', JSON.stringify({ at: Date.now() - 600000, nodes: 10000 }));
    capability.current = { ...capability.current, signals: { renderer: 'Other GPU' } };
    render(<GraphRenderingPanel configuration={{}} />);
    expect(screen.getByText(/may be out of date: the graphics card in use changed/)).toBeInTheDocument();
    expect(screen.getByText(/did not finish: the browser stopped at 10,000 nodes/)).toBeInTheDocument();
  });

  it('Copy details: what support needs, as text', async () => {
    const user = userEvent.setup();
    saveGpuBenchmark(okResult);
    render(<GraphRenderingPanel configuration={{}} />);
    await user.click(screen.getByRole('button', { name: 'Copy details' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    const text = await navigator.clipboard.readText();
    expect(text).toContain('The browser draws with: Test GPU.');
    expect(text).toContain('GPU limit: 5000 nodes');
    expect(text).toContain('- 10000 nodes: 8 fps');
  });

  it('cannot be turned on while the browser draws in software, and never says the card is missing', () => {
    capability.current = { verdict: 'not_capable', status: 'software', reasons: ['The browser draws with: SwiftShader.'], cautions: [] };
    const { container } = render(<GraphRenderingPanel configuration={{}} />);
    expect(screen.getByRole('switch', { name: /Use the GPU for graphs/ })).toBeDisabled();
    expect(screen.getAllByText(/does not mean the computer has none/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Check again' })).toBeInTheDocument();
    expect(screen.getByText(/turn on graphics \(hardware\) acceleration/)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/This device cannot/);
  });

  it('a choice that cannot be used now can still be turned off', async () => {
    setGpuPreference(true);
    capability.current = { verdict: 'not_capable', status: 'unavailable', reasons: [], cautions: [] };
    render(<GraphRenderingPanel configuration={{}} />);
    const toggle = screen.getByRole('switch', { name: /Use the GPU for graphs/ });
    expect(toggle).toBeChecked();
    expect(screen.getByText('standard drawing')).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(getGpuPreference()).toBe(false);
  });

  it('a graph failing while the page is open shows at once, keeping the choice and the time of the last check', () => {
    setGpuPreference(true);
    render(<GraphRenderingPanel configuration={{}} />);
    expect(screen.getByText('GPU on')).toBeInTheDocument();
    act(() => {
      capability.current = { ...capability.current, verdict: 'not_capable', status: 'graph_failed', reasons: ['The GPU context was lost.'], failedAt: '2026-11-24T10:00:00Z' };
      markGpuFailed('The GPU context was lost.');
    });
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText('GPU on')).not.toBeInTheDocument();
    expect(getGpuPreference()).toBe(true);
  });

  it('uses slow hardware with a caution, but does not suggest it', () => {
    capability.current = { verdict: 'capable', status: 'hardware', reasons: [], cautions: ['The draw test was slow.'] };
    render(<GraphRenderingPanel configuration={{}} />);
    expect(screen.getByRole('switch', { name: /Use the GPU for graphs/ })).toBeEnabled();
    expect(screen.queryByText('This browser')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
    expect(shouldSuggestGpu({})).toBe(false);
  });

  it('is this browser’s own choice: the configuration cannot forbid it (B-36 refused)', () => {
    setGpuPreference(true);
    render(<GraphRenderingPanel />);
    expect(screen.queryByText('System setting')).not.toBeInTheDocument();
    expect(resolveRenderer()).toBe('webgl');
  });
});

describe('one-time GPU suggestion', () => {
  it('is offered once per capable device while GPU rendering is off', () => {
    expect(shouldSuggestGpu({})).toBe(true);
    markGpuSuggested();
    expect(shouldSuggestGpu({})).toBe(false);
  });

  it('is not offered when GPU is on or not capable', () => {
    setGpuPreference(true);
    expect(shouldSuggestGpu({})).toBe(false);
    setGpuPreference(false);
    capability.current = { verdict: 'unknown', reasons: [] };
    expect(shouldSuggestGpu({})).toBe(false);
  });
});
