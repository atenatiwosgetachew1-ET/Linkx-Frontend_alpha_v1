// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { IntegrationPanel } from './IntegrationPanel.jsx';
import { PreferencesPanel } from './PreferencesPanel.jsx';
import ServiceAccountsPanel from '../ServiceAccountsPanel.jsx';

vi.mock('../theme/ThemeStudio.jsx', () => ({ LiveThemeCustomizerStudio: () => null }));

afterEach(cleanup);

describe('settings pages of the Vigilance family', () => {
  it('Preferences: every option is a switch and the header counts them', async () => {
    const setAnimations = vi.fn();
    render(<PreferencesPanel areBackgroundAnimationsEnabled={false} setBackgroundAnimationsEnabled={setAnimations} />);
    expect(screen.getByRole('heading', { name: 'Workspace behaviour' })).toBeInTheDocument();
    const options = within(screen.getByRole('group', { name: 'Preferences' })).getAllByRole('switch');
    expect(options).toHaveLength(4);
    await userEvent.click(screen.getByRole('switch', { name: /Enable background animations/ }));
    expect(setAnimations).toHaveBeenCalledWith(true);
    const remember = screen.getByRole('switch', { name: /Remember window layout/ });
    const before = remember.checked;
    await userEvent.click(remember);
    expect(remember.checked).toBe(!before);
  });

  it('Integration: the contract notes and the reference', () => {
    render(<IntegrationPanel />);
    const notes = screen.getByLabelText('Contract notes');
    expect(within(notes).getByText('Socket auth').nextSibling).toHaveTextContent('io(API_URL, auth token)');
    expect(screen.getByRole('link', { name: 'Open integration_contract.md' })).toHaveAttribute('href', 'docs/integration_contract.md');
  });

  it('Service accounts: the header figures follow the loaded accounts', async () => {
    const apiFetch = vi.fn(async (url) => (url.startsWith('/auth/admin/service-accounts')
      ? [
        { id: 1, client_id: 'engine', is_system: true, is_active: true, permissions: [], config: { registered_domains: ['banking'], domains: { banking: {} } } },
        { id: 2, client_id: 'pipeline', is_active: false, permissions: ['graph:read'] },
      ]
      : { domains: [] }));
    render(<ServiceAccountsPanel apiFetch={apiFetch} canManageUsers requestConfirmation={vi.fn()} />);
    const figures = screen.getByLabelText('Service account figures');
    expect(await within(figures).findByText('1 inactive')).toBeInTheDocument();
    expect(within(figures).getByText('Accounts').nextSibling).toHaveTextContent('2');
    expect(within(figures).getByText('System').nextSibling).toHaveTextContent('1');
    expect(within(figures).getByText('Domains').nextSibling).toHaveTextContent('1');
    // The page offers two actions; the accounts are listed in a popup.
    expect(screen.getByRole('button', { name: /Create service account/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Existing service accounts/ }));
    const list = within(screen.getByRole('dialog', { name: 'Existing service accounts' })).getByRole('list', { name: 'Service accounts' });
    expect(within(list).getByText('pipeline')).toBeInTheDocument();
    expect(within(list).getByRole('switch', { name: 'Activate pipeline' })).not.toBeChecked();
    // Edit: the form, filled with the account, its client ID locked.
    await userEvent.click(within(list).getByRole('button', { name: 'Edit pipeline' }));
    const modify = screen.getByRole('dialog', { name: 'Modify Service Account' });
    expect(within(modify).getByLabelText(/^Client ID/)).toBeDisabled();
    expect(within(modify).getByLabelText(/^Client ID/)).toHaveValue('pipeline');
    // Closing it goes back to the list.
    await userEvent.click(within(modify).getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('dialog', { name: 'Existing service accounts' })).toBeInTheDocument();
  });

  it('Service accounts: says so without the permission', () => {
    render(<ServiceAccountsPanel apiFetch={vi.fn()} canManageUsers={false} requestConfirmation={vi.fn()} />);
    expect(screen.getByText('You need users:manage to manage service accounts.')).toBeInTheDocument();
  });
});
