import React from 'react';

import GraphCardNode from './GraphCardNode.jsx';
import GraphOverlayPanel from './GraphOverlayPanel.jsx';

// Merged & Grouped card (not in production; analyst decision 2026-11-15):
// the graph's group nodes and merged nodes, which are hard to tell apart on
// the canvas, in the shared overlay frame. Clicking an item focuses it
// (shown first if the limit hides it); a group can be ungrouped from here.
//
// Presented as the Graph Alerts card (analyst decision 2026-11-16): folded,
// a node in the group colour with the group badge and the count inside;
// unfolded, it rises out of it; grouped / merged / hidden counts on one line;
// Groups and Merged sections (sticky headings) of compact rows with a flat
// sign in the canvas badge colour; × in the header folds it back; resized
// from its bottom-right corner; it opens at the canvas's top-left corner.
//
// items: [{ key, id, kind: 'group' | 'merged', name, count, detail, hidden }]
const GroupSign = () => (
  <svg viewBox="0 0 24 24" focusable="false">
    <circle className="graph_card_row_sign" cx="8" cy="9" r="4.2" />
    <circle className="graph_card_row_sign" cx="16" cy="9" r="4.2" />
    <circle className="graph_card_row_sign" cx="12" cy="16.2" r="4.2" />
  </svg>
);
const MergedSign = () => (
  <svg viewBox="0 0 24 24" focusable="false">
    <path className="graph_card_row_stem" d="M6 4.5l6 7.5 6-7.5" />
    <path className="graph_card_row_stem" d="M12 12v7.5" />
  </svg>
);

const GROUPS = [{ kind: 'group', title: 'Groups' }, { kind: 'merged', title: 'Merged' }];

export default function GraphCombinedPanel({ items, summary, onFocus, onUngroup, ...frame }) {
  const grouped = items.filter((entry) => entry.kind === 'group').length;
  const merged = items.length - grouped;
  const hidden = items.filter((entry) => entry.hidden).length;
  return (
    <GraphOverlayPanel
      {...frame}
      corner="top-left"
      className="is-node-card is-combined-card"
      label="Merged & Grouped"
      title="Merged & Grouped"
      mark={<GraphCardNode tone="group" count={items.length} small />}
      summary={summary}
      bubble={<GraphCardNode tone="group" count={items.length} />}
      tip={items.length ? (
        <>
          {grouped ? <span className="graph_card_chip is-group">{grouped} grouped</span> : null}
          {merged ? <span className="graph_card_chip is-merged">{merged} merged</span> : null}
          {hidden ? <span className="graph_card_chip is-muted">{hidden} hidden</span> : null}
        </>
      ) : null}
    >
      {items.length ? (
        <div className="graph_card_tools">
          <span className="graph_card_counts">
            {grouped ? <span className="graph_card_chip is-group">{grouped} grouped</span> : null}
            {merged ? <span className="graph_card_chip is-merged">{merged} merged</span> : null}
            {hidden ? <span className="graph_card_chip is-muted" title="Not shown at the current limit">{hidden} hidden</span> : null}
          </span>
        </div>
      ) : null}
      <div className="graph_overlay_list graph_card_list">
        {items.length ? GROUPS.map(({ kind, title: groupTitle }) => {
          const group = items.filter((entry) => entry.kind === kind);
          if (!group.length) return null;
          return (
            <section key={kind} className={`graph_card_group is-${kind}`} aria-label={groupTitle}>
              <h5 className="graph_card_group_head">
                <span>{groupTitle}</span>
                <span className="graph_card_group_count">{group.length}</span>
              </h5>
              {group.map((entry, index) => (
                <div key={entry.key} className={`graph_card_row has-action is-${entry.kind}${entry.hidden ? ' is-hidden' : ''}`} style={{ '--i': Math.min(index, 12) }}>
                  <button
                    type="button"
                    className="graph_card_row_main"
                    title={`${entry.detail}\nClick to focus it and open its details in the Info tab.`}
                    onClick={() => onFocus(entry.id)}
                  >
                    <span className="graph_card_row_mark" aria-hidden="true">{entry.kind === 'group' ? <GroupSign /> : <MergedSign />}</span>
                    <span className="graph_card_row_body">
                      <strong className="graph_card_row_name">{entry.name}</strong>
                      <span className="graph_card_row_line">
                        <span className="graph_card_row_category">{entry.count}</span>
                        {entry.hidden ? <span className="graph_card_row_flag">not shown at this limit</span> : null}
                        <span className="graph_card_row_detail">{entry.detail}</span>
                      </span>
                    </span>
                  </button>
                  {entry.kind === 'group' ? (
                    <button type="button" className="graph_card_row_action is-text" aria-label={`Ungroup ${entry.name}`} title="Ungroup" onClick={() => onUngroup(entry.id)}>
                      Ungroup
                    </button>
                  ) : null}
                </div>
              ))}
            </section>
          );
        }) : (
          <div className="graph_card_empty">
            <span className="graph_card_empty_mark is-muted" aria-hidden="true"><GroupSign /></span>
            <p className="graph_overlay_empty">No merged or grouped nodes in this graph. Select nodes and right-click: Edit ▸ Group Nodes or Merge Nodes.</p>
          </div>
        )}
      </div>
      <footer className="graph_card_footer">Click an item to focus it · drag the bottom-right corner to resize</footer>
    </GraphOverlayPanel>
  );
}
