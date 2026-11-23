// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import PermissionEditor from './PermissionEditor.jsx';
import { ALL_PERMISSIONS } from '../../../auth/permissions.js';
import { sanitizePermissionList } from '../../../utils/inputSecurity.js';

function Harness() {
  const [value, setValue] = useState([]);
  return (
    <>
      <PermissionEditor value={value} onChange={setValue} />
      <output data-testid="value">{value.join(',')}</output>
    </>
  );
}

afterEach(cleanup);

describe('PermissionEditor', () => {
  it('keeps the scope:action form of every permission', () => {
    expect(sanitizePermissionList(ALL_PERMISSIONS)).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('checks and unchecks a permission', async () => {
    render(<Harness />);
    const box = screen.getByRole('checkbox', { name: 'session:create' });
    await userEvent.click(box);
    expect(box).toBeChecked();
    expect(screen.getByTestId('value')).toHaveTextContent('session:create');
    await userEvent.click(box);
    expect(box).not.toBeChecked();
    expect(screen.getByTestId('value')).toBeEmptyDOMElement();
  });

  it('selects all, toggles a group and clears', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Select all' }));
    screen.getAllByRole('checkbox').forEach((box) => expect(box).toBeChecked());
    await userEvent.click(screen.getByRole('button', { name: /^Graph/ }));
    expect(screen.getByRole('checkbox', { name: 'graph:read' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'session:read' })).toBeChecked();
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    screen.getAllByRole('checkbox').forEach((box) => expect(box).not.toBeChecked());
  });
});
