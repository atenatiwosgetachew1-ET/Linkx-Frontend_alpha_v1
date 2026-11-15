import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

// The frame shared by the Graph window's overlay cards (Graph Alerts,
// Pinned Evidence), after production's #alerts-overlay: a header with an
// icon, title, summary, fold and close; dragged by its header, resized from
// its corner, kept inside the canvas.
//
// The cards stack bottom-right in GraphOverlayDock; a dragged card leaves the
// stack and stays where it was put (also when reopened: position / onMoved,
// kept by the window). collapsed / onToggleCollapsed fold it to its header
// so it covers less of the graph. front / onActivate: the card last clicked
// or focused is drawn above the other (cards overlap once dragged).
const FoldIcon = ({ collapsed }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={collapsed ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} />
  </svg>
);

export function GraphOverlayDock({ children }) {
  return <div className="graph_overlay_dock">{children}</div>;
}

export default function GraphOverlayPanel({
  label, icon, title, summary, collapsed = false, onToggleCollapsed, onClose, position = null, onMoved, front = false, onActivate, className = '', children,
}) {
  const ref = useRef(null);
  const drag = useRef(null);
  // Out of the stack once dragged. React state, not a class set by hand: a
  // re-render (fold, rescan) rewrites className and would drop a hand-set
  // class, leaving the card in the stack with its dragged left / top, i.e.
  // pushed out of sight.
  const [moved, setMoved] = useState(Boolean(position));
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;

  // Pinned by left / top inside the dock (canvas-sized).
  const placeAt = (panel, left, top) => {
    const stage = panel.parentElement;
    setMoved(true);
    panel.style.left = `${Math.max(0, Math.min(left, stage.clientWidth - panel.offsetWidth))}px`;
    panel.style.top = `${Math.max(0, Math.min(top, stage.clientHeight - panel.offsetHeight))}px`;
  };

  // A reopened card returns to where it was dragged.
  useLayoutEffect(() => {
    if (position && ref.current?.parentElement) placeAt(ref.current, position.left, position.top);
    // Only on open; later moves are the drag's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unfolding near the bottom edge would push a moved card out of the canvas.
  const foldedBefore = useRef(collapsed);
  useLayoutEffect(() => {
    if (foldedBefore.current === collapsed) return; // not on open
    foldedBefore.current = collapsed;
    const panel = ref.current;
    if (panel?.parentElement && moved) placeAt(panel, panel.offsetLeft, panel.offsetTop);
    // Only when it folds or unfolds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  // Header drag (production mousedown / mousemove / mouseup).
  useEffect(() => {
    const onMove = (event) => {
      const state = drag.current;
      const panel = ref.current;
      if (!state || !panel?.parentElement) return;
      placeAt(panel, state.left + (event.clientX - state.x), state.top + (event.clientY - state.y));
    };
    const onUp = () => {
      const panel = ref.current;
      if (drag.current && panel) onMovedRef.current?.({ left: panel.offsetLeft, top: panel.offsetTop });
      drag.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, []);

  const startDrag = (event) => {
    if (event.button !== 0 || event.target.closest('button, select')) return;
    // Read where it is before taking it out of the stack.
    const panel = ref.current;
    const left = panel.offsetLeft;
    const top = panel.offsetTop;
    placeAt(panel, left, top);
    drag.current = { x: event.clientX, y: event.clientY, left, top };
    event.preventDefault();
  };

  return (
    <section
      ref={ref}
      className={`graph_overlay_panel${collapsed ? ' is-collapsed' : ''}${moved ? ' is-moved' : ''}${front ? ' is-front' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      onPointerDownCapture={front ? undefined : onActivate}
      onFocus={front ? undefined : onActivate}
      onContextMenu={(event) => event.preventDefault()}
    >
      <header className="graph_overlay_header" onPointerDown={startDrag}>
        <div className="graph_overlay_heading">
          <strong>{icon} {title}</strong>
          <span role="status">{summary}</span>
        </div>
        <div className="graph_overlay_header_actions">
          <button
            type="button"
            className="graph_overlay_fold"
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand' : 'Collapse'}
            onClick={onToggleCollapsed}
          >
            <FoldIcon collapsed={collapsed} />
          </button>
          <button type="button" className="graph_overlay_close" aria-label={`Close ${title}`} title="Close" onClick={onClose}>×</button>
        </div>
      </header>
      {collapsed ? null : children}
    </section>
  );
}
