// Linking a Graph window to a Source session (production graph_link_form,
// src/App.jsx ~16607-16848). Shared by the Graph window's Link menu, the
// Source window's "Open graph" and the Tasks window's "Show graph".
//
// Production rules kept:
// - a link is only possible while that source is starting or streaming (or
//   has completed, for a run opened from Tasks: isRunGraphAvailable);
// - POST /graph_link { id: "link", source_id, graph_window_id };
// - on success the window follows the session's live status; relationships
//   already known for the session show at once;
// - unlink sends { id: "unlink", ... } and resets the window to empty,
//   whatever the backend answers.

import { isSuccessResponse } from '../../../services/apiClient.js';
import { linkGraphWindow, sanitizeGraphEndpointId } from '../../../services/graphApi.js';
import { TASK_ORIGINS, TASK_STATUSES, getLatestTaskForWindow, getTasks, isTaskActive } from '../../tasks/lib/taskRegistry.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { getGraphStore } from './graphStore.js';

// Analysis sessions with a running Source stream (production
// isSourceActiveForGraphLink: stream starting or running).
export const streamingSessionIds = (tasks = getTasks()) => new Set(
  tasks
    .filter((task) => task.origin === TASK_ORIGINS.SOURCE && isTaskActive(task) && task.sourceSessionId)
    .map((task) => String(task.sourceSessionId)),
);

export const isSessionStreaming = (sessionId) => streamingSessionIds().has(String(sessionId || ''));

// A run's graph can be shown (Tasks ▸ Show graph) while it runs, and once it
// has completed for as long as its Source window is open. Production has no
// "completed" stream state (src/App.jsx STREAM_STATUSES): a finished run stays
// linkable until it is terminated, fails, or its window closes. Not for:
// - a run of another page or tab (remote): its session may be gone, and after
//   a reload its id is given to a new Source window;
// - an earlier run of a window that has run again: both share one session,
//   so the request would return the newer run's graph.
export const isRunGraphAvailable = (task, windows = []) => {
  if (!task || task.remote || task.origin !== TASK_ORIGINS.SOURCE || !task.sourceSessionId) return false;
  if (isTaskActive(task)) return true;
  // A background run that completed, its session held for its graph.
  if (task.status === TASK_STATUSES.COMPLETED && task.heldSession) return true;
  return task.status === TASK_STATUSES.COMPLETED
    && getLatestTaskForWindow(task.windowId)?.id === task.id
    && windows.some((item) => item.type === WORKSPACE_WINDOW_TYPES.SOURCE && item.id === task.windowId
      && String(item.sourceSessionId || '') === String(task.sourceSessionId));
};

// The Service keeps the finished run's graph (24 hours, by task id; B-37): it
// needs no window, session or Neo4j login, and a second run does not touch it.
export const isRunGraphKept = (task, now = Date.now()) => Boolean(task?.serverId) && !isTaskActive(task) && task.graphSaved === true && !(task.graphExpiresAt && task.graphExpiresAt <= now);

// Why a run's graph can no longer be had ('' when it can).
export const runGraphMissingReason = (task, windows = []) => {
  if (!task || isRunGraphKept(task) || isRunGraphAvailable(task, windows)) return '';
  if (task.graphSaved && task.graphExpiresAt) return 'The Service kept its graph for 24 hours, and no longer has it.';
  if (task.remote) return 'This run was not made in this page, so its graph can no longer be reached.';
  if (task.windowId && getLatestTaskForWindow(task.windowId)?.id !== task.id) return 'Its Source window has run again since, so its graph can no longer be told apart.';
  if (task.background) return 'Its session was released, so its graph can no longer be reached.';
  return 'Its Source window is closed, so its graph can no longer be reached.';
};

// Source windows a Graph window can link to right now.
export const linkableSources = (windows = [], tasks = getTasks()) => {
  const streaming = streamingSessionIds(tasks);
  return windows
    .filter((item) => item.type === WORKSPACE_WINDOW_TYPES.SOURCE && streaming.has(String(item.sourceSessionId || '')))
    .map((item) => ({ windowId: item.id, sessionId: String(item.sourceSessionId), title: item.title }));
};

// Production graph_link_form (src/App.jsx ~10218, ~16625): the analyst types
// a window ID, matched against a Source window's id or its session id. Here
// the shown title ("Source 1234") and the backend window id match too.
export const resolveSourceWindow = (input, windows = []) => {
  const raw = String(input || '').trim();
  const key = sanitizeGraphEndpointId(raw);
  if (!key) return null;
  return windows.find((item) => item.type === WORKSPACE_WINDOW_TYPES.SOURCE && (
    String(item.id) === key
    || String(item.sourceSessionId || '') === key
    || String(item.backendWindowId || '') === key
    || String(item.title || '').toLowerCase() === raw.toLowerCase()
  )) || null;
};

// finishedRun: the caller checked isRunGraphAvailable.
export const linkGraphToSession = async ({ apiFetch, updateWindowMetadata, notify, graphWindowId, sourceSessionId, action = '', finishedRun = false }) => {
  const sessionId = String(sourceSessionId || '').trim();
  if (!finishedRun && !isSessionStreaming(sessionId)) {
    notify?.({
      title: 'Graph link blocked',
      message: 'The selected source is not actively ingesting or streaming. Start ingestion or streaming first, then try again.',
      level: 'warning',
    });
    return false;
  }
  updateWindowMetadata(graphWindowId, { metadata: { graphLinking: sessionId } });
  try {
    const data = await linkGraphWindow(apiFetch, { sourceSessionId: sessionId, graphWindowId });
    if (!isSuccessResponse(data)) throw new Error(data?.message || 'link rejected');
    // A graph loaded for something else is not this session's (a graph the
    // analyst started here is theirs, and stays until a relationship loads).
    const store = getGraphStore(graphWindowId);
    store.abortFetch();
    if (['relationship', 'evidence', 'import', 'run'].includes(store.getStatus().source)) store.clear();
    store.setStatus({ state: 'idle' });
    updateWindowMetadata(graphWindowId, {
      metadata: { graphLinking: null, graphLinkSource: sessionId, graphLinkedAt: Date.now(), graphLinkAction: action || null, graphRelationship: null, graphImported: null, graphTaskId: null, evidence: null },
    });
    notify?.({ title: 'Graph linked', message: `Linked to session ${sessionId}.`, level: 'success' });
    return true;
  } catch {
    updateWindowMetadata(graphWindowId, { metadata: { graphLinking: null } });
    notify?.({
      title: 'Graph link failed',
      message: 'The selected source window could not be linked. Please check the source window and try again.',
      level: 'error',
    });
    return false;
  }
};

export const unlinkGraph = async ({ apiFetch, updateWindowMetadata, graphWindowId, sourceSessionId }) => {
  try {
    await linkGraphWindow(apiFetch, { sourceSessionId, graphWindowId, action: 'unlink' });
  } catch {
    // Production ignores the answer: the window is reset either way.
  }
  const store = getGraphStore(graphWindowId);
  store.abortFetch();
  store.clear();
  store.setStatus({ state: 'idle' });
  updateWindowMetadata(graphWindowId, { metadata: { graphLinkSource: null, graphLinkAction: null, graphRelationship: null, graphSearch: null } });
};

// Opens a new Graph window and links it (Source "Open graph", Tasks "Show
// graph"). Production opened, then linked after a 150 ms timer; here the
// window id is known up front, so no timer is needed.
export const openLinkedGraphWindow = async ({ workspace, apiFetch, notify, sourceSessionId, title, customTitle, metadata = {}, action = '', finishedRun = false }) => {
  const graphWindowId = workspace.nextWindowId(WORKSPACE_WINDOW_TYPES.GRAPH);
  const opened = workspace.openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id: graphWindowId, title: title || 'Graph', customTitle, metadata });
  if (!opened) return null;
  await linkGraphToSession({ apiFetch, updateWindowMetadata: workspace.updateWindowMetadata, notify, graphWindowId, sourceSessionId, action, finishedRun });
  return graphWindowId;
};
