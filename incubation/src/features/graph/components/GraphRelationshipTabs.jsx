import React, { useEffect, useRef } from 'react';

// The linked session's relationships as tabs across the top of the canvas
// (production A:8675 drew a strip of pills filled with the backend's colours
// under the canvas; analyst decision 2026-11-15). All first, then each
// relationship with a dot in its backend colour; the drawn tab joins the canvas, filled with the backend's
// colour pair; a spinner on the one loading. Names read as words ("Fund flow"); the backend code stays each
// tab's name and title. Arrow keys move along the tabs; the wheel scrolls
// the row sideways when they do not fit; the drawn tab is scrolled into view.
//
// relationships: [{ type, bgcolor, textcolor }]; active: the drawn type
// ('*' for all); busy: a graph is loading; onPick(type).
const relationshipText = (type) => {
  if (type === '*') return 'All';
  const words = String(type).replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : String(type);
};

export default function GraphRelationshipTabs({ sessionId, relationships, active, busy, onPick }) {
  const rowRef = useRef(null);

  useEffect(() => {
    rowRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active, relationships.length]);

  const onWheel = (event) => {
    const row = event.currentTarget;
    if (row.scrollWidth <= row.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    row.scrollLeft += event.deltaY;
  };
  const onKeyDown = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
    const tabs = [...rowRef.current.querySelectorAll('[role="tab"]')];
    const at = tabs.indexOf(document.activeElement);
    if (at < 0) return;
    event.preventDefault();
    let next = at;
    if (event.key === 'ArrowRight') next = (at + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (at - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else next = tabs.length - 1;
    tabs[next].focus();
  };

  if (!relationships.length) {
    return (
      <div className="graph_relationship_tabs is-waiting" role="status">
        Waiting for relationships from session {sessionId}…
      </div>
    );
  }
  const focusable = active === '*' || relationships.some((item) => item.type === active) ? active : '*';

  return (
    <div ref={rowRef} className="graph_relationship_tabs" role="tablist" aria-label="Graph relationships" onWheel={onWheel} onKeyDown={onKeyDown}>
      {['*', ...relationships].map((item) => {
        const all = item === '*';
        const type = all ? '*' : item.type;
        const selected = active === type;
        const loading = busy && selected;
        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={all ? 'All (*)' : type}
            tabIndex={type === focusable ? 0 : -1}
            className={`graph_relationship_tab${selected ? ' is-active' : ''}`}
            title={all ? 'All relationships' : type}
            style={all ? undefined : { '--chip-bg': item.bgcolor, '--chip-text': item.textcolor }}
            onClick={() => onPick(type)}
          >
            {all ? (
              <span className="graph_relationship_stack" aria-hidden="true">
                {relationships.slice(0, 3).map((entry) => <span key={entry.type} style={{ '--chip-bg': entry.bgcolor }} />)}
              </span>
            ) : (
              <span className={`graph_relationship_dot${loading ? ' is-loading' : ''}`} aria-hidden="true" />
            )}
            {loading && all ? <span className="graph_relationship_dot is-loading" aria-hidden="true" /> : null}
            <span className="graph_relationship_tab_text">{relationshipText(type)}</span>
          </button>
        );
      })}
    </div>
  );
}
