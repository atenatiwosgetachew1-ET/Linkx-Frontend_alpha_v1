// The print popup's preview of page 1 (Export ▸ Print table…): the PDF's
// page drawn on a canvas in the same NBE frame (the chart snaps' frame,
// lib/chartSnaps.js): the column header and the first rows of the first set
// of columns, sized as the PDF plans them, roughly. A preview, not the PDF.

import { A4, A4_LANDSCAPE, FRAME, framedPage, loadImage } from '../../chart/lib/chartSnaps.js';
import { MAX_COLUMN_MM, MIN_COLUMN_MM, pageOrientation } from './tablePdf.js';

const FONT = 'Manrope, "Segoe UI", Roboto, Arial, sans-serif';

const fit = (context, text, width) => {
  if (context.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
};

// rows: [{ values }]; columns: [{ key, label, numeric? }]. -> a PNG data URL,
// or null (no canvas).
export const tablePreview = async (rows, allColumns, {
  title = 'LINK ANALYSIS · TABLE', source = '', details = '', logoUrl = '', orientation = 'auto',
} = {}) => {
  let columns = allColumns;
  const paper = pageOrientation(orientation, columns.length) === 'landscape' ? A4_LANDSCAPE : A4;
  const logo = await loadImage(logoUrl);
  const framed = framedPage(logo, { title, source, details }, paper);
  if (!framed) return null;
  const { context, body } = framed;
  const left = FRAME.margin;
  const width = paper.width - FRAME.margin * 2;
  const top = body.y + 18;
  const rowHeight = 15;
  context.font = `9px ${FONT}`;
  // As the PDF plans them (tablePdf.js): each column between the minimum and
  // maximum widths by its contents; page 1 holds the first set of columns
  // that fits, stretched to the page (the others continue on later pages).
  const pxPerMm = paper.width / (paper === A4 ? 210 : 297);
  const sample = rows.slice(0, 40);
  const natural = columns.map((column) => Math.min(MAX_COLUMN_MM * pxPerMm, Math.max(MIN_COLUMN_MM * pxPerMm, context.measureText(column.label).width + 12, ...sample.map((row) => context.measureText(String(row.values[column.key] ?? '')).width + 12))));
  const firstSet = [];
  let used = 0;
  natural.forEach((value, index) => {
    if (firstSet.length && used + value > width) return;
    if (firstSet.length < index) return;
    firstSet.push(index);
    used += value;
  });
  columns = firstSet.map((index) => columns[index]);
  const stretch = width / (used || 1);
  const columnWidths = firstSet.map((index) => natural[index] * Math.max(1, stretch));
  // The column header.
  context.fillStyle = '#1f2b3a';
  context.fillRect(left, top, width, rowHeight + 2);
  context.fillStyle = '#ffffff';
  context.font = `700 8.5px ${FONT}`;
  let x = left;
  columns.forEach((column, index) => {
    context.fillText(fit(context, column.label, columnWidths[index] - 8), x + 4, top + 11);
    x += columnWidths[index];
  });
  // The rows that fit on the page, alternate ones tinted.
  const room = Math.floor((body.y + body.height - 14 - (top + rowHeight + 2)) / rowHeight);
  context.font = `8.5px ${FONT}`;
  rows.slice(0, Math.max(0, room)).forEach((row, rowIndex) => {
    const y = top + rowHeight + 2 + rowIndex * rowHeight;
    if (rowIndex % 2) {
      context.fillStyle = '#f3f6fa';
      context.fillRect(left, y, width, rowHeight);
    }
    context.strokeStyle = '#d5deea';
    context.lineWidth = 0.5;
    context.strokeRect(left, y, width, rowHeight);
    context.fillStyle = '#1f2933';
    let cellX = left;
    columns.forEach((column, index) => {
      const text = fit(context, String(row.values[column.key] ?? ''), columnWidths[index] - 8);
      context.textAlign = column.numeric ? 'right' : 'left';
      context.fillText(text, column.numeric ? cellX + columnWidths[index] - 4 : cellX + 4, y + 10.5);
      cellX += columnWidths[index];
    });
    context.textAlign = 'left';
  });
  if (!rows.length) {
    context.fillStyle = '#7b8794';
    context.fillText('No rows', left + 4, top + rowHeight + 13);
  }
  return framed.finish();
};
