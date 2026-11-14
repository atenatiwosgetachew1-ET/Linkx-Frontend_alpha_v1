// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { AuthContext } from '../../../auth/authContext.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { clearKnownBuiltinRules, getKnownBuiltinRules } from '../lib/rulesLibrary.js';
import LibrariesWindowBody from './LibrariesWindowBody.jsx';

afterEach(() => {
  cleanup();
  clearKnownBuiltinRules();
});

const SESSION_CONFIG = {
  domain: 'bank',
  active_domain: 'bank',
  rule_names: ['FUND_FLOW', 'my_rule'],
  builtin_rules: ['FUND_FLOW'],
  active_rule: 'FUND_FLOW',
  active_tool_password: '***',
  active_tool_password_ref: 'ref-1',
};
const windowItem = { id: 'libraries-1', type: WORKSPACE_WINDOW_TYPES.LIBRARIES, title: 'Libraries', metadata: {} };

let sessionApi;
function Harness({ apiFetch, permissions = null }) {
  const [configuration, setConfiguration] = useState(SESSION_CONFIG);
  sessionApi = { configuration };
  const auth = {
    user: { username: 'analyst' },
    hasRole: () => false,
    hasPermission: (permission) => (permissions ? permissions.includes(permission) : true),
  };
  return (
    <AuthContext.Provider value={auth}>
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch, mainSessionId: 's1', isSessionReady: true, configuration, setConfiguration }}>
          <WorkspaceProvider>
            <LibrariesWindowBody windowItem={windowItem} />
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>
    </AuthContext.Provider>
  );
}

const rowOf = (name) => screen.getByRole('cell', { name }).closest('tr');

describe('LibrariesWindowBody: rules library (moved from Configuration)', () => {
  it('lists the loaded rules with built-in / custom and active badges', () => {
    render(<Harness apiFetch={vi.fn()} />);
    expect(within(rowOf('FUND_FLOW')).getByText('Built-in')).toBeInTheDocument();
    expect(within(rowOf('FUND_FLOW')).getByText('Active')).toBeInTheDocument();
    expect(within(rowOf('my_rule')).getByText('Custom')).toBeInTheDocument();
  });

  it('uploads with the confirmed session configuration (production multipart save)', async () => {
    const apiFetch = vi.fn(async () => ({ message: 'success', results: { configuration: { ...SESSION_CONFIG, rule_names: ['FUND_FLOW', 'my_rule', 'new_rule'] } } }));
    render(<Harness apiFetch={apiFetch} />);
    const file = new File(['{"rule":1}'], 'new_rule.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('Rule file (JSON)'), file);
    await userEvent.type(screen.getByLabelText('Rule name'), 'new_rule');
    await userEvent.click(screen.getByRole('button', { name: 'Upload rule' }));

    await waitFor(() => expect(screen.getByRole('cell', { name: 'new_rule' })).toBeInTheDocument());
    const [path, options] = apiFetch.mock.calls[0];
    expect(path).toBe('/configuration');
    const body = options.body;
    expect(body.get('id')).toBe('save');
    expect(body.get('rule_name')).toBe('new_rule');
    expect(body.get('domain')).toBe('bank');
    // A masked secret is never sent back as a password.
    expect(body.get('active_tool_password')).toBeNull();
    // The session now lists the new rule, so Configuration and Source see it.
    expect(sessionApi.configuration.rule_names).toContain('new_rule');
  });

  it('removes a rule after a confirmation click', async () => {
    const apiFetch = vi.fn(async () => ({ message: 'success', results: { configuration: { ...SESSION_CONFIG, rule_names: ['FUND_FLOW'] } } }));
    render(<Harness apiFetch={apiFetch} />);
    const remove = within(rowOf('my_rule')).getByRole('button', { name: 'Remove' });
    await userEvent.click(remove);
    expect(apiFetch).not.toHaveBeenCalled();
    await userEvent.click(within(rowOf('my_rule')).getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(screen.queryByRole('cell', { name: 'my_rule' })).not.toBeInTheDocument());
    expect(apiFetch.mock.calls[0][1].body.get('id')).toBe('remove_rule');
  });

  it('remembers rules the backend refuses as built-in, for both windows', async () => {
    const apiFetch = vi.fn(async () => ({ message: 'failed!', error: 'rule_remove_failed', detail: "Cannot remove built-in rule 'my_rule'" }));
    render(<Harness apiFetch={apiFetch} />);
    await userEvent.click(within(rowOf('my_rule')).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(rowOf('my_rule')).getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(getKnownBuiltinRules().has('my_rule')).toBe(true));
    expect(within(rowOf('my_rule')).getByText('Built-in')).toBeInTheDocument();
  });

  it('is read-only without config:write and hidden without config:read', () => {
    const { unmount } = render(<Harness apiFetch={vi.fn()} permissions={['config:read']} />);
    expect(within(rowOf('my_rule')).getByRole('button', { name: 'Remove' })).toBeDisabled();
    expect(screen.getByLabelText('Rule file (JSON)')).toBeDisabled();
    unmount();
    render(<Harness apiFetch={vi.fn()} permissions={[]} />);
    expect(screen.getByText('You need config:read to view the rules library.')).toBeInTheDocument();
  });
});
