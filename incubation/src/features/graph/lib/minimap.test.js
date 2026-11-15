import { describe, expect, it } from 'vitest';

import {
  MINIMAP_SIZE, fromMinimap, graphOutsideView, minimapFrame, toMinimap, viewportRect,
} from './minimap.js';

describe('minimap maths', () => {
  const bounds = { x1: -100, y1: -50, x2: 300, y2: 150 }; // 400 × 200

  it('fits the graph into the box, centred, aspect kept', () => {
    const frame = minimapFrame(bounds);
    // width-bound: (160 - 12) / 400
    expect(frame.scale).toBeCloseTo(0.37);
    const topLeft = toMinimap(frame, bounds.x1, bounds.y1);
    const bottomRight = toMinimap(frame, bounds.x2, bounds.y2);
    expect(topLeft.x).toBeCloseTo(6);
    expect(bottomRight.x).toBeCloseTo(154);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(MINIMAP_SIZE.height / 2);
  });

  it('maps back from the minimap to graph coordinates', () => {
    const frame = minimapFrame(bounds);
    const point = fromMinimap(frame, ...Object.values(toMinimap(frame, 42, -7)));
    expect(point.x).toBeCloseTo(42);
    expect(point.y).toBeCloseTo(-7);
  });

  it('handles a single node (zero-size bounds)', () => {
    const frame = minimapFrame({ x1: 5, y1: 5, x2: 5, y2: 5 });
    expect(Number.isFinite(frame.scale)).toBe(true);
    const point = toMinimap(frame, 5, 5);
    expect(point.x).toBeCloseTo(MINIMAP_SIZE.width / 2);
    expect(point.y).toBeCloseTo(MINIMAP_SIZE.height / 2);
  });

  it('draws the visible part as a rectangle clipped to the box', () => {
    const frame = minimapFrame(bounds);
    const inner = viewportRect(frame, { x1: 0, y1: 0, x2: 100, y2: 50 });
    expect(inner.width).toBeCloseTo(37);
    expect(inner.height).toBeCloseTo(18.5);
    const huge = viewportRect(frame, { x1: -1e6, y1: -1e6, x2: 1e6, y2: 1e6 });
    expect(huge).toEqual({ left: 0, top: 0, width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height });
  });

  it('is needed only while part of the graph is outside the view', () => {
    expect(graphOutsideView(bounds, { x1: -200, y1: -100, x2: 400, y2: 200 })).toBe(false);
    expect(graphOutsideView(bounds, { x1: 0, y1: -100, x2: 400, y2: 200 })).toBe(true); // panned
    expect(graphOutsideView(bounds, { x1: 0, y1: 0, x2: 100, y2: 100 })).toBe(true); // zoomed in
    expect(graphOutsideView(bounds, { x1: -99, y1: -50, x2: 300, y2: 150 }, 2)).toBe(false); // within tolerance
    expect(graphOutsideView(null, { x1: 0, y1: 0, x2: 1, y2: 1 })).toBe(false); // nothing drawn
  });
});
