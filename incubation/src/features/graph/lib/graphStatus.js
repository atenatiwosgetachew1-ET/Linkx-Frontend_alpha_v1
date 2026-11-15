// Live graph status per analysis session (production "graph status socket",
// src/App.jsx ~12419-12716; graph-chart-plan §3.4).
//
// Socket protocol (unchanged from production):
//   emit  graph_status_subscribe   { session_id }
//   emit  graph_status_unsubscribe { session_id }
//   on    status { type: 'session_status'|'metadata'|'relationships', data, error, session_id }
//
// Subscriptions are reference-counted: every Graph window linked to a session
// and every Source window streaming in it holds one; the socket subscription
// ends with the last holder. Entries live outside React, so switching docked
// tabs never drops them, and are re-subscribed after a reconnect or a new
// socket (token renewal).

const EMPTY_ENTRY = Object.freeze({ status: null, summary: null, relationships: [], terminated: false, closed: false, error: '' });
const ERROR_NOTICE_DEDUP_MS = 60000;

const entries = new Map(); // sessionId -> entry
const holders = new Map(); // sessionId -> count
const listeners = new Map(); // sessionId -> Set<fn>
const relationshipHashes = new Map();
const lastErrorNotice = new Map();
let boundSocket = null;
let notifier = null;

const contrastText = (hex) => {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!match) return '#FFFFFF';
  const value = parseInt(match[1], 16);
  const yiq = (((value >> 16) & 255) * 299 + ((value >> 8) & 255) * 587 + (value & 255) * 114) / 1000;
  return yiq >= 128 ? '#333333' : '#FFFFFF';
};

// Production normalizeGraphRelationships (A:3529).
export const normalizeGraphRelationships = (value) => {
  const source = Array.isArray(value)
    ? value
    : value?.relationships ?? value?.results?.relationships ?? value?.result?.relationships ?? value?.data?.relationships ?? value?.items ?? [];
  if (!Array.isArray(source)) return [];
  return source.map((item, index) => {
    if (typeof item === 'string' || typeof item === 'number') return { id: String(item), type: String(item), bgcolor: '#555555', textcolor: '#FFFFFF' };
    if (!item || typeof item !== 'object') return null;
    const type = String(item.type ?? item.relationship ?? item.name ?? item.label ?? item.id ?? '').trim();
    if (!type) return null;
    const bgcolor = item.bgcolor ?? item.bgColor ?? item.bg_color ?? item.backgroundColor ?? item.color ?? '#555555';
    const textcolor = item.textcolor ?? item.textColor ?? item.text_color ?? item.fontColor ?? item.font_color ?? item.labelColor ?? item.label_color ?? contrastText(bgcolor);
    return { ...item, id: item.id ?? type ?? index, type, bgcolor, textcolor };
  }).filter(Boolean);
};

const pick = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

// Production buildGraphInfoPayload (A:12431): the "session info" card.
export const describeGraphSession = (entry) => {
  const base = entry?.status && typeof entry.status === 'object' ? entry.status : {};
  const summary = entry?.summary && typeof entry.summary === 'object' ? entry.summary : (base.summary && typeof base.summary === 'object' ? base.summary : {});
  const relationships = entry?.relationships || [];
  return {
    status: entry?.terminated ? 'terminated' : pick(base.status, base.session_status, summary.status, summary.session_status),
    runId: pick(base.run_id, summary.run_id),
    totalNodes: pick(base.total_nodes, base.totalNodes, base.available_nodes, base.node_count, base.nodes_count, summary.total_nodes, summary.totalNodes, summary.available_nodes, summary.node_count,
      (summary.clean_nodes != null && summary.flagged_nodes != null) ? Number(summary.clean_nodes) + Number(summary.flagged_nodes) : undefined),
    totalRelationships: pick(base.total_relationships, base.totalRelationships, base.relationship_count, base.relationships_count, base.edges_count, base.edge_count,
      summary.total_relationships, summary.totalRelationships, summary.relationship_count, relationships.length || undefined),
    relationshipLabels: relationships.map((item) => item.type),
    summary,
  };
};

const emit = (sessionId) => listeners.get(sessionId)?.forEach((listener) => listener());
const setEntry = (sessionId, patch) => {
  entries.set(sessionId, { ...(entries.get(sessionId) || EMPTY_ENTRY), ...patch });
  emit(sessionId);
};

const handleStatus = (payload = {}) => {
  const sessionId = String(payload.session_id || '').trim();
  if (!sessionId) return;
  const { type, data, error } = payload;
  if (error) {
    // Production: a notice only when a Graph window is linked, at most once a minute.
    if (!holders.get(sessionId)) return;
    const text = typeof error === 'string' ? error : JSON.stringify(error);
    const key = `${sessionId}::${text}`;
    const now = Date.now();
    if (now - (lastErrorNotice.get(key) || 0) < ERROR_NOTICE_DEDUP_MS) return;
    lastErrorNotice.set(key, now);
    notifier?.({ title: 'Graph status update', message: 'Graph status is temporarily unavailable for this source.', source: `Session ${sessionId}`, level: 'warning', durationMs: 6000 });
    return;
  }
  const previous = entries.get(sessionId) || EMPTY_ENTRY;
  if (type === 'session_status') {
    const statusData = data && typeof data === 'object' ? data : {};
    const prior = previous.status && typeof previous.status === 'object' ? previous.status : {};
    setEntry(sessionId, {
      terminated: false,
      status: {
        ...prior,
        status: statusData.status ?? prior.status ?? prior.session_status,
        session_status: statusData.status ?? prior.session_status ?? prior.status,
        run_id: statusData.run_id ?? prior.run_id,
      },
    });
    return;
  }
  if (type === 'metadata') {
    const metadata = data?.metadata ?? data?.results?.metadata ?? data?.result?.metadata ?? data?.status ?? data;
    setEntry(sessionId, {
      terminated: false,
      status: metadata && typeof metadata === 'object' ? metadata : previous.status,
      summary: data?.summary ?? data?.results?.summary ?? data?.result?.summary ?? previous.summary,
    });
    return;
  }
  if (type === 'relationships') {
    const relationships = normalizeGraphRelationships(data);
    const hash = JSON.stringify(relationships.map((item) => [item.id, item.type, item.textcolor, item.bgcolor]));
    if (relationshipHashes.get(sessionId) === hash) return;
    relationshipHashes.set(sessionId, hash);
    setEntry(sessionId, { relationships, terminated: false });
  }
};

const resubscribeAll = () => {
  if (!boundSocket?.connected) return;
  holders.forEach((count, sessionId) => {
    if (count > 0) boundSocket.emit('graph_status_subscribe', { session_id: sessionId });
  });
};

// The session socket (re-created on token renewal); subscriptions follow it.
export const bindGraphStatusSocket = (socket) => {
  if (!socket || boundSocket === socket) return;
  if (boundSocket) {
    boundSocket.off('status', handleStatus);
    boundSocket.off('connect', resubscribeAll);
  }
  boundSocket = socket;
  socket.on('status', handleStatus);
  socket.on('connect', resubscribeAll);
  resubscribeAll();
};

export const setGraphStatusNotifier = (notify) => {
  notifier = notify;
};

// Hold a subscription; returns the release function.
export const retainGraphStatus = (rawSessionId) => {
  const sessionId = String(rawSessionId || '').trim();
  if (!sessionId) return () => {};
  const count = (holders.get(sessionId) || 0) + 1;
  holders.set(sessionId, count);
  if (count === 1 && boundSocket?.connected) boundSocket.emit('graph_status_subscribe', { session_id: sessionId });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (holders.get(sessionId) || 1) - 1;
    if (next > 0) {
      holders.set(sessionId, next);
      return;
    }
    holders.delete(sessionId);
    if (boundSocket?.connected) boundSocket.emit('graph_status_unsubscribe', { session_id: sessionId });
  };
};

export const subscribeGraphSession = (rawSessionId, listener) => {
  const sessionId = String(rawSessionId || '').trim();
  if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
  listeners.get(sessionId).add(listener);
  return () => listeners.get(sessionId)?.delete(listener);
};

export const getGraphSession = (rawSessionId) => entries.get(String(rawSessionId || '').trim()) || EMPTY_ENTRY;

// Production clearLinkedGraphStatusForSession (A:14220): the source was
// terminated; relationships are cleared and linked windows unlink.
export const markGraphSessionTerminated = (rawSessionId) => {
  const sessionId = String(rawSessionId || '').trim();
  if (!sessionId) return;
  relationshipHashes.delete(sessionId);
  setEntry(sessionId, { relationships: [], terminated: true, status: { status: 'terminated', total_relationships: 0 } });
};

// Production (A:13529): closing (and stopping) the Source window resets the
// Graph windows linked to its session to the empty placeholder.
export const markGraphSessionClosed = (rawSessionId) => {
  const sessionId = String(rawSessionId || '').trim();
  if (!sessionId) return;
  relationshipHashes.delete(sessionId);
  setEntry(sessionId, { relationships: [], terminated: true, closed: true, status: { status: 'terminated', total_relationships: 0 } });
};

// Held subscriptions, for the workspace bridge and tests.
export const heldGraphSessions = () => [...holders.keys()];

// Signed out.
export const clearGraphStatus = () => {
  entries.clear();
  holders.clear();
  relationshipHashes.clear();
  lastErrorNotice.clear();
  listeners.forEach((set, sessionId) => emit(sessionId));
};
