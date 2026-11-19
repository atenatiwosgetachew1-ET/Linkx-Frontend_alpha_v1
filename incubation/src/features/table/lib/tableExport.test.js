// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { rowsToCsv, rowsToTsv, tableFileName } from './tableExport.js';

const columns = [{ key: '@label', label: 'Name' }, { key: 'amount', label: 'Amount' }];
const rows = [
  { id: 'a', values: { '@label': 'Abebe, Kebede', amount: '2,500' } },
  { id: 'b', values: { '@label': 'He said "hi"', amount: '' } },
  { id: 'c', values: { '@label': '=HYPERLINK("x")', amount: '-3' } },
  { id: 'd', values: { '@label': 'አበበ\nline', amount: '7' } },
];

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('tableExport', () => {
  it('CSV: a BOM, quoted where needed, formulas kept as text', () => {
    const csv = rowsToCsv(rows, columns);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual([
      'Name,Amount',
      '"Abebe, Kebede","2,500"',
      '"He said ""hi""",',
      '"\'=HYPERLINK(""x"")",\'-3',
      '"አበበ\nline",7',
      '',
    ]);
  });

  it('TSV: one line a row, tabs and breaks flattened, formulas kept as text', () => {
    expect(rowsToTsv(rows, columns).split('\n')).toEqual([
      'Name\tAmount',
      'Abebe, Kebede\t2,500',
      'He said "hi"\t',
      '\'=HYPERLINK("x")\t\'-3',
      'አበበ line\t7',
    ]);
  });

  it('file name: the window title, the tab, the time', () => {
    expect(tableFileName('Table 1 / Nodes', 'nodes', 'csv', new Date(2026, 10, 18, 9, 5))).toBe('LinkxTable_Table-1-Nodes_nodes_20261118-0905.csv');
  });


});
