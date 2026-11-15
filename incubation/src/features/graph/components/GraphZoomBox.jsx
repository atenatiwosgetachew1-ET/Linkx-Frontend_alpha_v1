import React, { useEffect, useRef, useState } from 'react';

// Zoom to area (after i2 Analyst's Notebook's marquee zoom; not in
// production, analyst decision 2026-11-15). While the tool is on, a layer
// over the canvas takes the mouse: drag a box and that part of the graph is
// zoomed to fill the view. A plain click zooms in a step there. One use,
// then the tool turns itself off; Escape or a right-click cancels it.
//
// onZoom({ x1, y1, x2, y2 }) in canvas pixels; onDone() when finished.
const MIN_BOX = 8; // px: smaller is a click
const CLICK_BOX = 0.5; // a click zooms in 2× around the point (half-size box)

export default function GraphZoomBox({ onZoom, onDone }) {
  const layerRef = useRef(null);
  const start = useRef(null);
  const [box, setBox] = useState(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onDone();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDone]);

  const point = (event) => {
    const rect = layerRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    start.current = point(event);
    setBox({ ...start.current, width: 0, height: 0 });
    event.preventDefault();
  };
  const onPointerMove = (event) => {
    if (!start.current) return;
    const at = point(event);
    setBox({
      x: Math.min(at.x, start.current.x),
      y: Math.min(at.y, start.current.y),
      width: Math.abs(at.x - start.current.x),
      height: Math.abs(at.y - start.current.y),
    });
  };
  const onPointerUp = (event) => {
    if (!start.current) return;
    const from = start.current;
    const at = point(event);
    start.current = null;
    setBox(null);
    const width = Math.abs(at.x - from.x);
    const height = Math.abs(at.y - from.y);
    if (width >= MIN_BOX && height >= MIN_BOX) {
      onZoom({ x1: Math.min(at.x, from.x), y1: Math.min(at.y, from.y), x2: Math.max(at.x, from.x), y2: Math.max(at.y, from.y) });
    } else {
      const layer = layerRef.current.getBoundingClientRect();
      const halfW = (layer.width * CLICK_BOX) / 2;
      const halfH = (layer.height * CLICK_BOX) / 2;
      onZoom({ x1: at.x - halfW, y1: at.y - halfH, x2: at.x + halfW, y2: at.y + halfH });
    }
    onDone();
  };

  return (
    <div
      ref={layerRef}
      className="graph_zoom_box_layer"
      role="presentation"
      aria-label="Zoom to area: drag a box"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { start.current = null; setBox(null); }}
      onContextMenu={(event) => { event.preventDefault(); onDone(); }}
    >
      {box ? <div className="graph_zoom_box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }} /> : null}
      <span className="graph_zoom_box_hint">Drag a box to zoom into it · click to zoom in · Esc to cancel</span>
    </div>
  );
}
