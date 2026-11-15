// Minimap maths (not in production; analyst decision 2026-11-15): the whole
// graph fitted into a small box, the visible part of the canvas drawn on it
// as a rectangle. Bounds and extents are Cytoscape model boxes
// ({ x1, y1, x2, y2 }).

export const MINIMAP_SIZE = Object.freeze({ width: 160, height: 110 });
export const MINIMAP_PADDING = 6;
const MIN_SPAN = 100;

// Scale and offset that fit `bounds` into the box, centred, aspect kept.
export const minimapFrame = (bounds, size = MINIMAP_SIZE, padding = MINIMAP_PADDING) => {
  // A single node or a line has no size: at least MIN_SPAN units across.
  const width = Math.max(bounds.x2 - bounds.x1, MIN_SPAN);
  const height = Math.max(bounds.y2 - bounds.y1, MIN_SPAN);
  const scale = Math.max(Math.min((size.width - 2 * padding) / width, (size.height - 2 * padding) / height), 1e-9);
  return {
    scale,
    offsetX: size.width / 2 - ((bounds.x1 + bounds.x2) / 2) * scale,
    offsetY: size.height / 2 - ((bounds.y1 + bounds.y2) / 2) * scale,
  };
};

export const toMinimap = (frame, x, y) => ({ x: x * frame.scale + frame.offsetX, y: y * frame.scale + frame.offsetY });

export const fromMinimap = (frame, x, y) => ({ x: (x - frame.offsetX) / frame.scale, y: (y - frame.offsetY) / frame.scale });

// The visible extent on the minimap, clipped to the box: { left, top, width, height }.
export const viewportRect = (frame, extent, size = MINIMAP_SIZE) => {
  const a = toMinimap(frame, extent.x1, extent.y1);
  const b = toMinimap(frame, extent.x2, extent.y2);
  const left = Math.max(0, Math.min(a.x, size.width));
  const top = Math.max(0, Math.min(a.y, size.height));
  const right = Math.max(0, Math.min(b.x, size.width));
  const bottom = Math.max(0, Math.min(b.y, size.height));
  return { left, top, width: Math.max(right - left, 0), height: Math.max(bottom - top, 0) };
};

// True when part of the graph lies outside the visible canvas (zoomed or
// panned past it): when the minimap is shown. `tolerance` is in model units.
export const graphOutsideView = (bounds, extent, tolerance = 0) => Boolean(bounds) && (
  bounds.x1 < extent.x1 - tolerance
  || bounds.y1 < extent.y1 - tolerance
  || bounds.x2 > extent.x2 + tolerance
  || bounds.y2 > extent.y2 + tolerance
);
