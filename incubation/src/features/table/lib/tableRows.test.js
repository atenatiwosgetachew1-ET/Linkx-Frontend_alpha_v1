import { describe, expect, it } from 'vitest';

import { createGraphStore } from '../../graph/lib/graphStore.js';
import {
  arrangeColumns, buildLinkRows, buildNodeRows, filterRows, normalizeTableState, sortRows,
} from './tableRows.js';

const storeOf = () => {
  const store = createGraphStore();
  store.replace({
    nodes: [
      { id: 'a', label: 'Abebe', amount: '2,500', city: 'Adama' },
      { id: 'b', label: 'Bekele', amount: 900 },
      { id: 'c', amount: 12000, city: 'Bahir Dar' },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', label: 'paid', amount: 10, color: '#fff' },
      { id: 'e2', from: 'b', to: 'c', relationship: 'CALL' },
    ],
  });
  return store;
};

describe('tableRows', () => {
  it('node rows: built-ins (label falls back to the id), then every property found', () => {
    const store = storeOf();
    const markers = { alert: { nodes: new Set(['b']), edges: new Set() }, pinned: { nodes: new Set(), edges: new Set() } };
    const { rows, columns } = buildNodeRows(store.graph(), ['a', 'b', 'c', 'gone'], markers);
    expect(columns.map((column) => column.key)).toEqual(['@label', '@id', '@type', '@degree', '@flags', 'amount', 'city']);
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(rows[2].values['@label']).toBe('c');
    expect(rows[1].values['@degree']).toBe('2');
    expect(rows[1].values['@flags']).toBe('Alerted');
    expect(rows[1].values.city).toBe('');
  });

  it('link rows: ends by name, type from the relationship, drawing keys left out', () => {
    const store = storeOf();
    const keys = store.graph().edges();
    const { rows, columns } = buildLinkRows(store.graph(), keys, null);
    expect(columns.map((column) => column.key)).toEqual(['@label', '@from', '@to', '@type', '@flags', 'amount', 'relationship']);
    expect(rows[0].values).toMatchObject({ '@label': 'paid', '@from': 'Abebe', '@to': 'Bekele' });
    expect(rows[1].values['@type']).toBe('CALL');
    expect(rows[1].ends).toEqual(['b', 'c']);
  });

  it('sorts numbers as numbers ("2,500" too), text naturally, empty last both ways', () => {
    const { rows } = buildNodeRows(storeOf().graph(), ['a', 'b', 'c'], null);
    expect(sortRows(rows, { key: 'amount', dir: 'asc' }).map((row) => row.id)).toEqual(['b', 'a', 'c']);
    expect(sortRows(rows, { key: 'amount', dir: 'desc' }).map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(sortRows(rows, { key: 'city', dir: 'asc' }).map((row) => row.id)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, { key: 'city', dir: 'desc' }).map((row) => row.id)).toEqual(['c', 'a', 'b']);
    expect(sortRows(rows, null)).toBe(rows);
  });

  it('filters on the shown columns, any case', () => {
    const { rows, columns } = buildNodeRows(storeOf().graph(), ['a', 'b', 'c'], null);
    expect(filterRows(rows, 'bahir', columns).map((row) => row.id)).toEqual(['c']);
    expect(filterRows(rows, 'bahir', columns.filter((column) => column.key !== 'city'))).toEqual([]);
    expect(filterRows(rows, '  ', columns)).toBe(rows);
  });

  it('arranges columns: moved ones first, the rest as found, hidden marked', () => {
    const columns = [{ key: 'x' }, { key: 'y' }, { key: 'z' }];
    expect(arrangeColumns(columns, { order: ['z', 'gone', 'x'], hidden: ['y'] })).toEqual([
      { key: 'z', hidden: false }, { key: 'x', hidden: false }, { key: 'y', hidden: true },
    ]);
  });

  it('normalizes the window state', () => {
    expect(normalizeTableState({ tab: 'bad', scope: 'all', follow: false, sort: { links: { key: 'amount', dir: 'desc' } } })).toEqual({
      tab: 'nodes',
      scope: 'all',
      follow: false,
      columns: { nodes: { order: [], hidden: [] }, links: { order: [], hidden: [] } },
      sort: { nodes: null, links: { key: 'amount', dir: 'desc' } },
    });
  });
});
