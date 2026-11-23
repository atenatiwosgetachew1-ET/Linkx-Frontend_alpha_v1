// The parent-alert service as the Service offers it (frontend alignment
// 2026-11-20: H-3, H-4, H-5; the Service's docs/parent_alert_contract.md):
// the same interface as the mock (features/alerts/mock), so switching is a
// single change.

// Socket events; the payload is always { alert } (the full record).
const EVENTS = Object.freeze({
  assigned: 'parent_alert_assigned',
  reassigned: 'parent_alert_reassigned',
  updated: 'parent_alert_updated',
});

export function createLiveAlertService({ apiFetch, socket } = {}) {
  let listener = null;
  const handlers = [
    ...Object.entries(EVENTS).map(([reason, event]) => [event, (payload = {}) => {
      if (payload?.alert && typeof payload.alert === 'object') listener?.({ type: 'upsert', alert: payload.alert, reason });
    }]),
    // The alert's analysis run (to the assignee): { alert_id, task_id,
    // phase: 'progress' | 'completed' | 'failed', line?, flags?, verdict?,
    // message? }. parent_alert_updated follows every state change.
    ['parent_alert_analysis', (payload = {}) => {
      if (!payload?.alert_id || !['progress', 'completed', 'failed'].includes(payload.phase)) return;
      listener?.({
        type: 'analysis', alertId: String(payload.alert_id), taskId: String(payload.task_id || ''), phase: payload.phase,
        line: payload.line, flags: payload.flags, verdict: payload.verdict, message: payload.message,
      });
    }],
  ];
  const api = {
    kind: 'live',
    start(onEvent) {
      listener = onEvent;
      handlers.forEach(([event, handler]) => socket?.on?.(event, handler));
      return () => api.stop();
    },
    stop() {
      handlers.forEach(([event, handler]) => socket?.off?.(event, handler));
      listener = null;
    },
    // GET /api/v1/reports/parent?assignee=me|all ('all' needs alerts:read_all;
    // 403 alerts_read_all_required otherwise).
    async list({ assignee = 'me' } = {}) {
      const data = await apiFetch(`/api/v1/reports/parent?assignee=${assignee === 'all' ? 'all' : 'me'}&limit=50&offset=0`, { suppressForbiddenHandler: true });
      return Array.isArray(data?.data) ? data.data : [];
    },
    // POST /api/v1/reports/parent/:alert_id/analysis -> 202 { task, source_session_id, alert }
    startAnalysis: (alertId) => apiFetch(`/api/v1/reports/parent/${encodeURIComponent(alertId)}/analysis`, { method: 'POST' }),
    // POST /api/v1/reports/parent/:alert_id/feedback -> { alert, outcome:
    // 'acknowledged' | 'delivered' | 'already_sent' }; 502 { code:
    // 'delivery_failed', detail, retrying, alert }.
    sendFeedback: (alertId, body) => apiFetch(`/api/v1/reports/parent/${encodeURIComponent(alertId)}/feedback`, { method: 'POST', body }),
  };
  return api;
}
