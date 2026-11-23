import React, { useState } from 'react';

import { formatDomainPillarLabel } from '../../../configuration/lib/configModel.js';
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from '../../../../auth/permissions.js';
import { Block, Masthead, PageHero, Pill, SettingsPage, Stat, Stats } from '../SettingsPage.jsx';

// One glyph per permission area (24px grid, stroked).
const AREA_ICONS = {
  session: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  configuration: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  source: 'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3zM21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  graph: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98',
  batch: 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  analysis: 'M22 12h-4l-3 9L9 3l-3 9H2',
  reports: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  alerts: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  tasks: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  admin: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  auth: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4',
};
const DEFAULT_AREA_ICON = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v8M8 12h8';
const AREA_STATE_LABELS = { full: 'Full access', partial: 'Partial access', none: 'No access' };

export function ProfilePanel({ actor, token, roles = [], permissions = [], activeDomain }) {
  // The permissions card opens collapsed (its summary), every time.
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const actorType = actor?.actor_type || (actor?.client_id ? 'service' : 'user');
  const actorName = actorType === 'service' ? actor?.client_id : actor?.username;
  const displayName = actor?.display_name || actorName || 'unknown';
  const email = actor?.email || actor?.mail || '';
  const locale = actor?.locale || actor?.language || actor?.preferred_language || '';
  const timeZone = actor?.time_zone || actor?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const status = actor?.is_active === false ? 'Inactive' : actor?.is_locked ? 'Locked' : 'Active';
  const avatarSeed = String(displayName || actorName || 'A').trim();
  const avatarText = avatarSeed ? avatarSeed.charAt(0).toUpperCase() : 'A';
  const tone = status === 'Active' ? 'active' : status === 'Locked' ? 'locked' : 'inactive';
  const roleList = Array.isArray(roles) ? roles : [];
  const permissionList = Array.isArray(permissions) ? permissions : [];
  // Permissions by area: every permission of the catalog, granted or not,
  // so the actor sees what they hold and what they do not.
  const granted = new Set(permissionList.map(String));
  const actionOf = (permission) => (permission.includes(':') ? permission.slice(permission.indexOf(':') + 1) : permission).replace(/_/g, ' ');
  const areas = PERMISSION_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.map((permission) => ({ permission, action: actionOf(permission), has: granted.has(permission) })),
  }));
  // Granted permissions the catalog does not list, under their own scope.
  [...granted].filter((permission) => !ALL_PERMISSIONS.includes(permission)).forEach((permission) => {
    const label = permission.includes(':') ? permission.slice(0, permission.indexOf(':')) : 'Other';
    const item = { permission, action: actionOf(permission), has: true };
    const area = areas.find((entry) => entry.label.toLowerCase() === label.toLowerCase());
    if (area) area.items.push(item);
    else areas.push({ label, items: [item] });
  });
  const totalCount = areas.reduce((sum, area) => sum + area.items.length, 0);
  const grantedCount = granted.size;
  // Each area's standing, for its row and for the collapsed summary.
  const standings = areas.map((area) => {
    const count = area.items.filter((item) => item.has).length;
    return { ...area, count, state: count === 0 ? 'none' : count === area.items.length ? 'full' : 'partial' };
  });
  const tally = (state) => standings.filter((area) => area.state === state).length;
  const plural = (count) => `${count} ${count === 1 ? 'area' : 'areas'}`;
  const summary = [
    tally('full') ? `Full access to ${plural(tally('full'))}` : '',
    tally('partial') ? `partial access to ${plural(tally('partial'))}` : '',
    tally('none') ? `no access to ${plural(tally('none'))}` : '',
  ].filter(Boolean).join(', ').replace(/^./, (letter) => letter.toUpperCase());
  const facts = [
    ['Email', email],
    ['Locale', locale],
    ['Time zone', timeZone],
  ];

  return (
    <SettingsPage className="profile">
      <Masthead>
        <PageHero
          tone={tone}
          eyebrow="Profile"
          media={avatarText}
          title={displayName}
          titleHint="Display name"
          meta={(
            <>
              <span title="Username / Client ID">{actorName || 'unknown account'}</span>
              <i aria-hidden="true">·</i>
              <span title="Account type">{actorType || 'unknown'}</span>
            </>
          )}
        >
          <Pill tone={tone === 'active' ? 'active' : tone === 'inactive' ? 'neutral' : ''} dot title="Account status">{status}</Pill>
          <Pill tone={token ? 'active' : ''}>{token ? 'Authenticated' : 'No token'}</Pill>
        </PageHero>
        <Stats label="Access figures" columns={4}>
          <Stat lead icon="shield" label="Permissions" value={grantedCount.toLocaleString()} note={`of ${totalCount.toLocaleString()} granted`} />
          <Stat icon="users" label="Roles" value={roleList.length.toLocaleString()} note={roleList.length ? roleList.join(', ') : 'none assigned'} />
          <Stat icon="layers" label="Areas" value={(tally('full') + tally('partial')).toLocaleString()} note={`of ${standings.length.toLocaleString()} with access`} />
          <Stat icon="briefcase" label="Domain pillar" value={formatDomainPillarLabel(activeDomain || actor?.domain || 'bank')} note="active domain" />
        </Stats>
      </Masthead>

      <Block title="Account" description="Contact and regional details of the signed-in actor.">
        <dl className="settings_card settings_facts" aria-label="Identity, access, and session details">
          {facts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className={value ? undefined : 'is-empty'} title={value || undefined}>{value || 'Not provided'}</dd>
            </div>
          ))}
        </dl>
      </Block>

      <section className={`settings_card profile_permissions${permissionsOpen ? ' is-open' : ''}`} aria-label="Permissions">
        <div className="profile_access_head">
          <div className="profile_permissions_title">
            <button
              type="button"
              className="profile_permissions_toggle"
              aria-expanded={permissionsOpen}
              aria-controls="profile_permission_areas"
              aria-label={permissionsOpen ? 'Collapse permissions' : 'Expand permissions'}
              title={permissionsOpen ? 'Collapse' : 'Expand'}
              onClick={() => setPermissionsOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
            <h5>Permissions</h5>
          </div>
          {permissionsOpen ? (
            <span className="profile_legend" aria-hidden="true">
              <span className="is-has"><i />Granted</span>
              <span><i />Not granted</span>
            </span>
          ) : null}
        </div>
        {!permissionsOpen ? (
          <div className="profile_summary">
            <p>{summary ? `${summary}.` : 'No permissions to show.'}</p>
            <ul aria-label="Areas">
              {standings.map((area) => (
                <li key={area.label} className={`is-${area.state}`} title={`${area.label}: ${AREA_STATE_LABELS[area.state].toLowerCase()}`}>
                  <i aria-hidden="true" />
                  {area.label}
                  <span>{area.count}/{area.items.length}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <ul className="profile_areas" id="profile_permission_areas" hidden={!permissionsOpen}>
          {standings.map((area) => {
            const { count, state } = area;
            return (
              <li className={`profile_area is-${state}`} key={area.label} aria-label={`${area.label}: ${AREA_STATE_LABELS[state].toLowerCase()}`}>
                <span className="profile_area_icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d={AREA_ICONS[area.label.toLowerCase()] || DEFAULT_AREA_ICON} />
                  </svg>
                </span>
                <strong className="profile_area_title" title={AREA_STATE_LABELS[state]}>{area.label}</strong>
                <ul>
                  {area.items.map((item) => (
                    <li
                      key={item.permission}
                      className={item.has ? 'is-has' : undefined}
                      title={`${item.permission} · ${item.has ? 'granted' : 'not granted'}`}
                      aria-label={`${item.permission}, ${item.has ? 'granted' : 'not granted'}`}
                    >
                      {item.action}
                    </li>
                  ))}
                </ul>
                <span className="profile_area_count">{count}<i>/{area.items.length}</i></span>
              </li>
            );
          })}
        </ul>
      </section>
    </SettingsPage>
  );
}
