// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalizeTableState } from './tableRows.js';
import {
  TABLE_DEFAULTS_KEY,
  forgetTableDefaults,
  getTableDefaults,
  isBuiltinTableDefaults,
  normalizeTableDefaults,
  resetTableDefaults,
  setTableDefaults,
  subscribeTableDefaults,
} from './tableDefaults.js';

afterEach(() => {
  localStorage.clear();
  forgetTableDefaults();
});

describe('table window defaults', () => {
  it('start as the window always did: Nodes, Drawn, following, every column, no sorting', () => {
    expect(getTableDefaults()).toEqual({ tab: 'nodes', scope: 'drawn', follow: true, hidden: { nodes: [], links: [] }, sort: { nodes: null, links: null }, print: { rows: 'shown', page: 'auto' } });
    expect(isBuiltinTableDefaults(getTableDefaults())).toBe(true);
  });

  it('keeps known values only; a tab never hides every built-in column; sorts by built-ins only', () => {
    const cleaned = normalizeTableDefaults({
      tab: 'cells',
      scope: 'all',
      hidden: { nodes: ['@id', 'AMOUNT'], links: ['@label', '@from', '@to', '@type', '@flags'] },
      sort: { nodes: { key: '@degree', dir: 'desc' }, links: { key: 'AMOUNT' } },
      print: { rows: 'everything', page: 'landscape' },
    });
    expect(cleaned).toMatchObject({ tab: 'nodes', scope: 'all', sort: { nodes: { key: '@degree', dir: 'desc' }, links: null }, print: { rows: 'shown', page: 'landscape' } });
    expect(cleaned.hidden.nodes).toEqual(['@id']);
    expect(cleaned.hidden.links).toHaveLength(4);
  });

  it('is saved in this browser, merged per tab, and resets', () => {
    const listener = vi.fn();
    const stop = subscribeTableDefaults(listener);
    setTableDefaults({ tab: 'links', hidden: { nodes: ['@flags'] }, sort: { links: { key: '@from', dir: 'asc' } } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getTableDefaults()).toMatchObject({ tab: 'links', hidden: { nodes: ['@flags'], links: [] }, sort: { nodes: null, links: { key: '@from', dir: 'asc' } } });
    expect(JSON.parse(localStorage.getItem(TABLE_DEFAULTS_KEY)).tab).toBe('links');
    forgetTableDefaults();
    expect(getTableDefaults().tab).toBe('links');
    resetTableDefaults();
    expect(isBuiltinTableDefaults(getTableDefaults())).toBe(true);
    stop();
  });

  it('is what a Table window without a state of its own starts from, and only that', () => {
    const defaults = normalizeTableDefaults({ tab: 'links', scope: 'all', follow: false, hidden: { links: ['@flags'] }, sort: { links: { key: '@from', dir: 'desc' } } });
    expect(normalizeTableState(undefined, defaults)).toMatchObject({
      tab: 'links', scope: 'all', follow: false,
      columns: { nodes: { order: [], hidden: [] }, links: { order: [], hidden: ['@flags'] } },
      sort: { nodes: null, links: { key: '@from', dir: 'desc' } },
    });
    // A window with its own state keeps it.
    const own = normalizeTableState({ tab: 'nodes', scope: 'drawn', follow: true, columns: { links: { hidden: [] } } }, defaults);
    expect(own).toMatchObject({ tab: 'nodes', scope: 'drawn', follow: true, columns: { links: { hidden: [] } }, sort: { links: null } });
    // Without the second argument: as before.
    expect(normalizeTableState()).toMatchObject({ tab: 'nodes', scope: 'drawn', follow: true, sort: { nodes: null, links: null } });
  });
});
