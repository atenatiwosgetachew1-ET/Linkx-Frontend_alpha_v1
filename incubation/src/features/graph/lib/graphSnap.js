// The Graph window's snap (Export ▸ Take a snap… / Print graph…; analyst
// decision 2026-11-18): the view as a picture, and up to four nodes' actor
// profile cards drawn into it beside their nodes, as the canvas shows it on a click (the
// card is not part of the canvas, so a plain capture never had it).

import { loadPortrait } from '../report/graphReportPdf.js';

const FONT = 'Manrope, "Segoe UI", Roboto, Arial, sans-serif';
// The card, in screen pixels (times the snap's scale in the picture).
// The fallback card follows the canvas card's proportions (graph.css
// .graph_profile: 8 px padding, 10 px gap, 10.5 px text on 14 px rows, the
// label 64 px wide beside its value, the portrait as tall as the details).
const CARD = Object.freeze({ offset: 18, margin: 8, pad: 8, gap: 10, row: 14.5, kicker: 19, label: 64, value: 140 });

const loadImage = (url, timeout = 4000) => new Promise((resolve) => {
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

// A value cut to fit a width, with an ellipsis.
const fitText = (context, text, width) => {
  if (context.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
};

// The most cards a picture carries (analyst decision 2026-11-18: more cover
// the graph they explain).
export const MAX_CARDS = 4;

// A card's size (screen pixels) for its fields.
const cardSize = (profile) => {
  const rows = Math.max(1, profile.fields.length);
  const side = CARD.kicker + rows * CARD.row; // the portrait: square, as tall as the details
  return { side, width: CARD.pad * 2 + side + CARD.gap + CARD.label + 6 + CARD.value, height: side + CARD.pad * 2 };
};

const overlaps = (a, b, gap = 6) => a.x < b.x + b.width + gap && b.x < a.x + a.width + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

// Where each box goes (the snap's cards, and the live cards on the canvas):
// beside its node (right, else left), inside the stage; a box that would
// cover one placed before moves to the nearest free place (down, then up,
// then the node's other side). boxes: [{ at: { x, y }, width, height }];
// stage: { width, height }; margin / offset: screen pixels. -> [{ x, y,
// width, height, moved }]
export const placeBoxes = (boxes, stage, { margin = CARD.margin, offset = CARD.offset } = {}) => {
  const placed = [];
  boxes.forEach(({ at, width, height }) => {
    const clampX = (x) => Math.max(margin, Math.min(x, stage.width - width - margin));
    const clampY = (y) => Math.max(margin, Math.min(y, stage.height - height - margin));
    const rightX = at.x + offset;
    const leftX = at.x - offset - width;
    const preferred = rightX + width <= stage.width - margin ? rightX : leftX;
    const other = preferred === rightX ? leftX : rightX;
    const free = (rect) => !placed.some((done) => overlaps(rect, done));
    const start = { x: clampX(preferred), y: clampY(at.y - height / 2), width, height };
    let spot = free(start) ? start : null;
    // Down, then up, in steps, on the preferred side, then the other.
    for (const x of [clampX(preferred), clampX(other)]) {
      for (let step = 1; !spot && step < 40; step += 1) {
        for (const direction of [1, -1]) {
          const y = at.y - height / 2 + direction * step * 12;
          const rect = { x, y: clampY(y), width, height };
          if (clampY(y) === y && free(rect)) {
            spot = rect;
            break;
          }
        }
      }
      if (spot) break;
    }
    const rect = spot || start;
    placed.push({ ...rect, moved: rect !== start });
  });
  return placed;
};

// The snap's cards placed (sizes from their fields). -> [{ x, y, width,
// height, side, moved }]
export const placeCards = (cards, stage) => {
  const sizes = cards.map(({ profile }) => cardSize(profile));
  return placeBoxes(cards.map(({ at }, index) => ({ at, width: sizes[index].width, height: sizes[index].height })), stage)
    .map((place, index) => ({ ...place, side: sizes[index].side }));
};

// The picture with the cards beside their nodes. snapUrl: the view's
// picture; scale: its pixels per screen pixel; cards: [{ at: { x, y } (the
// node on screen), profile: profileOf(node) ({ portrait, fields: [{ label,
// value }] }) }], at most MAX_CARDS. -> a PNG data URL (the picture as it
// was when the cards cannot be drawn).
export const withProfileCards = async (snapUrl, { scale = 2, cards = [] }) => {
  const shown = cards.filter((card) => card?.at && card?.profile).slice(0, MAX_CARDS).map((card) => ({
    ...card,
    profile: { ...card.profile, fields: card.profile.fields.length ? card.profile.fields : [{ label: 'Details', value: '' }] },
  }));
  if (!snapUrl || !shown.length) return snapUrl;
  const [snap, ...portraitUrls] = await Promise.all([loadImage(snapUrl), ...shown.map((card) => loadPortrait(card.profile.portrait))]);
  if (!snap) return snapUrl;
  const portraits = await Promise.all(portraitUrls.map((url) => (url ? loadImage(url) : null)));
  const canvas = document.createElement('canvas');
  canvas.width = snap.width;
  canvas.height = snap.height;
  const context = canvas.getContext('2d');
  if (!context) return snapUrl;
  context.drawImage(snap, 0, 0);
  context.scale(scale, scale);
  const places = placeCards(shown, { width: snap.width / scale, height: snap.height / scale });
  shown.forEach((card, index) => drawCard(context, card, places[index], portraits[index]));
  return canvas.toDataURL('image/png');
};

// One card at its place; a card moved away from its node gets a thin line
// back to it.
const drawCard = (context, { at, profile }, { x, y, width, height, side, moved }, portrait) => {
  if (moved) {
    const toX = Math.max(x, Math.min(at.x, x + width));
    const toY = Math.max(y, Math.min(at.y, y + height));
    context.save();
    context.strokeStyle = 'rgba(31,41,51,0.55)';
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(at.x, at.y);
    context.lineTo(toX, toY);
    context.stroke();
    context.restore();
  }
  // The card: white, a thin border, a soft shadow.
  context.save();
  context.shadowColor = 'rgba(0,0,0,0.22)';
  context.shadowBlur = 14;
  context.shadowOffsetY = 4;
  roundRect(context, x, y, width, height, 6);
  context.fillStyle = '#ffffff';
  context.fill();
  context.restore();
  roundRect(context, x + 0.5, y + 0.5, width - 1, height - 1, 6);
  context.strokeStyle = '#d5dde7';
  context.lineWidth = 1;
  context.stroke();
  // The portrait (or a quiet placeholder).
  const px = x + CARD.pad;
  const py = y + CARD.pad;
  drawPortrait(context, portrait, { x: px, y: py, width: side, height: side });
  // The details: the kicker, then label | value rows (as on the canvas).
  const tx = px + side + CARD.gap;
  const valueX = tx + CARD.label + 6;
  const valueWidth = x + width - CARD.pad - valueX;
  context.fillStyle = '#66727f';
  context.font = `700 8.5px ${FONT}`;
  context.fillText('ACTOR PROFILE', tx, py + 9);
  profile.fields.forEach((field, index) => {
    const baseline = py + CARD.kicker + index * CARD.row + 10.5;
    context.fillStyle = '#66727f';
    context.font = `10.5px ${FONT}`;
    context.fillText(fitText(context, String(field.label), CARD.label), tx, baseline);
    context.fillStyle = field.value ? '#1f2933' : '#a3afbd';
    context.font = `${field.value ? 600 : 400} 10.5px ${FONT}`;
    context.fillText(fitText(context, String(field.value || '\u2014'), valueWidth), valueX, baseline);
  });
};

// A portrait (an image) or the canvas card's placeholder in a box.
const drawPortrait = (context, portrait, box, background = '#eef2f6', stroke = '#a3afbd') => {
  const { x, y, width, height } = box;
  context.save();
  roundRect(context, x, y, width, height, 3);
  context.clip();
  if (portrait) {
    context.drawImage(portrait, x, y, width, height);
  } else {
    context.fillStyle = background;
    context.fillRect(x, y, width, height);
    context.strokeStyle = stroke;
    context.lineWidth = Math.max(1, width / 40);
    context.beginPath();
    context.arc(x + width / 2, y + height * 0.38, width * 0.15, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(x + width * 0.2, y + height * 0.84);
    context.quadraticCurveTo(x + width / 2, y + height * 0.5, x + width * 0.8, y + height * 0.84);
    context.stroke();
  }
  context.restore();
};

/* ── The cards as the canvas shows them (analyst report 2026-11-18: the
   snap drew its own cards, larger, placed apart from the canvas's) ── */

const relative = (rect, origin) => ({ x: rect.left - origin.left, y: rect.top - origin.top, width: rect.width, height: rect.height });
const fontOf = (style) => `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

// The profile cards laid out on the canvas, read from the page: where each
// card, its portrait and its words are, in their colours and fonts, and the
// lines from moved cards to their nodes. root: an element holding the cards
// (the Graph window's stage); origin: the canvas's box (getBoundingClientRect)
// the picture was taken of. -> { cards: [{ id, box, radius, background,
// border, portrait: { box, src }, texts: [{ text, box, font, color,
// lineHeight, upper, spacing }] }], links: [{ x1, y1, x2, y2, color }] }
export const readProfileCards = (root, origin) => {
  const cards = [...(root?.querySelectorAll?.('.graph_profile_cards .graph_profile[data-node-id]') || [])]
    .filter((element) => element.offsetWidth > 0 && element.getBoundingClientRect().left > -5000)
    .map((element) => {
      const style = getComputedStyle(element);
      const portraitBox = element.querySelector('.graph_profile_portrait');
      const art = element.querySelector('img.graph_profile_portrait_art');
      const texts = [...element.querySelectorAll('.graph_profile_kicker, .graph_profile_field dt, .graph_profile_field dd, .graph_profile_none')].map((node) => {
        const nodeStyle = getComputedStyle(node);
        const fontSize = parseFloat(nodeStyle.fontSize) || 10.5;
        return {
          text: node.textContent || '',
          box: relative(node.getBoundingClientRect(), origin),
          font: fontOf(nodeStyle),
          color: nodeStyle.color,
          lineHeight: parseFloat(nodeStyle.lineHeight) || fontSize * 1.35,
          fontSize,
          upper: nodeStyle.textTransform === 'uppercase',
          spacing: nodeStyle.letterSpacing && nodeStyle.letterSpacing !== 'normal' ? nodeStyle.letterSpacing : '0px',
        };
      });
      return {
        id: element.getAttribute('data-node-id'),
        box: relative(element.getBoundingClientRect(), origin),
        radius: parseFloat(style.borderTopLeftRadius) || 5,
        background: style.backgroundColor,
        border: style.borderTopColor,
        portrait: portraitBox ? { box: relative(portraitBox.getBoundingClientRect(), origin), src: art?.getAttribute('src') || '', placeholder: getComputedStyle(portraitBox).backgroundColor } : null,
        texts,
      };
    });
  const linksBox = root?.querySelector?.('.graph_profile_links');
  const offset = linksBox ? relative(linksBox.getBoundingClientRect(), origin) : { x: 0, y: 0 };
  const links = [...(linksBox?.querySelectorAll('line') || [])].map((line) => ({
    x1: Number(line.getAttribute('x1')) + offset.x,
    y1: Number(line.getAttribute('y1')) + offset.y,
    x2: Number(line.getAttribute('x2')) + offset.x,
    y2: Number(line.getAttribute('y2')) + offset.y,
    color: getComputedStyle(line).stroke,
  }));
  return { cards, links };
};

// A colour at least `alpha` opaque (the card is a little see-through on the
// canvas, over a blur the picture cannot have).
const atLeastOpaque = (color, alpha = 0.94) => {
  const match = /^rgba?\(([^)]+)\)$/.exec(String(color || '').trim());
  if (!match) return color || '#ffffff';
  const [r, g, b, a = '1'] = match[1].split(/[\s,/]+/).filter(Boolean);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(Number(a), alpha)})`;
};

// Words wrapped to a width (long words broken), as the card wraps them.
const wrapLines = (context, text, width) => {
  if (!text) return [''];
  const lines = [];
  let line = '';
  text.split(/(\s+)/).forEach((part) => {
    const next = line + part;
    if (!line || context.measureText(next).width <= width + 0.5) {
      line = next;
      return;
    }
    lines.push(line.trimEnd());
    line = part.trimStart();
    // A word wider than the line: broken (overflow-wrap: anywhere).
    while (line && context.measureText(line).width > width + 0.5) {
      let cut = line.length - 1;
      while (cut > 1 && context.measureText(line.slice(0, cut)).width > width) cut -= 1;
      lines.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  });
  if (line) lines.push(line);
  return lines;
};

// The picture with the cards drawn where and as the canvas shows them.
// captured: readProfileCards(). -> a PNG data URL (the picture as it was
// when nothing can be drawn).
export const withCapturedCards = async (snapUrl, { scale = 2, captured }) => {
  if (!snapUrl || !captured?.cards?.length) return snapUrl;
  const [snap, ...portraitUrls] = await Promise.all([loadImage(snapUrl), ...captured.cards.map((card) => (card.portrait?.src ? loadPortrait(card.portrait.src) : null))]);
  if (!snap) return snapUrl;
  const portraits = await Promise.all(portraitUrls.map((url) => (url ? loadImage(url) : null)));
  const canvas = document.createElement('canvas');
  canvas.width = snap.width;
  canvas.height = snap.height;
  const context = canvas.getContext('2d');
  if (!context) return snapUrl;
  context.drawImage(snap, 0, 0);
  context.scale(scale, scale);
  // The lines first (under the cards).
  captured.links.forEach((line) => {
    context.save();
    context.strokeStyle = line.color || 'rgba(31,41,51,0.55)';
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(line.x1, line.y1);
    context.lineTo(line.x2, line.y2);
    context.stroke();
    context.restore();
  });
  captured.cards.forEach((card, index) => {
    const { x, y, width, height } = card.box;
    context.save();
    context.shadowColor = 'rgba(0,0,0,0.12)';
    context.shadowBlur = 10;
    context.shadowOffsetY = 3;
    roundRect(context, x, y, width, height, card.radius);
    context.fillStyle = atLeastOpaque(card.background);
    context.fill();
    context.restore();
    roundRect(context, x + 0.5, y + 0.5, width - 1, height - 1, card.radius);
    context.strokeStyle = card.border || 'rgba(0,0,0,0.15)';
    context.lineWidth = 1;
    context.stroke();
    if (card.portrait) drawPortrait(context, portraits[index], card.portrait.box, card.portrait.placeholder || '#eef2f6');
    card.texts.forEach((entry) => {
      context.save();
      context.font = entry.font;
      context.fillStyle = entry.color;
      context.textBaseline = 'alphabetic';
      if ('letterSpacing' in context) context.letterSpacing = entry.spacing;
      const text = entry.upper ? entry.text.toUpperCase() : entry.text;
      const lines = wrapLines(context, text, Math.max(1, entry.box.width));
      lines.forEach((line, lineIndex) => {
        const top = entry.box.y + lineIndex * entry.lineHeight;
        context.fillText(line, entry.box.x, top + (entry.lineHeight - entry.fontSize) / 2 + entry.fontSize * 0.8);
      });
      context.restore();
    });
  });
  return canvas.toDataURL('image/png');
};

