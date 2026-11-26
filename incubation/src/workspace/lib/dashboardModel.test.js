import { describe, expect, it } from 'vitest';

import { countAlerts, countTasks, countUsers, dashboardLevelOf, readFeedHealth, tasksByDay, weekMayBeShort } from './dashboardModel.js';

const NOW = new Date(2026, 10, 26, 15, 0).getTime();
const TODAY = new Date(2026, 10, 26, 9, 0).getTime();
const YESTERDAY = new Date(2026, 10, 25, 9, 0).getTime();

describe('the system panel figures', () => {
  it('names the level from permissions only', () => {
    const level = (list) => dashboardLevelOf((permission) => list.includes(permission)).label;
    expect(level([])).toBe('Analyst');
    expect(level(['tasks:read_all'])).toBe('Supervisor');
    expect(level(['alerts:read_all'])).toBe('Supervisor');
    expect(level(['users:manage'])).toBe('Administrator');
  });

  it('counts tasks: running, ended today, suspicious', () => {
    const tasks = [
      { status: 'running' },
      { status: 'completed', endedAt: TODAY, verdict: 'suspicious' },
      { status: 'completed', endedAt: YESTERDAY },
      { status: 'failed', endedAt: TODAY },
      { status: 'terminated', endedAt: YESTERDAY },
    ];
    expect(countTasks(tasks, NOW)).toMatchObject({ running: 1, finishedToday: 1, stopped: 1, suspicious: 1, latest: tasks[0] });
    expect(countTasks([], NOW).latest).toBeNull();
  });

  it('counts STR alerts by where they stand, and leaves out what is not an alert', () => {
    const alerts = [
      { isAlert: true, response: 'awaiting_analysis', intake: 'complete', assigneeName: 'A' },
      { isAlert: true, response: 'awaiting_analysis', intake: 'receiving' },
      { isAlert: true, response: 'analysed', intake: 'complete', assigneeName: 'A' },
      { isAlert: true, response: 'feedback_failed', intake: 'complete', assigneeName: 'A' },
      { isAlert: false, response: 'awaiting_analysis' },
    ];
    expect(countAlerts(alerts)).toEqual({ total: 4, awaiting: 1, arriving: 1, toSend: 1, failed: 1, unassigned: 1 });
  });

  it('reads the Service answers, and nothing from an answer of another shape', () => {
    expect(countUsers([{ is_active: true }, { is_active: false }, {}])).toEqual({ total: 3, active: 2 });
    expect(countUsers({ results: [{}] })).toEqual({ total: 1, active: 1 });
    expect(countUsers({ detail: 'x' })).toBeNull();
    expect(readFeedHealth({ success: false })).toBeNull();
    expect(readFeedHealth({
      success: true,
      checkpoint: { feed_name: 'feed', status: 'running', is_paused: false, total_graph_analyzed: 12 },
      recent_runs: [{ status: 'completed', duration_ms: 900 }, { status: 'failed' }],
    })).toMatchObject({ name: 'feed', paused: false, analysed: 12, lastRun: { status: 'completed', durationMs: 900 }, failedRuns: 1, runs: 2 });
  });

  it('spreads ended tasks over the last 7 days, oldest first', () => {
    const days = tasksByDay([
      { status: 'completed', endedAt: TODAY },
      { status: 'failed', endedAt: TODAY },
      { status: 'completed', endedAt: YESTERDAY },
      { status: 'running' },
      { status: 'completed', endedAt: new Date(2026, 10, 10).getTime() },
    ], NOW);
    expect(days).toHaveLength(7);
    expect(days.map((day) => [day.finished, day.stopped])).toEqual([[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [1, 0], [1, 1]]);
  });

  it('says when the days may be short of tasks: the list is full and all of it is recent', () => {
    const recent = Array.from({ length: 50 }, () => ({ status: 'completed', endedAt: YESTERDAY }));
    expect(weekMayBeShort(recent, recent, NOW)).toBe(true);
    expect(weekMayBeShort(recent.slice(0, 10), recent.slice(0, 10), NOW)).toBe(false);
    const withOld = [...recent.slice(1), { status: 'completed', endedAt: new Date(2026, 10, 10).getTime() }];
    expect(weekMayBeShort(withOld, withOld, NOW)).toBe(false);
  });

  it('keeps the feed’s recent runs oldest first, failed ones marked', () => {
    const feed = readFeedHealth({ success: true, recent_runs: [{ status: 'failed', duration_ms: 5 }, { status: 'completed', duration_ms: 9 }] });
    expect(feed.recent).toEqual([{ status: 'completed', durationMs: 9, failed: false }, { status: 'failed', durationMs: 5, failed: true }]);
  });
});
