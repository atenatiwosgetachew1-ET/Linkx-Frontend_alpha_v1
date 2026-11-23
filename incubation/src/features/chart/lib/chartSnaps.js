// The Chart window's pictures (Export ▸ Take snaps, Print charts; analyst
// decisions 2026-11-18).
//
// Every chart becomes a CELL of one fixed size: a framed card with its title
// and level over the chart, drawn off screen at SNAP.scale times its size,
// so a picture is sharp whatever the card's size on screen, and cells line
// up in a grid without gaps (they used to be copies of the cards as shown,
// of every shape, stretched). A chart is drawn from its live option, so it
// keeps its zoom, colours and selection pins; the zoom slider is left out.

const FONT = 'Manrope, "Segoe UI", Roboto, Arial, sans-serif';

// Snaps are A4 pages (analyst decision 2026-11-18), in CSS pixels at 96 dpi
// (794 x 1123), drawn at `scale` (about 290 dpi). A cell's parts: its head
// (level, title), the chart, padding; `gap` between cells.
export const SNAP = Object.freeze({ head: 44, pad: 12, gap: 14, scale: 3 });
export const A4 = Object.freeze({ width: 794, height: 1123 });
// The cell sizes: two across an A4 page (Group, Print), or one at full width
// (Individual). Charts are drawn at these sizes, not shrunk, so their text
// stays legible on paper.
export const CELLS = Object.freeze({
  group: Object.freeze({ width: 368, chart: 206 }),
  single: Object.freeze({ width: 750, chart: 400 }),
});
const cellHeight = (size) => SNAP.head + size.chart + SNAP.pad;

// A picture's image, or null when it does not load (in time).
export const loadImage = (url, timeout = 3000) => new Promise((resolve) => {
  if (!url) {
    resolve(null);
    return;
  }
  const image = new Image();
  const timer = setTimeout(() => resolve(null), timeout);
  image.onload = () => {
    clearTimeout(timer);
    resolve(image);
  };
  image.onerror = () => {
    clearTimeout(timer);
    resolve(null);
  };
  image.src = url;
});

const roundRect = (context, x, y, width, height, radius) => {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
};

// A blank cell: its frame, title and level; -> { canvas, context } or null.
// The drawing is in CSS pixels (the context scaled).
const blankCell = (title, level, theme, size) => {
  const canvas = document.createElement('canvas');
  canvas.width = size.width * SNAP.scale;
  canvas.height = cellHeight(size) * SNAP.scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(SNAP.scale, SNAP.scale);
  context.fillStyle = theme.background || '#ffffff';
  context.fillRect(0, 0, size.width, cellHeight(size));
  roundRect(context, 0.5, 0.5, size.width - 1, cellHeight(size) - 1, 6);
  context.fillStyle = theme.surface || theme.background || '#ffffff';
  context.fill();
  context.strokeStyle = theme.border || 'rgba(0,0,0,0.14)';
  context.lineWidth = 1;
  context.stroke();
  // The card's tone washing in from its top-left corner, as on screen.
  if (theme.tone) {
    try {
      const wash = context.createRadialGradient(0, 0, 0, 0, 0, size.width * 0.7);
      wash.addColorStop(0, theme.tone);
      wash.addColorStop(1, 'rgba(255,255,255,0)');
      context.save();
      context.globalAlpha = 0.12;
      context.fillStyle = wash;
      context.fillRect(1, 1, size.width - 2, SNAP.head + 24);
      context.restore();
    } catch {
      // A tone the canvas does not read: no wash.
    }
  }
  context.fillStyle = theme.muted || '#777777';
  context.font = `600 9.5px ${FONT}`;
  context.fillText(String(level || '').toUpperCase(), SNAP.pad, 17);
  context.fillStyle = theme.text || '#222222';
  context.font = `700 14px ${FONT}`;
  context.fillText(title, SNAP.pad, 35);
  context.fillStyle = theme.border || 'rgba(0,0,0,0.14)';
  context.fillRect(SNAP.pad, SNAP.head - 1, size.width - SNAP.pad * 2, 1);
  return { canvas, context };
};

// The live option, as a snap draws it: no animation, no zoom slider (its
// window kept on the inside zoom).
export const snapOption = (option) => ({
  ...option,
  animation: false,
  dataZoom: (option.dataZoom || []).map((zoom) => (zoom.type === 'slider' ? { ...zoom, show: false } : zoom)),
});

// The chart drawn off screen at the cell's chart size and the snap's scale.
// -> a PNG data URL, or null.
const renderOffscreen = (engine, option, size) => {
  if (!engine?.init || typeof document === 'undefined') return null;
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${size.width - SNAP.pad * 2}px;height:${size.chart}px;`;
  document.body.appendChild(host);
  let chart = null;
  try {
    chart = engine.init(host, null, { renderer: 'canvas', devicePixelRatio: SNAP.scale, width: size.width - SNAP.pad * 2, height: size.chart });
    chart.setOption(snapOption(option), true);
    return chart.getDataURL({ type: 'png', pixelRatio: SNAP.scale, backgroundColor: 'transparent' }) || null;
  } catch {
    return null;
  } finally {
    chart?.dispose?.();
    host.remove();
  }
};

// A chart card as a cell; engine: the ECharts module.
// -> a PNG data URL (the chart alone when a cell cannot be drawn), or null.
// option: the chart's option for the snap (else read from `live`, the
// card's ECharts instance).
export const chartCell = async ({ engine, live, option: given = null, title, level = '', theme = {}, size = CELLS.group }) => {
  const option = given || (typeof live?.getOption === 'function' ? live.getOption() : null);
  const chartUrl = (option && renderOffscreen(engine, option, size))
    || live?.getDataURL?.({ type: 'png', pixelRatio: SNAP.scale, backgroundColor: theme.background || '#ffffff' })
    || null;
  const cell = blankCell(title, level, theme, size);
  if (!cell) return chartUrl;
  const image = await loadImage(chartUrl);
  if (!image) return chartUrl;
  cell.context.drawImage(image, SNAP.pad, SNAP.head + 2, size.width - SNAP.pad * 2, size.chart - 4);
  return cell.canvas.toDataURL('image/png');
};

const figureText = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? value.toLocaleString('en-GB') : Number(value.toPrecision(4)).toLocaleString('en-GB', { maximumFractionDigits: 6 });
};

// A figures card (Global Metrics, Cohesion) as a cell: its label / value
// items in two columns, fitted to the cell. -> a PNG data URL, or null.
export const figuresCell = ({ title, level = '', items = [], theme = {}, size = CELLS.group }) => {
  const cell = blankCell(title, level, theme, size);
  if (!cell) return null;
  const { context } = cell;
  const columns = items.length > 6 && size.width > 500 ? 2 : 1;
  const perColumn = Math.max(1, Math.ceil(items.length / columns));
  const columnWidth = (size.width - SNAP.pad * 2 - (columns - 1) * SNAP.gap) / columns;
  const row = Math.min(30, (size.chart - 12) / perColumn);
  const fontSize = Math.max(8, Math.min(12, row * 0.45));
  items.forEach((item, index) => {
    const column = Math.floor(index / perColumn);
    const x = SNAP.pad + column * (columnWidth + SNAP.gap);
    const y = SNAP.head + 10 + (index % perColumn) * row;
    // An item as on the card: a tinted strip with a left edge.
    context.fillStyle = theme.border || 'rgba(0,0,0,0.08)';
    context.fillRect(x, y, columnWidth, row - 4);
    context.fillStyle = theme.tone || theme.muted || '#777777';
    context.fillRect(x, y, 2.5, row - 4);
    context.fillStyle = theme.muted || '#777777';
    context.font = `${fontSize}px ${FONT}`;
    context.fillText(String(item.label), x + 8, y + (row - 4) / 2 + fontSize / 3);
    context.fillStyle = theme.text || '#222222';
    context.font = `700 ${fontSize + 1}px ${FONT}`;
    context.textAlign = 'right';
    context.fillText(figureText(item.value), x + columnWidth - 8, y + (row - 4) / 2 + fontSize / 3);
    context.textAlign = 'left';
  });
  return cell.canvas.toDataURL('image/png');
};

// The snap's frame (the NBE LinkX Chart Snap template, Libraries ▸ Report templates;
// analyst decision 2026-11-18), in three parts: a navy header (the NBE logo
// left; "LINK ANALYSIS · CHART SNAP", the source and the details right), a
// white body holding the cells (two across an A4 page, more pages as
// needed; analyst decision 2026-11-18) under a CONFIDENTIAL watermark (45°,
// as every export of the service carries), and a navy footer with the
// distribution marking and the page number.
export const FRAME = Object.freeze({
  header: 92,
  footer: 40,
  margin: 22,
  navy: '#131d29',
  gold: '#d4a85a',
  title: '#9fb5d6',
  text: '#d7dee8',
  watermark: '#8d97a3',
  marking: 'CONFIDENTIAL \u00b7 For authorised investigation use only',
});

// The charts as a snap draws them: dark text on white, whatever the
// window's theme (the body is white).
export const SNAP_THEME = Object.freeze({ text: '#1f2933', muted: '#66727f', line: '#2f3b48', background: '#ffffff', surface: '#ffffff', border: '#d5dde7' });

// The watermark across a box, from its bottom-left to its top-right.
const watermark = (context, x, y, width, height) => {
  const diagonal = Math.hypot(width, height);
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.translate(x + width / 2, y + height / 2);
  context.rotate(-Math.atan2(height, width));
  context.globalAlpha = 0.16;
  context.fillStyle = FRAME.watermark;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  let size = Math.min(150, diagonal / 6.5);
  context.font = `800 ${size}px ${FONT}`;
  // As wide as two thirds of the diagonal at most.
  while (size > 18 && context.measureText('CONFIDENTIAL').width > diagonal * 0.66) {
    size -= 4;
    context.font = `800 ${size}px ${FONT}`;
  }
  context.fillText('CONFIDENTIAL', 0, 0);
  context.restore();
};

// How cells sit on an A4 page: two across (Group, Print), or one at full
// width (Individual); as many rows as the body holds, then a new page.
export const pageLayout = (layout = 'group') => {
  const size = layout === 'single' ? CELLS.single : CELLS.group;
  const columns = layout === 'single' ? 1 : 2;
  const body = A4.height - FRAME.header - FRAME.footer;
  const rows = layout === 'single' ? 1 : Math.max(1, Math.floor((body - FRAME.margin * 2 + SNAP.gap) / (cellHeight(size) + SNAP.gap)));
  return { size, columns, rows, perPage: columns * rows };
};

// A page in the frame: { canvas, context, body: { x, y, width, height },
// finish() } (null without a canvas). paper: { width, height } (A4 portrait
// or landscape); finish() lays the watermark over the body, draws the footer
// and returns the PNG data URL. Header: navy; the logo left, the heading,
// the source and the details right.
export const framedPage = (logo, { title, source, details }, paper, page = 1, pages = 1) => {
  const { scale } = SNAP;
  const { margin } = FRAME;
  const { width, height } = paper;
  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.scale(scale, scale);
  context.fillStyle = FRAME.navy;
  context.fillRect(0, 0, width, FRAME.header);
  if (logo) {
    const logoHeight = FRAME.header - 28;
    const ratio = logo.naturalWidth && logo.naturalHeight ? logo.naturalWidth / logo.naturalHeight : 481.15 / 187.73;
    context.drawImage(logo, margin, 14, logoHeight * ratio, logoHeight);
  } else {
    context.fillStyle = FRAME.gold;
    context.font = `800 26px ${FONT}`;
    context.fillText('NBE', margin, FRAME.header / 2 + 9);
  }
  context.textAlign = 'right';
  context.fillStyle = FRAME.title;
  context.font = `700 11px ${FONT}`;
  context.fillText(title, width - margin, 34);
  context.fillStyle = FRAME.text;
  context.font = `10.5px ${FONT}`;
  if (source) context.fillText(source, width - margin, 54);
  context.fillStyle = FRAME.title;
  context.font = `9.5px ${FONT}`;
  if (details) context.fillText(details, width - margin, 70);
  context.textAlign = 'left';
  const body = { x: 0, y: FRAME.header, width, height: height - FRAME.header - FRAME.footer };
  context.fillStyle = '#ffffff';
  context.fillRect(body.x, body.y, body.width, body.height);
  const finish = () => {
    watermark(context, body.x, body.y, body.width, body.height);
    const footerTop = height - FRAME.footer;
    context.fillStyle = FRAME.navy;
    context.fillRect(0, footerTop, width, FRAME.footer);
    context.fillStyle = FRAME.text;
    context.font = `10.5px ${FONT}`;
    context.textBaseline = 'middle';
    context.fillText(FRAME.marking, margin, footerTop + FRAME.footer / 2);
    if (pages > 1) {
      context.textAlign = 'right';
      context.fillStyle = FRAME.title;
      context.fillText(`Page ${page} / ${pages}`, width - margin, footerTop + FRAME.footer / 2);
    }
    return canvas.toDataURL('image/png');
  };
  return { canvas, context, body, finish };
};

// One A4 page of cells: left to right, top to bottom, centred across.
const drawPage = (images, logo, texts, { size, columns }, page, pages) => {
  const framed = framedPage(logo, texts, A4, page, pages);
  if (!framed) return null;
  const { context, body } = framed;
  const cellH = cellHeight(size);
  const left = (A4.width - (columns * size.width + (columns - 1) * SNAP.gap)) / 2;
  images.forEach((image, index) => {
    const row = Math.floor(index / columns);
    context.drawImage(image, left + (index % columns) * (size.width + SNAP.gap), body.y + FRAME.margin + row * (cellH + SNAP.gap), size.width, cellH);
  });
  return framed.finish();
};

// A4 on its side.
export const A4_LANDSCAPE = Object.freeze({ width: A4.height, height: A4.width });

// One picture (the Graph window's snap) on an A4 page in the frame, fitted
// whole inside the body's margins (centred), with a thin border.
// orientation: 'portrait' | 'landscape'. -> a PNG data URL, or null.
export const framePicture = async (url, {
  title = 'LINK ANALYSIS \u00b7 GRAPH SNAP', source = '', details = '', logoUrl = '', orientation = 'landscape',
} = {}) => {
  const [logo, image] = await Promise.all([loadImage(logoUrl), loadImage(url)]);
  if (!image) return null;
  const paper = orientation === 'portrait' ? A4 : A4_LANDSCAPE;
  const framed = framedPage(logo, { title, source, details }, paper);
  if (!framed) return null;
  const { context, body } = framed;
  const room = { width: body.width - FRAME.margin * 2, height: body.height - FRAME.margin * 2 };
  const fit = Math.min(room.width / image.width, room.height / image.height);
  const width = image.width * fit;
  const height = image.height * fit;
  const x = body.x + (body.width - width) / 2;
  const y = body.y + (body.height - height) / 2;
  context.drawImage(image, x, y, width, height);
  context.strokeStyle = SNAP_THEME.border;
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  return framed.finish();
};

// cells: [{ url }] (cell pictures, drawn at the layout's cell size);
// title: the right-hand heading ("LINK ANALYSIS · CHART SNAP"); source /
// details: the lines under it; logoUrl: the NBE logo (an SVG data URL);
// layout: 'group' | 'single'. -> [PNG data URL], a page each (empty when
// nothing could be drawn).
export const framePages = async (cells, {
  title = 'LINK ANALYSIS \u00b7 CHART SNAP', source = '', details = '', logoUrl = '', layout = 'group',
} = {}) => {
  const [logo, ...images] = await Promise.all([loadImage(logoUrl), ...cells.map((cell) => loadImage(cell.url))]);
  const pictures = images.filter(Boolean);
  if (!pictures.length) return [];
  const place = pageLayout(layout);
  const pages = Math.ceil(pictures.length / place.perPage);
  const out = [];
  for (let page = 0; page < pages; page += 1) {
    const url = drawPage(pictures.slice(page * place.perPage, (page + 1) * place.perPage), logo, { title, source, details }, place, page + 1, pages);
    if (!url) return [];
    out.push(url);
  }
  return out;
};

// "ChartSnap_<window title>_<yyyymmdd-hhmm>.png"; an individual picture
// adds its chart's name; page: { number, count } when there are several.
export const snapFileName = (windowTitle, chartTitle = '', now = new Date(), page = null) => {
  const pad2 = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  const clean = (text) => String(text || '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  // A snap of several pages: "…_p2of3".
  const part = page ? [`p${page.number}of${page.count}`] : [];
  return ['ChartSnap', clean(windowTitle) || 'Chart', ...(chartTitle ? [clean(chartTitle)] : []), stamp, ...part].join('_') + '.png';
};

// Pages (A4 page pictures, as drawn above) as one PDF, a page each, edge to
// edge (Print charts ▸ Download PDF; analyst decision 2026-11-18).
// orientation: the pages' ('portrait' | 'landscape'). -> the jsPDF document.
export const pagesToPdf = async (pages, { orientation = 'portrait', title = 'LinkX charts' } = {}) => {
  const { jsPDF } = await import('jspdf');
  const landscape = orientation === 'landscape';
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait', compress: true });
  const width = landscape ? 297 : 210;
  const height = landscape ? 210 : 297;
  doc.setProperties({ title, creator: 'LinkX \u00b7 NBE LinkX Chart Snap' });
  pages.forEach((page, index) => {
    if (index) doc.addPage('a4', landscape ? 'landscape' : 'portrait');
    doc.addImage(page, 'PNG', 0, 0, width, height, undefined, 'FAST');
  });
  return doc;
};

// "LinkxCharts_<window title>_<yyyymmdd-hhmm>.pdf"
export const chartsPdfFileName = (windowTitle, now = new Date()) => snapFileName(windowTitle, '', now).replace(/^ChartSnap_/, 'LinkxCharts_').replace(/\.png$/, '.pdf');

