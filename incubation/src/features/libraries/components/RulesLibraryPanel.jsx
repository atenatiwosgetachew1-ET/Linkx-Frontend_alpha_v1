import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { Field } from '../../../shared/components/form/FormFields.jsx';
import { Block, Masthead, PageHero, Pill, SettingsPage, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { sanitizeText } from '../../../utils/inputSecurity.js';
import {
  describeRules,
  getKnownBuiltinRules,
  subscribeKnownBuiltinRules,
} from '../lib/rulesLibrary.js';

const EMPTY_UPLOAD = { file: null, name: '', inputKey: 0 };

// Glyphs for the field labels (24px grid, stroked).
const ICONS = {
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
  name: 'M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35',
};

const hero = ({ title, tone, pill }) => (
  <PageHero
    tone={tone}
    eyebrow="Rules library"
    title={title}
    pill={pill}
    meta="The rule sets loaded for this session. The active one is chosen in Configuration → Rules."
    media={(
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5M9 7h7M9 11h5" />
      </svg>
    )}
  />
);

// The rule sets loaded for this session (production Configuration > rules,
// moved here). Choosing the *active* rule stays in Configuration.
export default function RulesLibraryPanel({ configuration, canRead, canWrite, busy, onUpload, onRemove, onOpenConfiguration, onTemplate }) {
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

  if (!canRead) {
    return (
      <SettingsPage className="config_page libraries_page">
        <Masthead>{hero({ title: 'Rule sets', tone: 'locked', pill: <Pill tone="neutral">Requires config:read</Pill> })}</Masthead>
        <p className="settings_hint">You need config:read to view the rules library.</p>
      </SettingsPage>
    );
  }

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
    <SettingsPage className="config_page libraries_page libraries_rules">
      <Masthead>
        {hero({ title: 'Rule sets', tone: active ? 'active' : 'inactive', pill: canWrite ? null : <Pill tone="neutral">Read-only</Pill> })}
        <Stats label="Rule figures" columns={4}>
          <Stat lead icon="list" label="Loaded" value={rules.length.toLocaleString()} note="rule sets" />
          <Stat icon="lock" label="Built-in" value={(rules.length - customCount).toLocaleString()} note="kept by the Service" />
          <Stat icon="layers" label="Custom" value={customCount.toLocaleString()} note="uploaded" />
          <Stat text icon="check" label="Active rule" value={active ? active.name : '—'} empty={!active} note={active ? 'in use' : 'none chosen'} />
        </Stats>
      </Masthead>

      <Block
        title="Rule sets"
        description="Every rule set this session can apply."
        actions={(
          <button type="button" className="settings_button" onClick={onOpenConfiguration} title="Choose the active rule in Configuration → Rules">
            Choose active rule
          </button>
        )}
      >
        <label className="libraries_search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS.search} /></svg>
          <input
            type="search"
            className="settings_input libraries_rules_filter"
            placeholder="Filter rules"
            aria-label="Filter rules"
            value={filter}
            onChange={(event) => setFilter(sanitizeText(event.target.value, { maxLength: 120 }))}
          />
        </label>
        <div className="config_window_table_wrap">
          <table className="config_window_table libraries_rules_table" aria-label="Rule sets">
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
                  <td>{rule.active ? <span className="libraries_badge is-active">Active</span> : <span className="libraries_rule_available">Available</span>}</td>
                  <td className="config_window_table_actions">
                    <button
                      type="button"
                      className={`settings_button is-danger libraries_remove${armed === rule.name ? ' is-armed' : ''}`}
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
      </Block>

      <Block
        title="Upload a rule"
        description="A JSON rule file. It becomes available to every Source window of this session."
        actions={<button type="button" className="settings_button settings_primary" disabled={!canWrite || !upload.file || Boolean(busy)} onClick={handleUpload}>Upload rule</button>}
      >
        {!canWrite ? <p className="settings_hint config_window_readonly_hint">You need config:write to upload or remove rules.</p> : null}
        <div className="config_card">
          <div className="config_card_grid">
            <Field icon={ICONS.file} label="Rule file (JSON)">
              <input
                key={upload.inputKey}
                type="file"
                accept=".json,application/json"
                className="settings_input config_window_file"
                disabled={!canWrite}
                onChange={(event) => setUpload((current) => ({ ...current, file: event.target.files?.[0] || null }))}
              />
            </Field>
            <Field icon={ICONS.name} label="Rule name">
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
          <button type="button" className="libraries_link settings_link_button" onClick={onTemplate}>Get the latest rule template</button>
        </div>
      </Block>
    </SettingsPage>
  );
}
