import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import { AUTO_LANDSCAPE_COLUMNS, MIN_COLUMN_MM, TABLE_PDF_MAX_ROWS, columnSets, pageOrientation } from '../lib/tablePdf.js';

// Export ▸ Print table… (analyst decision 2026-11-18): the rows (as shown,
// all in the scope, or those selected on the graph), the columns (the ones
// in sight, in their order, by default) and the page (Auto: landscape past
// AUTO_LANDSCAPE_COLUMNS columns), then a PDF in the NBE frame: Download PDF,
// or Print (the PDF opened in a new tab, its print dialog asked for).
// Styled exactly as the Generate report popup; the preview shows page 1.
//
// rowCounts: { shown, all, selected }; columns: [{ key, label, hidden }] in
// their order; compose({ rowsMode, columnKeys, orientation }) -> Promise<page
// 1 data URL | null>; onSubmit({ rowsMode, columnKeys, orientation, action:
// 'download' | 'print' }) -> Promise; onCancel.
const ROW_MODES = Object.freeze([
  { id: 'shown', label: 'As shown', hint: 'Filtered and sorted as in the window' },
  { id: 'all', label: 'All in the scope', hint: 'Without the filter' },
  { id: 'selected', label: 'Selected on the graph', hint: 'Only what is selected' },
]);
const ORIENTATIONS = Object.freeze([
  { id: 'auto', label: 'Auto', hint: `Landscape past ${AUTO_LANDSCAPE_COLUMNS} columns` },
  { id: 'portrait', label: 'Portrait', hint: 'A4 upright' },
  { id: 'landscape', label: 'Landscape', hint: 'A4 on its side' },
]);

// defaultRowsMode / defaultOrientation: how the dialog starts (Libraries ▸
// Table defaults).
export default function TablePrintDialog({ title = 'Print table', rowCounts, columns, defaultRowsMode = 'shown', defaultOrientation = 'auto', compose, onSubmit, onCancel }) {
  const [rowsMode, setRowsMode] = useState(() => (ROW_MODES.some((mode) => mode.id === defaultRowsMode) ? defaultRowsMode : 'shown'));
  const [chosen, setChosen] = useState(() => new Set(columns.filter((column) => !column.hidden).map((column) => column.key)));
  const [orientation, setOrientation] = useState(() => (ORIENTATIONS.some((entry) => entry.id === defaultOrientation) ? defaultOrientation : 'auto'));
  const [busy, setBusy] = useState('');
  const ref = useRef(null);
  const allRef = useRef(null);
  const idBase = useId();
  const titleId = `${idBase}-title`;
  const columnKeys = useMemo(() => columns.filter((column) => chosen.has(column.key)).map((column) => column.key), [chosen, columns]);
  const all = columnKeys.length === columns.length;
  const some = columnKeys.length > 0 && !all;
  const rowCount = rowCounts[rowsMode] || 0;

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

  // Page 1, made again for each choice (the latest one only).
  const previewKey = `${rowsMode}|${orientation}|${columnKeys.join('|')}`;
  const [preview, setPreview] = useState({ key: '', url: null });
  useEffect(() => {
    if (!columnKeys.length) return undefined;
    let alive = true;
    Promise.resolve(compose?.({ rowsMode, columnKeys, orientation })).then((url) => { if (alive) setPreview({ key: previewKey, url: url || null }); });
    return () => { alive = false; };
    // By the choice (previewKey).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);
  const current = preview.key === previewKey;

  const toggle = (key) => setChosen((now) => {
    const next = new Set(now);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  const toggleAll = () => setChosen(all ? new Set() : new Set(columns.map((column) => column.key)));
  const run = async (action) => {
    if (busy || !columnKeys.length) return;
    setBusy(action);
    try {
      await onSubmit({ rowsMode, columnKeys, orientation, action });
    } finally {
      setBusy('');
    }
  };
  const paper = pageOrientation(orientation, columnKeys.length);
  // Columns never squeezed below MIN_COLUMN_MM: past what a page holds, they
  // continue on the next pages in sets, Label repeated (about: wide values
  // take more room).
  const sets = columnSets(columnKeys.length, paper);
  const section = (heading, children) => (
    <fieldset className="graph_customize_section graph_report_section" disabled={Boolean(busy)}>
      <legend className="graph_customize_section_head">{heading}</legend>
      {children}
    </fieldset>
  );

  return (
    <div className="graph_customize_backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form ref={ref} className="graph_customize is-report chart_snap table_print" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={(event) => { event.preventDefault(); run('print'); }}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>{title}</strong>
            <span>NBE LinkX Table</span>
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" disabled={Boolean(busy)} onClick={onCancel}>×</button>
        </header>
        <div className="graph_customize_body">
          <div className="graph_customize_options">
            {section('Rows', (
              <div className="chart_snap_modes" role="radiogroup" aria-label="Rows">
                {ROW_MODES.map((entry) => (
                  <label key={entry.id} className="graph_report_check">
                    <input type="radio" name={`${idBase}-rows`} value={entry.id} checked={rowsMode === entry.id} onChange={() => setRowsMode(entry.id)} />
                    <span>{entry.label}</span>
                    <small className="chart_snap_level">{(rowCounts[entry.id] || 0).toLocaleString()} · {entry.hint}</small>
                  </label>
                ))}
              </div>
            ))}
            {section('Columns', (
              <>
                <label className="graph_report_check chart_snap_all">
                  <input ref={allRef} type="checkbox" checked={all} onChange={toggleAll} />
                  <span>All</span>
                  <small className="chart_snap_count">{columnKeys.length} of {columns.length}</small>
                </label>
                <ul className="chart_snap_list" aria-label="Columns">
                  {columns.map((column) => (
                    <li key={column.key}>
                      <label className="graph_report_check">
                        <input type="checkbox" checked={chosen.has(column.key)} onChange={() => toggle(column.key)} />
                        <span>{column.label}</span>
                        {column.hidden ? <small className="chart_snap_level">Hidden in the window</small> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ))}
            {sets > 1 ? (
              <p className="graph_customize_hint table_print_sets" role="note">
                {columnKeys.length} columns: printed in about {sets} page sets, Label repeated in each (no column narrower than {MIN_COLUMN_MM} mm).
                {paper === 'portrait' ? ' Landscape needs fewer.' : ' Untick columns for fewer.'}
              </p>
            ) : null}
            {section('Page', (
              <div className="chart_snap_modes" role="radiogroup" aria-label="Page orientation">
                {ORIENTATIONS.map((entry) => (
                  <label key={entry.id} className="graph_report_check">
                    <input type="radio" name={`${idBase}-page`} value={entry.id} checked={orientation === entry.id} onChange={() => setOrientation(entry.id)} />
                    <span>{entry.label}</span>
                    <small className="chart_snap_level">{entry.hint}</small>
                  </label>
                ))}
              </div>
            ))}
          </div>
          {/* Its height is the options' (the picture never stretches the popup). */}
          <figure className="graph_customize_preview graph_report_preview chart_snap_preview" aria-label="Preview">
            <div className="chart_snap_stage">
              {!columnKeys.length ? (
                <p className="chart_snap_empty">Choose a column to print.</p>
              ) : current && preview.url
                ? <img className="chart_snap_image" src={preview.url} alt={`Page 1 of the table, A4 ${paper}`} />
                : <p className="chart_snap_empty">{current ? 'No preview' : 'Composing…'}</p>}
            </div>
            <figcaption className="graph_customize_caption">
              {Math.min(rowCount, TABLE_PDF_MAX_ROWS).toLocaleString()} {rowCount === 1 ? 'row' : 'rows'} · {columnKeys.length} {columnKeys.length === 1 ? 'column' : 'columns'} · A4 {paper}
              <br />
              {rowCount > TABLE_PDF_MAX_ROWS ? `The first ${TABLE_PDF_MAX_ROWS.toLocaleString()} of ${rowCount.toLocaleString()} rows (the PDF says so). ` : ''}Page 1, as a preview; the column header repeats on every page.
            </figcaption>
          </figure>
        </div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">{busy ? 'Making the PDF…' : 'Print opens the PDF in a new tab, ready to print.'}</span>
          <button type="button" className="graph_customize_button" disabled={Boolean(busy)} onClick={onCancel}>Cancel</button>
          <button type="button" className="graph_customize_button" disabled={Boolean(busy) || !columnKeys.length} onClick={() => run('download')}>{busy === 'download' ? 'Making…' : 'Download PDF'}</button>
          <button type="submit" className="graph_customize_button is-primary" disabled={Boolean(busy) || !columnKeys.length}>{busy === 'print' ? 'Opening…' : 'Print'}</button>
        </footer>
      </form>
    </div>
  );
}
