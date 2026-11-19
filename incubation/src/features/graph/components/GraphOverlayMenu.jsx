import React, { useEffect, useRef, useState } from 'react';

import { OVERLAY_COMPONENTS } from '../lib/overlayPrefs.js';

// Toolbar button listing the on-graph components with a check each
// (minimap, legend, Graph Alerts, Pinned Evidence). prefs: { key: bool }.
const LayersIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);

export default function GraphOverlayMenu({ prefs, onToggle }) {
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

  // "All": checked when every component shows, mixed when some do; a click
  // shows them all, or hides them all when all already show.
  const shownCount = OVERLAY_COMPONENTS.filter((item) => prefs[item.key]).length;
  const allShown = shownCount === OVERLAY_COMPONENTS.length;
  const toggleAll = () => {
    OVERLAY_COMPONENTS.forEach((item) => {
      if (Boolean(prefs[item.key]) === !allShown) return;
      onToggle(item.key, !allShown);
    });
  };

  // Lit while any component is on the graph (as it is by default), not only
  // while the menu is open.
  const anyShown = shownCount > 0;
  return (
    <div ref={rootRef} className="graph_overlay_menu">
      <button
        type="button"
        className={`graph_window_icon_button${open || anyShown ? ' is-active' : ''} linkx_tooltip_anchor`}
        aria-label="On-graph components"
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip-placement="bottom"
        data-tooltip={open ? '' : 'On-graph components'}
        onClick={() => setOpen((value) => !value)}
      >
        <LayersIcon />
      </button>
      {open ? (
        <div className="graph_overlay_menu_list" role="menu" aria-label="On-graph components">
          <strong>Show on the graph</strong>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={allShown ? true : shownCount ? 'mixed' : false}
            className="graph_overlay_menu_item is-all"
            title={allShown ? 'Hide every on-graph component' : 'Show every on-graph component'}
            onClick={toggleAll}
          >
            <span className="graph_overlay_menu_check" aria-hidden="true">{allShown ? '✓' : shownCount ? '–' : ''}</span>
            All
          </button>
          {OVERLAY_COMPONENTS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={prefs[item.key]}
              className="graph_overlay_menu_item"
              title={item.hint}
              onClick={() => onToggle(item.key, !prefs[item.key])}
            >
              <span className="graph_overlay_menu_check" aria-hidden="true">{prefs[item.key] ? '✓' : ''}</span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
