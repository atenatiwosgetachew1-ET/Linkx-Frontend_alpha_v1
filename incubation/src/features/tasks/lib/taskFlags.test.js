import { describe, expect, it } from 'vitest';

import { TASK_STATUSES } from './taskRegistry.js';
import { FLAG_STATES, scanFlagLines, taskFlagVerdict } from './taskFlags.js';

const backend = (...messages) => messages.map((message) => ({ message, source: 'backend' }));
const running = { status: TASK_STATUSES.RUNNING };
const completed = { status: TASK_STATUSES.COMPLETED };

describe('scanFlagLines', () => {
  it('reads flag lists, rule hits and counts', () => {
    const result = scanFlagLines(backend(
      '[10:00:01] [Info] - Flagged rules: Smurfing, Dormant to Active',
      "[10:00:02] [Info] - flagged_rules=['Smurfing', 'High-Degree Hub']",
      '[10:00:03] [Warn] - Rule Rapid Velocity Flow triggered for ACC-1',
      '[10:00:04] [Info] - flagged_nodes: 7',
    ));
    expect(result.flags).toEqual([
      { name: 'Smurfing', count: 2 },
      { name: 'Dormant to Active', count: 1 },
      { name: 'High-Degree Hub', count: 1 },
      { name: 'Rapid Velocity Flow', count: 1 },
    ]);
    expect(result.count).toBe(7);
  });

  it('aggregates similar flag names and counts them, most frequent first', () => {
    const result = scanFlagLines(backend(
      'Flagged rules: Dormant to Active',
      'Flagged rules: smurfing_rule, dormant-to-active',
      'Rule SMURFING triggered',
      'Suspicious: Smurfings',
      'Rule Smurfing triggered',
    ));
    expect(result.flags).toEqual([
      { name: 'Smurfing', count: 4 },
      { name: 'Dormant to Active', count: 2 },
    ]);
  });

  it('ignores ids, amounts, context and small typos', () => {
    const result = scanFlagLines(backend(
      'Suspicious: Smurfing for ACC-1001 (5,000 ETB)',
      'Suspicious: Smurfing on account 22 [score 0.91]',
      'Suspicious: Smurfng',
      'Suspicious: Dormant to Active',
      'Suspicious: Active to Dormant',
      'Suspicious: High-Degree Hub ACC-7',
      'Suspicious: high degree hub',
      'Suspicious: Degree Hub',
    ));
    expect(result.flags).toEqual([
      { name: 'Smurfing', count: 3 },
      { name: 'High-Degree Hub', count: 3 },
      { name: 'Dormant to Active', count: 1 },
      { name: 'Active to Dormant', count: 1 },
    ]);
  });

  it('counts a flag once per line', () => {
    const result = scanFlagLines(backend('Flagged rules: Smurfing, smurfing - rule Smurfing triggered'));
    expect(result.flags).toEqual([{ name: 'Smurfing', count: 1 }]);
  });

  it('treats explicit empty results as clean', () => {
    expect(scanFlagLines(backend('flagged_rules: []')).cleanSeen).toBe(true);
    expect(scanFlagLines(backend('No anomalies detected')).cleanSeen).toBe(true);
    expect(scanFlagLines(backend('Flags: none')).flags).toEqual([]);
  });

  it('ignores local status lines for streams and unrelated text', () => {
    expect(scanFlagLines([{ message: 'Flagged rules: X' }]).flags).toEqual([]);
    expect(scanFlagLines(backend('Injection started', 'clean_nodes: 5', 'Alert: connection slow')).flags).toEqual([]);
  });
});

// Excerpt of a real stream log (Link Analysis, bank_transactions rule).
const REAL_LOG = backend(
  "[2026-11-13 16:11:09.074303] [Info] - Link Analysis rule resolved: bank_transactions (Using built-in rule module.)",
  '[2026-11-13 16:11:11.121132] [Info] - Risk entities loaded: 0',
  '[2026-11-13 16:11:13.664999] [Info] EFFECTIVE_FLOW rule completed. Created 0 edges.',
  '[2026-11-13 16:11:14.874700] [Info] FUND_FLOW incremental completed (Python accelerated: 9 edges).',
  "[2026-11-13 16:11:21.590064] [Info] Incremental analysis for batch 4_272273_1 flags: {'FUND_FLOW': 9, 'LATE_NIGHT_TX': 417, 'DORMANT_TO_ACTIVE': 20, 'HUB_AND_SPOKE': 2, 'RAPID_WITHDRAWAL': 2}",
  "[2026-11-13 16:11:21.663620] [Info] Live analysis batch 1 flags: {'FUND_FLOW': 9, 'LATE_NIGHT_TX': 417, 'DORMANT_TO_ACTIVE': 20, 'HUB_AND_SPOKE': 2, 'RAPID_WITHDRAWAL': 2}",
  "[2026-11-13 16:11:45.549804] [Info] Incremental analysis for batch 4_272273_5 flags: {'LATE_NIGHT_TX': 2034, 'FUND_FLOW': 248, 'DORMANT_TO_ACTIVE': 108, 'HUB_AND_SPOKE': 153, 'RAPID_WITHDRAWAL': 7}",
  "[2026-11-13 16:11:45.678681] [Info] Live analysis batch 5 flags: {'LATE_NIGHT_TX': 2034, 'FUND_FLOW': 248, 'DORMANT_TO_ACTIVE': 108, 'HUB_AND_SPOKE': 153, 'RAPID_WITHDRAWAL': 7}",
);

describe('backend batch flag summaries', () => {
  it('reads the flags dict, keeps the latest running total per rule and names it readably', () => {
    expect(scanFlagLines(REAL_LOG).flags).toEqual([
      { name: 'Late Night TX', count: 2034 },
      { name: 'Fund Flow', count: 248 },
      { name: 'Hub and Spoke', count: 153 },
      { name: 'Dormant to Active', count: 108 },
      { name: 'Rapid Withdrawal', count: 7 },
    ]);
    expect(taskFlagVerdict(running, REAL_LOG).state).toBe(FLAG_STATES.SUSPICIOUS);
  });

  it('is clean when every rule reports zero', () => {
    const result = scanFlagLines(backend("Live analysis batch 1 flags: {'FUND_FLOW': 0}", 'Live analysis batch 2 flags: {}'));
    expect(result).toMatchObject({ flags: [], cleanSeen: true });
  });
});

describe('taskFlagVerdict', () => {
  it('is suspicious with the flag names (or a count)', () => {
    const verdict = taskFlagVerdict(running, backend('Suspicious: Smurfing'));
    expect(verdict).toMatchObject({ state: FLAG_STATES.SUSPICIOUS, label: 'Suspicious', flags: [{ name: 'Smurfing', count: 1 }] });
    expect(taskFlagVerdict(completed, backend('flagged_accounts: 3')).detail).toBe('3 flagged');
  });

  it('is pending while running, clean when finished without flags, undetermined when stopped', () => {
    expect(taskFlagVerdict(running, []).state).toBe(FLAG_STATES.PENDING);
    expect(taskFlagVerdict(completed, []).state).toBe(FLAG_STATES.CLEAN);
    expect(taskFlagVerdict({ status: TASK_STATUSES.TERMINATED }, []).state).toBe(FLAG_STATES.UNDETERMINED);
    expect(taskFlagVerdict({ status: TASK_STATUSES.TERMINATED }, backend('No flags found')).state).toBe(FLAG_STATES.CLEAN);
  });

  it('reads all lines of quick-panel tasks', () => {
    const verdict = taskFlagVerdict(completed, [{ message: 'Analysis complete. Flagged rules: A, B' }], { backendOnly: false });
    expect(verdict.flags.map((flag) => flag.name)).toEqual(['A', 'B']);
  });
});
