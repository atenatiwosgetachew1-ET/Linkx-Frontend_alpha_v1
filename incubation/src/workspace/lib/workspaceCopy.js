// The last workspace, kept in this browser so it can be offered after a
// reload or a sign-in (analyst decision 2026-11-24): one copy per user, for
// COPY_DAYS days, and only while Settings ▸ Preferences ▸ Remember window
// layout is on.
//
// Only what is listed here is kept: which windows, where, their titles and
// plain settings. Never passwords or their references, files, uploaded data,
// graph contents, search words, filter values or formatting rules (they can
// hold names and account numbers). What is read back is cleaned the same way.

import { SOURCE_STATUSES, brokerUsesDefault } from '../../features/source/lib/sourceModel.js';
import { WORKSPACE_CONTEXT_TABS, WORKSPACE_ORIENTATIONS, WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

const KEY = 'linkx.workspace.last.v1';
export const REMEMBER_KEY = 'linkx_settings_remember_layout';
export const COPY_DAYS = 7;
const COPY_MAX_WINDOWS = 20;
const COPY_MAX_USERS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

const TYPES = new Set(Object.values(WORKSPACE_WINDOW_TYPES));
const { SOURCE, GRAPH, CHART, TABLE, REPORTS, LIBRARIES, CONFIGURATION, SETTINGS } = WORKSPACE_WINDOW_TYPES;

// What a Graph window held.
export const GRAPH_CONTENT = Object.freeze({ EVIDENCE: 'evidence', SESSION: 'session', DRAWN: 'drawn', EMPTY: 'empty', RUN: 'run' });

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
// eslint-disable-next-line no-control-regex
const text = (value, max = 200) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, max) : '');
const number = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : undefined);
const clean = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== ''));
// An address may carry a login ("bolt://user:pass@host"): then it is left out.
// Too long to keep whole: left out too (a cut address is a wrong one).
const address = (value) => (/@/.test(String(value ?? '')) || String(value ?? '').length > 300 ? '' : text(value, 300));

const SOURCE_TEXT = ['selectedConnectionType', 'sourceAddressType', 'topic', 'storagePort', 'storageDatabase', 'storagePath', 'elasticColumn', 'searchMode', 'dataframeAction', 'sourceColumn', 'targetColumn', 'relationship', 'rule', 'toolUsername', 'toolDatabase'];
const SOURCE_ADDRESS = ['brokerAddress', 'storageAddress', 'toolUrl'];
const SOURCE_SWITCH = ['brokerUseDefault', 'storageUseDefault'];
// defaults: the session configuration's (resolveSourceDefaults). A value that
// is the default is not kept: the window takes the default of the day. Kept,
// a default that changed meanwhile would look like the analyst's own value
// (and the broker, then "custom", would not connect by itself).
const withoutDefaults = (state, defaults) => {
  if (!defaults) return state;
  const own = { ...state };
  const drop = (key, ...values) => { if (values.includes(own[key])) delete own[key]; };
  drop('storagePath', defaults.storage.path);
  drop('storageDatabase', defaults.storage.database);
  drop('toolUrl', defaults.tool.url);
  drop('toolUsername', defaults.tool.username);
  drop('toolDatabase', defaults.tool.database);
  if (brokerUsesDefault(state, defaults)) {
    delete own.brokerAddress;
    delete own.topic;
  } else {
    own.brokerUseDefault = false;
    // It was connected: restoring connects it again, as a default is.
    own.reconnect = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  }
  return own;
};
const sourceMode = (input, defaults) => {
  if (!isObject(input)) return undefined;
  const state = withoutDefaults(input, defaults);
  const kept = {};
  SOURCE_TEXT.forEach((key) => { if (text(state[key])) kept[key] = text(state[key]); });
  SOURCE_ADDRESS.forEach((key) => { if (address(state[key])) kept[key] = address(state[key]); });
  SOURCE_SWITCH.forEach((key) => { if (typeof state[key] === 'boolean') kept[key] = state[key]; });
  if (state.reconnect === true && kept.brokerAddress) kept.reconnect = true;
  return kept;
};
const sourceState = (state, defaults) => {
  if (!isObject(state)) return undefined;
  const modes = ['choose', 'batch', 'realtime'];
  return clean({
    mode: modes.includes(state.mode) ? state.mode : 'choose',
    lastMode: modes.includes(state.lastMode) ? state.lastMode : '',
    batch: sourceMode(state.batch, defaults),
    realtime: sourceMode(state.realtime, defaults),
  });
};

// Plain view settings of a Graph, Table or Chart window, by name: how it is
// shown, never what it shows (no search, filter, formatting rule or picked
// item). The windows check them again as they read them.
const GRAPH_SETTINGS = ['limit', 'labels', 'edgeWeight', 'showTitles', 'showLabels', 'physics', 'layout', 'performance', 'alertRules', 'edgeBundling', 'edgeBundleMin', 'actorProfile', 'linkAggregation', 'useDomainRules'];
const TABLE_STATE = ['tab', 'scope', 'follow', 'columns', 'sort'];
const CHART_STATE = ['v', 'scope', 'cards', 'global', 'mode', 'seeded', 'follow', 'toneCount'];
const plain = (value, depth = 0) => {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string') return text(value, 120);
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) return value.slice(0, 400).map((item) => plain(item, depth + 1)).filter((item) => item !== undefined);
  if (!isObject(value)) return undefined;
  return Object.fromEntries(Object.entries(value).slice(0, 60).map(([key, item]) => [key, plain(item, depth + 1)]).filter(([, item]) => item !== undefined));
};
const only = (value, keys) => (isObject(value)
  ? Object.fromEntries(keys.filter((key) => key in value).map((key) => [key, plain(value[key])]).filter(([, item]) => item !== undefined))
  : undefined);

const idOf = (value) => (typeof value === 'number' ? value : text(value));
// The record an evidence graph is loaded from, and what its report's cover says.
const evidenceOf = (evidence) => (isObject(evidence) && text(evidence.traceId) ? clean({
  traceId: text(evidence.traceId),
  reportId: idOf(evidence.reportId),
  externalReferenceId: idOf(evidence.externalReferenceId),
  domain: text(evidence.domain, 60),
  domainDistribution: Array.isArray(evidence.domainDistribution) ? plain(evidence.domainDistribution) : undefined,
  score: isObject(evidence.score) ? plain(evidence.score) : undefined,
  systemRules: Array.isArray(evidence.systemRules) ? evidence.systemRules.slice(0, 20).map((rule) => text(rule, 120)).filter(Boolean) : undefined,
}) : undefined);

const tabOnly = (ui) => (isObject(ui) && text(ui.activeTab, 60) ? { activeTab: text(ui.activeTab, 60) } : undefined);

const metadataOf = (type, metadata) => {
  const point = isObject(metadata.windowPosition) ? metadata.windowPosition : null;
  const size = isObject(metadata.windowSize) ? metadata.windowSize : null;
  const kept = {
    windowPosition: point && number(point.x) !== undefined && number(point.y) !== undefined ? { x: number(point.x), y: number(point.y) } : undefined,
    windowSize: size && number(size.width) !== undefined && number(size.height) !== undefined ? { width: number(size.width), height: number(size.height) } : undefined,
  };
  if (type === GRAPH) {
    kept.evidence = evidenceOf(metadata.evidence);
    // A finished run's graph, kept by the Service (its id only).
    if (!kept.evidence) kept.graphTaskId = text(metadata.graphTaskId, 128) || undefined;
    kept.graphSettings = only(metadata.graphSettings, GRAPH_SETTINGS);
    kept.alert = kept.evidence && isObject(metadata.alert) ? clean({ id: idOf(metadata.alert.id), reference: text(metadata.alert.reference) }) : undefined;
  } else if (type === TABLE) {
    kept.tableGraph = text(metadata.tableGraph, 60);
    kept.tableState = only(metadata.tableState, TABLE_STATE);
  } else if (type === CHART) {
    kept.chartGraph = text(metadata.chartGraph, 60);
    kept.chartState = only(metadata.chartState, CHART_STATE);
  } else if (type === LIBRARIES) {
    kept.librariesUi = tabOnly(metadata.librariesUi);
  } else if (type === CONFIGURATION) {
    kept.configurationUi = tabOnly(metadata.configurationUi);
  } else if (type === SETTINGS) {
    // The tab only: the Users drafts are never kept.
    kept.settingsUi = tabOnly(metadata.settingsUi);
  } else if (type === REPORTS && isObject(metadata.reportsUi)) {
    const ui = metadata.reportsUi;
    const filters = isObject(ui.filters) ? ui.filters : {};
    // (openSeq and appliedSeq match, so the window starts from reportsUi.)
    kept.openSeq = 1;
    kept.reportsUi = {
      appliedSeq: 1,
      tabId: text(ui.tabId, 30),
      filters: clean(Object.fromEntries(['requester', 'status', 'band', 'from', 'to', 'sort'].map((key) => [key, text(filters[key], 40)]))),
      offset: Math.max(0, Math.floor(number(ui.offset) || 0)),
      selectedId: typeof ui.selectedId === 'number' ? ui.selectedId : text(ui.selectedId, 120) || null,
      highlightRunId: null,
    };
  }
  return clean(kept);
};

const graphContent = (windowItem, hasNodes) => {
  const metadata = windowItem.metadata || {};
  if (Object.values(GRAPH_CONTENT).includes(windowItem.graph)) {
    if (windowItem.graph === GRAPH_CONTENT.EVIDENCE && !evidenceOf(metadata.evidence)) return GRAPH_CONTENT.EMPTY;
    if (windowItem.graph === GRAPH_CONTENT.RUN && !text(metadata.graphTaskId)) return GRAPH_CONTENT.EMPTY;
    return windowItem.graph;
  }
  if (metadata.graphBlank || metadata.graphImported) return hasNodes(windowItem.id) ? GRAPH_CONTENT.DRAWN : GRAPH_CONTENT.EMPTY;
  if (evidenceOf(metadata.evidence)) return GRAPH_CONTENT.EVIDENCE;
  if (text(metadata.graphTaskId)) return GRAPH_CONTENT.RUN;
  if (metadata.graphLinkSource) return GRAPH_CONTENT.SESSION;
  return hasNodes(windowItem.id) ? GRAPH_CONTENT.DRAWN : GRAPH_CONTENT.EMPTY;
};

const windowOf = (windowItem, hasNodes, defaults) => {
  if (!isObject(windowItem) || !TYPES.has(windowItem.type) || !text(windowItem.id, 60)) return null;
  const custom = text(windowItem.customTitle, 120);
  return clean({
    id: text(windowItem.id, 60),
    type: windowItem.type,
    customTitle: custom.toLowerCase() === 'placeholder' ? '' : custom,
    metadata: metadataOf(windowItem.type, isObject(windowItem.metadata) ? windowItem.metadata : {}),
    sourceState: windowItem.type === SOURCE ? sourceState(windowItem.sourceState, defaults) : undefined,
    graph: windowItem.type === GRAPH ? graphContent(windowItem, hasNodes) : undefined,
  });
};

// The workspace, as kept. hasNodes(windowId): its Graph window draws
// something. sourceDefaults: the session configuration's (none when reading back).
export const buildWorkspaceCopy = (workspace, { hasNodes = () => false, sourceDefaults = null, now = Date.now() } = {}) => ({
  version: 1,
  savedAt: now,
  orientation: Object.values(WORKSPACE_ORIENTATIONS).includes(workspace?.orientation) ? workspace.orientation : WORKSPACE_ORIENTATIONS.FLOATING,
  contextTab: Object.values(WORKSPACE_CONTEXT_TABS).includes(workspace?.contextTab) ? workspace.contextTab : WORKSPACE_CONTEXT_TABS.OVERVIEW,
  activeWindowId: text(workspace?.activeWindowId, 60),
  windows: (Array.isArray(workspace?.windows) ? workspace.windows : []).slice(0, COPY_MAX_WINDOWS).map((item) => windowOf(item, hasNodes, sourceDefaults)).filter(Boolean),
});

// What will come back of a kept window: 'full' | 'partial' | 'lost', and why.
export const windowOutcome = (windowItem, copy) => {
  if (windowItem.type === SOURCE) return { state: 'partial', note: 'Its setup returns in a new session. Choose its files again, and type any password that was not saved. A running analysis does not come back.' };
  if (windowItem.type === GRAPH) {
    if (windowItem.graph === GRAPH_CONTENT.SESSION) return { state: 'lost', note: 'It showed a run whose session has ended.' };
    if (windowItem.graph === GRAPH_CONTENT.DRAWN) return { state: 'lost', note: 'Its graph was not saved or exported.' };
    if (windowItem.graph === GRAPH_CONTENT.RUN) return { state: 'full', note: 'Loaded again from the Service while it keeps it (24 hours), without changes made here.' };
    if (windowItem.graph === GRAPH_CONTENT.EVIDENCE) return { state: 'full', note: 'Loaded again from the saved evidence, without its search, filters or changes made here.' };
    return { state: 'full', note: 'Empty, as it was.' };
  }
  const linked = windowItem.metadata?.tableGraph || windowItem.metadata?.chartGraph;
  if (linked) {
    const graph = copy?.windows?.find((item) => item.id === linked);
    if (![GRAPH_CONTENT.EVIDENCE, GRAPH_CONTENT.RUN].includes(graph?.graph)) return { state: 'partial', note: 'The graph it was linked to does not come back.' };
  }
  if (windowItem.type === REPORTS || windowItem.type === TABLE) return { state: 'full', note: 'Where it was, without its search.' };
  return { state: 'full', note: 'Where it was, as it was.' };
};

/* ── Storage ─────────────────────────────────────────────────────────── */

export const isRememberingWorkspace = () => {
  try { return localStorage.getItem(REMEMBER_KEY) !== 'false'; } catch { return false; }
};

const readAll = () => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    return isObject(value) ? value : {};
  } catch {
    return {};
  }
};
const writeAll = (all) => {
  try {
    if (Object.keys(all).length) localStorage.setItem(KEY, JSON.stringify(all));
    else localStorage.removeItem(KEY);
  } catch { /* stores nothing */ }
};
const isFresh = (copy, now) => isObject(copy) && Number.isFinite(copy.savedAt) && copy.savedAt <= now + DAY_MS && now - copy.savedAt <= COPY_DAYS * DAY_MS;

// Who the copy belongs to: never shown to anyone else on this computer.
export const workspaceOwnerKey = (user) => {
  const id = text(user?.id ?? user?.user_id ?? user?.sub ?? '', 120);
  const name = text(user?.username ?? user?.client_id ?? '', 120);
  return id || name ? `${id}|${name}` : 'local';
};

// -> the copy, or null (none, too old, empty, or not being remembered).
export const readWorkspaceCopy = (owner, now = Date.now()) => {
  if (!isRememberingWorkspace()) return null;
  const stored = readAll()[owner];
  if (!isFresh(stored, now)) return null;
  const copy = { ...buildWorkspaceCopy(stored, { now }), savedAt: stored.savedAt };
  return copy.windows.length ? copy : null;
};

// Writes one user's copy (an empty workspace has none); old ones are dropped.
export const writeWorkspaceCopy = (owner, copy, now = Date.now()) => {
  const others = Object.entries(readAll())
    .filter(([key, value]) => key !== owner && isFresh(value, now))
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, COPY_MAX_USERS - 1);
  const keep = isRememberingWorkspace() && copy?.windows?.length;
  writeAll(Object.fromEntries(keep ? [...others, [owner, copy]] : others));
};

export const removeWorkspaceCopy = (owner) => writeWorkspaceCopy(owner, null);

// This tab's own copy (sessionStorage): a reload offers this tab's workspace,
// whatever other tabs hold. Gone when the tab is closed.
export const readTabCopy = (owner, now = Date.now()) => {
  if (!isRememberingWorkspace()) return null;
  try {
    const stored = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (!isObject(stored) || stored.owner !== owner || !isFresh(stored.copy, now)) return null;
    const copy = { ...buildWorkspaceCopy(stored.copy, { now }), savedAt: stored.copy.savedAt };
    return copy.windows.length ? copy : null;
  } catch {
    return null;
  }
};
export const writeTabCopy = (owner, copy) => {
  try {
    if (isRememberingWorkspace() && copy?.windows?.length) sessionStorage.setItem(KEY, JSON.stringify({ owner, copy }));
    else sessionStorage.removeItem(KEY);
  } catch { /* stores nothing */ }
};

// Settings ▸ Preferences: off forgets every copy in this browser.
export const setRememberingWorkspace = (on) => {
  try { localStorage.setItem(REMEMBER_KEY, String(Boolean(on))); } catch { /* stores nothing */ }
  if (on) return;
  writeAll({});
  writeTabCopy('', null);
};
