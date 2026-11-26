// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { SystemPanel } from './ConfigurationPanels.jsx';

afterEach(cleanup);

const DRAFT = {
  domain: 'bank',
  active_domain: 'bank',
  registered_domains: ['bank', 'cdr'],
  automation: true,
  domain_connections: {
    bank: { configured: true, storage_database: 'bank_db', storage_port: 5001, date_column: 'TXN_DATE', storage_tables: ['transactions', 'accounts'] },
    cdr: { configured: false },
  },
};

const renderSystem = (props = {}) => {
  const handlers = { onChange: vi.fn(), onSwitchDomain: vi.fn(), onIdleSettingsChange: vi.fn() };
  render(
    <SystemPanel
      draft={DRAFT}
      canWrite
      isSwitchingDomain={false}
      idleSettings={{ warningMs: 5 * 60000, lockMs: 10 * 60000, timeoutMs: 30 * 60000, lockRequiresReauth: true }}
      idlePolicyMeta={{ source: 'service', editableFields: ['idle_warning_ms', 'idle_lock_ms', 'max_idle_timeout_ms', 'lock_requires_reauth'] }}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
};

describe('Configuration · System', () => {
  it('shows the active domain as the page header, with its storage facts and tables', () => {
    renderSystem();
    expect(screen.getByRole('heading', { name: 'Banking' })).toBeInTheDocument();
    expect(screen.getByText('Configured')).toBeInTheDocument();
    const facts = screen.getByLabelText('Active domain');
    expect(facts).toHaveTextContent('Target DB');
    expect(facts).toHaveTextContent('bank_db');
    expect(facts).toHaveTextContent('5001');
    expect(facts).toHaveTextContent('TXN_DATE');
    expect(screen.getByText('transactions')).toBeInTheDocument();
    expect(screen.getByText('accounts')).toBeInTheDocument();
  });

  it('switches the domain pillar from its pills, not for the active one', async () => {
    const { onSwitchDomain } = renderSystem();
    const pills = screen.getByRole('radiogroup', { name: 'Active domain pillar' });
    const [bank, cdr] = within(pills).getAllByRole('radio');
    expect(bank).toBeChecked();
    expect(cdr).toHaveTextContent('Unconfigured');
    await userEvent.click(bank);
    expect(onSwitchDomain).not.toHaveBeenCalled();
    await userEvent.click(cdr);
    expect(onSwitchDomain).toHaveBeenCalledWith('cdr');
  });

  it('locks every timeout when the Service lists none as editable (B-15)', () => {
    renderSystem({ idlePolicyMeta: { source: 'service', editableFields: [] } });
    expect(screen.getByLabelText('Lock after (min)')).toBeDisabled();
    expect(screen.getByLabelText('Warn after (min)')).toBeDisabled();
  });

  it('edits the timeouts in minutes and the services as switches', async () => {
    const { onChange, onIdleSettingsChange } = renderSystem();
    const lock = screen.getByLabelText('Lock after (min)');
    expect(lock).toHaveValue(10);
    await userEvent.clear(lock);
    await userEvent.type(lock, '15{Enter}');
    const update = onIdleSettingsChange.mock.calls.at(-1)[0];
    expect(update({ lockMs: 1 })).toEqual({ lockMs: 15 * 60000 });

    const services = screen.getByRole('group', { name: 'Services' });
    expect(within(services).getByRole('switch', { name: /Automate across services/ })).toBeChecked();
    await userEvent.click(within(services).getByRole('switch', { name: /Remote requests/ }));
    expect(onChange).toHaveBeenCalledWith('remote', true);
  });

  it('is read-only without config:write', () => {
    renderSystem({ canWrite: false });
    within(screen.getByRole('radiogroup', { name: 'Active domain pillar' })).getAllByRole('radio').forEach((pill) => expect(pill).toBeDisabled());
    expect(screen.getByLabelText('Lock after (min)')).toBeDisabled();
    expect(screen.getByRole('switch', { name: /Remote requests/ })).toBeDisabled();
  });
});

describe('granted domains (C10)', () => {
  it('offers the account’s own only; the one in use is always shown', () => {
    renderSystem({ allowedDomains: ['cdr'] });
    expect(screen.getAllByRole('radio').map((item) => item.textContent)).toHaveLength(2);
    cleanup();
    renderSystem({ allowedDomains: ['bank'] });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
  });
});
