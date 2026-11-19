// Conditional formatting (G3.5 i2 benchmark #4; after IBM i2 Analyst's
// Notebook, not in production; analyst decision 2026-11-16): saved rules
// "when a node / link matches these conditions, draw it like this",
// re-applied whenever the view changes. View only: the data never changes;
// turning a rule off brings the plain look straight back.
//
// Rules are kept per graph window (setting `formatting`, saved with views)
// and per domain (Configuration ▸ Rules ▸ Formatting rules, saved with the
// configuration as `formatting_rules`; backend request B-24): a graph's own
// rules come first, then the domain's, unless the graph turns those off
// (setting `useDomainRules`).
// They are an ordered list: when two rules set the same style, the higher
// one wins; different styles from several rules combine. Manual edits
// (Customize) win over rules, per style; highlights (alerts, pinned, paths)
// are drawn over them.
import { createDomainStore } from './domainStore.js';
import { getNodeValue } from './graphModel.js';
import { parseTimelineDate } from './graphTimeline.js';

export const FORMAT_TARGETS = Object.freeze(['node', 'edge']);

// Operators by the kind of value they compare.
export const OPERATORS = Object.freeze([
  { value: 'eq', label: 'equals', kind: 'text' },
  { value: 'neq', label: 'does not equal', kind: 'text' },
  { value: 'contains', label: 'contains', kind: 'text' },
  { value: 'starts', label: 'starts with', kind: 'text' },
  { value: 'in', label: 'is one of', kind: 'list' },
  { value: 'gt', label: '>', kind: 'number' },
  { value: 'gte', label: '≥', kind: 'number' },
  { value: 'lt', label: '<', kind: 'number' },
  { value: 'lte', label: '≤', kind: 'number' },
  { value: 'between', label: 'between', kind: 'range' },
  { value: 'before', label: 'before (date)', kind: 'date' },
  { value: 'after', label: 'after (date)', kind: 'date' },
  { value: 'dateBetween', label: 'between (dates)', kind: 'dateRange' },
  { value: 'exists', label: 'has a value', kind: 'none' },
  { value: 'empty', label: 'is empty', kind: 'none' },
]);
const OPERATOR_KINDS = Object.fromEntries(OPERATORS.map((entry) => [entry.value, entry.kind]));

// Facts that are not properties (picked like one, prefixed with "@").
export const BUILT_IN_KEYS = Object.freeze({
  node: [
    { key: '@type', label: 'Node type' },
    { key: '@degree', label: 'Links (degree)' },
    { key: '@alerted', label: 'Is alerted (yes / no)' },
    { key: '@pinned', label: 'Is pinned (yes / no)' },
  ],
  edge: [
    { key: '@alerted', label: 'Is alerted (yes / no)' },
    { key: '@pinned', label: 'Is pinned (yes / no)' },
  ],
});

// Styles each target can set (all optional).
export const NODE_STYLE_KEYS = Object.freeze(['fill', 'border', 'size', 'shape', 'icon', 'labelColor', 'hide']);
export const EDGE_STYLE_KEYS = Object.freeze(['color', 'width', 'lineStyle', 'hide']);

const text = (value, maxLength = 200) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : (value == null ? '' : String(value).slice(0, maxLength)));
const hex = (value) => (/^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '');

const numberOf = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value == null) return null;
  const textValue = String(value).trim();
  if (!textValue) return null;
  const parsed = Number(textValue.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
// Dates: as the timeline reads them, numbers as epoch (s or ms) too.
const dateOf = (value) => parseTimelineDate(value, { numeric: true });

let ruleSeq = 0;
export const newRuleId = () => {
  ruleSeq += 1;
  return `rule_${Date.now().toString(36)}_${ruleSeq}`;
};

const normalizeCondition = (input = {}) => ({
  key: text(input.key, 120),
  op: OPERATOR_KINDS[input.op] ? input.op : 'eq',
  value: text(input.value),
  value2: text(input.value2),
});

const normalizeStyle = (target, input = {}) => {
  const style = {};
  if (target === 'node') {
    if (hex(input.fill)) style.fill = hex(input.fill);
    if (hex(input.border)) style.border = hex(input.border);
    if (hex(input.labelColor)) style.labelColor = hex(input.labelColor);
    const size = Number(input.size);
    if (Number.isFinite(size) && size > 0) style.size = Math.max(5, Math.min(60, Math.round(size)));
    if (['dot', 'box', 'diamond'].includes(input.shape)) style.shape = input.shape;
    if (text(input.icon, 2_000_000)) style.icon = text(input.icon, 2_000_000);
  } else {
    if (hex(input.color)) style.color = hex(input.color);
    const width = Number(input.width);
    if (Number.isFinite(width) && width > 0) style.width = Math.max(0.5, Math.min(12, width));
    if (['solid', 'dashed', 'dotted', 'dashdot'].includes(input.lineStyle)) style.lineStyle = input.lineStyle;
  }
  if (input.hide === true) style.hide = true;
  return style;
};

export const normalizeRule = (input = {}) => {
  const target = input.target === 'edge' ? 'edge' : 'node';
  return {
    id: text(input.id, 80) || newRuleId(),
    name: text(input.name, 80),
    on: input.on !== false,
    target,
    match: input.match === 'any' ? 'any' : 'all',
    conditions: (Array.isArray(input.conditions) ? input.conditions : []).slice(0, 12).map(normalizeCondition),
    style: normalizeStyle(target, input.style),
  };
};

export const DEFAULT_FORMATTING = Object.freeze({ rules: Object.freeze([]) });
export const normalizeFormatting = (input = {}) => ({
  rules: (Array.isArray(input?.rules) ? input.rules : []).slice(0, 50).map(normalizeRule),
});

/* ── Evaluating ─────────────────────────────────────────────────────── */

// The value a condition reads. ctx: { degree(id), alerted(kind, id),
// pinned(kind, id), typeOf(node) }.
const valueFor = (target, id, item, key, ctx) => {
  if (key === '@type') return ctx.typeOf?.(item) ?? '';
  if (key === '@degree') return ctx.degree?.(id) ?? 0;
  if (key === '@alerted') return ctx.alerted?.(target, id) ? 'yes' : 'no';
  if (key === '@pinned') return ctx.pinned?.(target, id) ? 'yes' : 'no';
  return target === 'node' ? getNodeValue(item, key) : item?.[key];
};

const isEmpty = (value) => value == null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && !value.length);
const asText = (value) => (value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).toLowerCase();

export const testCondition = (condition, value) => {
  const { op } = condition;
  if (op === 'exists') return !isEmpty(value);
  if (op === 'empty') return isEmpty(value);
  if (isEmpty(value)) return false;
  const want = String(condition.value ?? '').trim().toLowerCase();
  switch (OPERATOR_KINDS[op]) {
    case 'text': {
      // Numbers compare as numbers ("2,500" equals 2500).
      const a = numberOf(value);
      const b = numberOf(condition.value);
      const same = a !== null && b !== null ? a === b : asText(value) === want;
      if (op === 'eq') return same;
      if (op === 'neq') return !same;
      if (op === 'contains') return asText(value).includes(want);
      return asText(value).startsWith(want);
    }
    case 'list':
      return want.split(',').map((entry) => entry.trim()).filter(Boolean).some((entry) => {
        const a = numberOf(value);
        const b = numberOf(entry);
        return a !== null && b !== null ? a === b : asText(value) === entry;
      });
    case 'number':
    case 'range': {
      const a = numberOf(value);
      const b = numberOf(condition.value);
      if (a === null || b === null) return false;
      if (op === 'gt') return a > b;
      if (op === 'gte') return a >= b;
      if (op === 'lt') return a < b;
      if (op === 'lte') return a <= b;
      const c = numberOf(condition.value2);
      if (c === null) return false;
      return a >= Math.min(b, c) && a <= Math.max(b, c);
    }
    case 'date':
    case 'dateRange': {
      const a = dateOf(value);
      const b = dateOf(condition.value);
      if (a === null || b === null) return false;
      if (op === 'before') return a < b;
      if (op === 'after') return a > b;
      const c = dateOf(condition.value2);
      if (c === null) return false;
      return a >= Math.min(b, c) && a <= Math.max(b, c);
    }
    default:
      return false;
  }
};

// Whether a rule matches one node / link. A rule without conditions
// matches everything of its target.
export const ruleMatches = (rule, target, id, item, ctx = {}) => {
  if (!rule.on || rule.target !== target) return false;
  const usable = rule.conditions.filter((condition) => condition.key);
  if (!usable.length) return true;
  const test = (condition) => testCondition(condition, valueFor(target, id, item, condition.key, ctx));
  return rule.match === 'any' ? usable.some(test) : usable.every(test);
};

// The style rules give one node / link: the first (highest) rule setting a
// style wins. `locked`: styles set by hand (Customize), left alone.
// -> { style, rules: [ids that matched] } or null when none matched.
export const formatFor = (rules, target, id, item, ctx = {}, locked = null) => {
  let style = null;
  let matched = null;
  rules.forEach((rule) => {
    if (!ruleMatches(rule, target, id, item, ctx)) return;
    matched = matched || [];
    matched.push(rule.id);
    Object.entries(rule.style).forEach(([key, value]) => {
      if (locked?.has(key)) return;
      style = style || {};
      if (!(key in style)) style[key] = value;
    });
  });
  return matched ? { style: style || {}, rules: matched } : null;
};

// How many drawn nodes / links each rule matches (the editor's counts).
// items: { node: [[id, node]], edge: [[key, edge]] } -> { ruleId: count }
export const matchCounts = (rules, items, ctx = {}) => Object.fromEntries(rules.map((rule) => [
  rule.id,
  (items[rule.target] || []).reduce((count, [id, item]) => count + (ruleMatches({ ...rule, on: true }, rule.target, id, item, ctx) ? 1 : 0), 0),
]));

// The ids a rule matches (Select them).
export const matchingIds = (rule, items, ctx = {}) => (items[rule.target] || [])
  .filter(([id, item]) => ruleMatches({ ...rule, on: true }, rule.target, id, item, ctx))
  .map(([id]) => id);

// Which styles were set by hand on a node (Customize marks them in
// `__customized`) or a link (its `__edits`): rules leave those alone.
export const lockedStyles = (target, item) => {
  if (target === 'node') {
    const marks = item?.__customized;
    return marks && typeof marks === 'object' ? new Set(Object.keys(marks).filter((key) => marks[key])) : null;
  }
  const edits = item?.__edits;
  if (!edits || typeof edits !== 'object') return null;
  const locked = new Set();
  if (edits.color) locked.add('color');
  if (edits.width != null) locked.add('width');
  if (edits.dashes !== undefined) locked.add('lineStyle');
  return locked.size ? locked : null;
};

// A short description of a rule (the list, the legend).
export const describeRule = (rule, keyLabel = (key) => key) => {
  const opLabel = (op) => OPERATORS.find((entry) => entry.value === op)?.label || op;
  const parts = rule.conditions.filter((condition) => condition.key).map((condition) => {
    const kind = OPERATOR_KINDS[condition.op];
    if (kind === 'none') return `${keyLabel(condition.key)} ${opLabel(condition.op)}`;
    if (kind === 'range' || kind === 'dateRange') return `${keyLabel(condition.key)} ${opLabel(condition.op)} ${condition.value} and ${condition.value2}`;
    return `${keyLabel(condition.key)} ${opLabel(condition.op)} ${condition.value}`;
  });
  const what = rule.target === 'edge' ? 'Links' : 'Nodes';
  return parts.length ? `${what} where ${parts.join(rule.match === 'any' ? ' or ' : ' and ')}` : `All ${what.toLowerCase()}`;
};

/* ── Domain rules (Configuration ▸ Rules; B-24) ─────────────────────── */

export const CONFIG_FORMATTING_KEY = 'formatting_rules';
export const DOMAIN_FORMATTING_KEY = 'linkx_domain_formatting_v1';

const normalizeRuleList = (value) => normalizeFormatting({ rules: Array.isArray(value) ? value : [] }).rules;

// Until the backend keeps `formatting_rules` (B-24), a successful save also
// keeps a copy on the device, per domain.
const deviceRules = createDomainStore(DOMAIN_FORMATTING_KEY, normalizeRuleList);
export const getDomainFormatting = deviceRules.get;
export const setDomainFormatting = deviceRules.set;
export const subscribeDomainFormatting = deviceRules.subscribe;
export const resetDomainFormattingCache = deviceRules.reset;

// The domain's rules: the configuration's, else the device copy.
export const resolveDomainFormatting = (configuration, domain) => (
  Array.isArray(configuration?.[CONFIG_FORMATTING_KEY])
    ? normalizeRuleList(configuration[CONFIG_FORMATTING_KEY])
    : getDomainFormatting(domain)
);
