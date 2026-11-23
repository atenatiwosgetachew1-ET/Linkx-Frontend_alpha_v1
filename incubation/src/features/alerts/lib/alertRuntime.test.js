// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// No chart library or offscreen canvas in jsdom: both stand in.
vi.mock('../../chart/lib/chartReport.js', () => ({
  reportChartCells: vi.fn(async () => ({ cells: [{ title: 'Degree Centrality', level: 'Node', image: 'data:image/png;base64,C' }], skipped: [] })),
  AUTO_REPORT_CHARTS: [],
  autoReportCards: () => [],
}));
vi.mock('../../graph/lib/offscreenSnapshot.js', async (original) => ({ ...(await original()), renderOffscreenSnapshot: vi.fn(async () => 'data:image/png;base64,G') }));

const { createMockAlertService } = await import('../mock/mockAlertService.js');
const runtime = await import('./alertRuntime.js');
const { getAlert, getAlertsSnapshot, resetAlerts } = await import('./alertStore.js');
const { getTask, resetTasks } = await import('../../tasks/lib/taskRegistry.js');

const flush = (ms) => vi.advanceTimersByTimeAsync(ms);

describe('STR alert workflow on the mock service', () => {
  let notify;
  let openWindow;
  beforeEach(() => {
    vi.useFakeTimers();
    notify = vi.fn();
    openWindow = vi.fn(() => 'graph-9');
    runtime.setAlertEnvironment({ notify, openWindow, focusWindow: vi.fn(), getWindows: () => [], onArrival: vi.fn(), openReports: vi.fn(), username: 'Me' });
    runtime.startAlertService(createMockAlertService({ userId: 'u1', username: 'Me' }), { mode: 'mock', userId: 'u1' });
  });
  afterEach(() => {
    runtime.stopAlertService();
    resetAlerts();
    resetTasks();
    vi.useRealTimers();
  });

  it('arrival and data: seeded alerts, a summary notice, data completing, a new alert', async () => {
    await flush(0);
    expect(getAlertsSnapshot().alerts.map((alert) => alert.reference)).toEqual(expect.arrayContaining(['STR-2026-0141', 'STR-2026-0139', 'STR-2026-0137', 'STR-2026-0135']));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: '1 STR alert needs your analysis', source: 'STR alerts (mock)' }));
    await flush(6000);
    expect(getAlert('mock-139').intake).toBe('complete');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'STR alert ready for analysis', message: 'STR-2026-0139: all its data has arrived.' }));
    await flush(14000);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'New STR alert' }));
  });

  it('analyse → extract → report back: a task, the graph opened, the draft, sent and acknowledged', async () => {
    await flush(0);
    const started = await runtime.runAlertAnalysis('mock-141');
    expect(started.ok).toBe(true);
    expect(getTask(started.taskId)).toMatchObject({ origin: 'parent', title: 'STR link analysis', status: 'running', alertId: 'mock-141' });
    expect(getAlert('mock-141').response).toBe('analysing');
    await flush(4000);
    expect(getTask(started.taskId).status).toBe('completed');
    expect(getTask(started.taskId).log.at(-1)).toMatch(/flags:/);
    expect(getAlert('mock-141').response).toBe('analysed');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'STR analysis finished' }));
    expect(openWindow).toHaveBeenCalledWith('graph', expect.objectContaining({ metadata: expect.objectContaining({ alert: { id: 'mock-141', reference: 'STR-2026-0141' } }) }));
    // Extract: no Graph window open, so the alert's graph with the defaults.
    expect(runtime.feedbackBlocker(getAlert('mock-141'), null)).toBe('Extract the results first.');
    expect((await runtime.extractAlertResults('mock-141')).ok).toBe(true);
    const draft = getAlertsSnapshot().drafts['mock-141'];
    expect(draft).toMatchObject({ verdict: 'suspicious', graphImage: 'data:image/png;base64,G', include: { graph: true, table: true, charts: true } });
    expect(draft.tables.map((table) => table.title)).toEqual(['Entities', 'Relationships']);
    expect(draft.charts.map((chart) => chart.title)).toEqual(['Degree Centrality']);
    expect(draft.findings).toMatch(/most connected/);
    // Report back.
    const sending = runtime.sendAlertFeedback('mock-141');
    expect(getAlert('mock-141').response).toBe('feedback_sending');
    await flush(1200);
    expect((await sending).ok).toBe(true);
    expect(getAlert('mock-141').response).toBe('feedback_sent');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'STR feedback sent' }));
    await flush(4000);
    expect(getAlert('mock-141').response).toBe('acknowledged');
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'STR feedback acknowledged' }));
  });

  it('a failed delivery is said once and can be retried; a reassigned alert can no longer be sent', async () => {
    await flush(6000); // STR-0139's data completes
    await runtime.runAlertAnalysis('mock-139');
    await flush(4000);
    await runtime.extractAlertResults('mock-139');
    const first = runtime.sendAlertFeedback('mock-139');
    await flush(1200);
    expect((await first).ok).toBe(false);
    expect(getAlert('mock-139').response).toBe('feedback_failed');
    expect(notify.mock.calls.filter(([notice]) => notice.title === 'STR feedback failed')).toHaveLength(1);
    const retry = runtime.sendAlertFeedback('mock-139');
    await flush(1200);
    expect((await retry).ok).toBe(true);
    expect(getAlert('mock-139').response).toBe('feedback_sent');
    // Reassigned away: a notice, and no more feedback.
    runtime.simulateAlert('reassign', 'mock-141');
    expect(getAlert('mock-141').mine).toBe(false);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ title: 'STR alert reassigned' }));
    expect((await runtime.runAlertAnalysis('mock-141')).message).toMatch(/only the assignee/);
  });
});
