import React from 'react';

import { Block } from '../../settings/components/SettingsPage.jsx';

/* Shared by the Domains parts: the history table and the origin badge. */

const formatDate = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value || '—') : date.toLocaleString();
};

export function HistoryBlock({ label, description, items, heading = 'Config snippet', describe = (item) => JSON.stringify(item.config) }) {
  if (!items.length) return null;
  return (
    <Block title="Audit trail" description={description}>
      <div className="config_window_table_wrap is-scroll">
        <table className="config_window_table" aria-label={label}>
          <thead><tr><th>Version</th><th>Updated by</th><th>Date</th><th>{heading}</th></tr></thead>
          <tbody>
            {items.map((item, index) => {
              const text = describe(item) || '—';
              return (
                <tr key={item.version_id || index}>
                  <td>v{item.version_id}</td>
                  <td>{item.updated_by}</td>
                  <td>{formatDate(item.created_at)}</td>
                  <td className="config_window_table_snippet" title={text}>{text}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Block>
  );
}

const ORIGINS = {
  profile: ['Profile', 'Built into the domain’s profile.'],
  admin: ['Admin', 'Set by an administrator for everyone in the domain.'],
  service_account: ['Service account', 'Set on a service account.'],
  override: ['Own', 'Set by you, for your own runs.'],
};
export function OriginBadge({ origin }) {
  const [text, title] = ORIGINS[origin] || [String(origin || 'unknown').slice(0, 30), 'The Service did not say more.'];
  return <span className={`config_domain_origin is-${ORIGINS[origin] ? origin : 'unknown'}`} title={title}>{text}</span>;
}
