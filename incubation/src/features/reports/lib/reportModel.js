// Reports window model: the three production tabs, the record adapter and
// the filtering / sorting rules, ported from the production Reports window
// (src/App.jsx, `Reports`). Pure functions only, so they are unit-tested.
//
// Every record is normalised by toReportRecord() into one shape (the H-1
// evidence record of docs/backend-handoff-analysis-results.md), so the
// backend's unified shape will be a change in this adapter only.

import { readSettingsUsed, settingsRemark } from '../../../shared/runSettings.js';

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

// Who asked for the evidence (H-1/H-6): sibling services' accounts, or an
// analyst's saved run. Older records have no requester and count as service.
export const REQUESTER_FILTERS = Object.freeze([
  { id: 'all', label: 'All requesters' },
  { id: 'service', label: 'Service accounts' },
  { id: 'analyst', label: 'Analysts' },
]);

export const DEFAULT_FILTERS = Object.freeze({
  requester: 'all',
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

// The record's trace_id (H-1: the graph evidence id for /get_graph), else
// as production: payload.trace_id, the reference id, the record's id.
export const getReportTraceId = (record) => {
  if (!record) return null;
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : parsePayload(record.payload);
  return record.trace_id || payload.trace_id || record.external_reference_id || record.id || null;
};

// Whether the record has a graph: the Service's has_graph is the only flag
// (H-1; true only when /get_graph returns nodes for trace_id). A record
// without it (a Service before H-1) is unknown: null, and the Reports
// window checks.
export const getGraphClaim = (raw) => {
  if (truthy(raw.has_graph)) return true;
  if (falsy(raw.has_graph)) return false;
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

// The evidence's domain_distribution: how its data spreads over the domains
// (e.g. a "domain": "all" evidence). Accepts { bank: 12, microfinance: 3 },
// [{ domain, count }] (or name / key, value / share / percentage) and
// ['bank', 'microfinance']. Returns [{ domain, count }] (count null when not
// given), largest first, at most 8.
export const getDomainDistribution = (payload) => {
  const raw = payload?.domain_distribution;
  const asCount = (value) => {
    const number = Number(value);
    return value !== null && value !== '' && Number.isFinite(number) && number >= 0 ? number : null;
  };
  let items = [];
  if (Array.isArray(raw)) {
    items = raw.map((item) => (item && typeof item === 'object'
      ? { domain: item.domain ?? item.name ?? item.key, count: asCount(item.count ?? item.value ?? item.share ?? item.percentage) }
      : { domain: item, count: null }));
  } else if (raw && typeof raw === 'object') {
    items = Object.entries(raw).map(([domain, value]) => ({ domain, count: asCount(value && typeof value === 'object' ? value.count ?? value.value : value) }));
  }
  return items
    .map((item) => ({ domain: String(item.domain ?? '').trim().slice(0, 40), count: item.count }))
    .filter((item) => item.domain && item.count !== 0)
    .sort((a, b) => (b.count ?? -1) - (a.count ?? -1))
    .slice(0, 8);
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

// The score bands' limits (SCORE_BANDS): 0-19 low, 20-49 medium, 50-79
// high, 80-89 critical, 90+ fatal.
export const bandForScore = (score) => {
  if (score === null || score === undefined || !Number.isFinite(Number(score))) return '';
  const value = Number(score);
  if (value < 20) return 'low';
  if (value < 50) return 'medium';
  if (value < 80) return 'high';
  if (value < 90) return 'critical';
  return 'fatal';
};

// The band the Service gave, else the one the shown score falls in (as the
// System reports' records carry it): the fraud score, or, without one, the
// centrality score as the percentage the Fraud score column shows (user
// decision 2026-11-26). Every record with a figure in that column has a band.
export const getScoreBand = (payload) => {
  const given = String(payload.score_band || payload.scoreBand || '').toLowerCase();
  if (given) return given;
  const score = getFraudScore(payload);
  if (score !== null) return bandForScore(score);
  const centrality = toNumber(payload.network_centrality_score);
  return centrality === null ? '' : bandForScore(Math.round(centrality * 100));
};

const statusTone = (status) => {
  const value = String(status || '').toLowerCase();
  if (value === 'completed' || value === 'success' || value === 'new') return 'success';
  // A flagged record reads in red, as its flag does elsewhere.
  if (value === 'failed' || value === 'error' || value === 'flagged') return 'error';
  if (value === 'resolved') return 'resolved';
  return 'pending';
};

// One record shape for every tab (H-1). `raw` keeps the backend record.
export const toReportRecord = (raw = {}, tabId = 'parent') => {
  const parsed = parsePayload(raw.payload);
  // H-1 puts fraud_score / score_band on the record itself; older records
  // (and the System reports) carry them in the payload. The record's own
  // win, and the payload gets them so everything reading it agrees.
  const payload = {
    ...parsed,
    ...(raw.fraud_score !== undefined && raw.fraud_score !== null && raw.fraud_score !== '' ? { fraud_score: raw.fraud_score } : {}),
    ...(raw.score_band ? { score_band: raw.score_band } : {}),
  };
  const tab = getReportTab(tabId);
  const createdTs = raw.created_at ? new Date(raw.created_at).getTime() : 0;
  const flaggedRules = Array.isArray(payload.flagged_rules)
    ? payload.flagged_rules.map(String)
    : payload.flagged_rules ? String(payload.flagged_rules).split(',').map((rule) => rule.trim()).filter(Boolean) : [];
  const flags = raw.flags && typeof raw.flags === 'object' ? raw.flags : payload.flags && typeof payload.flags === 'object' ? payload.flags : null;
  const band = getScoreBand(payload);
  // The verdict reads only the band the Service itself gave.
  const serviceBand = String(payload.score_band || payload.scoreBand || '').toLowerCase();
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
    leadingEntity: (raw.title && String(raw.title)) || getLeadingEntity(payload),
    flaggedRules,
    flags,
    verdict: raw.verdict || (isFlagged || ['high', 'critical', 'fatal'].includes(serviceBand) ? 'suspicious' : ''),
    isFlagged,
    graphClaim: getGraphClaim(raw),
    // Moved to cold storage after 180 days (has_graph false; B-31 asks the
    // Service for graph_archived): shown as archived, not as "no graph".
    graphArchived: truthy(raw.graph_archived),
    // What it was made with (B-42). Evidence saved by an analyst always says:
    // without it, it was not recorded. Other records use the domain's settings.
    runRemark: raw.settings_used ? settingsRemark(readSettingsUsed(raw.settings_used)) : tab.id === 'evidence' && raw.requester_type === 'analyst' ? settingsRemark(null) : null,
    // The settings themselves (readSettingsUsed), for the run settings popup.
    runSettings: raw.settings_used ? readSettingsUsed(raw.settings_used) : null,
    domain: typeof raw.domain === 'string' ? raw.domain : '',
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
  if (tab.id === 'evidence' && ['service', 'analyst'].includes(filters.requester)) params.set('requester_type', filters.requester);
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
