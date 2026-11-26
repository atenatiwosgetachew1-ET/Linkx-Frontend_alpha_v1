// @vitest-environment jsdom
import React, { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { clearGraphStores, getGraphStore } from '../../graph/lib/graphStore.js';
import { forgetGraphState, handleGraphActions, publishGraphState, resetGraphLinkBus } from '../../graph/lib/graphLinkBus.js';
import TableWindowBody from './TableWindowBody.jsx';

afterEach(() => {
  cleanup();
  clearGraphStores();
  resetGraphLinkBus();
});

const GRAPH = {
  nodes: [
    { id: 'a', label: 'Abebe', amount: 2500 },
    { id: 'b', label: 'Bekele', amount: 900 },
    { id: 'c', label: 'Chala', amount: 12000 },
  ],
  edges: [{ id: 'e1', from: 'a', to: 'b', label: 'paid' }, { id: 'e2', from: 'b', to: 'c', label: 'called' }],
};

let workspaceRef;
// Opens a Graph window (its store filled and its state published, as a
// Graph window would) and a Table window, and renders the table live.
function Harness({ tableMetadata }) {
  workspaceRef = useWorkspace();
  const { windows, openWindow } = workspaceRef;
  useEffect(() => {
    openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id: 'graph-1', title: 'Graph' });
    openWindow(WORKSPACE_WINDOW_TYPES.TABLE, { id: 'table-1', title: 'Table', metadata: tableMetadata });
  }, [openWindow, tableMetadata]);
  const table = windows.find((item) => item.id === 'table-1');
  return table ? <TableWindowBody windowItem={table} /> : null;
}

const setup = ({ drawn = ['a', 'b'], selection = { nodes: [], edges: [] }, tableMetadata = { tableGraph: 'graph-1' } } = {}) => {
  const store = getGraphStore('graph-1');
  store.replace(GRAPH);
  const edgeKeys = store.graph().edges();
  publishGraphState('graph-1', { nodeIds: drawn, edgeIds: edgeKeys.slice(0, 1), selection });
  const actions = vi.fn();
  handleGraphActions('graph-1', actions);
  render(
    <NotificationProvider>
      <WorkspaceProvider>
        <Harness tableMetadata={tableMetadata} />
      </WorkspaceProvider>
    </NotificationProvider>,
  );
  return { store, actions, edgeKeys };
};

// Scope: a dropdown in the toolbar (one line).
const pickScope = async (label) => {
  await userEvent.click(screen.getByRole('button', { name: 'Scope' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${label}`) }));
};
const bodyRows = () => within(screen.getByRole('grid')).getAllByRole('row').slice(1);
const firstCells = () => bodyRows().map((row) => within(row).getAllByRole('gridcell')[0].textContent);

describe('TableWindowBody', () => {
  it('shows the drawn nodes of the linked graph; scope switches to all or the selection', async () => {
    setup({ selection: { nodes: ['c'], edges: [] } });
    expect(await screen.findByRole('grid', { name: 'Nodes' })).toBeInTheDocument();
    expect(firstCells()).toEqual(['Abebe', 'Bekele']);
    expect(screen.getByText('2 rows')).toBeInTheDocument();
    await pickScope('All');
    expect(firstCells()).toEqual(['Abebe', 'Bekele', 'Chala']);
    await pickScope('Selected');
    expect(firstCells()).toEqual(['Chala']);
    // Kept with the window.
    expect(workspaceRef.windows.find((item) => item.id === 'table-1').metadata.tableState.scope).toBe('selected');
  });

  it('follows the graph live: data edits and selection', async () => {
    const { store } = setup();
    await screen.findByRole('grid');
    act(() => store.updateNodes([['a', { label: 'Abebe K.' }]]));
    await waitFor(() => expect(firstCells()).toEqual(['Abebe K.', 'Bekele']));
    act(() => publishGraphState('graph-1', { nodeIds: ['a', 'b'], edgeIds: [], selection: { nodes: ['b'], edges: [] } }));
    expect(bodyRows()[1]).toHaveAttribute('aria-selected', 'true');
    expect(bodyRows()[0]).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  });

  it('sorts by a header click (numbers as numbers), then descending, then off', async () => {
    setup({ drawn: ['a', 'b', 'c'] });
    await screen.findByRole('grid');
    const amount = screen.getByRole('columnheader', { name: /amount/ });
    await userEvent.click(within(amount).getByRole('button'));
    expect(firstCells()).toEqual(['Bekele', 'Abebe', 'Chala']);
    expect(amount).toHaveAttribute('aria-sort', 'ascending');
    await userEvent.click(within(amount).getByRole('button'));
    expect(firstCells()).toEqual(['Chala', 'Abebe', 'Bekele']);
    await userEvent.click(within(amount).getByRole('button'));
    expect(firstCells()).toEqual(['Abebe', 'Bekele', 'Chala']);
  });

  it('filters rows and hides / moves columns', async () => {
    setup({ drawn: ['a', 'b', 'c'] });
    await screen.findByRole('grid');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter rows' }), 'chal');
    expect(firstCells()).toEqual(['Chala']);
    expect(screen.getByText('1 row (of 3)')).toBeInTheDocument();
    // Kept with the window once typing pauses (the graph report takes it).
    await waitFor(() => expect(workspaceRef.windows.find((item) => item.id === 'table-1').metadata.tableState.filter).toBe('chal'));
    await userEvent.clear(screen.getByRole('searchbox', { name: 'Filter rows' }));
    await userEvent.click(screen.getByRole('button', { name: /Columns/ }));
    const menu = screen.getByRole('dialog', { name: 'Columns' });
    await userEvent.click(within(menu).getByRole('checkbox', { name: 'Label' }));
    expect(screen.queryByRole('columnheader', { name: /Label/ })).not.toBeInTheDocument();
    expect(firstCells()).toEqual(['a', 'b', 'c']); // ID is first now
    await userEvent.click(within(menu).getByRole('button', { name: 'Move amount up' }));
    const headers = screen.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers.indexOf('amount')).toBeLessThan(headers.indexOf('Flags'));
    await userEvent.click(within(menu).getByRole('button', { name: 'Show all, original order' }));
    expect(screen.getByRole('columnheader', { name: /Label/ })).toBeInTheDocument();
  });

  it('a row click selects it on the graph (Ctrl adds); double-click and Enter focus it', async () => {
    const { actions } = setup({ selection: { nodes: ['a'], edges: [] } });
    await screen.findByRole('grid');
    await userEvent.click(bodyRows()[1]);
    expect(actions).toHaveBeenLastCalledWith({ type: 'select', nodes: ['b'], edges: [] });
    const user = userEvent.setup();
    await user.keyboard('{Control>}');
    await user.click(bodyRows()[1]);
    await user.keyboard('{/Control}');
    expect(actions).toHaveBeenLastCalledWith({ type: 'select', nodes: ['a', 'b'], edges: [] });
    await userEvent.dblClick(bodyRows()[0]);
    expect(actions).toHaveBeenLastCalledWith({ type: 'focus', nodes: ['a'], edges: [] });
    bodyRows()[1].focus();
    await userEvent.keyboard('{Enter}');
    expect(actions).toHaveBeenLastCalledWith({ type: 'focus', nodes: ['b'], edges: [] });
  });

  it('links: their ends by name; a click selects the link', async () => {
    const { actions, edgeKeys } = setup();
    await userEvent.click(await screen.findByRole('tab', { name: /Links/ }));
    const grid = screen.getByRole('grid', { name: 'Links' });
    expect(within(grid).getAllByRole('row')[1]).toHaveTextContent('paidAbebeBekele');
    await userEvent.click(bodyRows()[0]);
    expect(actions).toHaveBeenLastCalledWith({ type: 'select', nodes: [], edges: [edgeKeys[0]] });
  });

  it('Export: the rows as shown as CSV, copied for a spreadsheet; Refresh reads the graph again', async () => {
    setup();
    await screen.findByRole('grid');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Filter rows' }), 'Abe');
    const blobs = [];
    const createUrl = vi.fn((blob) => { blobs.push(blob); return 'blob:x'; });
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = createUrl;
    URL.revokeObjectURL = () => {};
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Export' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Export CSV' }));
      expect(blobs).toHaveLength(1);
      const text = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(blobs[0]);
      });
      const lines = text.replace(/^\ufeff/, '').trim().split('\r\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain('Abebe');
    } finally {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
    }
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Copy rows' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0].split('\n')).toHaveLength(2);
    // Refresh: the same rows, read again.
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(firstCells()).toEqual(['Abebe']);
  });

  it('Print table: a popup (rows, columns, page; page 1 previewed), then a PDF in the NBE frame: downloaded, or opened in a new tab to print', async () => {
    setup({ selection: { nodes: ['a'], edges: [] } });
    await screen.findByRole('grid');
    const printing = await import('../lib/tablePrint.js');
    const previews = await import('../lib/tablePreview.js');
    const autoPrint = vi.fn();
    const built = vi.spyOn(printing, 'buildTablePdf').mockResolvedValue({ output: () => new Blob(['%PDF-1.3']), autoPrint });
    const previewed = vi.spyOn(previews, 'tablePreview').mockResolvedValue('data:image/png;base64,PAGE1');
    const urls = [];
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = vi.fn(() => { urls.push(`blob:${urls.length}`); return urls.at(-1); });
    URL.revokeObjectURL = () => {};
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const tab = { document: { title: '' }, location: { href: '' }, close: vi.fn() };
    const opened = vi.spyOn(window, 'open').mockImplementation(() => tab);
    try {
      await userEvent.click(screen.getByRole('button', { name: 'Export' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Print table…' }));
      const dialog = screen.getByRole('dialog', { name: 'Print table' });
      // Defaults: the rows as shown, the columns in sight, Auto page.
      expect(within(dialog).getByRole('radio', { name: /As shown/ })).toBeChecked();
      expect(within(dialog).getByRole('radio', { name: /Selected on the graph/ }).closest('label')).toHaveTextContent('1 ·');
      expect(within(dialog).getByRole('radio', { name: /Auto/ })).toBeChecked();
      expect(within(dialog).getByRole('checkbox', { name: /^All/ })).toBeChecked();
      await waitFor(() => expect(within(dialog).getByRole('img', { name: /Page 1 of the table, A4 portrait/ })).toHaveAttribute('src', 'data:image/png;base64,PAGE1'));
      expect(previewed.mock.calls.at(-1)[2]).toMatchObject({ orientation: 'auto', source: expect.stringMatching(/^Source: .* · Nodes · Drawn scope$/) });
      // Download PDF.
      await userEvent.click(within(dialog).getByRole('button', { name: 'Download PDF' }));
      await waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
      expect(clicked.mock.contexts[0].download).toMatch(/^LinkxTable_.*_nodes_\d{8}-\d{4}\.pdf$/);
      expect(built.mock.calls.at(-1)[0]).toMatchObject({ orientation: 'auto' });
      expect(built.mock.calls.at(-1)[0].rows.map((row) => row.id)).toEqual(['a', 'b']);
      // Print: only the selected rows, landscape; a new tab with the PDF, set to print.
      await userEvent.click(screen.getByRole('button', { name: 'Export' }));
      await userEvent.click(screen.getByRole('menuitem', { name: 'Print table…' }));
      const again = screen.getByRole('dialog', { name: 'Print table' });
      await userEvent.click(within(again).getByRole('radio', { name: /Selected on the graph/ }));
      await userEvent.click(within(again).getByRole('radio', { name: /^Landscape/ }));
      await userEvent.click(within(again).getByRole('button', { name: 'Print' }));
      await waitFor(() => expect(tab.location.href).toMatch(/^blob:/));
      expect(opened).toHaveBeenCalledWith('', '_blank');
      expect(autoPrint).toHaveBeenCalled();
      expect(built.mock.calls.at(-1)[0]).toMatchObject({ orientation: 'landscape' });
      expect(built.mock.calls.at(-1)[0].rows.map((row) => row.id)).toEqual(['a']);
      expect(screen.queryByRole('dialog', { name: 'Print table' })).not.toBeInTheDocument();
    } finally {
      URL.createObjectURL = original.create;
      URL.revokeObjectURL = original.revoke;
      built.mockRestore();
      previewed.mockRestore();
      clicked.mockRestore();
      opened.mockRestore();
    }
  });

  it('unlinked: right-click ▸ New Graph window opens one and links the table to it', async () => {
    setup({ tableMetadata: {} });
    expect(await screen.findByText('Link a Graph window')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole('status'));
    const item = screen.getByRole('menuitem', { name: 'New Graph window' });
    expect(item).toHaveAttribute('aria-disabled', 'false');
    await userEvent.click(item);
    const graphs = workspaceRef.windows.filter((entry) => entry.type === WORKSPACE_WINDOW_TYPES.GRAPH);
    expect(graphs).toHaveLength(2);
    const table = workspaceRef.windows.find((entry) => entry.id === 'table-1');
    expect(table.metadata.tableGraph).toBe(graphs[1].id);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('unlinked: New Graph window is unavailable at the Graph / Chart / Table limit; linked, there is no such menu', async () => {
    setup({ tableMetadata: {} });
    await screen.findByText('Link a Graph window');
    act(() => {
      ['graph-2', 'graph-3', 'graph-4'].forEach((id) => workspaceRef.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id }));
    });
    fireEvent.contextMenu(screen.getByRole('status'));
    const item = screen.getByRole('menuitem', { name: 'New Graph window' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(item);
    expect(workspaceRef.windows.filter((entry) => entry.type === WORKSPACE_WINDOW_TYPES.GRAPH)).toHaveLength(4);
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    // Linked: the grid, and no menu.
    await userEvent.click(screen.getByRole('button', { name: 'Graph 1' }));
    fireEvent.contextMenu(await screen.findByRole('grid'));
    expect(screen.queryByRole('menuitem', { name: 'New Graph window' })).not.toBeInTheDocument();
  });

  it('without a link offers the open Graph windows; says when the linked one closed', async () => {
    setup({ tableMetadata: {} });
    expect(await screen.findByText('Link a Graph window')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Graph 1' }));
    expect(await screen.findByRole('grid')).toBeInTheDocument();
    act(() => {
      forgetGraphState('graph-1');
      workspaceRef.closeWindow('graph-1');
    });
    expect(await screen.findByText('The linked Graph window was closed')).toBeInTheDocument();
  });

  it('an empty graph still fetching: the loader; failed: says so; truly empty: no data yet', async () => {
    const { store } = setup();
    act(() => {
      store.replace({ nodes: [], edges: [] });
      store.setStatus({ state: 'queued', message: 'Queued…' });
    });
    expect(await screen.findByText('Loading the graph…')).toBeInTheDocument();
    act(() => store.setStatus({ state: 'error', message: 'The Service refused the request.' }));
    expect(await screen.findByText('The linked graph could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText('The Service refused the request.')).toBeInTheDocument();
    act(() => store.setStatus({ state: 'empty' }));
    expect(await screen.findByText('The linked graph has no data yet.')).toBeInTheDocument();
  });

  it("the Graph window's toolbar: linked graph, counts, Follow selection as a toggle", async () => {
    setup();
    const follow = await screen.findByRole('button', { name: 'Follow selection' });
    const before = follow.getAttribute('aria-pressed');
    await userEvent.click(follow);
    expect(follow).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
    // The linked graph: a dropdown of the Graph windows, and Show graph.
    await userEvent.click(screen.getByRole('button', { name: 'Linked graph' }));
    expect(screen.getByRole('menuitemradio', { name: /Graph/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitem', { name: 'Show graph' })).toBeInTheDocument();
    // One line: no wrapping.
    expect(getComputedStyle(document.querySelector('.table_toolbar')).flexWrap).not.toBe('wrap');
    expect(document.querySelector('.table_toolbar .graph_window_counts').textContent).toBe('2 nodes · 1 link · drawn');
  });

  it('alternate rows carry the stripe, by their place in the list', async () => {
    setup();
    await pickScope('All');
    const classes = bodyRows().map((row) => row.classList.contains('is-alt'));
    expect(classes).toEqual([false, true, false]);
  });
});
