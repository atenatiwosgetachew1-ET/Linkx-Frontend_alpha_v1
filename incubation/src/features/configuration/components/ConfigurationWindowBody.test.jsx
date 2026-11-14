// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { AuthContext } from '../../../auth/authContext.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { clearConfigurationDrafts } from '../lib/configDraft.js';
import ConfigurationWindowBody from './ConfigurationWindowBody.jsx';

afterEach(() => {
  cleanup();
  clearConfigurationDrafts();
});

const BANK = { domain: 'bank', active_domain: 'bank', registered_domains: ['bank', 'cdr'], active_tool_url: 'bolt://bank', active_tool_username: 'neo' };
const CDR = { ...BANK, domain: 'cdr', active_domain: 'cdr', active_tool_url: 'bolt://cdr' };

const auth = { hasRole: () => true, hasPermission: () => true, user: { username: 'analyst' } };
const windowItem = { id: 'configuration-1', type: WORKSPACE_WINDOW_TYPES.CONFIGURATION, title: 'Configuration', metadata: { configurationUi: { activeTab: 'tools' } } };

let sessionApi;
function Harness({ apiFetch, mounted = true }) {
  const [configuration, setConfiguration] = useState(BANK);
  sessionApi = { configuration, setConfiguration };
  const session = {
    apiFetch,
    mainSessionId: 's1',
    isSessionReady: false, // no automatic load; each test drives the requests
    configuration,
    setConfiguration,
    idleSettings: {},
    idlePolicyMeta: {},
    updateIdleSettings: vi.fn(),
  };
  return (
    <AuthContext.Provider value={auth}>
      <NotificationProvider>
        <SessionContext.Provider value={session}>
          <WorkspaceProvider>
            {mounted && <ConfigurationWindowBody windowItem={windowItem} />}
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>
    </AuthContext.Provider>
  );
}

const editToolUrl = async (value) => {
  const input = screen.getByLabelText('URL address');
  await userEvent.clear(input);
  await userEvent.type(input, value);
  fireEvent.blur(input);
};

describe('ConfigurationWindowBody unsaved draft', () => {
  it('keeps unsaved edits when the body unmounts and remounts (docked tabs)', async () => {
    const apiFetch = vi.fn();
    const { rerender } = render(<Harness apiFetch={apiFetch} />);
    await editToolUrl('bolt://edited');
    rerender(<Harness apiFetch={apiFetch} mounted={false} />);
    rerender(<Harness apiFetch={apiFetch} />);
    expect(screen.getByLabelText('URL address')).toHaveValue('bolt://edited');
    expect(apiFetch).not.toHaveBeenCalled(); // no reload over the unsaved draft
  });

  it('follows a domain switch made elsewhere and never saves the stale domain', async () => {
    const apiFetch = vi.fn(async () => ({ status: 'success', configuration: { ...CDR, active_tool_url: 'bolt://edited' } }));
    render(<Harness apiFetch={apiFetch} />);
    await editToolUrl('bolt://edited');
    act(() => sessionApi.setConfiguration(CDR)); // e.g. switched from a Source window
    expect(screen.getByText(/cdr/i, { selector: 'dd' })).toBeInTheDocument();
    expect(screen.getByLabelText('URL address')).toHaveValue('bolt://edited'); // edit kept

    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const body = apiFetch.mock.calls.find(([, options]) => options?.body?.id === 'save')[1].body;
    expect(body.configuration).toMatchObject({ domain: 'cdr', active_domain: 'cdr', active_tool_url: 'bolt://edited' });
  });

  it('does not share a draft with a typed password when the saved config cannot be reloaded', async () => {
    const apiFetch = vi.fn(async (path, options) => {
      if (options?.body?.id === 'save') return { status: 'success' }; // no configuration back
      throw new Error('reload failed');
    });
    render(<Harness apiFetch={apiFetch} />);
    await editToolUrl('bolt://edited');
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    await screen.findByText(/could not be loaded/i);
    expect(sessionApi.configuration).toEqual(BANK);
  });
});
