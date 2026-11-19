import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

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
// bubble: what a folded card shows instead of its header (Graph Alerts: an
// alerted node with its count; analyst decision 2026-11-16). Clicking it
// unfolds the card; it is neither dragged nor closed (it stays where the
// card was). A card with a bubble rises out of it when unfolded and sinks
// back into it when folded (not under reduced motion). mark: a figure left
// of the title (Graph Alerts: its node, small).
//
// A card with a bubble (analyst decision 2026-11-16): the bubble is not
// dragged and sits in the stack, bottom-right. The open card is dragged by
// its header; folding it sends it back to the stack (the next unfold starts
// there; the place is not kept). Its × folds it (there is no separate fold
// button; the On-graph components menu hides it), and it is resized from its
// top-left corner, growing up and to the left (size / onResized keep the size while it stays open, e.g. docked <-> floating; every unfold starts at the initial size, analyst decision 2026-11-16).
// escapeFolds: Escape folds it while open (a typed-in field keeps Escape).
// tip: extra lines for the bubble's tooltip (a themed card beside it, in the
// card's colour: title, summary, these, and how to open it), shown on hover
// and keyboard focus instead of the browser's plain title.
// corner (analyst decision 2026-11-16): where the open card appears, at the
// very corner of the canvas ('top-left', 'top-right' or 'bottom-right'; it
// can still be dragged from there). It rises out of its bubble wherever that
// is, and its resize grip is the corner facing into the canvas.
// empty / onRefresh / refreshing (analyst decision 2026-11-17): folded with
// nothing to show, the card is "dead": all grey (its tooltip too), dimmed
// even on hover, and its bubble rechecks (onRefresh) instead of opening; the
// bubble is then a function of { refresh, spinning } drawing the refresh sign
// (turning while `refreshing` or for a moment after the click).
const canAnimate = () => typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Longest fold animation (CSS); the fold completes then even if no
// animationend arrives.
const SINK_MS = 320;
// Shortest turn of the refresh sign, so a quick recheck is still seen.
const SPIN_MS = 700;
// Smallest size the top-left grip resizes to.
const MIN_WIDTH = 240;
const MIN_HEIGHT = 200;
// The resize grip: the open card's corner that faces into the canvas.
const GRIPS = { 'top-left': 'bottom-right', 'top-right': 'bottom-left', 'bottom-right': 'top-left' };

const FoldIcon = ({ collapsed }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d={collapsed ? 'm6 9 6 6 6-6' : 'm6 15 6-6 6 6'} />
  </svg>
);

export function GraphOverlayDock({ children }) {
  return <div className="graph_overlay_dock">{children}</div>;
}

export default function GraphOverlayPanel({
  label, icon, title, summary, collapsed = false, onToggleCollapsed, onClose, position = null, onMoved, front = false, onActivate, className = '', bubble = null, mark = null, size = null, onResized, escapeFolds = false, tip = null, corner = 'bottom-right', empty = false, onRefresh, refreshing = false, children,
}) {
  const resizing = useRef(null);
  const onResizedRef = useRef(onResized);
  onResizedRef.current = onResized;
  const ref = useRef(null);
  const tipId = useId();
  const gripAt = GRIPS[corner] || GRIPS['bottom-right'];
  // The bubble's centre in the dock, read as it is clicked: the open card
  // rises out of (and sinks back into) that point, wherever its corner is.
  const origin = useRef(null);
  const aimAtBubble = (panel) => {
    if (!panel || !origin.current) return;
    const x = origin.current.x - panel.offsetLeft;
    const y = origin.current.y - panel.offsetTop;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    // Far enough to cover the card from that point.
    const reach = Math.ceil(Math.max(Math.hypot(x, y), Math.hypot(x - w, y), Math.hypot(x, y - h), Math.hypot(x - w, y - h))) + 8;
    panel.style.setProperty('--arise-x', `${Math.round(x)}px`);
    panel.style.setProperty('--arise-y', `${Math.round(y)}px`);
    panel.style.setProperty('--arise-r', `${reach}px`);
  };
  const openFromBubble = (event) => {
    const dock = ref.current?.parentElement;
    if (dock) {
      const at = event.currentTarget.getBoundingClientRect();
      const box = dock.getBoundingClientRect();
      origin.current = { x: at.left + at.width / 2 - box.left, y: at.top + at.height / 2 - box.top };
    }
    onToggleCollapsed?.();
  };
  // Dead (folded, nothing to show): the bubble rechecks.
  const dead = Boolean(collapsed && bubble && empty);
  const [spinUntil, setSpinUntil] = useState(false);
  const spinTimer = useRef(0);
  useEffect(() => () => clearTimeout(spinTimer.current), []);
  const recheck = () => {
    setSpinUntil(true);
    clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpinUntil(false), SPIN_MS);
    onRefresh?.();
  };
  const spinning = spinUntil || refreshing;
  const bubbleNode = typeof bubble === 'function' ? bubble({ refresh: dead, spinning: dead && spinning }) : bubble;
  // 'arise' while unfolding out of the bubble, 'sink' while folding into it.
  const [motion, setMotion] = useState(null);
  const sinkTimer = useRef(0);
  useEffect(() => () => clearTimeout(sinkTimer.current), []);
  const drag = useRef(null);
  // Out of the stack once dragged. React state, not a class set by hand: a
  // re-render (fold, rescan) rewrites className and would drop a hand-set
  // class, leaving the card in the stack with its dragged left / top, i.e.
  // pushed out of sight.
  const [moved, setMoved] = useState(Boolean(position) && !bubble);
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
    if (!bubble && position && ref.current?.parentElement) placeAt(ref.current, position.left, position.top);
    // The size set with the grip is kept only while the card stays open (a
    // remount, docked <-> floating); every unfold starts at the initial size.
    if (bubble && size && !collapsed && ref.current) {
      ref.current.style.width = `${size.width}px`;
      ref.current.style.height = `${size.height}px`;
    }
    // Only on open; later moves are the drag's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Unfolding near the bottom edge would push a moved card out of the canvas.
  const foldedBefore = useRef(collapsed);
  useLayoutEffect(() => {
    if (foldedBefore.current === collapsed) return; // not on open
    foldedBefore.current = collapsed;
    const panel = ref.current;
    if (bubble && !collapsed && panel) {
      // Opened at its initial size, whatever it was resized to before.
      panel.style.width = '';
      panel.style.height = '';
      onResizedRef.current?.(null);
    }
    if (bubble && !collapsed && canAnimate()) {
      aimAtBubble(panel);
      setMotion('arise');
    }
    if (bubble && collapsed) {
      // Folded: back to its place in the stack.
      setMoved(false);
      if (panel) {
        panel.style.left = '';
        panel.style.top = '';
      }
      return;
    }
    if (panel?.parentElement && moved) placeAt(panel, panel.offsetLeft, panel.offsetTop);
    // Only when it folds or unfolds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed]);

  // Header drag (production mousedown / mousemove / mouseup).
  useEffect(() => {
    const onMove = (event) => {
      const panel = ref.current;
      const grip = resizing.current;
      if (grip && panel?.parentElement) {
        // Anchored at its corner: pulling the grip (the opposite corner) out
        // grows it. Dragged out of the stack, the corner opposite the grip is
        // kept by moving its left / top with the size.
        const stage = panel.parentElement;
        const dx = event.clientX - grip.x;
        const dy = event.clientY - grip.y;
        const roomX = !grip.moved ? stage.clientWidth : grip.fromLeft ? grip.left + grip.width : stage.clientWidth - grip.left;
        const roomY = !grip.moved ? stage.clientHeight : grip.fromTop ? grip.top + grip.height : stage.clientHeight - grip.top;
        const width = Math.round(Math.max(MIN_WIDTH, Math.min(grip.width + (grip.fromLeft ? -dx : dx), roomX)));
        const height = Math.round(Math.max(MIN_HEIGHT, Math.min(grip.height + (grip.fromTop ? -dy : dy), roomY)));
        panel.style.width = `${width}px`;
        panel.style.height = `${height}px`;
        if (grip.moved && grip.fromLeft) panel.style.left = `${grip.left + grip.width - width}px`;
        if (grip.moved && grip.fromTop) panel.style.top = `${grip.top + grip.height - height}px`;
        return;
      }
      const state = drag.current;
      if (!state || !panel?.parentElement) return;
      const dx = event.clientX - state.x;
      const dy = event.clientY - state.y;
      if (!state.travelled && Math.hypot(dx, dy) < 3) return;
      state.travelled = true;
      placeAt(panel, state.left + dx, state.top + dy);
    };
    const onUp = () => {
      const panel = ref.current;
      if (resizing.current && panel) onResizedRef.current?.({ width: panel.offsetWidth, height: panel.offsetHeight });
      resizing.current = null;
      if (drag.current?.travelled && panel) onMovedRef.current?.({ left: panel.offsetLeft, top: panel.offsetTop });
      drag.current = null;
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, []);

  // Reads where it is before taking it out of the stack (on the first move).
  const beginDrag = (event) => {
    if (event.button !== 0) return;
    const panel = ref.current;
    drag.current = { x: event.clientX, y: event.clientY, left: panel.offsetLeft, top: panel.offsetTop, travelled: false };
    event.preventDefault();
  };
  const startDrag = (event) => {
    if (event.target.closest('button, select')) return;
    beginDrag(event);
  };
  const startResize = (event) => {
    if (event.button !== 0) return;
    const panel = ref.current;
    resizing.current = {
      x: event.clientX, y: event.clientY, width: panel.offsetWidth, height: panel.offsetHeight, left: panel.offsetLeft, top: panel.offsetTop, moved,
      fromLeft: gripAt.endsWith('left'), fromTop: gripAt.startsWith('top'),
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const finishSink = () => {
    clearTimeout(sinkTimer.current);
    setMotion(null);
    onToggleCollapsed?.();
  };
  const fold = () => {
    if (motion === 'sink') return;
    if (bubble && !collapsed && canAnimate()) {
      aimAtBubble(ref.current);
      setMotion('sink');
      sinkTimer.current = setTimeout(finishSink, SINK_MS + 80);
      return;
    }
    onToggleCollapsed?.();
  };
  const foldRef = useRef(fold);
  foldRef.current = fold;
  useEffect(() => {
    if (!bubble || collapsed || !escapeFolds) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (event.target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      foldRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [bubble, collapsed, escapeFolds]);
  const onAnimationEnd = (event) => {
    if (event.target !== ref.current) return;
    if (motion === 'sink') finishSink();
    else if (motion === 'arise') setMotion(null);
  };

  const classes = `graph_overlay_panel${collapsed ? ' is-collapsed' : ''}${motion === 'arise' ? ' is-arising' : ''}${motion === 'sink' ? ' is-sinking' : ''}${moved ? ' is-moved' : ''}${bubble && !collapsed && !moved ? ` is-at-${corner}` : ''}${front ? ' is-front' : ''}${className ? ` ${className}` : ''}`;

  if (collapsed && bubble) {
    return (
      <section
        ref={ref}
        className={`${classes} is-bubble${dead ? ' is-dead' : ''}`}
        aria-label={label}
        onPointerDownCapture={front ? undefined : onActivate}
        onFocus={front ? undefined : onActivate}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button
          type="button"
          className="graph_overlay_bubble"
          aria-label={dead ? `Recheck ${title}` : `Expand ${title}`}
          aria-expanded="false"
          aria-busy={dead && spinning ? 'true' : undefined}
          aria-describedby={tipId}
          onClick={dead ? recheck : openFromBubble}
        >
          {bubbleNode}
        </button>
        <span className="graph_overlay_hidden" role="status">{summary}</span>
        <span className="graph_overlay_tip" id={tipId} role="tooltip">
          <span className="graph_overlay_tip_title">{title}</span>
          <span className="graph_overlay_tip_summary">{summary}</span>
          {tip ? <span className="graph_overlay_tip_extra">{tip}</span> : null}
          <span className="graph_overlay_tip_hint">{dead ? (spinning ? 'Rechecking…' : 'Nothing here · click to recheck') : 'Click to open'}</span>
        </span>
      </section>
    );
  }

  return (
    <section
      ref={ref}
      className={classes}
      aria-label={label}
      onPointerDownCapture={front ? undefined : onActivate}
      onFocus={front ? undefined : onActivate}
      onContextMenu={(event) => event.preventDefault()}
      onAnimationEnd={onAnimationEnd}
    >
      {bubble ? <span className={`graph_overlay_resize is-${gripAt}`} title="Drag to resize" aria-hidden="true" onPointerDown={startResize} /> : null}
      <header className="graph_overlay_header" onPointerDown={startDrag}>
        {mark ? <span className="graph_overlay_mark">{mark}</span> : null}
        <div className="graph_overlay_heading">
          <strong>{icon} {title}</strong>
          <span role="status">{summary}</span>
        </div>
        <div className="graph_overlay_header_actions">
          {bubble ? (
            <button type="button" className="graph_overlay_close" aria-label={`Collapse ${title}`} aria-expanded="true" title="Collapse" onClick={fold}>×</button>
          ) : (
            <>
              <button
                type="button"
                className="graph_overlay_fold"
                aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
                aria-expanded={!collapsed}
                title={collapsed ? 'Expand' : 'Collapse'}
                onClick={fold}
              >
                <FoldIcon collapsed={collapsed} />
              </button>
              <button type="button" className="graph_overlay_close" aria-label={`Close ${title}`} title="Close" onClick={onClose}>×</button>
            </>
          )}
        </div>
      </header>
      {collapsed ? null : children}
    </section>
  );
}
