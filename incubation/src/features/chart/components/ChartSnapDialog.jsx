import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import { defaultImageTemplate } from '../lib/chartSnapTemplates.js';

// Export ▸ Take snaps… and Export ▸ Print charts… (analyst decisions
// 2026-11-18): which charts (All, or some of them), how they sit on the A4
// pages (Group: two across; Individual: one per page) and which column names
// the entities (as the Generate report popup's "Identify entities by").
// Defaults: All, Group, the label. Styled exactly as the Graph window's
// Generate report popup (the same card, header, flat sections, preview on
// the right and footer); the preview shows what will be downloaded or
// printed.
//
// purpose: 'snap' | 'print'; charts: [{ id, title, level, ready }] (ready:
// drawn, so it can be pictured); nameKeys: node properties to name entities
// by; load(nameKey) -> Promise<{ id: cell data URL }> (the Individual
// preview); compose(ids, nameKey) -> Promise<[page data URL]> (the Group
// preview); onSubmit({ ids, mode, nameKey, action: 'take' | 'download' }) ->
// Promise (busy until it
// settles); onCancel.
const PURPOSES = {
  snap: { title: 'Take snaps', mode: 'Snap', busy: 'Making the pictures…', action: (count) => (count > 1 ? `Take ${count} snaps` : 'Take snap'), acting: 'Taking…' },
  print: { title: 'Print charts', mode: 'Layout', busy: 'Preparing the pages…', action: (count) => (count > 1 ? `Print ${count} pages` : 'Print'), acting: 'Printing…' },
};
const SNAP_MODES = Object.freeze([
  { id: 'group', label: 'Group', hint: 'Two across A4 pages' },
  { id: 'individual', label: 'Individual', hint: 'One A4 page per chart' },
]);
const PREVIEW_TILES = 6;
// Charts on a Group page (pageLayout('group').perPage).
const GROUP_PER_PAGE = 6;

export default function ChartSnapDialog({
  purpose = 'snap', charts, nameKeys = [], load, compose, onSubmit, onCancel,
}) {
  const template = defaultImageTemplate();
  const text = PURPOSES[purpose] || PURPOSES.snap;
  const ready = useMemo(() => charts.filter((chart) => chart.ready), [charts]);
  const [chosen, setChosen] = useState(() => new Set(ready.map((chart) => chart.id)));
  const [mode, setMode] = useState('group');
  const [nameKey, setNameKey] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const idBase = useId();
  const titleId = `${idBase}-title`;
  const ids = ready.filter((chart) => chosen.has(chart.id)).map((chart) => chart.id);
  const all = ready.length > 0 && ids.length === ready.length;
  const some = ids.length > 0 && !all;

  const allRef = useRef(null);
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = some;
  }, [some]);
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

  // The preview, made again when the charts, the layout or the naming change
  // (the latest one only): Group, the composed pages; Individual, the charts'
  // pictures.
  const previewKey = `${mode}|${nameKey}|${ids.join('|')}`;
  const [preview, setPreview] = useState({ key: '', pages: [], tiles: {} });
  useEffect(() => {
    if (!ids.length) return undefined;
    let alive = true;
    const job = mode === 'group'
      ? Promise.resolve(compose?.(ids, nameKey)).then((pages) => ({ pages: pages || [], tiles: {} }))
      : Promise.resolve(load?.(nameKey)).then((tiles) => ({ pages: [], tiles: tiles || {} }));
    job.then((next) => { if (alive) setPreview({ key: previewKey, ...next }); });
    return () => { alive = false; };
    // By what it shows (previewKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const current = preview.key === previewKey;

  const toggle = (id) => setChosen((now) => {
    const next = new Set(now);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const toggleAll = () => setChosen(all ? new Set() : new Set(ready.map((chart) => chart.id)));
  // action: 'take' (snap: the PNGs; print: print the pages) or 'download'
  // (print: the pages as one PDF; analyst decision 2026-11-18).
  const [acting, setActing] = useState('');
  const run = async (action) => {
    if (busy || !ids.length) return;
    setBusy(true);
    setActing(action);
    try {
      await onSubmit({ ids, mode, nameKey, action });
    } finally {
      setBusy(false);
      setActing('');
    }
  };
  const submit = (event) => {
    event.preventDefault();
    run('take');
  };
  // Group: a page per six charts (known once composed).
  const groupPages = current && preview.pages.length ? preview.pages.length : Math.max(1, Math.ceil(ids.length / GROUP_PER_PAGE));
  const pages = mode === 'group' ? groupPages : ids.length;
  const section = (title, children) => (
    <fieldset className="graph_customize_section graph_report_section" disabled={busy}>
      <legend className="graph_customize_section_head">{title}</legend>
      {children}
    </fieldset>
  );

  return (
    <div className="graph_customize_backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form ref={ref} className="graph_customize is-report chart_snap" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>{text.title}</strong>
            <span>{template.name}</span>
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" disabled={busy} onClick={onCancel}>×</button>
        </header>
        <div className="graph_customize_body">
          <div className="graph_customize_options">
            {section('Charts', (
              <>
                <label className="graph_report_check chart_snap_all">
                  <input ref={allRef} type="checkbox" checked={all} disabled={!ready.length} onChange={toggleAll} />
                  <span>All</span>
                  <small className="chart_snap_count">{ids.length.toLocaleString()} of {ready.length.toLocaleString()}</small>
                </label>
                <ul className="chart_snap_list" aria-label="Charts">
                  {charts.map((chart) => (
                    <li key={chart.id}>
                      <label className="graph_report_check" title={chart.ready ? '' : 'Still being drawn: it can be pictured once shown'}>
                        <input type="checkbox" checked={chart.ready && chosen.has(chart.id)} disabled={!chart.ready} onChange={() => toggle(chart.id)} />
                        <span>{chart.title}</span>
                        <small className="chart_snap_level">{chart.ready ? chart.level : 'Drawing…'}</small>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ))}
            {section(text.mode, (
              <div className="chart_snap_modes" role="radiogroup" aria-label={`${text.mode} type`}>
                {SNAP_MODES.map((entry) => (
                  <label key={entry.id} className="graph_report_check">
                    <input type="radio" name={`${idBase}-mode`} value={entry.id} checked={mode === entry.id} onChange={() => setMode(entry.id)} />
                    <span>{entry.label}</span>
                    <small className="chart_snap_level">{entry.hint}</small>
                  </label>
                ))}
              </div>
            ))}
            {section('Entities', (
              <div className="graph_report_row">
                <label className="graph_customize_field">
                  <span className="graph_customize_field_label">Identify entities by</span>
                  <select className="graph_customize_input" value={nameKey} aria-describedby={`${idBase}-name-hint`} onChange={(event) => setNameKey(event.target.value)}>
                    <option value="">Label (else the node ID)</option>
                    {nameKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                  </select>
                </label>
                <small id={`${idBase}-name-hint`} className="graph_customize_hint graph_report_hint">The column that names each entity on the pages: along the charts, on the selection pins and in link names. Entities without a value keep their label.</small>
              </div>
            ))}
          </div>
          {/* Its height is the options' (the picture never stretches the popup). */}
          <figure className="graph_customize_preview graph_report_preview chart_snap_preview" aria-label="Preview">
            <div className={`chart_snap_stage${mode === 'individual' && ids.length ? ' is-tiles' : ''}`}>
              {!ids.length ? (
                <p className="chart_snap_empty">Choose a chart to picture.</p>
              ) : mode === 'group' ? (
                current && preview.pages.length
                  ? <img className="chart_snap_image" src={preview.pages[0]} alt={preview.pages.length > 1 ? `Page 1 of ${preview.pages.length}: the chosen charts, two across` : `The ${ids.length} chosen charts on one page`} />
                  : <p className="chart_snap_empty">{current ? 'No preview' : 'Composing…'}</p>
              ) : (
                <div className="chart_snap_tiles">
                  {ids.slice(0, PREVIEW_TILES).map((id) => (current && preview.tiles[id]
                    ? <img key={id} className="chart_snap_image" src={preview.tiles[id]} alt={charts.find((chart) => chart.id === id)?.title || ''} />
                    : <span key={id} className="chart_snap_tile">{charts.find((chart) => chart.id === id)?.title}</span>))}
                  {ids.length > PREVIEW_TILES ? <span className="chart_snap_more">+{(ids.length - PREVIEW_TILES).toLocaleString()} more</span> : null}
                </div>
              )}
            </div>
            <figcaption className="graph_customize_caption">
              {ids.length.toLocaleString()} {ids.length === 1 ? 'chart' : 'charts'} · {pages.toLocaleString()} A4 {pages === 1 ? 'page' : 'pages'}{purpose === 'snap' ? ' (PNG)' : ''}
              <br />
              As drawn now (colours, zoom, selection pins), in the {template.name} frame.
            </figcaption>
          </figure>
        </div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">{busy ? (acting === 'download' ? 'Making the PDF…' : text.busy) : mode === 'group' ? 'A4 pages, two charts across, six a page.' : 'A4 pages, one chart each, full width.'}</span>
          <button type="button" className="graph_customize_button" disabled={busy} onClick={onCancel}>Cancel</button>
          {/* Print: the same pages as one PDF, to keep or send. */}
          {purpose === 'print' ? (
            <button type="button" className="graph_customize_button" disabled={busy || !ids.length} onClick={() => run('download')}>{acting === 'download' ? 'Making…' : 'Download PDF'}</button>
          ) : null}
          <button type="submit" className="graph_customize_button is-primary" disabled={busy || !ids.length}>{acting === 'take' ? text.acting : text.action(pages)}</button>
        </footer>
      </form>
    </div>
  );
}
