// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';

import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { clearEvidenceGraphs } from '../lib/evidenceGraphs.js';
import ReportsWindowBody from './ReportsWindowBody.jsx';

afterEach(() => {
  cleanup();
  clearEvidenceGraphs();
});

const now = new Date().toISOString();
const inRunWindow = '2026-11-14T10:30:00Z'; // inside the Vigilance run below
const REPORTS = {
  parent: [
    { id: 11, report_type: 'STR', source_system: 'core-banking', status: 'new', created_at: now, external_reference_id: 'ALERT-1', payload: '{"entity_id":"ACC-1"}' },
    { id: 12, report_type: 'CTR', source_system: 'cards', status: 'resolved', created_at: now, external_reference_id: 'ALERT-2', payload: '{}' },
  ],
  xvigilance: [
    { id: 21, report_type: 'Vigilance', source_system: 'xvigilance', status: 'completed', created_at: inRunWindow, payload: { fraud_score: 92, score_band: 'fatal', run_id: 'run-7', anomaly_type: 'Fan-out' } },
    { id: 22, report_type: 'Vigilance', source_system: 'xvigilance', status: 'completed', created_at: inRunWindow, payload: { fraud_score: 30, score_band: 'medium', run_id: 'run-8' } },
  ],
  evidence: [
    { id: 31, report_type: 'Evidence', source_system: 'svc-aml', status: 'success', created_at: now, external_reference_id: 'EV-1', payload: { trace_id: 'trace-1', fraud_score: 70, score_band: 'high', flagged_rules: ['FUND_FLOW'], score_evidence: { config_version: 'v3', base_score_applied: 40, node_count_bonus: 10, financial_bonus: 20 } } },
  ],
};

const makeApi = ({ forbidden = false } = {}) => vi.fn(async (url) => {
  if (url === '/get_graph') return { results: { graph: { nodes: [{ id: 1 }, { id: 2 }], edges: [{ from: 1, to: 2 }] } } };
  if (forbidden) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }
  const tab = /reports\/(\w+)\?/.exec(url)?.[1];
  return { data: REPORTS[tab] || [], count: (REPORTS[tab] || []).length };
});

let workspaceRef;
function Probe() {
  workspaceRef = useWorkspace();
  return null;
}

const renderReports = ({ apiFetch = makeApi(), metadata = {}, domain = 'bank' } = {}) => {
  const windowItem = { id: 'r1', type: WORKSPACE_WINDOW_TYPES.REPORTS, title: 'Reports', metadata };
  const utils = render(
    <NotificationProvider>
      <SessionContext.Provider value={{ apiFetch, configuration: { active_domain: domain } }}>
        <WorkspaceProvider>
          <Probe />
          <ReportsWindowBody windowItem={windowItem} />
        </WorkspaceProvider>
      </SessionContext.Provider>
    </NotificationProvider>,
  );
  return { ...utils, apiFetch, windowItem };
};

const lastUrl = (apiFetch) => apiFetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/v1/reports')).at(-1);

describe('ReportsWindowBody', () => {
  it('loads Alert reports first, with the production columns', async () => {
    const { apiFetch } = renderReports();
    expect(await screen.findByText('core-banking')).toBeInTheDocument();
    expect(lastUrl(apiFetch)).toBe('/api/v1/reports/parent?limit=50&offset=0');
    expect(screen.getByRole('tab', { name: 'Alert reports' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('columnheader', { name: 'Fraud score' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Score band' })).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 to 2 of 2')).toBeInTheDocument();
  });

  it('switches tab and shows the scored columns, band filter and dates', async () => {
    const { apiFetch } = renderReports();
    await screen.findByText('core-banking');
    await userEvent.click(screen.getByRole('tab', { name: 'Service evidence' }));
    expect(await screen.findByText('svc-aml')).toBeInTheDocument();
    expect(lastUrl(apiFetch)).toBe('/api/v1/reports/evidence?limit=50&offset=0');
    expect(screen.getByRole('columnheader', { name: 'Fraud score' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Score band' })).toBeInTheDocument();
    expect(screen.getByLabelText('From date and time')).toBeInTheDocument();
  });

  it('never shows another tab\'s rows while a tab is loading', async () => {
    let releaseEvidence;
    const base = makeApi();
    const apiFetch = vi.fn((url, options) => (url.includes('/reports/evidence')
      ? new Promise((resolve) => { releaseEvidence = () => resolve(base(url, options)); })
      : base(url, options)));
    renderReports({ apiFetch, metadata: { reportsTab: 'parent', openSeq: 901 } });
    await screen.findByText('core-banking');
    await userEvent.click(screen.getByRole('tab', { name: 'Service evidence' }));
    expect(screen.queryByText('core-banking')).not.toBeInTheDocument();
    await act(async () => releaseEvidence());
    expect(await screen.findByText('svc-aml')).toBeInTheDocument();
    // Back to Alert reports: its own cached rows, not the evidence ones.
    await userEvent.click(screen.getByRole('tab', { name: 'Alert reports' }));
    expect(screen.getByText('core-banking')).toBeInTheDocument();
    expect(screen.queryByText('svc-aml')).not.toBeInTheDocument();
  });

  it('reloads on server filters and searches the loaded page instantly', async () => {
    const { apiFetch } = renderReports();
    await screen.findByText('core-banking');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'resolved');
    await waitFor(() => expect(lastUrl(apiFetch)).toContain('status=resolved'));
    const calls = apiFetch.mock.calls.length;
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search reports' }), 'cards');
    expect(apiFetch.mock.calls.length).toBe(calls); // no request per keystroke
    expect(screen.queryByText('core-banking')).not.toBeInTheDocument();
    expect(screen.getByText(/\(Filtered\)/)).toBeInTheDocument();
  });

  it('sorts from the sort menu', async () => {
    renderReports();
    await screen.findByText('core-banking');
    await userEvent.click(screen.getByRole('tab', { name: 'System reports' }));
    await screen.findByText('Fan-out');
    await userEvent.click(screen.getByRole('button', { name: 'Sort: Newest first' }));
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'Lowest fraud score' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    const scores = screen.getAllByRole('row').slice(1).map((row) => row.cells[3].textContent);
    expect(scores).toEqual(['30', '92']);
    expect(screen.getByRole('button', { name: 'Sort: Lowest fraud score' })).toBeInTheDocument();
  });

  it('explains a 403 as access denied', async () => {
    renderReports({ apiFetch: makeApi({ forbidden: true }) });
    expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  });

  it('opens a Vigilance run: System reports, its window as dates, its rows highlighted', async () => {
    const { apiFetch } = renderReports({
      metadata: { reportsTab: 'xvigilance', vigilanceRun: { window_start: '2026-11-14 10:00:00', window_end: '2026-11-14 11:00:00', run_id: 'run-7' } },
    });
    const row = (await screen.findByText('Fan-out')).closest('tr');
    expect(row).toHaveClass('is-highlighted');
    expect(screen.getByText('92').closest('tr')).toHaveClass('is-highlighted');
    expect(screen.getAllByRole('row').filter((item) => item.classList.contains('is-highlighted'))).toHaveLength(1);
    expect(lastUrl(apiFetch)).toContain('start_date=');
    expect(screen.getByLabelText('From date and time').value).not.toBe('');
  });

  it('shows report details with payload metrics and the CDR wording', async () => {
    renderReports({ domain: 'cdr' });
    await screen.findByText('core-banking');
    await userEvent.click(screen.getByRole('tab', { name: 'Service evidence' }));
    await userEvent.click(await screen.findByText('svc-aml'));
    const detail = screen.getByRole('complementary', { name: 'Report 31' });
    expect(within(detail).getByText('Flagged rules')).toBeInTheDocument();
    expect(within(detail).getByText('FUND_FLOW')).toBeInTheDocument();
    expect(within(detail).getByText('Volume bonus')).toBeInTheDocument();
    expect(within(detail).getByRole('region', { name: 'Fraud score' })).toHaveTextContent('70');
    // The payload starts collapsed.
    const toggle = within(detail).getByRole('button', { name: /Payload data/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(detail).queryByLabelText('Payload data', { selector: 'pre' })).not.toBeInTheDocument();
    await userEvent.click(toggle);
    expect(within(detail).getByLabelText('Payload data', { selector: 'pre' })).toHaveTextContent('"config_version": "v3"');
    await userEvent.click(toggle);
    await userEvent.click(within(detail).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('checks the evidence graph, then opens it in one Graph window', async () => {
    const { apiFetch } = renderReports();
    await screen.findByText('core-banking');
    await userEvent.click(screen.getByRole('tab', { name: 'Service evidence' }));
    await userEvent.click(await screen.findByText('svc-aml'));
    const open = await screen.findByRole('button', { name: 'Open graph' });
    await waitFor(() => expect(open).toBeEnabled());
    expect(apiFetch).toHaveBeenCalledWith('/get_graph', expect.objectContaining({ body: expect.objectContaining({ id: 'evidence', trace_id: 'trace-1' }) }));
    await userEvent.click(open);
    await userEvent.click(screen.getByRole('button', { name: 'Open graph' }));
    const graphs = workspaceRef.windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.GRAPH);
    expect(graphs).toHaveLength(1);
    expect(graphs[0].metadata.evidence).toEqual({ traceId: 'trace-1', reportId: 31, externalReferenceId: 'EV-1' });
    expect(apiFetch.mock.calls.filter(([url]) => url === '/get_graph')).toHaveLength(1); // probe result reused
  });

  it('has no graph outside Service evidence', async () => {
    renderReports();
    await userEvent.click(await screen.findByText('core-banking'));
    // Neither action can be used: no action bar at all.
    expect(screen.getByRole('complementary', { name: 'Report 11' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /graph/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download report' })).not.toBeInTheDocument();
  });

  it('comes back where it was left after the window body unmounts', async () => {
    const apiFetch = makeApi();
    const tree = (show) => (
      <NotificationProvider>
        <SessionContext.Provider value={{ apiFetch, configuration: {} }}>
          <WorkspaceProvider>
            <Probe />
            {show ? <WorkspaceReports /> : null}
          </WorkspaceProvider>
        </SessionContext.Provider>
      </NotificationProvider>
    );
    // The real flow: the window lives in workspace state, its metadata keeps the UI.
    function WorkspaceReports() {
      const workspace = useWorkspace();
      const windowItem = workspace.windows.find((item) => item.type === WORKSPACE_WINDOW_TYPES.REPORTS);
      return windowItem ? <ReportsWindowBody windowItem={windowItem} /> : null;
    }
    const { rerender } = render(tree(true));
    act(() => { workspaceRef.openWindow(WORKSPACE_WINDOW_TYPES.REPORTS); });
    await screen.findByText('core-banking');
    await userEvent.click(screen.getByRole('tab', { name: 'System reports' }));
    await userEvent.click(await screen.findByText('Fan-out'));
    await waitFor(() => expect(workspaceRef.windows[0].metadata.reportsUi).toMatchObject({ tabId: 'xvigilance', selectedId: 21 }));

    rerender(tree(false));
    rerender(tree(true));
    expect(screen.getByRole('tab', { name: 'System reports' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('table')).getByText('Fan-out')).toBeInTheDocument(); // cached page, no loading flash
    expect(screen.getByRole('complementary', { name: 'Report 21' })).toBeInTheDocument();
  });

  it('re-applies a new open request while already open', async () => {
    const { rerender, apiFetch, windowItem } = renderReports();
    await screen.findByText('core-banking');
    act(() => {
      rerender(
        <NotificationProvider>
          <SessionContext.Provider value={{ apiFetch, configuration: {} }}>
            <WorkspaceProvider>
              <ReportsWindowBody windowItem={{ ...windowItem, metadata: { reportsTab: 'xvigilance', openSeq: 2 } }} />
            </WorkspaceProvider>
          </SessionContext.Provider>
        </NotificationProvider>,
      );
    });
    expect(await screen.findByText('Fan-out')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'System reports' })).toHaveAttribute('aria-selected', 'true');
  });
});
