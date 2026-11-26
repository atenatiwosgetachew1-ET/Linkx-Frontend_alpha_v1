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

const RULES = { roles: { permissions: { viewer: ['graph:read', 'session:read'], analyst: ['graph:read', 'graph:create'] } } };
const renderUsers = ({ users = USERS, actor = { id: 9, username: 'boss' }, rules = RULES } = {}) => {
  const apiFetch = vi.fn(async (url, options) => {
    if (url === '/auth/admin/user-rules') return rules;
    return options?.method === 'POST' ? { id: 3 } : users;
  });
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
    expect(patch[1].body).toEqual({ display_name: 'Vic Viewer II', roles: ['viewer'], is_active: false });
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
    expect(within(levels).getAllByRole('radio').map((radio) => radio.closest('label').querySelector('strong').textContent)).toEqual(['Viewer', 'Analyst', 'Manager', 'Admin', 'Superuser']);
    expect(within(levels).getByRole('radio', { name: /Analyst/ })).toBeChecked();
    expect(within(levels).getByRole('radio', { name: /Admin/ })).toBeDisabled();
    expect(within(levels).getByRole('radio', { name: /Superuser/ })).toBeDisabled();
    await userEvent.click(within(levels).getByRole('radio', { name: /Viewer/ }));
    // The level is enough to create the account.
    expect(within(dialog).getByRole('button', { name: 'Create user' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: /Privileges/ }));

    // The privileges open in a popup of their own: the role's, as the Service
    // says them, read-only (B-33).
    const privileges = screen.getByRole('dialog', { name: 'Privileges' });
    expect(within(privileges).getByRole('switch', { name: 'graph:read' })).toBeChecked();
    expect(within(privileges).getByRole('switch', { name: 'graph:create' })).not.toBeChecked();
    await userEvent.click(within(privileges).getByRole('switch', { name: 'graph:create' }));
    expect(within(privileges).getByRole('switch', { name: 'graph:create' })).not.toBeChecked();
    await userEvent.click(within(privileges).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Privileges' })).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent('Step 2 of 2');

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));
    const post = apiFetch.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(post?.[0]).toBe('/auth/admin/users');
    expect(post[1].body.username).toBe('newbie');
    expect(post[1].body.roles).toEqual(['viewer']);
    expect(post[1].body).not.toHaveProperty('permissions');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never guesses what a role gives', async () => {
    renderUsers({ rules: {} });
    await userEvent.click(screen.getByRole('button', { name: /Create user/ }));
    const dialog = screen.getByRole('dialog', { name: 'Create user' });
    await userEvent.type(within(dialog).getByLabelText(/^Username/), 'newbie');
    await userEvent.type(within(dialog).getByLabelText(/^Password/), 'Str0ng!Passw0rd#2026');
    await userEvent.type(within(dialog).getByLabelText(/^Confirm password/), 'Str0ng!Passw0rd#2026');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    await userEvent.click(within(dialog).getByRole('button', { name: /Privileges/ }));
    expect(screen.getByRole('dialog', { name: 'Privileges' })).toHaveTextContent('has not said which privileges');
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
    expect(patch[1].body).toEqual({ display_name: '', roles: ['analyst'], is_active: false });
  });

  const openLevel = async (username, options = {}) => {
    const rendered = renderUsers(options);
    await userEvent.click(screen.getByRole('button', { name: /Existing users/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit ' + username }));
    const dialog = screen.getByRole('dialog', { name: 'Modify User' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Next' }));
    return { ...rendered, dialog, levels: within(dialog).getByRole('radiogroup', { name: 'Access level' }) };
  };
  const patched = (apiFetch) => apiFetch.mock.calls.find(([, options]) => options?.method === 'PATCH')[1].body;

  it('an existing account’s level can be changed, within what this account may give; its other roles stay', async () => {
    const users = [{ id: 7, username: 'sam', roles: ['viewer', 'auditor'], is_active: true }];
    const { apiFetch, dialog, levels } = await openLevel('sam', { users });
    expect(within(levels).getByRole('radio', { name: /Viewer/ })).toBeChecked();
    expect(within(levels).getByRole('radio', { name: /Admin/ })).toBeDisabled();
    await userEvent.click(within(levels).getByRole('radio', { name: /Analyst/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update user' }));
    expect(patched(apiFetch)).toEqual({ display_name: '', roles: ['analyst', 'auditor'], is_active: true });
  });

  it('an unchanged level sends the roles exactly as saved', async () => {
    const users = [{ id: 7, username: 'sam', roles: ['viewer', 'analyst', 'auditor'], is_active: true }];
    const { apiFetch, dialog } = await openLevel('sam', { users });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update user' }));
    expect(patched(apiFetch).roles).toEqual(['viewer', 'analyst', 'auditor']);
  });

  it('one’s own level cannot be changed', async () => {
    const users = [{ id: 9, username: 'boss', roles: ['analyst'], is_active: true }];
    const { levels } = await openLevel('boss', { users });
    within(levels).getAllByRole('radio').forEach((radio) => expect(radio).toBeDisabled());
    expect(within(levels).getByRole('radio', { name: /Analyst/ })).toBeChecked();
  });
});

describe('domain access (C10)', () => {
  const people = [{ ...USERS[0], domains: null }, { ...USERS[1], domains: ['bank'] }];
  const open = async (answer) => {
    const apiFetch = vi.fn(async (url, options) => {
      if (url === '/auth/admin/user-rules') return RULES;
      if (String(url).endsWith('/domains')) return options?.method === 'PUT' ? { domains: options.body.domains, unrestricted: false, enforced: true } : answer;
      return people;
    });
    const onNotice = vi.fn();
    render(<div className="settings_window_workspace"><UsersPanel apiFetch={apiFetch} canManageUsers canManageSuperusers={false} currentActor={{ id: 9, username: 'boss' }} onNotice={onNotice} requestConfirmation={vi.fn()} /></div>);
    await userEvent.click(screen.getByRole('button', { name: /Existing users/ }));
    return { apiFetch, onNotice };
  };

  it('shows it in the list and saves the chosen domains, never an empty list', async () => {
    const { apiFetch, onNotice } = await open({ domains: null, unrestricted: true, enforced: true });
    expect(await screen.findByRole('button', { name: 'Domain access of vic' })).toHaveTextContent('1 domain');
    await userEvent.click(screen.getByRole('button', { name: 'Domain access of ana' }));
    const dialog = screen.getByRole('dialog', { name: 'Domain access' });
    const save = within(dialog).getByRole('button', { name: 'Save domains' });
    const all = await within(dialog).findByRole('switch', { name: /All domains/ });
    expect(all).toBeChecked();
    expect(save).toBeDisabled();
    await userEvent.click(all);
    expect(save).toBeDisabled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at least one domain');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Banking' }));
    await userEvent.click(save);
    const put = apiFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(put[0]).toBe('/auth/admin/users/1/domains');
    expect(put[1].body).toEqual({ domains: ['bank'] });
    expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ title: 'Domain access saved' }));
    expect(screen.getByRole('button', { name: 'Domain access of ana' })).toHaveTextContent('1 domain');
  });

  it('is not offered where the Service does not list it', async () => {
    renderUsers();
    await userEvent.click(screen.getByRole('button', { name: /Existing users/ }));
    await screen.findByText('ana');
    expect(screen.queryByRole('button', { name: /Domain access/ })).toBeNull();
  });
});
