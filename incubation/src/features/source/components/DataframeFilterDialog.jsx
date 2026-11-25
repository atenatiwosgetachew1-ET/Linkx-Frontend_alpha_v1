import React, { useEffect, useId, useMemo, useRef, useState } from 'react';

import {
  FILTER_LIMITS, FILTER_OPERATORS, describeFilter, filterIsActive, filterPayload, filterProblems, newCondition, normalizeFilter, operatorById,
} from '../lib/dataframeFilter.js';

// Dataframe ▸ Filter dataframe… (analyst decisions 2026-11-19): strip
// columns, keep or remove rows by conditions and clean up, before the data
// is ingested and analysed. The Generate report popup's frame, laid out as
// one tight panel: three tabs (Columns, Rows, Clean-up) over one fixed-height
// area, and below it what is ingested, in plain words, with Count rows.
//
// columns: the dataframe's column names; totalRows: its row count (a number,
// or text such as "Live"); used: columns the chosen action needs (cannot be
// stripped); initial: the filter applied now (or null); onPreview(payload)
// -> Promise<{ available, totalRows, keptRows, keptColumns, message }> (the
// Service's preview, B-28); onApply(filter | null); onCancel.
export default function DataframeFilterDialog({ columns = [], totalRows = null, used = [], initial = null, onPreview, onApply, onCancel }) {
  const [filter, setFilter] = useState(() => normalizeFilter(initial, columns));
  const [tab, setTab] = useState('columns');
  const [columnQuery, setColumnQuery] = useState('');
  const [preview, setPreview] = useState({ key: '', state: 'idle', result: null });
  const ref = useRef(null);
  const idBase = useId();
  const titleId = `${idBase}-title`;

  useEffect(() => {
    ref.current?.querySelector('[role="tab"][aria-selected="true"]')?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const problems = filterProblems(filter, { columns, used });
  const lines = describeFilter(filter);
  const active = filterIsActive(filter);
  const payload = useMemo(() => filterPayload(filter), [filter]);
  const payloadKey = JSON.stringify(payload);
  const keptColumns = columns.length - filter.dropColumns.length;
  const cleanups = Number(filter.trimWhitespace) + Number(filter.dropDuplicates) + filter.dropEmptyIn.length;
  const rowsNarrowed = filter.rows.conditions.length > 0 || filter.dropEmptyIn.length > 0 || filter.dropDuplicates;

  /* ── Columns ── */
  const shownColumns = columns.filter((column) => column.toLowerCase().includes(columnQuery.trim().toLowerCase()));
  const toggleDrop = (column) => setFilter((now) => ({
    ...now,
    dropColumns: now.dropColumns.includes(column) ? now.dropColumns.filter((entry) => entry !== column) : [...now.dropColumns, column],
  }));
  const keepAllShown = () => setFilter((now) => ({ ...now, dropColumns: now.dropColumns.filter((column) => !shownColumns.includes(column)) }));
  const stripAllShown = () => setFilter((now) => ({ ...now, dropColumns: [...new Set([...now.dropColumns, ...shownColumns.filter((column) => !used.includes(column))])] }));

  /* ── Rows ── */
  const setRows = (patch) => setFilter((now) => ({ ...now, rows: { ...now.rows, ...patch } }));
  const setCondition = (index, patch) => setFilter((now) => ({
    ...now,
    rows: { ...now.rows, conditions: now.rows.conditions.map((condition, at) => (at === index ? { ...condition, ...patch } : condition)) },
  }));
  const addCondition = () => setFilter((now) => (now.rows.conditions.length >= FILTER_LIMITS.conditions ? now : {
    ...now,
    rows: { ...now.rows, conditions: [...now.rows.conditions, newCondition(columns.find((column) => !now.dropColumns.includes(column)) || '')] },
  }));
  const removeCondition = (index) => setFilter((now) => ({ ...now, rows: { ...now.rows, conditions: now.rows.conditions.filter((_, at) => at !== index) } }));

  /* ── Clean-up ── */
  const toggleEmpty = (column) => setFilter((now) => ({
    ...now,
    dropEmptyIn: now.dropEmptyIn.includes(column) ? now.dropEmptyIn.filter((entry) => entry !== column) : [...now.dropEmptyIn, column],
  }));

  // The Service's count of what the filter keeps (on demand; B-28).
  const runPreview = async () => {
    if (!onPreview || !payload || problems.length) return;
    const key = payloadKey;
    setPreview({ key, state: 'busy', result: null });
    const result = await Promise.resolve(onPreview(payload)).catch((error) => ({ available: false, message: error?.message || 'The preview failed.' }));
    setPreview((now) => (now.key === key ? { key, state: 'done', result } : now));
  };
  const previewCurrent = preview.key === payloadKey ? preview : { state: 'idle', result: null };

  const submit = (event) => {
    event.preventDefault();
    if (problems.length) return;
    onApply(active ? filter : null);
  };
  const count = (value) => (typeof value === 'number' ? value.toLocaleString('en-GB') : String(value ?? '—'));
  const TABS = [
    { id: 'columns', label: 'Columns', badge: `${keptColumns}/${columns.length}` },
    { id: 'rows', label: 'Rows', badge: filter.rows.conditions.length || '' },
    { id: 'cleanup', label: 'Clean-up', badge: cleanups || '' },
  ];
  const onTabKey = (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const at = TABS.findIndex((entry) => entry.id === tab);
    const next = TABS[(at + (event.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setTab(next.id);
    ref.current?.querySelector(`#${CSS.escape(`${idBase}-tab-${next.id}`)}`)?.focus();
  };
  const rowsText = previewCurrent.state === 'done' && previewCurrent.result?.available
    ? `${count(previewCurrent.result.keptRows)} of ${count(previewCurrent.result.totalRows ?? totalRows)}`
    : `${count(totalRows)}${rowsNarrowed ? ' (fewer after filtering)' : ''}`;

  return (
    <div className="graph_customize_backdrop source_window_df_filter_backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <form ref={ref} className="graph_customize source_window_df_filter" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>Filter dataframe</strong>
            <span>Before ingestion and analysis</span>
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" onClick={onCancel}>×</button>
        </header>

        <div className="source_window_df_filter_tabs" role="tablist" aria-label="Filter parts" onKeyDown={onTabKey}>
          {TABS.map((entry) => (
            <button
              key={entry.id}
              id={`${idBase}-tab-${entry.id}`}
              type="button"
              role="tab"
              aria-selected={tab === entry.id}
              aria-controls={`${idBase}-panel`}
              tabIndex={tab === entry.id ? 0 : -1}
              className="source_window_df_filter_tab"
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {entry.badge !== '' ? <span className="source_window_df_filter_badge">{entry.badge}</span> : null}
            </button>
          ))}
        </div>

        <div id={`${idBase}-panel`} className="source_window_df_filter_panel" role="tabpanel" aria-labelledby={`${idBase}-tab-${tab}`}>
          {tab === 'columns' ? (
            <>
              <div className="source_window_df_filter_toolbar">
                <input
                  type="search"
                  className="graph_customize_input"
                  aria-label="Find a column"
                  placeholder={`Find among ${columns.length} columns…`}
                  value={columnQuery}
                  maxLength={120}
                  onChange={(event) => setColumnQuery(event.target.value)}
                />
                <button type="button" className="graph_customize_button" onClick={keepAllShown}>Keep all</button>
                <button type="button" className="graph_customize_button" onClick={stripAllShown}>Strip all</button>
              </div>
              <ul className="source_window_df_filter_columns" aria-label="Columns to keep">
                {shownColumns.map((column) => {
                  const needed = used.includes(column);
                  const kept = !filter.dropColumns.includes(column);
                  return (
                    <li key={column}>
                      <label className={`source_window_df_filter_check${kept ? '' : ' is-stripped'}`} title={needed ? 'Used by the chosen action' : column}>
                        <input type="checkbox" checked={kept} disabled={needed && kept} onChange={() => toggleDrop(column)} />
                        <span>{column}</span>
                        {needed ? <small>In use</small> : null}
                      </label>
                    </li>
                  );
                })}
                {!shownColumns.length ? <li className="source_window_df_filter_none">No column matches.</li> : null}
              </ul>
              <small className="source_window_df_filter_note">Untick a column to strip it: it is not ingested or analysed.</small>
            </>
          ) : null}

          {tab === 'rows' ? (
            <>
              <div className="source_window_df_filter_toolbar">
                <select className="graph_customize_input" aria-label="Rows that match" value={filter.rows.action} onChange={(event) => setRows({ action: event.target.value })}>
                  <option value="remove">Remove rows that match</option>
                  <option value="keep">Keep only rows that match</option>
                </select>
                <select className="graph_customize_input" aria-label="Match" value={filter.rows.match} onChange={(event) => setRows({ match: event.target.value })}>
                  <option value="all">all conditions</option>
                  <option value="any">any condition</option>
                </select>
                <button type="button" className="graph_customize_button" disabled={filter.rows.conditions.length >= FILTER_LIMITS.conditions || !columns.length} onClick={addCondition}>
                  Add condition
                </button>
              </div>
              {filter.rows.conditions.length ? (
                <ol className="source_window_df_filter_conditions" aria-label="Row conditions">
                  {filter.rows.conditions.map((condition, index) => {
                    const operator = operatorById(condition.operator);
                    const n = index + 1;
                    return (
                      <li key={index} className={`source_window_df_filter_condition${operator.needs === 'two' ? ' is-two' : ''}`}>
                        <span className="source_window_df_filter_join" aria-hidden="true">{index === 0 ? 'Where' : filter.rows.match === 'any' ? 'or' : 'and'}</span>
                        <select className="graph_customize_input" aria-label={`Condition ${n} column`} value={condition.column} onChange={(event) => setCondition(index, { column: event.target.value })}>
                          <option value="">Column…</option>
                          {columns.map((column) => <option key={column} value={column} disabled={filter.dropColumns.includes(column)}>{column}</option>)}
                        </select>
                        <select className="graph_customize_input" aria-label={`Condition ${n} operator`} value={condition.operator} onChange={(event) => setCondition(index, { operator: event.target.value })}>
                          {FILTER_OPERATORS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                        </select>
                        {operator.needs === 'none' ? <span /> : (
                          <input
                            className="graph_customize_input"
                            aria-label={`Condition ${n} value`}
                            placeholder={operator.needs === 'list' ? 'a, b, "1,000"' : operator.ordered ? 'number or YYYY-MM-DD' : 'value'}
                            value={condition.value}
                            maxLength={operator.needs === 'list' ? FILTER_LIMITS.list : FILTER_LIMITS.value}
                            // A column pasted from a sheet: one value a line (an
                            // input would join the lines into one value).
                            onPaste={operator.needs === 'list' ? (event) => {
                              const pasted = event.clipboardData?.getData('text') || '';
                              if (!/[\r\n\t;]/.test(pasted)) return;
                              event.preventDefault();
                              const values = pasted.split(/[\r\n\t;]+/).map((entry) => entry.trim()).filter(Boolean).map((entry) => (entry.includes(',') ? `"${entry}"` : entry));
                              const { value, selectionStart, selectionEnd } = event.target;
                              // Never run into the value before or after; too many are
                              // refused below, not cut.
                              const before = value.slice(0, selectionStart).trimEnd();
                              const after = value.slice(selectionEnd).trimStart();
                              const text = `${before}${before && !before.endsWith(',') ? ', ' : before ? ' ' : ''}${values.join(', ')}${after && !after.startsWith(',') ? ', ' : ''}${after}`;
                              setCondition(index, { value: text });
                            } : undefined}
                            onChange={(event) => setCondition(index, { value: event.target.value })}
                          />
                        )}
                        {operator.needs === 'two' ? (
                          <input
                            className="graph_customize_input"
                            aria-label={`Condition ${n} second value`}
                            placeholder="and"
                            value={condition.value2}
                            maxLength={FILTER_LIMITS.value}
                            onChange={(event) => setCondition(index, { value2: event.target.value })}
                          />
                        ) : null}
                        <button type="button" className="source_window_df_filter_remove" aria-label={`Remove condition ${n}`} title="Remove" onClick={() => removeCondition(index)}>×</button>
                      </li>
                    );
                  })}
                </ol>
              ) : <p className="source_window_df_filter_none">No condition: every row is kept. Add one to remove or keep rows by their values.</p>}
              <small className="source_window_df_filter_note">Text compares without regard to case; &gt; ≥ &lt; ≤ and between take numbers or dates (YYYY-MM-DD). A list takes up to {FILTER_LIMITS.values} values, separated by commas; put a value holding a comma in quotes.</small>
            </>
          ) : null}

          {tab === 'cleanup' ? (
            <>
              <div className="source_window_df_filter_options">
                <label className="source_window_df_filter_check">
                  <input type="checkbox" checked={filter.trimWhitespace} onChange={(event) => setFilter((now) => ({ ...now, trimWhitespace: event.target.checked }))} />
                  <span>Trim spaces around values</span>
                </label>
                <label className="source_window_df_filter_check">
                  <input type="checkbox" checked={filter.dropDuplicates} onChange={(event) => setFilter((now) => ({ ...now, dropDuplicates: event.target.checked }))} />
                  <span>Remove duplicate rows</span>
                </label>
              </div>
              <strong className="source_window_df_filter_subhead">Remove rows with an empty value in</strong>
              <ul className="source_window_df_filter_columns" aria-label="Remove rows with an empty value in">
                {columns.filter((column) => !filter.dropColumns.includes(column)).map((column) => (
                  <li key={column}>
                    <label className="source_window_df_filter_check" title={column}>
                      <input type="checkbox" checked={filter.dropEmptyIn.includes(column)} onChange={() => toggleEmpty(column)} />
                      <span>{column}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        {/* What is ingested: the counts and the filter in plain words. */}
        <section className="source_window_df_filter_summary" aria-label="Filter summary">
          <div className="source_window_df_filter_counts">
            <span><b>{count(keptColumns)}</b> of {count(columns.length)} columns</span>
            <span>Rows <b>{rowsText}</b></span>
            {onPreview ? (
              <button type="button" className="graph_customize_button" disabled={!payload || problems.length > 0 || previewCurrent.state === 'busy'} onClick={runPreview}>
                {previewCurrent.state === 'busy' ? 'Counting…' : 'Count rows'}
              </button>
            ) : null}
          </div>
          {lines.length
            ? <ul className="source_window_df_filter_lines">{lines.map((line) => <li key={line}>{line}</li>)}</ul>
            : <p className="source_window_df_filter_none">Nothing is filtered: the whole dataframe is ingested.</p>}
          {previewCurrent.state === 'done' && !previewCurrent.result?.available
            ? <small className="source_window_df_filter_note" role="status">{previewCurrent.result?.message}</small>
            : null}
        </section>

        <footer className="graph_customize_footer">
          <span className="graph_customize_hint" role={problems.length ? 'alert' : undefined}>
            {problems.length ? problems[0] : 'Applied by the Service when the stream starts; the source data itself is not changed.'}
          </span>
          <button type="button" className="graph_customize_button" disabled={!active} onClick={() => setFilter(normalizeFilter(null))}>Clear all</button>
          <button type="button" className="graph_customize_button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="graph_customize_button is-primary" disabled={problems.length > 0}>Apply filter</button>
        </footer>
      </form>
    </div>
  );
}
