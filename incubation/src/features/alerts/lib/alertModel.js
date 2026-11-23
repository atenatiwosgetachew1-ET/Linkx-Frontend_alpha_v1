// STR alerts from the parent service (analysis-results-plan Phase 4; analyst
// decision 2026-11-19): an alert report assigned to a LinkX analyst, who
// analyses it, extracts the results (graph, table, charts, summary of
// findings with their comments) and reports them back to the parent. The
// shapes follow the backend handoff (docs/backend-handoff-analysis-results.md
// H-1, H-3, H-4, H-5); until the Service delivers them a mock service feeds
// the same shapes (features/alerts/mock). Pure: tests run these directly.

// Arrival: the alert's data, as the parent sends it.
export const INTAKE = Object.freeze({ RECEIVING: 'receiving', COMPLETE: 'complete', INCOMPLETE: 'incomplete' });
// The response, as H-3 (with "analysed": the run finished, feedback not yet
// sent; and the browser's own "sending" while the request is out).
export const RESPONSE = Object.freeze({
  AWAITING: 'awaiting_analysis',
  ANALYSING: 'analysing',
  ANALYSED: 'analysed',
  SENDING: 'feedback_sending',
  SENT: 'feedback_sent',
  ACKNOWLEDGED: 'acknowledged',
  FAILED: 'feedback_failed',
});
export const VERDICTS = Object.freeze([
  { id: 'suspicious', label: 'Suspicious' },
  { id: 'clean', label: 'Clean' },
  { id: 'undetermined', label: 'Undetermined' },
]);

const INTAKE_INFO = {
  [INTAKE.RECEIVING]: { label: 'Data arriving', tone: 'pending' },
  [INTAKE.COMPLETE]: { label: 'Data complete', tone: 'resolved' },
  [INTAKE.INCOMPLETE]: { label: 'Data incomplete', tone: 'error' },
};
const RESPONSE_INFO = {
  [RESPONSE.AWAITING]: { label: 'Awaiting analysis', tone: 'pending' },
  [RESPONSE.ANALYSING]: { label: 'Analysing', tone: 'progress' },
  [RESPONSE.ANALYSED]: { label: 'Analysed', tone: 'progress' },
  [RESPONSE.SENDING]: { label: 'Sending feedback', tone: 'progress' },
  [RESPONSE.SENT]: { label: 'Feedback sent', tone: 'resolved' },
  [RESPONSE.ACKNOWLEDGED]: { label: 'Acknowledged', tone: 'resolved' },
  [RESPONSE.FAILED]: { label: 'Feedback failed', tone: 'error' },
};
export const intakeInfo = (intake) => INTAKE_INFO[intake] || INTAKE_INFO[INTAKE.COMPLETE];
export const responseInfo = (response) => RESPONSE_INFO[response] || RESPONSE_INFO[RESPONSE.AWAITING];

const text = (value, max = 300) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const iso = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
};
const flagsOf = (value) => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(Object.entries(value).filter(([, count]) => Number.isFinite(Number(count))).map(([rule, count]) => [text(rule, 80), Number(count)]));
};

// Whether an alert is assigned to the signed-in user (H-3): by user id, and
// for SSO users whose id is not known yet by username or SSO subject.
// identity: { userId, username, sub }.
export const isAssignedTo = (raw = {}, { userId = '', username = '', sub = '' } = {}) => {
  const same = (a, b) => Boolean(a) && Boolean(b) && String(a) === String(b);
  return same(raw.assignee_user_id, userId) || same(raw.assignee_username, username) || same(raw.assignee_sub, sub);
};

// A parent alert record (H-1 + H-3) -> the alert as the frontend uses it.
// identity: the signed-in user (whether it is assigned to them).
// The alert is addressed by its alert_id (the analysis and feedback
// endpoints); a report imported the old way has none and is not an alert.
export const toAlertRecord = (raw = {}, identity = {}) => {
  const payload = raw.payload && typeof raw.payload === 'object' ? raw.payload : {};
  const intake = Object.values(INTAKE).includes(raw.intake_status) ? raw.intake_status : INTAKE.COMPLETE;
  const response = Object.values(RESPONSE).includes(raw.response_status) ? raw.response_status : RESPONSE.AWAITING;
  const assigneeId = String(raw.assignee_user_id ?? '');
  return {
    id: String(raw.alert_id ?? raw.id ?? ''),
    reportId: String(raw.id ?? ''),
    isAlert: raw.alert_id !== undefined && raw.alert_id !== null && raw.alert_id !== '',
    reference: text(raw.external_reference_id, 80),
    title: text(raw.title || payload.subject || raw.external_reference_id || `Alert ${raw.id ?? ''}`, 160),
    subject: text(payload.subject || raw.title, 160),
    reason: text(payload.reason || raw.reason, 400),
    amount: Number.isFinite(Number(payload.amount)) ? Number(payload.amount) : null,
    currency: text(payload.currency, 8),
    intake,
    intakeNote: text(raw.intake_note, 300),
    expectedRecords: Number.isFinite(Number(raw.expected_records)) ? Number(raw.expected_records) : null,
    receivedRecords: Number.isFinite(Number(raw.received_records)) ? Number(raw.received_records) : null,
    assigneeId,
    assigneeName: text(raw.assignee_name || raw.assignee_username, 80),
    assignedBy: text(raw.assigned_by, 80),
    assignedAt: iso(raw.assigned_at),
    mine: isAssignedTo(raw, identity),
    response,
    responseNote: text(raw.response_note, 300),
    verdict: VERDICTS.some((entry) => entry.id === raw.verdict) ? raw.verdict : '',
    flags: flagsOf(raw.flags),
    taskId: String(raw.task_id ?? ''),
    traceId: String(raw.trace_id ?? ''),
    // The analysis run's session (H-4): its graph until it is saved as
    // evidence (then trace_id).
    sessionId: String(raw.session_id ?? raw.source_session_id ?? ''),
    hasGraph: raw.has_graph === true,
    analysedAt: iso(raw.analysed_at),
    feedbackSentAt: iso(raw.feedback_sent_at),
    acknowledgedAt: iso(raw.acknowledged_at),
    receivedAt: iso(raw.created_at),
    updatedAt: iso(raw.updated_at || raw.created_at),
    mock: raw.mock === true,
  };
};

// Whether the signed-in user may act on it (the parent owns assignment; H-3).
// A supervisor (alerts:read_all) may also analyse (H-4); only the assignee
// sends the feedback (H-5).
export const canAnalyse = (alert, { supervisor = false } = {}) => Boolean(alert?.isAlert) && (Boolean(alert.mine) || supervisor) && alert.intake === INTAKE.COMPLETE
  && [RESPONSE.AWAITING, RESPONSE.ANALYSED, RESPONSE.FAILED].includes(alert.response);
export const canSendFeedback = (alert) => Boolean(alert?.isAlert) && Boolean(alert.mine) && [RESPONSE.ANALYSED, RESPONSE.FAILED].includes(alert.response);
// Why an action is unavailable ('' when it is available).
export const analyseBlocker = (alert, { supervisor = false } = {}) => {
  if (!alert) return 'No alert.';
  if (!alert.isAlert) return 'This report was imported without an alert; it cannot be analysed from here.';
  if (!alert.mine && !supervisor) return alert.assigneeName ? `Assigned to ${alert.assigneeName}; only the assignee can analyse it.` : 'Not assigned to you.';
  if (alert.intake === INTAKE.RECEIVING) return 'Its data is still arriving from the parent service.';
  if (alert.intake === INTAKE.INCOMPLETE) return 'Its data arrived incomplete; the parent service has to send it again.';
  if (alert.response === RESPONSE.ANALYSING) return 'The analysis is running.';
  if ([RESPONSE.SENDING, RESPONSE.SENT, RESPONSE.ACKNOWLEDGED].includes(alert.response)) return 'Feedback was already sent for this alert.';
  return '';
};

// The notice for an alert event (the Notifications list and the toast).
// -> { title, message, level }
export const alertNotice = (type, alert, extra = {}) => {
  const ref = alert?.reference || alert?.title || `alert ${alert?.id ?? ''}`;
  const flagText = (flags = {}) => {
    const entries = Object.entries(flags).filter(([, count]) => count > 0);
    return entries.length ? `${entries.length} ${entries.length === 1 ? 'rule' : 'rules'} flagged (${entries.map(([rule, count]) => `${rule} ${count}`).join(', ')})` : 'no rule flagged';
  };
  switch (type) {
    case 'received':
      return { title: 'New STR alert', message: `${ref}: ${alert.subject || alert.title}${alert.intake === INTAKE.RECEIVING ? ' (its data is still arriving)' : ''}.`, level: 'info' };
    case 'intake_complete':
      return { title: 'STR alert ready for analysis', message: `${ref}: all its data has arrived.`, level: 'success' };
    case 'intake_incomplete':
      return { title: 'STR alert data incomplete', message: `${ref}: ${alert.intakeNote || 'part of its data did not arrive'}.`, level: 'warning' };
    case 'assigned':
      return { title: 'STR alert assigned to you', message: `${ref}${alert.assignedBy ? `, by ${alert.assignedBy}` : ''}.`, level: 'info' };
    case 'reassigned_away':
      return { title: 'STR alert reassigned', message: `${ref} is now assigned to ${alert.assigneeName || 'someone else'}; you can no longer send its feedback.`, level: 'warning' };
    case 'analysis_started':
      return { title: 'STR analysis started', message: `${ref}: link analysis is running.`, level: 'info' };
    case 'analysis_completed':
      return { title: 'STR analysis finished', message: `${ref}: ${flagText(extra.flags)}. Extract the results and report them back.`, level: 'success' };
    case 'analysis_failed':
      return { title: 'STR analysis failed', message: `${ref}: ${extra.message || 'the analysis did not finish'}.`, level: 'error' };
    case 'feedback_sent':
      return { title: 'STR feedback sent', message: `${ref}: delivered to the parent service, waiting for its acknowledgement.`, level: 'success' };
    case 'acknowledged':
      return { title: 'STR feedback acknowledged', message: `${ref}: the parent service confirmed it received the findings.`, level: 'success' };
    case 'feedback_failed':
      return { title: 'STR feedback failed', message: `${ref}: ${extra.message || 'the parent service did not accept it'}. Retry from Reports.`, level: 'error' };
    default:
      return { title: 'STR alert', message: ref, level: 'info' };
  }
};

// Which notices a change of an alert raises (the same for the mock and the
// Service's events): a new alert, its data completing or not, assignment
// to or away from the user, and the feedback's delivery. The analysis
// itself is announced by its run. -> [type]
export const noticeTypesFor = (previous, alert) => {
  if (!alert?.isAlert) return [];
  if (!previous) {
    if (!alert.mine) return [];
    return alert.response === RESPONSE.AWAITING ? ['received'] : [];
  }
  const types = [];
  if (previous.mine && !alert.mine) types.push('reassigned_away');
  if (!previous.mine && alert.mine) types.push('assigned');
  if (!alert.mine) return types;
  if (previous.intake !== alert.intake) {
    if (alert.intake === INTAKE.COMPLETE) types.push('intake_complete');
    if (alert.intake === INTAKE.INCOMPLETE) types.push('intake_incomplete');
  }
  if (previous.response !== alert.response) {
    if (alert.response === RESPONSE.SENT) types.push('feedback_sent');
    if (alert.response === RESPONSE.ACKNOWLEDGED) types.push('acknowledged');
    if (alert.response === RESPONSE.FAILED) types.push('feedback_failed');
  }
  return types;
};

// The feedback sent to the parent (H-5, extended with the extracted fields;
// analyst decision 2026-11-19). draft: the Extract results step's.
export const feedbackPayload = (alert, draft) => ({
  task_id: alert.taskId || null,
  verdict: draft.verdict,
  flags: draft.flags || {},
  summary: {
    findings: String(draft.findings || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, FEEDBACK_LIMITS.findings),
    analyst_comments: String(draft.comments || '').trim().slice(0, FEEDBACK_LIMITS.comments),
  },
  include: { graph: Boolean(draft.include?.graph), table: Boolean(draft.include?.table), charts: Boolean(draft.include?.charts), summary: true },
  graph: draft.include?.graph ? { image: feedbackImage(draft.graphImage), nodes: draft.counts?.nodes ?? null, links: draft.counts?.links ?? null } : null,
  tables: draft.include?.table ? (draft.tables || []).slice(0, FEEDBACK_LIMITS.tables).map((table) => ({
    title: table.title, source: table.source, columns: table.columns.map((column) => column.label), rows: (table.rows || []).slice(0, FEEDBACK_LIMITS.rows), total: table.total,
  })) : [],
  charts: draft.include?.charts ? (draft.charts || []).slice(0, FEEDBACK_LIMITS.charts).map((chart) => ({ title: chart.title, level: chart.level, image: feedbackImage(chart.image) })) : [],
});

// What the feedback endpoint takes (H-5): a 10 MB body; JPEG or PNG data
// URLs of at most 3 MB each; 20 tables of 2,000 rows, 20 charts, 200
// findings, 4,000 characters of comments.
export const FEEDBACK_LIMITS = Object.freeze({
  bodyBytes: 10 * 1024 * 1024, imageBytes: 3 * 1024 * 1024, tables: 20, rows: 2000, charts: 20, findings: 200, comments: 4000,
});
const dataUrlBytes = (value) => {
  const base64 = String(value).split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
};
// A picture the Service accepts, else none (it would be refused).
export const feedbackImage = (value) => {
  if (typeof value !== 'string' || !/^data:image\/(png|jpe?g);base64,/i.test(value)) return null;
  return dataUrlBytes(value) <= FEEDBACK_LIMITS.imageBytes ? value : null;
};
// Why a feedback body would be refused for its size ('' when it fits).
export const feedbackSizeProblem = (payload) => {
  const bytes = new Blob([JSON.stringify(payload)]).size;
  if (bytes <= FEEDBACK_LIMITS.bodyBytes) return '';
  return `The feedback is ${(bytes / 1048576).toFixed(1)} MB; the Service takes up to 10 MB. Leave out the charts or the graph picture.`;
};
