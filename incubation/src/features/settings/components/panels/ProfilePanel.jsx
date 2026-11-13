import React from 'react';

import { formatDomainPillarLabel } from '../../../configuration/lib/configModel.js';
import { SESSION_STORAGE_KEY } from '../../lib/settingsModel.js';

export function ProfilePanel({ actor, token, sessionId, roles = [], permissions = [], activeDomain }) {
  const actorType = actor?.actor_type || (actor?.client_id ? 'service' : 'user');
  const actorName = actorType === 'service' ? actor?.client_id : actor?.username;
  const displayName = actor?.display_name || actorName || 'unknown';
  const currentSession = sessionId || localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY) || 'not initialized';
  const email = actor?.email || actor?.mail || '';
  const locale = actor?.locale || actor?.language || actor?.preferred_language || '';
  const timeZone = actor?.time_zone || actor?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const status = actor?.is_active === false ? 'Inactive' : actor?.is_locked ? 'Locked' : 'Active';
  const avatarSeed = String(displayName || actorName || 'A').trim();
  const avatarText = avatarSeed ? avatarSeed.charAt(0).toUpperCase() : 'A';
  const summaryPermissions = Array.isArray(permissions) ? permissions.slice(0, 6) : [];

  return (
    <section className="settings_section settings_profile_section">
      <div className="settings_section_header">
        <div>
          <h3>Current actor</h3>
          <p>Identity, access, and session details for the signed-in workspace.</p>
        </div>
      </div>
      <div className="settings_profile_overview">
        <div className="settings_profile_identity_card">
          <div className="settings_profile_avatar" aria-hidden="true">{avatarText}</div>
          <div className="settings_profile_identity_text">
            <strong>{displayName}</strong>
            <span>{actorName || 'unknown account'}</span>
            <div className="settings_profile_meta_chips">
              <i>{actorType || 'unknown'}</i>
              <i>{status}</i>
              <i>{token ? 'Authenticated' : 'No token'}</i>
            </div>
          </div>
        </div>
        <div className="settings_identity_grid settings_profile_identity_grid">
          <span>Display name</span><b>{displayName}</b>
          <span>Username / Client ID</span><b>{actorName || 'unknown'}</b>
          <span>Account type</span><b>{actorType || 'unknown'}</b>
          <span>Account status</span><b>{status}</b>
          <span>Email</span><b>{email || 'Not provided'}</b>
          <span>Locale</span><b>{locale || 'Not provided'}</b>
          <span>Time zone</span><b>{timeZone || 'Not provided'}</b>
          <span>Linkx session</span><b>{currentSession}</b>
          <span>Domain pillar</span><b>{formatDomainPillarLabel(activeDomain || actor?.domain || 'bank')}</b>
        </div>
      </div>
      <div className="settings_profile_access_grid">
        <div className="settings_subsection settings_profile_panel">
          <h4>Roles</h4>
          <p className="settings_hint">Assigned access groups for this actor.</p>
          <div className="settings_token_list">
            {(roles.length ? roles : ['none']).map((role) => <span key={role}>{role}</span>)}
          </div>
        </div>
        <div className="settings_subsection settings_profile_panel">
          <h4>Permissions</h4>
          <p className="settings_hint">A compact summary of currently granted privileges.</p>
          <div className="settings_token_list">
            {(summaryPermissions.length ? summaryPermissions : ['none']).map((permission) => <span key={permission}>{permission}</span>)}
            {permissions.length > summaryPermissions.length ? <span>+{permissions.length - summaryPermissions.length} more</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
