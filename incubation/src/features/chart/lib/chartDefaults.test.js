// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BUILTIN_CHART_DEFAULTS,
  CHART_DEFAULTS_KEY,
  builtinAutoMetrics,
  forgetChartDefaults,
  getChartDefaults,
  isBuiltinChartDefaults,
  normalizeChartDefaults,
  resetChartDefaults,
  setChartDefaults,
  subscribeChartDefaults,
} from './chartDefaults.js';
import { normalizeChartState } from './chartState.js';

afterEach(() => {
  localStorage.clear();
  forgetChartDefaults();
});

describe('chart window defaults', () => {
  it('start as the window always did: Drawn, Automatic, the Global-level charts, Viridis, following', () => {
    const defaults = getChartDefaults();
    expect(defaults).toEqual({ scope: 'drawn', mode: 'auto', colorful: true, schema: 'Viridis', follow: true, autoMetrics: builtinAutoMetrics() });
    expect(isBuiltinChartDefaults(defaults)).toBe(true);
    expect(defaults.autoMetrics.length).toBeGreaterThan(0);
  });

  it('keeps known values only, the charts once each in the menu order', () => {
    const cleaned = normalizeChartDefaults({ scope: 'nowhere', mode: 'manual', schema: 'Nope', colorful: false, follow: false, autoMetrics: ['pagerank', 'degree', 'degree', 'not-a-chart'] });
    expect(cleaned).toEqual({ scope: 'drawn', mode: 'manual', colorful: false, schema: 'Viridis', follow: false, autoMetrics: ['degree', 'pagerank'] });
    expect(normalizeChartDefaults({ autoMetrics: [] }).autoMetrics).toEqual([]);
  });

  it('is saved in this browser, tells its listeners, and resets', () => {
    const listener = vi.fn();
    const stop = subscribeChartDefaults(listener);
    setChartDefaults({ scope: 'all', autoMetrics: ['degree'] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(CHART_DEFAULTS_KEY))).toMatchObject({ scope: 'all', autoMetrics: ['degree'] });
    expect(isBuiltinChartDefaults(getChartDefaults())).toBe(false);
    // The same again changes nothing.
    setChartDefaults({ scope: 'all' });
    expect(listener).toHaveBeenCalledTimes(1);
    // Read back after a reload.
    forgetChartDefaults();
    expect(getChartDefaults().scope).toBe('all');
    resetChartDefaults();
    expect(localStorage.getItem(CHART_DEFAULTS_KEY)).toBeNull();
    expect(getChartDefaults()).toEqual({ ...BUILTIN_CHART_DEFAULTS, autoMetrics: [...BUILTIN_CHART_DEFAULTS.autoMetrics] });
    stop();
  });

  it('is what a Chart window without a state of its own starts from, and only that', () => {
    const defaults = { scope: 'all', mode: 'manual', colorful: false, schema: 'Ocean', follow: false, autoMetrics: [] };
    expect(normalizeChartState(undefined, defaults)).toMatchObject({ scope: 'all', mode: 'manual', follow: false, global: { colorful: false, schema: 'Ocean' } });
    // A window with its own state keeps it.
    const own = normalizeChartState({ v: 2, scope: 'selected', mode: 'auto', follow: true, global: { colorful: true, schema: 'Magma' }, cards: [] }, defaults);
    expect(own).toMatchObject({ scope: 'selected', mode: 'auto', follow: true, global: { colorful: true, schema: 'Magma' } });
    // Without the second argument: as before.
    expect(normalizeChartState()).toMatchObject({ scope: 'drawn', mode: 'auto', follow: true, global: { colorful: true, schema: 'Viridis' } });
  });
});
