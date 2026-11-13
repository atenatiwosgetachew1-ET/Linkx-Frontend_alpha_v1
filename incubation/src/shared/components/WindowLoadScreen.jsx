import React, { useEffect, useRef } from 'react';

// Branded loading state for workspace window bodies: the Linkx wordmark with a
// light sweep running across it and a slim sliding bar underneath.
// `overlay` covers the window body (which must be position: relative) while a
// long-running action is in flight, instead of replacing the content.
// `onCancel` adds the "Esc or click here to cancel" footer; Esc only applies
// to the active (focused) workspace window.
export default function WindowLoadScreen({ label = 'Loading…', overlay = false, onCancel, className = '' }) {
  const rootRef = useRef(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  });

  const cancellable = typeof onCancel === 'function';
  const cancelRef = useRef(null);

  // Overlay: everything else in the window body becomes inert (no clicks,
  // no Tab focus, hidden from screen readers) until the action finishes, and
  // keyboard focus moves to the cancel control.
  useEffect(() => {
    if (!overlay) return undefined;
    const root = rootRef.current;
    const siblings = Array.from(root?.parentElement?.children || []).filter((element) => element !== root && !element.inert);
    siblings.forEach((element) => { element.inert = true; });
    const previouslyFocused = document.activeElement;
    (cancelRef.current || root)?.focus?.({ preventScroll: true });
    return () => {
      siblings.forEach((element) => { element.inert = false; });
      if (previouslyFocused && document.contains(previouslyFocused) && !previouslyFocused.closest('[inert]')) {
        previouslyFocused.focus?.({ preventScroll: true });
      }
    };
  }, [overlay]);

  useEffect(() => {
    if (!cancellable) return undefined;
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const windowElement = rootRef.current?.closest('.workspace_window');
      if (windowElement && !windowElement.classList.contains('is-active')) return;
      event.preventDefault();
      onCancelRef.current?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [cancellable]);

  return (
    <div
      ref={rootRef}
      className={['linkx_window_loader', overlay ? 'is-overlay' : '', className].filter(Boolean).join(' ')}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="linkx_window_loader_word" aria-hidden="true">Linkx</span>
      <span className="linkx_window_loader_track" aria-hidden="true" />
      {label ? <p className="linkx_window_loader_label">{label}</p> : null}
      {cancellable ? (
        <div className="linkx_window_loader_footer">
          <button ref={cancelRef} type="button" className="linkx_window_loader_cancel" onClick={() => onCancelRef.current?.()}>
            <kbd className="linkx_window_loader_key">Esc</kbd>
            <span>or click here to cancel</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
