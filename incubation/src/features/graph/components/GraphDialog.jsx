import React, { useEffect, useRef, useState } from 'react';

// A small form over the canvas, styled like the right-click menu. Replaces
// production's browser prompts (requestUserInput / requestUserCheckboxChoices)
// for the analysis tools.
//
// dialog: { title, description?, okText?, fields: [
//   { name, label, type: 'select', options: [{ value, label }], value }
//   { name, label, type: 'number', min, max, step?, value }
//   { name, label, type: 'text', value }
//   { name, label, type: 'checkbox', value }
//   { name, label, type: 'checkboxes', options: [{ value, label, description? }], value: [] }
// ] }
// onSubmit(values) / onCancel(). Enter submits, Escape cancels.
export default function GraphDialog({ dialog, onSubmit, onCancel }) {
  const ref = useRef(null);
  const fields = dialog.fields || []; // none: a confirmation
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((field) => [field.name, field.value])));
  const set = (name, value) => setValues((current) => ({ ...current, [name]: value }));

  useEffect(() => {
    ref.current?.querySelector('input, select, button')?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const submit = (event) => {
    event.preventDefault();
    onSubmit(values);
  };

  return (
    <div className="graph_dialog_backdrop">
      <form ref={ref} className="graph_dialog" role="dialog" aria-modal="true" aria-label={dialog.title} onSubmit={submit}>
        <strong className="graph_dialog_title">{dialog.title}</strong>
        {dialog.description ? <p className="graph_dialog_text">{dialog.description}</p> : null}
        {fields.map((field) => {
          if (field.type === 'checkbox') {
            return (
              <label key={field.name} className="graph_dialog_check">
                <input type="checkbox" checked={Boolean(values[field.name])} onChange={(event) => set(field.name, event.target.checked)} />
                <span>{field.label}</span>
              </label>
            );
          }
          if (field.type === 'checkboxes') {
            const selected = new Set(values[field.name] || []);
            const toggle = (value, on) => {
              const next = new Set(selected);
              if (on) next.add(value);
              else next.delete(value);
              set(field.name, field.options.map((option) => option.value).filter((option) => next.has(option)));
            };
            return (
              <fieldset key={field.name} className="graph_dialog_group">
                <legend>{field.label}</legend>
                {field.options.map((option) => (
                  <label key={option.value} className="graph_dialog_check" title={option.description || undefined}>
                    <input type="checkbox" checked={selected.has(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
            );
          }
          return (
            <label key={field.name} className="graph_dialog_field">
              <span>{field.label}</span>
              {field.type === 'select' ? (
                <select value={values[field.name]} onChange={(event) => set(field.name, event.target.value)}>
                  {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              ) : field.type === 'text' ? (
                <input type="text" value={values[field.name]} maxLength={120} onChange={(event) => set(field.name, event.target.value)} />
              ) : (
                <input
                  type="number"
                  min={field.min}
                  max={field.max}
                  step={field.step ?? 1}
                  value={values[field.name]}
                  onChange={(event) => set(field.name, event.target.value)}
                />
              )}
            </label>
          );
        })}
        <div className="graph_dialog_actions">
          <button type="button" className="graph_window_button is-compact" onClick={onCancel}>Cancel</button>
          <button type="submit" className="graph_window_button is-compact is-primary">{dialog.okText || 'OK'}</button>
        </div>
      </form>
    </div>
  );
}
