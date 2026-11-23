// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { BUILTIN_CATEGORIES, BUILTIN_SET, createIconSet, forgetIconSets, getIconSets } from '../../graph/lib/iconSets.js';
import IconSetsPanel from './IconSetsPanel.jsx';

afterEach(() => {
  cleanup();
  localStorage.clear();
  forgetIconSets();
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const renderPanel = () => {
  const onNotice = vi.fn();
  render(<div className="settings_window_workspace"><IconSetsPanel onNotice={onNotice} /></div>);
  return { onNotice };
};
const pngFile = (name) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

describe('Libraries · Icon sets', () => {
  it('shows the built-in set by category, read-only', async () => {
    renderPanel();
    expect(screen.getByRole('heading', { name: 'Node icons' })).toBeInTheDocument();
    expect(screen.getByText('Built-in only')).toBeInTheDocument();
    const grid = screen.getByRole('list', { name: 'LinkX Standard icons' });
    expect(within(grid).getAllByRole('listitem')).toHaveLength(BUILTIN_SET.icons.length);
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Category' })).getByRole('radio', { name: /People/ }));
    expect(within(grid).getAllByRole('listitem')).toHaveLength(BUILTIN_CATEGORIES.find((category) => category.id === 'people').icons.length);
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find an icon' }), 'female');
    expect(within(grid).getAllByRole('listitem')).toHaveLength(2);
    // Nothing to add to, export or delete.
    expect(screen.queryByRole('button', { name: 'Add icons' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete set' })).not.toBeInTheDocument();
    // It can be left out of the Graph window's icon album.
    await userEvent.click(screen.getByRole('switch', { name: 'Offer LinkX Standard in the icon album' }));
    expect(getIconSets().builtinEnabled).toBe(false);
  });

  it('makes a set by upload: named, images checked, then kept', async () => {
    const { onNotice } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: 'New set' }));
    const popup = screen.getByRole('dialog', { name: 'New icon set' });
    const create = () => within(popup).getByRole('button', { name: /^Create/ });
    expect(create()).toBeDisabled(); // a set needs a name
    await userEvent.type(within(popup).getByLabelText('Set name'), 'Telecom');
    expect(create()).toHaveTextContent('Create empty set');
    await userEvent.upload(within(popup).getByLabelText('Icon images'), [pngFile('Tower.png'), new File(['x'], 'notes.txt', { type: 'text/plain' })], { applyAccept: false });
    const chosen = await within(popup).findByRole('list', { name: 'Chosen images' });
    expect(within(chosen).getAllByRole('listitem')).toHaveLength(2);
    expect(chosen).toHaveTextContent('Not an SVG, PNG, JPEG or WebP image.');
    // A good image can be renamed before it is kept.
    const name = within(chosen).getByLabelText('Name of Tower');
    await userEvent.clear(name);
    await userEvent.type(name, 'Mast');
    await userEvent.click(create());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getIconSets().sets[0]).toMatchObject({ name: 'Telecom', enabled: true });
    expect(getIconSets().sets[0].icons.map((icon) => icon.name)).toEqual(['Mast']);
    expect(onNotice).toHaveBeenCalledWith(expect.objectContaining({ title: 'Icon set created' }));
    // The new set is open.
    expect(screen.getByRole('list', { name: 'Telecom icons' })).toBeInTheDocument();
    expect(screen.getByText('1 custom set')).toBeInTheDocument();
  });

  it('manages a custom set: rename an icon, remove it, then delete the set in two clicks', async () => {
    createIconSet({ name: 'Customs', icons: [{ name: 'Gate', src: PNG }, { name: 'Scanner', src: PNG }] });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /Customs/ }));
    const grid = screen.getByRole('list', { name: 'Customs icons' });
    await userEvent.click(within(grid).getByRole('button', { name: 'Gate' }));
    const editor = screen.getByRole('group', { name: 'Icon Gate' });
    // Saved on Enter (or on leaving the field), so spaces can be typed.
    await userEvent.type(within(editor).getByLabelText('Icon name'), ' A{Enter}');
    expect(getIconSets().sets[0].icons[0].name).toBe('Gate A');
    await userEvent.click(within(screen.getByRole('group', { name: 'Icon Gate A' })).getByRole('button', { name: 'Remove icon' }));
    expect(getIconSets().sets[0].icons.map((icon) => icon.name)).toEqual(['Scanner']);

    await userEvent.click(screen.getByRole('button', { name: 'Delete set' }));
    expect(getIconSets().sets).toHaveLength(1); // armed, not deleted yet
    await userEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    await waitFor(() => expect(getIconSets().sets).toHaveLength(0));
    expect(screen.getByRole('list', { name: 'LinkX Standard icons' })).toBeInTheDocument();
  });

  it('adds icons to an existing set', async () => {
    createIconSet({ name: 'Customs', icons: [{ name: 'Gate', src: PNG }] });
    renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /Customs/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add icons' }));
    const popup = screen.getByRole('dialog', { name: 'Add icons to Customs' });
    expect(within(popup).getByRole('button', { name: /^Add 0 icons/ })).toBeDisabled();
    await userEvent.upload(within(popup).getByLabelText('Icon images'), [pngFile('Scanner.png')], { applyAccept: false });
    await userEvent.click(await within(popup).findByRole('button', { name: 'Add 1 icon' }));
    expect(getIconSets().sets[0].icons.map((icon) => icon.name)).toEqual(['Gate', 'Scanner']);
  });
});
