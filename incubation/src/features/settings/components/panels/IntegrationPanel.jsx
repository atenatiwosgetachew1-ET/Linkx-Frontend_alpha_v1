import React from 'react';

export function IntegrationPanel() {
  return (
    <section className="settings_section">
      <div className="settings_section_header">
        <div>
          <h3>Integration</h3>
          <p>Notes for service contract boundaries and frontend tokens.</p>
        </div>
      </div>
      <div className="settings_subsection">
        <h4>Contract notes</h4>
        <div className="settings_identity_grid">
          <span>Auth token</span><b>Stored separately as linkx_auth_token</b>
          <span>Linkx session</span><b>Stored separately as session</b>
          <span>Socket auth</span><b>io(API_URL, auth token)</b>
          <span>Forbidden handling</span><b>Central auth fetch handles 403 responses</b>
        </div>
      </div>
      <div className="settings_subsection">
        <h4>Reference</h4>
        <p className="settings_hint">Backend service account API details are documented for sibling-service developers.</p>
        <a className="settings_link" href="docs/integration_contract.md" target="_blank" rel="noreferrer">Open integration_contract.md</a>
      </div>
    </section>
  );
}
