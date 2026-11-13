import React, { useEffect, useRef, useState } from 'react';

// Text input with its own draft value that commits on blur / Enter, so typing
// never round-trips through the whole configuration draft (production's
// ConfigTextInput).
export const DraftInput = React.memo(function DraftInput({ name, value, onCommit, className = 'settings_input', ...rest }) {
  const [draft, setDraft] = useState(value ?? '');
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(value ?? '');
  }, [value]);
  const commit = (event) => onCommit?.(name, event.target.value);
  return (
    <input
      {...rest}
      name={name}
      className={className}
      value={draft}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => { focusedRef.current = false; commit(event); }}
      onKeyDown={(event) => { if (event.key === 'Enter') commit(event); }}
    />
  );
});

// Comma separated list edited as text; committed as an array on blur.
export const ListTextarea = React.memo(function ListTextarea({ name, value, onCommit, placeholder, rows = 2, disabled }) {
  const toText = (list) => (Array.isArray(list) ? list.join(', ') : String(list || ''));
  const [draft, setDraft] = useState(toText(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(toText(value));
  }, [value]);
  return (
    <textarea
      name={name}
      className="settings_input config_window_textarea"
      rows={rows}
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      onFocus={() => { focusedRef.current = true; }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => { focusedRef.current = false; onCommit?.(name, event.target.value); }}
    />
  );
});

export function Field({ label, hint, wide = false, children }) {
  return (
    <label className={`config_window_field${wide ? ' is-wide' : ''}`}>
      <span className="config_window_field_label">{label}</span>
      {children}
      {hint ? <small className="config_window_field_hint">{hint}</small> : null}
    </label>
  );
}

// Known option list + a custom value. On save the custom value becomes the
// active option and joins the list (production address/topic behaviour).
export function OptionField({ label, hint, name, options, value, customName, customValue, customPlaceholder, onChange, onCommit, disabled }) {
  const list = Array.isArray(options) ? options : [];
  const hasValue = value && list.includes(value);
  return (
    <div className="config_window_field is-option">
      <span className="config_window_field_label">{label}</span>
      <div className="config_window_option_row">
        <select
          name={name}
          aria-label={label}
          className="settings_input"
          value={hasValue ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(name, event.target.value)}
        >
          <option value="" disabled>{list.length ? 'Select…' : 'No saved values'}</option>
          {list.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        {customName ? (
          <DraftInput
            name={customName}
            value={customValue || ''}
            placeholder={customPlaceholder || 'Custom value'}
            aria-label={`${label} (custom value)`}
            onCommit={onCommit}
            disabled={disabled}
          />
        ) : null}
      </div>
      {hint ? <small className="config_window_field_hint">{hint}</small> : null}
    </div>
  );
}

export function Section({ title, description, actions, children }) {
  return (
    <section className="settings_subsection config_window_section">
      <header className="config_window_section_header">
        <div>
          <h4>{title}</h4>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="config_window_section_actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}
