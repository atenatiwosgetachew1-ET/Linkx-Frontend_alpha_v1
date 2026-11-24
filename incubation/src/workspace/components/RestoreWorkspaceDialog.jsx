import React from 'react';
import { createPortal } from 'react-dom';

import ConfirmTitle from '../../shared/components/ConfirmTitle.jsx';
import { WORKSPACE_WINDOW_LABELS } from '../state/workspaceTypes.js';
import { windowOutcome } from '../lib/workspaceCopy.js';

const STATES = {
  full: { label: 'Comes back', mark: 'M5 12l5 5L20 7' },
  partial: { label: 'Comes back in part', mark: 'M6 12h12' },
  lost: { label: 'Cannot come back', mark: 'M6 6l12 12M18 6L6 18' },
};
const Mark = ({ d, className }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} /></svg>
);

// Asked after a reload or a sign-in when a last workspace is kept (compact:
// analyst decision 2026-11-24). Each window's pill says in its tooltip what
// comes back of it. Both answers are explicit: Escape and a click outside do
// nothing. iconPaths: { [window type]: path }.
export default function RestoreWorkspaceDialog({ copy, iconPaths = {}, busy = false, onRestore, onFresh }) {
  const count = copy.windows.length;
  const when = new Date(copy.savedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return createPortal(
    <div className="linkx_confirm_overlay" role="presentation">
      <section className="linkx_confirm_box workspace_restore" role="dialog" aria-modal="true" aria-labelledby="workspace-restore-title">
        <div className="workspace_restore_head">
          <ConfirmTitle id="workspace-restore-title" icon="restore">Restore your last workspace?</ConfirmTitle>
          <small>{count === 1 ? '1 window' : `${count} windows`} · {when}</small>
        </div>
        <ul className="workspace_restore_list" aria-label="Windows">
          {copy.windows.map((item) => {
            const { state, note } = windowOutcome(item, copy);
            const tooltip = `${STATES[state].label}. ${note}`;
            return (
              <li key={item.id}>
                {/* In the tab order, so the keyboard reaches the tooltip. */}
                <span
                  className={`workspace_restore_pill is-${state} linkx_tooltip_anchor`}
                  role="note"
                  tabIndex={0}
                  data-tooltip={tooltip}
                  aria-label={`${WORKSPACE_WINDOW_LABELS[item.type]}${item.customTitle ? `, ${item.customTitle}` : ''}. ${tooltip}`}
                >
                  <Mark className="workspace_restore_icon" d={iconPaths[item.type] || ''} />
                  <span className="workspace_restore_name">
                    <strong>{WORKSPACE_WINDOW_LABELS[item.type]}</strong>
                    {item.customTitle ? <small>{item.customTitle}</small> : null}
                  </span>
                  <Mark className="workspace_restore_mark" d={STATES[state].mark} />
                </span>
              </li>
            );
          })}
        </ul>
        <div className="linkx_confirm_footer">
          <button type="button" className="linkx_confirm_btn_cancel" disabled={busy} onClick={onFresh}>Start fresh</button>
          <button type="button" className="linkx_confirm_btn_ok" autoFocus disabled={busy} onClick={onRestore}>{busy ? 'Restoring…' : 'Restore'}</button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
