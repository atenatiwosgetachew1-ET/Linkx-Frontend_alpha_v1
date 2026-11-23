// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';

import AlertWorkflow from './AlertWorkflow.jsx';
import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { resetAlerts, setAlertDraft, setAlertsMode, upsertAlert } from '../lib/alertStore.js';

afterEach(() => {
  cleanup();
  resetAlerts();
});

const alert = (fields = {}) => ({
  id: 'a1', alert_id: 'a1', external_reference_id: 'STR-9', title: 'Rapid transfers', mock: true, trace_id: 'mock-a1', payload: { subject: 'Rapid transfers', reason: 'Moved on within hours.' },
  intake_status: 'complete', response_status: 'awaiting_analysis', assignee_user_id: 'u1', assignee_username: 'Me', assigned_by: 'Desk', ...fields,
});
const show = (fields) => {
  setAlertsMode('mock', { userId: 'u1' });
  act(() => { upsertAlert(alert(fields)); });
  render(<NotificationProvider><WorkspaceProvider><AlertWorkflow alertId="a1" mockControls /></WorkspaceProvider></NotificationProvider>);
  return screen.getByLabelText('STR alert procedure');
};

describe('AlertWorkflow (analysis-results-plan Phase 4)', () => {
  it('awaiting analysis: where it stands, step 1 next, the later steps waiting', () => {
    const panel = show();
    expect(panel).toHaveTextContent('Data complete');
    expect(panel).toHaveTextContent('Assigned to you by Desk');
    expect(panel).toHaveTextContent('Awaiting analysis');
    expect(within(screen.getByLabelText('Step 1: Analyse')).getByRole('button', { name: 'Run link analysis' })).toBeEnabled();
    expect(screen.getByLabelText('Step 1: Analyse')).toHaveClass('is-current');
    expect(within(screen.getByLabelText('Step 2: Extract results')).getByRole('button', { name: 'Extract results' })).toBeDisabled();
    expect(within(screen.getByLabelText('Step 3: Report back')).getByRole('button', { name: 'Send feedback' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reassign (mock)' })).toBeInTheDocument();
  });

  it('data still arriving, or assigned to someone else: the reason shown, nothing to run', () => {
    const panel = show({ intake_status: 'receiving', expected_records: 340, received_records: 120 });
    expect(panel).toHaveTextContent('Data arriving · 120 of 340 records');
    expect(screen.getByRole('button', { name: 'Run link analysis' })).toBeDisabled();
    expect(screen.getByLabelText('Step 1: Analyse')).toHaveTextContent('Its data is still arriving from the parent service.');
    cleanup();
    resetAlerts();
    show({ assignee_user_id: 'u2', assignee_username: 'A. Bekele' });
    expect(screen.getByLabelText('STR alert procedure')).toHaveTextContent('Assigned to A. Bekele');
    expect(screen.getByLabelText('Step 1: Analyse')).toHaveTextContent('only the assignee can analyse it');
  });

  it('analysed and extracted: the four fields to include, the verdict and comments; Send feedback ready', async () => {
    show({ response_status: 'analysed', flags: { FUND_FLOW: 2 } });
    act(() => {
      setAlertDraft('a1', {
        extractedAt: Date.now(), source: 'Graph 2 (the alert’s Graph window) and its linked windows', graphImage: 'data:image/png;base64,G', counts: { nodes: 18, links: 25 },
        tables: [{ title: 'Entities', total: 18, columns: [], rows: [] }], charts: [{ title: 'Degree Centrality' }], findings: 'A is the most connected.', comments: '', verdict: 'suspicious',
        include: { graph: true, table: true, charts: true },
      });
    });
    expect(screen.getByLabelText('Step 1: Analyse')).toHaveTextContent('Finished: FUND_FLOW 2.');
    const extract = screen.getByLabelText('Step 2: Extract results');
    expect(extract).toHaveTextContent('Graph 18 entities, 25 links');
    expect(extract).toHaveTextContent('Table Entities (18 rows)');
    expect(extract).toHaveTextContent('Charts Degree Centrality');
    expect(within(extract).getByRole('img', { name: "The alert's graph" })).toBeInTheDocument();
    await userEvent.type(within(extract).getByRole('textbox', { name: 'Analyst comments' }), 'Layered transfers.');
    await userEvent.click(within(extract).getByRole('checkbox', { name: /Charts/ }));
    expect(within(extract).getByRole('checkbox', { name: /Charts/ })).not.toBeChecked();
    expect(within(screen.getByLabelText('Step 3: Report back')).getByRole('button', { name: 'Send feedback' })).toBeEnabled();
  });

  it('acknowledged: every step done, nothing left to send', () => {
    show({ response_status: 'acknowledged', acknowledged_at: '2026-11-19T10:00:00Z' });
    expect(screen.getByLabelText('Step 3: Report back')).toHaveTextContent('The parent service acknowledged the findings');
    expect(screen.queryByRole('button', { name: 'Send feedback' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Step 3: Report back')).toHaveClass('is-done');
  });
});
