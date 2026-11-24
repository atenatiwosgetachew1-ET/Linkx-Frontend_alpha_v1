import { describe, expect, it, vi } from 'vitest';

import { graphPicture, pictureScale } from './graphPicture.js';

const GOOD = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const graph = (w, h, draw) => ({ elements: () => ({ boundingBox: () => ({ w, h }) }), width: () => 800, height: () => 600, jpg: vi.fn(draw), png: vi.fn(draw) });

describe('graphPicture', () => {
  it('a large graph is scaled into maxSide itself (Cytoscape ignores it beside a scale)', () => {
    const cy = graph(48000, 20000, () => GOOD);
    expect(graphPicture(cy, { full: true, maxSide: 2400, format: 'jpg' })).toBe(GOOD);
    expect(cy.jpg.mock.calls[0][0].scale).toBeCloseTo(0.05);
    expect(pictureScale(graph(300, 200), { full: true, maxSide: 2400 })).toBe(2);
    expect(pictureScale(graph(0, 0), { full: false, scale: 3, maxSide: 1600 })).toBe(3); // the view as it is
  });

  it('tries smaller when the browser gives an empty picture, then gives up with null (not a broken one)', () => {
    const answers = ['data:,', GOOD];
    const cy = graph(1000, 1000, () => answers.shift());
    expect(graphPicture(cy, { full: true, maxSide: 2000, format: 'jpg' })).toBe(GOOD);
    expect(cy.jpg.mock.calls.map(([options]) => options.scale)).toEqual([2, 1]);
    expect(graphPicture(graph(10, 10, () => 'data:,'), { format: 'jpg' })).toBeNull();
    expect(graphPicture(graph(10, 10, () => { throw new Error('x'); }))).toBeNull();
  });
});
