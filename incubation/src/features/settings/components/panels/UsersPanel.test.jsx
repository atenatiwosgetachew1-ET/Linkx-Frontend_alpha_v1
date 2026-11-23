// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { UsersPanel } from './UsersPanel.jsx';

afterEach(cleanup);

const USERS = [
  { id: 1, username: 'ana', display_name: 'Ana Lyst', roles: ['analyst'], permissions: ['graph:read'], is_active: true },
  { id: 2, username: 'vic', display_name: 'Vic Viewer', roles: ['viewer'], permissions: [], is_active: false },
];

const renderUsers = ({ users = USERS, actor = { id: 9, username: 'boss' } } = {}) => {
  const apiFetch = vi.fn(async (url, options) => (options?.method === 'POST' ? { id: 3 } : users));
  render(
    <div className="settings_window_workspace">
      <UsersPanel apiFetch={apiFetch} canManageUsers canManageSuperusers={false} currentActor={actor} onNotice={vi.fn()} requestConfirmation={vi.fn()} />
    </div>,
  );
  return { apiFetch };
};

describe('UsersPanel', () => {
  it('offers the two actions side by side, each opening a popup', async () => {
    const { apiFetch } = renderUsers();
    const create = screen.getByRole('button', { name: /Create user/ });
    const existing = screen.getByRole('button', { name: /Existing users/ });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(create);
    const createDialog = screen.getByRole('dialog', { name: 'Create user' });
    expect(within(createDialog).getByLabelText(/^Username/)).toBeInTheDocument();
    expect(within(createDialog).getByRole('button', { name: 'Next' })).toBeInTheDocument();
    await userEvent.click(within(createDialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(existing);
    const usersDialog = screen.getByRole('dialog', { name: 'Existing users' });
    // The list only: one card per account, a search and a status filter.
    const list = await within(usersDialog).findByRole('list', { name: 'Users' });
    const names = () => within(list).getAllByRole('listitem').map((row) => row.querySelector('strong').textContent);
    expect(names()).toEqual(expect.arrayContaining(['ana', 'vic']));
    expect(within(usersDialog).queryByRole('region', { name: 'User details' })).not.toBeInTheDocument();
    await userEvent.click(within(usersDialog).getByRole('radio', { name: 'Inactive' }));
    expect(names()).toEqual(['vic']);
    // Each card has two actions: the active / inactive switch and Edit.
    expect(within(list).getByRole('switch', { name: 'Activate vic' })).not.toBeChecked();
    // Edit: the Create user form, filled with the account, as Modify User.
    await userEvent.click(within(list).getByRole('button', { name: 'Edit vic' }));
    let modify = screen.getByRole('dialog', { name: 'Modify User' });
    expect(within(modify).getByLabelText(/^Username/)).toBeDisabled();
    expect(within(modify).getByLabelText(/^Username/)).toHaveValue('vic');
    expect(within(modify).getByLabelText(/^Display name/)).toHaveValue('Vic Viewer');
    // Cancel returns to Existing users as it was left (still filtered).
    await userEvent.click(within(modify).getByRole('button', { name: 'Cancel' }));
    let back = screen.getByRole('dialog', { name: 'Existing users' });
    expect(within(back).getByRole('radio', { name: 'Inactive' })).toBeChecked();
    expect(within(within(back).getByRole('list', { name: 'Users' })).getAllByRole('listitem')).toHaveLength(1);
    // An update is saved without a new password, and returns there too.
    await userEvent.click(within(back).getByRole('button', { name: 'Edit vic' }));
    modify = screen.getByRole('dialog', { name: 'Modify User' });
    await userEvent.type(within(modify).getByLabelText(/^Display name/), ' II');
    await userEvent.click(within(modify).getByRole('button', { name: 'Update user' }));
    const patch = apiFetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patch[0]).toBe('/auth/admin/users/2');
    expect(patch[1].body).toEqual({ display_name: 'Vic Viewer II', roles: ['viewer'], permissions: [], is_active: false });
    back = await screen.findByRole('dialog', { name: 'Existing users' });
    expect(within(back).getByRole('radio', { name: 'Inactive' })).toBeChecked();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('creates a user in three steps and closes the popup', async () => {
    const { apiFetch } = renderUsers();
    await userEvent.click(screen.getByRole('button', { name: /Create user/ }));
    const dialog = screen.getByRole('dialog', { name: 'Create user' });
    const next = () => userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));

    // Step 1, the account: Next stops while it is incomplete.
    expect(dialog).toHaveTextContent('Step 1 of 2');
    await next();
    expect(dialog).toHaveTextContent('Step 1 of 2');
    expect(within(dialog).getByText(/Username is required/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText(/^Username/), 'newbie');
    await userEvent.type(within(dialog).getByLabelText(/^Password/), 'Str0ng!Passw0rd#2026');
    // The password is typed twice; a mismatch stops Next.
    await userEvent.type(within(dialog).getByLabelText(/^Confirm password/), 'Str0ng!Passw0rd#2027');
    await next();
    expect(dialog).toHaveTextContent('Step 1 of 2');
    expect(dialog).toHaveTextContent('The passwords do not match.');
    await userEvent.clear(within(dialog).getByLabelText(/^Confirm password/));
    await userEvent.type(within(dialog).getByLabelText(/^Confirm password/), 'Str0ng!Passw0rd#2026');
    await next();

    // Step 2, the access level: Analyst by default; Admin and Superuser are
    // locked without superuser:manage.
    expect(dialog).toHaveTextContent('Step 2 of 2');
    const levels = within(dialog).getByRole('radiogroup', { name: 'Access level' });
    expect(within(levels).getAllByRole('radio').map((radio) => radio.closest('label').querySelector('strong').textContent)).toEqual(['Viewer', 'Analyst', 'Admin', 'Superuser']);
    expect(within(levels).getByRole('radio', { name: /Analyst/ })).toBeChecked();
    expect(within(levels).getByRole('radio', { name: /Admin/ })).toBeDisabled();
    expect(within(levels).getByRole('radio', { name: /Superuser/ })).toBeDisabled();
    await userEvent.click(within(levels).getByRole('radio', { name: /Viewer/ }));
    // The level is enough to create the account; the privileges step is
    // optional and entered on purpose.
    expect(within(dialog).getByRole('button', { name: 'Create user' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Privileges/ }));

    // The privileges open in a popup of their own: the level's, adjustable.
    const privileges = screen.getByRole('dialog', { name: 'Privileges' });
    expect(within(privileges).getByRole('switch', { name: 'graph:read' })).toBeChecked();
    expect(within(privileges).getByRole('switch', { name: 'graph:create' })).not.toBeChecked();
    await userEvent.click(within(privileges).getByRole('switch', { name: 'graph:create' }));
    // Its reset puts the level's privileges back.
    await userEvent.click(within(privileges).getByRole('button', { name: 'Reset to the level’s' }));
    expect(within(privileges).getByRole('switch', { name: 'graph:create' })).not.toBeChecked();
    await userEvent.click(within(privileges).getByRole('switch', { name: 'graph:create' }));
    // Done closes it and keeps what was chosen with the form.
    await userEvent.click(within(privileges).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Privileges' })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('Step 2 of 2');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    const post = apiFetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(post?.[0]).toBe('/auth/admin/users');
    expect(post[1].body.username).toBe('newbie');
    expect(post[1].body.roles).toEqual(['viewer']);
    expect(post[1].body.permissions).toEqual(['config:read', 'graph:create', 'graph:read', 'reports:read', 'session:create', 'session:read']);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('grants only what the signed-in account holds (B-1); others are locked', async () => {
    const actor = { id: 9, username: 'boss', permissions: ['users:manage', 'graph:read', 'session:read'] };
    const { apiFetch } = renderUsers({ actor });
    await userEvent.click(screen.getByRole('button', { name: /Create user/ }));
    const dialog = screen.getByRole('dialog', { name: 'Create user' });
    await userEvent.type(within(dialog).getByLabelText(/^Username/), 'newbie');
    await userEvent.type(within(dialog).getByLabelText(/^Password/), 'Str0ng!Passw0rd#2026');
    await userEvent.type(within(dialog).getByLabelText(/^Confirm password/), 'Str0ng!Passw0rd#2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Privileges/ }));
    const privileges = screen.getByRole('dialog', { name: 'Privileges' });
    const create = within(privileges).getByRole('switch', { name: 'graph:create' });
    expect(create).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(create);
    expect(create).not.toBeChecked();
    await userEvent.click(within(privileges).getByRole('button', { name: 'Done' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    const post = apiFetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(post[1].body.permissions).toEqual(['graph:read', 'session:read']);
  });

  it('keeps an empty display name empty, and locks admins without superuser:manage', async () => {
    const users = [
      { id: 5, username: 'nodn', roles: ['analyst'], permissions: [], is_active: true },
      { id: 6, username: 'adm', display_name: 'Ad Min', roles: ['admin'], permissions: [], is_active: true },
    ];
    const { apiFetch } = renderUsers({ users });
    await userEvent.click(screen.getByRole('button', { name: /Existing users/ }));
    const list = await screen.findByRole('list', { name: 'Users' });
    expect(within(list).getByRole('button', { name: 'Edit adm' })).toBeDisabled();
    expect(within(list).getByRole('switch', { name: 'Deactivate adm' })).toBeDisabled();
    await userEvent.click(within(list).getByRole('switch', { name: 'Deactivate nodn' }));
    const patch = apiFetch.mock.calls.find(([, options]) => options?.method === 'PATCH');
    expect(patch[1].body).toEqual({ display_name: '', roles: ['analyst'], permissions: [], is_active: false });
  });
});
