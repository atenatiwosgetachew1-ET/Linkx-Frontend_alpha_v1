// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { forgetTableDefaults, getTableDefaults, isBuiltinTableDefaults } from '../../table/lib/tableDefaults.js';
import TableDefaultsPanel from './TableDefaultsPanel.jsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  forgetTableDefaults();
});

describe('Libraries · Table defaults', () => {
  it('shows the built-in defaults and nothing to reset', () => {
    render(<TableDefaultsPanel />);
    expect(screen.getByRole('heading', { name: 'Table window defaults' })).toBeInTheDocument();
    expect(screen.getByText('Built-in defaults')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to built-in' })).toBeDisabled();
    expect(within(screen.getByRole('radiogroup', { name: 'Opens on' })).getByRole('radio', { name: 'Nodes' })).toBeChecked();
    expect(within(screen.getByRole('group', { name: 'Nodes columns' })).getAllByRole('button', { pressed: true })).toHaveLength(5);
    expect(screen.getByLabelText('Table default figures')).toHaveTextContent('of 10 shown');
    expect(within(screen.getByRole('radiogroup', { name: 'Nodes sort direction' })).getByRole('radio', { name: 'Ascending' })).toBeDisabled();
  });

  it('tunes the tab, the columns, the sorting and the printing, then resets', async () => {
    render(<TableDefaultsPanel />);
    await userEvent.click(screen.getByRole('radio', { name: 'Links' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Nodes columns' })).getByRole('button', { name: 'ID' }));
    await userEvent.selectOptions(screen.getByLabelText(/Sort nodes by/), '@degree');
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Nodes sort direction' })).getByRole('radio', { name: 'Descending' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Landscape' }));
    await userEvent.click(screen.getByRole('switch', { name: /Follow selection/ }));
    expect(getTableDefaults()).toMatchObject({
      tab: 'links',
      follow: false,
      hidden: { nodes: ['@id'], links: [] },
      sort: { nodes: { key: '@degree', dir: 'desc' }, links: null },
      print: { rows: 'shown', page: 'landscape' },
    });
    expect(screen.getByText('Customised')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset to built-in' }));
    expect(isBuiltinTableDefaults(getTableDefaults())).toBe(true);
  });

  it('never lets a tab hide its last built-in column', async () => {
    render(<TableDefaultsPanel />);
    const links = screen.getByRole('group', { name: 'Links columns' });
    for (const name of ['Label', 'From', 'To', 'Type']) {
      await userEvent.click(within(links).getByRole('button', { name }));
    }
    expect(within(links).getByRole('button', { name: 'Flags' })).toBeDisabled();
    expect(getTableDefaults().hidden.links).toHaveLength(4);
  });
});
