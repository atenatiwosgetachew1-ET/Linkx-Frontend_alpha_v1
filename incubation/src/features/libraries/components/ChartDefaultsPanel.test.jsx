// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { builtinAutoMetrics, forgetChartDefaults, getChartDefaults } from '../../chart/lib/chartDefaults.js';
import ChartDefaultsPanel from './ChartDefaultsPanel.jsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  forgetChartDefaults();
});

describe('Libraries · Charts (Chart window defaults)', () => {
  it('shows the built-in defaults and nothing to reset', () => {
    render(<ChartDefaultsPanel />);
    expect(screen.getByRole('heading', { name: 'Chart window defaults' })).toBeInTheDocument();
    expect(screen.getByText('Built-in defaults')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to built-in' })).toBeDisabled();
    expect(within(screen.getByRole('radiogroup', { name: 'Scope' })).getByRole('radio', { name: 'Drawn' })).toBeChecked();
    expect(within(screen.getByRole('radiogroup', { name: 'Generation' })).getByRole('radio', { name: 'Automatic' })).toBeChecked();
    const global = screen.getByRole('group', { name: 'Global-Level Charts' });
    expect(within(global).getAllByRole('button', { pressed: true })).toHaveLength(builtinAutoMetrics().length);
    expect(within(screen.getByRole('group', { name: 'Node-Level Charts' })).queryByRole('button', { pressed: true })).not.toBeInTheDocument();
  });

  it('tunes the scope, the starting charts and the colours, then resets', async () => {
    render(<ChartDefaultsPanel />);
    await userEvent.click(screen.getByRole('radio', { name: 'All' }));
    await userEvent.click(screen.getByRole('button', { name: 'PageRank' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Global-Level Charts' })).getByRole('button', { name: 'Reciprocity' }));
    await userEvent.selectOptions(screen.getByLabelText(/Colour schema/), 'Ocean');
    await userEvent.click(screen.getByRole('switch', { name: /Follow selection/ }));
    const saved = getChartDefaults();
    expect(saved).toMatchObject({ scope: 'all', schema: 'Ocean', follow: false });
    expect(saved.autoMetrics).toContain('pagerank');
    expect(saved.autoMetrics).not.toContain('reciprocity');
    expect(screen.getByText('Customised')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(getChartDefaults().autoMetrics).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Reset to built-in' }));
    expect(getChartDefaults().scope).toBe('drawn');
    expect(getChartDefaults().autoMetrics).toEqual(builtinAutoMetrics());
    expect(screen.getByText('Built-in defaults')).toBeInTheDocument();
  });

  it('with Manual generation, no chart comes up by itself', async () => {
    render(<ChartDefaultsPanel />);
    await userEvent.click(screen.getByRole('radio', { name: 'Manual' }));
    expect(getChartDefaults().mode).toBe('manual');
    expect(screen.getByRole('button', { name: 'PageRank' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Global only' })).toBeDisabled();
    expect(screen.getByLabelText('Chart default figures')).toHaveTextContent('manual generation');
  });
});
