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

    if (dragState?.nextPosition && onWindowLayoutChange) {
      onWindowLayoutChange(windowItem.id, {
        metadata: {
          windowPosition: dragState.nextPosition,
          windowSize: size,
        },
      });
    }

    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [onWindowLayoutChange, size, windowItem.id]);

  const handleCustomTitleChange = useCallback((event) => {
    onCustomTitleChange(windowItem.id, event.target.value);
  }, [onCustomTitleChange, windowItem.id]);

  const handleResizeStart = useCallback((event) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    onFocus(windowItem.id);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: size.width,
      originHeight: size.height,
      nextSize: { width: size.width, height: size.height },
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [onFocus, size.height, size.width, windowItem.id]);

  const handleResizeMove = useCallback((event) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    event.preventDefault();

    const currentWindow = windowRef.current;
    const parent = currentWindow?.parentElement;
    const parentRect = parent?.getBoundingClientRect();
    const nextWidthFromPointer = resizeState.originWidth + event.clientX - resizeState.startX;
    const nextHeightFromPointer = resizeState.originHeight + event.clientY - resizeState.startY;
    const parentMaxWidth = parentRect ? Math.max(parentRect.width - position.x, WINDOW_SIZE_LIMITS.minWidth) : WINDOW_SIZE_LIMITS.maxWidth;
    const parentMaxHeight = parentRect ? Math.max(parentRect.height - position.y, WINDOW_SIZE_LIMITS.minHeight) : WINDOW_SIZE_LIMITS.maxHeight;
    const maxWidth = Math.min(WINDOW_SIZE_LIMITS.maxWidth, parentMaxWidth);
    const maxHeight = Math.min(WINDOW_SIZE_LIMITS.maxHeight, parentMaxHeight);
    const nextSize = {
      width: clamp(nextWidthFromPointer, WINDOW_SIZE_LIMITS.minWidth, maxWidth),
      height: clamp(nextHeightFromPointer, WINDOW_SIZE_LIMITS.minHeight, maxHeight),
    };

    resizeState.nextSize = nextSize;
    setSize(nextSize);
  }, [position.x, position.y]);

  const handleResizeEnd = useCallback((event) => {
    const resizeState = resizeRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;

    if (resizeState?.nextSize && onWindowLayoutChange) {
      onWindowLayoutChange(windowItem.id, {
        metadata: {
          windowSize: resizeState.nextSize,
        },
      });
    }

    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, [onWindowLayoutChange, windowItem.id]);

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
      className={'workspace_window' + (isActive ? ' is-active' : '') + (isDragging ? ' is-dragging' : '')}
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
      <button
        className="workspace_window_resize_handle linkx_tooltip_anchor"
        type="button"
        data-tooltip="Resize window"
        aria-label="Resize window"
        onPointerDown={handleResizeStart}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
        onMouseDown={stopHeaderControlDrag}
        onClick={stopHeaderControlDrag}
      />
    </article>
  );
}
