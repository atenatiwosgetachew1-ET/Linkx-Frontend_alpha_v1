// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  MAX_SAVED_VIEWS, SAVED_VIEWS_KEY, defaultViewName, fromSavedView, graphScope, removeSavedViews, savedElementFilters,
  savedViewsFor, storeSavedView, toSavedSettings,
} from './savedViews.js';
import { createGraphStore } from './graphStore.js';
import { DEFAULT_GRAPH_SETTINGS, normalizeGraphSettings } from './graphSettings.js';

afterEach(() => localStorage.clear());

const graphOf = (ids, edgeCount) => {
  const store = createGraphStore();
  store.replace({
    nodes: ids.map((id) => ({ id })),
    edges: Array.from({ length: edgeCount }, (_, i) => ({ from: ids[i % ids.length], to: ids[(i + 1) % ids.length] })),
  });
  return store.graph();
};

describe('graph scope (GA computeGraphScopeFingerprint)', () => {
  // Answers of production's own function (graphs_adjuster.js run in Node).
  it.each([
    [['1', '2', '3'], 2, 'graph_3_2_847079665'],
    [Array.from({ length: 40 }, (_, i) => String(i + 1)), 39, 'graph_40_39_2073939184'],
    [['acc-10', 'acc-9', 'ACC-1', 'x y', 'b'], 7, 'graph_5_7_729956724'],
    [[], 0, 'graph_0_0_1487252'],
  ])('matches production for %j', (ids, edges, scope) => {
    expect(graphScope(graphOf(ids, edges))).toBe(scope);
  });
});

describe('saved views storage (GA persistSavedViewsForScope / removeSavedViewsByNames)', () => {
  it('keeps views per graph, newest first, replaces by name, 30 at most', () => {
    storeSavedView('graph_a', { name: 'One' });
    storeSavedView('graph_b', { name: 'Other' });
    storeSavedView('graph_a', { name: ' Two ' });
    storeSavedView('graph_a', { name: 'One', createdAt: 'later' });
    expect(savedViewsFor('graph_a').map((view) => view.name)).toEqual(['One', 'Two']);
    expect(savedViewsFor('graph_a')[0]).toMatchObject({ createdAt: 'later', scopeId: 'graph_a' });
    expect(savedViewsFor('graph_b')).toHaveLength(1);
    for (let i = 0; i < MAX_SAVED_VIEWS + 3; i += 1) storeSavedView('graph_a', { name: `V${i}` });
    expect(savedViewsFor('graph_a')).toHaveLength(MAX_SAVED_VIEWS);
    expect(savedViewsFor('graph_a')[0].name).toBe(`V${MAX_SAVED_VIEWS + 2}`);
  });

  it('removes by name for one graph only', () => {
    storeSavedView('graph_a', { name: 'Keep' });
    storeSavedView('graph_a', { name: 'Drop' });
    storeSavedView('graph_b', { name: 'Drop' });
    expect(removeSavedViews('graph_a', ['Drop', 'missing'])).toBe(1);
    expect(savedViewsFor('graph_a').map((view) => view.name)).toEqual(['Keep']);
    expect(savedViewsFor('graph_b')).toHaveLength(1);
  });

  it('reads views production stored (scope ids compared sanitised)', () => {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify([{ name: 'Prod', scopeId: 'GRAPH_3_2_1' }, null, 'junk']));
    expect(savedViewsFor('graph_3_2_1').map((view) => view.name)).toEqual(['Prod']);
  });

  it('names a new view as production did', () => {
    expect(defaultViewName(new Date('2026-11-15T14:32:05.123Z'))).toBe('View 2026-11-15 14:32:05');
  });
});

describe('saved view settings (GA applySavedViewSettings)', () => {
  const settings = normalizeGraphSettings({
    limit: { key: 'amount', sort: 'desc', min: 10, max: 60 },
    labels: { group: 'Source Node', byKey: 'name' },
    edgeWeight: 'default',
    showLabels: true,
    physics: true,
    layout: { type: 'hierarchical', direction: 'LR', sortMethod: 'hubsize', layerMode: 'by_key', layerKey: 'bank' },
    performance: false,
    alertRules: false,
  });

  it('writes production\'s currentSettings keys', () => {
    expect(toSavedSettings(settings, { theme_lines: false })).toMatchObject({
      sortKey: 'amount', sortOrder: 'desc', limitMin: 10, limitMax: 60, lableGroup: 'Source Node', weightEdges: 'default',
      showTitles: false, showLabels: true, physics: true, layoutType: 'hierarchical', layoutDirection: 'LR',
      sortMethod: 'hubsize', layerMode: 'by_key', layerKey: 'bank', alertRules: false, elementFilters: { theme_lines: false, nodes: true },
    });
  });

  it('reads a production view\'s keys into typed settings (current ones fill the rest)', () => {
    const view = { settings: toSavedSettings(settings, {}) };
    const typed = fromSavedView(view, { ...DEFAULT_GRAPH_SETTINGS, performance: false });
    expect(typed).toMatchObject({
      limit: settings.limit,
      labels: { group: 'Source Node' },
      edgeWeight: 'default',
      showLabels: true,
      physics: true,
      layout: settings.layout,
      alertRules: false,
      performance: false,
    });
    expect(fromSavedView({ settings: { limit: 40, layoutType: 'default' } }).limit).toMatchObject({ min: 0, max: 40 });
    expect(fromSavedView({ settings: { limit: 40, layoutType: 'default' } }).layout.type).toBe('concentric');
  });

  it('prefers this build\'s own copy, and returns saved element filters', () => {
    expect(fromSavedView({ graphSettings: settings, settings: { limitMax: 5 } })).toEqual(settings);
    expect(savedElementFilters({ settings: { elementFilters: { labels: false } } })).toMatchObject({ labels: false, nodes: true });
    expect(savedElementFilters({ settings: {} })).toBeNull();
  });
});
