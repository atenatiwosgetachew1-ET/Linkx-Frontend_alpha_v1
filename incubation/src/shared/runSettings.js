// What a run was made with (`settings_used`, B-42), as the Service recorded it
// when the run was queued, and the remark everything made from it carries: on
// screen, in evidence, reports, snaps, prints, PDFs, CSV, copied elements and
// graph files (docs/phase6-plan.md). Nothing here is worked out from today's
// configuration. Read tolerantly and bounded: it also comes out of files.
//
// A graph holds entries [{ id, settings }], one per run its data came from;
// settings null = not recorded. No entries: not made from a run at all.

import { formatDomainPillarLabel } from '../features/configuration/lib/configModel.js';

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const word = (value, max = 128) => (typeof value === 'string' || typeof value === 'number' ? String(value).replace(/\s+/g, ' ').trim().slice(0, max) : '');
const words = (value, max = 200) => (Array.isArray(value) ? value.map((item) => word(item)).filter(Boolean).slice(0, max) : []);

const COLUMN_LISTS = ['fetch_columns', 'search_columns_strict', 'search_columns_fuzzy'];
const LIST_NAMES = { fetch_columns: 'fetch columns', search_columns_strict: 'strict search columns', search_columns_fuzzy: 'fuzzy search columns' };
const VERSIONS = ['thresholds', 'preset', 'mapping', 'columns', 'profile']; // profile: round 4

// -> { domain, versions, overridden, columns: { list: { added, removed } },
//      mapping: { source: target }, by, missingFields: [..] | null } | null
export const readSettingsUsed = (value) => {
  if (!isObject(value)) return null;
  const overrides = isObject(value.overrides) ? value.overrides : {};
  const columns = Object.fromEntries(COLUMN_LISTS.flatMap((key) => {
    const change = isObject(overrides.columns) ? overrides.columns[key] : null;
    if (!change) return [];
    return [[key, { added: words(change.added), removed: words(change.removed) }]];
  }));
  const mapping = Object.fromEntries(Object.entries(isObject(overrides.dataframe_mapping) ? overrides.dataframe_mapping : {})
    .map(([source, target]) => [word(source), word(target)]).filter(([source, target]) => source && target).slice(0, 50));
  return {
    domain: word(value.domain, 40),
    versions: isObject(value.versions) ? Object.fromEntries(VERSIONS.filter((key) => key in value.versions).map((key) => [key, value.versions[key] == null ? null : word(value.versions[key], 40)])) : {},
    // Said, or seen: an override is never taken for none.
    overridden: value.overridden === true || Object.keys(columns).length > 0 || Object.keys(mapping).length > 0,
    columns,
    mapping,
    by: word(value.overridden_by, 120),
    missingFields: Array.isArray(value.missing_fields) ? words(value.missing_fields, 100) : null,
  };
};

// Back in the Service's shape, for a graph file or the clipboard.
const toRaw = (settings) => settings && {
  domain: settings.domain,
  versions: settings.versions,
  overridden: settings.overridden,
  overrides: { ...(Object.keys(settings.columns).length ? { columns: settings.columns } : {}), ...(Object.keys(settings.mapping).length ? { dataframe_mapping: settings.mapping } : {}) },
  ...(settings.by ? { overridden_by: settings.by } : {}),
  missing_fields: settings.missingFields,
};
export const MAX_RUN_ENTRIES = 50;
export const UNKNOWN_RUN = Object.freeze([Object.freeze({ id: '', settings: null })]);
export const exportRunSettings = (entries) => (entries || []).map(({ id, settings }) => ({ id, settings_used: toRaw(settings) }));
// A file's or the clipboard's; missing altogether: unknown, never "none".
export const importRunSettings = (value) => {
  if (!Array.isArray(value)) return [...UNKNOWN_RUN];
  return mergeRunSettings([], value.filter(isObject).map((item) => ({ id: word(item.id, 80), settings: readSettingsUsed(item.settings_used) })));
};
export const mergeRunSettings = (left = [], right = []) => {
  const seen = new Set();
  const all = [...left, ...right].filter((entry) => {
    const key = JSON.stringify(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Never silently fewer: what does not fit is said to be unknown.
  return all.length > MAX_RUN_ENTRIES ? [...all.slice(0, MAX_RUN_ENTRIES - 1), { id: 'more', settings: null }] : all;
};

/* ── The remark ─────────────────────────────────────────────────────── */

const few = (names, max) => `${names.slice(0, max).join(', ')}${names.length > max ? ` and ${names.length - max} more` : ''}`;
const columnText = (key, { added, removed }, max) => `own ${LIST_NAMES[key]}${added.length || removed.length ? ` (${[added.length ? `added ${few(added, max)}` : '', removed.length ? `removed ${few(removed, max)}` : ''].filter(Boolean).join('; ')})` : ''}`;
const overrideText = (settings, max) => {
  const pairs = Object.entries(settings.mapping).map(([source, target]) => `${source} → ${target}`);
  const parts = [
    pairs.length ? `own column mapping (${few(pairs, max)})` : '',
    ...Object.entries(settings.columns).map(([key, change]) => columnText(key, change, max)),
  ].filter(Boolean);
  return `${parts.length ? parts.join(', ') : 'settings of one’s own'}${settings.by ? `, by ${settings.by}` : ''}`;
};
const domainText = (settings) => (settings.domain ? formatDomainPillarLabel(settings.domain) : '');

// What kind of override, for a small mark.
export const overrideLabel = (list) => {
  const mapping = list.some((settings) => Object.keys(settings.mapping).length);
  const columns = list.some((settings) => Object.keys(settings.columns).length);
  if (mapping && columns) return 'Own columns and column mapping';
  if (mapping) return 'Own column mapping';
  return columns ? 'Own columns' : 'Own settings';
};

// entries -> null (not made from a run) |
//   { kind: 'overridden' | 'unknown' | 'domain', marked, label, short, text }
// label: a mark's words; short: one line of a page's frame; text: in full.
export const runRemark = (entries) => {
  if (!entries?.length) return null;
  const overridden = entries.filter(({ settings }) => settings?.overridden).map(({ settings }) => settings);
  const unknown = entries.some(({ settings }) => !settings);
  const domains = [...new Set(entries.map(({ settings }) => settings && domainText(settings)).filter(Boolean))];
  if (overridden.length) {
    const label = overrideLabel(overridden);
    const unique = (max) => [...new Set(overridden.map((settings) => overrideText(settings, max)))];
    const rest = [entries.length > overridden.length ? (unknown ? 'other data in it: settings not recorded' : 'other data in it: the domain’s settings') : ''].filter(Boolean);
    return {
      kind: 'overridden',
      marked: true,
      label,
      short: `Run settings: ${[...unique(2), ...rest].join(' | ')}`,
      text: `Run settings: ${[...unique(50), ...rest].join('; ')}.${domains.length ? ` Domain: ${domains.join(', ')}.` : ''}`,
    };
  }
  if (unknown) return { kind: 'unknown', marked: true, label: 'Settings not recorded', short: 'Run settings: not recorded', text: 'Run settings: not recorded, so it is not known whether own columns or an own column mapping were used.' };
  return { kind: 'domain', marked: false, label: 'Domain settings', short: `Run settings: the domain’s${domains.length ? ` (${domains.join(', ')})` : ''}`, text: `Run settings: the domain’s${domains.length ? ` (${domains.join(', ')})` : ''}.` };
};
export const settingsRemark = (settings) => runRemark([{ id: '', settings: settings || null }]);

// A cell of the "Run settings" column of a CSV or a copied table.
export const runSettingsCell = (remark) => (remark ? remark.short.replace(/^Run settings: /, '') : '');
