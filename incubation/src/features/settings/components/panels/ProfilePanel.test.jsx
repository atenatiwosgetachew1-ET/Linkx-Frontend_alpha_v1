// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { ProfilePanel } from './ProfilePanel.jsx';
import { ALL_PERMISSIONS } from '../../../../auth/permissions.js';

afterEach(cleanup);

describe('ProfilePanel', () => {
  it('shows the actor, their details and their access by scope', async () => {
    render(
      <ProfilePanel
        actor={{ username: 'analyst1', display_name: 'Ana Lyst', email: 'ana@example.org' }}
        token="t"
        sessionId="sess-42"
        roles={['analyst']}
        permissions={['graph:read', 'graph:create', 'reports:read']}
        activeDomain="bank"
      />,
    );
    expect(screen.getByRole('heading', { name: 'Ana Lyst' })).toBeInTheDocument();
    expect(screen.getByText('Authenticated')).toBeInTheDocument();
    const facts = screen.getByLabelText('Identity, access, and session details');
    expect(screen.getByTitle('Username / Client ID')).toHaveTextContent('analyst1');
    expect(screen.getByTitle('Account type')).toHaveTextContent('user');
    expect(screen.getByTitle('Account status')).toHaveTextContent('Active');
    expect(within(facts).getByText('Email').nextSibling).toHaveTextContent('ana@example.org');
    expect(within(facts).getByText('Locale').nextSibling).toHaveTextContent('Not provided');
    // The session is the window header's (not repeated here).
    expect(within(facts).queryByText('Linkx session')).not.toBeInTheDocument();

    // Roles: once, in the top card (count and names).
    expect(within(screen.getByLabelText('Access figures')).getByText('Roles').parentElement).toHaveTextContent('1analyst');
    expect(screen.queryByRole('region', { name: 'Roles' })).not.toBeInTheDocument();
    const permissions = screen.getByRole('region', { name: 'Permissions' });
    // The card opens collapsed: the summary, not the areas.
    const toggle = within(permissions).getByRole('button', { name: 'Expand permissions' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(permissions).queryByRole('meter')).not.toBeInTheDocument();
    expect(permissions).toHaveTextContent(/Partial access to 2 areas, no access to \d+ areas\./);
    expect(within(within(permissions).getByRole('list', { name: 'Areas' })).getByText('Graph').closest('li')).toHaveTextContent('2/3');
    expect(within(permissions).getByLabelText('graph:read, granted')).not.toBeVisible();

    // Expanded: every permission of the catalog, granted or not, by area.
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const graph = within(permissions).getByRole('listitem', { name: 'Graph: partial access' });
    expect(graph).toHaveTextContent('2/3');
    expect(within(permissions).getByLabelText('graph:read, granted')).toBeVisible();
    expect(within(permissions).getByLabelText('graph:link, not granted')).toBeInTheDocument();
    expect(within(permissions).getByLabelText('users:manage, not granted')).toBeInTheDocument();
  });

  it('says so when the actor has no roles, permissions or token', () => {
    render(<ProfilePanel actor={{ client_id: 'svc', is_active: false }} sessionId="s" />);
    expect(screen.getByText('No token')).toBeInTheDocument();
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText('Access figures')).getByText('Roles').parentElement).toHaveTextContent('0none assigned');
    expect(screen.getByLabelText('Access figures')).toHaveTextContent(/Permissions0of \d+ granted/);
  });
});
