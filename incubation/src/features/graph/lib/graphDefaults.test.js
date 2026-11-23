// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_GRAPH_SETTINGS, normalizeGraphSettings } from './graphSettings.js';
import {
  GRAPH_DEFAULTS_KEY,
  GRAPH_DEFAULT_LIMIT_MAX,
  forgetGraphDefaults,
  getGraphDefaults,
  isBuiltinGraphDefaults,
  normalizeGraphDefaults,
  resetGraphDefaults,
  setGraphDefaults,
  subscribeGraphDefaults,
} from './graphDefaults.js';

afterEach(() => {
  localStorage.clear();
  forgetGraphDefaults();
});

describe('graph window defaults', () => {
  it('start as the window always did', () => {
    expect(getGraphDefaults()).toEqual(normalizeGraphSettings(DEFAULT_GRAPH_SETTINGS));
    expect(isBuiltinGraphDefaults(getGraphDefaults())).toBe(true);
  });

  it('keeps what can be set before a graph is loaded, within bounds', () => {
    const cleaned = normalizeGraphDefaults({
      limit: { key: 'AMOUNT', sort: 'desc', min: 40, max: 999999 },
      layout: { type: 'grid', layerMode: 'by_key', layerKey: 'TYPE' },
      labels: { group: 'Entity Node', byKey: 'NAME' },
      edgeWeight: 'AMOUNT',
      showLabels: true,
      performance: false,
      edgeBundleMin: 1,
    });
    expect(cleaned.limit).toEqual({ key: '', sort: 'desc', min: 0, max: GRAPH_DEFAULT_LIMIT_MAX });
    expect(cleaned.layout).toMatchObject({ type: 'grid', layerMode: 'hop_distance', layerKey: '' });
    expect(cleaned.labels).toEqual({ group: '', byKey: '' });
    expect(cleaned.edgeWeight).toBe('');
    expect(cleaned).toMatchObject({ showLabels: true, performance: false, edgeBundleMin: 2 });
  });

  it('is saved in this browser, merges limit and layout, tells its listeners, and resets', () => {
    const listener = vi.fn();
    const stop = subscribeGraphDefaults(listener);
    setGraphDefaults({ limit: { max: 100 }, layout: { type: 'layered' }, performance: false });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getGraphDefaults()).toMatchObject({ limit: { max: 100, sort: 'asc' }, layout: { type: 'layered', direction: 'UD' }, performance: false });
    expect(JSON.parse(localStorage.getItem(GRAPH_DEFAULTS_KEY)).limit.max).toBe(100);
    setGraphDefaults({ performance: false });
    expect(listener).toHaveBeenCalledTimes(1);
    forgetGraphDefaults();
    expect(getGraphDefaults().layout.type).toBe('layered');
    resetGraphDefaults();
    expect(localStorage.getItem(GRAPH_DEFAULTS_KEY)).toBeNull();
    expect(isBuiltinGraphDefaults(getGraphDefaults())).toBe(true);
    stop();
  });
});
