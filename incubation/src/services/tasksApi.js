// The Service's analysis tasks and saved evidence (frontend alignment
// 2026-11-20: H-2, H-6).
//
//   GET  /api/v1/tasks?scope=mine|all&archived=&limit=&offset= -> { data, count }
//   POST /api/v1/tasks/<task_id>/reconfirm                      -> { task }
//   POST /api/v1/reports/evidence { task_id, title?, summary?, include_graph }
//        -> 201 { evidence, created: true } | 200 { evidence, created: false }
// Refusals carry a `code` (task_expired, task_not_completed,
// graph_unavailable…; services/apiErrors.js getServiceRefusalMessage).

export const TASKS_PAGE_SIZE = 50;

export const listTasks = async (apiFetch, { scope = 'mine', archived = false, limit = TASKS_PAGE_SIZE, offset = 0, signal } = {}) => {
  const params = new URLSearchParams({ scope: scope === 'all' ? 'all' : 'mine', limit: String(limit), offset: String(offset) });
  if (archived) params.set('archived', 'true');
  const data = await apiFetch(`/api/v1/tasks?${params.toString()}`, { suppressForbiddenHandler: true, signal });
  return { tasks: Array.isArray(data?.data) ? data.data : [], count: Number(data?.count) || 0 };
};

export const reconfirmTask = async (apiFetch, serverId) => {
  const data = await apiFetch(`/api/v1/tasks/${encodeURIComponent(serverId)}/reconfirm`, { method: 'POST', body: {} });
  return data?.task || null;
};

// Seats for runs that go on without a browser (B-38).
//   GET  /api/v1/unattended-seats                 -> { seats: { total, available } }
//   POST /api/v1/tasks/<task_id>/unattended { on } -> { task, seats }
export const fetchUnattendedSeats = (apiFetch) => apiFetch('/api/v1/unattended-seats', { suppressForbiddenHandler: true });
export const setTaskUnattended = (apiFetch, serverId, on) => apiFetch(`/api/v1/tasks/${encodeURIComponent(serverId)}/unattended`, { method: 'POST', body: { on: Boolean(on) }, suppressForbiddenHandler: true });

export const EVIDENCE_TITLE_MAX = 300;
export const EVIDENCE_SUMMARY_MAX = 4000;

export const saveTaskEvidence = async (apiFetch, { serverId, title = '', summary = '', includeGraph = true }) => {
  const body = { task_id: String(serverId), include_graph: Boolean(includeGraph) };
  const cleanTitle = String(title || '').trim().slice(0, EVIDENCE_TITLE_MAX);
  const cleanSummary = String(summary || '').trim().slice(0, EVIDENCE_SUMMARY_MAX);
  if (cleanTitle) body.title = cleanTitle;
  if (cleanSummary) body.summary = cleanSummary;
  const data = await apiFetch('/api/v1/reports/evidence', { method: 'POST', body });
  return { evidence: data?.evidence || null, created: data?.created !== false };
};
