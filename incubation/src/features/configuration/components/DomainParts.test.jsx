// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import DomainsPanel from './DomainsPanel.jsx';
import { clearConfigurationDrafts } from '../lib/configDraft.js';
import { noteDomainChange, resetDomainChanges } from '../lib/domainChanges.js';

afterEach(() => {
  cleanup();
  clearConfigurationDrafts();
  resetDomainChanges();
});

const SENSITIVITY = { domain: 'bank', section: 'sensitivity', preset: 'baseline', available_presets: { baseline: { smurfing_min_tx_count: 3 }, strict: { smurfing_min_tx_count: 2 } }, managed_keys: ['smurfing_min_tx_count'], modified_since_applied: [], thresholds: { smurfing_min_tx_count: 3 }, version_id: 5 };
const COLUMNS = { domain: 'bank', section: 'columns', columns: { fetch_columns: ['A', 'B'], search_columns_strict: ['A'], search_columns_fuzzy: ['B'] }, origins: { fetch_columns: 'admin', search_columns_strict: 'profile', search_columns_fuzzy: 'profile' }, admin: { fetch_columns: ['A', 'B'] }, profile: { fetch_columns: ['A'], search_columns_strict: ['A'], search_columns_fuzzy: ['B'] }, versions: { profile: 1, admin: { version_id: 4, updated_by: 'boss' } }, version_id: 4, enforced: true };
const MAPPING = { domain: 'bank', section: 'mapping', column_mapping: { ACC: 'ACCOUNTNO', AMT: 'AMOUNT' }, origins: { ACC: 'profile', AMT: 'admin' }, admin_adjustments: { AMT: 'AMOUNT' }, profile: { ACC: 'ACCOUNTNO', AMT: 'AMOUNTINBIRR' }, canonical_fields: ['ACCOUNTNO', 'AMOUNT', 'AMOUNTINBIRR', 'BRANCH'], required_fields: [['ACCOUNTNO'], ['AMOUNTINBIRR', 'AMOUNT']], version_id: 9, versions: {}, enforced: true };

const refuse = (status, data) => Object.assign(new Error(data.message || 'refused'), { status, data });
const renderPanel = ({ sections = {}, thresholds = { results: { config: {} } }, post, props = {} } = {}) => {
  const answers = { sensitivity: SENSITIVITY, columns: COLUMNS, mapping: MAPPING, ...sections };
  const apiFetch = vi.fn(async (url, options) => {
    if (options?.method === 'POST') return post ? post(url, options.body) : { message: 'success', state: answers[options.body.section] };
    if (String(url).includes('history')) return { results: [] };
    const section = /section=(\w+)/.exec(url)?.[1];
    if (section) {
      if (answers[section] instanceof Error) throw answers[section];
      return answers[section];
    }
    return String(url).includes('lineage') ? { results: { config: {} } } : thresholds;
  });
  const requestConfirmation = vi.fn(async () => true);
  const notify = vi.fn();
  render(<DomainsPanel windowId="c1" apiFetch={apiFetch} domains={['bank', 'insurance']} activeDomain="bank" canManage notify={notify} requestConfirmation={requestConfirmation} {...props} />);
  const posts = () => apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST').map(([url, options]) => [url, options.body]);
  const gets = (part) => apiFetch.mock.calls.filter(([url, options]) => options?.method !== 'POST' && String(url).includes(part)).length;
  return { apiFetch, requestConfirmation, notify, posts, gets };
};
const open = async (tab, region) => {
  await userEvent.click(screen.getByRole('tab', { name: new RegExp(`^${tab}`) }));
  return screen.findByRole('region', { name: region });
};

describe('Domains · thresholds from the Service’s own list (B-44)', () => {
  const answer = (more = {}) => ({ results: { config: { smurfing_min_tx_count: 4, own_key: 2 }, version_id: 12, closed: true, keys: { smurfing_min_tx_count: { type: 'integer', min: 2, max: 50, default: 3 }, own_key: { type: 'number', min: 0, default: 1 }, words: { type: 'list' } }, ...more } });

  it('shows its keys and limits only, and sends the version it edits', async () => {
    const { posts } = renderPanel({ thresholds: answer() });
    const region = await screen.findByRole('region', { name: 'Rule thresholds' });
    expect(within(region).getAllByRole('spinbutton')).toHaveLength(2);
    const input = within(region).getByRole('spinbutton', { name: /Smurfing min tx count/ });
    await userEvent.clear(input);
    await userEvent.type(input, '2.5');
    expect(within(region).getByRole('alert')).toHaveTextContent('whole number');
    await userEvent.clear(input);
    await userEvent.type(input, '60');
    expect(within(region).getByRole('alert')).toHaveTextContent('At most 50');
    await userEvent.clear(input);
    await userEvent.type(input, '6');
    await userEvent.click(within(region).getByRole('button', { name: 'Save 1 changed' }));
    expect(posts()).toEqual([['/rule-thresholds', { smurfing_min_tx_count: 6, version_id: 12, domain: 'bank' }]]);
  });

  it('a newer version keeps the edits, shows theirs, and the next save goes on it', async () => {
    let saves = 0;
    const { posts, notify } = renderPanel({
      thresholds: answer(),
      post: () => {
        saves += 1;
        if (saves === 1) throw refuse(409, { code: 'version_conflict', current: answer({ version_id: 13, updated_by: 'boss', config: { smurfing_min_tx_count: 5, own_key: 7 } }).results });
        return { message: 'success', state: {} };
      },
    });
    const region = await screen.findByRole('region', { name: 'Rule thresholds' });
    const input = within(region).getByRole('spinbutton', { name: /Smurfing min tx count/ });
    await userEvent.clear(input);
    await userEvent.type(input, '6');
    await userEvent.click(within(region).getByRole('button', { name: 'Save 1 changed' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Not saved: changed meanwhile', message: expect.stringContaining('boss') })));
    expect(within(region).getByRole('spinbutton', { name: /Own key/ })).toHaveValue(7);
    expect(input).toHaveValue(6);
    await userEvent.click(within(region).getByRole('button', { name: 'Save 1 changed' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[1][1]).toEqual({ smurfing_min_tx_count: 6, version_id: 13, domain: 'bank' });
  });

  it('an open domain takes a new numeric key', async () => {
    const { posts } = renderPanel({ thresholds: { results: { config: {}, version_id: null, closed: false, keys: {} } }, props: { activeDomain: 'insurance' } });
    const region = await screen.findByRole('region', { name: 'Rule thresholds' });
    expect(within(region).queryByRole('spinbutton')).toBeNull();
    await userEvent.type(within(region).getByLabelText('New threshold name'), 'claim_min_amount');
    await userEvent.click(within(region).getByRole('button', { name: 'Add threshold' }));
    await userEvent.type(within(region).getByRole('spinbutton', { name: /Claim min amount/ }), '100');
    await userEvent.click(within(region).getByRole('button', { name: 'Save 1 changed' }));
    // null: only if nothing was saved yet.
    expect(posts()).toEqual([['/rule-thresholds', { claim_min_amount: 100, version_id: null, domain: 'insurance' }]]);
  });

  it('reads them again when someone else changed them', async () => {
    const { gets } = renderPanel({ thresholds: answer() });
    await screen.findByRole('region', { name: 'Rule thresholds' });
    const before = gets('/rule-thresholds?');
    act(() => { noteDomainChange({ domain: 'bank', section: 'sensitivity', version_id: 99 }); });
    await waitFor(() => expect(gets('/rule-thresholds?')).toBe(before + 1));
    act(() => { noteDomainChange({ domain: 'insurance', section: 'thresholds', version_id: 99 }); });
    expect(gets('/rule-thresholds?')).toBe(before + 1);
  });
});

describe('Domains · Sensitivity', () => {
  it('asks the Service what a preset changes before applying it', async () => {
    const { posts, requestConfirmation } = renderPanel({ post: (url, body) => (body.dry_run ? { message: 'success', changed: { smurfing_min_tx_count: [3, 2] } } : { message: 'success', state: { ...SENSITIVITY, preset: 'strict', version_id: 6 } }) });
    const region = await open('Sensitivity', 'Sensitivity');
    await userEvent.click(within(region).getByRole('button', { name: 'Apply strict' }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(requestConfirmation.mock.calls[0][0].message).toContain('Smurfing min tx count: 3 → 2');
    expect(posts()).toEqual([
      ['/domain-config', { domain: 'bank', section: 'sensitivity', preset: 'strict', dry_run: true }],
      ['/domain-config', { domain: 'bank', section: 'sensitivity', preset: 'strict', version_id: 5 }],
    ]);
  });

  it('never sends a dry run to a Service that would apply it', async () => {
    const { version_id: _version, ...older } = SENSITIVITY;
    const { posts, requestConfirmation } = renderPanel({ sections: { sensitivity: older } });
    requestConfirmation.mockResolvedValue(false);
    const region = await open('Sensitivity', 'Sensitivity');
    await userEvent.click(within(region).getByRole('button', { name: 'Apply strict' }));
    expect(requestConfirmation.mock.calls[0][0].message).toContain('Smurfing min tx count: 3 → 2');
    expect(posts()).toEqual([]);
  });

  it('says when the Service does not offer it', async () => {
    renderPanel({ sections: { sensitivity: refuse(404, { message: 'feature_disabled' }) } });
    expect(await open('Sensitivity', 'Sensitivity')).toHaveTextContent('does not offer this');
  });
});

describe('Domains · Columns', () => {
  it('shows origins and the profile, saves only the edited list with its version', async () => {
    const { posts, requestConfirmation } = renderPanel();
    const region = await open('Columns', 'Columns');
    expect(within(region).getByText('Admin')).toBeInTheDocument();
    const input = within(region).getByRole('textbox', { name: 'Fetch columns' });
    await userEvent.type(input, ', C D');
    expect(within(region).getByRole('alert')).toHaveTextContent('“C D”');
    expect(within(region).getByRole('button', { name: 'Save columns' })).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, 'A, B, FEE, fee');
    await userEvent.click(within(region).getByRole('button', { name: 'Save columns' }));
    expect(requestConfirmation.mock.calls[0][0].message).toContain('Fetch columns: added FEE');
    expect(posts()).toEqual([['/domain-config', { domain: 'bank', section: 'columns', columns: { fetch_columns: ['A', 'B', 'FEE'] }, version_id: 4 }]]);
  });

  it('resets one list to the profile', async () => {
    const { posts } = renderPanel();
    const region = await open('Columns', 'Columns');
    await userEvent.click(within(region).getAllByRole('button', { name: 'Reset to profile' })[1]);
    expect(posts()).toEqual([['/domain-config/reset', { domain: 'bank', section: 'columns', keys: ['fetch_columns'], version_id: 4 }]]);
  });

  it('a newer version: theirs beside the edits, nothing overwritten', async () => {
    const { notify } = renderPanel({ post: () => { throw refuse(409, { code: 'version_conflict', current: { ...COLUMNS, version_id: 8, columns: { ...COLUMNS.columns, fetch_columns: ['A', 'Z'] } } }); }, sections: {} });
    const region = await open('Columns', 'Columns');
    await userEvent.type(within(region).getByRole('textbox', { name: 'Fetch columns' }), ', FEE');
    await userEvent.click(within(region).getByRole('button', { name: 'Save columns' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'Not saved: changed meanwhile' })));
    expect(within(region).getByRole('textbox', { name: 'Fetch columns' })).toHaveValue('A, B, FEE');
  });

  it('is read-only without users:manage', async () => {
    renderPanel({ props: { canManage: false } });
    const region = await open('Columns', 'Columns');
    expect(within(region).getByRole('textbox', { name: 'Fetch columns' })).toHaveAttribute('readonly');
    expect(within(region).queryByRole('button')).toBeNull();
  });
});

describe('Domains · Column mapping', () => {
  it('saves changed rows only, and says when a required field loses its last source', async () => {
    const { posts, requestConfirmation, notify } = renderPanel({ post: () => ({ message: 'success', state: { ...MAPPING, version_id: 10 }, warnings: [['ACCOUNTNO']] }) });
    const region = await open('Column mapping', 'Column mapping');
    await userEvent.click(within(region).getByRole('button', { name: 'Remove ACC' }));
    expect(within(region).getByRole('alert')).toHaveTextContent('ACCOUNTNO');
    await userEvent.type(within(region).getByLabelText('New source column'), 'BR');
    await userEvent.selectOptions(within(region).getByLabelText('New field'), 'BRANCH');
    await userEvent.click(within(region).getByRole('button', { name: 'Add row' }));
    await userEvent.click(within(region).getByRole('button', { name: 'Save 2 changed' }));
    expect(requestConfirmation.mock.calls[0][0].message).toContain('Nothing would be mapped to ACCOUNTNO');
    expect(requestConfirmation.mock.calls[0][0].message).toContain('ACC: ACCOUNTNO → not mapped');
    expect(posts()).toEqual([['/domain-config', { domain: 'bank', section: 'mapping', column_mapping: { ACC: null, BR: 'BRANCH' }, version_id: 9 }]]);
    await waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ message: 'Nothing is mapped to ACCOUNTNO any more.' })));
  });

  it('takes a row back to the profile, and refuses a source that is there already', async () => {
    const { posts } = renderPanel();
    const region = await open('Column mapping', 'Column mapping');
    await userEvent.type(within(region).getByLabelText('New source column'), 'acc');
    expect(within(region).getByRole('alert')).toHaveTextContent('already');
    await userEvent.click(within(region).getByRole('button', { name: 'Back to profile: AMT' }));
    expect(within(region).getByLabelText('Field for AMT')).toHaveValue('AMOUNTINBIRR');
    await userEvent.click(within(region).getByRole('button', { name: 'Save 1 changed' }));
    expect(posts()).toEqual([['/domain-config', { domain: 'bank', section: 'mapping', column_mapping: { AMT: '__inherit__' }, version_id: 9 }]]);
  });

  it('keeps unsaved rows across tabs and marks the tab', async () => {
    renderPanel();
    const region = await open('Column mapping', 'Column mapping');
    await userEvent.click(within(region).getByRole('button', { name: 'Remove ACC' }));
    expect(screen.getByRole('tab', { name: /Column mapping/ })).toHaveTextContent('unsaved');
    await userEvent.click(screen.getByRole('tab', { name: /^Thresholds/ }));
    const again = await open('Column mapping', 'Column mapping');
    expect(within(again).getByRole('button', { name: 'Undo ACC' })).toBeInTheDocument();
  });
});
