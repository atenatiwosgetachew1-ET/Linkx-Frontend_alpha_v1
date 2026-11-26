// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import DataframeMappingDialog from './DataframeMappingDialog.jsx';

afterEach(cleanup);

const INFO = { missingFields: ['ACCOUNTNO', 'TRANSACTIONTIME'], sourceColumns: ['PAYER ACC', 'WHEN'], ownMapping: {} };
const show = (required) => render(<DataframeMappingDialog info={INFO} required={required} onApply={vi.fn()} onCancel={vi.fn()} />);

describe('DataframeMappingDialog', () => {
  it('waits for the domain’s fields (null) before listing them, so the list does not reorder', () => {
    show(null);
    expect(screen.getByText('Loading the domain’s fields…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Column for ACCOUNTNO')).toBeNull();
  });

  it('lists the required ones first, marked; without them (a failed fetch: []) plainly', () => {
    show([['TRANSACTIONTIME']]);
    const fields = screen.getAllByRole('combobox').map((select) => select.getAttribute('aria-label'));
    expect(fields).toEqual(['Column for TRANSACTIONTIME', 'Column for ACCOUNTNO']);
    expect(screen.getByText('required')).toBeInTheDocument();
    cleanup();
    show([]);
    expect(screen.getAllByRole('combobox').map((select) => select.getAttribute('aria-label'))).toEqual(['Column for ACCOUNTNO', 'Column for TRANSACTIONTIME']);
    expect(screen.queryByText('required')).toBeNull();
  });
});
