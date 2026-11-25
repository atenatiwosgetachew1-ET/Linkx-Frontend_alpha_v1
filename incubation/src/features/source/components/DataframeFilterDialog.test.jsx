// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import DataframeFilterDialog from './DataframeFilterDialog.jsx';

afterEach(cleanup);

const columns = ['ACCOUNT', 'AMOUNT', 'CHANNEL', 'NOTE'];

describe('DataframeFilterDialog', () => {
  it('strips columns, adds a row condition, previews through the Service and applies', async () => {
    const onApply = vi.fn();
    const onPreview = vi.fn(() => Promise.resolve({ available: true, totalRows: 1200, keptRows: 900 }));
    render(<DataframeFilterDialog columns={columns} totalRows={1200} used={['ACCOUNT']} onPreview={onPreview} onApply={onApply} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Filter dataframe' });
    expect(dialog).toHaveTextContent('Nothing is filtered: the whole dataframe is ingested.');
    // A column in use cannot be stripped.
    const keep = within(dialog).getByRole('list', { name: 'Columns to keep' });
    expect(within(keep).getByRole('checkbox', { name: /ACCOUNT/ })).toBeDisabled();
    await userEvent.click(within(keep).getByRole('checkbox', { name: 'NOTE' }));
    expect(dialog).toHaveTextContent('Strip 1 column: NOTE.');
    expect(dialog).toHaveTextContent('3 of 4 columns');
    expect(within(dialog).getByRole('tab', { name: /Columns/ })).toHaveTextContent('3/4');
    // Rows: a condition, incomplete until it has a value.
    await userEvent.click(within(dialog).getByRole('tab', { name: /Rows/ }));
    expect(dialog).toHaveTextContent('No condition: every row is kept.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add condition' }));
    await userEvent.selectOptions(within(dialog).getByLabelText('Condition 1 column'), 'CHANNEL');
    expect(within(dialog).getByRole('button', { name: 'Apply filter' })).toBeDisabled();
    expect(dialog).toHaveTextContent('Condition 1: enter a value.');
    await userEvent.type(within(dialog).getByLabelText('Condition 1 value'), 'ATM');
    expect(dialog).toHaveTextContent('Remove the rows where CHANNEL is "ATM".');
    expect(within(dialog).getByRole('tab', { name: /Rows/ })).toHaveTextContent('1');
    // Clean-up.
    await userEvent.click(within(dialog).getByRole('tab', { name: /Clean-up/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Remove duplicate rows' }));
    expect(dialog).toHaveTextContent('Remove duplicate rows (all kept columns alike).');
    // The Service counts what is kept.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Count rows' }));
    expect(await within(dialog).findByText('900 of 1,200')).toBeInTheDocument();
    expect(onPreview.mock.calls[0][0]).toMatchObject({ drop_columns: ['NOTE'], row_filter: { conditions: [{ column: 'CHANNEL', operator: 'equals', value: 'ATM' }] } });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply filter' }));
    expect(onApply.mock.calls[0][0]).toMatchObject({ dropColumns: ['NOTE'], rows: { action: 'remove', conditions: [{ column: 'CHANNEL', value: 'ATM' }] }, dropDuplicates: true });
  });

  it('a Service without the preview says so; Clear all applies no filter', async () => {
    const onApply = vi.fn();
    const onPreview = vi.fn(() => Promise.resolve({ available: false, message: 'The Service cannot preview a filter yet; it is applied when the stream starts.' }));
    render(<DataframeFilterDialog columns={columns} totalRows={50} initial={{ dropColumns: ['NOTE'] }} onPreview={onPreview} onApply={onApply} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Filter dataframe' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Count rows' }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('cannot preview a filter yet');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear all' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply filter' }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it('a pasted column is one value a line, whole, and never run into its neighbour (audit B7)', async () => {
    const onApply = vi.fn();
    render(<DataframeFilterDialog columns={columns} totalRows={50} initial={{ rows: { match: 'all', action: 'keep', conditions: [{ column: 'ACCOUNT', operator: 'in', value: '0012345', value2: '' }] } }} onApply={onApply} onCancel={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Filter dataframe' });
    await userEvent.click(within(dialog).getByRole('tab', { name: /Rows/ }));
    const input = within(dialog).getByLabelText('Condition 1 value');
    await userEvent.click(input);
    input.setSelectionRange(7, 7);
    const accounts = Array.from({ length: 20 }, (_, i) => String(1000123400000 + i));
    await userEvent.paste(`${accounts.join('\r\n')}\r\n5,000\r\n`);
    expect(input).toHaveValue(`0012345, ${accounts.join(', ')}, "5,000"`);
    input.setSelectionRange(input.value.length, input.value.length);
    await userEvent.paste(Array.from({ length: 60 }, (_, i) => `X${i}`).join('\n'));
    expect(within(dialog).getByRole('button', { name: 'Apply filter' })).toBeDisabled();
    expect(dialog).toHaveTextContent('at most 50');
  });
});
