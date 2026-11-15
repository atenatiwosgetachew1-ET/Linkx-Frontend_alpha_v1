// Node badges (G3.6, after i2 Analyst's Notebook's glyphs; not in
// production, analyst decision 2026-11-15): small round badges in a node's
// top-right corner saying what the canvas otherwise hides: an alert, pinned
// evidence, a node flag (production NODE_FLAG edge), a note, a group or a
// merge. Drawn as extra background layers of the node.

// In order, right to left. `color` names the theme colour (GraphCanvas
// reads them from the --graph-* tokens).
export const GLYPH_KINDS = [
  { kind: 'alert', color: 'alert', title: 'Alert', symbol: '<path d="M12 6.5v6.5"/><circle cx="12" cy="16.6" r="0.6"/>' },
  { kind: 'pinned', color: 'pinned', title: 'Pinned evidence', symbol: '<path d="M9.5 6h5l-.8 4.3 2.8 2.7h-9l2.8-2.7Z"/><path d="M12 13v5"/>' },
  { kind: 'flag', color: 'flag', title: 'Node flag', symbol: '<path d="M8.5 18V6.5"/><path d="M8.5 7h7l-1.7 2.5 1.7 2.5h-7"/>' },
  { kind: 'note', color: 'note', title: 'Note', symbol: '<path d="M8 8.5h8"/><path d="M8 12h8"/><path d="M8 15.5h5"/>' },
  { kind: 'group', color: 'group', title: 'Group', symbol: '<circle cx="9.5" cy="10" r="2.2"/><circle cx="14.5" cy="10" r="2.2"/><circle cx="12" cy="14.5" r="2.2"/>' },
  { kind: 'merged', color: 'merged', title: 'Merged', symbol: '<path d="M8 6.5l4 5.5 4-5.5"/><path d="M12 12v6"/>' },
];
export const MAX_GLYPHS = 4;
const BY_KIND = Object.fromEntries(GLYPH_KINDS.map((entry) => [entry.kind, entry]));

const cache = new Map();
// A badge as an SVG data URI: a filled circle with a white ring and symbol.
export const glyphImage = (kind, color) => {
  const key = `${kind}|${color}`;
  if (cache.has(key)) return cache.get(key);
  const entry = BY_KIND[kind];
  // An explicit size: without it browsers raster the SVG at a default
  // 300×150 and scaled-up badges came out cropped.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10.5" fill="${color}" stroke="#ffffff" stroke-width="1.5"/><g fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${entry.symbol}</g></svg>`;
  const uri = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  cache.set(key, uri);
  return uri;
};

// The badges a node carries, in GLYPH_KINDS order, at most MAX_GLYPHS.
// Annotations (labels, notes, frames, objects) carry none.
export const nodeGlyphs = (node, { alert = false, pinned = false, flagged = false } = {}) => {
  if (!node || node.annotationType || node.shape === 'text') return [];
  const kinds = [];
  if (alert) kinds.push('alert');
  if (pinned) kinds.push('pinned');
  if (flagged) kinds.push('flag');
  if (node.note != null && String(node.note).trim()) kinds.push('note');
  if (node.isGroup) kinds.push('group');
  if (Array.isArray(node.merged_from) && node.merged_from.length) kinds.push('merged');
  return kinds.slice(0, MAX_GLYPHS);
};

// Badge layout inside the node's box (graph units from its top-left): a
// row from the top-right corner leftwards. Badges keep one size on screen
// (GLYPH_SCREEN_PX) as the view zooms, like vis's node borders, never larger
// than 42 % of the node; below GLYPH_MIN_PX on screen they are hidden.
export const GLYPH_SCREEN_PX = 14;
export const GLYPH_MIN_PX = 6;
export const glyphLayout = (diameter, count, zoom = 1) => {
  const scale = zoom > 0 ? zoom : 1;
  const size = Math.min(diameter * 0.42, GLYPH_SCREEN_PX / scale);
  const gap = 1 / scale;
  return Array.from({ length: count }, (_, index) => ({
    x: Math.max(0, diameter - size * (index + 1) - gap * index),
    y: 0,
    size,
    visible: size * scale >= GLYPH_MIN_PX,
  }));
};
