import React, { useEffect, useRef, useState } from 'react';

// A toolbar button with a short menu of actions (G4: Export). items:
// [{ id, label, hint, disabled }]; onPick(id).
export default function GraphFileMenu({ label, icon, items, onPick, disabled = false }) {
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
  return (
    <div ref={rootRef} className="graph_overlay_menu">
      <button
        type="button"
        className={`graph_window_icon_button${open ? ' is-active' : ''} linkx_tooltip_anchor`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip-placement="bottom"
        data-tooltip={open ? '' : label}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
      </button>
      {open ? (
        <div className="graph_overlay_menu_list" role="menu" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="graph_overlay_menu_item"
              title={item.hint}
              aria-disabled={item.disabled || undefined}
              onClick={() => {
                if (item.disabled) return;
                setOpen(false);
                onPick(item.id);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
