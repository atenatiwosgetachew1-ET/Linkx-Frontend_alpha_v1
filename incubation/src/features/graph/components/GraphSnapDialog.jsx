import React, { useEffect, useId, useRef, useState } from 'react';

import { defaultImageTemplate } from '../../chart/lib/chartSnapTemplates.js';

// Export ▸ Take a snap… and Export ▸ Print graph… (analyst decision
// 2026-11-18): the view as it is drawn, on an A4 page in the image template
// (the NBE frame, as the Chart window's snaps), with a node's actor profile
// card in the picture if wanted (the card a click on a node shows; it closes
// when the view is left, and a plain capture never had it). Styled exactly
// as the Generate report popup; the preview shows the page.
//
// purpose: 'snap' | 'print'; candidates: [{ id, name, open }] (the selected
// nodes; open: its card was open); initialCards: the ones shown by default
// (the open card's node); cardsEnabled: the graph shows actor profiles;
// maxCards: how many cards a picture carries at most (4);
// compose({ orientation, cardIds }) -> Promise<page data URL | null>;
// onSubmit({ orientation, cardIds, action: 'take' | 'download' }) -> Promise;
// onCancel.
const PURPOSES = {
  snap: { title: 'Take a snap', busy: 'Making the picture…', action: 'Take snap', acting: 'Taking…' },
  print: { title: 'Print graph', busy: 'Preparing the page…', action: 'Print', acting: 'Printing…' },
};
const ORIENTATIONS = Object.freeze([
  { id: 'landscape', label: 'Landscape', hint: 'A4 on its side (most graphs are wide)' },
  { id: 'portrait', label: 'Portrait', hint: 'A4 upright' },
]);

export default function GraphSnapDialog({
  purpose = 'snap', candidates = [], initialCards = [], cardsEnabled = true, maxCards = 4, compose, onSubmit, onCancel,
}) {
  const template = defaultImageTemplate();
  const text = PURPOSES[purpose] || PURPOSES.snap;
  const [orientation, setOrientation] = useState('landscape');
  // Cards for the selected nodes only (analyst decision 2026-11-18).
  const canCard = cardsEnabled && candidates.length > 0;
  const [cardIds, setCardIds] = useState(() => (canCard ? initialCards.filter((id) => candidates.some((entry) => entry.id === id)).slice(0, maxCards) : []));
  const toggleCard = (id) => setCardIds((now) => (now.includes(id) ? now.filter((entry) => entry !== id) : now.length < maxCards ? [...now, id] : now));
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const idBase = useId();
  const titleId = `${idBase}-title`;

  useEffect(() => {
    ref.current?.querySelector('input')?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  // The page, made again for each choice (the latest one only).
  const previewKey = `${orientation}|${cardIds.join('|')}`;
  const [preview, setPreview] = useState({ key: '', url: null });
  useEffect(() => {
    let alive = true;
    Promise.resolve(compose?.({ orientation, cardIds })).then((url) => { if (alive) setPreview({ key: previewKey, url: url || null }); });
    return () => { alive = false; };
    // By the choice (previewKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const current = preview.key === previewKey;

  // action: 'take' (snap: the PNG; print: print the page) or 'download'
  // (print: the page as a PDF; analyst decision 2026-11-18).
  const [acting, setActing] = useState('');
  const run = async (action) => {
    if (busy) return;
    setBusy(true);
    setActing(action);
    try {
      await onSubmit({ orientation, cardIds, action });
    } finally {
      setBusy(false);
      setActing('');
    }
  };
  const submit = (event) => {
    event.preventDefault();
    run('take');
  };
  const section = (title, children) => (
    <fieldset className="graph_customize_section graph_report_section" disabled={busy}>
      <legend className="graph_customize_section_head">{title}</legend>
      {children}
    </fieldset>
  );

  return (
    <div className="graph_customize_backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form ref={ref} className="graph_customize is-report chart_snap graph_snap" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>{text.title}</strong>
            <span>{template.name}</span>
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" disabled={busy} onClick={onCancel}>×</button>
        </header>
        <div className="graph_customize_body">
          <div className="graph_customize_options">
            {section('Page', (
              <div className="chart_snap_modes" role="radiogroup" aria-label="Page orientation">
                {ORIENTATIONS.map((entry) => (
                  <label key={entry.id} className="graph_report_check">
                    <input type="radio" name={`${idBase}-orientation`} value={entry.id} checked={orientation === entry.id} onChange={() => setOrientation(entry.id)} />
                    <span>{entry.label}</span>
                    <small className="chart_snap_level">{entry.hint}</small>
                  </label>
                ))}
              </div>
            ))}
            {section('Node cards', (
              <>
                <div className="graph_report_check chart_snap_all is-heading">
                  <span>Show the profiles of</span>
                  <small className="chart_snap_count">{cardIds.length} of {maxCards}</small>
                </div>
                {canCard ? (
                  <ul className="chart_snap_list" aria-label="Show the profiles of">
                    {candidates.map((entry) => {
                      const checked = cardIds.includes(entry.id);
                      return (
                        <li key={entry.id}>
                          <label className="graph_report_check" title={!checked && cardIds.length >= maxCards ? `At most ${maxCards} cards a picture` : ''}>
                            <input type="checkbox" checked={checked} disabled={!checked && cardIds.length >= maxCards} onChange={() => toggleCard(entry.id)} />
                            <span>{entry.name}</span>
                            {entry.open ? <small className="chart_snap_level">Card open</small> : null}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                <small className="graph_customize_hint">
                  {!cardsEnabled
                    ? 'Actor profiles are off for this graph (Settings ▸ This graph ▸ Actor profile).'
                    : !candidates.length
                      ? 'Select nodes on the graph to show their profile cards in the picture.'
                      : `The cards a click on a node shows, drawn beside their nodes (at most ${maxCards}; a card that would cover another moves aside, with a line to its node).`}
                </small>
              </>
            ))}
          </div>
          {/* Its height is the options' (the picture never stretches the popup). */}
          <figure className="graph_customize_preview graph_report_preview chart_snap_preview" aria-label="Preview">
            <div className="chart_snap_stage">
              {current && preview.url
                ? <img className="chart_snap_image" src={preview.url} alt={`The graph on an A4 ${orientation} page`} />
                : <p className="chart_snap_empty">{current ? 'No preview' : 'Composing…'}</p>}
            </div>
            <figcaption className="graph_customize_caption">
              1 A4 {orientation} page{purpose === 'snap' ? ' (PNG)' : ''}
              <br />
              The view as drawn now, in the {template.name} frame.
            </figcaption>
          </figure>
        </div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">{busy ? (acting === 'download' ? 'Making the PDF…' : text.busy) : 'What the canvas shows now: pan and zoom it first to frame the picture.'}</span>
          <button type="button" className="graph_customize_button" disabled={busy} onClick={onCancel}>Cancel</button>
          {/* Print: the page as a PDF, to keep or send. */}
          {purpose === 'print' ? (
            <button type="button" className="graph_customize_button" disabled={busy} onClick={() => run('download')}>{acting === 'download' ? 'Making…' : 'Download PDF'}</button>
          ) : null}
          <button type="submit" className="graph_customize_button is-primary" disabled={busy}>{acting === 'take' ? text.acting : text.action}</button>
        </footer>
      </form>
    </div>
  );
}
