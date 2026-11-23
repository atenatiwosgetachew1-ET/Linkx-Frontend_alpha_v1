import { describe, expect, it } from 'vitest';

import { createGraphStore } from '../../graph/lib/graphStore.js';
import { defaultTableAppendices, REPORT_TABLE_MAX_ROWS, tableAppendix } from './tableReport.js';

const storeOf = () => {
  const store = createGraphStore();
  store.replace({
    nodes: [
      { id: 'a', label: 'Abebe' },
      { id: 'b', label: 'Bekele' },
      { id: 'c', label: 'Chala' },
      { id: 'd', label: 'Dawit' },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', relationship: 'PAYMENT', AMOUNT: 100, DATE: '2026-01-01' },
      { id: 'e2', from: 'a', to: 'c', relationship: 'PAYMENT', AMOUNT: '2,500', DATE: '2026-01-02' },
      { id: 'e3', from: 'c', to: 'd', relationship: 'PAYMENT', AMOUNT: 40, DATE: '2026-01-03' },
    ],
  });
  return store;
};
const linkOf = (store) => ({ nodeIds: store.graph().nodes(), edgeIds: store.graph().edges(), selection: { nodes: [], edges: [] } });

describe('tableReport', () => {
  it('a Table window as left: its rows, filter, columns and sort', () => {
    const store = storeOf();
    const appendix = tableAppendix({ store, link: linkOf(store), title: 'Table 3', tableState: { tab: 'nodes', scope: 'all', filter: ' be ', sort: { nodes: { key: '@label', dir: 'desc' } }, columns: { nodes: { order: [], hidden: ['@id', '@flags'] } } } });
    expect(appendix.source).toBe('Table 3 · Nodes · All scope · filter "be"');
    expect(appendix.columns.map((column) => column.label)).toEqual(['Label', 'Type', 'Links']);
    expect(appendix.rows.map((row) => row[0])).toEqual(['Bekele', 'Abebe']); // "be" in a shown column
    expect(appendix.total).toBe(2);
  });

  it('the default tables: entities flagged first then most connected; relationships flagged first then the largest amount', () => {
    const store = storeOf();
    store.setMarkers('pinned', { nodes: ['d'] });
    const [entities, relationships] = defaultTableAppendices({ store, link: linkOf(store), weightKey: 'AMOUNT', timeKey: 'DATE' });
    expect(entities.title).toBe('Entities');
    expect(entities.columns.map((column) => column.label)).toEqual(['Label', 'ID', 'Type', 'Links', 'Flags']);
    expect(entities.rows.map((row) => row[0])).toEqual(['Dawit', 'Abebe', 'Chala', 'Bekele']); // pinned, then 2, 2, 1 links
    expect(relationships.title).toBe('Relationships');
    expect(relationships.columns.map((column) => column.label)).toEqual(['From', 'To', 'Type', 'AMOUNT', 'DATE', 'Label', 'Flags']);
    expect(relationships.columns[3].numeric).toBe(true);
    expect(relationships.rows.map((row) => row[3])).toEqual(['2,500', '100', '40']);
    expect(REPORT_TABLE_MAX_ROWS).toBe(2000);
  });
});
