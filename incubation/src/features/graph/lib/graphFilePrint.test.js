// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { printImage } from './graphFile.js';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('printImage', () => {
  it('pages (chart snaps): A4 sheets without margins, one picture a sheet, none spilling over', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    printImage(['data:image/png;base64,P1', 'data:image/png;base64,P2'], { pages: true });
    const css = document.getElementById('linkx-print-style').textContent;
    expect(css).toMatch(/@page \{ size: A4 portrait; margin: 0; \}/);
    expect(css).toMatch(/img \{ width: 210mm; height: 296\.8mm;/);
    expect(css).toMatch(/img:not\(:last-child\) \{ break-after: page; \}/);
    expect(document.querySelectorAll('#linkx-print-image img')).toHaveLength(2);
    vi.advanceTimersByTime(100);
    expect(window.print).toHaveBeenCalled();
  });

  it('a graph picture: as before (fitted in the page margins)', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    printImage('data:image/png;base64,G');
    const css = document.getElementById('linkx-print-style').textContent;
    expect(css).not.toMatch(/@page/);
    expect(css).toMatch(/max-width: 100%; height: auto/);
  });

  it('landscape pages: A4 on its side', () => {
    vi.useFakeTimers();
    vi.spyOn(window, 'print').mockImplementation(() => {});
    printImage(['data:image/png;base64,P1'], { pages: true, orientation: 'landscape' });
    const css = document.getElementById('linkx-print-style').textContent;
    expect(css).toMatch(/@page \{ size: A4 landscape; margin: 0; \}/);
    expect(css).toMatch(/width: 297mm; height: 209\.8mm;/);
  });
});
