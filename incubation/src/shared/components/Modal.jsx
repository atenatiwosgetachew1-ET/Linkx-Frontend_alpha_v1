import React, { useEffect, useId, useRef } from 'react';

// Open modals, newest last: only the top one reacts to Escape.
const modalStack = [];

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

// Accessible in-window dialog: labelled title, focus moved in and trapped,
// focus restored on close, Escape / backdrop click close it (unless
// `closeDisabled`, e.g. while submitting). Renders inside the nearest
// position:relative window body.
export default function Modal({
  title,
  onClose,
  children,
  footer,
  wide = false,
  closeDisabled = false,
  as = 'div',
  onSubmit,
  initialFocusRef,
}) {
  const Tag = as;
  const titleId = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  useEffect(() => {
    onCloseRef.current = onClose;
    closeDisabledRef.current = closeDisabled;
  });

  useEffect(() => {
    const token = {};
    modalStack.push(token);
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;
    const target = initialFocusRef?.current || dialog?.querySelector(FOCUSABLE) || dialog;
    target?.focus?.();

    const onKeyDown = (event) => {
      if (modalStack[modalStack.length - 1] !== token) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!closeDisabledRef.current) onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((item) => item.offsetParent !== null);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      const index = modalStack.indexOf(token);
      if (index >= 0) modalStack.splice(index, 1);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function' && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // Mount-only: focus handling must not re-run on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="config_window_dialog_backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose?.();
      }}
    >
      <Tag
        ref={dialogRef}
        className={`config_window_dialog${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onSubmit={onSubmit}
      >
        <header>
          <h4 id={titleId}>{title}</h4>
          <button type="button" className="config_window_dialog_close" aria-label="Close" disabled={closeDisabled} onClick={onClose}>
            <span aria-hidden="true">✕</span>
          </button>
        </header>
        {children}
        {footer ? <footer className="config_window_inline_actions is-end">{footer}</footer> : null}
      </Tag>
    </div>
  );
}
