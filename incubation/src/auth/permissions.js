// Single permission catalog for the UI (editors, counters, "select all").
// The Service's own list (GET /auth/admin/permissions, users:manage;
// frontend alignment 2026-11-20 §4e) replaces it once loaded: see
// loadPermissionCatalog / usePermissionCatalog below.
import { useSyncExternalStore } from 'react';

export const PERMISSION_GROUPS = Object.freeze([
  { label: 'Session', items: ['session:create', 'session:read'] },
  { label: 'Configuration', items: ['config:read', 'config:write'] },
  { label: 'Source', items: ['source:create', 'source:connect', 'source:disconnect'] },
  { label: 'Graph', items: ['graph:create', 'graph:read', 'graph:link'] },
  { label: 'Batch', items: ['batch:upload', 'batch:query'] },
  { label: 'Analysis', items: ['analysis:run'] },
  { label: 'Reports', items: ['reports:read', 'evidence:create'] },
  { label: 'Alerts', items: ['alerts:read_all', 'alerts:feedback', 'alerts:ingest'] },
  { label: 'Tasks', items: ['tasks:read_all'] },
  { label: 'Admin', items: ['users:manage'] },
  { label: 'Auth', items: ['auth:verify'] },
]);

export const ALL_PERMISSIONS = Object.freeze(PERMISSION_GROUPS.flatMap((group) => group.items));

// Compact grouping used by the Users browser's privilege matrix.
export const USER_PERMISSION_DISPLAY_GROUPS = Object.freeze([
  { label: 'Session', items: ['session:create', 'session:read'] },
  { label: 'Configuration', items: ['config:read', 'config:write'] },
  { label: 'Source', items: ['source:create', 'source:connect', 'source:disconnect'] },
  { label: 'Data & Analysis', items: ['batch:upload', 'batch:query', 'analysis:run'] },
  { label: 'Graph', items: ['graph:create', 'graph:read', 'graph:link'] },
  { label: 'Reports & alerts', items: ['reports:read', 'evidence:create', 'alerts:read_all', 'alerts:feedback', 'alerts:ingest'] },
  { label: 'Tasks', items: ['tasks:read_all'] },
  { label: 'Users', items: ['users:manage', 'auth:verify'] },
]);

// Production's PERMISSIONS map (src/App.jsx) for window and launcher actions.
export const SOURCE_PERMISSIONS = Object.freeze({
  SOURCE_CREATE: 'source:create',
  SOURCE_CONNECT: 'source:connect',
  SOURCE_DISCONNECT: 'source:disconnect',
  BATCH_UPLOAD: 'batch:upload',
  BATCH_QUERY: 'batch:query',
  ANALYSIS_RUN: 'analysis:run',
  GRAPH_CREATE: 'graph:create',
  GRAPH_LINK: 'graph:link',
  CONFIG_READ: 'config:read',
});

/* ── The Service's permission list (§4e) ─────────────────────────────── */
// { groups, all, displayGroups, descriptions }: the known groups with only
// the keys the Service has, plus "Other" for keys this UI does not group
// (custom permissions; a null description shows the key).
const PERMISSION_KEY = /^[a-z][a-z0-9_]*(?::[a-z][a-z0-9_]*)+$/;
const buildCatalog = (keys = null, descriptions = {}) => {
  const known = new Set(ALL_PERMISSIONS);
  const has = (item) => !keys || keys.has(item);
  const filterGroups = (groups) => groups.map((group) => ({ ...group, items: group.items.filter(has) })).filter((group) => group.items.length);
  const other = keys ? [...keys].filter((key) => !known.has(key)).sort() : [];
  const groups = [...filterGroups(PERMISSION_GROUPS), ...(other.length ? [{ label: 'Other', items: other }] : [])];
  return {
    groups,
    displayGroups: [...filterGroups(USER_PERMISSION_DISPLAY_GROUPS), ...(other.length ? [{ label: 'Other', items: other }] : [])],
    all: groups.flatMap((group) => group.items),
    descriptions,
  };
};
let catalog = buildCatalog();
const catalogListeners = new Set();
let catalogLoading = null;

export const getPermissionCatalog = () => catalog;
const subscribeCatalog = (listener) => {
  catalogListeners.add(listener);
  return () => catalogListeners.delete(listener);
};
export const usePermissionCatalog = () => useSyncExternalStore(subscribeCatalog, getPermissionCatalog);

// Loads the Service's list once per sign-in (needs users:manage). A failure
// keeps the built-in list.
export const loadPermissionCatalog = (apiFetch) => {
  if (!apiFetch || catalogLoading) return catalogLoading;
  catalogLoading = Promise.resolve(apiFetch('/auth/admin/permissions', { suppressForbiddenHandler: true }))
    .then((data) => {
      const rows = Array.isArray(data?.results) ? data.results : [];
      const keys = new Set(rows.map((row) => String(row?.key || '')).filter((key) => PERMISSION_KEY.test(key)));
      if (!keys.size) return;
      const descriptions = Object.fromEntries(rows.filter((row) => keys.has(String(row?.key))).map((row) => [String(row.key), row.description ? String(row.description).slice(0, 200) : '']));
      catalog = buildCatalog(keys, descriptions);
      catalogListeners.forEach((listener) => listener());
    })
    .catch(() => { catalogLoading = null; });
  return catalogLoading;
};

// Signed out: back to the built-in list.
export const resetPermissionCatalog = () => {
  catalog = buildCatalog();
  catalogLoading = null;
  catalogListeners.forEach((listener) => listener());
};
