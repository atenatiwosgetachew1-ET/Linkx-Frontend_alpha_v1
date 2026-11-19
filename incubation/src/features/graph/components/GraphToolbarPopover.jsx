import React, { useEffect, useRef, useState } from 'react';

// A toolbar button opening a small panel under it, in the Graph window's
// menu look (as Export): options that need room stay out of the toolbar,
// which keeps to one line (analyst decision 2026-11-18). Used by the Table
// and Chart windows' toolbars.
//
// label: the button's name (and the panel's); icon: the button's icon;
// text: shown beside the icon (with a caret) when given, else an icon
// button; role: the panel's role ('menu' or 'dialog'); align: 'left' opens
// the panel from the button's left edge; children(close): the panel.
export default function GraphToolbarPopover({
  label, icon, text = '', tooltip = '', role = 'menu', align = 'right', disabled = false, active = false, children,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  const close = () => setOpen(false);
  const buttonClass = text
    ? `graph_window_button is-compact graph_toolbar_popover_button${open || active ? ' is-active' : ''}`
    : `graph_window_icon_button${open || active ? ' is-active' : ''}`;
  return (
    <div ref={rootRef} className="graph_overlay_menu">
      <button
        type="button"
        className={`${buttonClass} linkx_tooltip_anchor`}
        aria-label={label}
        aria-haspopup={role === 'dialog' ? 'dialog' : 'menu'}
        aria-expanded={open}
        data-tooltip-placement="bottom"
        data-tooltip={open ? '' : tooltip || label}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {text ? <span className="graph_toolbar_popover_text">{text}</span> : null}
        {text ? <span className="graph_toolbar_popover_caret" aria-hidden="true">▾</span> : null}
      </button>
      {open ? (
        <div className={`graph_overlay_menu_list graph_toolbar_popover${align === 'left' ? ' is-left' : ''}`} role={role} aria-label={label}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
