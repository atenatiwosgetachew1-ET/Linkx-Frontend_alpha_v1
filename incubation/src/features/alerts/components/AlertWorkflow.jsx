import React, { useState, useSyncExternalStore } from 'react';

import { INTAKE, RESPONSE, VERDICTS, analyseBlocker, intakeInfo, responseInfo } from '../lib/alertModel.js';
import { getAlertsSnapshot, setAlertDraft, subscribeAlerts } from '../lib/alertStore.js';
import {
  alertHasGraph, alertTaskId, downloadAlertFeedbackPdf, extractAlertResults, feedbackBlocker, openAlertGraph, runAlertAnalysis, sendAlertFeedback, simulateAlert,
} from '../lib/alertRuntime.js';
import { useCan } from '../../../auth/useCan.js';
import { SOURCE_PERMISSIONS } from '../../../auth/permissions.js';
import { requestTaskFocus } from '../../tasks/lib/taskRegistry.js';
import { useWorkspaceActions } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_CONTEXT_TABS, WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';

// An STR alert's procedure in its Reports detail (analysis-results-plan
// Phase 4; analyst decision 2026-11-19): where the alert stands (data,
// assignment, response), then three steps: 1 Analyse, 2 Extract results
// (graph, table, charts, summary of findings with the analyst's comments),
// 3 Report back. Its history below.
//
// alertId; mockControls: the mock's development controls (Reassign).
const time = (value) => (value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function Step({ number, title, state, children }) {
  return (
    <section className={`reports_alert_step is-${state}`} aria-label={`Step ${number}: ${title}`}>
      <header className="reports_alert_step_head">
        <span className="reports_alert_step_number" aria-hidden="true">{state === 'done' ? '✓' : number}</span>
        <strong>{title}</strong>
        <small>{state === 'done' ? 'Done' : state === 'current' ? 'Next' : state === 'locked' ? 'Waiting' : ''}</small>
      </header>
      <div className="reports_alert_step_body">{children}</div>
    </section>
  );
}

export default function AlertWorkflow({ alertId, mockControls = false }) {
  const state = useSyncExternalStore(subscribeAlerts, getAlertsSnapshot);
  const { openWindow } = useWorkspaceActions();
  const can = useCan();
  const [message, setMessage] = useState('');
  const alert = state.alerts.find((entry) => entry.id === String(alertId));
  if (!alert) return null;
  const draft = state.drafts[alert.id] || null;
  const busy = state.busy[alert.id] || '';
  const events = state.events[alert.id] || [];
  const intake = intakeInfo(alert.intake);
  const response = responseInfo(alert.response);
  const sent = [RESPONSE.SENT, RESPONSE.ACKNOWLEDGED].includes(alert.response);
  const analysed = [RESPONSE.ANALYSED, RESPONSE.SENDING, RESPONSE.SENT, RESPONSE.ACKNOWLEDGED, RESPONSE.FAILED].includes(alert.response);
  const hasGraph = alertHasGraph(alert);
  // The Service's permissions (H-9): analysis:run to analyse, alerts:feedback
  // to report back; alerts:read_all may analyse any alert. The mock skips them.
  const supervisor = !alert.mock && can('alerts:read_all');
  const analyseNote = (!alert.mock && !can(SOURCE_PERMISSIONS.ANALYSIS_RUN) ? 'Your account cannot run analyses (analysis:run).' : '') || analyseBlocker(alert, { supervisor });
  const sendNote = (!alert.mock && !can('alerts:feedback') ? 'Your account cannot report findings back (alerts:feedback).' : '') || feedbackBlocker(alert, draft);
  const taskId = alertTaskId(alert.id);
  const flags = Object.entries(alert.flags).filter(([, count]) => count > 0);
  const setDraft = (patch) => setAlertDraft(alert.id, patch);
  const run = async (action) => {
    setMessage('');
    const result = await action();
    if (result?.message) setMessage(result.message);
  };
  const openTask = () => {
    requestTaskFocus(taskId);
    openWindow(WORKSPACE_WINDOW_TYPES.TASKS, { title: 'Tasks', contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW });
  };

  const step1 = analysed ? 'done' : alert.response === RESPONSE.ANALYSING ? 'active' : analyseNote ? 'locked' : 'current';
  const step2 = sent ? 'done' : draft?.extractedAt ? 'done' : analysed ? 'current' : 'locked';
  const step3 = sent ? 'done' : draft?.extractedAt && alert.mine ? 'current' : 'locked';
  const include = draft?.include || { graph: true, table: true, charts: true };

  return (
    <div className="reports_alert" aria-label="STR alert procedure">
      <div className="reports_alert_status">
        <span className={`reports_alert_chip is-${intake.tone}`} title={alert.intakeNote || undefined}>
          {intake.label}
          {alert.intake === INTAKE.RECEIVING && alert.expectedRecords ? ` · ${alert.receivedRecords ?? 0} of ${alert.expectedRecords} records` : ''}
        </span>
        <span className={`reports_alert_chip is-${alert.mine ? 'resolved' : 'pending'}`}>
          {alert.mine ? `Assigned to you${alert.assignedBy ? ` by ${alert.assignedBy}` : ''}` : `Assigned to ${alert.assigneeName || 'another analyst'}`}
        </span>
        <span className={`reports_alert_chip is-${response.tone}`}>{response.label}</span>
        {alert.mock ? <span className="reports_alert_chip is-mock">Mock</span> : null}
      </div>
      {alert.reason ? <p className="reports_alert_reason">{alert.reason}</p> : null}

      <Step number={1} title="Analyse" state={step1}>
        <p>
          {alert.response === RESPONSE.ANALYSING
            ? 'Link analysis is running on the alert’s data; its graph opens when it finishes.'
            : analysed
              ? (flags.length ? `Finished: ${flags.map(([rule, count]) => `${rule} ${count}`).join(' · ')}.` : 'Finished: no rule flagged.')
              : analyseNote || (alert.responseNote && alert.response === RESPONSE.AWAITING
                ? `The last run failed: ${alert.responseNote} Run it again when ready.`
                : 'Run link analysis on the alert’s data. A task is recorded and the alert’s graph opens in a Graph window.')}
        </p>
        {alert.intake === INTAKE.INCOMPLETE && alert.intakeNote ? <p className="reports_alert_reason">{alert.intakeNote}</p> : null}
        <div className="reports_alert_actions">
          {!sent ? (
            <button type="button" className="reports_action is-primary" disabled={Boolean(analyseNote) || busy === 'analysing'} title={analyseNote || undefined} onClick={() => run(() => runAlertAnalysis(alert.id))}>
              {busy === 'analysing' || alert.response === RESPONSE.ANALYSING ? 'Analysing…' : analysed ? 'Run again' : 'Run link analysis'}
            </button>
          ) : null}
          <button type="button" className="reports_action" disabled={!hasGraph} title={hasGraph ? undefined : 'Available once the analysis has run'} onClick={() => openAlertGraph(alert.id)}>Open graph</button>
          {taskId ? <button type="button" className="reports_action" onClick={openTask}>View task</button> : null}
        </div>
      </Step>

      <Step number={2} title="Extract results" state={step2}>
        <p>
          {draft?.extractedAt
            ? `From ${draft.source}, ${time(draft.extractedAt)}. Choose what goes into the feedback.`
            : 'Gather the graph, the tables, the charts and a summary of findings from the alert’s Graph window and its linked Table and Chart windows (or the defaults).'}
        </p>
        <div className="reports_alert_actions">
          <button type="button" className="reports_action" disabled={!analysed || sent || busy === 'extracting'} title={!analysed ? 'Run the analysis first' : undefined} onClick={() => run(() => extractAlertResults(alert.id))}>
            {busy === 'extracting' ? 'Extracting…' : draft?.extractedAt ? 'Extract again' : 'Extract results'}
          </button>
        </div>
        {draft?.extractedAt ? (
          <div className="reports_alert_fields">
            <label className="reports_alert_field">
              <input type="checkbox" checked={include.graph} disabled={sent} onChange={(event) => setDraft({ include: { ...include, graph: event.target.checked } })} />
              <span><b>Graph</b> {draft.counts ? `${draft.counts.nodes} entities, ${draft.counts.links} links` : ''}</span>
              {draft.graphImage ? <img className="reports_alert_thumb" src={draft.graphImage} alt="The alert's graph" /> : <small>No picture (drawn in the browser only)</small>}
            </label>
            <label className="reports_alert_field">
              <input type="checkbox" checked={include.table} disabled={sent || !draft.tables?.length} onChange={(event) => setDraft({ include: { ...include, table: event.target.checked } })} />
              <span><b>Table</b> {draft.tables?.length ? draft.tables.map((table) => `${table.title} (${table.total} rows)`).join(', ') : 'none'}</span>
            </label>
            <label className="reports_alert_field">
              <input type="checkbox" checked={include.charts} disabled={sent || !draft.charts?.length} onChange={(event) => setDraft({ include: { ...include, charts: event.target.checked } })} />
              <span><b>Charts</b> {draft.charts?.length ? draft.charts.map((chart) => chart.title).join(', ') : 'none'}</span>
            </label>
            <div className="reports_alert_summary">
              <b>Summary of findings</b>
              <label className="reports_alert_line">
                <span>Verdict</span>
                <select className="reports_select" value={draft.verdict || ''} disabled={sent} onChange={(event) => setDraft({ verdict: event.target.value, verdictEdited: true })}>
                  <option value="">Choose…</option>
                  {VERDICTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </select>
              </label>
              <label className="reports_alert_text">
                <span>Key findings (one per line; drafted from the graph)</span>
                <textarea rows={4} value={draft.findings || ''} maxLength={6000} disabled={sent} onChange={(event) => setDraft({ findings: event.target.value, findingsEdited: true })} />
              </label>
              <label className="reports_alert_text">
                <span>Analyst comments</span>
                <textarea rows={3} value={draft.comments || ''} maxLength={4000} disabled={sent} placeholder="Your assessment for the parent service" onChange={(event) => setDraft({ comments: event.target.value })} />
              </label>
            </div>
          </div>
        ) : null}
      </Step>

      <Step number={3} title="Report back" state={step3}>
        <p>
          {alert.response === RESPONSE.ACKNOWLEDGED
            ? `The parent service acknowledged the findings${alert.acknowledgedAt ? ` (${time(alert.acknowledgedAt)})` : ''}.`
            : alert.response === RESPONSE.SENT
              ? `Sent${alert.feedbackSentAt ? ` ${time(alert.feedbackSentAt)}` : ''}, awaiting acknowledgement (the parent service may acknowledge later, or not at all).`
              : alert.response === RESPONSE.FAILED
                ? `Delivery failed: ${alert.responseNote || 'the parent service did not accept it'}. Retry when ready.`
                : sendNote || 'Send the findings to the parent service for this alert.'}
        </p>
        <div className="reports_alert_actions">
          {!sent ? (
            <button type="button" className="reports_action is-primary" disabled={Boolean(sendNote) || busy === 'sending'} title={sendNote || undefined} onClick={() => run(() => sendAlertFeedback(alert.id))}>
              {busy === 'sending' ? 'Sending…' : alert.response === RESPONSE.FAILED ? 'Retry sending' : 'Send feedback'}
            </button>
          ) : null}
          <button type="button" className="reports_action" disabled={!draft?.extractedAt} onClick={() => run(() => downloadAlertFeedbackPdf(alert.id))}>Download PDF</button>
        </div>
      </Step>

      {message ? <p className="reports_alert_message" role="alert">{message}</p> : null}
      {mockControls && alert.mock && alert.mine && !sent ? (
        <div className="reports_alert_actions is-dev">
          <button type="button" className="reports_action" onClick={() => simulateAlert('reassign', alert.id)}>Reassign (mock)</button>
        </div>
      ) : null}
      {events.length ? (
        <details className="reports_alert_history">
          <summary>History ({events.length})</summary>
          <ol>{events.map((event) => <li key={`${event.at}-${event.type}`}><time>{time(event.at)}</time> {event.text}</li>)}</ol>
        </details>
      ) : null}
    </div>
  );
}
