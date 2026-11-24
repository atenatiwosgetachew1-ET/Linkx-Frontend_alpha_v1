// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { NotificationProvider } from '../notifications/NotificationContext.jsx';
import { useNotifications } from '../notifications/useNotifications.js';

afterEach(cleanup);

function Ask({ icon }) {
  const { requestConfirmation } = useNotifications();
  return <button type="button" onClick={() => requestConfirmation({ title: 'Delete user', message: 'Sure?', icon })}>Ask</button>;
}

it.each([['delete', 'delete'], [undefined, 'question'], ['nonsense', 'question'], ['constructor', 'question']])('a confirmation shows the icon of what it asks (%s)', async (icon, shown) => {
  render(<NotificationProvider><Ask icon={icon} /></NotificationProvider>);
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
  // The icon is not part of its name.
  const dialog = screen.getByRole('dialog', { name: 'Delete user' });
  expect(dialog.querySelector('.linkx_confirm_icon')).toHaveAttribute('data-icon', shown);
});
