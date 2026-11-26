// What the Domains page knows of a domain's fields: the thresholds' form (from
// the Service's own list, B-44; else this app's copy of production's), and the
// checks on column names and mapping rows.

import {
  BANK_THRESHOLD_GROUPS,
  CDR_THRESHOLD_GROUPS,
  DEFAULT_BANK_THRESHOLDS,
  DEFAULT_CDR_THRESHOLDS,
} from './configModel.js';

/* ── Wording ────────────────────────────────────────────────────────── */

export const numberText = (value) => (typeof value === 'number' ? value.toLocaleString() : String(value));
export const valueText = (value) => {
  if (value === null || value === undefined || value === '') return 'not set';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return Array.isArray(value) ? value.join(', ') || 'none' : numberText(value);
};

const MAX_LISTED = 12;
// "a: 1 → 2; b: off → on; and 3 more", for a confirmation.
export const listChanges = (changes) => {
  const shown = changes.slice(0, MAX_LISTED).map(({ label, from, to }) => `${label}: ${from} → ${to}`);
  return [...shown, ...(changes.length > MAX_LISTED ? [`and ${changes.length - MAX_LISTED} more`] : [])].join('; ');
};

/* ── Thresholds ─────────────────────────────────────────────────────── */

const LABELS = Object.fromEntries([...BANK_THRESHOLD_GROUPS, ...CDR_THRESHOLD_GROUPS].flatMap(([, fields]) => fields.map(([key, label, opts]) => [key, { label, opts: opts || {} }])));
export const wordKey = (key) => {
  const text = String(key).replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : String(key);
};

const optsOf = (key, meta) => {
  const known = LABELS[key]?.opts || {};
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  if (meta.type === 'boolean') return { type: 'checkbox', hint: known.hint };
  return { hint: known.hint, integer: meta.type === 'integer', min: number(meta.min), max: number(meta.max), step: known.step ?? (meta.type === 'integer' ? 1 : 'any') };
};

// answer: { config, keys, closed } of the Service.
// -> { groups: [[legend, [[key, label, opts]]]], defaults: { key: value }, open, fromService }
//    open: the domain accepts any numeric key.
export const thresholdForm = ({ config = {}, keys = null, closed = null } = {}, isCdr = false) => {
  if (!keys) return { groups: isCdr ? CDR_THRESHOLD_GROUPS : BANK_THRESHOLD_GROUPS, defaults: isCdr ? DEFAULT_CDR_THRESHOLDS : DEFAULT_BANK_THRESHOLDS, open: false, fromService: false };
  const open = closed === false;
  const listed = { ...keys };
  // An open domain: its saved numbers are fields too, whatever their name.
  if (open) Object.entries(config).forEach(([key, value]) => { if (!(key in listed) && typeof value === 'number') listed[key] = { type: 'number' }; });
  const editable = Object.entries(listed).filter(([, meta]) => ['integer', 'number', 'boolean'].includes(meta.type));
  const left = new Map(editable);
  const groups = [...BANK_THRESHOLD_GROUPS, ...CDR_THRESHOLD_GROUPS].flatMap(([legend, fields]) => {
    const here = fields.filter(([key]) => left.has(key)).map(([key, label]) => [key, label, optsOf(key, left.get(key))]);
    here.forEach(([key]) => left.delete(key));
    return here.length ? [[legend, here]] : [];
  });
  if (left.size) groups.push([groups.length ? 'Other thresholds' : 'Thresholds', [...left].map(([key, meta]) => [key, wordKey(key), optsOf(key, meta)])]);
  const defaults = Object.fromEntries(editable.flatMap(([key, meta]) => (['number', 'boolean'].includes(typeof meta.default) ? [[key, meta.default]] : [])));
  return { groups, defaults, open, fromService: true };
};

// A key typed for an open domain ('' when it can be added).
export const thresholdKeyProblem = (key, taken = []) => {
  if (!/^[a-z][a-z0-9_]{0,79}$/.test(key)) return 'Use small letters, digits and underscores, starting with a letter.';
  return taken.includes(key) ? 'It is there already.' : '';
};

/* ── Column names ───────────────────────────────────────────────────── */

export const MAX_COLUMNS = 200;
const COLUMN_NAME = /^[A-Za-z0-9_.-]{1,128}$/;
// One bad name makes the Service ignore the whole list (C7, 4).
export const badColumnNames = (names) => names.filter((name) => !COLUMN_NAME.test(name));
export const readColumnText = (text) => {
  const seen = new Set();
  return String(text || '').split(/[,\n]/).map((item) => item.trim()).filter((item) => {
    const key = item.toUpperCase();
    if (!item || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
export const columnListProblem = (names) => {
  const bad = badColumnNames(names);
  if (bad.length) return `Not accepted: ${bad.slice(0, 3).map((name) => `“${name.slice(0, 40)}”`).join(', ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''}. Use letters, digits, _ . and - only.`;
  return names.length > MAX_COLUMNS ? `At most ${MAX_COLUMNS} columns (${names.length} now).` : '';
};
export const sameColumns = (left = [], right = []) => left.length === right.length && left.every((name, index) => name === right[index]);

/* ── Mapping rows ───────────────────────────────────────────────────── */

export const INHERIT = '__inherit__';

// The rows as they would be after the edits ({ SOURCE: target | null | INHERIT }).
export const mappingAfter = ({ mapping = {}, profile = {} }, edits = {}) => {
  const next = { ...mapping };
  Object.entries(edits).forEach(([source, target]) => {
    const value = target === INHERIT ? profile[source] : target;
    if (value) next[source] = value;
    else delete next[source];
  });
  return next;
};

// Required groups (alternatives) that no row feeds.
export const unmappedGroups = (requiredFields = [], mapping = {}) => {
  const targets = new Set(Object.values(mapping).map((target) => String(target).toUpperCase()));
  return requiredFields.filter((group) => !group.some((field) => targets.has(field.toUpperCase())));
};

export const mappingSourceProblem = (source, taken = []) => {
  if (!COLUMN_NAME.test(source)) return 'Use letters, digits, _ . and - only (at most 128).';
  // Case is kept as written and ignored when matching (C7, 3).
  return taken.some((name) => name.toUpperCase() === source.toUpperCase()) ? 'This column is in the list already.' : '';
};
