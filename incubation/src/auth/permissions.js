// Single permission catalog for the UI (editors, counters, "select all").
// Keep in sync with the backend's permission list.

export const PERMISSION_GROUPS = Object.freeze([
  { label: 'Session', items: ['session:create', 'session:read'] },
  { label: 'Configuration', items: ['config:read', 'config:write'] },
  { label: 'Source', items: ['source:create', 'source:connect', 'source:disconnect'] },
  { label: 'Graph', items: ['graph:create', 'graph:read', 'graph:link'] },
  { label: 'Batch', items: ['batch:upload', 'batch:query'] },
  { label: 'Analysis', items: ['analysis:run'] },
  { label: 'Reports', items: ['reports:read'] },
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
  { label: 'Reports', items: ['reports:read'] },
  { label: 'Users', items: ['users:manage', 'auth:verify'] },
]);
