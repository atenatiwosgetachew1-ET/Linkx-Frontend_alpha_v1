// The built-in "LinkX Graph Report" template (G4.2; analyst decision
// 2026-11-17), after docs/report-templates/default/NBE_Linkx_Graph_Report_template.pdf:
// a dark navy cover with the gold accent bar; white inner pages with a
// running header and a footer (distribution marking, page number) on
// hairlines; each section on its own page under a small uppercase label and
// a numbered heading; key-figure cells; navy-headed tables with pale-blue
// stripes. The cover carries the NBE logo on a white band and the analyst's
// four fields (reference, date and time, analyst, alert / system rule).
//
// Drawn as a real PDF with the bundled jsPDF (selectable text, sharp tables,
// the same result every time): no HTML, no scripts, nothing fetched. All
// text is written as text. The standard PDF fonts cover Latin text only:
// other characters are replaced (pdfText), so an Ethiopic name shows as "?"
// until a Unicode font is bundled.

import { REPORT_TEMPLATE, reportKindOf } from './graphReportModel.js';

const PAGE = { width: 210, height: 297, margin: 18, top: 30, bottom: 22 };
const CONTENT = PAGE.width - PAGE.margin * 2;
const COLOR = {
  navy: [19, 29, 41],
  navySoft: [31, 43, 58],
  gold: [212, 168, 90],
  slate: [52, 93, 128],
  text: [23, 32, 43],
  muted: [107, 119, 133],
  coverMuted: [170, 182, 196],
  stripe: [235, 240, 247],
  figure: [232, 238, 246],
  border: [213, 222, 234],
  white: [255, 255, 255],
};

// Text the report can draw: Latin-1 (the standard fonts) and Ethiopic
// (Noto Sans Ethiopic, bundled; G4 open item, done 2026-11-18); common
// typography mapped, anything else replaced.
const MAP = { '—': '-', '–': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '≥': '>=', '≤': '<=', '→': '->', '•': '-' };
export const ETHIOPIC_RE = /[\u1200-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/;
const ETHIOPIC_ALL = /[\u1200-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/g;
export const pdfText = (value) => String(value ?? '').replace(/[^\u0000-ÿ\u1200-\u139F\u2D80-\u2DDF\uAB00-\uAB2F]/g, (char) => MAP[char] ?? '?'); // eslint-disable-line no-control-regex

// Ethiopic text (Amharic, Tigrinya, Ge'ez names and words): any string with
// an Ethiopic character is drawn and measured in Noto Sans Ethiopic of the
// same weight (it also covers Latin-1, so mixed text stays whole); tables
// too, as autoTable draws through the same methods. fonts: { regular, bold }
// base64 TTFs, embedded only when given (reports with Ethiopic text);
// without them Ethiopic characters print as "?".
export const ETHIOPIC_FONT = 'NotoSansEthiopic';
const hasEthiopic = (value) => (Array.isArray(value) ? value.some(hasEthiopic) : ETHIOPIC_RE.test(String(value ?? '')));
const stripEthiopic = (value) => (Array.isArray(value) ? value.map(stripEthiopic) : String(value ?? '').replace(ETHIOPIC_ALL, '?'));
export const installEthiopic = (doc, fonts) => {
  let available = false;
  if (fonts?.regular) {
    try {
      doc.addFileToVFS('NotoSansEthiopic-Regular.ttf', fonts.regular);
      doc.addFont('NotoSansEthiopic-Regular.ttf', ETHIOPIC_FONT, 'normal');
      doc.addFileToVFS('NotoSansEthiopic-Bold.ttf', fonts.bold || fonts.regular);
      doc.addFont('NotoSansEthiopic-Bold.ttf', ETHIOPIC_FONT, 'bold');
      available = true;
    } catch {
      available = false;
    }
  }
  const wrap = (name) => {
    const original = doc[name];
    doc[name] = function ethiopicAware(text, ...rest) {
      if (!hasEthiopic(text)) return original.call(doc, text, ...rest);
      if (!available) return original.call(doc, stripEthiopic(text), ...rest);
      const { fontName, fontStyle } = doc.getFont();
      doc.setFont(ETHIOPIC_FONT, /bold/i.test(fontStyle) ? 'bold' : 'normal');
      try {
        return original.call(doc, text, ...rest);
      } finally {
        doc.setFont(fontName, fontStyle);
      }
    };
  };
  ['text', 'getTextWidth', 'getStringUnitWidth', 'splitTextToSize'].forEach(wrap);
  return available;
};

const setColor = (doc, rgb, kind = 'text') => {
  if (kind === 'fill') doc.setFillColor(...rgb);
  else if (kind === 'draw') doc.setDrawColor(...rgb);
  else doc.setTextColor(...rgb);
};

// Small line icons for the summary figures, drawn (no icon font), about
// 6 mm across, centred on (cx, cy).
const drawIcon = (doc, icon, cx, cy) => {
  setColor(doc, COLOR.slate, 'draw');
  setColor(doc, COLOR.slate, 'fill');
  doc.setLineWidth(0.45);
  const node = (x, y, r = 1.1) => doc.circle(x, y, r, 'F');
  if (icon === 'entities') {
    // three nodes in a small cluster
    doc.line(cx - 2, cy + 1.4, cx, cy - 1.8);
    doc.line(cx, cy - 1.8, cx + 2, cy + 1.4);
    node(cx, cy - 1.8);
    node(cx - 2, cy + 1.4);
    node(cx + 2, cy + 1.4);
  } else if (icon === 'links') {
    // two nodes and the link between them
    doc.line(cx - 2.2, cy + 1.6, cx + 2.2, cy - 1.6);
    node(cx - 2.2, cy + 1.6);
    node(cx + 2.2, cy - 1.6);
  } else if (icon === 'alert') {
    // a warning triangle with its mark
    setColor(doc, COLOR.gold, 'draw');
    setColor(doc, COLOR.gold, 'fill');
    doc.triangle(cx, cy - 2.6, cx - 2.9, cy + 2.2, cx + 2.9, cy + 2.2, 'S');
    doc.line(cx, cy - 1, cx, cy + 0.5);
    doc.circle(cx, cy + 1.3, 0.3, 'F');
  } else if (icon === 'pin') {
    // a map pin
    doc.circle(cx, cy - 1, 1.9, 'S');
    doc.circle(cx, cy - 1, 0.55, 'F');
    doc.line(cx - 1.35, cy + 0.35, cx, cy + 2.8);
    doc.line(cx + 1.35, cy + 0.35, cx, cy + 2.8);
  } else if (icon === 'bridge') {
    // two groups joined through one node
    doc.line(cx - 2.6, cy, cx + 2.6, cy);
    node(cx - 2.6, cy, 0.9);
    node(cx + 2.6, cy, 0.9);
    doc.circle(cx, cy, 1.2, 'S');
  } else {
    node(cx, cy, 1.4);
  }
};

// Mark colours (profile tags, the subjects' flags).
// Score bands (the Reports window's): fatal 90+, critical 80-89, high
// 50-79, medium 20-49, low 0-19.
const SCORE_TONE = { fatal: [128, 24, 36], critical: [178, 46, 46], high: [201, 98, 32], medium: [176, 132, 22], low: [46, 125, 82] };
const SCORE_BAND_LABEL = { fatal: 'Fatal · 90+', critical: 'Critical · 80-89', high: 'High · 50-79', medium: 'Medium · 20-49', low: 'Low · 0-19' };
const TAG_COLOR = { Pinned: [176, 128, 46], Alerted: [178, 60, 52], Bridge: [52, 93, 128] };
const marksOf = (raw) => String(raw || '').split(',').map((mark) => mark.trim()).filter((mark) => mark && mark !== '—' && mark !== '-');
// A small flag (pole and pennant) about 3 mm tall, centred on y.
const drawFlag = (doc, x, cy, color) => {
  setColor(doc, color, 'draw');
  setColor(doc, color, 'fill');
  doc.setLineWidth(0.35);
  doc.line(x + 0.2, cy - 1.7, x + 0.2, cy + 1.7);
  doc.triangle(x + 0.35, cy - 1.7, x + 2.7, cy - 0.85, x + 0.35, cy, 'F');
};

export const svgDataUrl = (svgText) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

// The NBE logo (an SVG) as a PNG for the PDF, at print resolution.
// Never holds the report up: no logo after `timeout` ms, and the cover
// writes "NBE" instead.
export const rasterizeSvg = (url, width = 800, timeout = 3000) => new Promise((resolve) => {
  if (typeof Image === 'undefined' || typeof document === 'undefined') {
    resolve(null);
    return;
  }
  setTimeout(() => resolve(null), timeout);
  const image = new Image();
  image.onload = () => {
    try {
      const ratio = image.naturalHeight && image.naturalWidth ? image.naturalHeight / image.naturalWidth : 0.39;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = Math.round(width * ratio);
      // A cleared canvas: the PNG keeps the logo's transparent background.
      const context = canvas.getContext('2d');
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve({ dataUrl: canvas.toDataURL('image/png'), ratio });
    } catch {
      resolve(null);
    }
  };
  image.onerror = () => resolve(null);
  image.src = url;
});

// A profile portrait (an image link or an embedded image, as the actor
// profile card shows it) as a JPEG for the PDF: cropped to the card's
// square frame at print size. null when it cannot be loaded or read (a server
// that does not allow it, a broken link, or after `timeout` ms): the card
// then shows the placeholder (no picture is made up).
export const loadPortrait = (url, width = 360, timeout = 5000) => new Promise((resolve) => {
  if (typeof Image === 'undefined' || typeof document === 'undefined' || !/^(https?:\/\/|data:image\/)/i.test(String(url || ''))) {
    resolve(null);
    return;
  }
  setTimeout(() => resolve(null), timeout);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.referrerPolicy = 'no-referrer';
  image.onload = () => {
    try {
      const height = width; // square (analyst decision 2026-11-17)
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      // Cover the frame, centred.
      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.88));
    } catch {
      resolve(null); // a server that does not allow reading the image
    }
  };
  image.onerror = () => resolve(null);
  image.src = url;
});

// fonts: { regular, bold } Noto Sans Ethiopic (base64), for reports with
// Ethiopic text (reportHasEthiopic).
export const reportHasEthiopic = (report) => ETHIOPIC_RE.test(JSON.stringify(report));
export async function renderGraphReportPdf(report, { snapshot = null, logo = null, portraits = {}, fonts = null } = {}) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  installEthiopic(doc, reportHasEthiopic(report) ? fonts : null);
  const kind = reportKindOf(report.kind);
  doc.setProperties({ title: pdfText(report.cover.title), subject: `LinkX ${kind.name}`, creator: `LinkX · ${REPORT_TEMPLATE.name} v${REPORT_TEMPLATE.version}` });
  let y = PAGE.top;

  /* ── Cover ── */
  const drawCover = () => {
    setColor(doc, COLOR.navy, 'fill');
    doc.rect(0, 0, PAGE.width, PAGE.height, 'F');
    // NBE header with the logo as it is (its own colours, transparent
    // background), on the cover's navy (analyst decision 2026-11-17).
    if (logo?.dataUrl) {
      const height = 30;
      doc.addImage(logo.dataUrl, 'PNG', PAGE.margin, 9, height / logo.ratio, height);
    } else {
      setColor(doc, COLOR.white);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      doc.text('NBE', PAGE.margin, 27);
    }
    setColor(doc, COLOR.navySoft, 'draw');
    doc.setLineWidth(0.3);
    doc.line(PAGE.margin, 46, PAGE.width - PAGE.margin, 46);
    setColor(doc, COLOR.coverMuted);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(`LINK ANALYSIS · ${kind.header}`, PAGE.width - PAGE.margin, 24, { align: 'right' });
    // Gold accent and the title block.
    setColor(doc, COLOR.gold, 'fill');
    doc.rect(PAGE.margin, 62, 18, 1.6, 'F');
    setColor(doc, COLOR.coverMuted);
    doc.setFont('helvetica', 'normal');
    // A long domain distribution shrinks the line to fit (down to 7 pt),
    // then is cut to one line.
    const domainLine = pdfText(report.cover.domain ? `NATIONAL BANK OF ETHIOPIA · Domain : ${report.cover.domain.toUpperCase()}` : 'NATIONAL BANK OF ETHIOPIA');
    let domainSize = 9;
    doc.setFontSize(domainSize);
    while (domainSize > 7 && doc.getTextWidth(domainLine) > CONTENT) {
      domainSize -= 0.5;
      doc.setFontSize(domainSize);
    }
    doc.text(doc.splitTextToSize(domainLine, CONTENT)[0], PAGE.margin, 80);
    setColor(doc, COLOR.white);
    doc.setFont('helvetica', 'bold');
    // 22 pt (analyst decision 2026-11-18: was 28).
    doc.setFontSize(22);
    const titleLines = doc.splitTextToSize(pdfText(report.cover.title), CONTENT);
    doc.text(titleLines.slice(0, 3), PAGE.margin, 93, { lineHeightFactor: 1.15 });
    let cursor = 93 + titleLines.slice(0, 3).length * 9;
    if (report.cover.purpose) {
      setColor(doc, COLOR.coverMuted);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(12);
      const purpose = doc.splitTextToSize(pdfText(report.cover.purpose), CONTENT);
      doc.text(purpose.slice(0, 4), PAGE.margin, cursor + 4, { lineHeightFactor: 1.35 });
      cursor += 4 + purpose.slice(0, 4).length * 6;
    }
    // The case ID under the purpose, larger than it and in gold (analyst
    // decision 2026-11-17); so it is not repeated in the ledger below.
    // Always there: without one it reads "Case ID - Undefined".
    const caseId = report.cover.fields.find(([label]) => label === 'Case ID')?.[1];
    const hasCase = Boolean(caseId) && caseId !== '—';
    const caseText = hasCase ? `${/^case/i.test(caseId) ? '' : 'Case '}${caseId}` : 'Case ID - Undefined';
    setColor(doc, COLOR.gold);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    const caseLines = doc.splitTextToSize(pdfText(caseText), CONTENT).slice(0, 2);
    doc.text(caseLines, PAGE.margin, cursor + 6, { lineHeightFactor: 1.2 });
    cursor += 6 + caseLines.length * 6.5;
    const ledger = report.cover.fields.filter(([label]) => label !== 'Case ID');
    // The cover fields as a ledger (analyst decision 2026-11-17: minimal,
    // in the cover's own type): a thin gold line down the left, one field per line,
    // the label in small muted capitals (as the purpose) in a left column and the value in
    // white beside it; compact rows, no lines between them, no fill, no box.
    const inset = 6; // from the gold line
    const left = PAGE.margin + inset;
    const labelWidth = 64;
    const valueWidth = CONTENT - inset - labelWidth;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const valueLines = ledger.map(([, value]) => doc.splitTextToSize(pdfText(value), valueWidth).slice(0, 3));
    const heights = valueLines.map((wrapped) => 2.8 + wrapped.length * 4.5);
    const ledgerHeight = heights.reduce((sum, h) => sum + h, 0) + 0.6;
    // Kept clear of the marking at the foot: moved up (never over the title block).
    const top = Math.max(cursor + 8, Math.min(Math.max(cursor + 18, 205), PAGE.height - 30 - ledgerHeight));
    setColor(doc, COLOR.gold, 'draw');
    doc.setLineWidth(0.5);
    doc.line(PAGE.margin, top, PAGE.margin, top + ledgerHeight);
    let rowY = top;
    ledger.forEach(([label], index) => {
      const baseline = rowY + 4.6;
      setColor(doc, COLOR.coverMuted); // as the purpose line, regular weight (analyst decisions 2026-11-17)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.text(pdfText(label.toUpperCase()), left, baseline - 0.4, { charSpace: 0.12, maxWidth: labelWidth - 4 });
      setColor(doc, COLOR.white);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.text(valueLines[index], left + labelWidth, baseline, { lineHeightFactor: 1.3 });
      rowY += heights[index];
    });
    setColor(doc, COLOR.coverMuted);
    doc.setFontSize(8.5);
    doc.text(pdfText(report.cover.marking), PAGE.margin, PAGE.height - 18);
  };

  /* ── Flow helpers ── */
  const newPage = () => {
    doc.addPage();
    y = PAGE.top;
  };
  const room = () => PAGE.height - PAGE.bottom - y;
  // Estimated heights (mm) for keeping blocks together.
  const tableHeight = (rows) => 11 + rows * 9.4;
  const blockHeight = (block) => {
    if (block.type === 'table') return block.rows.length ? tableHeight(block.rows.length) + 4 + (block.note ? 6 : 0) : 0;
    if (block.type === 'subheading') return 12;
    if (block.type === 'paragraph') return 6 + Math.ceil(String(block.text || '').length / 95) * 5;
    if (block.type === 'bullets') return block.items.length * 6 + 2;
    if (block.type === 'bars') return 56;
    if (block.type === 'figures') return 20;
    if (block.type === 'signature') return 36;
    return 10;
  };
  // The first part of a block that must sit under its subheading.
  const leadHeight = (block) => {
    if (block.type === 'table') return tableHeight(Math.min(block.rows.length, 3));
    if (block.type === 'bullets') return Math.min(block.items.length, 3) * 6;
    return blockHeight(block);
  };
  const ensure = (height) => {
    if (room() < height) newPage();
  };
  const paragraph = (text, { size = 10, color = COLOR.text, gap = 3 } = {}) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    setColor(doc, color);
    const lineHeight = size * 0.48;
    doc.splitTextToSize(pdfText(text), CONTENT).forEach((line) => {
      ensure(lineHeight);
      doc.text(line, PAGE.margin, y + lineHeight * 0.8);
      y += lineHeight;
    });
    y += gap;
  };
  const subheading = (text) => {
    ensure(16);
    y += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12.5);
    setColor(doc, COLOR.slate);
    doc.text(pdfText(text), PAGE.margin, y + 5);
    y += 9;
  };
  const bullets = (items) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setColor(doc, COLOR.text);
    items.forEach((item) => {
      const wrapped = doc.splitTextToSize(pdfText(item), CONTENT - 5);
      wrapped.forEach((line, index) => {
        ensure(5);
        if (index === 0) doc.text('•', PAGE.margin, y + 4);
        doc.text(line, PAGE.margin + 5, y + 4);
        y += 4.9;
      });
      y += 0.8;
    });
    y += 2;
  };
  // Summary figures (analyst decision 2026-11-17): one tight row of
  // tiles, each a small drawn icon beside its value and label.
  const figures = (items) => {
    const height = 15;
    ensure(height + 4);
    const width = CONTENT / items.length;
    items.forEach((item, index) => {
      const x = PAGE.margin + index * width;
      setColor(doc, COLOR.figure, 'fill');
      setColor(doc, COLOR.border, 'draw');
      doc.setLineWidth(0.2);
      doc.rect(x, y, width, height, 'FD');
      drawIcon(doc, item.icon, x + 7.5, y + height / 2);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      setColor(doc, COLOR.navy);
      doc.text(pdfText(item.value), x + 14, y + 7.2);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      setColor(doc, COLOR.muted);
      doc.text(pdfText(item.label), x + 14, y + 11.6, { maxWidth: width - 16 });
    });
    y += height + 5;
  };
  const table = ({ head, rows, widths, note, flagColumn = null }) => {
    if (!rows.length) return;
    // A short table is kept whole on one page; a long one starts with at
    // least its head and three rows (never a head alone at a page foot).
    ensure(tableHeight(rows.length) <= 100 ? tableHeight(rows.length) : tableHeight(3));
    autoTable(doc, {
      startY: y,
      head: [head.map(pdfText)],
      body: rows.map((row) => row.map(pdfText)),
      margin: { left: PAGE.margin, right: PAGE.margin, top: PAGE.top, bottom: PAGE.bottom },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 2.6, bottom: 2.6, left: 3, right: 3 }, textColor: COLOR.text, lineColor: COLOR.border, lineWidth: 0.2, overflow: 'linebreak' },
      headStyles: { fillColor: COLOR.navy, textColor: COLOR.white, fontStyle: 'bold', lineColor: COLOR.navy },
      alternateRowStyles: { fillColor: COLOR.stripe },
      columnStyles: Object.fromEntries((widths || []).map((share, index) => [index, { cellWidth: share * CONTENT }])),
      // A flag column: each mark ("Pinned, Bridge") drawn as a small flag
      // in its colour before its word; "—" stays as text.
      ...(flagColumn == null ? {} : {
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === flagColumn && marksOf(data.cell.raw).length) data.cell.text = [''];
        },
        didDrawCell: (data) => {
          if (data.section !== 'body' || data.column.index !== flagColumn) return;
          const marks = marksOf(data.cell.raw);
          let fx = data.cell.x + 3;
          const cy = data.cell.y + data.cell.height / 2;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          marks.forEach((mark) => {
            const color = TAG_COLOR[mark] || COLOR.slate;
            drawFlag(doc, fx, cy, color);
            setColor(doc, COLOR.text);
            doc.text(pdfText(mark), fx + 3.6, cy + 1.1);
            fx += 3.6 + doc.getTextWidth(pdfText(mark)) + 3.2;
          });
        },
      }),
    });
    y = doc.lastAutoTable.finalY + 4;
    if (note) paragraph(note, { size: 8, color: COLOR.muted });
  };
  const image = (dataUrl, caption, maxHeight = 150) => {
    if (!dataUrl) return;
    const { width, height } = doc.getImageProperties(dataUrl);
    // The graph sits inside a padded frame (analyst decision 2026-11-17).
    const pad = 4;
    let w = CONTENT - pad * 2;
    let h = (height / width) * w;
    if (h > maxHeight) {
      h = maxHeight;
      w = (width / height) * h;
    }
    ensure(h + pad * 2 + 10);
    const x = PAGE.margin + (CONTENT - w) / 2;
    setColor(doc, COLOR.border, 'draw');
    doc.setLineWidth(0.3);
    doc.rect(PAGE.margin, y, CONTENT, h + pad * 2);
    doc.addImage(dataUrl, /^data:image\/jpe?g/i.test(dataUrl) ? 'JPEG' : 'PNG', x, y + pad, w, h, undefined, 'FAST');
    y += h + pad * 2 + 2;
    paragraph(caption, { size: 8, color: COLOR.muted });
  };
  // Profile cards (analyst decisions 2026-11-17): one full-width card per
  // entity: a square portrait (or a placeholder) on the left; beside it the
  // name with its marks as tags on the right, its type and links, then the
  // actor profile's fields in a three-column grid of small labels over
  // their values (a long value spans the rest of its row, up to two lines).
  // A thin rule in the entity's mark colour runs down the card's left edge.
  const PHOTO = 28; // square, mm
  const PROFILE_COLUMNS = 3;
  const profileLayout = (item) => {
    const tx = 5 + PHOTO + 6;
    const tw = CONTENT - tx - 5;
    const cell = tw / PROFILE_COLUMNS;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const fieldsTop = 22;
    const slots = [];
    let offset = 0;
    let col = 0;
    let rowHeight = 9.5;
    const nextRow = () => { offset += rowHeight; col = 0; rowHeight = 9.5; };
    item.fields.forEach(([label, value]) => {
      const text = pdfText(value);
      let span = Math.min(PROFILE_COLUMNS, Math.ceil((doc.getTextWidth(text) + 3) / cell));
      if (col + span > PROFILE_COLUMNS) nextRow();
      span = Math.min(span, PROFILE_COLUMNS - col);
      const width = span * cell - 3;
      const lines = doc.splitTextToSize(text, width).slice(0, 2);
      slots.push({ label, value, lines, dx: tx + col * cell, offset });
      rowHeight = Math.max(rowHeight, 9.5 + (lines.length - 1) * 3.8);
      col += span;
      if (col >= PROFILE_COLUMNS) nextRow();
    });
    if (col > 0) nextRow();
    const height = Math.max(5 + PHOTO + 5, fieldsTop + offset + 2);
    return { tx, tw, slots, fieldsTop, height };
  };
  const profileHeight = (item) => profileLayout(item).height;
  const placeholder = (px, py) => {
    setColor(doc, COLOR.figure, 'fill');
    doc.rect(px, py, PHOTO, PHOTO, 'F');
    setColor(doc, [184, 197, 213], 'fill');
    doc.circle(px + PHOTO / 2, py + PHOTO * 0.38, PHOTO * 0.16, 'F');
    doc.ellipse(px + PHOTO / 2, py + PHOTO - PHOTO * 0.17, PHOTO * 0.3, PHOTO * 0.17, 'F');
  };
  const profiles = (items) => {
    items.forEach((item) => {
      const { tx, tw, slots, fieldsTop, height } = profileLayout(item);
      ensure(height + 5);
      const x = PAGE.margin;
      setColor(doc, COLOR.white, 'fill');
      setColor(doc, COLOR.border, 'draw');
      doc.setLineWidth(0.25);
      doc.rect(x, y, CONTENT, height, 'FD');
      const mark = ['Alerted', 'Pinned', 'Bridge'].find((tag) => item.tags?.includes(tag));
      setColor(doc, mark ? TAG_COLOR[mark] : COLOR.navy, 'fill');
      doc.rect(x, y, 1, height, 'F');
      // Square portrait, or the placeholder.
      const px = x + 5;
      const py = y + 5;
      const photo = item.portrait ? portraits[item.portrait] : null;
      if (photo) {
        try {
          doc.addImage(photo, /^data:image\/png/i.test(photo) ? 'PNG' : 'JPEG', px, py, PHOTO, PHOTO, undefined, 'FAST');
        } catch {
          placeholder(px, py);
        }
      } else placeholder(px, py);
      setColor(doc, COLOR.border, 'draw');
      doc.setLineWidth(0.2);
      doc.rect(px, py, PHOTO, PHOTO, 'S');
      // Tags on the right of the name line.
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.4);
      const tags = (item.tags || []).slice(0, 3);
      const tagWidths = tags.map((tag) => doc.getTextWidth(tag.toUpperCase()) + 3.6);
      let tagX = x + tx + tw - tagWidths.reduce((sum, w) => sum + w + 1.4, 0) + 1.4;
      const tagsLeft = tagX;
      tags.forEach((tag, i) => {
        const color = TAG_COLOR[tag] || COLOR.slate;
        setColor(doc, color, 'draw');
        doc.setLineWidth(0.25);
        doc.rect(tagX, y + 5.2, tagWidths[i], 4.2, 'S');
        setColor(doc, color);
        doc.text(tag.toUpperCase(), tagX + 1.8, y + 8.1, { charSpace: 0.1 });
        tagX += tagWidths[i] + 1.4;
      });
      // Name, then type · links.
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12.5);
      setColor(doc, COLOR.navy);
      doc.text(doc.splitTextToSize(pdfText(item.name), Math.max(30, tagsLeft - (x + tx) - 4))[0] || '', x + tx, y + 9.6);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      setColor(doc, COLOR.muted);
      const meta = [item.type, item.links != null ? `${item.links} ${item.links === 1 ? 'link' : 'links'}` : ''].filter(Boolean).join('  ·  ');
      if (meta) doc.text(pdfText(meta), x + tx, y + 14.4);
      setColor(doc, COLOR.border, 'draw');
      doc.setLineWidth(0.2);
      doc.line(x + tx, y + fieldsTop - 4.8, x + tx + tw, y + fieldsTop - 4.8);
      // The actor profile's fields.
      slots.forEach(({ label, value, lines, dx, offset }) => {
        const fy = y + fieldsTop + offset;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6.4);
        setColor(doc, COLOR.muted);
        doc.text(pdfText(label.toUpperCase()), x + dx, fy, { charSpace: 0.25 });
        doc.setFontSize(9);
        setColor(doc, value === '—' ? COLOR.muted : COLOR.text);
        doc.text(lines, x + dx, fy + 4.1, { lineHeightFactor: 1.2 });
      });
      y += height + 5;
    });
  };



  const bars = ({ title, items }) => {
    const height = 42;
    ensure(height + 14);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    setColor(doc, COLOR.muted);
    doc.text(pdfText(title), PAGE.margin, y + 3);
    y += 6;
    const max = Math.max(1, ...items.map((item) => item.value));
    const slot = CONTENT / items.length;
    const barWidth = Math.max(0.8, slot * 0.7);
    setColor(doc, COLOR.border, 'draw');
    doc.setLineWidth(0.2);
    doc.line(PAGE.margin, y + height, PAGE.margin + CONTENT, y + height);
    items.forEach((item, index) => {
      const h = (item.value / max) * (height - 4);
      const x = PAGE.margin + index * slot + (slot - barWidth) / 2;
      setColor(doc, item.value === max ? COLOR.gold : COLOR.slate, 'fill');
      if (h > 0) doc.rect(x, y + height - h, barWidth, h, 'F');
    });
    // First, middle and last labels (the rest would crowd).
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    setColor(doc, COLOR.muted);
    const marks = [...new Set([0, Math.floor((items.length - 1) / 2), items.length - 1])];
    marks.forEach((index) => {
      const align = index === 0 ? 'left' : index === items.length - 1 ? 'right' : 'center';
      const x = align === 'left' ? PAGE.margin : align === 'right' ? PAGE.margin + CONTENT : PAGE.margin + (index + 0.5) * slot;
      doc.text(pdfText(items[index].label), x, y + height + 4, { align });
    });
    y += height + 9;
  };
  const signature = (name) => {
    ensure(36);
    y += 6;
    const width = (CONTENT - 10) / 3;
    [['Analyst / Investigator', name || ''], ['Signature', ''], ['Date', '']].forEach(([label, value], index) => {
      const x = PAGE.margin + index * (width + 5);
      setColor(doc, COLOR.text);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      if (value) {
        const name = doc.splitTextToSize(pdfText(value), width).slice(0, 2);
        doc.text(name, x, y + 13 - (name.length - 1) * 4.6, { lineHeightFactor: 1.2 });
      }
      setColor(doc, COLOR.muted, 'draw');
      doc.setLineWidth(0.3);
      doc.line(x, y + 15, x + width, y + 15);
      doc.setFontSize(8);
      setColor(doc, COLOR.muted);
      doc.text(pdfText(label), x, y + 20);
    });
    y += 26;
  };

  // The fraudulence score stamp (analyst decisions 2026-11-18): the
  // page's top-right corner washed in the band's colour, as the Generate
  // report popup's corner is in its accent, and over it, upright and
  // without a border, the label, the score large and the band.
  // Returns the width it takes from the heading (with its gap).
  const STAMP = { width: 50, height: 22, tilt: 0 };
  const drawCornerWash = (tone) => {
    // A radial fade from the corner: rings blended on white (the page),
    // strongest at the corner and gone at 70 % of the radius.
    const steps = 90;
    for (let i = 0; i < steps; i += 1) {
      const t = 1 - i / steps;
      const strength = t >= 0.75 ? 0 : 0.26 * (1 - t / 0.75) ** 1.3;
      if (strength <= 0) continue;
      setColor(doc, tone.map((channel) => Math.round(255 + (channel - 255) * strength)), 'fill');
      doc.ellipse(PAGE.width, 0, 150 * t, 95 * t, 'F');
    }
  };
  const drawScoreStamp = (score, top) => {
    const tone = SCORE_TONE[score.band] || COLOR.slate;
    drawCornerWash(tone);
    const cx = PAGE.width - PAGE.margin - STAMP.width / 2;
    const cy = top + 5;
    const angle = (STAMP.tilt * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // Local (from the stamp's centre, unrotated) to page; tilted anticlockwise.
    const at = (dx, dy) => [cx + dx * cos + dy * sin, cy - dx * sin + dy * cos];
    setColor(doc, tone);
    const centred = (text, dy, size, { charSpace = 0 } = {}) => {
      doc.setFontSize(size);
      const width = doc.getTextWidth(text) + charSpace * Math.max(0, text.length - 1);
      const [x, yy] = at(-width / 2, dy);
      doc.text(text, x, yy, { angle: STAMP.tilt, charSpace });
    };
    doc.setFont('helvetica', 'bold');
    centred('FRAUDULENCE SCORE', -5.6, 6.5, { charSpace: 0.35 });
    centred(pdfText(score.value), 3.4, 24);
    if (score.band) centred(pdfText(SCORE_BAND_LABEL[score.band].toUpperCase()), 7.5, 6, { charSpace: 0.3 });
    doc.setLineWidth(0.2);
    return STAMP.width + 8;
  };

  /* ── Pages ── */
  drawCover();
  const sectionPages = new Map();
  let contentsSlot = null;
  report.sections.forEach((section) => {
    newPage();
    sectionPages.set(section.id, doc.getNumberOfPages());
    // Section heading (analyst decision 2026-11-17): a gold bar down the
    // left of the label and title; number and title in navy.
    const inset = 5;
    // The evidence's fraudulence score stamped at the Summary heading's
    // right end (drawn first: its corner wash lies under everything).
    const badge = section.id === 'summary' && report.score ? drawScoreStamp(report.score, y) : 0;
    setColor(doc, COLOR.gold, 'fill');
    doc.rect(PAGE.margin, y - 0.5, 1.3, 14, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    setColor(doc, COLOR.slate);
    doc.text(pdfText(section.eyebrow.toUpperCase()), PAGE.margin + inset, y + 3, { charSpace: 0.2 });
    const number = pdfText(section.appendix ? `Appendix ${section.number} · ` : `${section.number}  `);
    const title = pdfText(section.title);
    doc.setFont('helvetica', 'bold');
    // Long headings shrink to the line.
    let size = 24;
    doc.setFontSize(size);
    while (size > 14 && doc.getTextWidth(number + title) > CONTENT - inset - badge) {
      size -= 1;
      doc.setFontSize(size);
    }
    setColor(doc, COLOR.navy);
    doc.text(number + title, PAGE.margin + inset, y + 11.6);
    y += 20;
    section.blocks.forEach((block, index) => {
      // Profile cards start on a page with room for all of them (under their heading).
      const next = section.blocks[index + 1];
      if (block.type === 'subheading' && next?.type === 'profiles') {
        const height = 16 + next.items.reduce((sum, item) => sum + profileHeight(item) + 5, 0);
        if (height < PAGE.height - PAGE.top - PAGE.bottom) ensure(height);
      }
      // A subheading is kept with the start of what it heads.
      if (block.type === 'subheading' && next && next.type !== 'profiles') ensure(16 + leadHeight(next));
      if (block.type === 'paragraph') paragraph(block.text, block.tone === 'muted' ? { size: 9, color: COLOR.muted } : {});
      else if (block.type === 'subheading') subheading(block.text);
      else if (block.type === 'bullets') bullets(block.items);
      else if (block.type === 'figures') figures(block.items);
      else if (block.type === 'table') table(block);
      else if (block.type === 'image') {
        // The graph is sized so the rest of its section fits on the same
        // page (analyst decision 2026-11-17), between 70 and 150 mm tall.
        const rest = section.blocks.slice(index + 1).reduce((sum, after) => sum + blockHeight(after), 0);
        image(block.key === 'snapshot' ? snapshot : null, block.caption, Math.max(70, Math.min(150, room() - rest - 18)));
      }
      else if (block.type === 'profiles') profiles(block.items);
      else if (block.type === 'bars') bars(block);
      else if (block.type === 'signature') signature(block.name);
      else if (block.type === 'contents') {
        // Filled in once every section's page is known.
        const height = 8 + 9 + report.sections.length * 7.5;
        subheading('Contents');
        ensure(height);
        contentsSlot = { page: doc.getNumberOfPages(), y };
        y += height;
      }
    });
  });

  // Contents (pages counted from the first inner page, as the template).
  if (contentsSlot) {
    doc.setPage(contentsSlot.page);
    const rows = report.sections.map((section) => [section.appendix ? `Appendix ${section.number}` : section.number, section.title, String(sectionPages.get(section.id) - 1)]);
    autoTable(doc, {
      startY: contentsSlot.y,
      head: [['Section', 'Topic', 'Page']],
      body: rows.map((row) => row.map(pdfText)),
      margin: { left: PAGE.margin, right: PAGE.margin },
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.4, textColor: COLOR.text, lineColor: COLOR.border, lineWidth: 0.2 },
      headStyles: { fillColor: COLOR.navy, textColor: COLOR.white, fontStyle: 'bold', lineColor: COLOR.navy },
      alternateRowStyles: { fillColor: COLOR.stripe },
      columnStyles: { 0: { cellWidth: 26 }, 2: { cellWidth: 18 } },
    });
  }

  // Running header and footer on every inner page.
  const pages = doc.getNumberOfPages();
  const reference = report.cover.fields.find(([label]) => label === 'Analysis Reference ID')?.[1] || '';
  const caseId = report.cover.fields.find(([label]) => label === 'Case ID')?.[1] || '';
  const dateTime = report.cover.fields.find(([label]) => label === 'Date & Time of Report')?.[1] || '';
  for (let page = 2; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    setColor(doc, COLOR.muted);
    doc.text(`NBE · LINKX ${kind.header}`, PAGE.margin, 13);
    const casePart = caseId && caseId !== '—' ? `${/^case/i.test(caseId) ? '' : 'CASE '}${caseId} · ` : '';
    doc.text(pdfText(`${casePart}REF ${reference} · ${dateTime}`), PAGE.width - PAGE.margin, 13, { align: 'right' });
    setColor(doc, COLOR.border, 'draw');
    doc.setLineWidth(0.25);
    doc.line(PAGE.margin, 16, PAGE.width - PAGE.margin, 16);
    doc.line(PAGE.margin, PAGE.height - 15, PAGE.width - PAGE.margin, PAGE.height - 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(pdfText(report.cover.marking), PAGE.margin, PAGE.height - 10);
    doc.text(`${page - 1} / ${pages - 1}`, PAGE.width - PAGE.margin, PAGE.height - 10, { align: 'right' });
  }
  // CONFIDENTIAL across every page (analyst decision 2026-11-18: every
  // report and picture the service exports carries it).
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    drawWatermark(doc, { cover: page === 1 });
  }
  return doc;
}

// "CONFIDENTIAL" from the bottom-left to the top-right of a page (45°),
// faint, over the content: grey on the white pages, white on the navy cover.
export const WATERMARK = 'CONFIDENTIAL';
// page: { width, height } in mm (A4 portrait unless given: the table's
// landscape pages).
export const drawWatermark = (doc, { cover = false, page = PAGE } = {}) => {
  const size = 92;
  doc.saveGraphicsState();
  if (typeof doc.GState === 'function') doc.setGState(new doc.GState({ opacity: cover ? 0.06 : 0.12 }));
  setColor(doc, cover ? COLOR.white : [141, 151, 163]);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(size);
  const width = doc.getTextWidth(WATERMARK);
  const half = width / 2 / Math.SQRT2;
  // Centred on the page: the text's start moved back along its 45° line,
  // and down by half its height across it.
  const lift = (size * 0.3528 * 0.35) / Math.SQRT2;
  doc.text(WATERMARK, page.width / 2 - half + lift, page.height / 2 + half + lift, { angle: 45 });
  doc.restoreGraphicsState();
};

// LinkxGraph_Report_… or LinkxEvidence_Report_… (REPORT_KINDS).
export const reportFileName = (reference, kind = 'graph') => {
  const safe = String(reference || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return `${reportKindOf(kind).file}_${safe ? `${safe}_` : ''}${Date.now()}.pdf`;
};
