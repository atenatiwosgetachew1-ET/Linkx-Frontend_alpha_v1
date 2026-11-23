// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import WindowSwitcher from './WindowSwitcher.jsx';
import { createTask, resetTasks } from '../../features/tasks/lib/taskRegistry.js';

afterEach(() => {
  cleanup();
  resetTasks();
});

const WINDOWS = [
  { id: 'source-1', type: 'source', title: 'Source 1', customTitle: 'Placeholder', status: 'placeholder' },
  { id: 'graph-2', type: 'graph', title: 'Graph 2', customTitle: 'Bole branch', status: 'placeholder' },
  { id: 'table-3', type: 'table', title: 'Table 3', customTitle: 'Placeholder', status: 'placeholder' },
];

function Harness({ onClose = vi.fn() }) {
  const [windows, setWindows] = useState(WINDOWS);
  const [activeWindowId, setActive] = useState('table-3');
  const workspace = {
    windows,
    activeWindowId,
    focusWindow: setActive,
    closeWindow: (id) => { onClose(id); setWindows((current) => current.filter((item) => item.id !== id)); },
  };
  return (
    <>
      <output data-testid="active">{activeWindowId}</output>
      <WindowSwitcher workspace={workspace} fallbackIcon="M0 0" renderIcon={() => <svg />} />
    </>
  );
}

const rows = () => within(screen.getByRole('listbox', { name: 'Open windows' })).getAllByRole('option').map((row) => row.querySelector('strong').textContent);

describe('WindowSwitcher', () => {
  it('shows the count, lists windows most recent first, and goes back with one Enter', async () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: 'Switch window: 3 open' });
    expect(button).toHaveTextContent('3');
    await userEvent.click(button);
    expect(rows()[0]).toBe('Table 3');
    // The analyst's own title is the second line; "Placeholder" is not shown.
    expect(screen.getByText('Bole branch')).toBeInTheDocument();
    expect(screen.queryByText('Placeholder')).not.toBeInTheDocument();
    // The previous window is highlighted: Enter switches to it.
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('active')).toHaveTextContent(/^graph-2$/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    // Now Graph 2 is first and Table 3 second.
    await userEvent.click(button);
    expect(rows().slice(0, 2)).toEqual(['Graph 2', 'Table 3']);
  });

  it('searches, marks running windows, and closes without switching', async () => {
    createTask({ origin: 'source', windowId: 'source-1', title: 'Link analysis', status: 'running' });
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /Switch window/ }));
    const running = screen.getAllByRole('option').find((row) => row.textContent.includes('Source 1'));
    expect(running).toHaveTextContent('Running');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find a window' }), 'bole');
    expect(rows()).toEqual(['Graph 2']);
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Find a window' }));
    await userEvent.click(screen.getByRole('button', { name: 'Close Source 1' }));
    expect(onClose).toHaveBeenCalledWith('source-1');
    expect(screen.getByTestId('active')).toHaveTextContent('table-3');
    expect(rows()).not.toContain('Source 1');
  });

  it('cycles with Alt+` while Alt is held and switches on release', () => {
    render(<Harness />);
    act(() => { fireEvent.keyDown(window, { key: '`', code: 'Backquote', altKey: true }); });
    expect(screen.getByRole('dialog', { name: 'Switch window' })).toBeInTheDocument();
    act(() => { fireEvent.keyDown(window, { key: '`', code: 'Backquote', altKey: true }); });
    act(() => { fireEvent.keyUp(window, { key: 'Alt' }); });
    // Table 3 (current) -> Graph 2 -> Source 1.
    expect(screen.getByTestId('active')).toHaveTextContent('source-1');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('` alone switches at once, walks on press after press, and settles after a pause', () => {
    vi.useFakeTimers();
    try {
      render(<Harness />);
      const press = (extra = {}) => act(() => { fireEvent.keyDown(document.body, { key: '`', code: 'Backquote', ...extra }); });
      // Table 3 is current; the order is Table 3, Graph 2, Source 1.
      press();
      expect(screen.getByTestId('active')).toHaveTextContent(/^graph-2$/);
      expect(document.querySelector('.workspace_switcher_tag')).toHaveTextContent('Graph 2Bole branch2 / 3');
      press();
      expect(screen.getByTestId('active')).toHaveTextContent('source-1');
      // The walk stopped on Source 1: after the pause it is the most recent,
      // and the window before the walk (Table 3) is next.
      act(() => { vi.advanceTimersByTime(1100); });
      press();
      expect(screen.getByTestId('active')).toHaveTextContent('table-3');
      // Shift+` walks back.
      press({ shiftKey: true });
      expect(screen.getByTestId('active')).toHaveTextContent('source-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves ` alone while typing', () => {
    render(
      <>
        <input aria-label="Field" />
        <Harness />
      </>,
    );
    const field = screen.getByRole('textbox', { name: 'Field' });
    act(() => { fireEvent.keyDown(field, { key: '`', code: 'Backquote' }); });
    expect(screen.getByTestId('active')).toHaveTextContent('table-3');
  });
});
