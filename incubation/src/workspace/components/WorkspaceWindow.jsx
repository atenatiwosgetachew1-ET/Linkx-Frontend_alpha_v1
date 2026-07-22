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
  width: 940,
  height: 600,
};

const WINDOW_SIZE_LIMITS = {
  minWidth: 640,
  minHeight: 420,
  maxWidth: 1240,
  maxHeight: 780,
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

  const clampPosition = useCallback((nextPosition, currentSize = size) => {
    const currentWindow = windowRef.current;
    const parent = currentWindow?.parentElement;

    if (!currentWindow || !parent) {
      return {
        x: Math.max(0, nextPosition.x),
        y: Math.max(0, nextPosition.y),
      };
    }

    const parentRect = parent.getBoundingClientRect();
    const maxX = Math.max(parentRect.width - currentSize.width, 0);
    const maxY = Math.max(parentRect.height - currentSize.height, 0);

    return {
      x: clamp(nextPosition.x, 0, maxX),
      y: clamp(nextPosition.y, 0, maxY),
    };
  }, [size.height, size.width]);

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
    const parent = currentWindow?.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const parentWidth = Number(parentRect?.width) || 0;
    const parentHeight = Number(parentRect?.height) || 0;
    const deltaX = event.clientX - resizeState.startX;
    const deltaY = event.clientY - resizeState.startY;
    let nextPosition = { ...resizeState.originPosition };
    let nextSize = { ...resizeState.originSize };

    const canResizeLeft = resizeState.direction === RESIZE_DIRECTIONS.LEFT || resizeState.direction === RESIZE_DIRECTIONS.BOTTOM_LEFT;
    const canResizeRight = resizeState.direction === RESIZE_DIRECTIONS.RIGHT || resizeState.direction === RESIZE_DIRECTIONS.BOTTOM_RIGHT;
    const canResizeBottom = resizeState.direction === RESIZE_DIRECTIONS.BOTTOM || resizeState.direction === RESIZE_DIRECTIONS.BOTTOM_LEFT || resizeState.direction === RESIZE_DIRECTIONS.BOTTOM_RIGHT;

    if (canResizeLeft) {
      const maxShiftLeft = resizeState.originPosition.x;
      const maxShiftRight = resizeState.originSize.width - WINDOW_SIZE_LIMITS.minWidth;
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
      const availableWidth = parentWidth > 0
        ? Math.max(parentWidth - resizeState.originPosition.x, WINDOW_SIZE_LIMITS.minWidth)
        : WINDOW_SIZE_LIMITS.maxWidth;
      const maxWidth = Math.min(WINDOW_SIZE_LIMITS.maxWidth, availableWidth);
      const widthDelta = clamp(
        deltaX,
        -(resizeState.originSize.width - WINDOW_SIZE_LIMITS.minWidth),
        maxWidth - resizeState.originSize.width,
      );
      nextSize = {
        ...nextSize,
        width: resizeState.originSize.width + widthDelta,
      };
    }

    if (canResizeBottom) {
      const availableHeight = parentHeight > 0
        ? Math.max(parentHeight - resizeState.originPosition.y, WINDOW_SIZE_LIMITS.minHeight)
        : WINDOW_SIZE_LIMITS.maxHeight;
      const maxHeight = Math.min(WINDOW_SIZE_LIMITS.maxHeight, availableHeight);
      const heightDelta = clamp(
        deltaY,
        -(resizeState.originSize.height - WINDOW_SIZE_LIMITS.minHeight),
        maxHeight - resizeState.originSize.height,
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
