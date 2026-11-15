import React from 'react';

import GraphOverlayPanel from './GraphOverlayPanel.jsx';

// Merged & Grouped card (not in production; analyst decision 2026-11-15):
// the graph's group nodes and merged nodes, which are hard to tell apart on
// the canvas, in the shared overlay frame. Clicking an item focuses it
// (shown first if the limit hides it); a group can be ungrouped from here.
//
// items: [{ key, id, kind: 'group' | 'merged', name, detail, hidden }]
const StackIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="8" cy="9" r="4" />
    <circle cx="16" cy="9" r="4" />
    <circle cx="12" cy="16" r="4" />
  </svg>
);

export default function GraphCombinedPanel({ items, summary, onFocus, onUngroup, ...frame }) {
  return (
    <GraphOverlayPanel {...frame} label="Merged & Grouped" title="Merged & Grouped" icon={<StackIcon />} summary={summary} className="is-combined">
      <div className="graph_overlay_list">
        {items.length ? items.map((entry) => (
          <div key={entry.key} className={`graph_overlay_card is-${entry.kind}`}>
            <button
              type="button"
              className="graph_overlay_card_main"
              title={`${entry.detail}\nClick to focus it and open its details in the Info tab.`}
              onClick={() => onFocus(entry.id)}
            >
              <span className="graph_overlay_card_top">
                <strong>{entry.name}</strong>
                <span className="graph_overlay_badge">{entry.kind === 'group' ? 'GROUP' : 'MERGED'}</span>
              </span>
              <span className="graph_overlay_category">{entry.count}{entry.hidden ? ' · not shown at this limit' : ''}</span>
              <span className="graph_overlay_detail">{entry.detail}</span>
            </button>
            {entry.kind === 'group' ? (
              <button type="button" className="graph_overlay_card_action is-text" aria-label={`Ungroup ${entry.name}`} title="Ungroup" onClick={() => onUngroup(entry.id)}>
                Ungroup
              </button>
            ) : null}
          </div>
        )) : (
          <p className="graph_overlay_empty">No merged or grouped nodes in this graph. Select nodes and right-click: Edit ▸ Group Nodes or Merge Nodes.</p>
        )}
      </div>
      <footer className="graph_overlay_footer">
        <span>Click an item to focus it · drag to move</span>
      </footer>
    </GraphOverlayPanel>
  );
}
