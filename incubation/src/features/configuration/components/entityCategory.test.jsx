// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { RulesPanel } from './ConfigurationPanels.jsx';
import { buildConfigurationSavePayload } from '../lib/configModel.js';

afterEach(cleanup);
globalThis.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };

let draft;
function Panel({ initial }) {
  const [value, setValue] = useState(initial);
  draft = value;
  return <RulesPanel draft={value} onChange={(name, next) => setValue((current) => ({ ...current, [name]: next }))} canEditEntities canWrite knownBuiltinRules={[]} onManageRules={vi.fn()} onNotice={vi.fn()} />;
}
const BANK = { active_domain: 'bank', trusted_entities: [{ key: 'ACCOUNT', value: '1', category: 'Trusted', pass_through: true }], risk_entities: [] };
const category = () => screen.getByRole('combobox', { name: 'Category, row 1' });

it('offers every category, whatever the entry holds now', async () => {
  render(<Panel initial={BANK} />);
  expect(within(category()).getAllByRole('option').map((option) => option.textContent)).toEqual(['Trusted', 'Risk (risk)', 'PEP (risk)', 'Sanction (risk)', 'Other…']);
  expect(screen.getByRole('switch', { name: 'Pass through, row 1' })).toBeChecked();
  await userEvent.selectOptions(category(), 'Sanction');
  expect(category()).toHaveValue('Sanction');
  // A risk is never passed through, on screen or when saved.
  expect(screen.getByRole('switch', { name: 'Pass through, row 1' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Pass through, row 1' })).toBeDisabled();
  const saved = buildConfigurationSavePayload(draft);
  expect(saved.risk_entities).toEqual([expect.objectContaining({ value: '1', category: 'Sanction', pass_through: false })]);
  expect(saved.trusted_entities).toEqual([]);
});

it('another category can be typed, and an unlisted one is kept', async () => {
  render(<Panel initial={{ ...BANK, trusted_entities: [{ key: 'ACCOUNT', value: '1', category: 'Payroll' }] }} />);
  expect(category()).toHaveValue('Payroll');
  await userEvent.selectOptions(category(), 'Other…');
  await userEvent.type(screen.getByRole('textbox', { name: 'Category, row 1' }), 'Government{Enter}');
  expect(category()).toHaveValue('Government');
});

it('WANGIRI is a risk on the CDR domain', async () => {
  render(<Panel initial={{ active_domain: 'cdr', trusted_entities: [{ key: 'MSISDN', value: '9', category: 'WANGIRI', pass_through: true }] }} />);
  expect(buildConfigurationSavePayload(draft).risk_entities).toHaveLength(1);
});
