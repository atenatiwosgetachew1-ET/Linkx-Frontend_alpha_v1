import React, { useEffect, useId, useRef, useState } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { mappableFields, mappingPayload, mappingProblem, pickedOf } from '../lib/dataframeMapping.js';

// Dataframe ▸ Map columns… (B-41): a column mapping for this dataframe only.
// Only fields the data does not have can be filled; applying it makes the
// dataframe again.
//
// info: the dataframe's ({ missingFields, sourceColumns, ownMapping });
// draft: { target: source } as last picked; required: the domain's required
// fields (groups of alternatives), null while they are fetched; message: why the last one was refused;
// onApply({ source: target }); onCancel(draft).
export default function DataframeMappingDialog({ info, draft = null, required = [], domainLabel = '', message = '', onApply, onCancel }) {
  const fields = mappableFields(info);
  const [picked, setPicked] = useState(() => {
    const start = draft || pickedOf(info.ownMapping);
    return Object.fromEntries(Object.entries(start).filter(([target]) => fields.includes(target)));
  });
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => { ref.current?.querySelector('select, button')?.focus(); }, []);
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onCancel(picked); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel, picked]);

  const isRequired = (field) => (required || []).some((group) => group.some((name) => name.toUpperCase() === field.toUpperCase()));
  const ordered = [...fields].sort((a, b) => Number(isRequired(b)) - Number(isRequired(a)) || a.localeCompare(b));
  const mapping = mappingPayload(picked);
  const problem = mappingProblem(picked);
  const same = JSON.stringify(Object.entries(mapping).sort()) === JSON.stringify(Object.entries(info.ownMapping || {}).sort());
  const taken = new Set(Object.values(picked).filter(Boolean));
  const submit = (event) => {
    event.preventDefault();
    if (!problem && !same) onApply(mapping, picked);
  };

  return (
    <div className="graph_customize_backdrop source_window_df_filter_backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(picked); }}>
      <form ref={ref} className="graph_customize source_window_df_filter" role="dialog" aria-modal="true" aria-labelledby={titleId} onSubmit={submit}>
        <header className="graph_customize_header">
          <div className="graph_customize_heading">
            <strong id={titleId}>Map columns</strong>
            <span>For this dataframe only{domainLabel ? ` · ${domainLabel}` : ''}</span>
          </div>
          <button type="button" className="graph_customize_close" aria-label="Close" title="Close (Esc)" onClick={() => onCancel(picked)}>×</button>
        </header>
        <div className="source_window_df_filter_panel">
          {message ? <p className="source_window_validation" role="alert">{message}</p> : null}
          <p className="source_window_df_filter_note">Say which column of the data holds a field it does not have under its own name. Everything made from this dataframe will say so.</p>
          {required === null ? <WindowLoadScreen className="is-block" label="Loading the domain’s fields…" /> : ordered.length ? (
            <ul className="source_window_df_mapping" aria-label="Fields the data does not have">
              {ordered.map((field) => (
                <li key={field}>
                  <span><strong>{field}</strong>{isRequired(field) ? <small>required</small> : null}</span>
                  <select className="graph_customize_input" aria-label={`Column for ${field}`} value={picked[field] || ''} onChange={(event) => setPicked((now) => ({ ...now, [field]: event.target.value }))}>
                    <option value="">Not mapped</option>
                    {info.sourceColumns.map((column) => <option key={column} value={column} disabled={taken.has(column) && picked[field] !== column}>{column}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          ) : <p className="source_window_df_filter_none">The data has every field the domain’s rules read.</p>}
          {problem ? <p className="source_window_validation" role="alert">{problem}</p> : null}
        </div>
        <footer className="graph_customize_footer">
          <span className="graph_customize_hint">The dataframe is made again{Object.keys(mapping).length ? ` with ${Object.keys(mapping).length} mapped` : ', without a mapping'}; its filter is cleared.</span>
          <button type="button" className="graph_customize_button" onClick={() => onCancel(picked)}>Cancel</button>
          <button type="submit" className="graph_customize_button is-primary" disabled={Boolean(problem) || same}>Make it again</button>
        </footer>
      </form>
    </div>
  );
}
