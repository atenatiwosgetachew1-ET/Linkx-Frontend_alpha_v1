import React from 'react';

import GraphCardNode from './GraphCardNode.jsx';
import GraphOverlayPanel from './GraphOverlayPanel.jsx';

// Pinned Evidence card (not in production, which only had "Show Pinned
// Evidence" as an alert; analyst decision 2026-11-15): this graph's pinned
// items in the shared overlay frame, so the analyst sees them at once.
// Clicking an item focuses it (shown first if the limit hides it); × on a row
// unpins it; "Show all" shows and fits every pinned item of this graph.
//
// Presented as the Graph Alerts card (analyst decision 2026-11-16): folded,
// a pinned node (amber, pin badge, the count inside); unfolded, it rises out
// of it; node / link counts and Show all on one line; the items grouped into
// Nodes and Links (sticky headings) as compact rows with a flat pin sign;
// × in the header folds it back; opens at the canvas's top-right corner and is resized from its bottom-left corner.
//
// items: [{ key, item, kind: 'node' | 'edge', name, detail, hidden }]
// elsewhere: how many pinned items belong to other graphs.
const PinSign = () => (
  <svg viewBox="0 0 24 24" focusable="false">
    <path className="graph_card_row_sign" d="M8.6 3h6.8a1 1 0 0 1 1 1.2l-.9 5 3.3 3.3a1 1 0 0 1-.7 1.7H5.9a1 1 0 0 1-.7-1.7l3.3-3.3-.9-5A1 1 0 0 1 8.6 3Z" />
    <path className="graph_card_row_stem" d="M12 14.2V21" />
  </svg>
);

const GROUPS = [{ kind: 'node', title: 'Nodes' }, { kind: 'edge', title: 'Links' }];

export default function GraphPinnedPanel({ items, elsewhere, summary, onFocus, onUnpin, onShowAll, ...frame }) {
  const nodes = items.filter((entry) => entry.kind === 'node').length;
  const links = items.length - nodes;
  const hidden = items.filter((entry) => entry.hidden).length;
  return (
    <GraphOverlayPanel
      {...frame}
      corner="top-right"
      className="is-node-card is-pinned-card"
      label="Pinned Evidence"
      title="Pinned Evidence"
      mark={<GraphCardNode tone="pinned" count={items.length} small />}
      summary={summary}
      bubble={<GraphCardNode tone="pinned" count={items.length} />}
      tip={items.length ? (
        <>
          {nodes ? <span className="graph_card_chip">{nodes} {nodes === 1 ? 'node' : 'nodes'}</span> : null}
          {links ? <span className="graph_card_chip">{links} {links === 1 ? 'link' : 'links'}</span> : null}
          {hidden ? <span className="graph_card_chip is-muted">{hidden} hidden</span> : null}
        </>
      ) : null}
    >
      <div className="graph_card_tools">
        <span className="graph_card_counts">
          {nodes ? <span className="graph_card_chip">{nodes} {nodes === 1 ? 'node' : 'nodes'}</span> : null}
          {links ? <span className="graph_card_chip">{links} {links === 1 ? 'link' : 'links'}</span> : null}
          {hidden ? <span className="graph_card_chip is-muted" title="Not shown at the current limit">{hidden} hidden</span> : null}
        </span>
        <button
          type="button"
          className="graph_card_pill"
          title="Show and fit every pinned item of this graph"
          disabled={!items.length}
          onClick={onShowAll}
        >
          Show all
        </button>
      </div>
      <div className="graph_overlay_list graph_card_list">
        {items.length ? GROUPS.map(({ kind, title: groupTitle }) => {
          const group = items.filter((entry) => entry.kind === kind);
          if (!group.length) return null;
          return (
            <section key={kind} className="graph_card_group" aria-label={`Pinned ${groupTitle.toLowerCase()}`}>
              <h5 className="graph_card_group_head">
                <span>{groupTitle}</span>
                <span className="graph_card_group_count">{group.length}</span>
              </h5>
              {group.map((entry, index) => (
                <div key={entry.key} className={`graph_card_row has-action${entry.hidden ? ' is-hidden' : ''}`} style={{ '--i': Math.min(index, 12) }}>
                  <button
                    type="button"
                    className="graph_card_row_main"
                    title="Click to focus it and open its details in the Info tab."
                    onClick={() => onFocus(entry.item)}
                  >
                    <span className="graph_card_row_mark" aria-hidden="true"><PinSign /></span>
                    <span className="graph_card_row_body">
                      <strong className="graph_card_row_name">{entry.name}</strong>
                      <span className="graph_card_row_line">
                        <span className="graph_card_row_category">{entry.kind === 'node' ? 'Node' : 'Link'}</span>
                        {entry.hidden ? <span className="graph_card_row_flag">not shown at this limit</span> : null}
                        {entry.detail ? <span className="graph_card_row_detail">{entry.detail}</span> : null}
                      </span>
                    </span>
                  </button>
                  <button type="button" className="graph_card_row_action" aria-label={`Unpin ${entry.name}`} title="Unpin" onClick={() => onUnpin(entry.item)}>×</button>
                </div>
              ))}
            </section>
          );
        }) : (
          <div className="graph_card_empty">
            <span className="graph_card_empty_mark is-muted" aria-hidden="true"><PinSign /></span>
            <p className="graph_overlay_empty">Nothing in this graph is pinned. Right-click a node: Evidence ▸ Pin Evidence.</p>
          </div>
        )}
        {elsewhere ? <p className="graph_card_elsewhere">{elsewhere} more pinned in other graphs.</p> : null}
      </div>
      <footer className="graph_card_footer">Click an item to focus it · drag the bottom-left corner to resize</footer>
    </GraphOverlayPanel>
  );
}
