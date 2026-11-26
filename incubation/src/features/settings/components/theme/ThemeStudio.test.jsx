// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { ThemeProvider } from '../../../../shared/theme/ThemeContext.jsx';
import { LiveThemeCustomizerStudio } from './ThemeStudio.jsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.removeAttribute('style');
});

const renderStudio = () => render(<ThemeProvider><LiveThemeCustomizerStudio /></ThemeProvider>);
const pane = () => screen.getByRole('region', { name: 'Settings to change' });
const rows = () => pane().querySelectorAll('.theme_studio_token_row');
// A part is chosen from its area's menu.
const openPart = async (area, part) => {
  const nav = screen.getByRole('navigation', { name: 'Parts of the app' });
  const menu = within(nav).getByRole('group', { name: area });
  await userEvent.click(within(menu).getByRole('button', { name: new RegExp(`^${area}`) }));
  await userEvent.click(within(menu).getByRole('button', { name: part }));
};

describe('Theme Studio', () => {
  it('lays the parts of the app out by area, and opens one at a time', async () => {
    renderStudio();
    const nav = screen.getByRole('navigation', { name: 'Parts of the app' });
    expect(within(nav).getAllByRole('group').map((group) => group.getAttribute('aria-label'))).toEqual(['Workspace', 'Windows', 'Settings window', 'Notices & tooltips']);

    // The first part is open, its groups of settings all closed.
    expect(within(pane()).getByRole('heading', { name: 'Background & Central Workspace' })).toBeInTheDocument();
    const firstGroup = within(pane()).getByRole('button', { name: /Page Background/ });
    expect(firstGroup).toHaveAttribute('aria-expanded', 'false');
    expect(rows()).toHaveLength(0);
    await userEvent.click(firstGroup);
    expect(rows()).toHaveLength(3);
    // Another group opens beside it; the first closes on a click.
    await userEvent.click(within(pane()).getByRole('button', { name: /Background Overlay Gradient/ }));
    expect(rows()).toHaveLength(8);
    await userEvent.click(firstGroup);
    expect(rows()).toHaveLength(5);

    // A short part has no groups: its settings as one list.
    // The menus are closed until asked for; choosing a part closes its menu.
    expect(within(nav).queryByRole('button', { name: 'Notification Popups' })).not.toBeInTheDocument();
    await openPart('Notices & tooltips', 'Notification Popups');
    expect(within(nav).queryByRole('button', { name: 'Notification Popups' })).not.toBeInTheDocument();
    expect(within(pane()).getByRole('heading', { name: 'Notification Popups' })).toBeInTheDocument();
    expect(within(pane()).queryByRole('button', { expanded: true })).not.toBeInTheDocument();
    expect(rows()).toHaveLength(14);
  });

  it('searches every part at once, and opens a part from its results', async () => {
    renderStudio();
    const nav = screen.getByRole('navigation', { name: 'Parts of the app' });
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search all settings' }), '--tasks-bg');
    expect(within(pane()).getByRole('heading', { name: 'Results for “--tasks-bg”' })).toBeInTheDocument();
    expect(rows()).toHaveLength(1);
    await userEvent.click(within(pane()).getByRole('button', { name: 'Tasks Window' }));
    expect(screen.getByRole('searchbox', { name: 'Search all settings' })).toHaveValue('');
    expect(within(pane()).getByRole('heading', { name: 'Tasks Window' })).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole('button', { name: /^Windows/ }));
    expect(within(nav).getByRole('button', { name: 'Tasks Window' })).toHaveAttribute('aria-current', 'true');
    await userEvent.keyboard('{Escape}');
    expect(within(nav).queryByRole('button', { name: 'Tasks Window' })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole('searchbox', { name: 'Search all settings' }), 'zzzz-nothing');
    expect(pane()).toHaveTextContent('Nothing is called “zzzz-nothing”.');
  });

  it('counts the changes, lists them, and resets them only after a confirmation', async () => {
    renderStudio();
    const studio = screen.getByRole('region', { name: 'Theme Studio' });
    expect(studio).toHaveTextContent('No changes yet');
    expect(screen.getByRole('button', { name: /Reset all changes/ })).toBeDisabled();

    await openPart('Notices & tooltips', 'Global Tooltips & Badges');
    const text = pane().querySelector('.theme_studio_token_row input[type="text"]');
    await userEvent.clear(text);
    await userEvent.type(text, '#123456');
    expect(studio).toHaveTextContent('1 change');
    expect(pane()).toHaveTextContent('1 changed');

    await userEvent.click(screen.getByRole('button', { name: /Your changes/ }));
    expect(rows()).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /Reset all changes/ }));
    const confirm = screen.getByRole('group', { name: 'Confirm reset' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Keep them' }));
    expect(studio).toHaveTextContent('1 change');
    await userEvent.click(screen.getByRole('button', { name: /Reset all changes/ }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Confirm reset' })).getByRole('button', { name: 'Yes, reset' }));
    expect(studio).toHaveTextContent('No changes yet');
    expect(pane()).toHaveTextContent('Nothing changed yet.');
  });

  it('keeps the import box closed until it is asked for', async () => {
    renderStudio();
    expect(screen.queryByRole('textbox', { name: 'Theme configuration JSON' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Import/ }));
    const box = screen.getByRole('textbox', { name: 'Theme configuration JSON' });
    await userEvent.click(box);
    await userEvent.paste('{"theme":"nbe-daylight","customOverrides":{"--app-bg":"#010203"}}');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('status')).toHaveTextContent('Theme configuration imported.');
    expect(screen.getByRole('region', { name: 'Theme Studio' })).toHaveTextContent('1 change');
    expect(screen.queryByRole('textbox', { name: 'Theme configuration JSON' })).not.toBeInTheDocument();
  });
});
