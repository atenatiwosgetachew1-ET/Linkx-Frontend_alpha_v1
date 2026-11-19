import { describe, expect, it } from 'vitest';

import { AUTO_LANDSCAPE_COLUMNS, TABLE_PDF_MAX_ROWS, pageOrientation, renderTablePdf, tablePdfFileName } from './tablePdf.js';

const columns = (count) => Array.from({ length: count }, (_, index) => ({ key: `c${index}`, label: `Column ${index}`, numeric: index === 1 }));
const rows = (count, width = 3) => Array.from({ length: count }, (_, row) => ({ values: Object.fromEntries(columns(width).map((column, index) => [column.key, index === 1 ? String(row * 10) : `Row ${row} value ${index}`])) }));
const pageText = (doc, number) => doc.internal.pages[number].join('\n');

describe('table PDF (NBE frame)', () => {
  it('pages: auto portrait up to AUTO_LANDSCAPE_COLUMNS columns, landscape past them; or as chosen', () => {
    expect(pageOrientation('auto', AUTO_LANDSCAPE_COLUMNS)).toBe('portrait');
    expect(pageOrientation('auto', AUTO_LANDSCAPE_COLUMNS + 1)).toBe('landscape');
    expect(pageOrientation('portrait', 20)).toBe('portrait');
    expect(pageOrientation('landscape', 2)).toBe('landscape');
  });

  it('every page: the header (title, source), the column header, the footer (marking, page n / N) and the watermark', async () => {
    const doc = await renderTablePdf({ rows: rows(300), columns: columns(3), source: 'Source: Graph 1 · Nodes · Drawn scope', details: '300 rows' });
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(2);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    for (let number = 1; number <= pages; number += 1) {
      const text = pageText(doc, number);
      expect(text).toContain('(LINK ANALYSIS · TABLE) Tj');
      expect(text).toContain('(Source: Graph 1 · Nodes · Drawn scope) Tj');
      expect(text).toContain('(Column 0) Tj');
      expect(text).toContain('For authorised investigation use only');
      expect(text).toContain(`(Page ${number} / ${pages}) Tj`);
      expect(text).toMatch(/\(CONFIDENTIAL\) Tj/);
    }
  });

  it('many columns: landscape; at most TABLE_PDF_MAX_ROWS rows; no rows: says so', async () => {
    const wide = await renderTablePdf({ rows: rows(5, 9), columns: columns(9) });
    expect(wide.internal.pageSize.getWidth()).toBeCloseTo(297, 0);
    const empty = await renderTablePdf({ rows: [], columns: columns(3) });
    expect(pageText(empty, 1)).toContain('(No rows) Tj');
    expect(TABLE_PDF_MAX_ROWS).toBe(5000);
  });

  it('file name: the window, the tab, the time', () => {
    expect(tablePdfFileName('Table 1', 'nodes', new Date(2026, 10, 18, 9, 5))).toBe('LinkxTable_Table-1_nodes_20261118-0905.pdf');
  });
});

describe('table PDF columns (never squeezed)', () => {
  it('a page set holds what fits at the minimum width; the rest continue, Label repeated', async () => {
    const { MIN_COLUMN_MM, columnSets, columnsPerSet } = await import('./tablePdf.js');
    expect(columnsPerSet('portrait')).toBe(Math.floor(190 / MIN_COLUMN_MM));
    expect(columnsPerSet('landscape')).toBe(Math.floor(277 / MIN_COLUMN_MM));
    expect(columnSets(columnsPerSet('portrait'), 'portrait')).toBe(1);
    expect(columnSets(14, 'portrait')).toBe(1 + Math.ceil((14 - columnsPerSet('portrait')) / (columnsPerSet('portrait') - 1)));
    const many = [{ key: '@label', label: 'Label' }, ...columns(13)];
    const values = (row) => Object.fromEntries(many.map((column) => [column.key, column.key === '@label' ? `Entity ${row}` : `A fairly long value ${row}`]));
    const doc = await renderTablePdf({ rows: Array.from({ length: 6 }, (_, row) => ({ values: values(row) })), columns: many, orientation: 'portrait' });
    // No column narrower than the minimum.
    const widths = doc.lastAutoTable.columns.map((column) => column.width);
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(MIN_COLUMN_MM - 0.01);
    // More than one page (the columns continue), each with Label in its header.
    const pages = doc.getNumberOfPages();
    expect(pages).toBeGreaterThan(1);
    for (let number = 1; number <= pages; number += 1) expect(pageText(doc, number)).toContain('(Label) Tj');
    // The last column is printed (on a later page), the first page does not have it.
    expect(pageText(doc, 1)).not.toContain('(Column 12) Tj');
    expect(pageText(doc, pages)).toContain('(Column 12) Tj');
  });
});
