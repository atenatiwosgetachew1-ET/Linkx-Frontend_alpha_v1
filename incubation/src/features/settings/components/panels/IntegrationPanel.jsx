import React from 'react';

import { Block, Masthead, PageHero, SettingsPage, Stat, Stats } from '../SettingsPage.jsx';

const CONTRACT_NOTES = [
  ['Auth token', 'Stored separately as linkx_auth_token', 'lock'],
  ['Linkx session', 'Stored separately as session', 'key'],
  ['Socket auth', 'io(API_URL, auth token)', 'bolt'],
  ['Forbidden handling', 'Central auth fetch handles 403 responses', 'block'],
];

export function IntegrationPanel() {
  return (
    <SettingsPage>
      <Masthead>
        <PageHero
          eyebrow="Integration"
          title="Service contract"
          meta="Notes for service contract boundaries and frontend tokens."
          media={(
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          )}
        />

        <Stats label="Contract notes" columns={4}>
          {CONTRACT_NOTES.map(([label, value, icon]) => <Stat key={label} text wrap icon={icon} label={label} value={value} />)}
        </Stats>
      </Masthead>

      <Block title="Reference" description="Service account API details are documented for sibling-service developers.">
        <a className="settings_link" href="docs/integration_contract.md" target="_blank" rel="noreferrer">Open integration_contract.md</a>
      </Block>
    </SettingsPage>
  );
}
