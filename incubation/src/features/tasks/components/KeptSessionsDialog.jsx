import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Shown each time the Tasks window's Kept tab is opened with runs in it
// (analyst decision 2026-11-24): they have finished, but each still uses an
// analysis session.
export default function KeptSessionsDialog({ kept, usage, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const one = kept === 1;
  return createPortal(
    <div
      className="linkx_confirm_overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="linkx_confirm_box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tasks-kept-title"
        aria-describedby="tasks-kept-body"
      >
        <div className="linkx_confirm_header">
          <span id="tasks-kept-title" className="linkx_confirm_title">{one ? 'This run is using a session' : 'These runs are using sessions'}</span>
          <button className="linkx_confirm_close" type="button" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div id="tasks-kept-body" className="linkx_confirm_body">
          <strong>{one ? '1 finished run keeps' : `${kept} finished runs keep`} {kept} of your {usage.limit} analysis sessions</strong> open, so {one ? 'its graph' : 'their graphs'} can
          still be shown and saved ({Math.min(usage.used, usage.limit)} of {usage.limit} sessions in use now).
          To free {one ? 'it' : 'them'}, save each run as evidence with its graph, or press Release session.
        </div>
        <div className="linkx_confirm_footer">
          <button type="button" className="linkx_confirm_btn_ok" autoFocus onClick={onClose}>Got it</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
