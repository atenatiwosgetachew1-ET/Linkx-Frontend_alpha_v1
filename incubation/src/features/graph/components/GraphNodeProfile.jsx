import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { profileOf } from '../lib/nodeProfile.js';

// Actor profile card (analyst decision 2026-11-16; not in production): a
// click on a node shows it beside the node, in the look of the right-click
// box. Split in two: a square portrait on the left, the person's details on
// the right, filled from the node's properties as mapped in Configuration ▸
// Rules ▸ Profile mapping fields (lib/nodeProfile.js; a placeholder and "—"
// without them). Values are shown whole (they wrap; the card widens first):
// they are critical. The background, Escape, × or moving the view closes it.
//
// node: the clicked node's data; at { x, y }: its place on the canvas;
// settings: the graph's profile settings; isCdr: CDR value formatting.
const OFFSET = 18;
const MARGIN = 8;

// No portrait for this node: a quiet placeholder (no picture is made up).
const NoPortrait = () => (
  <div className="graph_profile_portrait_none" role="img" aria-label="No portrait">
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="9" r="3.6" />
      <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" />
    </svg>
  </div>
);

export default function GraphNodeProfile({ node, at, settings, isCdr = false, onClose }) {
  const ref = useRef(null);
  const [portraitFailed, setPortraitFailed] = useState(false);
  const profile = profileOf(node, settings, { isCdr });

  // Beside the node, kept inside the canvas (left of it when no room right);
  // first the portrait is sized, since it sets the card's width.
  useLayoutEffect(() => {
    const element = ref.current;
    const stage = element?.parentElement;
    if (!element || !stage) return;
    // The portrait: square, as tall as the details beside it.
    const portrait = element.querySelector('.graph_profile_portrait');
    const body = element.querySelector('.graph_profile_body');
    if (portrait && body?.offsetHeight) {
      portrait.style.width = `${body.offsetHeight}px`;
      portrait.style.height = `${body.offsetHeight}px`;
    }
    const right = at.x + OFFSET;
    const left = right + element.offsetWidth <= stage.clientWidth - MARGIN ? right : at.x - OFFSET - element.offsetWidth;
    const top = at.y - element.offsetHeight / 2;
    element.style.left = `${Math.max(MARGIN, Math.min(left, stage.clientWidth - element.offsetWidth - MARGIN))}px`;
    element.style.top = `${Math.max(MARGIN, Math.min(top, stage.clientHeight - element.offsetHeight - MARGIN))}px`;
  }, [at.x, at.y]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section ref={ref} className="graph_profile" aria-label="Actor profile" onContextMenu={(event) => event.preventDefault()}>
      <div className="graph_profile_portrait">
        {profile.portrait && !portraitFailed
          ? <img className="graph_profile_portrait_art" src={profile.portrait} alt="Portrait" referrerPolicy="no-referrer" onError={() => setPortraitFailed(true)} />
          : <NoPortrait />}
      </div>
      <div className="graph_profile_body">
        <header className="graph_profile_head">
          <span className="graph_profile_kicker">Actor profile</span>
          <button type="button" className="graph_profile_close" aria-label="Close profile" title="Close" onClick={onClose}>×</button>
        </header>
        {profile.fields.length ? null : <p className="graph_profile_none">No details chosen. Settings ▸ This graph ▸ Actor profile.</p>}
        <dl className="graph_profile_fields">
          {profile.fields.map((field) => (
            <div key={field.key} className="graph_profile_field">
              <dt>{field.label}</dt>
              <dd className={field.value ? '' : 'is-empty'}>{field.value || '—'}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
