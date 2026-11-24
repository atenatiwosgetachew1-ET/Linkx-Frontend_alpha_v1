import React, { useEffect, useId, useRef, useState } from 'react';

import { EVIDENCE_SUMMARY_MAX, EVIDENCE_TITLE_MAX } from '../../../services/tasksApi.js';

// Save as evidence (H-6) in a popup, styled as the Graph window's Export ▸
// Generate report popup (analyst decision 2026-11-20): the same card,
// header, flat section and footer. Escape, Cancel or a click outside
// closes it.
//
// graphMissing: why the run's graph cannot be kept ('' when it can); the
// graph is then not asked for.
// overScreen: over the whole workspace (its Source window being closed).
// initial: { title, summary, includeGraph }; onSave(values, { includeGraph })
// -> Promise<{ ok, message?, offerWithoutGraph? }> (busy until it settles;
// closed by the caller on success).
export default function TaskEvidenceDialog({ initial, taskLabel, onSave, onCancel, graphMissing = '', overScreen = false }) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [offerWithoutGraph, setOfferWithoutGraph] = useState(false);
  const ref = useRef(null);
  const idBase = useId();
  const titleId = `${idBase}-title`;
  const set = (name, value) => setValues((current) => ({ ...current, [name]: value }));

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

  // Read again at the moment of saving: its Source window may have been
  // closed while this was open.
  const keepsGraph = values.includeGraph && !graphMissing;
  const save = async (includeGraph = keepsGraph) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    setOfferWithoutGraph(false);
    try {
      const result = await onSave(values, { includeGraph });
      if (result && !result.ok) {
        setMessage(result.message || 'The run could not be saved as evidence.');
        setOfferWithoutGraph(Boolean(result.offerWithoutGraph));
      }
    } finally {
      setBusy(false);
    }
  };
  const submit = (event) => {
    event.preventDefault();
    save();
  };

  return (
    <div className={`graph_customize_backdrop tasks_evidence_backdrop${overScreen ? ' is-over-screen' : ''}`} onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onCancel(); }}>
      <form ref={ref} className="graph_customize is-report tasks_evidence_dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>Save as evidence</strong>
            <span>{taskLabel}</span>
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" disabled={busy} onClick={onCancel}>×</button>
        </header>
        <div className="graph_customize_body tasks_evidence_body">
          <div className="graph_customize_options">
            <fieldset className="graph_customize_section graph_report_section" disabled={busy}>
              <legend className="graph_customize_section_head">Evidence record</legend>
              <div className="graph_report_row">
                <label className="graph_customize_field">
                  <span className="graph_customize_field_label">Title</span>
                  <input className="graph_customize_input" type="text" maxLength={EVIDENCE_TITLE_MAX} value={values.title} onChange={(event) => set('title', event.target.value)} />
                </label>
              </div>
              <div className="graph_report_row">
                <label className="graph_report_area">
                  <span className="graph_customize_field_label">Summary</span>
                  <textarea className="graph_customize_input" rows={4} maxLength={EVIDENCE_SUMMARY_MAX} value={values.summary} placeholder="What the run shows (optional)" onChange={(event) => set('summary', event.target.value)} />
                </label>
              </div>
              <div className="graph_report_row">
                <div className="graph_customize_field">
                  <span className="graph_customize_field_label">Graph</span>
                  <label className={`tasks_evidence_check${graphMissing ? ' is-disabled' : ''}`}>
                    <input type="checkbox" checked={keepsGraph} disabled={Boolean(graphMissing)} aria-describedby={`${idBase}-graph`} onChange={(event) => set('includeGraph', event.target.checked)} />
                    <span>Keep a snapshot of the graph</span>
                  </label>
                </div>
                <small id={`${idBase}-graph`} className={`graph_customize_hint graph_report_hint${graphMissing ? ' tasks_evidence_missing' : ''}`}>{graphMissing || 'Up to 5,000 relationships; it opens from Reports after the run’s session is gone.'}</small>
              </div>
            </fieldset>
            {message ? <p className="tasks_evidence_message" role="alert">{message}</p> : null}
          </div>
        </div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">{busy ? 'Saving…' : 'Reports ▸ Service evidence ▸ Analysts'}</span>
          {offerWithoutGraph ? <button type="button" className="graph_customize_button" disabled={busy} onClick={() => save(false)}>Save without the graph</button> : null}
          <button type="button" className="graph_customize_button" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="submit" className="graph_customize_button is-primary tasks_evidence_button" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </footer>
      </form>
    </div>
  );
}
