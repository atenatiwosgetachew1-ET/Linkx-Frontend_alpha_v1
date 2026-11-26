// The STR alerts the browser knows (analysis-results-plan Phase 4): the
// alerts, each one's results draft (Extract results), its timeline and what
// is busy. Outside React, as the task registry, so notices and work go on
// whichever windows are open; components read it with
// useSyncExternalStore(subscribeAlerts, getAlertsSnapshot).

import { toAlertRecord } from './alertModel.js';

const MAX_EVENTS = 40;

let state = {
  mode: 'off', // 'off' | 'mock' | 'live'
  userId: '',
  identity: {}, // { userId, username, sub }: whose alerts are "mine" (H-3)
  alerts: [], // newest first: { ...alertRecord, raw }
  drafts: {}, // alertId -> draft (Extract results)
  events: {}, // alertId -> [{ at, type, text }] newest first
  busy: {}, // alertId -> 'analysing' | 'extracting' | 'sending'
  loading: false, // the list is being asked for (first load or a reload)
  loadError: '', // why the last list request failed ('' when it did not)
};
const listeners = new Set();
const emit = (next) => {
  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

export const subscribeAlerts = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getAlertsSnapshot = () => state;
export const getAlert = (id) => state.alerts.find((alert) => alert.id === String(id)) || null;

export const setAlertsMode = (mode, { userId = state.userId, username = '', sub = '' } = {}) => {
  if (mode === state.mode && userId === state.userId) return;
  emit({ mode, userId, identity: { userId, username, sub }, alerts: [], drafts: {}, events: {}, busy: {}, loading: false, loadError: '' });
};

// A record from the service (H-1/H-3 shape). -> { alert, previous }
export const upsertAlert = (raw) => {
  const alert = { ...toAlertRecord(raw, state.identity), raw };
  const previous = getAlert(alert.id);
  const alerts = previous
    ? state.alerts.map((entry) => (entry.id === alert.id ? alert : entry))
    : [alert, ...state.alerts];
  emit({ alerts });
  return { alert, previous };
};

// A local change (the browser's own state, e.g. "sending"), kept on the
// raw record so the next upsert from the service replaces it.
export const patchAlert = (id, rawPatch) => {
  const current = getAlert(id);
  if (!current) return null;
  return upsertAlert({ ...current.raw, ...rawPatch }).alert;
};

export const logAlertEvent = (id, type, text) => {
  const key = String(id);
  const list = [{ at: Date.now(), type, text }, ...(state.events[key] || [])].slice(0, MAX_EVENTS);
  emit({ events: { ...state.events, [key]: list } });
};

export const setAlertDraft = (id, patch) => {
  const key = String(id);
  const draft = patch === null ? undefined : { ...(state.drafts[key] || {}), ...patch };
  const drafts = { ...state.drafts };
  if (draft) drafts[key] = draft;
  else delete drafts[key];
  emit({ drafts });
};

export const setAlertBusy = (id, value) => {
  const busy = { ...state.busy };
  if (value) busy[String(id)] = value;
  else delete busy[String(id)];
  emit({ busy });
};

// The list request: { loading, loadError } (either may be left out).
export const setAlertsLoad = (patch) => emit(patch);

// Tests and sign-out.
export const resetAlerts = () => emit({ mode: 'off', userId: '', identity: {}, alerts: [], drafts: {}, events: {}, busy: {}, loading: false, loadError: '' });
