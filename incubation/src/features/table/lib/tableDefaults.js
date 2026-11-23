import { BUILTIN_TABLE_START, LINK_BUILT_INS, NODE_BUILT_INS, TABLE_SCOPES, TABLE_TABS } from './tableRows.js';

// How a Table window starts (Libraries ▸ Table defaults; analyst request
// 2026-11-23): the tab it opens on, its scope, whether it follows the
// graph's selection, which built-in columns it shows and how its rows are
// sorted, and how Print table starts. Kept in this browser (localStorage).
// A Table window reads them until it has a state of its own (its first
// change); from then on it keeps what it has.
//
// Only the built-in columns can be chosen here: the property columns come
// from each graph's data, and are shown or hidden in the window.

export const TABLE_DEFAULTS_KEY = 'linkx.table.defaults.v1';
export const TABLE_PRINT_ROWS = Object.freeze(['shown', 'all', 'selected']);
export const TABLE_PRINT_PAGES = Object.freeze(['auto', 'portrait', 'landscape']);
const BUILT_INS = { nodes: NODE_BUILT_INS, links: LINK_BUILT_INS };

export const BUILTIN_TABLE_DEFAULTS = Object.freeze({
  ...BUILTIN_TABLE_START,
  print: Object.freeze({ rows: 'shown', page: 'auto' }),
});

// Cleaned on read: known values only; a tab never hides all of its
// built-in columns; a sort only by a built-in column.
export const normalizeTableDefaults = (input) => {
  const source = input && typeof input === 'object' ? input : {};
  const hiddenOf = (tab) => {
    const keys = BUILT_INS[tab].map((column) => column.key);
    const hidden = keys.filter((key) => Array.isArray(source.hidden?.[tab]) && source.hidden[tab].includes(key));
    return hidden.length >= keys.length ? hidden.slice(1) : hidden;
  };
  const sortOf = (tab) => {
    const value = source.sort?.[tab];
    return value && BUILT_INS[tab].some((column) => column.key === value.key) ? { key: value.key, dir: value.dir === 'desc' ? 'desc' : 'asc' } : null;
  };
  return {
    tab: TABLE_TABS.includes(source.tab) ? source.tab : BUILTIN_TABLE_DEFAULTS.tab,
    scope: TABLE_SCOPES.some((entry) => entry.id === source.scope) ? source.scope : BUILTIN_TABLE_DEFAULTS.scope,
    follow: source.follow === undefined ? BUILTIN_TABLE_DEFAULTS.follow : source.follow !== false,
    hidden: { nodes: hiddenOf('nodes'), links: hiddenOf('links') },
    sort: { nodes: sortOf('nodes'), links: sortOf('links') },
    print: {
      rows: TABLE_PRINT_ROWS.includes(source.print?.rows) ? source.print.rows : BUILTIN_TABLE_DEFAULTS.print.rows,
      page: TABLE_PRINT_PAGES.includes(source.print?.page) ? source.print.page : BUILTIN_TABLE_DEFAULTS.print.page,
    },
  };
};

const signature = (defaults) => JSON.stringify(defaults);
const BUILTIN_SIGNATURE = signature(normalizeTableDefaults(null));
export const isBuiltinTableDefaults = (defaults) => signature(defaults) === BUILTIN_SIGNATURE;

const read = () => {
  try {
    const raw = localStorage.getItem(TABLE_DEFAULTS_KEY);
    return normalizeTableDefaults(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeTableDefaults(null);
  }
};

// One snapshot object until something changes (useSyncExternalStore).
let snapshot = null;
const listeners = new Set();
const publish = (next) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};

export const getTableDefaults = () => {
  if (!snapshot) snapshot = read();
  return snapshot;
};

// patch: top-level keys; `hidden`, `sort` and `print` are merged into what
// is there.
export const setTableDefaults = (patch = {}) => {
  const current = getTableDefaults();
  const next = normalizeTableDefaults({
    ...current,
    ...patch,
    hidden: { ...current.hidden, ...(patch.hidden || {}) },
    sort: { ...current.sort, ...(patch.sort || {}) },
    print: { ...current.print, ...(patch.print || {}) },
  });
  if (signature(next) === signature(current)) return;
  try {
    localStorage.setItem(TABLE_DEFAULTS_KEY, JSON.stringify(next));
  } catch { /* storage full or blocked: kept for this visit only */ }
  publish(next);
};

export const resetTableDefaults = () => {
  try {
    localStorage.removeItem(TABLE_DEFAULTS_KEY);
  } catch { /* nothing to remove */ }
  publish(normalizeTableDefaults(null));
};

export const subscribeTableDefaults = (listener) => {
  listeners.add(listener);
  // Another tab changed them.
  const onStorage = (event) => {
    if (event.key === TABLE_DEFAULTS_KEY) publish(read());
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

// For tests: forget what was read.
export const forgetTableDefaults = () => { snapshot = null; };
