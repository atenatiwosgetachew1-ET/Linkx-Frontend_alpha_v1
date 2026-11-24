import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import ConfirmTitle from '../../shared/components/ConfirmTitle.jsx';

// Asked when a Source window with a running analysis is closed: keep the
// stream running as a background task (default), stop it, or keep the window.
// Escape / backdrop click cancel (never stop an analysis by accident).
export default function CloseAnalysisDialog({ windowTitle, taskTitle, onKeep, onStop, onCancel }) {
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

  if (typeof document === 'undefined' || !document.body) return null;

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
        aria-labelledby="workspace-close-analysis-title"
        aria-describedby="workspace-close-analysis-body"
      >
        <div className="linkx_confirm_header">
          <ConfirmTitle id="workspace-close-analysis-title" icon="running">Analysis still running</ConfirmTitle>
          <button className="linkx_confirm_close" type="button" aria-label="Keep the window open" onClick={onCancel}>✕</button>
        </div>
        <div id="workspace-close-analysis-body" className="linkx_confirm_body">
          <strong>{taskTitle || 'The analysis'}</strong> in {windowTitle || 'this Source window'} has not finished.
          Keep it running as a background task (follow it in the Tasks window), or stop it now.
          It keeps its analysis session after it completes, until you save it with its graph or release it.
        </div>
        <div className="linkx_confirm_footer">
          <button type="button" className="linkx_confirm_btn_cancel" onClick={onStop}>Stop analysis</button>
          <button type="button" className="linkx_confirm_btn_ok" autoFocus onClick={onKeep}>Keep running in background</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
