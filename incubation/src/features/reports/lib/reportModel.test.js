import { describe, expect, it } from 'vitest';

import {
  getDomainDistribution,
  ARCHIVE_AFTER_MS,
  DEFAULT_FILTERS,
  buildReportsQuery,
  filterAndSortRecords,
  isArchived,
  pageSummary,
  parseWindowTime,
  toReportRecord,
  vigilanceRunView,
} from './reportModel.js';
import { buildLeadingEntitySummary, buildReportRows } from './reportsPdf.js';

const raw = (overrides = {}, payload = {}) => ({
  id: 1,
  report_type: 'STR',
  source_system: 'core',
  status: 'completed',
  created_at: '2026-11-10T10:00:00Z',
  external_reference_id: 'REF-1',
  payload: JSON.stringify(payload),
  ...overrides,
});

describe('toReportRecord', () => {
  it('reads the production payload fields', () => {
    const record = toReportRecord(raw({}, {
      trace_id: 'tr-9', fraud_score: 91.5, score_band: 'FATAL', anomaly_type: 'Fan-out', reason: 'Burst',
      flagged_rules: ['SMURFING', 'FUND_FLOW'], run_id: 7,
    }), 'evidence');
    expect(record).toMatchObject({
      traceId: 'tr-9', fraudScore: 91.5, scoreLabel: '91.5', scoreBand: 'fatal', anomaly: 'Fan-out', reason: 'Burst',
      flaggedRules: ['SMURFING', 'FUND_FLOW'], requesterType: 'service', verdict: 'suspicious', runId: 7, statusTone: 'success',
    });
  });

  it('falls back like production: trace id, anomaly, reason, centrality score', () => {
    const record = toReportRecord(raw({ trace_id: 'x' }, { flagged_rules: 'A, B', is_flagged: true, network_centrality_score: 0.42 }), 'xvigilance');
    expect(record.traceId).toBe('x'); // the record's trace_id (H-1) first
    expect(toReportRecord(raw()).traceId).toBe('REF-1'); // then payload.trace_id, the reference id
    expect(record.anomaly).toBe('A, B');
    expect(record.reason).toBe('Flagged Network Activity');
    expect(record.scoreLabel).toBe('42%');
    expect(toReportRecord(raw({}, { beneficiary_blacklisted: true })).reason).toBe('Beneficiary Blacklisted');
  });

  it('picks the leading entity: top accounts, entity id, then the busiest node', () => {
    expect(toReportRecord(raw({}, { top_5_accounts: ['A1', 'A2'] })).leadingEntity).toBe('A1');
    expect(toReportRecord(raw({}, { entity_id: 'E7' })).leadingEntity).toBe('E7');
    const graph = { edges: [{ from: 'n1', to: 'n2' }, { from: 'n1', to: 'n3' }], nodes: [{ id: 'n1', account_number: '1000' }] };
    expect(toReportRecord(raw({}, graph)).leadingEntity).toBe('1000');
  });

  it('reads has_graph only (H-1); the old guesses are ignored', () => {
    expect(toReportRecord(raw({ has_graph: true })).graphClaim).toBe(true);
    expect(toReportRecord(raw({ has_graph: false })).graphClaim).toBe(false);
    expect(toReportRecord(raw({ graph_available: true }, { include_graph: true })).graphClaim).toBeNull();
    expect(toReportRecord(raw({}, { nodes: [] })).graphClaim).toBeNull();
    expect(toReportRecord(raw()).graphClaim).toBeNull();
  });

  it('asks for the requester on Service evidence only (H-1, H-6)', () => {
    expect(buildReportsQuery({ tabId: 'evidence', filters: { ...DEFAULT_FILTERS, requester: 'analyst' } })).toContain('requester_type=analyst');
    expect(buildReportsQuery({ tabId: 'parent', filters: { ...DEFAULT_FILTERS, requester: 'analyst' } })).not.toContain('requester_type');
    expect(buildReportsQuery({ tabId: 'evidence', filters: DEFAULT_FILTERS })).not.toContain('requester_type');
  });

  it('marks reports older than 180 days as archived', () => {
    const record = toReportRecord(raw());
    expect(isArchived(record, record.createdTs + ARCHIVE_AFTER_MS + 1)).toBe(true);
    expect(isArchived(record, record.createdTs + 1000)).toBe(false);
  });
});

describe('filterAndSortRecords', () => {
  const records = [
    toReportRecord(raw({ id: 1, status: 'succeeded', created_at: '2026-11-01T00:00:00Z' }, { fraud_score: 95, reason: 'fan-out' }), 'xvigilance'),
    toReportRecord(raw({ id: 2, status: 'failed', created_at: '2026-11-05T00:00:00Z' }, { fraud_score: 40, score_band: 'medium' }), 'xvigilance'),
    toReportRecord(raw({ id: 3, status: 'resolved', created_at: '2026-11-09T00:00:00Z' }, { fraud_score: 85, score_band: 'critical' }), 'xvigilance'),
  ];
  const ids = (list) => list.map((record) => record.id);

  it('groups statuses as production does', () => {
    expect(ids(filterAndSortRecords(records, { ...DEFAULT_FILTERS, status: 'success' }, 'xvigilance'))).toEqual([1]);
    expect(ids(filterAndSortRecords(records, { ...DEFAULT_FILTERS, status: 'error' }, 'xvigilance'))).toEqual([2]);
    expect(ids(filterAndSortRecords(records, { ...DEFAULT_FILTERS, status: 'resolved' }, 'xvigilance'))).toEqual([3]);
  });

  it('treats a score of 90+ as fatal, and ignores bands on Alert reports', () => {
    expect(ids(filterAndSortRecords(records, { ...DEFAULT_FILTERS, band: 'fatal' }, 'xvigilance'))).toEqual([1]);
    expect(filterAndSortRecords(records, { ...DEFAULT_FILTERS, band: 'fatal' }, 'parent')).toHaveLength(3);
  });

  it('searches the payload reason and filters by date', () => {
    expect(ids(filterAndSortRecords(records, { ...DEFAULT_FILTERS, search: 'FAN-OUT' }, 'xvigilance'))).toEqual([1]);
    expect(ids(filterAndSortRecords(records, { ...DEFAULT_FILTERS, from: '2026-11-04T00:00', to: '2026-11-06T00:00' }, 'xvigilance'))).toEqual([2]);
  });

  it('sorts by date and by fraud score', () => {
    expect(ids(filterAndSortRecords(records, DEFAULT_FILTERS, 'xvigilance'))).toEqual([3, 2, 1]);
    expect(ids(filterAndSortRecords(records, { ...DEFAULT_FILTERS, sort: 'date_asc' }, 'xvigilance'))).toEqual([1, 2, 3]);
    expect(ids(filterAndSortRecords(records, { ...DEFAULT_FILTERS, sort: 'score_desc' }, 'xvigilance'))).toEqual([1, 3, 2]);
  });
});

describe('buildReportsQuery', () => {
  it('sends the production server-side filters', () => {
    const url = buildReportsQuery({ tabId: 'evidence', offset: 50, filters: { ...DEFAULT_FILTERS, status: 'error', band: 'fatal', search: 'acc', from: '2026-11-01T00:00', to: '2026-11-02T00:00' } });
    const params = new URL(url, 'http://x').searchParams;
    expect(url.startsWith('/api/v1/reports/evidence?')).toBe(true);
    expect(Object.fromEntries(params)).toEqual({
      limit: '50', offset: '50', status: 'error', min_fraud_score: '90', q: 'acc', start_date: '2026-11-01T00:00', end_date: '2026-11-02T00:00',
    });
  });

  it('leaves band and dates off the Alert reports tab', () => {
    const url = buildReportsQuery({ tabId: 'parent', filters: { ...DEFAULT_FILTERS, band: 'high', from: '2026-11-01T00:00' } });
    expect(url).toBe('/api/v1/reports/parent?limit=50&offset=0');
  });
});

describe('Vigilance runs and paging', () => {
  it('reads zone-less run times as UTC and widens the window by 5 minutes', () => {
    expect(parseWindowTime('2026-11-14 10:00:00')).toBe(Date.parse('2026-11-14T10:00:00Z'));
    const view = vigilanceRunView({ window_start: '2026-11-14 10:00:00', window_end: '2026-11-14 11:00:00', run_id: 'r1' });
    expect(new Date(view.from).getTime()).toBe(Date.parse('2026-11-14T09:55:00Z'));
    expect(new Date(view.to).getTime()).toBe(Date.parse('2026-11-14T11:05:00Z'));
    expect(view.runId).toBe('r1');
  });

  it('summarises the page as production does', () => {
    expect(pageSummary({ offset: 50, shown: 50, loaded: 50, total: 120 })).toBe('Showing 51 to 100 of 120');
    expect(pageSummary({ offset: 0, shown: 3, loaded: 50, total: 120 })).toBe('Showing 1 to 3 of 120 (Filtered)');
  });
});

describe('list PDF rows', () => {
  const records = [
    toReportRecord(raw({ id: 1, external_reference_id: 'R1' }, { entity_id: 'E1', fraud_score: 50 }), 'evidence'),
    toReportRecord(raw({ id: 2, external_reference_id: 'R2' }, { entity_id: 'E1', fraud_score: 90 }), 'evidence'),
    toReportRecord(raw({ id: 3, external_reference_id: 'R3' }, { entity_id: 'E2' }), 'evidence'),
  ];

  it('uses Fraud Score on scored tabs and Source on Alert reports', () => {
    expect(buildReportRows(records, 'evidence').head[5]).toBe('Fraud Score');
    expect(buildReportRows(records, 'evidence').body[1][5]).toBe('90.0');
    expect(buildReportRows(records, 'parent').head[5]).toBe('Source');
  });

  it('ranks leading entities by appearances with their highest-scoring ref id', () => {
    expect(buildLeadingEntitySummary(records)).toEqual([[1, 'E1', 2, 'R2'], [2, 'E2', 1, 'R3']]);
  });
});

describe('getDomainDistribution', () => {
  it('reads an object, an array of items or a list of names, largest first', () => {
    expect(getDomainDistribution({ domain_distribution: { microfinance: 3, bank: 12, telecom: 0 } })).toEqual([{ domain: 'bank', count: 12 }, { domain: 'microfinance', count: 3 }]);
    expect(getDomainDistribution({ domain_distribution: [{ name: 'bank', share: 0.6 }, { domain: 'cdr', percentage: '0.4' }] })).toEqual([{ domain: 'bank', count: 0.6 }, { domain: 'cdr', count: 0.4 }]);
    expect(getDomainDistribution({ domain_distribution: ['bank', 'cdr', ''] })).toEqual([{ domain: 'bank', count: null }, { domain: 'cdr', count: null }]);
    expect(getDomainDistribution({})).toEqual([]);
    expect(getDomainDistribution({ domain_distribution: 'bank' })).toEqual([]);
  });
});
