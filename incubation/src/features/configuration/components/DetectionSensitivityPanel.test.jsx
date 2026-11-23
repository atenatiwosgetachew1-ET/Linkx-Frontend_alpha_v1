// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import DetectionSensitivityPanel from './DetectionSensitivityPanel.jsx';

afterEach(cleanup);

const renderPanel = (props = {}) => {
  const apiFetch = vi.fn(async (url) => (String(url).includes('history')
    ? { results: [{ version_id: 7, updated_by: 'boss', created_at: '2026-11-20T10:00:00Z', config: {} }] }
    : { results: { config: {} } }));
  render(<DetectionSensitivityPanel apiFetch={apiFetch} isCdr={false} canManage notify={vi.fn()} {...props} />);
  return { apiFetch };
};

describe('Configuration · Detection sensitivity', () => {
  it('shows both parts on one page, with their figures in the header', async () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Banking detection' })).toBeInTheDocument();
    const thresholds = await screen.findByRole('region', { name: 'Rule thresholds' });
    const lineage = await screen.findByRole('region', { name: 'Score lineage' });
    expect(within(thresholds).getByRole('button', { name: 'Save sensitivity settings' })).toBeEnabled();
    expect(within(lineage).getByRole('button', { name: 'Save new version' })).toBeEnabled();
    expect(within(thresholds).getAllByRole('spinbutton').length).toBeGreaterThan(3);
    expect(within(lineage).getAllByRole('slider').length).toBeGreaterThan(1);
    const figures = screen.getByLabelText('Sensitivity figures');
    expect(await within(figures).findByText('v7')).toBeInTheDocument();
    expect(figures).toHaveTextContent('by boss');
    expect(screen.getByRole('table', { name: 'Threshold history' })).toHaveTextContent('v7');
  });

  it('adds and removes a score tier', async () => {
    renderPanel();
    const lineage = await screen.findByRole('region', { name: 'Score lineage' });
    const before = within(lineage).getAllByRole('button', { name: 'Remove threshold' }).length;
    await userEvent.click(within(lineage).getAllByRole('button', { name: '+ Add threshold' })[0]);
    expect(within(lineage).getAllByRole('button', { name: 'Remove threshold' })).toHaveLength(before + 1);
    await userEvent.click(within(lineage).getAllByRole('button', { name: 'Remove threshold' })[0]);
    expect(within(lineage).getAllByRole('button', { name: 'Remove threshold' })).toHaveLength(before);
  });

  it('is read-only without users:manage', async () => {
    renderPanel({ canManage: false });
    const thresholds = await screen.findByRole('region', { name: 'Rule thresholds' });
    expect(screen.getByText('Read-only')).toBeInTheDocument();
    expect(within(thresholds).queryByRole('button', { name: 'Save sensitivity settings' })).not.toBeInTheDocument();
    within(thresholds).getAllByRole('spinbutton').forEach((input) => expect(input).toBeDisabled());
    expect(screen.queryByRole('table', { name: 'Threshold history' })).not.toBeInTheDocument();
  });
});
