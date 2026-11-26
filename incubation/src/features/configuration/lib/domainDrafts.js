// Unsaved edits of the Domains page, per window, domain and part, and what the
// page was left on. Kept outside React like configDraft.js: another domain, tab
// or a docked window must not drop them. Memory only; cleared on sign-out.

const drafts = new Map(); // "window|domain|part" -> draft
const views = new Map(); // window -> { domain, part }
const keyOf = (windowId, domain, part) => `${windowId || ''}|${domain}|${part}`;

export const getDomainDraft = (windowId, domain, part) => drafts.get(keyOf(windowId, domain, part)) || null;
export const keepDomainDraft = (windowId, domain, part, draft) => {
  if (draft) drafts.set(keyOf(windowId, domain, part), draft);
  else drafts.delete(keyOf(windowId, domain, part));
};
export const hasDomainDraft = (windowId, domain) => [...drafts.keys()].some((key) => key.startsWith(`${windowId || ''}|${domain}|`));

export const getDomainsView = (windowId) => views.get(String(windowId || '')) || {};
export const keepDomainsView = (windowId, patch) => views.set(String(windowId || ''), { ...getDomainsView(windowId), ...patch });

export const clearDomainDrafts = () => {
  drafts.clear();
  views.clear();
};

/* ── Thresholds ─────────────────────────────────────────────────────── */

// The Service's values of the keys this page knows, as numbers and booleans.
// A key it did not send, or that cannot be read, is left out: never assumed.
// fields: { key: any value of its kind }, such as the defaults.
export const readThresholds = (config, fields) => Object.fromEntries(Object.keys(fields).flatMap((key) => {
  const value = config?.[key];
  if (typeof fields[key] === 'boolean') {
    if (value === true || value === 'true') return [[key, true]];
    return value === false || value === 'false' ? [[key, false]] : [];
  }
  const number = value === null || value === undefined || value === '' || typeof value === 'boolean' ? NaN : Number(value);
  return Number.isFinite(number) ? [[key, number]] : [];
}));

// What the Service sent that this page has no field for (lists too): shown,
// not editable.
const META_KEYS = /^(id|version|version_id|domain|domain_id|updated_by|updated_at|created_at|created_by)$/;
const isPlainList = (value) => Array.isArray(value) && value.every((item) => ['string', 'number'].includes(typeof item));
export const otherThresholds = (config, fields) => Object.entries(config && typeof config === 'object' && !Array.isArray(config) ? config : {})
  .filter(([key, value]) => !(key in fields) && !META_KEYS.test(key) && (typeof value === 'number' || typeof value === 'boolean' || isPlainList(value)))
  .slice(0, 100);

// Why a typed value cannot be saved ('' when it can).
export const thresholdProblem = (value, opts = {}) => {
  if (typeof value === 'boolean') return '';
  if (value === '' || value === null || !Number.isFinite(Number(value))) return 'Enter a number.';
  if (opts.integer && !Number.isInteger(Number(value))) return 'Enter a whole number.';
  if (opts.min != null && value < opts.min) return `At least ${opts.min.toLocaleString('en-GB')}.`;
  if (opts.max != null && value > opts.max) return `At most ${opts.max.toLocaleString('en-GB')}.`;
  return '';
};
