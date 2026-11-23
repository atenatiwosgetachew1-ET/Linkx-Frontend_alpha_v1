// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GraphReportDialog from './GraphReportDialog.jsx';

afterEach(cleanup);

const initial = { title: 'Graph Report', caseId: '', reference: '', dateTime: '19/11/26 10:00', analyst: '', systemRule: '', graphAlert: '', purpose: '', nameKey: '', findings: '', assessment: '', actions: '', marking: '' };

describe('GraphReportDialog Range (analyst decision 2026-11-19)', () => {
  it('starts on Brief; a preset fills the limits; changing one makes it Custom; the choice comes back as values.range', async () => {
    const onGenerate = vi.fn(() => Promise.resolve());
    render(<GraphReportDialog initial={initial} rangeCounts={{ subjects: 31, profiles: 31, strongest: 120 }} onGenerate={onGenerate} onCancel={() => {}} />);
    const form = screen.getByRole('dialog', { name: 'Generate graph report' });
    // Brief to start with (analyst decision 2026-11-19).
    expect(within(form).getByLabelText('Preset')).toHaveValue('brief');
    expect(within(form).getByLabelText('Subjects of interest')).toHaveValue(10);
    expect(within(form).getByLabelText('Profile cards')).toHaveValue(4);
    expect(within(form).getByLabelText('Strongest relationships')).toHaveValue(10);
    expect(within(form).getByLabelText('Rows per table')).toHaveValue(25);
    expect(within(form).getByLabelText('Report range')).toHaveTextContent('Brief: Subjects of interest 10 of 31 · Profile cards 4 of 31 · Strongest relationships 10 of 120 · Rows per table up to 25');
    // Standard.
    await userEvent.selectOptions(within(form).getByLabelText('Preset'), 'standard');
    expect(within(form).getByLabelText('Profile cards')).toHaveValue(10);
    expect(within(form).getByLabelText('Rows per table')).toHaveValue(50);
    // Full: everything (the fields read All).
    await userEvent.selectOptions(within(form).getByLabelText('Preset'), 'full');
    expect(within(form).getByLabelText('Profile cards')).toHaveValue(null);
    expect(within(form).getByLabelText('Report range')).toHaveTextContent('Full: Subjects of interest 31 of 31');
    // Brief, then a limit of one's own: Custom.
    await userEvent.selectOptions(within(form).getByLabelText('Preset'), 'brief');
    expect(within(form).getByLabelText('Profile cards')).toHaveValue(4);
    await userEvent.clear(within(form).getByLabelText('Profile cards'));
    await userEvent.type(within(form).getByLabelText('Profile cards'), '6');
    expect(within(form).getByLabelText('Preset')).toHaveValue('custom');
    // Cleared: all.
    await userEvent.clear(within(form).getByLabelText('Rows per table'));
    await userEvent.click(within(form).getByRole('button', { name: 'Generate PDF' }));
    expect(onGenerate.mock.calls[0][0].range).toEqual({ preset: 'custom', subjects: 10, profiles: 6, strongest: 10, rows: null });
  });
});
