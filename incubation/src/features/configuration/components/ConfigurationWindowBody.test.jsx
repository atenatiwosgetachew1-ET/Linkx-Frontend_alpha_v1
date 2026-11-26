// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { AuthContext } from '../../../auth/authContext.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { clearConfigurationDrafts } from '../lib/configDraft.js';
import ConfigurationWindowBody from './ConfigurationWindowBody.jsx';
import { adoptPresentation, getPresentationVersion, resetPresentation } from '../../graph/lib/domainPresentation.js';
import { getProfileSettings, resetProfileSettingsCache } from '../../graph/lib/nodeProfile.js';
import { getDomainFormatting, resetDomainFormattingCache } from '../../graph/lib/conditionalFormatting.js';

afterEach(() => {
  cleanup();
  clearConfigurationDrafts();
  localStorage.clear();
  resetProfileSettingsCache();
  resetDomainFormattingCache();
});

const BANK = { domain: 'bank', active_domain: 'bank', registered_domains: ['bank', 'cdr'], active_tool_url: 'bolt://bank', active_tool_username: 'neo' };
const CDR = { ...BANK, domain: 'cdr', active_domain: 'cdr', active_tool_url: 'bolt://cdr' };

const auth = { hasRole: () => true, hasPermission: () => true, user: { username: 'analyst' } };
const windowItem = { id: 'configuration-1', type: WORKSPACE_WINDOW_TYPES.CONFIGURATION, title: 'Configuration', metadata: { configurationUi: { activeTab: 'tools' } } };

let sessionApi;
function Harness({ apiFetch, mounted = true, item = windowItem, initial = BANK }) {
  const [configuration, setConfiguration] = useState(initial);
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
            {mounted && <ConfigurationWindowBody windowItem={item} />}
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

it('never saves a configuration that was not loaded (audit C3)', async () => {
  const apiFetch = vi.fn(async () => ({ status: 'success' }));
  render(<Harness apiFetch={apiFetch} initial={{}} />);
  await editToolUrl('bolt://edited');
  await userEvent.click(screen.getByRole('button', { name: /^save/i }));
  expect(await screen.findByText(/has not been loaded, so it cannot be saved/i)).toBeInTheDocument();
  expect(apiFetch.mock.calls.filter(([, options]) => options?.body?.id === 'save')).toEqual([]);
});

describe('ConfigurationWindowBody profile mapping fields (Rules)', () => {
  it('maps the portrait and details to node properties; saved as actor_profile and kept on the device', async () => {
    const apiFetch = vi.fn(async (path, options) => ({ status: 'success', configuration: options?.body?.configuration || BANK }));
    render(<Harness apiFetch={apiFetch} item={{ ...windowItem, metadata: { configurationUi: { activeTab: 'rules' } } }} />);
    const table = screen.getByRole('table', { name: 'Profile mapping fields' });
    expect(table).toHaveTextContent('Portrait');
    expect(table).toHaveTextContent('ID');
    await userEvent.type(screen.getByLabelText('Full name property'), 'FULL_NAME');
    await userEvent.type(screen.getByLabelText('Portrait property'), 'PHOTO_URL');
    await userEvent.click(screen.getByLabelText('Show Address'));
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([, options]) => options?.body?.id === 'save')).toBe(true));
    const body = apiFetch.mock.calls.find(([, options]) => options?.body?.id === 'save')[1].body;
    expect(body.configuration.actor_profile).toMatchObject({
      enabled: true,
      portrait_property: 'PHOTO_URL',
      fields: expect.arrayContaining([{ field: 'fullName', property: 'FULL_NAME', shown: true }, { field: 'address', property: '', shown: false }]),
    });
    // Until the backend keeps it (B-23), the Graph windows read the device copy.
    await waitFor(() => expect(getProfileSettings('bank').fields[0]).toEqual({ key: 'fullName', source: 'FULL_NAME', shown: true }));
  });
});

describe('ConfigurationWindowBody formatting rules (Rules)', () => {
  it('edits the domain\'s rules in the rule editor (typed property names); saved as formatting_rules and kept on the device', async () => {
    const apiFetch = vi.fn(async (path, options) => ({ status: 'success', configuration: options?.body?.configuration || BANK }));
    render(<Harness apiFetch={apiFetch} item={{ ...windowItem, metadata: { configurationUi: { activeTab: 'rules' } } }} />);
    expect(screen.getByText('No formatting rules for this domain yet.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit rules…' }));
    const dialog = screen.getByRole('dialog', { name: /Formatting rules · Banking/ });
    await userEvent.click(within(dialog).getByRole('button', { name: '+ Node rule' }));
    await userEvent.type(within(dialog).getByRole('combobox', { name: 'Property' }), 'CATEGORY');
    await userEvent.type(within(dialog).getByLabelText('Value'), 'PEP');
    expect(dialog).not.toHaveTextContent('Matches');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('list', { name: 'Formatting rules' })).toHaveTextContent('Nodes where CATEGORY equals PEP');
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(apiFetch.mock.calls.some(([, options]) => options?.body?.id === 'save')).toBe(true));
    const body = apiFetch.mock.calls.find(([, options]) => options?.body?.id === 'save')[1].body;
    expect(body.configuration.formatting_rules).toEqual([expect.objectContaining({ target: 'node', conditions: [{ key: 'CATEGORY', op: 'eq', value: 'PEP', value2: '' }], style: { fill: '#e74c3c' } })]);
    await waitFor(() => expect(getDomainFormatting('bank')).toHaveLength(1));
  });
});

describe('profile mapping on the Service (B-23, B-24)', () => {
  const edit = async (post) => {
    const calls = [];
    const apiFetch = vi.fn(async (path, options) => {
      calls.push([path, options?.body]);
      if (path === '/domain-config') return post(calls.filter(([name]) => name === path).length, options.body);
      return { status: 'success', configuration: options?.body?.configuration || BANK };
    });
    adoptPresentation('bank', { versionId: 4, actorProfile: null, formattingRules: null, updatedBy: '' });
    render(<Harness apiFetch={apiFetch} item={{ ...windowItem, metadata: { configurationUi: { activeTab: 'rules' } } }} />);
    await userEvent.type(screen.getByLabelText('Portrait property'), 'PHOTO');
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    const of = (path) => calls.filter(([name]) => name === path).map(([, body]) => body);
    return { shared: () => of('/domain-config'), config: () => of('/configuration').filter((body) => body.id === 'save') };
  };
  afterEach(resetPresentation);
  const answer = (version) => ({ state: { version_id: version, actor_profile: { enabled: true, portrait_property: 'PHOTO', fields: [] }, formatting_rules: null } });
  const conflict = { status: 409, data: { code: 'version_conflict', current: { version_id: 9, updated_by: 'sam', actor_profile: { enabled: true, portrait_property: 'THEIRS', fields: [] }, formatting_rules: null } } };

  it('is saved there, with its version, and not with the configuration or in the browser', async () => {
    const service = await edit(() => answer(5));
    await waitFor(() => expect(service.config()).toHaveLength(1));
    expect(service.shared()).toEqual([expect.objectContaining({ domain: 'bank', section: 'presentation', version_id: 4, actor_profile: expect.objectContaining({ portrait_property: 'PHOTO' }) })]);
    expect(service.config()[0].configuration).not.toHaveProperty('actor_profile');
    expect(getPresentationVersion('bank')).toBe(5);
    expect(localStorage.getItem('linkx_actor_profile_v1')).toBeNull();
  });

  it('someone else saved meanwhile: theirs are taken, and nothing else is saved', async () => {
    const service = await edit(() => { throw Object.assign(new Error('x'), conflict); });
    await userEvent.click(await screen.findByRole('button', { name: 'Take theirs' }));
    await waitFor(() => expect(screen.getByLabelText('Portrait property')).toHaveValue('THEIRS'));
    expect(service.config()).toEqual([]);
  });

  it('someone else saved meanwhile: mine replace theirs, on their version', async () => {
    const service = await edit((attempt) => { if (attempt === 1) throw Object.assign(new Error('x'), conflict); return answer(10); });
    await userEvent.click(await screen.findByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(service.config()).toHaveLength(1));
    expect(service.shared().map((body) => body.version_id)).toEqual([4, 9]);
  });

  it('settings that arrive after the window opened are shown; an edit made meanwhile stays', async () => {
    const apiFetch = vi.fn(async () => ({ status: 'success' }));
    const stale = { ...BANK, actor_profile: { enabled: true, portrait_property: 'STALE', fields: [] } };
    render(<Harness apiFetch={apiFetch} initial={stale} item={{ ...windowItem, metadata: { configurationUi: { activeTab: 'rules' } } }} />);
    expect(screen.getByLabelText('Portrait property')).toHaveValue('STALE');
    const theirs = (portrait, versionId) => act(() => { adoptPresentation('bank', { versionId, actorProfile: { enabled: true, portrait_property: portrait, fields: [] }, formattingRules: null, updatedBy: '' }); });
    theirs('SERVICE', 1);
    expect(screen.getByLabelText('Portrait property')).toHaveValue('SERVICE');
    await userEvent.type(screen.getByLabelText('Portrait property'), '_MINE');
    theirs('NEWER', 2);
    expect(screen.getByLabelText('Portrait property')).toHaveValue('SERVICE_MINE');
  });
});

describe('what only an administrator may save (R2-18)', () => {
  const other = () => {
    auth.hasPermission = (permission) => permission !== 'users:manage';
    auth.hasRole = () => false;
  };
  afterEach(() => {
    auth.hasPermission = () => true;
    auth.hasRole = () => true;
  });
  it('an edit that cannot be saved is named, and the rest is saved', async () => {
    other();
    const apiFetch = vi.fn(async (path, options) => ({ status: 'success', configuration: options?.body?.configuration || BANK }));
    render(<Harness apiFetch={apiFetch} />);
    await editToolUrl('bolt://edited');
    const password = screen.getByLabelText('Tool password');
    await userEvent.type(password, 'S3cret!');
    fireEvent.blur(password);
    await userEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(await screen.findByText(/Only an administrator can change: active tool password/)).toBeInTheDocument();
    const body = apiFetch.mock.calls.find(([, options]) => options?.body?.id === 'save')[1].body;
    expect(body.configuration.active_tool_url).toBe('bolt://edited');
    expect(body.configuration).not.toHaveProperty('active_tool_password');
  });
  it('the entity lists are not editable for others', async () => {
    auth.hasPermission = (permission) => permission !== 'users:manage';
    auth.hasRole = () => false;
    const apiFetch = vi.fn(async (path, options) => ({ status: 'success', configuration: options?.body?.configuration || BANK }));
    render(<Harness apiFetch={apiFetch} initial={{ ...BANK, trusted_entities: [{ key: 'ACCOUNT', value: '1', category: 'Trusted' }] }} item={{ ...windowItem, metadata: { configurationUi: { activeTab: 'rules' } } }} />);
    expect(screen.getByRole('combobox', { name: 'Category, row 1' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Remove entity row 1' })).not.toBeInTheDocument();
    auth.hasPermission = () => true;
    auth.hasRole = () => true;
  });
});

describe('columns and column mapping (round 3)', () => {
  const initial = { ...BANK, fetch_columns: ['A', 'B'], search_columns_strict: ['A'], columns_origins: { fetch_columns: 'admin' }, column_mapping: { ACC: 'ACCOUNTNO' }, column_mapping_origins: { ACC: 'profile' } };
  const at = (tab) => ({ ...windowItem, metadata: { configurationUi: { activeTab: tab } } });
  const saves = (apiFetch) => apiFetch.mock.calls.filter(([, options]) => options?.body?.id === 'save').map(([, options]) => options.body.configuration);

  const own = { ...initial, fetch_columns: ['A', 'FEE'], columns_origins: { fetch_columns: 'override', search_columns_strict: 'profile' }, columns_default: { fetch_columns: ['A', 'B'] } };
  const confirm = async (name) => userEvent.click(await screen.findByRole('button', { name }));

  it('own columns are saved apart, the changed list only, and leave the form’s edits alone', async () => {
    const apiFetch = vi.fn(async () => ({ message: 'success', results: { configuration: own } }));
    render(<Harness apiFetch={apiFetch} item={at('connections')} initial={initial} />);
    const region = screen.getByRole('region', { name: 'Own columns' });
    const input = within(region).getByRole('textbox', { name: 'Own Fetch columns' });
    await userEvent.clear(input);
    await userEvent.type(input, 'A, B C');
    expect(within(region).getByRole('alert')).toHaveTextContent('“B C”');
    await userEvent.clear(input);
    await userEvent.type(input, 'A, FEE');
    await userEvent.click(within(region).getByRole('button', { name: 'Save own columns' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('added FEE, removed B');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves(apiFetch)).toEqual([{ fetch_columns: ['A', 'FEE'] }]));
    await waitFor(() => expect(within(region).getByText('Own')).toBeInTheDocument());
  });

  it('restores one list with null, and all of them in the session and the account', async () => {
    const apiFetch = vi.fn(async () => ({ message: 'success', results: { configuration: initial } }));
    const view = render(<Harness apiFetch={apiFetch} item={at('connections')} initial={own} />);
    let region = screen.getByRole('region', { name: 'Own columns' });
    expect(region).toHaveTextContent('The domain’s: A, B.');
    await userEvent.click(within(region).getByRole('button', { name: 'Restore Fetch columns' }));
    await confirm('Restore');
    await waitFor(() => expect(saves(apiFetch)).toEqual([{ fetch_columns: null }]));
    view.unmount();
    apiFetch.mockClear();
    render(<Harness apiFetch={apiFetch} item={at('connections')} initial={own} />);
    region = screen.getByRole('region', { name: 'Own columns' });
    await userEvent.click(within(region).getByRole('button', { name: 'Restore all' }));
    await confirm('Restore');
    await waitFor(() => expect(apiFetch.mock.calls.map(([url, options]) => [url, options.body])).toContainEqual(['/account/configuration/reset', { section: 'columns', domain: 'bank' }]));
    expect(saves(apiFetch)).toEqual([{ fetch_columns: null, search_columns_strict: null, search_columns_fuzzy: null }]);
  });

  it('a save of the form sends no columns and no column mapping', async () => {
    const apiFetch = vi.fn(async () => ({ message: 'success', results: { configuration: initial } }));
    render(<Harness apiFetch={apiFetch} item={at('tools')} initial={initial} />);
    await editToolUrl('bolt://edited');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saves(apiFetch)).toHaveLength(1));
    ['fetch_columns', 'search_columns_strict', 'search_columns_fuzzy', 'column_mapping', 'columns_origins', 'column_mapping_origins', 'columns_default'].forEach((key) => expect(saves(apiFetch)[0]).not.toHaveProperty(key));
  });

  it('Rules shows the column mapping read-only and leads to its place in Domains', async () => {
    const apiFetch = vi.fn(async () => ({ results: { config: {} } }));
    render(<Harness apiFetch={apiFetch} item={at('rules')} initial={initial} />);
    const table = screen.getByRole('table', { name: 'Column mapping' });
    expect(table).toHaveTextContent('ACCOUNTNO');
    expect(table).toHaveTextContent('Profile');
    expect(within(table).queryByRole('textbox')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Open in Domains' }));
    expect(screen.getByRole('tab', { name: /Column mapping/ })).toHaveAttribute('aria-selected', 'true');
  });
});
