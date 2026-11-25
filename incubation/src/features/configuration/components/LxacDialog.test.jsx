// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import LxacDialog from './LxacDialog.jsx';

afterEach(cleanup);

it('the export password follows the Service’s policy, and is sent as typed (B-17)', async () => {
  const onSubmit = vi.fn(async () => {});
  render(<LxacDialog mode="export" onSubmit={onSubmit} onClose={() => {}} />);
  const attempt = (value) => {
    fireEvent.change(screen.getByLabelText('Encryption password'), { target: { value } });
    fireEvent.change(screen.getByLabelText('Confirm encryption password'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
  };
  attempt('aaaabbbbaaaabbbb');
  expect(screen.getByRole('alert')).toHaveTextContent('5 different');
  attempt(' Abcdefghijkl ');
  expect(screen.getByRole('alert')).toHaveTextContent('start or end with a space');
  expect(onSubmit).not.toHaveBeenCalled();
  attempt('Abc defghijkl');
  expect(onSubmit).toHaveBeenCalledWith('Abc defghijkl');
});
