// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

import GraphZoomBox from './GraphZoomBox.jsx';

if (!window.PointerEvent) window.PointerEvent = class extends MouseEvent {};

const setup = () => {
  const onZoom = vi.fn();
  const onDone = vi.fn();
  render(<GraphZoomBox onZoom={onZoom} onDone={onDone} />);
  const layer = document.querySelector('.graph_zoom_box_layer');
  layer.getBoundingClientRect = () => ({ left: 100, top: 50, width: 800, height: 600, right: 900, bottom: 650 });
  return { onZoom, onDone, layer };
};

afterEach(cleanup);

describe('GraphZoomBox (zoom to area)', () => {
  it('draws the dragged box and zooms to it, in canvas pixels, then turns off', () => {
    const { onZoom, onDone, layer } = setup();
    fireEvent.pointerDown(layer, { button: 0, clientX: 300, clientY: 250 });
    fireEvent.pointerMove(layer, { clientX: 200, clientY: 150 });
    const drawn = document.querySelector('.graph_zoom_box');
    expect(drawn.style.left).toBe('100px');
    expect(drawn.style.width).toBe('100px');
    fireEvent.pointerUp(layer, { clientX: 200, clientY: 150 });
    expect(onZoom).toHaveBeenCalledWith({ x1: 100, y1: 100, x2: 200, y2: 200 });
    expect(onDone).toHaveBeenCalled();
    expect(document.querySelector('.graph_zoom_box')).toBeNull();
  });

  it('a click zooms in 2× around the point', () => {
    const { onZoom, layer } = setup();
    fireEvent.pointerDown(layer, { button: 0, clientX: 500, clientY: 350 });
    fireEvent.pointerUp(layer, { clientX: 502, clientY: 351 });
    expect(onZoom).toHaveBeenCalledWith({ x1: 202, y1: 151, x2: 602, y2: 451 });
  });

  it('Escape and a right-click cancel without zooming', () => {
    const { onZoom, onDone, layer } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.contextMenu(layer);
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(onZoom).not.toHaveBeenCalled();
    expect(screen.getByText(/Drag a box to zoom into it/)).toBeInTheDocument();
  });
});
