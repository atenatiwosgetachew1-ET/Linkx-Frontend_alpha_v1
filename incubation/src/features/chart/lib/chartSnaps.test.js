// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { A4, CELLS, FRAME, SNAP, chartsPdfFileName, framePages, pageLayout, pagesToPdf, snapFileName } from './chartSnaps.js';

describe('chartSnaps', () => {
  it('file names: the window, the chart (individual), the time, the page when several', () => {
    const at = new Date(2026, 10, 18, 9, 5);
    expect(snapFileName('Chart 1', '', at)).toBe('ChartSnap_Chart-1_20261118-0905.png');
    expect(snapFileName('Chart 1', 'In / Out Degree', at)).toBe('ChartSnap_Chart-1_In-Out-Degree_20261118-0905.png');
    expect(snapFileName('Chart 1', '', at, { number: 2, count: 3 })).toBe('ChartSnap_Chart-1_20261118-0905_p2of3.png');
  });

  it('A4 pages: two charts across, six a page (Group); one at full width (Individual); all inside the page', () => {
    expect(A4.height / A4.width).toBeCloseTo(Math.SQRT2, 2);
    const group = pageLayout('group');
    expect([group.columns, group.rows, group.perPage]).toEqual([2, 3, 6]);
    const single = pageLayout('single');
    expect([single.columns, single.perPage]).toEqual([1, 1]);
    const body = A4.height - FRAME.header - FRAME.footer;
    [group, single].forEach(({ size, columns, rows }) => {
      expect(columns * size.width + (columns - 1) * SNAP.gap).toBeLessThanOrEqual(A4.width - FRAME.margin * 2);
      expect(FRAME.margin * 2 + rows * (SNAP.head + size.chart + SNAP.pad) + (rows - 1) * SNAP.gap).toBeLessThanOrEqual(body);
    });
    expect(CELLS.single.width).toBeGreaterThan(CELLS.group.width);
  });

  it('nothing to draw without pictures', async () => {
    expect(await framePages([])).toEqual([]);
    expect(await framePages([{ url: '' }])).toEqual([]);
  });

  it('pages as one PDF: a page each, edge to edge, in order; its file name', async () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const doc = await pagesToPdf([pixel, pixel, pixel]);
    expect(doc.getNumberOfPages()).toBe(3);
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    for (let page = 1; page <= 3; page += 1) {
      // The picture drawn over the whole page (595.28 x 841.89 pt).
      expect(doc.internal.pages[page].join('\n')).toMatch(/595\.27\d* 0 0 841\.88\d* 0\.? [\d.]+ cm\n\/I\d+ Do/);
    }
    const wide = await pagesToPdf([pixel], { orientation: 'landscape' });
    expect(wide.internal.pageSize.getWidth()).toBeCloseTo(297, 0);
    expect(chartsPdfFileName('Chart 1', new Date(2026, 10, 18, 9, 5))).toBe('LinkxCharts_Chart-1_20261118-0905.pdf');
  });
});
