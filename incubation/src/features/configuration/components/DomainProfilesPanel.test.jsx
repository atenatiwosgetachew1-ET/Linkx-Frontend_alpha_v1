// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import DomainProfilesPanel from './DomainProfilesPanel.jsx';
import { resetDomainRegistry } from '../../../shared/domains/domainRegistry.js';

afterEach(() => {
  cleanup();
  resetDomainRegistry();
});

const DOMAINS = [
  { domain_id: 'bank', display_name: 'Banking', active: true, origin: 'builtin', rule_set: 'bank_rules', profile_version_id: 2 },
  { domain_id: 'cdr', display_name: 'Calls', active: true, origin: 'builtin', rule_set: 'cdr_rules' },
];
const PROFILE = {
  domain_id: 'bank',
  version_id: 2,
  profile: { display_name: 'Banking', rule_set: 'bank_rules', default_relationship: 'SENT', neo4j_node_label: 'Account', relationships: ['SMURFING'] },
  editable: { display_name: { type: 'text', max_length: 120 }, rule_set: { type: 'text', allowed_values: ['bank_rules', 'cdr_rules'] }, default_relationship: { type: 'name' } },
  not_editable: ['domain_id', 'relationships'],
  origins: { display_name: 'file', default_relationship: 'superuser' },
};

const renderPanel = ({ canManage = true, route = true, write } = {}) => {
  const apiFetch = vi.fn(async (url, options = {}) => {
    if (!route) throw Object.assign(new Error('Not found'), { status: 404, data: {} });
    if (options.method) return write ? write(url, options) : {};
    if (url === '/domains') return { results: DOMAINS };
    if (url === '/rule-sets') return { results: [{ name: 'bank_rules', required_fields: [['ACCOUNTNO']], relationships: ['SMURFING'] }, { name: 'cdr_rules' }] };
    if (url.endsWith('/history?limit=50')) return { results: [] };
    if (url.endsWith('/profile')) return { results: PROFILE };
    return {};
  });
  const notify = vi.fn();
  const requestConfirmation = vi.fn(async () => true);
  render(<div className="settings_window_workspace"><DomainProfilesPanel apiFetch={apiFetch} canManage={canManage} activeDomain="bank" notify={notify} requestConfirmation={requestConfirmation} /></div>);
  const writes = () => apiFetch.mock.calls.filter(([, options]) => options?.method).map(([url, options]) => [url, options.method, options.body]);
  return { apiFetch, notify, requestConfirmation, writes };
};

describe('Configuration · Domain profiles', () => {
  it('says so while the Service does not offer it', async () => {
    renderPanel({ route: false });
    expect(await screen.findByText(/does not offer this yet/)).toBeInTheDocument();
  });

  it('is read-only without domains:manage', async () => {
    renderPanel({ canManage: false });
    expect(await screen.findByRole('heading', { name: 'Banking' })).toBeInTheDocument();
    expect(screen.getByText(/changed by a superuser/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New domain' })).not.toBeInTheDocument();
  });

  it('saves only what changed, with the version, after asking', async () => {
    const { writes, requestConfirmation } = renderPanel({ write: () => ({ results: { state: { ...PROFILE, version_id: 3, profile: { ...PROFILE.profile, default_relationship: 'PAID' } }, changed: {}, warnings: [] } }) });
    const input = await screen.findByRole('textbox', { name: 'Relationship name' });
    expect(screen.getByText('Account')).toBeInTheDocument(); // node label: shown only
    await userEvent.clear(input);
    await userEvent.type(input, 'PAID TO');
    expect(screen.getByRole('alert')).toHaveTextContent(/letters, digits and _/);
    expect(screen.getByRole('button', { name: /Save 1 changed/ })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'PAID');
    await userEvent.click(screen.getByRole('button', { name: /Save 1 changed/ }));
    await waitFor(() => expect(writes()).toEqual([['/domains/bank/profile', 'PATCH', { default_relationship: 'PAID', version_id: 2 }]]));
    expect(requestConfirmation.mock.calls[0][0].message).toMatch(/Relationship name: SENT → PAID/);
  });

  it('shows what saving would change in a summary popup, closed with Close', async () => {
    const { writes } = renderPanel({ write: () => ({ results: { dry_run: true, changed: { default_relationship: ['SENT', 'PAID'] }, warnings: [] } }) });
    const input = await screen.findByRole('textbox', { name: 'Relationship name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'PAID');
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }));
    const popup = await screen.findByRole('dialog', { name: 'Saving would change' });
    expect(within(popup).getByRole('status', { name: 'What saving would change' })).toHaveTextContent('Relationship name SENT → PAID');
    expect(writes()).toEqual([['/domains/bank/profile', 'PATCH', { default_relationship: 'PAID', version_id: 2, dry_run: true }]]);
    await userEvent.click(within(popup).getByText('Close', { selector: 'button' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save 1 changed/ })).toBeEnabled();
  });

  it('keeps the edits on a version conflict and shows the newer values', async () => {
    const { notify } = renderPanel({ write: () => { throw Object.assign(new Error('c'), { status: 409, data: { code: 'version_conflict', current: { ...PROFILE, version_id: 5, updated_by: 'other', profile: { ...PROFILE.profile, display_name: 'Bank 2' } } } }); } });
    const input = await screen.findByRole('textbox', { name: 'Relationship name' });
    await userEvent.clear(input);
    await userEvent.type(input, 'PAID');
    await userEvent.click(screen.getByRole('button', { name: /Save 1 changed/ }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Not saved' })));
    expect(screen.getByRole('textbox', { name: 'Relationship name' })).toHaveValue('PAID');
    expect(screen.getByRole('textbox', { name: 'Display name' })).toHaveValue('Bank 2');
  });

  it('creates a domain on a rule set, as a copy of one on that rule set', async () => {
    const { writes, notify } = renderPanel({ write: () => ({ results: { domain: { domain_id: 'retail', display_name: 'Retail', origin: 'created', rule_set: 'bank_rules' }, state: { ...PROFILE, domain_id: 'retail' }, copied_from: 'bank', copied: ['thresholds', 'columns'] } }) });
    await userEvent.click(await screen.findByRole('button', { name: 'New domain' }));
    const dialog = screen.getByRole('dialog', { name: 'New domain' });
    const [id, name] = within(dialog).getAllByRole('textbox');
    await userEvent.type(id, 'telecom');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/another name/);
    await userEvent.clear(id);
    await userEvent.type(id, 'retail');
    await userEvent.type(name, 'Retail');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create domain' }));
    await waitFor(() => expect(writes()).toEqual([['/domains', 'POST', { domain_id: 'retail', display_name: 'Retail', description: '', rule_set: 'bank_rules', copy_from: 'bank' }]]));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Domain created', message: expect.stringMatching(/copy of bank \(thresholds, columns\)/) })));
  });

  it('shows the preview of a new domain as a summary in its own popup, closed with Close', async () => {
    const answer = { results: { domain: { domain_id: 'retail', display_name: 'Retail', origin: 'created', rule_set: 'bank_rules' }, state: { ...PROFILE, domain_id: 'retail', profile: { display_name: 'Retail', rule_set: 'bank_rules' } }, copied_from: 'bank', copied: ['thresholds'] } };
    const { writes } = renderPanel({ write: () => answer });
    await userEvent.click(await screen.findByRole('button', { name: 'New domain' }));
    const form = screen.getByRole('dialog', { name: 'New domain' });
    const [id, name] = within(form).getAllByRole('textbox');
    await userEvent.type(id, 'retail');
    await userEvent.type(name, 'Retail');
    await userEvent.click(within(form).getByRole('button', { name: 'Preview' }));
    const preview = await screen.findByRole('dialog', { name: 'The Service would create' });
    const summary = within(preview).getByRole('status', { name: 'What the Service would create' });
    expect(summary).toHaveTextContent('Display name Retail');
    expect(summary).toHaveTextContent('Copied from bank (thresholds)');
    expect(writes()[0][2]).toMatchObject({ dry_run: true });
    expect(within(preview).getAllByRole('button').map((button) => button.textContent)).toEqual(['×', 'Close']);
    await userEvent.click(within(preview).getByText('Close', { selector: 'button' }));
    expect(screen.queryByRole('dialog', { name: 'The Service would create' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'New domain' })).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Create domain' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1][2]).not.toHaveProperty('dry_run');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('marks the fields as the Create user form does: on Create, and for what the Service refuses', async () => {
    const { notify, writes } = renderPanel({ write: () => { throw Object.assign(new Error('taken'), { status: 409, data: { code: 'display_name_exists', detail: 'Banking has it.', invalid_fields: ['display_name'] } }); } });
    await userEvent.click(await screen.findByRole('button', { name: 'New domain' }));
    const form = screen.getByRole('dialog', { name: 'New domain' });
    const id = within(form).getByRole('textbox', { name: 'Id' });
    const name = within(form).getByRole('textbox', { name: 'Display name' });
    // Empty fields are not judged until Create is asked for.
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Create domain' }));
    expect(writes()).toEqual([]);
    expect(id).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(id.closest('.users_input_field')).toHaveClass('is-bad');
    await userEvent.type(id, 'retail');
    expect(id.closest('.users_input_field')).toHaveClass('is-ok');
    await userEvent.type(name, 'Banking');
    await userEvent.click(within(form).getByRole('button', { name: 'Create domain' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Domain not created', message: expect.stringMatching(/Another domain has this display name. Banking has it./) })));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getByRole('alert')).toHaveTextContent('Another domain has this name.');
    // Typing in it again clears the Service's mark.
    await userEvent.type(name, ' 2');
    expect(name.closest('.users_input_field')).toHaveClass('is-ok');
  });

  it('shows the Service’s warning before a rule-set change is saved', async () => {
    const { writes, requestConfirmation } = renderPanel({ write: (url, options) => (options.body.dry_run
      ? { results: { changed: { rule_set: ['bank_rules', 'cdr_rules'] }, warnings: [{ code: 'rule_set_changed', from: 'bank_rules', to: 'cdr_rules' }], dry_run: true } }
      : { results: { state: PROFILE, changed: {}, warnings: [] } }) });
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Rule set' }), 'cdr_rules');
    await userEvent.click(screen.getByRole('button', { name: /Save 1 changed/ }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[0][2]).toMatchObject({ rule_set: 'cdr_rules', dry_run: true });
    expect(requestConfirmation.mock.calls[0][0].message).toMatch(/made for bank_rules, not cdr_rules/);
    expect(writes()[1][2]).toEqual({ rule_set: 'cdr_rules', version_id: 2 });
  });

  it('puts a built-in domain’s changed field back with null', async () => {
    const { writes } = renderPanel({ write: () => ({ results: { state: PROFILE } }) });
    await screen.findByRole('textbox', { name: 'Relationship name' });
    await userEvent.click(await screen.findByRole('button', { name: 'Back to built in' }));
    expect(screen.getByText('The built-in value, once saved.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Save 1 changed/ }));
    await waitFor(() => expect(writes()).toEqual([['/domains/bank/profile', 'PATCH', { default_relationship: null, version_id: 2 }]]));
  });

  it('says what keeps a domain from being deactivated', async () => {
    const { notify } = renderPanel({ write: () => { throw Object.assign(new Error('in use'), { status: 409, data: { code: 'domain_in_use', domain: 'bank', used_by: [{ type: 'alert_runs' }, { type: 'service_account', name: 'xvig' }] } }); } });
    await userEvent.click(await screen.findByRole('switch', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Old');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/alert runs use it; service account xvig/) })));
  });

  it('deactivates only with a reason', async () => {
    const { writes } = renderPanel({ write: () => ({ results: { domain_id: 'bank', active: false } }) });
    await userEvent.click(await screen.findByRole('switch', { name: 'Deactivate' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Deactivate' })).toBeDisabled();
    await userEvent.type(within(dialog).getByRole('textbox'), 'Merged into retail');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(writes()).toEqual([['/domains/bank/deactivate', 'POST', { reason: 'Merged into retail' }]]));
  });
});
