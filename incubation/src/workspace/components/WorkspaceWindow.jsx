import React, { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import WorkspaceWindowBody from './WorkspaceWindowBody.jsx';

const DRAG_START_OFFSET = {
  x: 22,
  y: 74,
};

const WINDOW_STAGGER = {
  x: 30,
  y: 24,
};

const DEFAULT_WINDOW_SIZE = {
  width: 1179,
  height: 823,
};

const WINDOW_SIZE_LIMITS = {
  minWidth: 640,
  minHeight: 420,
  maxWidth: 1800,
  maxHeight: 1200,
};

const RESIZE_DIRECTIONS = {
  LEFT: 'left',
  RIGHT: 'right',
  BOTTOM: 'bottom',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right',
};

const RESIZE_HANDLES = [
  { direction: RESIZE_DIRECTIONS.LEFT, className: 'is-left' },
  { direction: RESIZE_DIRECTIONS.RIGHT, className: 'is-right' },
  { direction: RESIZE_DIRECTIONS.BOTTOM, className: 'is-bottom' },
  { direction: RESIZE_DIRECTIONS.BOTTOM_LEFT, className: 'is-bottom-left' },
  { direction: RESIZE_DIRECTIONS.BOTTOM_RIGHT, className: 'is-bottom-right' },
];

const EDGE_GAP = 8;
const DRAG_THRESHOLD = 3;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getInitialWindowPosition = (windowItem, stackIndex) => {
  const storedPosition = windowItem?.metadata?.windowPosition;
  const storedX = Number(storedPosition?.x);
  const storedY = Number(storedPosition?.y);

  if (Number.isFinite(storedX) && Number.isFinite(storedY)) {
    return { x: storedX, y: storedY };
  }

  return {
    x: DRAG_START_OFFSET.x + stackIndex * WINDOW_STAGGER.x,
    y: DRAG_START_OFFSET.y + stackIndex * WINDOW_STAGGER.y,
  };
};

const getInitialWindowSize = (windowItem, parentSize = {}) => {
  const storedSize = windowItem?.metadata?.windowSize || {};
  const storedWidth = Number(storedSize?.width);
  const storedHeight = Number(storedSize?.height);
  const parentWidth = Number(parentSize.width) || 0;
  const parentHeight = Number(parentSize.height) || 0;
  const maxWidth = parentWidth > 0 ? Math.min(WINDOW_SIZE_LIMITS.maxWidth, Math.max(parentWidth - 44, WINDOW_SIZE_LIMITS.minWidth)) : WINDOW_SIZE_LIMITS.maxWidth;
  const maxHeight = parentHeight > 0 ? Math.min(WINDOW_SIZE_LIMITS.maxHeight, Math.max(parentHeight - 96, WINDOW_SIZE_LIMITS.minHeight)) : WINDOW_SIZE_LIMITS.maxHeight;

  return {
    width: clamp(Number.isFinite(storedWidth) ? storedWidth : DEFAULT_WINDOW_SIZE.width, WINDOW_SIZE_LIMITS.minWidth, maxWidth),
    height: clamp(Number.isFinite(storedHeight) ? storedHeight : DEFAULT_WINDOW_SIZE.height, WINDOW_SIZE_LIMITS.minHeight, maxHeight),
  };
};

const applyFrameStyle = (element, nextPosition, nextSize) => {
  if (!element) return;
  element.style.transform = 'translate3d(' + nextPosition.x + 'px, ' + nextPosition.y + 'px, 0)';
  if (nextSize) {
    element.style.width = nextSize.width + 'px';
    element.style.height = nextSize.height + 'px';
  }
};

function WorkspaceWindow({ windowItem, stackIndex = 0, isActive, onFocus, onCustomTitleChange, onWindowLayoutChange, onClose }) {
  const windowRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const frameRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState(() => getInitialWindowPosition(windowItem, stackIndex));
  const [size, setSize] = useState(() => getInitialWindowSize(windowItem));
  // Refs hold the live geometry (updated during gestures and bounds changes
  // without re-rendering); state is committed afterwards to keep React in sync.
  const positionRef = useRef(position);
  const sizeRef = useRef(size);
  const pendingFrameRef = useRef(null);
  const commitTimerRef = useRef(null);

  const commitLayout = useCallback((nextPosition, nextSize) => {
    if (nextPosition) {
      positionRef.current = nextPosition;
      setPosition(nextPosition);
    }
    if (nextSize) {
      sizeRef.current = nextSize;
      setSize(nextSize);
    }
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    clearTimeout(commitTimerRef.current);
  }, []);

  // One pending rAF per window; pointer events only replace the target geometry.
  const scheduleFrame = useCallback((nextPosition, nextSize) => {
    pendingFrameRef.current = { nextPosition, nextSize };
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const pending = pendingFrameRef.current;
      pendingFrameRef.current = null;
      if (pending) applyFrameStyle(windowRef.current, pending.nextPosition, pending.nextSize);
    });
  }, []);

  const flushFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    pendingFrameRef.current = null;
  }, []);

  const focusIfInactive = useCallback(() => {
    if (!isActive) onFocus(windowItem.id);
  }, [isActive, onFocus, windowItem.id]);

  // Returns the element to use as the boundary for window positioning & resizing.
  // Collapsed right panel → constrain to .workspace_canvas (don't cover tab rail)
  // Expanded right panel  → allow overflow into .workspace_work_area (panel is fully visible underneath)
  const getBoundsElement = useCallback(() => {
    const currentWindow = windowRef.current;
    if (!currentWindow) return null;
    const workArea = currentWindow.closest('.workspace_work_area');
    const isCollapsed = workArea?.classList.contains('is-right-collapsed');
    if (isCollapsed) {
      return currentWindow.closest('.workspace_canvas') || currentWindow.parentElement;
    }
    return workArea || currentWindow.closest('.workspace_canvas') || currentWindow.parentElement;
  }, []);

  // Measured once per gesture to avoid layout reads on every pointermove.
  const measureBounds = useCallback(() => {
    const boundsEl = getBoundsElement();
    if (!boundsEl) return null;
    const boundsRect = boundsEl.getBoundingClientRect();
    const canvasRect = windowRef.current?.closest('.workspace_canvas')?.getBoundingClientRect();
    // x is relative to the window layer, which starts at the canvas left edge.
    return {
      maxRight: canvasRect ? Math.max(0, boundsRect.right - canvasRect.left) : boundsRect.width,
      maxBottom: boundsRect.height,
    };
  }, [getBoundsElement]);

  // Shrink/move the window so it is fully reachable inside the workspace bounds.
  // `shiftLeft` pushes it left first (used when the canvas shrinks). With
  // `deferCommit`, the DOM is updated immediately and React state is committed
  // once the bounds settle (avoids a render per frame during panel animations).
  const fitWithinBounds = useCallback(({ shiftLeft = 0, deferCommit = false } = {}) => {
    if (dragRef.current || resizeRef.current) return;
    const bounds = measureBounds();
    if (!bounds || bounds.maxBottom <= 0 || bounds.maxRight <= 0) return;
    const currentSize = sizeRef.current;
    const currentPosition = positionRef.current;
    const width = Math.min(currentSize.width, Math.max(0, bounds.maxRight - EDGE_GAP));
    const height = Math.min(currentSize.height, Math.max(0, bounds.maxBottom - EDGE_GAP));
    const x = clamp(currentPosition.x - shiftLeft, 0, Math.max(0, bounds.maxRight - width - EDGE_GAP));
    const y = clamp(currentPosition.y, 0, Math.max(0, bounds.maxBottom - height - EDGE_GAP));
    const sizeChanged = width !== currentSize.width || height !== currentSize.height;
    const positionChanged = x !== currentPosition.x || y !== currentPosition.y;
    if (!sizeChanged && !positionChanged) return;

    const nextPosition = { x, y };
    const nextSize = { width, height };
    if (!deferCommit) {
      commitLayout(positionChanged ? nextPosition : null, sizeChanged ? nextSize : null);
      return;
    }
    positionRef.current = nextPosition;
    sizeRef.current = nextSize;
    applyFrameStyle(windowRef.current, nextPosition, nextSize);
    clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => commitLayout(positionRef.current, sizeRef.current), 150);
  }, [measureBounds, commitLayout]);

  // New windows (no saved layout) open inside the central workspace only, so they
  // never start out covering the right workspace panel; the first one is centred.
  // Runs before paint so there is no visible jump. Later drags/resizes may still
  // extend over the panel area.
  useLayoutEffect(() => {
    const metadata = windowItem?.metadata || {};
    if (metadata.windowSize || metadata.windowPosition) return;
    const canvasRect = windowRef.current?.closest('.workspace_canvas')?.getBoundingClientRect();
    if (!canvasRect || canvasRect.width <= 0 || canvasRect.height <= 0) return;

    const offset = Math.min(stackIndex, 5);
    const maxWidth = Math.max(0, canvasRect.width - 2 * EDGE_GAP - offset * WINDOW_STAGGER.x);
    const maxHeight = Math.max(0, canvasRect.height - 2 * EDGE_GAP - offset * WINDOW_STAGGER.y);
    const width = Math.min(sizeRef.current.width, maxWidth);
    const height = Math.min(sizeRef.current.height, maxHeight);
    const initialPosition = stackIndex === 0
      ? {
        x: Math.max(EDGE_GAP, Math.round((canvasRect.width - width) / 2)),
        y: Math.max(EDGE_GAP, Math.round((canvasRect.height - height) / 2)),
      }
      : { x: EDGE_GAP + offset * WINDOW_STAGGER.x, y: EDGE_GAP + offset * WINDOW_STAGGER.y };

    commitLayout(initialPosition, { width, height });
    // Mount-only: initial placement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    fitWithinBounds();
  }, [fitWithinBounds]);

  // React to canvas size changes (right panel expand/collapse animates the grid):
  // - canvas shrinks → push the window left by the shrink amount, then fit
  // - canvas grows   → leave the window where it is
  useEffect(() => {
    const canvasEl = windowRef.current?.closest('.workspace_canvas');
    if (!canvasEl) return undefined;

    let prevCanvasWidth = canvasEl.getBoundingClientRect().width;
    const resizeObserver = new ResizeObserver((entries) => {
      const currentCanvasWidth = entries[0]?.contentRect.width ?? prevCanvasWidth;
      const delta = currentCanvasWidth - prevCanvasWidth;
      prevCanvasWidth = currentCanvasWidth;
      fitWithinBounds({ shiftLeft: delta < 0 ? -delta : 0, deferCommit: true });
    });
    resizeObserver.observe(canvasEl);
    return () => resizeObserver.disconnect();
  }, [fitWithinBounds]);

  const persistLayout = useCallback((nextPosition, nextSize) => {
    if (!onWindowLayoutChange) return;

    onWindowLayoutChange(windowItem.id, {
      metadata: {
        windowPosition: nextPosition,
        windowSize: nextSize,
      },
    });
  }, [onWindowLayoutChange, windowItem.id]);

  const handleDragStart = useCallback((event) => {
    if (event.button !== 0) return;

    focusIfInactive();
    event.currentTarget.setPointerCapture(event.pointerId);
    const origin = positionRef.current;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: origin.x,
      originY: origin.y,
      bounds: measureBounds(),
      size: sizeRef.current,
      nextPosition: null,
      started: false,
    };
  }, [focusIfInactive, measureBounds]);

  const handleDragMove = useCallback((event) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    // A plain click on the header must not enter drag mode (re-render, blur off).
    if (!dragState.started) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      dragState.started = true;
      setIsDragging(true);
    }
    const rawX = dragState.originX + dx;
    const rawY = dragState.originY + dy;
    const { bounds, size: currentSize } = dragState;
    const nextPosition = bounds
      ? {
        x: clamp(rawX, 0, Math.max(0, bounds.maxRight - currentSize.width - 8)),
        y: clamp(rawY, 0, Math.max(0, bounds.maxBottom - currentSize.height - 8)),
      }
      : { x: Math.max(0, rawX), y: Math.max(0, rawY) };

    dragState.nextPosition = nextPosition;
    positionRef.current = nextPosition;
    scheduleFrame(nextPosition);
  }, [scheduleFrame]);

  const handleDragEnd = useCallback((event) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    flushFrame();
    if (dragState.nextPosition) {
      applyFrameStyle(windowRef.current, dragState.nextPosition);
      commitLayout(dragState.nextPosition);
      persistLayout(dragState.nextPosition, sizeRef.current);
    }

    dragRef.current = null;
    if (dragState.started) setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [flushFrame, commitLayout, persistLayout]);

  const handleCustomTitleChange = useCallback((event) => {
    onCustomTitleChange(windowItem.id, event.target.value);
  }, [onCustomTitleChange, windowItem.id]);

  const handleResizeStart = useCallback((event) => {
    if (event.button !== 0) return;

    const direction = event.currentTarget.dataset.resizeDirection;
    if (!direction) return;

    event.preventDefault();
    event.stopPropagation();
    focusIfInactive();
    setIsResizing(true);
    const originPosition = { ...positionRef.current };
    const originSize = { ...sizeRef.current };
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      direction,
      bounds: measureBounds(),
      originPosition,
      originSize,
      nextPosition: originPosition,
      nextSize: originSize,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [focusIfInactive, measureBounds]);

  const handleResizeMove = useCallback((event) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    event.preventDefault();

    // maxRight = how far the window's right edge can extend (relative to window layer origin = canvas left)
    const maxRight = resizeState.bounds?.maxRight || 0;
    const maxBottom = resizeState.bounds?.maxBottom || 0;

    const deltaX = event.clientX - resizeState.startX;
    const deltaY = event.clientY - resizeState.startY;
    let nextPosition = { ...resizeState.originPosition };
    let nextSize = { ...resizeState.originSize };

    const canResizeLeft = resizeState.direction === RESIZE_DIRECTIONS.LEFT || resizeState.direction === RESIZE_DIRECTIONS.BOTTOM_LEFT;
    const canResizeRight = resizeState.direction === RESIZE_DIRECTIONS.RIGHT || resizeState.direction === RESIZE_DIRECTIONS.BOTTOM_RIGHT;
    const canResizeBottom = resizeState.direction === RESIZE_DIRECTIONS.BOTTOM || resizeState.direction === RESIZE_DIRECTIONS.BOTTOM_LEFT || resizeState.direction === RESIZE_DIRECTIONS.BOTTOM_RIGHT;

    if (canResizeLeft) {
      const maxShiftLeft = resizeState.originPosition.x;
      const minWidth = Math.min(WINDOW_SIZE_LIMITS.minWidth, resizeState.originSize.width);
      const maxShiftRight = resizeState.originSize.width - minWidth;
      const shiftX = clamp(deltaX, -maxShiftLeft, maxShiftRight);
      nextPosition = {
        ...nextPosition,
        x: resizeState.originPosition.x + shiftX,
      };
      nextSize = {
        ...nextSize,
        width: resizeState.originSize.width - shiftX,
      };
    }

    if (canResizeRight) {
      const maxAllowedWidth = maxRight > 0
        ? Math.max(0, maxRight - resizeState.originPosition.x)
        : WINDOW_SIZE_LIMITS.maxWidth;
      const maxWidth = Math.min(WINDOW_SIZE_LIMITS.maxWidth, maxAllowedWidth);
      const minWidth = Math.min(WINDOW_SIZE_LIMITS.minWidth, maxWidth);
      const widthDelta = clamp(
        deltaX,
        -(resizeState.originSize.width - minWidth),
        Math.max(0, maxWidth - resizeState.originSize.width),
      );
      nextSize = {
        ...nextSize,
        width: resizeState.originSize.width + widthDelta,
      };
    }

    if (canResizeBottom) {
      const maxAllowedHeight = maxBottom > 0
        ? Math.max(0, maxBottom - resizeState.originPosition.y)
        : WINDOW_SIZE_LIMITS.maxHeight;
      const maxHeight = Math.min(WINDOW_SIZE_LIMITS.maxHeight, maxAllowedHeight);
      const minHeight = Math.min(WINDOW_SIZE_LIMITS.minHeight, maxHeight);
      const heightDelta = clamp(
        deltaY,
        -(resizeState.originSize.height - minHeight),
        Math.max(0, maxHeight - resizeState.originSize.height),
      );
      nextSize = {
        ...nextSize,
        height: resizeState.originSize.height + heightDelta,
      };
    }

    resizeState.nextPosition = nextPosition;
    resizeState.nextSize = nextSize;
    positionRef.current = nextPosition;
    sizeRef.current = nextSize;
    scheduleFrame(nextPosition, nextSize);
  }, [scheduleFrame]);

  const handleResizeEnd = useCallback((event) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    flushFrame();
    applyFrameStyle(windowRef.current, resizeState.nextPosition, resizeState.nextSize);
    commitLayout(resizeState.nextPosition, resizeState.nextSize);
    persistLayout(resizeState.nextPosition, resizeState.nextSize);

    resizeRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [flushFrame, commitLayout, persistLayout]);

  const stopHeaderControlDrag = useCallback((event) => {
    event.stopPropagation();
  }, []);

  const handleClose = useCallback((event) => {
    event.stopPropagation();
    onClose(windowItem.id);
  }, [onClose, windowItem.id]);

  return (
    <article
      ref={windowRef}
      className={'workspace_window' + (isActive ? ' is-active' : '') + (isDragging ? ' is-dragging' : '') + (isResizing ? ' is-resizing' : '')}
      aria-label={windowItem.customTitle ? windowItem.title + ': ' + windowItem.customTitle : windowItem.title}
      onMouseDown={focusIfInactive}
      style={{
        transform: 'translate3d(' + positionRef.current.x + 'px, ' + positionRef.current.y + 'px, 0)',
        width: sizeRef.current.width + 'px',
        height: sizeRef.current.height + 'px',
        minWidth: 'min(' + WINDOW_SIZE_LIMITS.minWidth + 'px, 100%)',
        minHeight: 'min(' + WINDOW_SIZE_LIMITS.minHeight + 'px, 100%)',
        zIndex: isActive ? 100 + stackIndex : 20 + stackIndex,
      }}
    >
      <header
        className="workspace_window_header"
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <div className="workspace_window_title">
          <span>{windowItem.title}</span>
          <input
            className="workspace_window_custom_title_input"
            type="text"
            value={windowItem.customTitle ?? windowItem.status ?? 'Placeholder'}
            placeholder="Placeholder"
            aria-label="Window custom title"
            maxLength={120}
            onPointerDown={stopHeaderControlDrag}
            onClick={stopHeaderControlDrag}
            onChange={handleCustomTitleChange}
          />
        </div>
        <button
          className="linkx_tooltip_anchor"
          type="button"
          data-tooltip={'Close ' + windowItem.title}
          aria-label={'Close ' + windowItem.title}
          onPointerDown={stopHeaderControlDrag}
          onClick={handleClose}
        >
          ×
        </button>
      </header>
      <WorkspaceWindowBody windowItem={windowItem} />
      {RESIZE_HANDLES.map((handle) => (
        <button
          key={handle.direction}
          className={'workspace_window_resize_handle ' + handle.className}
          type="button"
          aria-label="Resize window"
          data-resize-direction={handle.direction}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onMouseDown={stopHeaderControlDrag}
          onClick={stopHeaderControlDrag}
        />
      ))}
    </article>
  );
}

export default memo(WorkspaceWindow);
