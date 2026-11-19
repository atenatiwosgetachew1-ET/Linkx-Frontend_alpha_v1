import React from 'react';

// A node card's node (analyst decision 2026-11-16): drawn as the canvas draws
// the nodes the card lists, so the folded card reads as their representative.
// tone 'alert': MARKER_STYLES.alert (red border and glow) with the "!" badge;
// tone 'pinned': MARKER_STYLES.pinned (amber) with the pin badge
// (graphGlyphs); tone 'group': the group colour with the group badge (Merged
// & Grouped). The count is inside, in the border colour; with nothing to
// show it is a plain node that keeps its badge (so the cards stay told apart). `small`: the one beside the open
// card's title; `busy`: "…" while the card is working (a scan).
const BADGES = {
  alert: (
    <>
      <path d="M12 6.5v6.5" />
      <circle cx="12" cy="16.6" r="0.6" />
    </>
  ),
  pinned: (
    <>
      <path d="M9.5 6h5l-.8 4.3 2.8 2.7h-9l2.8-2.7Z" />
      <path d="M12 13v5" />
    </>
  ),
  group: (
    <>
      <circle cx="9.5" cy="10" r="2.2" />
      <circle cx="14.5" cy="10" r="2.2" />
      <circle cx="12" cy="14.5" r="2.2" />
    </>
  ),
};

// refresh (analyst decision 2026-11-17): a folded card with nothing to show
// draws a refresh sign instead of "×0" (clicking it rechecks); `spinning`
// turns it while the recheck runs.
const RefreshSign = ({ spinning }) => (
  <svg className={`graph_card_node_refresh${spinning ? ' is-spinning' : ''}`} viewBox="0 0 24 24" focusable="false">
    <path d="M20 11a8 8 0 1 0-2.3 5.6" />
    <path d="M20 4v6h-6" />
  </svg>
);

export default function GraphCardNode({ tone = 'alert', count, busy = false, small = false, refresh = false, spinning = false }) {
  const clean = refresh || (!busy && !count);
  return (
    <span className={`graph_card_node is-${tone}${small ? ' is-small' : ''}${clean ? ' is-clean' : ''}`} aria-hidden="true">
      {refresh ? <RefreshSign spinning={spinning} /> : <span className="graph_card_node_count">{busy ? '…' : `×${count}`}</span>}
      {/* The badge stays at 0 too: it tells the cards apart. */}
      {busy && !refresh ? null : (
        <svg className="graph_card_node_badge" viewBox="0 0 24 24" focusable="false">
          <circle cx="12" cy="12" r="10.5" />
          {BADGES[tone]}
        </svg>
      )}
    </span>
  );
}
