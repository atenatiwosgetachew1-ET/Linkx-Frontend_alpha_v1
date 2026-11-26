import React, { useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { InfoTip } from '../../../shared/components/form/FormFields.jsx';
import { Block, Masthead, PageHero, Pill, SettingsPage, SettingsPopup, Stat, Stats } from '../../settings/components/SettingsPage.jsx';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import {
  createDomain,
  fetchDomainProfile,
  fetchProfileHistory,
  fetchRuleSets,
  patchDomainProfile,
  setDomainActive,
  warningText,
} from '../../../services/domainProfilesApi.js';
import { loadDomainRegistry, putDomain, useDomainRegistry } from '../../../shared/domains/domainRegistry.js';
import { asOwnChange, getDomainChangeSeq, subscribeDomainChanges } from '../lib/domainChanges.js';
import { listChanges } from '../lib/domainFields.js';
import {
  DESCRIPTION_MAX,
  DISPLAY_NAME_MAX,
  NEVER_EDITABLE,
  PROFILE_FIELDS,
  REASON_MAX,
  changedFields,
  copyCandidates,
  domainIdProblem,
  fieldInputText,
  fieldLabel,
  fieldProblem,
  isListField,
  parseFieldInput,
  valueText,
} from '../lib/domainProfile.js';
import { HistoryBlock } from './DomainHistory.jsx';

// Configuration ▸ Domain profiles (round 4, B-49; PROPOSED routes): a
// superuser (`domains:manage`) creates domains on an existing rule set and
// changes a domain's profile, with history. Everything applies to new runs
// only. The admin's Domains page (thresholds, columns, …) stays as it is.

const ORIGINS = { file: ['Built in', 'From the Service’s code.'], superuser: ['Superuser', 'Changed by a superuser.'] };
// The field's origin badge, with the field's "i" inside it (its help, then
// where the value comes from). No origin: the "i" alone.
function ProfileOrigin({ origin, help }) {
  if (!origin) return help ? <InfoTip text={help} /> : null;
  const [label, title] = ORIGINS[origin] || [String(origin).slice(0, 30), 'The Service did not say more.'];
  return (
    <span className={`config_domain_origin is-${origin === 'superuser' ? 'admin' : 'profile'} has-info`}>
      {label}
      <InfoTip text={[help, title].filter(Boolean).join(' ')} />
    </span>
  );
}

const refusal = (error, fallback) => getServiceRefusalMessage(error) || error?.message || fallback;
const fieldErrors = (error) => Object.fromEntries((Array.isArray(error?.data?.invalid_fields) ? error.data.invalid_fields : [])
  .filter((field) => typeof field === 'string').map((field) => [field, 'The Service refused this value.']));

// The fields shown: those §3 names, then any other the Service sends.
const shownFields = (profile) => {
  const named = PROFILE_FIELDS.map(([key]) => key);
  const others = [...Object.keys(profile.editable), ...Object.keys(profile.fields)]
    .filter((key) => !named.includes(key) && !NEVER_EDITABLE.has(key) && key !== 'relationships');
  return [...named.filter((key) => key in profile.fields || key in profile.editable), ...new Set(others)];
};
const helpOf = Object.fromEntries(PROFILE_FIELDS.map(([key, , help]) => [key, help]));

// The profile in sections, each on its own lines; a field no section names
// goes under "Other".
const SECTIONS = [
  ['About', 'What the domain is called and which rules it runs.', ['display_name', 'description', 'rule_set']],
  ['Graph', 'How the domain’s records become nodes and links.', ['default_source_col', 'default_target_col', 'default_relationship', 'neo4j_node_label', 'date_column']],
  ['Storage', 'Where the domain’s data is kept.', ['storage_databases', 'active_storage_database', 'storage_tables', 'active_storage_tables', 'storage_path']],
];
const WIDE_FIELDS = new Set(['description']);
const sectionsOf = (keys) => {
  const named = SECTIONS.flatMap(([, , list]) => list);
  return [...SECTIONS, ['Other', 'Further fields the Service sends.', keys.filter((key) => !named.includes(key))]]
    .map(([title, text, list]) => [title, text, list.filter((key) => keys.includes(key))])
    .filter(([, , list]) => list.length);
};

function FieldInput({ name, meta, value, current, readOnly, ruleSets, onChange, invalid }) {
  const common = { className: 'settings_input', 'aria-label': fieldLabel(name), 'aria-invalid': invalid ? true : undefined, disabled: readOnly };
  const options = meta?.allowed || (name === 'rule_set' ? ruleSets.map((set) => set.name) : null);
  if (options) {
    return (
      <select {...common} value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        {options.includes(String(value ?? '')) ? null : <option value={value ?? ''}>{valueText(value)}</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    );
  }
  if (meta?.type === 'boolean') return <input {...common} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />;
  if (meta?.type === 'integer' || meta?.type === 'number') {
    return <input {...common} type="number" min={meta.min ?? undefined} max={meta.max ?? undefined} value={value ?? ''} onChange={(event) => onChange(parseFieldInput(name, meta, event.target.value, current))} />;
  }
  if (isListField(name, meta, current) || name === 'description') {
    return <textarea {...common} className="settings_input config_window_textarea" rows={name === 'description' ? 3 : 2} maxLength={name === 'description' ? DESCRIPTION_MAX : undefined} value={fieldInputText(value)} onChange={(event) => onChange(name === 'description' ? event.target.value : parseFieldInput(name, meta, event.target.value, current))} />;
  }
  return <input {...common} type="text" maxLength={meta?.maxLength ?? (name === 'display_name' ? DISPLAY_NAME_MAX : undefined)} value={value ?? ''} onChange={(event) => onChange(event.target.value)} />;
}

/* ── One domain's profile ─────────────────────────────────────────────── */

function ProfileEditor({ apiFetch, domain, ruleSets, canManage, notify, requestConfirmation }) {
  const [profile, setProfile] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [draft, setDraft] = useState({});
  const [refused, setRefused] = useState({});
  const [preview, setPreview] = useState(null);
  // The preview's popup: closing it keeps what it said for the save.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [stale, setStale] = useState(false);
  const [activePopup, setActivePopup] = useState(false);
  const changeSeq = useSyncExternalStore(subscribeDomainChanges, () => getDomainChangeSeq(domain.id, 'profile'));

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const next = await fetchDomainProfile(apiFetch, domain.id);
      if (!next) throw new Error('The Service’s answer was not a domain profile.');
      setProfile(next);
      setHistory(await fetchProfileHistory(apiFetch, domain.id).catch(() => []));
    } catch (error) {
      setLoadError(refusal(error, 'The profile could not be loaded.'));
    }
  }, [apiFetch, domain.id]);
  useEffect(() => { load(); }, [load]);
  // Someone else changed it: read again; what is typed here stays, marked.
  useEffect(() => {
    if (!changeSeq) return;
    setStale(true);
    load();
  }, [changeSeq, load]);

  const changes = useMemo(() => (profile ? Object.fromEntries(Object.entries(changedFields(draft, profile)).filter(([key]) => !profile.notEditable.includes(key))) : {}), [draft, profile]);
  const changedKeys = Object.keys(changes);
  const problems = Object.fromEntries(changedKeys.map((key) => [key, fieldProblem(key, profile.editable[key], changes[key])]).filter(([, text]) => text));
  const dirty = changedKeys.length > 0;
  const canSend = canManage && dirty && !Object.keys(problems).length && !busy;

  if (loadError) {
    return (
      <Block title="Profile" actions={<button type="button" className="settings_button" onClick={load}>Retry</button>}>
        <div className="settings_error" role="alert">{loadError} The profile is unknown, so it cannot be edited.</div>
      </Block>
    );
  }
  if (!profile) return <WindowLoadScreen className="is-block" label="Loading the domain’s profile…" />;

  const describe = () => listChanges(changedKeys.map((key) => ({ label: fieldLabel(key), from: valueText(profile.fields[key]), to: changes[key] === null ? 'the built-in value' : valueText(changes[key]) })));
  const edit = (key, value) => {
    setPreview(null);
    setRefused((list) => Object.fromEntries(Object.entries(list).filter(([name]) => name !== key)));
    setDraft((previous) => ({ ...previous, [key]: value }));
  };
  const discard = () => { setDraft({}); setRefused({}); setPreview(null); setStale(false); };

  const handlePreview = async () => {
    if (!canSend) return;
    setBusy('preview');
    try {
      const result = await patchDomainProfile(apiFetch, domain.id, changes, profile.versionId, { dryRun: true });
      if (!result.ok) {
        setProfile(result.conflict);
        setStale(true);
        notify({ title: 'Changed meanwhile', message: 'Someone saved another version of this profile. Check your changes against it.', level: 'warning', source: 'Configuration' });
        return;
      }
      setPreview({ changes: result.preview, warnings: result.warnings });
      setPreviewOpen(true);
    } catch (error) {
      setRefused(fieldErrors(error));
      notify({ title: 'No preview', message: refusal(error, 'The Service could not show what would change.'), level: 'error', source: 'Configuration' });
    } finally {
      setBusy('');
    }
  };

  const handleSave = async () => {
    if (!canSend) return;
    // A rule-set change: what the Service warns of is shown before the save
    // (its dry run says it, round 4 §4).
    let warnings = preview?.warnings || [];
    if ('rule_set' in changes && !preview && profile.versioned) {
      try {
        const dry = await patchDomainProfile(apiFetch, domain.id, changes, profile.versionId, { dryRun: true });
        if (dry.ok) warnings = dry.warnings;
      } catch {
        // The save itself says what is wrong.
      }
    }
    const warned = warnings.map(warningText).filter(Boolean);
    const confirmed = await requestConfirmation({
      title: `Change the profile of ${domain.displayName || domain.id}?`,
      icon: 'warning',
      message: `New runs in this domain use it; running runs keep what they started with. ${describe()}${warned.length ? `. Note: ${warned.join(' ')}` : ''}`,
      confirmText: 'Save new version',
    });
    if (!confirmed) return;
    setBusy('save');
    try {
      const result = await asOwnChange(domain.id, 'profile', () => patchDomainProfile(apiFetch, domain.id, changes, profile.versionId), (answer) => answer?.profile?.versionId);
      if (!result.ok) {
        setProfile(result.conflict);
        setStale(true);
        notify({ title: 'Not saved', message: `${result.conflict?.updatedBy || 'Someone'} saved another version meanwhile. Your changes are kept: check them, then save again.`, level: 'warning', source: 'Configuration' });
        return;
      }
      discard();
      if (result.profile) setProfile(result.profile);
      else await load();
      setHistory(await fetchProfileHistory(apiFetch, domain.id).catch(() => history));
      loadDomainRegistry(apiFetch);
      notify({ title: 'Profile saved', message: 'New runs in this domain use it.', level: 'success', source: 'Configuration' });
      result.warnings.forEach((warning) => notify({ title: 'Check the domain’s settings', message: warningText(warning), level: 'warning', source: 'Configuration' }));
    } catch (error) {
      setRefused(fieldErrors(error));
      notify({ title: 'Profile not saved', message: refusal(error, 'The profile could not be saved.'), level: 'error', source: 'Configuration' });
    } finally {
      setBusy('');
    }
  };

  const relationships = Array.isArray(profile.fields.relationships) ? profile.fields.relationships : (ruleSets.find((set) => set.name === profile.fields.rule_set)?.relationships || []);
  return (
    <>
      <Block
        title="Profile"
        description={canManage ? 'What the domain is: its rule set, graph shape and storage. Every change is a new version and applies to new runs only.' : 'You need domains:manage to change a domain’s profile.'}
        actions={canManage ? (
          <>
            {dirty ? <button type="button" className="settings_button is-danger" disabled={Boolean(busy)} onClick={discard}>Discard changes</button> : null}
            {profile.versioned ? <button type="button" className="settings_button" disabled={!canSend} onClick={handlePreview}>{busy === 'preview' ? 'Checking…' : 'Preview'}</button> : null}
            <button type="button" className="settings_button settings_primary" disabled={!canSend} onClick={handleSave}>{busy === 'save' ? 'Saving…' : dirty ? `Save ${changedKeys.length} changed` : 'Save'}</button>
            <span className="config_profile_actions_rule" aria-hidden="true" />
            {/* On or off asks for a reason first (the popup); the switch shows
                the domain's state as the Service has it. */}
            <label className="settings_switch config_profile_active" title={domain.active ? 'Takes new searches, dataframes and runs.' : 'Takes no new work. Its records stay readable.'}>
              <span>{domain.active ? 'Active' : 'Inactive'}</span>
              <input type="checkbox" role="switch" aria-label={domain.active ? 'Deactivate' : 'Activate'} checked={domain.active} disabled={Boolean(busy)} onChange={() => setActivePopup(true)} />
            </label>
          </>
        ) : null}
      >
        {stale && dirty ? <div className="settings_error" role="alert">Someone saved another version since you began. The values below are theirs; your changes are kept until you discard them.</div> : null}
        {domain.active ? null : <div className="config_profile_inactive" role="status">This domain takes no new work: no new searches, dataframes or runs. Its runs, evidence and reports stay readable{canManage ? '; switch it on to take work again' : ''}.</div>}
        {/* One card, a labelled group per section, as on the Domains page. */}
        <div className="config_card config_profile_card">
        {sectionsOf(shownFields(profile)).map(([title, text, keys]) => (
        <React.Fragment key={title}>
          <p className="config_card_label" title={text}>{title}</p>
          <div className="config_card_grid config_profile_grid" role="group" aria-label={title}>
          {keys.map((key) => {
            const meta = profile.editable[key];
            const editable = canManage && Boolean(meta) && !NEVER_EDITABLE.has(key) && !profile.notEditable.includes(key);
            const value = key in draft ? draft[key] : profile.fields[key];
            // A built-in domain's field a superuser changed can go back.
            const canRestore = editable && domain.origin === 'builtin' && profile.origins[key] === 'superuser' && draft[key] !== null;
            const note = problems[key] || refused[key];
            return (
              <div role="group" aria-label={fieldLabel(key)} key={key} className={`config_profile_field${key in changes ? ' is-changed' : ''}${WIDE_FIELDS.has(key) ? ' is-wide' : ''}`}>
                <span className="config_profile_field_head">
                  <strong>{fieldLabel(key)}</strong>
                  <ProfileOrigin origin={profile.origins[key]} help={helpOf[key]} />
                  {editable ? null : <small>shown only</small>}
                  {canRestore ? <button type="button" className="settings_link_button" disabled={Boolean(busy)} onClick={() => edit(key, null)}>Back to built in</button> : null}
                </span>
                {draft[key] === null && key in changes ? <span className="config_profile_value">The built-in value, once saved.</span> : editable
                  ? <FieldInput name={key} meta={meta} value={value} current={profile.fields[key]} readOnly={Boolean(busy)} ruleSets={ruleSets} invalid={Boolean(note)} onChange={(next) => edit(key, next)} />
                  : <span className="config_profile_value">{valueText(profile.fields[key])}</span>}
                {key === 'rule_set' && key in changes ? <small className="config_window_field_hint">New runs only. Thresholds and columns stay as the admin set them.</small> : null}
                {note ? <small className="config_domain_error" role="alert">{note}</small> : null}
              </div>
            );
          })}
          </div>
        </React.Fragment>
        ))}
          <p className="config_card_label" title="What the rule set produces. It changes only with another rule set.">Patterns (shown only)</p>
          {relationships.length
            ? <ul className="config_profile_patterns" aria-label="Patterns">{relationships.map((name) => <li key={name}>{name}</li>)}</ul>
            : <span className="config_profile_value">None named.</span>}
        </div>
      </Block>
      {preview && previewOpen ? (
        // What the dry run answered: a summary to check, as New domain's
        // preview; nothing saved, Save stays on the page.
        <SettingsPopup
          title="Saving would change"
          subtitle={`${domain.displayName || domain.id} · ${domain.id}`}
          hint="Nothing is saved yet."
          onClose={() => setPreviewOpen(false)}
          footer={<button type="button" className="graph_customize_button is-primary" onClick={() => setPreviewOpen(false)}>Close</button>}
        >
          <ul className="config_profile_popup config_profile_summary" role="status" aria-label="What saving would change">
            {preview.changes.length
              ? preview.changes.map(({ key, from, to }) => <li key={key}><span>{fieldLabel(key)}</span> {valueText(from)} → {valueText(to)}</li>)
              : <li>Nothing.</li>}
            {preview.warnings.map((warning) => <li key={warning.code + warning.detail} className="config_domain_error">{warningText(warning)}</li>)}
          </ul>
        </SettingsPopup>
      ) : null}
      {activePopup ? <ActivePopup apiFetch={apiFetch} domain={domain} notify={notify} onClose={() => setActivePopup(false)} /> : null}
      {canManage ? <HistoryBlock label="Profile history" description="Every saved version of the profile, newest first." items={history} heading="Changed" describe={historyText} /> : null}
    </>
  );
}

// A history entry: what was done, to which fields, and why.
const ACTIONS = { created: 'Created', changed: 'Changed', deactivated: 'Deactivated', activated: 'Activated' };
const historyText = (item) => {
  const action = ACTIONS[item.action] || '';
  const fields = item.changed && typeof item.changed === 'object' ? Object.keys(item.changed).filter((key) => key !== 'active').map(fieldLabel).join(', ') : '';
  const reason = typeof item.reason === 'string' && item.reason ? `“${item.reason.slice(0, 200)}”` : '';
  return [action, fields, reason].filter(Boolean).join(' · ') || JSON.stringify(item.changed || {});
};

/* ── Deactivate / activate, with a reason ─────────────────────────────── */

function ActivePopup({ apiFetch, domain, notify, onClose }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const turnOn = !domain.active;
  const name = domain.displayName || domain.id;
  const reasonId = useId();
  const submit = async () => {
    if (!reason.trim() || busy) return;
    setBusy(true);
    try {
      const updated = await setDomainActive(apiFetch, domain.id, turnOn, reason.trim());
      putDomain(updated || { ...domain, active: turnOn });
      loadDomainRegistry(apiFetch);
      notify({ title: turnOn ? 'Domain activated' : 'Domain deactivated', message: turnOn ? `${name} takes new work again.` : `${name} takes no new work. Its records stay readable.`, level: 'success', source: 'Configuration' });
      onClose();
    } catch (error) {
      notify({ title: 'Not changed', message: refusal(error, 'The domain could not be changed.'), level: 'error', source: 'Configuration' });
      setBusy(false);
    }
  };
  return (
    <SettingsPopup
      busy={busy}
      title={turnOn ? `Activate ${name}?` : `Deactivate ${name}?`}
      subtitle={turnOn ? 'It takes new work again.' : 'No new searches, dataframes or runs. Running runs go on.'}
      hint="The reason is kept in the domain’s history."
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="graph_customize_button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="graph_customize_button is-primary" disabled={busy || !reason.trim()} onClick={submit}>{busy ? 'Saving…' : turnOn ? 'Activate' : 'Deactivate'}</button>
        </>
      )}
    >
      <div className="config_profile_fields is-stacked config_profile_popup">
        <div className="config_profile_field">
          <label htmlFor={`${reasonId}-reason`} className="config_profile_field_label">Reason</label>
          <small id={`${reasonId}-help`} className="config_profile_field_help">Why it is {turnOn ? 'activated' : 'deactivated'}. At most {REASON_MAX} characters.</small>
          <textarea id={`${reasonId}-reason`} aria-describedby={`${reasonId}-help`} className="settings_input config_window_textarea" rows={3} maxLength={REASON_MAX} value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
      </div>
    </SettingsPopup>
  );
}

/* ── A new domain ─────────────────────────────────────────────────────── */

// The New domain form, as the Create user form: each field's name (with
// what is wrong beside it), a line of help, then the input with the mark of
// its condition (empty, fine, wrong). Wrong shows once something is typed,
// or after Preview / Create was refused for it.
const FIELD_STATE_ICONS = {
  idle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  ok: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  bad: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
};
const NEW_FIELD_ICONS = {
  domain_id: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  display_name: 'M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82zM7 7h.01',
  description: 'M4 6h16M4 12h16M4 18h10',
  rule_set: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  copy_from: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
};
const Glyph = ({ d, size = 13 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

function FormField({ id, name, label, help, state, problem, optional = false, children }) {
  const note = state === 'bad' ? problem : state === 'ok' ? 'Looks good.' : optional ? 'Optional.' : 'Required.';
  const control = React.cloneElement(React.Children.only(children), { id, 'aria-describedby': `${id}-help`, 'aria-invalid': state === 'bad' || undefined });
  return (
    <div className={`users_input_field is-${state}`}>
      <span className="users_input_label">
        <label htmlFor={id} className="users_input_name"><Glyph d={NEW_FIELD_ICONS[name]} />{label}</label>
        {state === 'bad' ? <em className="users_input_error" role="alert">{problem}</em> : null}
      </span>
      <small id={`${id}-help`} className="graph_customize_hint">{help}</small>
      <span className="users_input_wrap">
        {control}
        <i className="users_input_state" title={note} aria-hidden="true"><Glyph d={FIELD_STATE_ICONS[state]} size={15} /></i>
      </span>
    </div>
  );
}

// Which field a refusal of the Service is about -> { field: why }.
const refusedFields = (error) => {
  const code = error?.data?.code;
  if (code === 'domain_exists') return { domain_id: 'Taken, or another name of a domain.' };
  if (code === 'display_name_exists') return { display_name: 'Another domain has this name.' };
  const fields = (Array.isArray(error?.data?.invalid_fields) ? error.data.invalid_fields : []).filter((field) => typeof field === 'string');
  return Object.fromEntries(fields.map((field) => [field, 'Refused by the Service.']));
};

function NewDomainPopup({ apiFetch, domains, ruleSets, notify, onCreated, onClose }) {
  const formId = useId();
  const [draft, setDraft] = useState({ domain_id: '', display_name: '', description: '', rule_set: ruleSets[0]?.name || '', copy_from: '' });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  // Preview / Create was asked for: every field's problem shows, empty ones too.
  const [checked, setChecked] = useState(false);
  const [refused, setRefused] = useState({}); // { field: why }, from the Service
  const candidates = copyCandidates(domains, draft.rule_set);
  const copyFrom = candidates.some((domain) => domain.id === draft.copy_from) ? draft.copy_from : candidates[0]?.id || '';
  const ruleSet = ruleSets.find((set) => set.name === draft.rule_set);
  const ids = domains.map((domain) => domain.id);
  const problems = {
    domain_id: refused.domain_id || domainIdProblem(draft.domain_id, ids),
    display_name: refused.display_name || (draft.display_name.trim() ? fieldProblem('display_name', {}, draft.display_name) : 'Give the domain a display name.'),
    description: refused.description || '',
    rule_set: refused.rule_set || (draft.rule_set ? '' : 'Choose a rule set.'),
    copy_from: refused.copy_from || (copyFrom ? '' : 'No domain uses this rule set.'),
  };
  const values = { ...draft, copy_from: copyFrom };
  const stateOf = (key) => {
    const value = String(values[key] || '').trim();
    if (problems[key] && (value || checked || refused[key])) return 'bad';
    return value ? 'ok' : 'idle';
  };
  const valid = Object.values(problems).every((text) => !text);
  const set = (key) => (event) => {
    setPreview(null);
    setRefused((list) => Object.fromEntries(Object.entries(list).filter(([field]) => field !== key)));
    setDraft((previous) => ({ ...previous, [key]: key === 'domain_id' ? event.target.value.toLowerCase() : event.target.value }));
  };
  const body = { ...draft, display_name: draft.display_name.trim(), description: draft.description.trim(), copy_from: copyFrom };

  const send = async (dryRun) => {
    if (busy) return;
    if (!valid) {
      setChecked(true);
      return;
    }
    setBusy(dryRun ? 'preview' : 'create');
    try {
      const result = await createDomain(apiFetch, body, { dryRun });
      if (dryRun) {
        setPreview(result);
        return;
      }
      const created = result.domain || { id: body.domain_id, displayName: body.display_name, description: body.description, active: true, origin: 'created', ruleSet: body.rule_set, profileVersionId: null };
      putDomain(created);
      loadDomainRegistry(apiFetch);
      const copied = result.copied.length ? ` (${result.copied.join(', ')})` : '';
      notify({ title: 'Domain created', message: `${created.displayName || created.id} starts as a copy of ${result.copiedFrom || copyFrom}${copied}. An admin can now tune its thresholds and columns on the Domains page.`, level: 'success', source: 'Configuration' });
      onCreated(created.id);
    } catch (error) {
      // As the Create user form: the reason in a notice, the field it is
      // about marked in the form, where it can be put right.
      setPreview(null);
      setRefused(refusedFields(error));
      notify({ title: dryRun ? 'No preview' : 'Domain not created', message: refusal(error, 'The domain could not be created.'), level: 'error', source: 'Configuration' });
    } finally {
      setBusy('');
    }
  };

  const ruleHelp = ruleSet
    ? `Needs ${ruleSet.requiredFields.map((group) => group.join(' or ')).join(', ') || 'no fields'}. Produces ${ruleSet.relationships.join(', ') || 'no named patterns'}.`
    : 'The detection rules its runs use.';
  return (
    <>
    <SettingsPopup
      busy={Boolean(busy)}
      title="New domain"
      subtitle="On a rule set that exists, as a copy of a domain on it."
      hint={busy === 'preview' ? 'Asking the Service…' : busy === 'create' ? 'Creating the domain…' : 'The id can never be changed afterwards.'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="graph_customize_button" disabled={Boolean(busy)} onClick={onClose}>Cancel</button>
          <button type="button" className="graph_customize_button" disabled={Boolean(busy)} onClick={() => send(true)}>{busy === 'preview' ? 'Checking…' : 'Preview'}</button>
          <button type="button" className="graph_customize_button is-primary" disabled={Boolean(busy)} onClick={() => send(false)}>{busy === 'create' ? 'Creating…' : 'Create domain'}</button>
        </>
      )}
    >
      <div className="users_wizard_fields config_profile_popup">
        <FormField id={`${formId}-id`} name="domain_id" label="Id" help="2 to 40 lower case letters, digits or _. It never changes." state={stateOf('domain_id')} problem={problems.domain_id}>
          <input className="graph_customize_input" value={draft.domain_id} maxLength={40} autoComplete="off" placeholder="e.g. retail_bank" onChange={set('domain_id')} />
        </FormField>
        <FormField id={`${formId}-name`} name="display_name" label="Display name" help="What every screen calls it. No two domains share one." state={stateOf('display_name')} problem={problems.display_name}>
          <input className="graph_customize_input" value={draft.display_name} maxLength={DISPLAY_NAME_MAX} placeholder="e.g. Retail banking" onChange={set('display_name')} />
        </FormField>
        <FormField id={`${formId}-description`} name="description" label="Description" help={`What it is for, at most ${DESCRIPTION_MAX.toLocaleString()} characters.`} state={stateOf('description')} problem={problems.description} optional>
          <textarea className="graph_customize_input" rows={2} maxLength={DESCRIPTION_MAX} value={draft.description} onChange={set('description')} />
        </FormField>
        <FormField id={`${formId}-rules`} name="rule_set" label="Rule set" help={ruleHelp} state={stateOf('rule_set')} problem={problems.rule_set}>
          <select className="graph_customize_input" value={draft.rule_set} onChange={set('rule_set')}>
            {ruleSets.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}
          </select>
        </FormField>
        <FormField id={`${formId}-copy`} name="copy_from" label="Start as a copy of" help="Its thresholds, scoring, entity lists, presets, columns and column mapping." state={stateOf('copy_from')} problem={problems.copy_from}>
          <select className="graph_customize_input" value={copyFrom} onChange={set('copy_from')}>
            {candidates.map((domain) => <option key={domain.id} value={domain.id}>{domain.displayName || domain.id}{domain.active ? '' : ' (inactive)'}</option>)}
          </select>
        </FormField>
      </div>
    </SettingsPopup>
    {preview ? (
      // What the dry run answered, over the form: a summary to check, nothing
      // saved. Create stays in the form.
      <SettingsPopup
        title="The Service would create"
        subtitle={`${body.display_name || body.domain_id} · ${body.domain_id}`}
        hint="Nothing is saved yet."
        onClose={() => setPreview(null)}
        footer={<button type="button" className="graph_customize_button is-primary" onClick={() => setPreview(null)}>Close</button>}
      >
        <ul className="config_profile_popup config_profile_summary" role="status" aria-label="What the Service would create">
          {Object.entries(preview.profile?.fields || {}).filter(([key]) => key !== 'relationships').slice(0, 30).map(([key, value]) => (
            <li key={key}><span>{fieldLabel(key)}</span> {valueText(value)}</li>
          ))}
          <li><span>Copied from</span> {preview.copiedFrom || copyFrom}{preview.copied.length ? ` (${preview.copied.join(', ')})` : ''}</li>
        </ul>
      </SettingsPopup>
    ) : null}
    </>
  );
}

/* ── The page ─────────────────────────────────────────────────────────── */

export default function DomainProfilesPanel({ apiFetch, canManage, activeDomain, notify, requestConfirmation }) {
  const registry = useDomainRegistry();
  const [ruleSets, setRuleSets] = useState([]);
  const [picked, setPicked] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadDomainRegistry(apiFetch); }, [apiFetch]);
  useEffect(() => {
    if (registry.status !== 'ready' || !canManage) return;
    fetchRuleSets(apiFetch).then(setRuleSets).catch(() => setRuleSets([]));
  }, [apiFetch, canManage, registry.status]);

  if (registry.status === 'idle' || (registry.status !== 'ready' && registry.status !== 'missing' && registry.status !== 'error')) {
    return <WindowLoadScreen className="is-block" label="Loading the domains…" />;
  }
  if (registry.status !== 'ready') {
    return (
      <SettingsPage className="config_page">
        <Block title="Domain profiles">
          <p className="settings_hint">{registry.status === 'missing'
            ? 'The Service does not offer this yet. When it does, a superuser creates domains and changes their profiles here.'
            : 'The list of domains could not be loaded.'}</p>
          {registry.status === 'error' ? <button type="button" className="settings_button" onClick={() => loadDomainRegistry(apiFetch)}>Retry</button> : null}
        </Block>
      </SettingsPage>
    );
  }

  const domains = [...registry.domains].sort((a, b) => Number(b.active) - Number(a.active) || (a.displayName || a.id).localeCompare(b.displayName || b.id));
  const domain = domains.find((item) => item.id === picked) || domains.find((item) => item.id === activeDomain) || domains[0];
  const created = domains.filter((item) => item.origin === 'created').length;
  const inactive = domains.filter((item) => !item.active).length;

  return (
    <SettingsPage className="config_page config_sensitivity">
      <div className="config_system_domains" role="radiogroup" aria-label="Domain to show">
        {domains.map((item) => (
          <button key={item.id} type="button" role="radio" aria-checked={item.id === domain?.id} className={`config_system_domain${item.id === domain?.id ? ' is-on' : ''}`} onClick={() => setPicked(item.id)}>
            <i aria-hidden="true" />
            {item.displayName || item.id}
            {item.active ? (item.id === activeDomain ? <small>active</small> : null) : <small>inactive</small>}
          </button>
        ))}
        {canManage ? <button type="button" className="config_system_domain is-new" disabled={!ruleSets.length} title={ruleSets.length ? undefined : 'The Service sent no rule sets.'} onClick={() => setCreating(true)}><span aria-hidden="true">+</span>New domain</button> : null}
      </div>
      {domain ? (
        <>
          <Masthead>
            <PageHero
              eyebrow={domain.origin === 'created' ? 'Created domain' : 'Built-in domain'}
              title={domain.displayName || domain.id}
              pill={!domain.active ? <Pill>Inactive</Pill> : canManage ? null : <Pill tone="neutral">Read-only</Pill>}
              meta={domain.description || `Id ${domain.id}. Runs, evidence and access point at it.`}
            />
            <Stats label="Domain profile figures" columns={4}>
              <Stat lead text icon="layers" label="Rule set" value={domain.ruleSet || '—'} note="for new runs" />
              <Stat text icon="clock" label="Profile version" value={domain.profileVersionId != null ? `v${domain.profileVersionId}` : '—'} note={domain.profileVersionId != null ? 'latest' : 'as built in'} />
              <Stat icon="list" label="Domains" value={domains.length.toLocaleString()} note={`${created} created`} />
              <Stat icon="bolt" label="Inactive" value={inactive.toLocaleString()} note="take no new work" />
            </Stats>
          </Masthead>
          {canManage
            ? <ProfileEditor key={domain.id} apiFetch={apiFetch} domain={domain} ruleSets={ruleSets} canManage={canManage} notify={notify} requestConfirmation={requestConfirmation} />
            : <Block title="Profile"><p className="settings_hint">A domain’s profile is changed by a superuser (domains:manage). Sign in with that account to change it.</p></Block>}
        </>
      ) : null}
      {creating ? <NewDomainPopup apiFetch={apiFetch} domains={domains} ruleSets={ruleSets} notify={notify} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setPicked(id); }} /> : null}
    </SettingsPage>
  );
}
