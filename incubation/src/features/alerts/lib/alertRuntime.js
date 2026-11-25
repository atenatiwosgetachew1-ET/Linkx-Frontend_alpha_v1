// Drives the STR alert workflow (analysis-results-plan Phase 4; analyst
// decision 2026-11-19), whichever windows are open: the service's events
// become alerts and notices; Analyse starts a task and opens the alert's
// graph; Extract results gathers the graph, tables, charts and findings
// into a draft; Report back sends it and follows its delivery.
//
// The environment (notify, the workspace) is set by the workspace frame
// (useParentAlerts); the service is the mock or the Service's (alertService).

import {
  INTAKE, RESPONSE, alertNotice, analyseBlocker, canSendFeedback, feedbackPayload, feedbackSizeProblem, noticeTypesFor,
} from './alertModel.js';
import {
  getAlert, getAlertsSnapshot, logAlertEvent, patchAlert, setAlertBusy, setAlertDraft, setAlertsMode, upsertAlert,
} from './alertStore.js';
import {
  TASK_ORIGINS, TASK_STATUSES, createTask, finishTask, getTask, getTaskByServerId, linkServerTask, markTaskRunning, updateTask,
} from '../../tasks/lib/taskRegistry.js';
import { cacheEvidenceGraph, getCachedEvidenceGraph } from '../../reports/lib/evidenceGraphs.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { getGraphStore, hasGraphStore } from '../../graph/lib/graphStore.js';
import { getGraphState } from '../../graph/lib/graphLinkBus.js';
import { renderOffscreenSnapshot, SNAPSHOT_DEFAULTS } from '../../graph/lib/offscreenSnapshot.js';
import { evidenceReportExtras, graphReportExtras } from '../../graph/report/reportExtras.js';
import { draftFindings, reportFacts, reportTimeline, reportDateTime, reportRangeOf, DEFAULT_MARKING } from '../../graph/report/graphReportModel.js';
import { downloadGraphReport, evidenceReportContext } from '../../graph/report/graphReportExport.js';
import { buildEvidencePayload, buildRelationshipPayload, fetchGraph } from '../../../services/graphApi.js';
import { getServiceRefusalCode, getServiceRefusalMessage } from '../../../services/apiErrors.js';

let env = {
  notify: () => {},
  openWindow: () => null,
  focusWindow: () => {},
  getWindows: () => [],
  onArrival: () => {},
  openReports: () => {},
  username: '',
  apiFetch: null,
  // alerts:read_all: may list all alerts and analyse any (H-4, H-9).
  supervisor: false,
};
let service = null;
let stopService = null;
let alertScope = 'me'; // the list's assignee filter: 'me' | 'all'
const taskByAlert = new Map(); // alertId -> local task id

export const setAlertEnvironment = (next) => {
  env = { ...env, ...next };
};
export const getAlertService = () => service;

const announce = (type, alert, extra) => {
  const notice = alertNotice(type, alert, extra);
  logAlertEvent(alert.id, type, notice.title);
  env.notify({
    ...notice,
    source: alert.mock ? 'STR alerts (mock)' : 'STR alerts',
    action: { label: 'Open in Reports', onClick: () => env.openReports(alert.id) },
  });
  if (type === 'received' || type === 'assigned') env.onArrival(alert);
};

// The alert's Graph window (bound to it), if open.
export const alertGraphWindow = (alertId) => env.getWindows()
  .find((item) => item.type === WORKSPACE_WINDOW_TYPES.GRAPH && String(item.metadata?.alert?.id ?? '') === String(alertId)) || null;

// The alert's graph (H-4, H-6): its analysis session's graph (read by the
// session id, as an analyst's own run), or once the run is saved as
// evidence the stored graph by trace id. The mock gives its graph with the
// run (cached by trace id).
const sessionGraphKey = (alert) => (alert?.sessionId ? `alert-session:${alert.sessionId}` : '');
const analysedStates = [RESPONSE.ANALYSED, RESPONSE.SENDING, RESPONSE.SENT, RESPONSE.ACKNOWLEDGED, RESPONSE.FAILED];
export const alertGraphData = (alert) => getCachedEvidenceGraph(alert?.traceId) || getCachedEvidenceGraph(sessionGraphKey(alert));
export const alertHasGraph = (alert) => Boolean(alert) && (Boolean(alertGraphData(alert))
  || (!alert.mock && ((alert.traceId && alert.hasGraph) || (alert.sessionId && analysedStates.includes(alert.response)))));

// The graph's data, from the cache or the Service. -> graph | null
export const ensureAlertGraph = async (alert) => {
  const cached = alertGraphData(alert);
  if (cached) return cached;
  if (!env.apiFetch || !alert || alert.mock) return null;
  const byTrace = Boolean(alert.traceId && alert.hasGraph);
  if (!byTrace && !alert.sessionId) return null;
  const graph = await fetchGraph(env.apiFetch, byTrace
    ? buildEvidencePayload(alert.traceId, { id: alert.reportId || alert.id, externalReferenceId: alert.reference })
    : buildRelationshipPayload(alert.sessionId, '*'));
  if (graph?.partial) throw new Error('The Service delivered only part of this alert\u2019s graph. Try again.');
  if (!graph?.nodes?.length && !graph?.edges?.length) return null;
  cacheEvidenceGraph(byTrace ? alert.traceId : sessionGraphKey(alert), graph);
  return graph;
};

export const openAlertGraph = (alertId) => {
  const alert = getAlert(alertId);
  if (!alertHasGraph(alert)) return null;
  const existing = alertGraphWindow(alertId);
  if (existing) {
    env.focusWindow(existing.id);
    return existing.id;
  }
  const bound = { id: alert.id, reference: alert.reference };
  const title = `STR ${alert.reference || alert.id}`;
  // Saved as evidence (or the mock's graph): the evidence graph by trace id.
  if (alert.traceId && (getCachedEvidenceGraph(alert.traceId) || alert.hasGraph)) {
    return env.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, {
      title: 'Graph',
      customTitle: title,
      metadata: {
        evidence: { traceId: alert.traceId, reportId: alert.reportId || alert.id, externalReferenceId: alert.reference, systemRules: Object.keys(alert.flags).filter((rule) => alert.flags[rule] > 0) },
        alert: bound,
      },
    });
  }
  // The run's session, as the Tasks window opens a finished run's graph.
  return env.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, {
    title: 'Graph',
    customTitle: title,
    metadata: { graphLinkSource: alert.sessionId, graphLinkAction: 'Link Analysis', graphFinishedRun: true, alert: bound },
  });
};

const onEvent = (event) => {
  if (event?.type === 'upsert' && event.alert) {
    const { alert, previous } = upsertAlert(event.alert);
    if (event.reason === 'seed') return;
    noticeTypesFor(previous, alert).forEach((type) => announce(type, alert));
    return;
  }
  if (event?.type === 'analysis') {
    const alert = getAlert(event.alertId);
    const taskId = taskByAlert.get(String(event.alertId)) || getTaskByServerId(event.taskId)?.id || '';
    if (event.phase === 'progress') {
      if (taskId) updateTask(taskId, { log: [...(getTask(taskId)?.log || []), event.line] });
      return;
    }
    if (event.phase === 'completed') {
      // The mock hands its graph over; the Service's is read from the run's
      // session when the Graph window opens (H-4).
      if (event.graph && event.traceId) cacheEvidenceGraph(event.traceId, { data: {}, ...event.graph });
      if (taskId) {
        updateTask(taskId, { flags: event.flags || {}, ...(event.verdict ? { verdict: event.verdict } : {}) });
        finishTask(taskId, TASK_STATUSES.COMPLETED, { message: 'Link analysis finished.' });
      }
      setAlertBusy(event.alertId, null);
      if (alert) {
        announce('analysis_completed', alert, { flags: event.flags });
        openAlertGraph(alert.id);
      }
      return;
    }
    if (event.phase === 'failed') {
      if (taskId) finishTask(taskId, TASK_STATUSES.FAILED, { message: event.message || 'The analysis failed.' });
      setAlertBusy(event.alertId, null);
      if (alert) announce('analysis_failed', alert, { message: event.message });
    }
  }
};

// Starts (or switches) the service; mode: 'off' | 'mock' | 'live'.
export const startAlertService = (nextService, { mode, userId = '', username = '', sub = '' } = {}) => {
  stopAlertService();
  setAlertsMode(mode || nextService?.kind || 'off', { userId, username, sub });
  if (!nextService) return;
  service = nextService;
  stopService = service.start(onEvent);
  // A summary of what is waiting, once (the seeded or listed alerts).
  Promise.resolve(service.list?.({ assignee: alertScope })).then((list) => {
    if (service !== nextService || !Array.isArray(list)) return;
    list.forEach((raw) => upsertAlert(raw));
    // Ready for the analyst (data complete; one still arriving is announced when it completes).
    const waiting = getAlertsSnapshot().alerts.filter((alert) => alert.mine && alert.intake === INTAKE.COMPLETE && [RESPONSE.AWAITING, RESPONSE.ANALYSED, RESPONSE.FAILED].includes(alert.response));
    if (waiting.length) {
      env.notify({
        title: `${waiting.length} STR ${waiting.length === 1 ? 'alert needs' : 'alerts need'} your analysis`,
        message: waiting.map((alert) => alert.reference || alert.title).join(', '),
        level: 'info',
        source: nextService.kind === 'mock' ? 'STR alerts (mock)' : 'STR alerts',
        action: { label: 'Open in Reports', onClick: () => env.openReports(waiting[0].id) },
      });
    }
  }).catch(() => {});
};

// The list again, for 'me' or 'all' (alerts:read_all). -> { ok, message? }
export const reloadAlerts = async (assignee = alertScope) => {
  alertScope = assignee === 'all' ? 'all' : 'me';
  if (!service?.list) return { ok: false };
  try {
    const list = await service.list({ assignee: alertScope });
    if (Array.isArray(list)) list.forEach((raw) => upsertAlert(raw));
    return { ok: true };
  } catch (error) {
    return { ok: false, message: getServiceRefusalMessage(error) || 'The alerts could not be loaded from the Service.' };
  }
};
export const getAlertScope = () => alertScope;

export const stopAlertService = () => {
  stopService?.();
  stopService = null;
  service = null;
  taskByAlert.clear();
};

/* ── 1 Analyse ───────────────────────────────────────────────────────── */
export const runAlertAnalysis = async (alertId) => {
  const alert = getAlert(alertId);
  const blocker = analyseBlocker(alert, { supervisor: env.supervisor });
  if (!service || blocker) return { ok: false, message: blocker || 'The alert service is not running.' };
  setAlertBusy(alertId, 'analysing');
  try {
    const result = await service.startAnalysis(alertId);
    const sessionId = String(result?.source_session_id || '');
    const taskId = createTask({
      origin: TASK_ORIGINS.PARENT,
      title: 'STR link analysis',
      action: 'Link Analysis',
      input: `${alert.reference || alert.id} · ${alert.subject || alert.title}`,
      mode: 'alert',
      windowTitle: alert.reference || `Alert ${alert.id}`,
      sourceSessionId: sessionId,
      alertId: alert.id,
      externalReferenceId: alert.reference,
    });
    markTaskRunning(taskId);
    taskByAlert.set(String(alertId), taskId);
    // The run's task on the Service (H-2): its verdict and lifecycle.
    if (result?.task?.task_id) linkServerTask(taskId, result.task.task_id);
    if (result?.alert) upsertAlert(result.alert);
    if (sessionId && !getAlert(alertId)?.sessionId) patchAlert(alertId, { session_id: sessionId });
    announce('analysis_started', getAlert(alertId) || alert);
    return { ok: true, taskId };
  } catch (error) {
    setAlertBusy(alertId, null);
    const message = getServiceRefusalMessage(error) || error?.message || 'The analysis could not start.';
    announce('analysis_failed', alert, { message });
    return { ok: false, message };
  }
};
// The alert's run in Tasks: started here, or known from the Service.
export const alertTaskId = (alertId) => taskByAlert.get(String(alertId)) || getTaskByServerId(getAlert(alertId)?.taskId)?.id || '';

/* ── 2 Extract results ───────────────────────────────────────────────── */
// From the alert's Graph window and its linked Table and Chart windows when
// open (what the analyst built), else from the alert's graph with the
// default tables and the automatic charts. Keeps what the analyst typed.
export const extractAlertResults = async (alertId) => {
  const alert = getAlert(alertId);
  if (!alert) return { ok: false, message: 'No alert.' };
  setAlertBusy(alertId, 'extracting');
  try {
    const windows = env.getWindows();
    const graphWindow = alertGraphWindow(alertId);
    let store;
    let extras;
    let view;
    let source;
    if (graphWindow && hasGraphStore(graphWindow.id)) {
      store = getGraphStore(graphWindow.id);
      // Only a graph that loaded in full is extracted.
      const { state: loadState, partial } = store.getStatus();
      if (loadState === 'loading' || loadState === 'queued') return { ok: false, message: 'The alert’s graph is still loading. Extract the results when it has finished.' };
      if (loadState === 'error' || partial) return { ok: false, message: 'The alert’s graph did not load in full. Load it again in its Graph window first.' };
      if (!store.getSnapshot().nodes) return { ok: false, message: 'The alert’s Graph window holds no graph. Load it first.' };
      const published = getGraphState(graphWindow.id);
      const whole = { nodeIds: store.graph().nodes(), edgeIds: store.graph().edges() };
      extras = await graphReportExtras({
        store,
        link: published,
        // Without windows of the analyst's: the default tables and charts,
        // over the whole graph (never the window's first entities only).
        fallback: whole,
        chartWindows: windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.CHART && item.metadata?.chartGraph === graphWindow.id),
        tableWindows: windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.TABLE && item.metadata?.tableGraph === graphWindow.id),
      });
      // The counts and findings describe the alert's graph, not how much of
      // it the window happens to draw.
      view = whole;
      source = `${graphWindow.customTitle || graphWindow.title} (the alert’s Graph window) and its linked windows`;
    } else {
      const graphData = await ensureAlertGraph(alert).catch((error) => ({ failed: error?.message || 'The alert\u2019s graph could not be loaded.' }));
      if (graphData?.failed) return { ok: false, message: graphData.failed };
      if (!graphData) return { ok: false, message: 'Run the analysis first: the alert has no graph yet.' };
      store = evidenceReportContext({ graphData, evidence: { traceId: alert.traceId || sessionGraphKey(alert), reportId: alert.reportId || alert.id, externalReferenceId: alert.reference } }).store;
      extras = await evidenceReportExtras({ store });
      view = { nodeIds: store.graph().nodes(), edgeIds: store.graph().edges() };
      source = 'the alert’s graph (no Graph window open): default tables and the automatic charts';
    }
    const graph = store.graph();
    const facts = reportFacts(graph, view, { markers: store.getMarkers() });
    const findings = draftFindings({ graph, facts, timeline: reportTimeline(graph, view) }).join('\n');
    const graphImage = await renderOffscreenSnapshot(store, { ...SNAPSHOT_DEFAULTS }).catch(() => null);
    const current = getAlertsSnapshot().drafts[String(alertId)] || {};
    const flagged = Object.values(alert.flags).some((count) => count > 0);
    setAlertDraft(alertId, {
      extractedAt: Date.now(),
      source,
      graphImage: graphImage || null,
      counts: { nodes: facts.nodeIds.length, links: facts.edgeIds.length },
      tables: extras.tables,
      charts: extras.measures.flatMap((set) => set.cells),
      chartsSkipped: extras.measures.flatMap((set) => set.skipped || []),
      flags: alert.flags,
      // What the analyst typed stays; the drafted findings follow the graph
      // until they are edited.
      findings: current.findingsEdited ? current.findings : findings,
      findingsEdited: Boolean(current.findingsEdited),
      comments: current.comments || '',
      // Flags, else the Service's own verdict; with neither, the analyst
      // chooses ("clean" is never assumed). What they chose stays.
      verdict: current.verdictEdited ? current.verdict : flagged ? 'suspicious' : alert.verdict || '',
      verdictEdited: Boolean(current.verdictEdited),
      include: current.include || { graph: true, table: true, charts: true },
    });
    logAlertEvent(alertId, 'extracted', 'Results extracted');
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error?.message || 'The results could not be extracted.' };
  } finally {
    setAlertBusy(alertId, null);
  }
};

/* ── 3 Report back ───────────────────────────────────────────────────── */
export const feedbackBlocker = (alert, draft) => {
  if (!alert) return 'No alert.';
  if (!alert.isAlert) return 'This report has no alert to answer.';
  if (!alert.mine) return 'Only the assignee can send the feedback.';
  if (!canSendFeedback(alert)) return alert.response === RESPONSE.ANALYSING ? 'The analysis is still running.' : 'Run the analysis first.';
  if (!draft?.extractedAt) return 'Extract the results first.';
  if (!draft.verdict) return 'Choose a verdict.';
  if (!String(draft.findings || '').trim() && !String(draft.comments || '').trim()) return 'Write the findings or a comment.';
  return '';
};

export const sendAlertFeedback = async (alertId) => {
  const alert = getAlert(alertId);
  const draft = getAlertsSnapshot().drafts[String(alertId)];
  const blocker = feedbackBlocker(alert, draft);
  if (!service || blocker) return { ok: false, message: blocker || 'The alert service is not running.' };
  const payload = feedbackPayload(alert, draft);
  const tooLarge = feedbackSizeProblem(payload);
  if (tooLarge) return { ok: false, message: tooLarge };
  const before = alert.response;
  setAlertBusy(alertId, 'sending');
  patchAlert(alertId, { response_status: RESPONSE.SENDING });
  try {
    const result = await service.sendFeedback(alertId, payload);
    if (result?.alert) onEvent({ type: 'upsert', alert: result.alert, reason: 'feedback' });
    // The same feedback was delivered before: nothing was sent again.
    if (result?.outcome === 'already_sent') return { ok: true, message: 'This feedback was already delivered; nothing was sent again.' };
    return { ok: true };
  } catch (error) {
    const code = getServiceRefusalCode(error);
    const retrying = error?.data?.retrying === true;
    const message = `${getServiceRefusalMessage(error) || error?.message || 'The feedback could not be sent.'}${retrying ? ' The Service keeps retrying automatically; Retry sends it now.' : ''}`;
    // The Service's record of the failure (502 delivery_failed carries it).
    if (error?.data?.alert && typeof error.data.alert === 'object') {
      onEvent({ type: 'upsert', alert: error.data.alert, reason: 'feedback' });
    } else if (getAlert(alertId)?.response === RESPONSE.SENDING) {
      // Not delivered (unreachable): failed. A refusal (reassigned,
      // stale_task, task_expired…) leaves the alert as it was.
      const delivery = !code || code === 'delivery_failed' || code === 'feedback_not_configured';
      if (delivery) {
        const failed = patchAlert(alertId, { response_status: RESPONSE.FAILED, response_note: message });
        if (failed) announce('feedback_failed', failed, { message });
      } else {
        patchAlert(alertId, { response_status: before });
      }
    }
    return { ok: false, message };
  } finally {
    setAlertBusy(alertId, null);
  }
};

// The feedback as a PDF (the NBE report frame, kind "STR Feedback Report").
export const downloadAlertFeedbackPdf = async (alertId) => {
  const alert = getAlert(alertId);
  const draft = getAlertsSnapshot().drafts[String(alertId)];
  const graphData = alert ? await ensureAlertGraph(alert).catch(() => null) : null;
  if (!alert || !draft?.extractedAt || !graphData) return { ok: false, message: 'Extract the results first.' };
  const rules = Object.keys(alert.flags).filter((rule) => alert.flags[rule] > 0);
  const context = evidenceReportContext({ graphData, evidence: { traceId: alert.traceId || sessionGraphKey(alert), reportId: alert.reportId || alert.id, externalReferenceId: alert.reference, systemRules: rules } });
  const verdict = { suspicious: 'Suspicious', clean: 'Clean', undetermined: 'Undetermined' }[draft.verdict] || '—';
  await downloadGraphReport({
    input: { ...context.input(''), kind: 'alert' },
    values: {
      title: `STR Feedback · ${alert.reference || alert.id}`,
      caseId: alert.reference,
      reference: alert.reference || alert.id,
      dateTime: reportDateTime(),
      analyst: env.username,
      systemRule: rules.join(', '),
      graphAlert: 'Not applied (STR alert)',
      purpose: alert.reason || alert.subject,
      findings: draft.findings,
      assessment: `Verdict: ${verdict}.${draft.comments ? `\n${draft.comments}` : ''}`,
      actions: '',
      marking: DEFAULT_MARKING,
      nameKey: '',
      range: reportRangeOf('standard'),
    },
    snapshot: draft.include?.graph ? draft.graphImage : null,
    measures: draft.include?.charts && draft.charts?.length ? [{ title: 'Extracted charts', source: `The charts extracted from ${draft.source}.`, cells: draft.charts, skipped: draft.chartsSkipped || [] }] : null,
    tables: draft.include?.table ? draft.tables || [] : [],
  });
  return { ok: true };
};

// Development controls of the mock (Reports ▸ Alert reports).
export const simulateAlert = (kind, alertId) => {
  if (service?.kind !== 'mock') return null;
  if (kind === 'new') return service.simulate.newAlert();
  if (kind === 'reassign' && alertId) return service.simulate.reassign(alertId);
  return null;
};
