import React, { useEffect, useState } from 'react';

import { Block } from '../../settings/components/SettingsPage.jsx';
import { getServiceRefusalMessage } from '../../../services/apiErrors.js';
import { resetOwnColumns, saveOwnColumns } from '../../../services/configurationApi.js';
import { COLUMN_LIST_KEYS, formatDomainPillarLabel } from '../lib/configModel.js';
import { getDomainDraft, keepDomainDraft } from '../lib/domainDrafts.js';
import { columnListProblem, readColumnText, sameColumns } from '../lib/domainFields.js';
import { OriginBadge } from './DomainHistory.jsx';

const LABELS = {
  fetch_columns: ['Fetch columns', 'What a search reads from the source.'],
  search_columns_strict: ['Search columns – strict', 'Where an exact search looks.'],
  search_columns_fuzzy: ['Search columns – fuzzy', 'Where a fuzzy search looks.'],
};
const listOf = (value) => (Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : readColumnText(value));
const few = (names) => `${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''}`;
const describe = (from, to) => [
  to.some((name) => !from.includes(name)) ? `added ${few(to.filter((name) => !from.includes(name)))}` : '',
  from.some((name) => !to.includes(name)) ? `removed ${few(from.filter((name) => !to.includes(name)))}` : '',
].filter(Boolean).join(', ') || 'another order';

// Configuration ▸ Connections ▸ Own columns (B-43): the search and fetch
// columns of this account in the session's domain, saved on their own (never
// with the configuration form), and back to the domain's again. Everything a
// search makes under them says so.
//
// configuration: the session's. onSaved(configuration | null: load it).
export default function OwnColumns({ windowId, apiFetch, sessionId, domain, configuration, canOverride, notify, requestConfirmation, onSaved }) {
  const draftId = `own:${windowId || ''}`;
  const [edits, setEdits] = useState(() => getDomainDraft(draftId, domain, 'columns') || {}); // { list: text }
  const [refused, setRefused] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEdits(getDomainDraft(draftId, domain, 'columns') || {});
    setRefused({});
  }, [draftId, domain]);

  const origins = configuration?.columns_origins && typeof configuration.columns_origins === 'object' ? configuration.columns_origins : {};
  const defaults = configuration?.columns_default && typeof configuration.columns_default === 'object' ? configuration.columns_default : {};
  const label = formatDomainPillarLabel(domain);
  const current = (key) => listOf(configuration?.[key]);
  const changed = COLUMN_LIST_KEYS.filter((key) => key in edits && !sameColumns(readColumnText(edits[key]), current(key)));
  const problems = Object.fromEntries(changed.map((key) => [key, columnListProblem(readColumnText(edits[key]))]).filter(([, text]) => text));
  const own = COLUMN_LIST_KEYS.filter((key) => origins[key] === 'override');
  const keep = (next) => {
    setEdits(next);
    keepDomainDraft(draftId, domain, 'columns', Object.keys(next).length ? next : null);
  };
  const forget = (keys) => keep(Object.fromEntries(Object.entries(edits).filter(([key]) => !keys.includes(key))));

  const run = async (title, send, keys) => {
    setBusy(true);
    try {
      const result = await send();
      if (!result.ok) {
        notify({ title: 'Own columns not saved', message: result.message, level: 'warning', source: 'Configuration' });
        return;
      }
      setRefused({});
      forget(keys);
      notify({ title, message: `${label}: it applies from your next search and dataframe.`, level: 'success', source: 'Configuration' });
      onSaved(result.returned ? result.configuration : null);
    } catch (failure) {
      const message = getServiceRefusalMessage(failure) || failure?.message || 'The columns could not be saved.';
      if (failure?.data?.code === 'required_field_removed') setRefused({ fetch_columns: message });
      notify({ title: 'Own columns not saved', message, level: 'error', source: 'Configuration' });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!changed.length || Object.keys(problems).length) return;
    const lists = Object.fromEntries(changed.map((key) => [key, readColumnText(edits[key])]));
    const confirmed = await requestConfirmation({
      title: `Use your own columns in ${label}?`,
      icon: 'warning',
      message: `For your own work in ${label} only, until you restore them. What you make from a search under them (runs, evidence, reports, snaps, prints, exports) says so. ${changed.map((key) => `${LABELS[key][0]}: ${describe(current(key), lists[key])}`).join('; ')}`,
      confirmText: 'Save',
    });
    if (confirmed) await run('Own columns saved', () => saveOwnColumns(apiFetch, sessionId, lists), changed);
  };

  const handleRestore = async (keys) => {
    const confirmed = await requestConfirmation({
      title: keys.length === COLUMN_LIST_KEYS.length ? `Restore the columns of ${label}?` : `Restore the ${LABELS[keys[0]][0].toLowerCase()} of ${label}?`,
      icon: 'reset',
      message: `Back to the domain’s. ${keys.filter((key) => origins[key] === 'override').map((key) => `${LABELS[key][0]}: ${defaults[key] ? describe(current(key), listOf(defaults[key])) : 'the domain’s list'}`).join('; ')}`,
      confirmText: 'Restore',
    });
    if (!confirmed) return;
    await run('Columns restored', () => (keys.length === COLUMN_LIST_KEYS.length
      ? resetOwnColumns(apiFetch, sessionId, domain)
      : saveOwnColumns(apiFetch, sessionId, Object.fromEntries(keys.map((key) => [key, null])))), keys);
  };

  return (
    <Block
      title="Own columns"
      description={canOverride ? `The search and fetch columns you use in ${label}. The domain’s, for everyone, are in Domains ▸ Columns.` : 'The columns in use. You need columns:override to change them for yourself.'}
      actions={canOverride ? (
        <>
          {changed.length ? <button type="button" className="settings_button" disabled={busy} onClick={() => { setRefused({}); keep({}); }}>Discard changes</button> : null}
          <button type="button" className="settings_button" disabled={busy || !own.length} onClick={() => handleRestore(COLUMN_LIST_KEYS)}>Restore all</button>
          <button type="button" className="settings_button settings_primary" disabled={busy || !changed.length || Object.keys(problems).length > 0} onClick={handleSave}>{busy ? 'Saving…' : 'Save own columns'}</button>
        </>
      ) : null}
    >
      <div className="config_card">
        {COLUMN_LIST_KEYS.map((key) => {
          const [name, hint] = LABELS[key];
          const note = problems[key] || refused[key] || '';
          return (
            <div key={key} className={`config_domain_columns${changed.includes(key) ? ' is-changed' : ''}`}>
              <div className="config_domain_columns_head">
                <strong>{name}</strong>
                {origins[key] ? <OriginBadge origin={origins[key]} /> : null}
                {canOverride && origins[key] === 'override' ? <button type="button" className="settings_link_button" disabled={busy} aria-label={`Restore ${name}`} onClick={() => handleRestore([key])}>Restore</button> : null}
              </div>
              <textarea
                className="settings_input config_window_textarea"
                rows={2}
                aria-label={`Own ${name}`}
                value={key in edits ? edits[key] : current(key).join(', ')}
                readOnly={!canOverride}
                aria-invalid={note ? true : undefined}
                onChange={(event) => {
                  setRefused({});
                  keep({ ...edits, [key]: event.target.value });
                }}
              />
              {note ? <small className="config_domain_error" role="alert">{note}</small> : null}
              <small className="config_window_field_hint">{hint}{defaults[key] ? ` The domain’s: ${listOf(defaults[key]).join(', ') || 'none'}.` : ''}</small>
            </div>
          );
        })}
      </div>
    </Block>
  );
}
