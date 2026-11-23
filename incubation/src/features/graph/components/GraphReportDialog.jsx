import React, { useEffect, useId, useRef, useState } from 'react';

import {
  DEFAULT_MARKING, DEFAULT_REPORT_RANGE, REPORT_LIMITS, REPORT_RANGE_FIELDS, REPORT_RANGE_PRESETS, reportKindOf, reportRangeOf,
} from '../report/graphReportModel.js';
import { defaultReportTemplate } from '../report/reportTemplates.js';
import { ORDER_BY_DEGREE, SNAPSHOT_LAYOUTS, SNAPSHOT_MAX_NODES } from '../lib/offscreenSnapshot.js';

// Export ▸ Generate report (G4.2; analyst decision 2026-11-17): the cover
// fields (case, reference, date and time, analyst, the system flagged rule
// and the graph alert) and the analyst's own parts (key findings,
// assessment, follow-up actions), then the PDF. Prefilled from the graph;
// Key findings starts from a factual draft the analyst edits. Escape,
// Cancel or a click outside closes it.
//
// Styled as the Customize popup (analyst decision 2026-11-17): the same
// card, header, flat sections and footer; the template's preview on the
// right, where Customize shows its preview.
//
// initial: { title, caseId, reference, dateTime, analyst, systemRule, graphAlert, purpose,
//   nameKey, findings, assessment, actions, marking };
// nameKeys: node properties to identify entities by ('' = label);
// draftFor(nameKey) -> the findings draft naming entities that way (it
// follows the choice until the analyst edits it); onGenerate(values) ->
// Promise (busy until it settles).
// snapshotDefaults: { order, direction, orientation, amount } shows the
// Graph options (what the snapshot draws; reports from the evidence table,
// whose graph is drawn without a window; analyst decision 2026-11-18); the
// choice comes back as values.snapshot.
// kind: 'graph' | 'evidence' names the report (REPORT_KINDS).
// companions: { charts, tables } the titles of this graph's linked Chart
// and Table windows. The report takes all of them; with none, the
// automatic charts and the default tables (analyst decision 2026-11-19).
// A Graph report only: the evidence report always takes the automatic
// charts and the default tables (it is the original record).
// rangeCounts: { subjects, profiles, strongest } how many the report has
// in all (the Range shows "of m"), or null. The Range comes back as
// values.range ({ preset, subjects, profiles, strongest, rows }; null: all).
export default function GraphReportDialog({ initial, nameKeys = [], draftFor, onGenerate, onCancel, snapshotDefaults = null, kind = 'graph', companions = { charts: [], tables: [] }, rangeCounts = null }) {
  const template = defaultReportTemplate();
  const reportKind = reportKindOf(kind);
  const linkedCharts = kind === 'graph' ? companions?.charts || [] : [];
  const linkedTables = kind === 'graph' ? companions?.tables || [] : [];
  const [values, setValues] = useState(() => {
    // Range: the Brief preset to start with (analyst decision 2026-11-19).
    const start = { ...initial, range: initial.range || reportRangeOf(DEFAULT_REPORT_RANGE) };
    return snapshotDefaults ? { ...start, snapshot: { ...snapshotDefaults } } : start;
  });
  // A preset fills the four limits; changing one makes the range Custom.
  const pickPreset = (preset) => setValues((current) => ({ ...current, range: preset === 'custom' ? { ...current.range, preset } : reportRangeOf(preset) }));
  const setLimit = (id, text) => setValues((current) => {
    const n = Math.floor(Number(text));
    return { ...current, range: { ...current.range, preset: 'custom', [id]: text === '' || !Number.isFinite(n) || n < 1 ? null : n } };
  });
  const setSnapshot = (name, value) => setValues((current) => ({ ...current, snapshot: { ...current.snapshot, [name]: value } }));
  const draftRef = useRef(initial.findings);
  const pickNameKey = (nameKey) => setValues((current) => {
    if (!draftFor || current.findings !== draftRef.current) return { ...current, nameKey };
    draftRef.current = draftFor(nameKey);
    return { ...current, nameKey, findings: draftRef.current };
  });
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const idBase = useId();
  const titleId = `${idBase}-title`;
  const set = (name, value) => setValues((current) => ({ ...current, [name]: value }));
  useEffect(() => {
    ref.current?.querySelector('input:not([readonly])')?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape' && !busy) onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onGenerate(values);
    } finally {
      setBusy(false);
    }
  };
  const hintId = (name) => `${idBase}-${name}`;
  const hint = (name, text) => (text ? <small id={hintId(name)} className="graph_customize_hint graph_report_hint">{text}</small> : null);
  // A one-line field: label beside the input, as Customize's fields.
  const field = (name, label, { max = REPORT_LIMITS.line, placeholder = '', readOnly = false, note = '' } = {}) => (
    <div className="graph_report_row">
      <label className="graph_customize_field">
        <span className="graph_customize_field_label">{label}</span>
        <input
          type="text"
          className="graph_customize_input"
          value={values[name] ?? ''}
          maxLength={max}
          placeholder={placeholder}
          readOnly={readOnly}
          aria-describedby={note ? hintId(name) : undefined}
          onChange={(event) => set(name, event.target.value)}
        />
      </label>
      {hint(name, note)}
    </div>
  );
  // A text area: label above, full width.
  const area = (name, label, note, rows = 4) => (
    <div className="graph_report_row">
      <label className="graph_report_area">
        <span className="graph_customize_field_label">{label}</span>
        <textarea
          className="graph_customize_input"
          rows={rows}
          value={values[name]}
          maxLength={REPORT_LIMITS.text}
          aria-describedby={note ? hintId(name) : undefined}
          onChange={(event) => set(name, event.target.value)}
        />
      </label>
      {hint(name, note)}
    </div>
  );
  const snapshot = values.snapshot || {};
  // A Graph option (a select, label beside it).
  const snapshotSelect = (name, label, options, { onChange = null, disabled = false, note = '' } = {}) => (
    <div className="graph_report_row" key={name}>
      <label className="graph_customize_field">
        <span className="graph_customize_field_label">{label}</span>
        <select
          className="graph_customize_input"
          value={snapshot[name] ?? ''}
          disabled={disabled}
          aria-describedby={note ? hintId(`snapshot-${name}`) : undefined}
          onChange={(event) => (onChange ? onChange(event.target.value) : setSnapshot(name, event.target.value))}
        >
          {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
        </select>
      </label>
      {hint(`snapshot-${name}`, note)}
    </div>
  );
  const section = (title, children) => (
    <fieldset className="graph_customize_section graph_report_section" disabled={busy}>
      <legend className="graph_customize_section_head">{title}</legend>
      {children}
    </fieldset>
  );

  return (
    <div className="graph_customize_backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form ref={ref} className="graph_customize is-report" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>Generate {reportKind.name.toLowerCase()}</strong>
            <span>{template.name}</span>
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" disabled={busy} onClick={onCancel}>×</button>
        </header>
        <div className="graph_customize_body">
          <div className="graph_customize_options">
            {section('Cover', (
              <>
                {field('caseId', 'Case ID', { max: 80, placeholder: 'e.g. CASE-2026-014' })}
                {field('reference', 'Analysis Reference ID', { max: 80, placeholder: 'e.g. 001' })}
                {field('dateTime', 'Date & Time of Report', { readOnly: true })}
                {field('analyst', 'Analyst / Investigator Details', { max: 160 })}
                {field('systemRule', 'System Flagged Rule', { max: 300, placeholder: 'e.g. FUND_FLOW, SMURFING', note: 'The link analysis rule that flagged this evidence when it was ingested.' })}
                {field('graphAlert', 'Graph Alert', { max: 300, note: "This window's graph alert configuration." })}
                {field('title', 'Report title', { max: 160 })}
                {field('purpose', 'Purpose', { max: 400, placeholder: 'One sentence' })}
              </>
            ))}
            {section('Entities', (
              <div className="graph_report_row">
                <label className="graph_customize_field">
                  <span className="graph_customize_field_label">Identify entities by</span>
                  <select className="graph_customize_input" value={values.nameKey} aria-describedby={hintId('nameKey')} onChange={(event) => pickNameKey(event.target.value)}>
                    <option value="">Label (else the node ID)</option>
                    {nameKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                  </select>
                </label>
                {hint('nameKey', 'The column that names each entity in the report (e.g. a full name or account number). Entities without a value fall back to their label.')}
              </div>
            ))}
            {snapshotDefaults ? section('Graph', (
              <>
                <div className="graph_report_row">
                  <label className="graph_customize_field">
                    <span className="graph_customize_field_label">Order by</span>
                    <select className="graph_customize_input" value={values.snapshot.order} aria-describedby={hintId('snapshotOrder')} onChange={(event) => setSnapshot('order', event.target.value)}>
                      <option value={ORDER_BY_DEGREE}>Most connected</option>
                      <option value="">Arrival order</option>
                      {nameKeys.map((key) => <option key={key} value={key}>{key}</option>)}
                    </select>
                  </label>
                  {hint('snapshotOrder', values.snapshot.order && values.snapshot.order !== ORDER_BY_DEGREE ? `Entities without “${values.snapshot.order}” are left out of the picture.` : 'Which entities the graph picture shows first.')}
                </div>
                {values.snapshot.order ? (
                  <div className="graph_report_row">
                    <label className="graph_customize_field">
                      <span className="graph_customize_field_label">Direction</span>
                      <select className="graph_customize_input" value={values.snapshot.direction} onChange={(event) => setSnapshot('direction', event.target.value)}>
                        <option value="desc">Descending</option>
                        <option value="asc">Ascending</option>
                      </select>
                    </label>
                  </div>
                ) : null}
                {snapshotSelect('layout', 'Orientation', SNAPSHOT_LAYOUTS.map((entry) => [entry.id, entry.label]), {
                  onChange: (layout) => setValues((current) => ({
                    ...current,
                    snapshot: {
                      ...current.snapshot,
                      layout,
                      // As the Graph window: choosing hierarchical resets flow and level order.
                      ...(layout === 'hierarchical' ? { flow: 'UD', sortMethod: 'directed' } : {}),
                      ...(layout === 'grouped' && current.snapshot.layerMode === 'hop_distance' ? { layerMode: 'node_identity' } : {}),
                    },
                  })),
                })}
                {snapshot.layout === 'hierarchical' || snapshot.layout === 'layered'
                  ? snapshotSelect('flow', 'Flow', [['UD', 'Top to bottom'], ['LR', 'Left to right']])
                  : null}
                {snapshot.layout === 'hierarchical'
                  ? snapshotSelect('sortMethod', 'Order levels by', [['directed', 'Edge direction'], ['hubsize', 'Hub size']], { note: 'Hierarchical needs fewer than 300 entities; layered is used above.' })
                  : null}
                {snapshot.layout === 'layered' || snapshot.layout === 'grouped' ? (
                  <>
                    {snapshot.layout === 'layered'
                      ? snapshotSelect('layerMode', 'Layers by', [['hop_distance', 'Distance from the source'], ['node_identity', 'Node type'], ['by_key', 'A property']])
                      : snapshotSelect('layerMode', 'Group by', [['node_identity', 'Node type'], ['by_key', 'A property']])}
                    {snapshotSelect('layerKey', snapshot.layout === 'layered' ? 'Layer property' : 'Group property', [['', 'Choose a property'], ...nameKeys.map((key) => [key, key])], {
                      disabled: snapshot.layerMode !== 'by_key',
                    })}
                  </>
                ) : null}
                <div className="graph_report_row">
                  <label className="graph_customize_field">
                    <span className="graph_customize_field_label">Amount</span>
                    <input
                      type="number"
                      className="graph_customize_input"
                      min={1}
                      max={SNAPSHOT_MAX_NODES}
                      step={1}
                      value={values.snapshot.amount}
                      aria-describedby={hintId('snapshotAmount')}
                      onChange={(event) => setSnapshot('amount', event.target.value)}
                    />
                  </label>
                  {hint('snapshotAmount', `Entities in the picture (1 to ${SNAPSHOT_MAX_NODES.toLocaleString('en-GB')}), with the links among them, each named as chosen under Identify entities by. More entities make a larger PDF file and take longer to draw.`)}
                </div>
              </>
            )) : null}
            {section('Analyst', (
              <>
                {area('findings', 'Key findings', 'One per line. Drafted from the graph; edit to your judgement.', 5)}
                {area('assessment', 'Assessment', 'What the evidence means. Left empty, the report marks it "To be completed by the analyst".', 4)}
                {area('actions', 'Follow-up actions', 'One per line: action | owner | status (owner and status optional).', 3)}
                {field('marking', 'Distribution marking', { max: 120, placeholder: DEFAULT_MARKING })}
              </>
            ))}
            {section('Charts and tables', (
              <dl className="graph_report_sources">
                <dt>Measures (charts)</dt>
                <dd>
                  {linkedCharts.length
                    ? `The charts of ${linkedCharts.join(', ')}, with their colours and scope.`
                    : `The automatic set: global figures, degree, betweenness, flow, distributions, communities and the heat matrix${kind === 'graph' ? ' (no Chart window is linked to this graph)' : ''}.`}
                </dd>
                <dt>Tables (Appendix B on)</dt>
                <dd>
                  {linkedTables.length
                    ? `The tables of ${linkedTables.join(', ')}: their rows, filter, columns and sort.`
                    : `The default tables: every entity and every relationship, flagged ones first${kind === 'graph' ? ' (no Table window is linked to this graph)' : ''}.`}
                </dd>
              </dl>
            ))}
            {section('Range', (
              <>
                <div className="graph_report_row">
                  <label className="graph_customize_field">
                    <span className="graph_customize_field_label">Preset</span>
                    <select className="graph_customize_input" value={values.range.preset} aria-describedby={hintId('rangePreset')} onChange={(event) => pickPreset(event.target.value)}>
                      {Object.entries(REPORT_RANGE_PRESETS).map(([id, preset]) => <option key={id} value={id}>{preset.label}</option>)}
                      <option value="custom">Custom</option>
                    </select>
                  </label>
                  {hint('rangePreset', values.range.preset === 'custom'
                    ? 'Your own limits (change the preset to start again from it).'
                    : `${REPORT_RANGE_PRESETS[values.range.preset]?.hint || ''}. Change a limit below to make it your own.`)}
                </div>
                {REPORT_RANGE_FIELDS.map(({ id, label }) => {
                  const all = rangeCounts?.[id];
                  return (
                    <div className="graph_report_row" key={id}>
                      <label className="graph_customize_field">
                        <span className="graph_customize_field_label">{label}</span>
                        <input
                          className="graph_customize_input graph_report_limit"
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          placeholder="All"
                          value={values.range[id] ?? ''}
                          aria-describedby={hintId(`range-${id}`)}
                          onChange={(event) => setLimit(id, event.target.value)}
                        />
                      </label>
                      {hint(`range-${id}`, id === 'rows'
                        ? (values.range.rows == null ? 'Every row of each table (at most 2,000).' : `Up to ${values.range.rows.toLocaleString('en-GB')} rows in each table, in its order.`)
                        : all == null
                          ? (values.range[id] == null ? 'All.' : `Up to ${values.range[id].toLocaleString('en-GB')}.`)
                          : `${Math.min(values.range[id] ?? all, all).toLocaleString('en-GB')} of ${all.toLocaleString('en-GB')}.`)}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
          <figure className="graph_customize_preview graph_report_preview">
            <img className="graph_report_thumbnail" src={template.thumbnail} alt={`${template.name} template preview`} />
            <figcaption className="graph_customize_caption">
              {template.name}
              <br />
              {template.builtIn ? 'Built-in' : 'Uploaded'} · version {template.version}
              <br />
              {kind === 'evidence' ? 'Evidence Report: the evidence as the Service analysed it.' : 'Graph Report: this window\u2019s graph, with any analyst changes.'}
            </figcaption>
            <ul className="graph_report_contents" aria-label="Sections in the report">
              {template.sections.map((name) => <li key={name}>{name}</li>)}
            </ul>
            {/* The range at a glance: how much of each part the report takes. */}
            <p className="graph_customize_caption graph_report_range_summary" aria-label="Report range">
              {(REPORT_RANGE_PRESETS[values.range.preset]?.label || 'Custom')}:{' '}
              {REPORT_RANGE_FIELDS.map(({ id, label }) => {
                const all = rangeCounts?.[id];
                const limit = values.range[id];
                const text = all != null ? `${Math.min(limit ?? all, all).toLocaleString('en-GB')} of ${all.toLocaleString('en-GB')}` : limit == null ? 'all' : `up to ${limit.toLocaleString('en-GB')}`;
                return `${label} ${text}`;
              }).join(' · ')}
            </p>
          </figure>
        </div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">{busy ? 'Drawing the PDF…' : 'Sections with nothing to show are left out.'}</span>
          <button type="button" className="graph_customize_button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="graph_customize_button is-primary" disabled={busy}>{busy ? 'Generating…' : 'Generate PDF'}</button>
        </footer>
      </form>
    </div>
  );
}
