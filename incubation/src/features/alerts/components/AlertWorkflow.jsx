import React, { useId, useState, useSyncExternalStore } from 'react';

import { INTAKE, RESPONSE, VERDICTS, analyseBlocker, intakeInfo, responseInfo } from '../lib/alertModel.js';
import { getAlertsSnapshot, setAlertDraft, subscribeAlerts } from '../lib/alertStore.js';
import {
  alertHasGraph, alertTaskId, downloadAlertFeedbackPdf, openAlertCompanion, extractAlertResults, feedbackBlocker, openAlertGraph, runAlertAnalysis, sendAlertFeedback, simulateAlert,
} from '../lib/alertRuntime.js';
import { useCan } from '../../../auth/useCan.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { SettingsPopup } from '../../settings/components/SettingsPage.jsx';
import { SOURCE_PERMISSIONS } from '../../../auth/permissions.js';
import { settingsRemark } from '../../../shared/runSettings.js';
import { requestTaskFocus } from '../../tasks/lib/taskRegistry.js';
import { useWorkspaceActions } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_CONTEXT_TABS, WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';

// An STR alert's procedure in its Reports detail (analysis-results-plan
// Phase 4; analyst decision 2026-11-19): where the alert stands (data,
// assignment, response), then three steps: 1 Analyse, 2 Extract results
// (graph, table, charts, summary of findings with the analyst's comments),
// 3 Report back, on a vertical stepper (a rail with a mark per step). The
// action of the step to do now is the primary (themed) one; a re-run is
// not. Its history is AlertHistory, on the details' History tab. The
// extracted results (what to include, the summary of findings) open in
// their own popup over the details from the Result button. Buttons and fields are the popup's own (graph_customize).
//
// alertId; mockControls: the mock's development controls (Reassign).
const time = (value) => (value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// The Extracted results' parts: an icon each.
const STAT_ICONS = {
  entities: ['M12 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M19 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z', 'M10.8 7.8 6.2 16.2', 'M13.2 7.8l4.6 8.4'],
  links: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
  tables: ['M4 5h16v14H4z', 'M4 10h16', 'M4 14.5h16', 'M10 10v9'],
  charts: ['M4 20h16', 'M7 16v-5', 'M12 16V6', 'M17 16v-8'],
};

// A step on the stepper: its mark on the rail (number, ✓ when done), its
// title with where it stands, then what to do and its actions.
const STEP_STATE = { done: 'Done', current: 'Next', active: 'Running', locked: 'Waiting' };

function Step({ number, title, state, children }) {
  return (
    <li className={`reports_alert_step_item is-${state}`}>
      <span className="reports_alert_step_mark" aria-hidden="true">{state === 'done' ? '✓' : number}</span>
      <section className={`reports_alert_step is-${state}`} aria-label={`Step ${number}: ${title}`}>
        <header className="reports_alert_step_head">
          <strong>{title}</strong>
          {STEP_STATE[state] ? <small className={`reports_alert_step_state is-${state}`}>{STEP_STATE[state]}</small> : null}
        </header>
        <div className="reports_alert_step_body">{children}</div>
      </section>
    </li>
  );
}

export default function AlertWorkflow({ alertId, mockControls = false }) {
  const state = useSyncExternalStore(subscribeAlerts, getAlertsSnapshot);
  const { openWindow } = useWorkspaceActions();
  const can = useCan();
  const [message, setMessage] = useState(null); // { ok, text }: a note (ok) or why it failed
  const [resultsOpen, setResultsOpen] = useState(false); // the Extracted results popup
  const [resultsNote, setResultsNote] = useState(''); // why an Open in that popup did not work
  const fieldId = useId();
  const { requestConfirmation } = useNotifications();
  const alert = state.alerts.find((entry) => entry.id === String(alertId));
  if (!alert) return null;
  const draft = state.drafts[alert.id] || null;
  const busy = state.busy[alert.id] || '';
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
    setMessage(null);
    const result = await action();
    if (result?.message) setMessage({ ok: Boolean(result.ok), text: result.message });
  };
  const openTask = () => {
    requestTaskFocus(taskId);
    openWindow(WORKSPACE_WINDOW_TYPES.TASKS, { title: 'Tasks', contextTab: WORKSPACE_CONTEXT_TABS.OVERVIEW });
  };

  const step1 = analysed ? 'done' : alert.response === RESPONSE.ANALYSING ? 'active' : analyseNote ? 'locked' : 'current';
  const step2 = sent ? 'done' : draft?.extractedAt ? 'done' : analysed ? 'current' : 'locked';
  const step3 = sent ? 'done' : draft?.extractedAt && alert.mine ? 'current' : 'locked';
  const include = draft?.include || { graph: true, table: true, charts: true };
  // Extracted results popup: a line per part, its figures with it (no
  // separate overview of the same numbers).
  const n = (value) => Number(value || 0).toLocaleString();
  const includeRows = draft?.extractedAt ? [
    {
      id: 'graph', label: 'Graph', icon: STAT_ICONS.entities, empty: false, checked: include.graph, open: 'Open graph',
      figures: draft.counts ? [{ key: 'n', value: n(draft.counts.nodes), unit: ' entities' }, { key: 'l', value: n(draft.counts.links), unit: ' links' }] : [],
    },
    {
      id: 'table', label: 'Table', icon: STAT_ICONS.tables, empty: !draft.tables?.length, checked: include.table && Boolean(draft.tables?.length), open: 'Open table',
      figures: (draft.tables || []).map((table) => ({ key: table.title, value: table.title, unit: ` · ${n(table.total)} rows` })),
    },
    {
      id: 'charts', label: 'Charts', icon: STAT_ICONS.charts, empty: !draft.charts?.length, checked: include.charts && Boolean(draft.charts?.length), open: 'Open charts',
      figures: (draft.charts || []).map((chart) => ({ key: chart.title, value: chart.title, unit: '' })),
    },
  ] : [];
  const includedCount = includeRows.filter((row) => row.checked).length;
  // The verdict: moving off the one the system set asks first.
  const chooseVerdict = async (entry) => {
    if (!draft || draft.verdict === entry.id) return;
    const system = VERDICTS.find((item) => item.id === draft.systemVerdict);
    if (system && draft.verdict === system.id) {
      const reason = flags.length ? ` from its flagged rules (${flags.map(([rule, count]) => `${rule} ${count}`).join(', ')})` : ' from the Service’s own verdict';
      const ok = await requestConfirmation({
        title: 'Change the verdict',
        message: `The system set this alert's verdict to ${system.label}${reason}. Change it to ${entry.label}?`,
        confirmText: `Set ${entry.label}`,
        icon: 'warning',
      });
      if (!ok) return;
    }
    setDraft({ verdict: entry.id, verdictEdited: true });
  };

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

      <ol className="reports_alert_steps">
      <Step number={1} title="Analyse" state={step1}>
        <p>
          {alert.response === RESPONSE.ANALYSING
            ? 'Link analysis is running on the alert’s data. Open its graph when it finishes.'
            : analysed
              ? (flags.length ? `Finished: ${flags.map(([rule, count]) => `${rule} ${count}`).join(' · ')}.` : 'Finished: no rule flagged.')
              : analyseNote || (alert.responseNote && alert.response === RESPONSE.AWAITING
                ? `The last run failed: ${alert.responseNote} Run it again when ready.`
                : 'Run link analysis on the alert’s data. A task is recorded; open the alert’s graph from here when it has run.')}
        </p>
        {analysed && alert.settingsUsed ? <p className="reports_alert_reason">{settingsRemark(alert.settingsUsed).text}</p> : null}
        {alert.intake === INTAKE.INCOMPLETE && alert.intakeNote ? <p className="reports_alert_reason">{alert.intakeNote}</p> : null}
        <div className="reports_alert_actions">
          {!sent ? (
            <button type="button" className={`graph_customize_button${step1 === 'current' || step1 === 'active' ? ' is-primary' : ''}`} disabled={Boolean(analyseNote) || busy === 'analysing'} title={analyseNote || undefined} onClick={() => run(() => runAlertAnalysis(alert.id))}>
              {busy === 'analysing' || alert.response === RESPONSE.ANALYSING ? 'Analysing…' : analysed ? 'Run again' : 'Run link analysis'}
            </button>
          ) : null}
          <button type="button" className="graph_customize_button" disabled={!hasGraph} title={hasGraph ? undefined : 'Available once the analysis has run'} onClick={() => openAlertGraph(alert.id)}>Open graph</button>
          {taskId ? <button type="button" className="graph_customize_button" onClick={openTask}>View task</button> : null}
        </div>
      </Step>

      <Step number={2} title="Extract results" state={step2}>
        <p>
          {draft?.extractedAt
            ? `From ${draft.source}, ${time(draft.extractedAt)}. Open Result to choose what goes into the feedback and write the summary of findings.`
            : 'Gather the graph, the tables, the charts and a summary of findings from the alert’s Graph window and its linked Table and Chart windows (or the defaults).'}
        </p>
        <div className="reports_alert_actions">
          <button type="button" className={`graph_customize_button${step2 === 'current' ? ' is-primary' : ''}`} disabled={!analysed || sent || busy === 'extracting'} title={!analysed ? 'Run the analysis first' : undefined} onClick={() => run(() => extractAlertResults(alert.id))}>
            {busy === 'extracting' ? 'Extracting…' : draft?.extractedAt ? 'Extract again' : 'Extract results'}
          </button>
          {draft?.extractedAt ? (
            <button type="button" className="graph_customize_button reports_alert_result_button" aria-haspopup="dialog" onClick={() => setResultsOpen(true)}>Result</button>
          ) : null}
        </div>
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
            <button type="button" className={`graph_customize_button${step3 === 'current' ? ' is-primary' : ''}`} disabled={Boolean(sendNote) || busy === 'sending'} title={sendNote || undefined} onClick={() => run(() => sendAlertFeedback(alert.id))}>
              {busy === 'sending' ? 'Sending…' : alert.response === RESPONSE.FAILED ? 'Retry sending' : 'Send feedback'}
            </button>
          ) : null}
          <button type="button" className="graph_customize_button" disabled={!draft?.extractedAt} onClick={() => run(() => downloadAlertFeedbackPdf(alert.id))}>Download PDF</button>
        </div>
      </Step>
      </ol>

      {resultsOpen && draft?.extractedAt ? (
        <SettingsPopup
          hostSelector=".reports_window"
          title="Extracted results"
          subtitle={alert.reference || undefined}
          hint={`From ${draft.source}, ${time(draft.extractedAt)}.`}
          onClose={() => { setResultsOpen(false); setResultsNote(''); }}
          footer={<button type="button" className="graph_customize_button is-primary" onClick={() => { setResultsOpen(false); setResultsNote(''); }}>Done</button>}
        >
          {/* What goes into the feedback (a line per part with its figures
              and a switch; no picture of the graph here, the STR details'
              Open graph shows it), then the summary of findings: the
              verdict as a segmented choice and the two texts with their
              counts. The popup's own sections, fields and colours. */}
          <div className={`reports_alert_results${draft.verdict ? ` is-${draft.verdict}` : ''}`}>
            <section className="reports_alert_results_part" aria-label="Include in the feedback">
              <h5 className="reports_alert_results_head">Include in the feedback<small>{includedCount} of 3</small></h5>
              <div className="reports_alert_fields">
                {includeRows.map((row) => (
                  <div key={row.id} className={`reports_alert_field is-${row.id}${row.empty ? ' is-empty' : ''}`}>
                    <span className="reports_alert_field_icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
                        {row.icon.map((d) => <path key={d} d={d} />)}
                      </svg>
                    </span>
                    <label className="reports_alert_field_text" htmlFor={`${fieldId}-${row.id}`}>
                      <b>{row.label}</b>
                      <span className="reports_alert_field_figures">
                        {row.figures.length
                          ? row.figures.map((figure) => <span key={figure.key} className="reports_alert_figure"><strong>{figure.value}</strong>{figure.unit}</span>)
                          : <span className="reports_alert_figure is-none">None extracted</span>}
                      </span>
                    </label>
                    <button
                      type="button"
                      className="reports_alert_field_open linkx_tooltip_anchor"
                      disabled={!hasGraph}
                      aria-label={row.open}
                      data-tooltip={hasGraph ? row.open : 'Available once the analysis has run'}
                      onClick={async () => {
                        setResultsNote('');
                        if (row.id === 'graph') { openAlertGraph(alert.id); return; }
                        const result = await openAlertCompanion(alert.id, row.id === 'table' ? 'table' : 'chart');
                        if (!result.ok) setResultsNote(result.message);
                      }}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
                        <path d="M14 4h6v6" />
                        <path d="M20 4l-8.5 8.5" />
                        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                      </svg>
                    </button>
                    <span className="settings_switch"><input id={`${fieldId}-${row.id}`} type="checkbox" checked={row.checked} disabled={sent || row.empty} onChange={(event) => setDraft({ include: { ...include, [row.id]: event.target.checked } })} /></span>
                  </div>
                ))}
              </div>
              {resultsNote ? <p className="reports_alert_message" role="alert">{resultsNote}</p> : null}
            </section>

            <section className="reports_alert_results_part" aria-label="Summary of findings">
              <h5 className="reports_alert_results_head">Summary of findings</h5>
              <div className="reports_alert_line" role="radiogroup" aria-label="Verdict">
                <span>Verdict</span>
                <div className="graph_customize_segments reports_alert_verdicts">
                  {VERDICTS.map((entry) => {
                    const auto = draft.systemVerdict === entry.id;
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        role="radio"
                        aria-checked={draft.verdict === entry.id}
                        aria-label={auto ? `${entry.label} (the system's verdict)` : entry.label}
                        disabled={sent}
                        className={`graph_customize_segment is-${entry.id}${draft.verdict === entry.id ? ' is-current' : ''}${auto ? ' is-auto' : ''}`}
                        onClick={() => chooseVerdict(entry)}
                      >
                        <i aria-hidden="true" />{entry.label}
                        {auto ? <small className="reports_alert_verdict_auto" aria-hidden="true">Auto</small> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="reports_alert_text">
                <span>Key findings <em>one per line; drafted from the graph</em><small>{(draft.findings || '').length.toLocaleString()} / 6,000</small></span>
                <textarea className="graph_customize_input" aria-label="Key findings" rows={5} value={draft.findings || ''} maxLength={6000} disabled={sent} onChange={(event) => setDraft({ findings: event.target.value, findingsEdited: true })} />
              </label>
              <label className="reports_alert_text">
                <span>Analyst comments<small>{(draft.comments || '').length.toLocaleString()} / 4,000</small></span>
                <textarea className="graph_customize_input" aria-label="Analyst comments" rows={3} value={draft.comments || ''} maxLength={4000} disabled={sent} placeholder="Your assessment for the parent service" onChange={(event) => setDraft({ comments: event.target.value })} />
              </label>
            </section>
          </div>
        </SettingsPopup>
      ) : null}

      {message ? (message.ok
        ? <p className="reports_alert_message is-ok" role="status">{message.text}</p>
        : <p className="reports_alert_message" role="alert">{message.text}</p>) : null}
      {mockControls && alert.mock && alert.mine && !sent ? (
        <div className="reports_alert_actions is-dev">
          <button type="button" className="graph_customize_button" onClick={() => simulateAlert('reassign', alert.id)}>Reassign (mock)</button>
        </div>
      ) : null}
    </div>
  );
}

// The alert's history, newest last, for the details' History tab.
export function AlertHistory({ alertId }) {
  const state = useSyncExternalStore(subscribeAlerts, getAlertsSnapshot);
  const events = state.events[String(alertId)] || [];
  if (!events.length) return <p className="reports_alert_history_empty">Nothing has happened to this alert yet.</p>;
  return (
    <ol className="reports_alert_history" aria-label="Alert history">
      {events.map((event) => (
        <li key={`${event.at}-${event.type}`}>
          <time>{time(event.at)}</time>
          <span>{event.text}</span>
        </li>
      ))}
    </ol>
  );
}
