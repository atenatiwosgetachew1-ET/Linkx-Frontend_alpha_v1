// Reports window model: the three production tabs, the record adapter and
// the filtering / sorting rules, ported from the production Reports window
// (src/App.jsx, `Reports`). Pure functions only, so they are unit-tested.
//
// Every record is normalised by toReportRecord() into one shape (the H-1
// evidence record of docs/backend-handoff-analysis-results.md), so the
// backend's unified shape will be a change in this adapter only.

export const REPORTS_PAGE_SIZE = 50;
export const ARCHIVE_AFTER_MS = 180 * 24 * 60 * 60 * 1000;
// Vigilance runs open the findings with a ±5 minute margin around the window.
export const VIGILANCE_WINDOW_MARGIN_MS = 5 * 60 * 1000;

export const REPORT_TABS = Object.freeze([
  Object.freeze({ id: 'parent', label: 'Alert reports', endpoint: '/api/v1/reports/parent', requesterType: 'parent', scored: false }),
  Object.freeze({ id: 'xvigilance', label: 'System reports', endpoint: '/api/v1/reports/xvigilance', requesterType: 'system', scored: true }),
  // Production label "Service evedences"; renamed (docs/analysis-results-plan.md).
  Object.freeze({ id: 'evidence', label: 'Service evidence', endpoint: '/api/v1/reports/evidence', requesterType: 'service', scored: true }),
]);

export const getReportTab = (id) => REPORT_TABS.find((tab) => tab.id === id) || REPORT_TABS[0];

export const STATUS_FILTERS = Object.freeze([
  { id: 'all', label: 'All statuses' },
  { id: 'success', label: 'Success / Completed' },
  { id: 'error', label: 'Error / Failed' },
  { id: 'resolved', label: 'Resolved' },
]);

export const SCORE_BANDS = Object.freeze([
  { id: 'all', label: 'All score bands' },
  { id: 'fatal', label: 'Fatal (90+)' },
  { id: 'critical', label: 'Critical (80-89)' },
  { id: 'high', label: 'High (50-79)' },
  { id: 'medium', label: 'Medium (20-49)' },
  { id: 'low', label: 'Low (0-19)' },
]);

export const SORT_OPTIONS = Object.freeze([
  { id: 'date_desc', label: 'Newest first', scoredOnly: false },
  { id: 'date_asc', label: 'Oldest first', scoredOnly: false },
  { id: 'score_desc', label: 'Highest fraud score', scoredOnly: true },
  { id: 'score_asc', label: 'Lowest fraud score', scoredOnly: true },
]);

export const DEFAULT_FILTERS = Object.freeze({
  search: '',
  status: 'all',
  band: 'all',
  from: '',
  to: '',
  sort: 'date_desc',
});

export const parsePayload = (payload) => {
  if (payload && typeof payload === 'object') return payload;
  if (typeof payload !== 'string' || !payload.trim()) return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const truthy = (value) => value === true || value === 'true' || value === 1;
const falsy = (value) => value === false || value === 'false' || value === 0;

// payload.trace_id, then the reference id, the record's trace id, its id.
export const getReportTraceId = (record) => {
  if (!record) return null;
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : parsePayload(record.payload);
  return payload.trace_id || record.external_reference_id || record.trace_id || record.id || null;
};

// What the record itself claims about its graph: true / false / null
// (unknown). Same precedence as production's isReportGraphPresent/Absent.
export const getGraphClaim = (raw, payload) => {
  if (truthy(payload.has_graph) || truthy(payload.include_graph)) return true;
  if (truthy(raw.has_graph) || truthy(raw.graph_available) || truthy(payload.graph_available) || truthy(raw.include_graph)) return true;
  if (falsy(raw.has_graph) || falsy(payload.has_graph) || falsy(raw.graph_available) || falsy(payload.graph_available)) return false;
  if (falsy(raw.include_graph) || falsy(payload.include_graph)) return false;
  if (payload.graph === null || payload.graph === false) return false;
  if (Array.isArray(payload.nodes)) return payload.nodes.length > 0;
  return null;
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const getFraudScore = (payload) => toNumber(payload.fraud_score ?? payload.fraudScore ?? payload.score);

// Highest-degree node of the payload graph, else top_5_accounts / entity_id.
export const getLeadingEntity = (payload) => {
  if (Array.isArray(payload.top_5_accounts) && payload.top_5_accounts.length) return String(payload.top_5_accounts[0]);
  if (payload.entity_id) return String(payload.entity_id);
  if (!Array.isArray(payload.edges) || !payload.edges.length) return '';
  const degree = {};
  payload.edges.forEach((edge) => {
    const from = String(edge?.from ?? '');
    const to = String(edge?.to ?? '');
    if (from) degree[from] = (degree[from] || 0) + 1;
    if (to) degree[to] = (degree[to] || 0) + 1;
  });
  const ids = Object.keys(degree);
  if (!ids.length) return '';
  const topId = ids.reduce((a, b) => (degree[a] >= degree[b] ? a : b));
  const node = Array.isArray(payload.nodes) ? payload.nodes.find((item) => String(item?.id) === topId) : null;
  return String(node ? (node.account_number || node.calling_no || node.label || node.id || topId) : topId);
};

const listText = (value) => (Array.isArray(value) ? value.join(', ') : value ? String(value) : '');

export const getAnomaly = (payload) => payload.anomaly_type || listText(payload.flagged_rules);

export const getReason = (payload) => payload.reason
  || (payload.beneficiary_blacklisted ? 'Beneficiary Blacklisted' : payload.is_flagged ? 'Flagged Network Activity' : '');

// Fraud score, else the centrality score as a percentage.
export const getScoreLabel = (payload) => {
  if (payload.fraud_score !== undefined && payload.fraud_score !== null) return String(payload.fraud_score);
  const centrality = toNumber(payload.network_centrality_score);
  return centrality === null ? '' : `${(centrality * 100).toFixed(0)}%`;
};

export const getScoreBand = (payload) => String(payload.score_band || payload.scoreBand || '').toLowerCase();

const statusTone = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'completed' || value === 'success' || value === 'new') return 'success';
  if (value === 'failed' || value === 'error') return 'error';
  if (value === 'resolved') return 'resolved';
  return 'pending';
};

// One record shape for every tab (H-1). `raw` keeps the backend record.
export const toReportRecord = (raw = {}, tabId = 'parent') => {
  const payload = parsePayload(raw.payload);
  const tab = getReportTab(tabId);
  const createdTs = raw.created_at ? new Date(raw.created_at).getTime() : 0;
  const flaggedRules = Array.isArray(payload.flagged_rules)
    ? payload.flagged_rules.map(String)
    : payload.flagged_rules ? String(payload.flagged_rules).split(',').map((rule) => rule.trim()).filter(Boolean) : [];
  const flags = raw.flags && typeof raw.flags === 'object' ? raw.flags : payload.flags && typeof payload.flags === 'object' ? payload.flags : null;
  const band = getScoreBand(payload);
  const isFlagged = Boolean(payload.is_flagged || flaggedRules.length || (flags && Object.values(flags).some((count) => Number(count) > 0)));
  return {
    id: raw.id ?? '',
    tabId: tab.id,
    requesterType: raw.requester_type || tab.requesterType,
    requesterId: raw.requester_id ?? null,
    requesterName: raw.requester_name || '',
    externalReferenceId: raw.external_reference_id || '',
    traceId: getReportTraceId({ ...raw, payload }),
    reportType: raw.report_type || '',
    sourceSystem: raw.source_system || '',
    status: raw.status || '',
    statusTone: statusTone(raw.status),
    createdAt: raw.created_at || '',
    createdTs: Number.isFinite(createdTs) ? createdTs : 0,
    fraudScore: getFraudScore(payload),
    scoreLabel: getScoreLabel(payload),
    scoreBand: band,
    anomaly: getAnomaly(payload),
    reason: getReason(payload),
    leadingEntity: getLeadingEntity(payload),
    flaggedRules,
    flags,
    verdict: raw.verdict || (isFlagged || ['high', 'critical', 'fatal'].includes(band) ? 'suspicious' : ''),
    isFlagged,
    graphClaim: getGraphClaim(raw, payload),
    runId: payload.run_id ?? null,
    payload,
    raw,
  };
};

export const isArchived = (record, now = Date.now()) => now - (record.createdTs || 0) > ARCHIVE_AFTER_MS;

const matchesStatus = (record, status) => {
  if (status === 'all') return true;
  const value = String(record.status || '').toLowerCase();
  if (status === 'success') return value === 'success' || value === 'completed' || value === 'succeeded';
  if (status === 'error') return value === 'error' || value === 'failed';
  return value === status;
};

const matchesBand = (record, band) => {
  if (band === 'all') return true;
  if (band === 'fatal') return (record.fraudScore ?? 0) >= 90 || record.scoreBand === 'fatal';
  return record.scoreBand === band;
};

const matchesSearch = (record, needle) => !needle || [
  record.id, record.externalReferenceId, record.reportType, record.sourceSystem, record.payload.anomaly_type, record.payload.reason,
].some((value) => String(value ?? '').toLowerCase().includes(needle));

// Client-side pass over the loaded page, as production does: search, status,
// band (scored tabs), date range, then the sort.
export const filterAndSortRecords = (records, filters, tabId) => {
  const tab = getReportTab(tabId);
  const needle = String(filters.search || '').trim().toLowerCase();
  const fromTs = filters.from ? new Date(filters.from).getTime() : null;
  const toTs = filters.to ? new Date(filters.to).getTime() : null;
  const list = records.filter((record) => matchesSearch(record, needle)
    && matchesStatus(record, filters.status)
    && (!tab.scored || matchesBand(record, filters.band))
    && (fromTs === null || record.createdTs >= fromTs)
    && (toTs === null || record.createdTs <= toTs));
  const score = (record) => record.fraudScore ?? 0;
  const compare = {
    date_desc: (a, b) => b.createdTs - a.createdTs,
    date_asc: (a, b) => a.createdTs - b.createdTs,
    score_desc: (a, b) => score(b) - score(a),
    score_asc: (a, b) => score(a) - score(b),
  }[filters.sort] || (() => 0);
  return [...list].sort(compare);
};

// Query for the list endpoint (server-side filters).
export const buildReportsQuery = ({ tabId, offset = 0, limit = REPORTS_PAGE_SIZE, filters = DEFAULT_FILTERS }) => {
  const tab = getReportTab(tabId);
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (tab.scored && filters.band && filters.band !== 'all') {
    if (filters.band === 'fatal') params.set('min_fraud_score', '90');
    else params.set('score_band', filters.band);
  }
  if (filters.search) params.set('q', filters.search);
  if (tab.scored && filters.from) params.set('start_date', filters.from);
  if (tab.scored && filters.to) params.set('end_date', filters.to);
  return `${tab.endpoint}?${params.toString()}`;
};

// "2026-11-14 10:00:00" (no zone) is UTC, as production parses it.
export const parseWindowTime = (value) => {
  let text = String(value || '').replace(' ', 'T');
  if (text && !text.endsWith('Z') && text.includes('T') && text.length <= 19) text += 'Z';
  return new Date(text).getTime();
};

// Timestamp -> "YYYY-MM-DDThh:mm" in local time, for datetime-local inputs.
export const toDateTimeInput = (ts) => {
  if (!Number.isFinite(ts)) return '';
  const date = new Date(ts);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

// A Vigilance run's window as Reports filters and highlight.
export const vigilanceRunView = (run) => {
  const start = parseWindowTime(run?.window_start);
  const end = parseWindowTime(run?.window_end);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return {
    from: toDateTimeInput(start - VIGILANCE_WINDOW_MARGIN_MS),
    to: toDateTimeInput(end + VIGILANCE_WINDOW_MARGIN_MS),
    runId: run.run_id ?? null,
  };
};

export const formatReportDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

// "Showing 1 to 50 of 120" / "Showing 1 to 12 of 120 (Filtered)".
export const pageSummary = ({ offset, shown, loaded, total, limit = REPORTS_PAGE_SIZE }) => (shown !== loaded
  ? `Showing ${shown > 0 ? offset + 1 : 0} to ${offset + shown} of ${total} (Filtered)`
  : `Showing ${loaded > 0 ? offset + 1 : 0} to ${Math.min(offset + limit, total)} of ${total}`);
