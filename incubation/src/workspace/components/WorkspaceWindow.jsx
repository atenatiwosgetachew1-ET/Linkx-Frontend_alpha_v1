import React, { useCallback, useRef, useState } from 'react';

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
  width: 1120,
  height: 720,
};

const WINDOW_SIZE_LIMITS = {
  minWidth: 640,
  minHeight: 420,
  maxWidth: 1600,
  maxHeight: 1000,
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

export default function WorkspaceWindow({ windowItem, stackIndex = 0, isActive, onFocus, onCustomTitleChange, onWindowLayoutChange, onClose }) {
  const windowRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [position, setPosition] = useState(() => getInitialWindowPosition(windowItem, stackIndex));
  const [size, setSize] = useState(() => getInitialWindowSize(windowItem));

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

  const clampPosition = useCallback((nextPosition, currentSize = size) => {
    const boundsEl = getBoundsElement();

    if (!boundsEl) {
      return {
        x: Math.max(0, nextPosition.x),
        y: Math.max(0, nextPosition.y),
      };
    }

    const boundsRect = boundsEl.getBoundingClientRect();
    const canvasEl = windowRef.current?.closest('.workspace_canvas');
    const canvasRect = canvasEl?.getBoundingClientRect();
    // x is relative to the window layer which starts at canvas left edge,
    // so max x must account for the offset between canvas and bounds element
    const rightOverflow = canvasRect && boundsRect
      ? Math.max(0, boundsRect.right - canvasRect.left - currentSize.width - 8)
      : Math.max(boundsRect.width - currentSize.width - 8, 0);
    const maxY = Math.max(boundsRect.height - currentSize.height - 8, 0);

    return {
      x: clamp(nextPosition.x, 0, rightOverflow),
      y: clamp(nextPosition.y, 0, maxY),
    };
  }, [getBoundsElement, size.height, size.width]);

  // React to canvas size changes from panel expand/collapse
  // - Canvas shrinks (panel expanding) → push windows left so they clear the panel
  // - Canvas grows (panel collapsing) → leave windows exactly where they are
  React.useEffect(() => {
    const currentWindow = windowRef.current;
    const canvasEl = currentWindow?.closest('.workspace_canvas');
    if (!canvasEl) return;

    let prevCanvasWidth = canvasEl.getBoundingClientRect().width;

    const handleBoundsChange = () => {
      const canvasRect = canvasEl.getBoundingClientRect();
      const currentCanvasWidth = canvasRect.width;
      const delta = currentCanvasWidth - prevCanvasWidth;

      if (delta < 0) {
        // Canvas shrank (panel expanding) → push windows left by the shrink amount
        const shrinkAmount = Math.abs(delta);
        setPosition((prevPos) => {
          const newX = Math.max(0, prevPos.x - shrinkAmount);
          return newX !== prevPos.x ? { x: newX, y: prevPos.y } : prevPos;
        });
      }
      // Canvas grew (panel collapsing) → do nothing, windows stay put

      prevCanvasWidth = currentCanvasWidth;
    };

    const resizeObserver = new ResizeObserver(handleBoundsChange);
    resizeObserver.observe(canvasEl);

    return () => resizeObserver.disconnect();
  }, []);

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

    onFocus(windowItem.id);
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      nextPosition: { x: position.x, y: position.y },
    };
  }, [onFocus, position.x, position.y, windowItem.id]);

  const handleDragMove = useCallback((event) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const nextPosition = {
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    };
    const clampedPosition = clampPosition(nextPosition);

    dragRef.current.nextPosition = clampedPosition;
    setPosition(clampedPosition);
  }, [clampPosition]);

  const handleDragEnd = useCallback((event) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    if (dragState?.nextPosition) {
      persistLayout(dragState.nextPosition, size);
    }

    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [persistLayout, size]);

  const handleCustomTitleChange = useCallback((event) => {
    onCustomTitleChange(windowItem.id, event.target.value);
  }, [onCustomTitleChange, windowItem.id]);

  const handleResizeStart = useCallback((event) => {
    if (event.button !== 0) return;

    const direction = event.currentTarget.dataset.resizeDirection;
    if (!direction) return;

    event.preventDefault();
    event.stopPropagation();
    onFocus(windowItem.id);
    setIsResizing(true);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      direction,
      originPosition: { x: position.x, y: position.y },
      originSize: { width: size.width, height: size.height },
      nextPosition: { x: position.x, y: position.y },
      nextSize: { width: size.width, height: size.height },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [onFocus, position.x, position.y, size.height, size.width, windowItem.id]);

  const handleResizeMove = useCallback((event) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    event.preventDefault();

    const currentWindow = windowRef.current;
    const canvasEl = currentWindow?.closest('.workspace_canvas');
    const workArea = currentWindow?.closest('.workspace_work_area');
    const isCollapsed = workArea?.classList.contains('is-right-collapsed');
    const boundsEl = isCollapsed ? canvasEl : (workArea || canvasEl);

    const boundsRect = boundsEl?.getBoundingClientRect();
    const canvasRect = canvasEl?.getBoundingClientRect();
    // maxRight = how far the window's right edge can extend (relative to window layer origin = canvas left)
    const maxRight = (boundsRect && canvasRect)
      ? Math.max(0, boundsRect.right - canvasRect.left)
      : 0;
    const maxBottom = Number(boundsRect?.height) || 0;

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
    setPosition(nextPosition);
    setSize(nextSize);
  }, []);

  const handleResizeEnd = useCallback((event) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    persistLayout(resizeState.nextPosition, resizeState.nextSize);

    resizeRef.current = null;
    setIsResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [persistLayout]);

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
      onMouseDown={() => onFocus(windowItem.id)}
      style={{
        transform: 'translate3d(' + position.x + 'px, ' + position.y + 'px, 0)',
        width: size.width + 'px',
        height: size.height + 'px',
        minWidth: WINDOW_SIZE_LIMITS.minWidth + 'px',
        minHeight: WINDOW_SIZE_LIMITS.minHeight + 'px',
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
