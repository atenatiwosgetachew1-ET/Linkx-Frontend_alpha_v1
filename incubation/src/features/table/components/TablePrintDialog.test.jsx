// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import TablePrintDialog from './TablePrintDialog.jsx';

afterEach(cleanup);

const columns = (count) => [{ key: '@label', label: 'Label' }, ...Array.from({ length: count - 1 }, (_, index) => ({ key: `c${index}`, label: `Column ${index}` }))];

describe('TablePrintDialog', () => {
  it('many columns: says they continue on more pages in sets (Label repeated); fewer in landscape, none when they fit', async () => {
    const view = render(<TablePrintDialog rowCounts={{ shown: 10, all: 10, selected: 0 }} columns={columns(14)} compose={vi.fn(async () => null)} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    // Auto: landscape past 6 columns.
    expect(screen.getByRole('note')).toHaveTextContent('14 columns: printed in about 2 page sets, Label repeated in each (no column narrower than 28 mm). Untick columns for fewer.');
    await userEvent.click(screen.getByRole('radio', { name: /^Portrait/ }));
    expect(screen.getByRole('note')).toHaveTextContent('about 3 page sets');
    expect(screen.getByRole('note')).toHaveTextContent('Landscape needs fewer.');
    view.rerender(<TablePrintDialog rowCounts={{ shown: 10, all: 10, selected: 0 }} columns={columns(5)} compose={vi.fn(async () => null)} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    cleanup();
    render(<TablePrintDialog rowCounts={{ shown: 10, all: 10, selected: 0 }} columns={columns(5)} compose={vi.fn(async () => null)} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
