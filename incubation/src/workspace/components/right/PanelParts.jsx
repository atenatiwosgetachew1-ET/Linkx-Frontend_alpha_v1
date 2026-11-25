// The right panel's building blocks: the window pages' own parts (Settings,
// Configuration, Libraries), at the panel's width. Styles: right-panel.css.
import React, { useId, useState } from 'react';

import StrokeIcon from '../../../shared/icons/StrokeIcon.jsx';
import OneLine from './OneLine.jsx';
import { SettingsPage } from '../../../features/settings/components/SettingsPage.jsx';

// `fill`: the page is as tall as the tab, and its last (is-growing) block
// takes the space left. `cards`: each block is a card, its title inside.
export function PanelPage({ fill = false, cards = false, label, children }) {
  return (
    <SettingsPage className={`config_page right_page${fill ? ' is-filling' : ''}${cards ? ' right_cards' : ''}`}>
      {label ? <h2 className="right_page_name">{label}</h2> : null}
      {children}
    </SettingsPage>
  );
}

// `icon`: a 24px stroked path (or several) before the title. `collapsible`:
// the heading folds the block and opens it again (`startCollapsed`: folded at
// first).
export function PanelBlock({ title, label, icon, actions, grow = false, collapsible = false, startCollapsed = false, children }) {
  const bodyId = useId();
  const [isCollapsed, setCollapsed] = useState(startCollapsed);
  const toggle = () => setCollapsed((value) => !value);
  const toggleLabel = `${isCollapsed ? 'Expand' : 'Collapse'} ${title}`;
  const className = ['settings_block', 'right_block', grow && 'is-growing', collapsible && 'is-collapsible', isCollapsed && 'is-collapsed'].filter(Boolean).join(' ');
  return (
    <section className={className} aria-label={label || title}>
      <header className="settings_block_header" onClick={collapsible ? (event) => { if (!event.target.closest('button')) toggle(); } : undefined}>
        <h4>{icon ? <StrokeIcon className="right_block_icon" d={icon} /> : null}{title}</h4>
        {actions || collapsible ? (
          <div className="settings_block_actions">
            {actions}
            {collapsible ? (
              <button
                type="button"
                className="right_toggle linkx_tooltip_anchor"
                data-tooltip={toggleLabel}
                aria-label={toggleLabel}
                aria-expanded={!isCollapsed}
                aria-controls={bodyId}
                onClick={toggle}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            ) : null}
          </div>
        ) : null}
      </header>
      {collapsible ? (
        <div id={bodyId} className="right_block_body" aria-hidden={isCollapsed}>
          <div className="right_block_inner">{children}</div>
        </div>
      ) : children}
    </section>
  );
}

// A labelled input or select; the hint stays out of the control's name.
export function PanelField({ label, hint, children }) {
  return (
    <div className="right_field">
      <label className="config_window_field">
        <span className="config_window_field_label">{label}</span>
        {children}
      </label>
      {hint ? <small className="right_hint">{hint}</small> : null}
    </div>
  );
}

// `oneLine`: a long label is cut, the whole of it in a tooltip.
export function PanelSwitch({ label, hint, title, oneLine = false, checked, disabled = false, onChange }) {
  const hintId = useId();
  return (
    <div className="right_field">
      <label className={`settings_switch config_switch_row${disabled ? ' is-disabled' : ''}`} title={title}>
        {oneLine ? <OneLine>{label}</OneLine> : <span>{label}</span>}
        <input type="checkbox" checked={checked} disabled={disabled} aria-describedby={hint ? hintId : undefined} onChange={(event) => onChange(event.target.checked)} />
      </label>
      {hint ? <small id={hintId} className="right_hint">{hint}</small> : null}
    </div>
  );
}

export function PanelHint({ warning = false, children, ...rest }) {
  return <small {...rest} className={`right_hint${warning ? ' is-warning' : ''}`}>{children}</small>;
}

// [label, value, key?] rows, each on one line (OneLine); empty values are
// left out.
export function PanelRows({ rows, label }) {
  return (
    <dl className="right_rows" aria-label={label}>
      {rows.filter(([, value]) => value != null && value !== '').map(([name, value, key = name]) => (
        <div key={key}>
          <OneLine as="dt">{name}</OneLine>
          <OneLine as="dd">{value}</OneLine>
        </div>
      ))}
    </dl>
  );
}

export function PanelNote({ children }) {
  return <p className="right_note">{children}</p>;
}
