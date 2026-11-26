import React, { useEffect, useState } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { Block } from '../../settings/components/SettingsPage.jsx';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { resetDomainSection, saveDomainSection } from '../../../services/domainConfigApi.js';
import useDomainSection, { readFieldErrors } from '../hooks/useDomainSection.js';
import { formatDomainPillarLabel } from '../lib/configModel.js';
import { getDomainDraft, keepDomainDraft } from '../lib/domainDrafts.js';
import { INHERIT, listChanges, mappingAfter, mappingSourceProblem, unmappedGroups } from '../lib/domainFields.js';
import { HistoryBlock, OriginBadge } from './DomainHistory.jsx';
import { SectionMissing } from './DomainSection.jsx';

const historyText = (item) => Object.entries(item.config && typeof item.config === 'object' ? item.config : {})
  .map(([source, target]) => `${source} → ${target === null ? 'removed' : String(target)}`).join('; ');
const groupText = (group) => group.join(' or ');

// Configuration ▸ Domains ▸ Column mapping: which source column is which field
// of the domain. Not the profile mapping (how a graph node's card is filled).
export default function DomainMapping({ windowId, apiFetch, domain, canManage, notify, requestConfirmation, onDirty }) {
  const { state, status, error, history, reload, save } = useDomainSection({ apiFetch, domain, section: 'mapping', canManage });
  const [edits, setEdits] = useState(() => getDomainDraft(windowId, domain, 'mapping') || {}); // { SOURCE: target | null | INHERIT }
  const [refused, setRefused] = useState({});
  const [saving, setSaving] = useState(false);
  const [source, setSource] = useState('');
  const [target, setTarget] = useState('');
  const label = formatDomainPillarLabel(domain);

  const after = state ? mappingAfter(state, edits) : {};
  // An edit that would change nothing is none.
  const changed = state ? Object.keys(edits).filter((key) => (edits[key] === INHERIT ? key in state.adjustments || (after[key] ?? null) !== (state.mapping[key] ?? null) : (after[key] ?? null) !== (state.mapping[key] ?? null))) : [];
  const dirty = changed.length > 0;
  const known = status === 'ready';
  useEffect(() => { if (known) keepDomainDraft(windowId, domain, 'mapping', dirty ? edits : null); }, [known, windowId, domain, dirty, edits]);
  useEffect(() => { onDirty?.(dirty); }, [onDirty, dirty]);

  if (status === 'loading') return <WindowLoadScreen className="is-block" label="Loading the domain’s column mapping…" />;
  if (status !== 'ready') return <SectionMissing title="Column mapping" status={status} error={error} onRetry={reload} />;

  // Every row there is, was, or would be.
  const rows = [...new Set([...Object.keys(state.mapping), ...Object.keys(state.adjustments), ...Object.keys(edits)])].sort((a, b) => a.localeCompare(b));
  const fields = state.canonicalFields;
  const edit = (key, value) => {
    setRefused((list) => Object.fromEntries(Object.entries(list).filter(([field]) => field !== key)));
    setEdits((previous) => ({ ...previous, [key]: value }));
  };
  const undo = (key) => setEdits((previous) => Object.fromEntries(Object.entries(previous).filter(([name]) => name !== key)));
  const lost = unmappedGroups(state.requiredFields, after);
  const newlyLost = lost.filter((group) => !unmappedGroups(state.requiredFields, state.mapping).some((item) => groupText(item) === groupText(group)));
  const sourceProblem = source ? mappingSourceProblem(source, rows) : '';

  const run = async (title, send, done) => {
    setSaving(true);
    try {
      const result = await save(send);
      if (!result.ok) {
        notify({ title: 'Not saved: changed meanwhile', message: `${result.conflict.updatedBy || 'Someone else'} changed ${label} column mapping since you opened it. Theirs is shown now and your edits are kept. Check them, then save again.`, level: 'warning', source: 'Configuration' });
        return;
      }
      setRefused({});
      done();
      notify({ title, message: `${label}: it applies to dataframes made from now on. One made before must be made again.`, level: 'success', source: 'Configuration' });
      result.warnings.forEach((message) => notify({ title: 'Check the column mapping', message, level: 'warning', source: 'Configuration' }));
    } catch (failure) {
      setRefused(readFieldErrors(failure));
      notify({ title: 'Column mapping not saved', message: getServiceRefusalMessage(failure) || failure?.message || 'The column mapping could not be saved.', level: 'error', source: 'Configuration' });
    } finally {
      setSaving(false);
    }
  };

  const textOf = (value) => value || 'not mapped';
  const handleSave = async () => {
    if (!dirty) return;
    const confirmed = await requestConfirmation({
      title: `Change ${label} column mapping?`,
      icon: 'warning',
      message: `The mapping decides which source field is the account, amount or date in analyses. It applies to all users and service accounts of ${label}. ${newlyLost.length ? `Nothing would be mapped to ${newlyLost.map(groupText).join('; ')} any more, so rules that need it may not run. ` : ''}${listChanges(changed.map((key) => ({ label: key, from: textOf(state.mapping[key]), to: textOf(after[key]) })))}`,
      confirmText: 'Save',
    });
    if (confirmed) await run('Column mapping saved', () => saveDomainSection(apiFetch, domain, 'mapping', { column_mapping: Object.fromEntries(changed.map((key) => [key, edits[key]])) }, state.versionId), () => setEdits({}));
  };

  const handleReset = async () => {
    const keys = Object.keys(state.adjustments);
    const confirmed = await requestConfirmation({
      title: `Reset ${label} column mapping?`,
      icon: 'warning',
      message: `Every adjustment is dropped and ${label} goes back to its profile, for all its users and service accounts. ${listChanges(keys.map((key) => ({ label: key, from: textOf(state.mapping[key]), to: textOf(state.profile[key]) })))}`,
      confirmText: 'Reset',
    });
    if (confirmed) await run('Column mapping reset', () => resetDomainSection(apiFetch, domain, 'mapping', {}, state.versionId), () => setEdits({}));
  };

  const targetInput = (props) => (fields.length ? (
    <select className="settings_input" {...props}>
      <option value="">Choose a field</option>
      {props.value && !fields.includes(props.value) ? <option value={props.value}>{props.value}</option> : null}
      {fields.map((field) => <option key={field} value={field}>{field}</option>)}
    </select>
  ) : <input className="settings_input" maxLength={128} {...props} />);

  return (
    <>
      <Block
        title="Column mapping"
        description={canManage ? 'Which source column is which field of the domain. Only the rows you change are saved.' : 'Managed by an administrator (users:manage).'}
        actions={canManage ? (
          <>
            {dirty ? <button type="button" className="settings_button is-danger" disabled={saving} onClick={() => { setRefused({}); setEdits({}); }}>Discard changes</button> : null}
            <button type="button" className="settings_button" disabled={saving || !Object.keys(state.adjustments).length} onClick={handleReset}>Reset to profile</button>
            <button type="button" className="settings_button settings_primary" disabled={saving || !dirty} onClick={handleSave}>{saving ? 'Saving…' : dirty ? `Save ${changed.length} changed` : 'Save column mapping'}</button>
          </>
        ) : null}
      >
        <div className="config_domain_notice" role="note">The mapping decides which source field is the account, amount or date in analyses. Changes apply to all users and service accounts of this domain.</div>
        {state.enforced ? null : <div className="settings_error" role="alert">Saved, but the Service does not apply it at the moment.</div>}
        {lost.length ? <div className="settings_error" role="alert">No row is mapped to: {lost.map(groupText).join('; ')}. Data must have {lost.length === 1 ? 'that field' : 'those fields'} under {lost.length === 1 ? 'its' : 'their'} own name, or rules that need {lost.length === 1 ? 'it' : 'them'} cannot run.</div> : null}
        <div className="config_window_table_wrap">
          <table className="config_window_table" aria-label="Domain column mapping">
            <thead><tr><th>Source column</th><th>Field of the domain</th><th>From</th>{canManage ? <th aria-label="Actions" /> : null}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={canManage ? 4 : 3} className="config_window_table_empty">No rows yet.</td></tr> : rows.map((key) => {
                const isChanged = changed.includes(key);
                const inProfile = key in state.profile && Boolean(state.profile[key]);
                const adjusted = key in state.adjustments;
                return (
                  <tr key={key} className={isChanged ? 'is-changed' : undefined}>
                    <td><code>{key}</code></td>
                    <td>
                      {after[key] ? (canManage
                        ? targetInput({ 'aria-label': `Field for ${key}`, value: after[key], disabled: saving, onChange: (event) => edit(key, event.target.value || null) })
                        : <code>{after[key]}</code>) : <em>not mapped</em>}
                      {refused[key] ? <small className="config_domain_error" role="alert">{refused[key]}</small> : null}
                    </td>
                    <td>{isChanged ? <small className="config_domain_mark">unsaved</small> : <OriginBadge origin={state.origins[key] || (adjusted ? 'admin' : 'profile')} />}{inProfile && after[key] !== state.profile[key] ? <small className="config_domain_mark">profile: {state.profile[key]}</small> : null}</td>
                    {canManage ? (
                      <td className="config_window_table_actions">
                        {isChanged ? <button type="button" className="settings_link_button" disabled={saving} aria-label={`Undo ${key}`} onClick={() => undo(key)}>Undo</button> : null}
                        {!isChanged && adjusted ? <button type="button" className="settings_link_button" disabled={saving} aria-label={`Back to profile: ${key}`} onClick={() => edit(key, INHERIT)}>Back to profile</button> : null}
                        {!isChanged && after[key] ? <button type="button" className="settings_link_button" disabled={saving} aria-label={`Remove ${key}`} onClick={() => edit(key, null)}>Remove</button> : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {canManage ? (
          <form className="config_domain_add" onSubmit={(event) => { event.preventDefault(); if (source && target && !sourceProblem) { edit(source, target); setSource(''); setTarget(''); } }}>
            <input className="settings_input" aria-label="New source column" placeholder="Source column" value={source} aria-invalid={sourceProblem ? true : undefined} onChange={(event) => setSource(event.target.value.trim().slice(0, 128))} />
            {targetInput({ 'aria-label': 'New field', placeholder: 'Field of the domain', value: target, onChange: (event) => setTarget(event.target.value.trim()) })}
            <button type="submit" className="settings_button" disabled={!source || !target || Boolean(sourceProblem)}>Add row</button>
            {sourceProblem ? <small className="config_domain_error" role="alert">{sourceProblem}</small> : null}
          </form>
        ) : null}
      </Block>
      {canManage ? <HistoryBlock label="Column mapping history" description="Every saved version of the domain’s adjustments, newest first." items={history} heading="Adjustments" describe={historyText} /> : null}
    </>
  );
}
