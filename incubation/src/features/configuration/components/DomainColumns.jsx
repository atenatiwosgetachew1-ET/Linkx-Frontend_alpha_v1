import React, { useEffect, useState } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { Block } from '../../settings/components/SettingsPage.jsx';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { COLUMN_KEYS, resetDomainSection, saveDomainSection } from '../../../services/domainConfigApi.js';
import useDomainSection, { readFieldErrors } from '../hooks/useDomainSection.js';
import { formatDomainPillarLabel } from '../lib/configModel.js';
import { getDomainDraft, keepDomainDraft } from '../lib/domainDrafts.js';
import { columnListProblem, listChanges, readColumnText, sameColumns } from '../lib/domainFields.js';
import { HistoryBlock, OriginBadge } from './DomainHistory.jsx';
import { SectionMissing } from './DomainSection.jsx';

const LABELS = {
  fetch_columns: ['Fetch columns', 'What a search or a dataframe reads from the source.'],
  search_columns_strict: ['Search columns – strict', 'Where an exact search looks.'],
  search_columns_fuzzy: ['Search columns – fuzzy', 'Where a fuzzy search looks.'],
};

// "+2 (A, B) −1 (C)"
const describeLists = (from, to) => {
  const added = to.filter((name) => !from.includes(name));
  const removed = from.filter((name) => !to.includes(name));
  const few = (names) => `${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''}`;
  return [added.length ? `added ${few(added)}` : '', removed.length ? `removed ${few(removed)}` : ''].filter(Boolean).join(', ') || 'another order';
};
const historyText = (item) => Object.entries(item.config && typeof item.config === 'object' ? item.config : {})
  .map(([key, value]) => `${LABELS[key]?.[0] || key}: ${Array.isArray(value) ? value.join(', ') || 'none' : 'from the profile'}`).join('; ');

// Configuration ▸ Domains ▸ Columns: the domain's search and fetch columns.
export default function DomainColumns({ windowId, apiFetch, domain, canManage, notify, requestConfirmation, onDirty }) {
  const { state, status, error, history, reload, save } = useDomainSection({ apiFetch, domain, section: 'columns', canManage });
  // { key: { text, base } }: base is the list the edit began from.
  const [edits, setEdits] = useState(() => getDomainDraft(windowId, domain, 'columns') || {});
  const [refused, setRefused] = useState({});
  const [saving, setSaving] = useState(false);
  const label = formatDomainPillarLabel(domain);

  const listOf = (key) => state?.columns[key] || [];
  const changed = state ? COLUMN_KEYS.filter((key) => edits[key] && !sameColumns(readColumnText(edits[key].text), listOf(key))) : [];
  const dirty = changed.length > 0;
  const known = status === 'ready';
  useEffect(() => { if (known) keepDomainDraft(windowId, domain, 'columns', dirty ? edits : null); }, [known, windowId, domain, dirty, edits]);
  useEffect(() => { onDirty?.(dirty); }, [onDirty, dirty]);

  if (status === 'loading') return <WindowLoadScreen className="is-block" label="Loading the domain’s columns…" />;
  if (status !== 'ready') return <SectionMissing title="Columns" status={status} error={error} onRetry={reload} />;

  const problems = Object.fromEntries(changed.map((key) => [key, columnListProblem(readColumnText(edits[key].text))]).filter(([, text]) => text));
  const staleKeys = changed.filter((key) => !sameColumns(edits[key].base, listOf(key)));
  const noteOf = (key) => problems[key] || refused[key] || '';
  const forget = (keys) => setEdits((previous) => Object.fromEntries(Object.entries(previous).filter(([key]) => !keys.includes(key))));

  const run = async (title, send, done) => {
    setSaving(true);
    try {
      const result = await save(send);
      if (!result.ok) {
        notify({ title: 'Not saved: changed meanwhile', message: `${result.conflict.updatedBy || 'Someone else'} changed ${label} columns since you opened them. Theirs are shown beside your edits. Check them, then save again.`, level: 'warning', source: 'Configuration' });
        return;
      }
      setRefused({});
      done();
      notify({ title, message: `${label}: it applies from the next search and dataframe.`, level: 'success', source: 'Configuration' });
      result.warnings.forEach((message) => notify({ title: 'Check the columns', message, level: 'warning', source: 'Configuration' }));
    } catch (failure) {
      setRefused(readFieldErrors(failure));
      notify({ title: 'Columns not saved', message: getServiceRefusalMessage(failure) || failure?.message || 'The columns could not be saved.', level: 'error', source: 'Configuration' });
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    if (!dirty || Object.keys(problems).length) return;
    const lists = Object.fromEntries(changed.map((key) => [key, readColumnText(edits[key].text)]));
    const emptied = changed.filter((key) => !lists[key].length).map((key) => LABELS[key][0]);
    const confirmed = await requestConfirmation({
      title: `Change ${label} columns?`,
      icon: 'warning',
      message: `Everyone working in ${label} without columns of their own gets this. ${emptied.length ? `${emptied.join(' and ')} would be empty. ` : ''}${changed.map((key) => `${LABELS[key][0]}: ${describeLists(listOf(key), lists[key])}`).join('; ')}`,
      confirmText: 'Save',
    });
    if (confirmed) await run('Columns saved', () => saveDomainSection(apiFetch, domain, 'columns', { columns: lists }, state.versionId), () => forget(changed));
  };

  const handleReset = async (keys) => {
    const changes = keys.map((key) => ({ label: LABELS[key][0], from: `${listOf(key).length} columns`, to: state.profile[key] ? `the profile’s ${state.profile[key].length}` : 'the profile’s' }));
    const confirmed = await requestConfirmation({
      title: keys.length === 1 ? `Reset ${LABELS[keys[0]][0].toLowerCase()} of ${label}?` : `Reset all columns of ${label}?`,
      icon: 'warning',
      message: `Everyone working in ${label} without columns of their own goes back to the domain’s profile. ${listChanges(changes)}`,
      confirmText: 'Reset',
    });
    if (confirmed) await run('Columns reset', () => resetDomainSection(apiFetch, domain, 'columns', keys.length === COLUMN_KEYS.length ? {} : { keys }, state.versionId), () => forget(keys));
  };

  const anyAdmin = COLUMN_KEYS.some((key) => state.origins[key] === 'admin');
  return (
    <>
      <Block
        title="Columns"
        description={canManage ? 'The search and fetch columns everyone in this domain starts from. A user’s own columns come before these, for that user only.' : 'You need users:manage to change a domain’s columns.'}
        actions={canManage ? (
          <>
            {dirty ? <button type="button" className="settings_button" disabled={saving} onClick={() => { setRefused({}); setEdits({}); }}>Discard changes</button> : null}
            <button type="button" className="settings_button" disabled={saving || !anyAdmin} onClick={() => handleReset(COLUMN_KEYS)}>Reset to profile</button>
            <button type="button" className="settings_button settings_primary" disabled={saving || !dirty || Object.keys(problems).length > 0} onClick={handleSave}>{saving ? 'Saving…' : 'Save columns'}</button>
          </>
        ) : null}
      >
        {state.enforced ? null : <div className="settings_error" role="alert">Saved, but the Service does not apply it at the moment.</div>}
        <div className="config_card">
          {COLUMN_KEYS.map((key) => {
            const [name, hint] = LABELS[key];
            const isChanged = changed.includes(key);
            const count = (edits[key] ? readColumnText(edits[key].text) : listOf(key)).length;
            return (
              <div key={key} className={`config_domain_columns${isChanged ? ' is-changed' : ''}`}>
                <div className="config_domain_columns_head">
                  <strong>{name}</strong>
                  <OriginBadge origin={state.origins[key]} />
                  <small>{count} column{count === 1 ? '' : 's'}</small>
                  {canManage && state.origins[key] === 'admin' ? <button type="button" className="settings_link_button" disabled={saving} onClick={() => handleReset([key])}>Reset to profile</button> : null}
                </div>
                <textarea
                  className="settings_input config_window_textarea"
                  rows={3}
                  aria-label={name}
                  value={edits[key] ? edits[key].text : listOf(key).join(', ')}
                  readOnly={!canManage}
                  aria-invalid={noteOf(key) ? true : undefined}
                  onChange={(event) => {
                    const text = event.target.value;
                    setRefused((list) => Object.fromEntries(Object.entries(list).filter(([field]) => field !== key)));
                    setEdits((previous) => ({ ...previous, [key]: { text, base: previous[key]?.base || listOf(key) } }));
                  }}
                />
                {noteOf(key) ? <small className="config_domain_error" role="alert">{noteOf(key)}</small> : null}
                {staleKeys.includes(key) ? <small className="config_domain_error" role="alert">Someone changed this list since you began: it is now {listOf(key).join(', ') || 'empty'}.</small> : null}
                <small className="config_window_field_hint">{hint} Profile: {state.profile[key] ? state.profile[key].join(', ') || 'none' : 'not sent'}.</small>
              </div>
            );
          })}
        </div>
      </Block>
      {canManage ? <HistoryBlock label="Columns history" description="Every saved version of the domain’s columns, newest first." items={history} heading="Columns" describe={historyText} /> : null}
    </>
  );
}
