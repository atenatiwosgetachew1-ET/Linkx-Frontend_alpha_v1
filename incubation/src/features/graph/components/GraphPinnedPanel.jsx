import React from 'react';

import GraphOverlayPanel from './GraphOverlayPanel.jsx';

// Pinned Evidence card (not in production, which only had "Show Pinned
// Evidence" as an alert; analyst decision 2026-11-15): this graph's pinned
// items in the shared overlay frame, so the analyst sees them at once.
// Clicking an item focuses it (shown first if the limit hides it); Unpin
// removes it; "Show all" shows and fits every pinned item of this graph.
//
// items: [{ key, item, kind: 'node' | 'edge', name, detail, hidden }]
// elsewhere: how many pinned items belong to other graphs.
const PinIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M9 4h6l-1 6 4 4H6l4-4-1-6Z" />
    <path d="M12 14v6" />
  </svg>
);

export default function GraphPinnedPanel({ items, elsewhere, summary, onFocus, onUnpin, onShowAll, ...frame }) {
  return (
    <GraphOverlayPanel {...frame} label="Pinned Evidence" title="Pinned Evidence" icon={<PinIcon />} summary={summary} className="is-pinned">
      <div className="graph_overlay_list">
        {items.length ? items.map((entry) => (
          <div key={entry.key} className="graph_overlay_card is-pinned">
            <button
              type="button"
              className="graph_overlay_card_main"
              title="Click to focus it and open its details in the Info tab."
              onClick={() => onFocus(entry.item)}
            >
              <span className="graph_overlay_card_top">
                <strong>{entry.name}</strong>
              </span>
              <span className="graph_overlay_category">{entry.kind === 'node' ? 'Node' : 'Link'}{entry.hidden ? ' · not shown at this limit' : ''}</span>
              {entry.detail ? <span className="graph_overlay_detail">{entry.detail}</span> : null}
            </button>
            <button type="button" className="graph_overlay_card_action" aria-label={`Unpin ${entry.name}`} title="Unpin" onClick={() => onUnpin(entry.item)}>×</button>
          </div>
        )) : (
          <p className="graph_overlay_empty">Nothing in this graph is pinned. Right-click a node: Evidence ▸ Pin Evidence.</p>
        )}
        {elsewhere ? <p className="graph_overlay_note">{elsewhere} more pinned in other graphs.</p> : null}
      </div>
      <footer className="graph_overlay_footer">
        <span>Click an item to focus it · drag to move</span>
        <button type="button" className="graph_window_button is-compact" title="Show and fit every pinned item of this graph" disabled={!items.length} onClick={onShowAll}>
          Show all
        </button>
      </footer>
    </GraphOverlayPanel>
  );
}
