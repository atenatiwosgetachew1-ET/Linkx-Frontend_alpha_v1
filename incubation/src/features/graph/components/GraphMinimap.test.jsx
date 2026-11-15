// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import GraphMinimap from './GraphMinimap.jsx';

// A stand-in for Cytoscape: nodes with positions, a viewport, and events.
const fakeCy = (points) => {
  const listeners = {};
  let zoom = 1;
  let pan = { x: 0, y: 0 };
  const size = { width: 400, height: 300 };
  const nodes = points.map(([x, y]) => ({ position: (axis) => (axis === 'x' ? x : y) }));
  const collection = (items) => Object.assign(items, {
    boundingBox: () => (items.length ? {
      x1: Math.min(...points.map((p) => p[0])),
      y1: Math.min(...points.map((p) => p[1])),
      x2: Math.max(...points.map((p) => p[0])),
      y2: Math.max(...points.map((p) => p[1])),
    } : null),
  });
  const emit = (names) => names.split(' ').forEach((name) => (listeners[name] || []).forEach((fn) => fn()));
  const cy = {
    destroyed: () => false,
    nodes: () => collection([...nodes]),
    edges: () => collection([]),
    width: () => size.width,
    height: () => size.height,
    zoom: (arg) => {
      if (arg === undefined) return zoom;
      zoom = arg.level;
      emit('viewport');
      return cy;
    },
    pan: (next) => {
      if (next === undefined) return pan;
      pan = next;
      emit('viewport');
      return cy;
    },
    extent: () => ({
      x1: -pan.x / zoom, y1: -pan.y / zoom, x2: (size.width - pan.x) / zoom, y2: (size.height - pan.y) / zoom,
    }),
    on: (names, fn) => names.split(' ').forEach((name) => { (listeners[name] ||= []).push(fn); }),
    removeListener: (names, fn) => names.split(' ').forEach((name) => {
      listeners[name] = (listeners[name] || []).filter((item) => item !== fn);
    }),
    viewport: ({ zoom: z, pan: p }) => { zoom = z; pan = p; emit('viewport'); },
  };
  return cy;
};

describe('GraphMinimap', () => {
  if (!window.PointerEvent) window.PointerEvent = class extends MouseEvent {};
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  const settle = () => act(() => { vi.advanceTimersByTime(400); });

  it('stays hidden while the whole graph fits, and without a graph', () => {
    const { rerender } = render(<GraphMinimap cy={fakeCy([[10, 10], [300, 200]])} />);
    settle();
    expect(screen.queryByRole('region', { name: 'Minimap' })).not.toBeInTheDocument();
    rerender(<GraphMinimap cy={fakeCy([])} />);
    settle();
    expect(screen.queryByRole('region', { name: 'Minimap' })).not.toBeInTheDocument();
    rerender(<GraphMinimap cy={null} />);
    expect(screen.queryByRole('region', { name: 'Minimap' })).not.toBeInTheDocument();
  });

  it('appears once zoomed past the canvas and hides when the graph fits again', () => {
    const cy = fakeCy([[10, 10], [300, 200]]);
    render(<GraphMinimap cy={cy} />);
    settle();
    act(() => { cy.viewport({ zoom: 3, pan: { x: -200, y: -150 } }); });
    settle();
    expect(screen.getByRole('region', { name: 'Minimap' })).toBeInTheDocument();
    act(() => { cy.viewport({ zoom: 1, pan: { x: 0, y: 0 } }); });
    settle();
    expect(screen.queryByRole('region', { name: 'Minimap' })).not.toBeInTheDocument();
  });


  it('a click centres the view on that point', () => {
    const cy = fakeCy([[0, 0], [400, 200]]);
    render(<GraphMinimap cy={cy} />);
    act(() => { cy.viewport({ zoom: 2, pan: { x: 0, y: 0 } }); });
    settle();
    const surface = screen.getByRole('region', { name: 'Minimap' }).querySelector('.graph_minimap_surface');
    // The box's centre is the graph's centre (200, 100).
    fireEvent.pointerDown(surface, { button: 0, clientX: 80, clientY: 55 });
    const extent = cy.extent();
    expect((extent.x1 + extent.x2) / 2).toBeCloseTo(200);
    expect((extent.y1 + extent.y2) / 2).toBeCloseTo(100);
  });
});
