// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { forgetGraphDefaults, getGraphDefaults, isBuiltinGraphDefaults } from '../../graph/lib/graphDefaults.js';
import { getOverlayPrefs, resetOverlayPrefsCache } from '../../graph/lib/overlayPrefs.js';
import GraphDefaultsPanel from './GraphDefaultsPanel.jsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  forgetGraphDefaults();
  resetOverlayPrefsCache();
});

describe('Libraries · Graph defaults', () => {
  it('shows the built-in defaults: 25 nodes, concentric, performance mode on', () => {
    render(<GraphDefaultsPanel />);
    expect(screen.getByRole('heading', { name: 'Graph window defaults' })).toBeInTheDocument();
    expect(screen.getByText('Built-in defaults')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset to built-in' })).toBeDisabled();
    expect(screen.getByLabelText('Nodes shown first')).toHaveValue(25);
    expect(within(screen.getByRole('radiogroup', { name: 'Layout' })).getByRole('radio', { name: 'Concentric' })).toBeChecked();
    expect(screen.getByRole('switch', { name: /Performance mode/ })).toBeChecked();
    // Performance mode keeps the rest off.
    expect(screen.getByRole('switch', { name: /Show labels/ })).toBeDisabled();
    expect(screen.queryByRole('radiogroup', { name: 'Direction' })).not.toBeInTheDocument();
  });

  it('tunes the first view, the drawing and the helpers, then resets', async () => {
    render(<GraphDefaultsPanel />);
    const count = screen.getByLabelText('Nodes shown first');
    await userEvent.clear(count);
    await userEvent.type(count, '120{Enter}');
    await userEvent.click(screen.getByRole('radio', { name: 'Hierarchical' }));
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Direction' })).getByRole('radio', { name: 'Left to right' }));
    await userEvent.click(screen.getByRole('switch', { name: /Performance mode/ }));
    await userEvent.click(screen.getByRole('switch', { name: /Show labels/ }));
    await userEvent.click(screen.getByRole('switch', { name: /Edge bundling/ }));
    expect(screen.getByLabelText('Smallest bundle')).toHaveValue(2);
    expect(getGraphDefaults()).toMatchObject({
      limit: { min: 0, max: 120 },
      layout: { type: 'hierarchical', direction: 'LR' },
      performance: false,
      showLabels: true,
      edgeBundling: true,
    });
    expect(screen.getByText('Customised')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reset to built-in' }));
    expect(isBuiltinGraphDefaults(getGraphDefaults())).toBe(true);
    expect(screen.getByLabelText('Nodes shown first')).toHaveValue(25);
  });

  it('turns the on-graph components on and off for every Graph window', async () => {
    render(<GraphDefaultsPanel />);
    const components = screen.getByRole('group', { name: 'On-graph components' });
    const minimap = within(components).getByRole('switch', { name: /Minimap/ });
    expect(minimap).toBeChecked();
    await userEvent.click(minimap);
    expect(getOverlayPrefs().minimap).toBe(false);
    expect(screen.getByLabelText('Graph default figures')).toHaveTextContent('of 6 shown');
  });
});
