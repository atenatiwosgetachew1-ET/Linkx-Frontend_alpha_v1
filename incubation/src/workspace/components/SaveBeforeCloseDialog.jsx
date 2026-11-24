import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import ConfirmTitle from '../../shared/components/ConfirmTitle.jsx';

// Asked when a Source window is closed and its completed run was not saved
// (analyst decision 2026-11-24): closing ends the session its graph is read
// from. Escape / backdrop click keep the window (never lose a graph by
// accident).
export default function SaveBeforeCloseDialog({ windowTitle, taskTitle, onSave, onClose, onCancel }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [onCancel]);

  return createPortal(
    <div
      className="linkx_confirm_overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="linkx_confirm_box workspace_close_analysis_dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-save-before-close-title"
        aria-describedby="workspace-save-before-close-body"
      >
        <div className="linkx_confirm_header">
          <ConfirmTitle id="workspace-save-before-close-title" icon="save">Save this run first?</ConfirmTitle>
          <button className="linkx_confirm_close" type="button" aria-label="Keep the window open" onClick={onCancel}>✕</button>
        </div>
        <div id="workspace-save-before-close-body" className="linkx_confirm_body">
          <strong>{taskTitle || 'The analysis'}</strong> in {windowTitle || 'this Source window'} is not saved as evidence.
          Once the window is closed, its graph can no longer be shown or saved. The task itself stays in Tasks.
        </div>
        <div className="linkx_confirm_footer">
          <button type="button" className="linkx_confirm_btn_cancel" onClick={onCancel}>Cancel</button>
          <button type="button" className="linkx_confirm_btn_cancel" onClick={onClose}>Close without saving</button>
          <button type="button" className="linkx_confirm_btn_ok" autoFocus onClick={onSave}>Save as evidence</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
