import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import {
  MINIMAP_SIZE, fromMinimap, graphOutsideView, minimapFrame, toMinimap, viewportRect,
} from '../lib/minimap.js';

// Minimap (not in production; analyst decision 2026-11-15): top-right of the
// canvas, shown by itself while part of the graph is outside the visible
// canvas (zoomed in or panned away) and hidden again once the whole graph
// fits. The nodes are drawn as dots, the visible part as a rectangle.
// Click or drag on it to move the view there; the wheel zooms. It has no
// close button (a show / hide setting for the on-graph components comes next).
//
// cy: the window's Cytoscape instance (null while none is drawn).
const DOT_REDRAW_MS = 150; // nodes moving (physics, drag): dots at most this often
const EDGES_UP_TO = 4000; // above this the dots alone
const ZOOM_STEP = 1.15;

const cssVar = (element, name, fallback) => getComputedStyle(element).getPropertyValue(name).trim() || fallback;

export default function GraphMinimap({ cy }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const rectRef = useRef(null);
  const geometry = useRef({ bounds: null, frame: null, dirty: true });
  const [outside, setOutside] = useState(false);
  const visible = outside;

  // Bounds of the drawn nodes (labels left out), measured only after nodes
  // were added, removed or moved.
  const measure = useCallback(() => {
    const state = geometry.current;
    if (!cy || cy.destroyed() || !state.dirty) return state;
    state.dirty = false;
    const nodes = cy.nodes();
    state.bounds = nodes.length ? nodes.boundingBox({ includeLabels: false, includeOverlays: false }) : null;
    state.frame = state.bounds ? minimapFrame(state.bounds) : null;
    return state;
  }, [cy]);

  const drawRect = useCallback(() => {
    const rect = rectRef.current;
    const { frame } = geometry.current;
    if (!rect || !frame || !cy || cy.destroyed()) return;
    const box = viewportRect(frame, cy.extent());
    rect.style.transform = `translate(${box.left}px, ${box.top}px)`;
    rect.style.width = `${box.width}px`;
    rect.style.height = `${box.height}px`;
  }, [cy]);

  const drawDots = useCallback(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    if (!canvas || !root || !cy || cy.destroyed()) return;
    const { frame } = measure();
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = MINIMAP_SIZE;
    if (canvas.width !== width * ratio) canvas.width = width * ratio;
    if (canvas.height !== height * ratio) canvas.height = height * ratio;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (!frame) return;
    const ink = cssVar(root, '--graph-text', '#334155');
    const nodes = cy.nodes();
    const edges = cy.edges();
    if (edges.length <= EDGES_UP_TO) {
      context.globalAlpha = 0.18;
      context.strokeStyle = ink;
      context.lineWidth = 0.6;
      context.beginPath();
      edges.forEach((edge) => {
        const a = toMinimap(frame, edge.source().position('x'), edge.source().position('y'));
        const b = toMinimap(frame, edge.target().position('x'), edge.target().position('y'));
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      });
      context.stroke();
    }
    const radius = nodes.length > 2000 ? 0.9 : nodes.length > 300 ? 1.3 : 1.8;
    context.globalAlpha = 0.6;
    context.fillStyle = ink;
    context.beginPath();
    nodes.forEach((node) => {
      const point = toMinimap(frame, node.position('x'), node.position('y'));
      context.moveTo(point.x + radius, point.y);
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
    });
    context.fill();
    context.globalAlpha = 1;
  }, [cy, measure]);

  // Follows the canvas: viewport changes move the rectangle and decide
  // whether the minimap is needed; node changes redraw the dots (throttled).
  useEffect(() => {
    if (!cy) {
      setOutside(false);
      return undefined;
    }
    geometry.current.dirty = true;
    let viewFrame = 0;
    let dotTimer = 0;
    let lastDots = 0;
    const update = () => {
      viewFrame = 0;
      if (cy.destroyed()) return;
      const { bounds } = measure();
      const isOutside = graphOutsideView(bounds, cy.extent(), 2 / cy.zoom());
      setOutside(isOutside);
      drawRect();
    };
    const scheduleView = () => {
      if (!viewFrame) viewFrame = requestAnimationFrame(update);
    };
    const redrawDots = () => {
      dotTimer = 0;
      lastDots = Date.now();
      drawDots();
      update();
    };
    const scheduleDots = () => {
      geometry.current.dirty = true;
      if (dotTimer) return;
      dotTimer = setTimeout(redrawDots, Math.max(0, DOT_REDRAW_MS - (Date.now() - lastDots)));
    };
    cy.on('viewport resize', scheduleView);
    cy.on('add remove position', scheduleDots);
    // Theme switches recolour the dots.
    const observer = new MutationObserver(scheduleDots);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    scheduleDots();
    return () => {
      cancelAnimationFrame(viewFrame);
      clearTimeout(dotTimer);
      observer.disconnect();
      if (!cy.destroyed()) {
        cy.removeListener('viewport resize', scheduleView);
        cy.removeListener('add remove position', scheduleDots);
      }
    };
  }, [cy, drawDots, drawRect, measure]);

  // Drawn as soon as it appears (its canvas is new).
  useLayoutEffect(() => {
    if (!visible) return;
    drawDots();
    drawRect();
  }, [visible, drawDots, drawRect]);

  // Moves the view so the minimap point is its centre.
  const centreOn = (event) => {
    const { frame } = geometry.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas || !cy || cy.destroyed()) return;
    const box = canvas.getBoundingClientRect();
    const point = fromMinimap(frame, event.clientX - box.left, event.clientY - box.top);
    const zoom = cy.zoom();
    cy.pan({ x: cy.width() / 2 - point.x * zoom, y: cy.height() / 2 - point.y * zoom });
  };
  const dragging = useRef(false);
  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    centreOn(event);
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (dragging.current) centreOn(event);
  };
  const onPointerUp = (event) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  // The wheel zooms the graph around the view's centre (a non-passive
  // listener, so the page does not scroll).
  useEffect(() => {
    const surface = canvasRef.current?.parentElement;
    if (!visible || !surface || !cy) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      if (cy.destroyed()) return;
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      cy.zoom({ level: cy.zoom() * factor, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    };
    surface.addEventListener('wheel', onWheel, { passive: false });
    return () => surface.removeEventListener('wheel', onWheel);
  }, [visible, cy]);

  if (!visible) return null;
  return (
    <section ref={rootRef} className="graph_minimap" aria-label="Minimap" onContextMenu={(event) => event.preventDefault()}>
      <div
        className="graph_minimap_surface"
        style={{ width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height }}
        title="Click or drag to move the view · wheel to zoom"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <canvas ref={canvasRef} style={{ width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height }} aria-hidden="true" />
        <div ref={rectRef} className="graph_minimap_view" aria-hidden="true" />
      </div>
    </section>
  );
}
