import React from 'react';

import { Block } from '../../settings/components/SettingsPage.jsx';

// A Domains part that could not be shown.
export function SectionMissing({ title, status, error, onRetry }) {
  if (status === 'missing') {
    return <Block title={title}><p className="settings_hint">The Service does not offer this.</p></Block>;
  }
  return (
    <Block title={title} actions={<button type="button" className="settings_button" onClick={onRetry}>Retry</button>}>
      <div className="settings_error" role="alert">{error} The current values are unknown, so they cannot be edited or saved.</div>
    </Block>
  );
}
