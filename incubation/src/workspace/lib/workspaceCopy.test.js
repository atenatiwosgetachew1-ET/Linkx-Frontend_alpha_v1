// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildWorkspaceCopy, isRememberingWorkspace, readTabCopy, readWorkspaceCopy, setRememberingWorkspace, windowOutcome, workspaceOwnerKey, writeTabCopy, writeWorkspaceCopy } from './workspaceCopy.js';
import { nextSourceWindowNumber } from './sourceWindowIds.js';
import { resolveSourceDefaults } from '../../features/source/lib/sourceConfig.js';
import { leaveReasons } from './leaveReasons.js';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const DAY = 24 * 60 * 60 * 1000;
const workspace = (windows) => ({ windows, orientation: 'docked', contextTab: 'info', activeWindowId: windows[0]?.id });
const tasksWindow = { id: 'tasks-1', type: 'tasks' };

describe('what is kept', () => {
  it('never holds secrets, files, searches, filters, rules or graph contents', () => {
    const copy = buildWorkspaceCopy(workspace([
      {
        id: 'source-1', type: 'source', customTitle: 'Bole', sourceSessionId: '1_9', metadata: { windowPosition: { x: 5, y: 6 }, windowSize: { width: 700, height: 500 } },
        sourceState: {
          mode: 'batch', autofillApplied: true,
          batch: { toolUrl: 'bolt://u:SECRET@host', toolUsername: 'neo', toolPassword: 'SECRET', toolPasswordRef: 'SECRET', brokerAddress: 'host:9092', rule: 'FUND_FLOW', selectedFiles: ['SECRET.csv'], searchQuery: 'SECRET', storageSearchQuery: 'SECRET', storageSearchResults: ['SECRET'], dataframeInfo: { columns: ['SECRET'] }, dataframeFilter: { rows: 'SECRET' }, dataframeStatus: 'ready', streamStatus: 'running' },
        },
      },
      { id: 'graph-2', type: 'graph', metadata: { evidence: { traceId: 't1', reportId: 7, nodes: ['SECRET'] }, graphSearch: { text: 'SECRET' }, graphElementFilters: { a: 'SECRET' }, graphSettings: { showLabels: true, formatting: { rules: ['SECRET'] } } } },
      { id: 'table-3', type: 'table', metadata: { tableGraph: 'graph-2', tableState: { tab: 'links', filter: 'SECRET', columns: { nodes: { hidden: ['Age'] } } } } },
      { id: 'reports-4', type: 'reports', metadata: { reportsUi: { tabId: 'evidence', selectedId: 7, filters: { search: 'SECRET', status: 'all' } } } },
      { id: 'settings-5', type: 'settings', metadata: { settingsUi: { activeTab: 'users', users: { draft: { password: 'SECRET' } } } } },
    ]));
    expect(JSON.stringify(copy)).not.toContain('SECRET');
    const [source, graph, table, reports, settings] = copy.windows;
    expect(source).toMatchObject({ customTitle: 'Bole', metadata: { windowPosition: { x: 5, y: 6 } }, sourceState: { mode: 'batch', batch: { toolUsername: 'neo', brokerAddress: 'host:9092', rule: 'FUND_FLOW' } } });
    expect(source.sourceState.batch).not.toHaveProperty('dataframeStatus');
    expect(source).not.toHaveProperty('sourceSessionId');
    expect(graph).toMatchObject({ graph: 'evidence', metadata: { evidence: { traceId: 't1', reportId: 7 }, graphSettings: { showLabels: true } } });
    expect(table.metadata.tableState).toEqual({ tab: 'links', columns: { nodes: { hidden: ['Age'] } } });
    expect(reports.metadata.reportsUi).toMatchObject({ tabId: 'evidence', selectedId: 7 });
    expect(settings.metadata).toEqual({ settingsUi: { activeTab: 'users' } });
  });

  it('keeps the analyst’s values, not the defaults of the day', () => {
    const sourceDefaults = resolveSourceDefaults({ active_kafka_adress: 'kafka:9092', active_kafka_topic: 'tx', active_tool_url: 'bolt://t', active_tool_username: 'neo' });
    const kept = (batch) => buildWorkspaceCopy(workspace([{ id: 's', type: 'source', sourceState: { mode: 'batch', batch } }]), { sourceDefaults }).windows[0].sourceState.batch;
    const prefilled = kept({ brokerAddress: 'kafka:9092', topic: 'tx', toolUrl: 'bolt://t', toolUsername: 'neo', sourceStatus: 'connected' });
    ['brokerAddress', 'topic', 'toolUrl', 'toolUsername', 'reconnect'].forEach((key) => expect(prefilled).not.toHaveProperty(key));
    expect(kept({ brokerAddress: 'mine:9092', topic: 'tx', toolUrl: 'bolt://mine', sourceStatus: 'connected' }))
      .toEqual({ brokerAddress: 'mine:9092', topic: 'tx', brokerUseDefault: false, toolUrl: 'bolt://mine', reconnect: true });
    expect(kept({ brokerAddress: 'mine:9092', topic: 'tx', sourceStatus: 'idle' })).not.toHaveProperty('reconnect');
    expect(kept({ brokerAddress: `mine:9092,${'x'.repeat(400)}`, topic: 'tx' })).not.toHaveProperty('brokerAddress');
  });

  it('says what comes back', () => {
    const copy = buildWorkspaceCopy(workspace([
      { id: 'g1', type: 'graph', metadata: { evidence: { traceId: 't' } } },
      { id: 'g2', type: 'graph', metadata: { graphLinkSource: '1_9' } },
      { id: 'g3', type: 'graph', metadata: { graphBlank: true } },
      { id: 'g4', type: 'graph', metadata: {} },
      { id: 't1', type: 'table', metadata: { tableGraph: 'g1' } },
      { id: 't2', type: 'table', metadata: { tableGraph: 'g2' } },
      { id: 's1', type: 'source' },
    ]), { hasNodes: (id) => id === 'g3' });
    expect(copy.windows.map((item) => windowOutcome(item, copy).state)).toEqual(['full', 'lost', 'lost', 'full', 'full', 'partial', 'partial']);
    // Read back, it says the same.
    const again = buildWorkspaceCopy(JSON.parse(JSON.stringify(copy)));
    expect(again.windows.map((item) => item.graph)).toEqual(copy.windows.map((item) => item.graph));
  });
});

describe('where it is kept', () => {
  const copy = (savedAt = Date.now()) => buildWorkspaceCopy(workspace([tasksWindow]), { now: savedAt });

  it('belongs to one user, for seven days', () => {
    const ana = workspaceOwnerKey({ id: 1, username: 'ana' });
    writeWorkspaceCopy(ana, copy());
    expect(readWorkspaceCopy(ana).windows).toHaveLength(1);
    expect(readWorkspaceCopy(workspaceOwnerKey({ id: 2, username: 'ben' }))).toBeNull();
    expect(readWorkspaceCopy(ana, Date.now() + 8 * DAY)).toBeNull();
  });

  it('survives damaged storage, and an empty workspace has none', () => {
    localStorage.setItem('linkx.workspace.last.v1', '{broken');
    expect(readWorkspaceCopy('a')).toBeNull();
    writeWorkspaceCopy('a', copy());
    writeWorkspaceCopy('a', buildWorkspaceCopy(workspace([])));
    expect(readWorkspaceCopy('a')).toBeNull();
    expect(buildWorkspaceCopy({ windows: [null, { type: 'evil', id: 'x' }, 3] }).windows).toEqual([]);
  });

  it('the setting turns it off and forgets what was kept', () => {
    expect(isRememberingWorkspace()).toBe(true);
    writeWorkspaceCopy('a', copy());
    writeTabCopy('a', copy());
    setRememberingWorkspace(false);
    expect(localStorage.getItem('linkx.workspace.last.v1')).toBeNull();
    expect(sessionStorage.length).toBe(0);
    writeWorkspaceCopy('a', copy());
    setRememberingWorkspace(true);
    expect(readWorkspaceCopy('a')).toBeNull();
  });

  it('a tab keeps its own, for the same user only', () => {
    writeTabCopy('a', copy());
    expect(readTabCopy('a').windows).toHaveLength(1);
    expect(readTabCopy('b')).toBeNull();
  });
});

describe('Source window numbers', () => {
  it('are never used twice in a main session', () => {
    expect([nextSourceWindowNumber('9', 1), nextSourceWindowNumber('9', 2), nextSourceWindowNumber('9', 1)]).toEqual([1, 2, 3]);
    expect(nextSourceWindowNumber('10', 1)).toBe(1);
    expect(nextSourceWindowNumber('9', 1)).toBe(4);
  });

  it('fall back to the page’s counter when nothing can be stored', () => {
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(nextSourceWindowNumber('9', 3)).toBe(3);
    set.mockRestore();
  });
});

it('a finished run’s kept graph comes back by its id (B-37)', () => {
  const copy = buildWorkspaceCopy({ windows: [{ id: 'g', type: 'graph', metadata: { graphTaskId: 'T5', taskId: 'local' } }, { id: 't', type: 'table', metadata: { tableGraph: 'g' } }], activeWindowId: 'g' }, { hasNodes: () => true });
  expect(copy.windows[0]).toMatchObject({ graph: 'run', metadata: { graphTaskId: 'T5' } });
  expect(copy.windows[0].metadata).not.toHaveProperty('taskId');
  expect(copy.windows.map((item) => windowOutcome(item, copy).state)).toEqual(['full', 'full']);
});

describe('leaveReasons', () => {
  const task = (fields) => ({ origin: 'source', status: 'completed', ...fields });
  it('lists what would be lost, and nothing else', () => {
    expect(leaveReasons({ tasks: [task({ remote: true, status: 'running' }), task({ origin: 'parent', status: 'running' }), task({ foreign: true, heldSession: true })] })).toEqual([]);
    const reasons = leaveReasons({
      tasks: [task({ status: 'running' }), task({ status: 'starting' }), task({ status: 'running', unattended: true }), task({ heldSession: true })],
      windows: [{ id: 'g', type: 'graph' }],
      graphChanged: () => true,
    });
    expect(reasons).toEqual([
      '2 running analyses will be stopped.',
      '1 running analysis keeps running (it has a seat).',
      '1 finished background run keeps its session: its graph will be lost.',
      '1 graph was drawn or changed here: those changes will be lost.',
    ]);
  });
});
