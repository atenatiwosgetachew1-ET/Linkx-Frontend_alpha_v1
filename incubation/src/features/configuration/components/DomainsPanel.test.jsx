// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import DomainsPanel from './DomainsPanel.jsx';
import { clearConfigurationDrafts } from '../lib/configDraft.js';
import { otherThresholds, readThresholds, thresholdProblem } from '../lib/domainDrafts.js';

afterEach(() => {
  cleanup();
  clearConfigurationDrafts();
});

const DOMAINS = ['bank', 'microfinance', 'cdr'];
const renderPanel = (props = {}, { config = {}, lineage = {}, post } = {}) => {
  const apiFetch = vi.fn(async (url, options) => {
    if (options?.method === 'POST') return post ? post(url, options.body) : { message: 'success' };
    if (String(url).includes('history')) return { results: [{ version_id: 7, updated_by: 'boss', created_at: '2026-11-20T10:00:00Z', config: {} }] };
    return { results: { config: String(url).includes('lineage') ? lineage : config } };
  });
  const requestConfirmation = vi.fn(async () => true);
  const notify = vi.fn();
  const element = (more = {}) => <DomainsPanel windowId="c1" apiFetch={apiFetch} domains={DOMAINS} activeDomain="bank" canManage notify={notify} requestConfirmation={requestConfirmation} {...props} {...more} />;
  const utils = render(element());
  const posts = () => apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST').map(([url, options]) => [url, options.body]);
  return { ...utils, apiFetch, requestConfirmation, notify, posts, again: (more) => utils.rerender(element(more)) };
};
const thresholds = () => screen.findByRole('region', { name: 'Rule thresholds' });
const openLineage = async () => {
  await userEvent.click(screen.getByRole('tab', { name: /Score lineage/ }));
  return screen.findByRole('region', { name: 'Score lineage' });
};
const field = (region, name) => within(region).getByRole('spinbutton', { name });
const type = async (input, value) => {
  await userEvent.clear(input);
  await userEvent.type(input, value);
};

describe('Configuration · Domains', () => {
  it('opens on the session’s domain, its thresholds first, with both parts’ figures', async () => {
    renderPanel();
    expect(screen.getByRole('radio', { name: /Banking/ })).toBeChecked();
    expect(screen.getByRole('heading', { name: 'Banking' })).toBeInTheDocument();
    const region = await thresholds();
    expect(within(region).getAllByRole('spinbutton').length).toBeGreaterThan(3);
    expect(within(region).getByRole('button', { name: 'Save thresholds' })).toBeDisabled();
    const figures = screen.getByLabelText('Domain figures');
    expect(await within(figures).findByText('v7')).toBeInTheDocument();
    expect(figures).toHaveTextContent('by boss');
    expect(screen.getByRole('table', { name: 'Threshold history' })).toHaveTextContent('v7');
    const lineage = await openLineage();
    expect(within(lineage).getAllByRole('slider').length).toBeGreaterThan(1);
    expect(within(lineage).getByRole('button', { name: 'Save new version' })).toBeDisabled();
  });

  it('asks first, then saves only what was changed, to the domain shown', async () => {
    const { apiFetch, posts, requestConfirmation } = renderPanel({}, { config: { smurfing_min_tx_count: 4, late_night_min_amount: 900 } });
    await userEvent.click(screen.getByRole('radio', { name: 'Microfinance' }));
    const region = await thresholds();
    expect(apiFetch.mock.calls.some(([url]) => url === '/rule-thresholds?domain=microfinance')).toBe(true);
    await type(field(region, /Smurfing min tx count/), '6');
    await userEvent.click(within(region).getByRole('button', { name: 'Save 1 changed' }));
    expect(requestConfirmation.mock.calls[0][0].title).toBe('Change Microfinance thresholds?');
    expect(requestConfirmation.mock.calls[0][0].message).toContain('Smurfing min tx count: 4 → 6');
    expect(posts()).toEqual([['/rule-thresholds', { smurfing_min_tx_count: 6, domain: 'microfinance' }]]);
  });

  it('saves nothing when not confirmed', async () => {
    const { posts, requestConfirmation } = renderPanel({}, { config: { smurfing_min_tx_count: 4 } });
    requestConfirmation.mockResolvedValue(false);
    const region = await thresholds();
    await type(field(region, /Smurfing min tx count/), '6');
    await userEvent.click(within(region).getByRole('button', { name: 'Save 1 changed' }));
    expect(posts()).toEqual([]);
    expect(field(region, /Smurfing min tx count/)).toHaveValue(6);
  });

  it('an empty or out-of-range value is not saved, and never becomes the default', async () => {
    renderPanel({}, { config: { smurfing_min_tx_count: 4 } });
    const region = await thresholds();
    await userEvent.clear(field(region, /Smurfing min tx count/));
    expect(within(region).getByRole('alert')).toHaveTextContent('Enter a number.');
    expect(within(region).getByRole('button', { name: 'Save 1 changed' })).toBeDisabled();
    await userEvent.type(field(region, /Smurfing min tx count/), '1');
    expect(within(region).getByRole('alert')).toHaveTextContent('At least 2.');
    await userEvent.click(within(region).getByRole('button', { name: 'Discard changes' }));
    expect(field(region, /Smurfing min tx count/)).toHaveValue(4);
  });

  it('shows the Service’s reason beside the field it refused', async () => {
    renderPanel({}, { config: { smurfing_min_tx_count: 4 }, post: () => { throw Object.assign(new Error('Bad request'), { status: 400, data: { errors: [{ field: 'smurfing_min_tx_count', message: 'Not for this domain.' }] } }); } });
    const region = await thresholds();
    await type(field(region, /Smurfing min tx count/), '6');
    await userEvent.click(within(region).getByRole('button', { name: 'Save 1 changed' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent('Not for this domain.');
  });

  it('keeps unsaved edits across domains, parts and a closed page, and says so', async () => {
    const { unmount } = renderPanel({}, { config: { smurfing_min_tx_count: 4 } });
    await type(field(await thresholds(), /Smurfing min tx count/), '6');
    expect(screen.getByRole('tab', { name: /Thresholds/ })).toHaveTextContent('unsaved');
    await userEvent.click(screen.getByRole('radio', { name: /Call Data/ }));
    await thresholds();
    expect(screen.getByRole('radio', { name: /Banking/ })).toHaveTextContent('unsaved');
    await userEvent.click(screen.getByRole('radio', { name: /Banking/ }));
    expect(field(await thresholds(), /Smurfing min tx count/)).toHaveValue(6);
    unmount();
    renderPanel({}, { config: { smurfing_min_tx_count: 4 } });
    expect(field(await thresholds(), /Smurfing min tx count/)).toHaveValue(6);
  });

  it('follows the session’s domain until one is picked or edited', async () => {
    const { again } = renderPanel();
    await thresholds();
    again({ activeDomain: 'cdr' });
    expect(screen.getByRole('heading', { name: /Call Data/ })).toBeInTheDocument();
    await type(field(await thresholds(), /Min frequent call count/), '9');
    again({ activeDomain: 'bank' });
    expect(screen.getByRole('heading', { name: /Call Data/ })).toBeInTheDocument();
  });

  it('shows the thresholds it has no field for, read-only, and marks those not sent', async () => {
    const { posts } = renderPanel({}, { config: { smurfing_min_tx_count: 4, claim_min_amount: 70, version_id: 12 } });
    const region = await thresholds();
    expect(region).toHaveTextContent('claim_min_amount');
    expect(region).not.toHaveTextContent('version_id');
    expect(field(region, /Smurfing single tx threshold/).closest('label')).toHaveTextContent('default');
    expect(field(region, /Smurfing min tx count/).closest('label')).not.toHaveTextContent('default');
    expect(posts()).toEqual([]);
  });

  it('adds and removes a score tier, and saves the typologies it has no slider for', async () => {
    const { posts, requestConfirmation } = renderPanel({}, { lineage: { domain_id: 'bank', base_scores: { SMURFING: 20, CLAIM_FRAUD: 45 } } });
    await thresholds();
    const lineage = await openLineage();
    const before = within(lineage).getAllByRole('button', { name: 'Remove threshold' }).length;
    await userEvent.click(within(lineage).getAllByRole('button', { name: '+ Add threshold' })[0]);
    expect(within(lineage).getAllByRole('button', { name: 'Remove threshold' })).toHaveLength(before + 1);
    await userEvent.click(within(lineage).getByRole('button', { name: 'Save new version' }));
    expect(requestConfirmation.mock.calls[0][0].message).toContain('node count tiers');
    const [[url, body]] = posts();
    expect(url).toBe('/config/score-lineage');
    expect(body).toMatchObject({ domain: 'bank', domain_id: 'bank' });
    expect(body.base_scores).toMatchObject({ SMURFING: 20, CLAIM_FRAUD: 45 });
    await waitFor(() => expect(screen.getByRole('tab', { name: /Score lineage/ })).not.toHaveTextContent('unsaved'));
  });

  it('says when another version was saved since the kept edits began', async () => {
    const first = renderPanel({}, { lineage: { domain_id: 'bank', node_thresholds: [{ min_nodes: 10, add_points: 5 }] } });
    await thresholds();
    await userEvent.click(within(await openLineage()).getAllByRole('button', { name: '+ Add threshold' })[0]);
    first.unmount();
    const second = renderPanel({}, { lineage: { domain_id: 'bank', node_thresholds: [{ min_nodes: 99, add_points: 5 }] } });
    const lineage = await screen.findByRole('region', { name: 'Score lineage' });
    expect(within(lineage).getByRole('alert')).toHaveTextContent('another version');
    await userEvent.click(within(lineage).getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByDisplayValue('99')).toBeInTheDocument();
    expect(second.posts()).toEqual([]);
  });

  it('is read-only without users:manage', async () => {
    renderPanel({ canManage: false });
    const region = await thresholds();
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(within(region).queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
    within(region).getAllByRole('spinbutton').forEach((input) => expect(input).toBeDisabled());
    expect(screen.queryByRole('table', { name: 'Threshold history' })).not.toBeInTheDocument();
  });

  it('cannot be edited while the saved values are unknown', async () => {
    const apiFetch = vi.fn(async () => { throw new Error('Down.'); });
    render(<DomainsPanel windowId="c2" apiFetch={apiFetch} domains={DOMAINS} activeDomain="bank" canManage notify={vi.fn()} requestConfirmation={vi.fn()} />);
    expect(within(await thresholds()).getByRole('alert')).toHaveTextContent('cannot be edited or saved');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });
});

describe('reading thresholds', () => {
  it('never assumes a value that is missing or unreadable', () => {
    const defaults = { a: 1, b: 2, c: true, d: false, e: 5 };
    expect(readThresholds({ a: '7', b: null, c: 'false', d: 'x', e: '' }, defaults)).toEqual({ a: 7, c: false });
    expect(otherThresholds({ a: 1, z: 3, y: 'text', domain_id: 4 }, defaults)).toEqual([['z', 3]]);
  });

  it('checks a typed value', () => {
    expect(thresholdProblem('', {})).not.toBe('');
    expect(thresholdProblem(5, { min: 1, max: 5 })).toBe('');
    expect(thresholdProblem(true)).toBe('');
  });
});
