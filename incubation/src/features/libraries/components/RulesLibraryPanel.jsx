import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { Field, Section } from '../../../shared/components/form/FormFields.jsx';
import { sanitizeText } from '../../../utils/inputSecurity.js';
import {
  RULE_TEMPLATE_PATH,
  describeRules,
  getKnownBuiltinRules,
  subscribeKnownBuiltinRules,
} from '../lib/rulesLibrary.js';

const EMPTY_UPLOAD = { file: null, name: '', inputKey: 0 };

// The rule sets loaded for this session (production Configuration > rules,
// moved here). Choosing the *active* rule stays in Configuration.
export default function RulesLibraryPanel({ configuration, canRead, canWrite, busy, onUpload, onRemove, onOpenConfiguration }) {
  const known = useSyncExternalStore(subscribeKnownBuiltinRules, getKnownBuiltinRules);
  const rules = useMemo(() => describeRules(configuration, known), [configuration, known]);
  const [filter, setFilter] = useState('');
  const [armed, setArmed] = useState('');
  const [upload, setUpload] = useState(EMPTY_UPLOAD);

  // A remove confirmation expires (production: 6 s).
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(''), 6000);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!canRead) return <p className="settings_hint">You need config:read to view the rules library.</p>;

  const query = filter.trim().toLowerCase();
  const visible = query ? rules.filter((rule) => rule.name.toLowerCase().includes(query)) : rules;
  const active = rules.find((rule) => rule.active);
  const customCount = rules.filter((rule) => !rule.builtin).length;

  const handleRemove = (name) => {
    if (armed !== name) {
      setArmed(name);
      return;
    }
    setArmed('');
    onRemove(name);
  };

  const handleUpload = async () => {
    if (!upload.file) return;
    const ok = await onUpload({ file: upload.file, ruleName: upload.name });
    if (ok) setUpload((current) => ({ ...EMPTY_UPLOAD, inputKey: current.inputKey + 1 }));
  };

  return (
    <>
      <Section
        title="Rule sets"
        description={`${rules.length} loaded · ${rules.length - customCount} built-in · ${customCount} custom${active ? ` · Active: ${active.name}` : ''}`}
        actions={(
          <button type="button" className="settings_button" onClick={onOpenConfiguration} title="Choose the active rule in Configuration → Rules">
            Choose active rule
          </button>
        )}
      >
        <input
          type="search"
          className="settings_input libraries_rules_filter"
          placeholder="Filter rules"
          aria-label="Filter rules"
          value={filter}
          onChange={(event) => setFilter(sanitizeText(event.target.value, { maxLength: 120 }))}
        />
        <div className="config_window_table_wrap">
          <table className="config_window_table libraries_rules_table">
            <thead>
              <tr><th scope="col">Rule</th><th scope="col">Type</th><th scope="col">Status</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr><td colSpan={4} className="config_window_table_empty">{rules.length ? 'No rule matches the filter.' : 'No rules loaded for this session.'}</td></tr>
              ) : visible.map((rule) => (
                <tr key={rule.name}>
                  <td><strong>{rule.name}</strong></td>
                  <td><span className={`libraries_badge ${rule.builtin ? 'is-builtin' : 'is-custom'}`}>{rule.builtin ? 'Built-in' : 'Custom'}</span></td>
                  <td>{rule.active ? <span className="libraries_badge is-active">Active</span> : <span className="settings_hint">Available</span>}</td>
                  <td className="config_window_table_actions">
                    <button
                      type="button"
                      className="settings_button is-danger"
                      disabled={!canWrite || Boolean(busy)}
                      title={rule.builtin ? 'Built-in rules are kept by the Service; removal will be refused.' : `Remove ${rule.name}`}
                      onClick={() => handleRemove(rule.name)}
                    >
                      {armed === rule.name ? 'Confirm remove' : 'Remove'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {armed ? <p className="settings_hint" role="status">Click “Confirm remove” to permanently remove “{armed}”.</p> : null}
      </Section>

      <Section title="Upload a rule" description="JSON rule file. It becomes available to every Source window of this session.">
        {!canWrite ? <p className="settings_hint">You need config:write to upload or remove rules.</p> : null}
        <div className="config_window_grid">
          <Field label="Rule file (JSON)">
            <input
              key={upload.inputKey}
              type="file"
              accept=".json,application/json"
              className="settings_input config_window_file"
              disabled={!canWrite}
              onChange={(event) => setUpload((current) => ({ ...current, file: event.target.files?.[0] || null }))}
            />
          </Field>
          <Field label="Rule name">
            <input
              className="settings_input"
              value={upload.name}
              placeholder="Rule name"
              maxLength={120}
              disabled={!canWrite}
              onChange={(event) => setUpload((current) => ({ ...current, name: sanitizeText(event.target.value, { maxLength: 120 }) }))}
            />
          </Field>
        </div>
        <div className="config_window_inline_actions">
          <button type="button" className="settings_button is-primary" disabled={!canWrite || !upload.file || Boolean(busy)} onClick={handleUpload}>Upload rule</button>
          <a className="settings_link" href={`${import.meta.env.BASE_URL}${RULE_TEMPLATE_PATH}`} download>Get the latest rule template</a>
        </div>
      </Section>
    </>
  );
}
