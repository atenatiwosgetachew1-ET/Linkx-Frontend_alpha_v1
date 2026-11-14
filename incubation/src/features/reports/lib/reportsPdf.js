// "Download list": the visible reports as a landscape PDF with a leading
// entities summary, as the production Reports window builds it
// (src/App.jsx, downloadReportsList). jsPDF is loaded on demand.

import { REPORTS_PAGE_SIZE, getReportTab } from './reportModel.js';

const HEAD_COLOR = [49, 73, 97]; // #314961, the production report accent
const STRIPE_COLOR = [240, 245, 250];

const scoreCell = (record) => (record.fraudScore === null ? '-' : record.fraudScore.toFixed(1));

export const buildReportRows = (records, tabId) => {
  const tab = getReportTab(tabId);
  const head = ['No.', 'Leading Entity', 'Report ID', 'Ref ID', 'Type', tab.scored ? 'Fraud Score' : 'Source', 'Status', 'Date'];
  const body = records.map((record, index) => [
    index + 1,
    record.leadingEntity || '-',
    record.id || '-',
    record.externalReferenceId || '-',
    record.reportType || '-',
    tab.scored ? scoreCell(record) : (record.sourceSystem || '-'),
    String(record.status || '').toUpperCase(),
    record.createdAt ? new Date(record.createdAt).toLocaleString() : '-',
  ]);
  return { head, body };
};

// Entities by how often they lead a report, with the ref id of their
// highest-scoring report.
export const buildLeadingEntitySummary = (records) => {
  const stats = new Map();
  records.forEach((record) => {
    const entity = record.leadingEntity;
    if (!entity) return;
    const entry = stats.get(entity) || { count: 0, highestScore: -1, topRefId: '-' };
    entry.count += 1;
    const score = record.fraudScore ?? 0;
    if (score > entry.highestScore) {
      entry.highestScore = score;
      entry.topRefId = record.externalReferenceId || '-';
    }
    stats.set(entity, entry);
  });
  return [...stats.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([entity, entry], index) => [index + 1, entity, entry.count, entry.topRefId]);
};

export async function downloadReportsListPdf({ records, tabId, offset, total, isCdr, limit = REPORTS_PAGE_SIZE }) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const tab = getReportTab(tabId);
  const doc = new jsPDF('landscape');

  doc.setFillColor(...HEAD_COLOR);
  doc.rect(0, 0, 297, 40, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(tab.id === 'xvigilance' ? 'CTMS Linkx-xVigilance Findings' : `${tab.label} List`, 14, 25);

  doc.setTextColor(50, 50, 50);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  const y = 55;
  const first = total > 0 ? offset + 1 : 0;
  const last = Math.min(offset + limit, total);
  doc.text(`Showing Records: ${first} to ${last} of ${total}`, 14, y);
  doc.text(`Generated At: ${new Date().toLocaleString()}`, 200, y);

  const { head, body } = buildReportRows(records, tabId);
  const tableStyle = {
    theme: 'striped',
    headStyles: { fillColor: HEAD_COLOR, textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    alternateRowStyles: { fillColor: STRIPE_COLOR },
    margin: { left: 14, right: 14 },
  };
  autoTable(doc, {
    ...tableStyle,
    startY: y + 15,
    head: [head],
    body,
    columnStyles: {
      0: { cellWidth: 15 }, 1: { cellWidth: 40 }, 2: { cellWidth: 35 }, 3: { cellWidth: 40 },
      4: { cellWidth: 40 }, 5: { cellWidth: tab.scored ? 25 : 30 }, 6: { cellWidth: 25 }, 7: { cellWidth: 40 },
    },
    styles: { overflow: 'linebreak', cellWidth: 'wrap' },
  });

  const summary = buildLeadingEntitySummary(records);
  if (summary.length) {
    let summaryY = (doc.lastAutoTable?.finalY || y) + 15;
    if (summaryY > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage();
      summaryY = 20;
    }
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...HEAD_COLOR);
    doc.text('Leading Entities Influence Summary', 14, summaryY);
    autoTable(doc, {
      ...tableStyle,
      startY: summaryY + 6,
      head: [['No.', isCdr ? 'Leading Entity (MSISDN / ID)' : 'Leading Entity (Account / ID)', 'Frequency (Appearances)', 'Most Flagged Ref ID']],
      body: summary,
      columnStyles: { 0: { cellWidth: 15 }, 1: { cellWidth: 90 }, 2: { cellWidth: 50 }, 3: { cellWidth: 114 } },
    });
  }

  doc.save(`linkx_${tab.id}_list.pdf`);
}
