import React, { useEffect, useState } from 'react';

import WindowLoadScreen from '../../../shared/components/WindowLoadScreen.jsx';
import { getUserAdminErrorMessage } from '../../../services/apiErrors.js';
import { DEFAULT_REGISTERED_DOMAINS, formatDomainPillarLabel } from '../../configuration/lib/configModel.js';
import { readUserDomains } from '../lib/userDomains.js';
import { SettingsPopup } from './SettingsPage.jsx';

const path = (user) => `/auth/admin/users/${encodeURIComponent(user.id)}/domains`;
// Which domains an account may work in (C10). null = all, new ones too; an
// empty list is refused by the Service (deactivate the account instead).
export default function UserDomainsPopup({ apiFetch, user, onClose, onSaved }) {
  const [status, setStatus] = useState('loading'); // loading | ready | error | saving
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);
  const [all, setAll] = useState(true);
  const [picked, setPicked] = useState([]);

  useEffect(() => {
    let current = true;
    apiFetch(path(user), { method: 'GET', suppressForbiddenHandler: true }).then((data) => {
      if (!current) return;
      const read = readUserDomains(data);
      if (!read) throw new Error('The Service’s answer could not be read.');
      setInfo(read);
      setAll(read.domains === null);
      setPicked(read.domains || []);
      setStatus('ready');
    }).catch((failure) => {
      if (!current) return;
      setError(getUserAdminErrorMessage(failure, failure?.message || 'The domains could not be loaded.'));
      setStatus('error');
    });
    return () => { current = false; };
  }, [apiFetch, user]);

  const roles = user.roles || [];
  // Admins are never restricted (C10, 7).
  const exempt = info?.unrestricted && roles.some((role) => ['admin', 'superuser'].includes(role));
  // A domain the account has and this screen does not know stays in the list.
  const domains = [...new Set([...DEFAULT_REGISTERED_DOMAINS, ...(info?.domains || [])])];
  const next = all ? null : domains.filter((domain) => picked.includes(domain));
  const before = info ? (info.domains === null ? null : domains.filter((domain) => info.domains.includes(domain))) : null;
  const changed = JSON.stringify(next) !== JSON.stringify(before);
  const empty = Array.isArray(next) && !next.length;
  const busy = status === 'saving';

  const save = async () => {
    setStatus('saving');
    setError('');
    try {
      const data = await apiFetch(path(user), { method: 'PUT', body: { domains: next } });
      const read = readUserDomains(data);
      onSaved(user, read ? read.domains : next);
    } catch (failure) {
      setError(getUserAdminErrorMessage(failure, 'The domains could not be saved.'));
      setStatus('ready');
    }
  };

  return (
    <SettingsPopup
      narrow
      title="Domain access"
      subtitle={user.username}
      hint={busy ? 'Saving…' : 'Applies from the account’s next request. Runs that go on are not stopped.'}
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="graph_customize_button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="graph_customize_button is-primary" disabled={status !== 'ready' || exempt || !changed || empty} onClick={save}>{busy ? 'Saving…' : 'Save domains'}</button>
        </>
      )}
    >
      <div className="users_make">
        {error ? <div className="settings_error users_popup_error" role="alert">{error}</div> : null}
        {status === 'loading' ? <WindowLoadScreen className="is-block" label="Loading the domains…" /> : null}
        {info ? (
          <>
            {exempt ? <p className="users_empty">Administrators always have every domain.</p> : null}
            {info.enforced ? null : <p className="users_empty">The Service does not enforce domain access at the moment.</p>}
            <label className="settings_switch users_domains_all">
              <input type="checkbox" role="switch" checked={all} disabled={busy || exempt} onChange={(event) => setAll(event.target.checked)} />
              <span>All domains, new ones too</span>
            </label>
            <div className="users_domains" role="group" aria-label="Domains">
              {domains.map((domain) => (
                <label key={domain} className="settings_switch">
                  <input
                    type="checkbox"
                    checked={all || picked.includes(domain)}
                    disabled={busy || exempt || all}
                    onChange={(event) => setPicked((list) => (event.target.checked ? [...list, domain] : list.filter((item) => item !== domain)))}
                  />
                  <span>{formatDomainPillarLabel(domain)}</span>
                </label>
              ))}
            </div>
            {empty ? <p className="users_empty" role="alert">Choose at least one domain. To block the account, deactivate it.</p> : null}
            <p className="graph_customize_hint">It limits sessions and runs. Tasks, reports, evidence and alerts of other domains stay visible.</p>
          </>
        ) : null}
      </div>
    </SettingsPopup>
  );
}
