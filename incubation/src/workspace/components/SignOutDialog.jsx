import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

import ConfirmTitle from '../../shared/components/ConfirmTitle.jsx';

// Asked on Sign out when something would be lost (lib/leaveReasons.js).
// Escape / backdrop click stay signed in.
// running: a run with a seat is going; it is kept or stopped, as chosen.
export default function SignOutDialog({ reasons, remembered, running = 0, onSignOut, onStopAndSignOut, onCancel }) {
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
    <div className="linkx_confirm_overlay" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="linkx_confirm_box" role="dialog" aria-modal="true" aria-labelledby="workspace-signout-title" aria-describedby="workspace-signout-body">
        <div className="linkx_confirm_header">
          <ConfirmTitle id="workspace-signout-title" icon="signOut">Sign out now?</ConfirmTitle>
          <button className="linkx_confirm_close" type="button" aria-label="Stay signed in" onClick={onCancel}>✕</button>
        </div>
        <div id="workspace-signout-body" className="linkx_confirm_body">
          <ul className="workspace_leave_reasons">{reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          {remembered ? <p>Your windows can be restored when you sign in again.</p> : null}
        </div>
        <div className="linkx_confirm_footer">
          {running ? (
            <button type="button" className="linkx_confirm_btn_cancel" onClick={onStopAndSignOut}>Stop it and sign out</button>
          ) : null}
          <button type="button" className="linkx_confirm_btn_cancel" onClick={onSignOut}>{running ? 'Keep running and sign out' : 'Sign out anyway'}</button>
          <button type="button" className="linkx_confirm_btn_ok" autoFocus onClick={onCancel}>Stay</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
