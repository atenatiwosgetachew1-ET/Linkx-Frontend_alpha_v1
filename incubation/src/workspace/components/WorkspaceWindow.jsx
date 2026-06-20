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

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export default function WorkspaceWindow({ windowItem, stackIndex = 0, isActive, onFocus, onCustomTitleChange, onClose }) {
  const windowRef = useRef(null);
  const dragRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState(() => ({
    x: DRAG_START_OFFSET.x + stackIndex * WINDOW_STAGGER.x,
    y: DRAG_START_OFFSET.y + stackIndex * WINDOW_STAGGER.y,
  }));

  const clampPosition = useCallback((nextPosition) => {
    const currentWindow = windowRef.current;
    const parent = currentWindow?.parentElement;

    if (!currentWindow || !parent) {
      return {
        x: Math.max(0, nextPosition.x),
        y: Math.max(0, nextPosition.y),
      };
    }

    const parentRect = parent.getBoundingClientRect();
    const windowRect = currentWindow.getBoundingClientRect();
    const maxX = Math.max(parentRect.width - windowRect.width, 0);
    const maxY = Math.max(parentRect.height - windowRect.height, 0);

    return {
      x: clamp(nextPosition.x, 0, maxX),
      y: clamp(nextPosition.y, 0, maxY),
    };
  }, []);

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
    };
  }, [onFocus, position.x, position.y, windowItem.id]);

  const handleDragMove = useCallback((event) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    const nextPosition = {
      x: dragState.originX + event.clientX - dragState.startX,
      y: dragState.originY + event.clientY - dragState.startY,
    };

    setPosition(clampPosition(nextPosition));
  }, [clampPosition]);

  const handleDragEnd = useCallback((event) => {
    const dragState = dragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;

    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleCustomTitleChange = useCallback((event) => {
    onCustomTitleChange(windowItem.id, event.target.value);
  }, [onCustomTitleChange, windowItem.id]);

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
      aria-label={windowItem.customTitle ? `${windowItem.title}: ${windowItem.customTitle}` : windowItem.title}
      onMouseDown={() => onFocus(windowItem.id)}
      style={{
        transform: 'translate3d(' + position.x + 'px, ' + position.y + 'px, 0)',
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
          type="button"
          aria-label={'Close ' + windowItem.title}
          onPointerDown={stopHeaderControlDrag}
          onClick={handleClose}
        >
          ×
        </button>
      </header>
      <WorkspaceWindowBody windowItem={windowItem} />
    </article>
  );
}