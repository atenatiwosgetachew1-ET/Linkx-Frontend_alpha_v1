// Analysis verdict read from a task's log: which rules flagged the data.
//
// The backend has no structured flag line yet (docs/backend-requests.md
// B-21), so this reads the common shapes tolerantly:
//   "Flagged rules: Smurfing, Dormant to Active"   "flagged_rules=['A', 'B']"
//   "Suspicious: Rapid Velocity Flow"               "Anomalies detected: X; Y"
//   "Rule Smurfing triggered"                       "flagged_nodes: 3"
//   "No anomalies detected" / "No flags found" / "flagged_rules: []"  -> clean
// Only backend lines are read for streams (local status lines never carry
// a verdict); quick-panel tasks read their own log.

import { TASK_STATUSES } from './taskRegistry.js';

const FLAG_LIST_RE = /\b(?:flagged(?:[ _-]?(?:rules?|patterns?|activit(?:y|ies)))?|flags?|suspicious(?:[ _-]?(?:activit(?:y|ies)|patterns?|rules?))?|anomal(?:y|ies)(?:[ _-]?(?:detected|found|types?))?|triggered[ _-]?rules?)\s*[:=]\s*(.+)$/i;
// Backend batch summary (cumulative counts per rule), logged twice per batch:
// "Incremental analysis for batch 4_272273_3 flags: {'LATE_NIGHT_TX': 1244, 'FUND_FLOW': 98}"
// "Live analysis batch 3 flags: {...}"
const FLAG_DICT_RE = /\bflags?\s*[:=]\s*\{([^}]*)\}/i;
const FLAG_PAIR_RE = /["']?([A-Za-z][\w .&/-]*?)["']?\s*:\s*(\d+)/g;
const FLAG_COUNT_RE = /\bflagged[ _-]?(?:nodes|accounts|entities|transactions|records|rows)\s*[:=]\s*(\d+)/i;
const RULE_HIT_RE = /\brule\s+["'`]?([\w][\w .&/()-]*?)["'`]?\s+(?:was\s+)?(?:triggered|matched|hit|flagged|fired)\b/i;
const CLEAN_RE = /\b(?:no\s+(?:flags?|flagged\s+\w+|anomal(?:y|ies)|suspicious\s+(?:activit(?:y|ies)|patterns?)|alerts?)(?:\s+(?:were\s+)?(?:found|detected|raised))?|result\s*[:=]\s*clean|verdict\s*[:=]\s*clean|status\s*[:=]\s*clean)\b/i;
const EMPTY_VALUE_RE = /^(?:\[\s*\]|\{\s*\}|none|null|nil|n\/a|-|0|false|clean)$/i;

const MAX_LINES = 5000;

const splitNames = (value) => String(value)
  // Details in brackets may contain commas ("(5,000 ETB)"): drop them first.
  .replace(/\([^)]*\)|\{[^}]*\}|<[^>]*>/g, ' ')
  .trim()
  .replace(/^[[({]+|[\])}.]+$/g, '')
  .split(/[,;|]/)
  .map((name) => name.trim().replace(/^["'`]+|["'`]+$/g, '').trim())
  .filter((name) => name && !/^\d+$/.test(name) && !EMPTY_VALUE_RE.test(name) && name.length <= 80);

// Context after a flag name (who/what it fired on) is not part of the name:
// "Smurfing for ACC-1 (5,000 ETB)" -> "Smurfing".
const CONTEXT_CUT_RE = /\s(?:for|on|at|by|with|from|against|involving|in\s+(?:account|session|window|batch|row)|account|acc|txn|tx|id)\b.*$/i;
const NOISE_WORDS = new Set(['rule', 'rules', 'pattern', 'patterns', 'detected', 'detection', 'flag', 'flags', 'flagged', 'suspicious', 'anomaly', 'anomalies', 'alert', 'triggered']);

// Removes ids, amounts, timestamps, bracketed details and trailing context.
export const cleanFlagName = (name) => String(name)
  .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]*>/g, ' ')
  .replace(/^\s*[-:•*]+\s*/, '')
  .replace(CONTEXT_CUT_RE, '')
  .split(/\s+/)
  .filter((word) => word && !/\d/.test(word))
  .join(' ')
  .replace(/[\s:=,;.\-–—]+$/, '')
  .trim();

const singular = (word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word);

// Similar names are one flag: case, separators, noise words
// ("rule", "detected", ...), plurals, ids and amounts are ignored.
// "Smurfing", "smurfing_rule", "SMURFING detected for ACC-1" -> "smurfing".
export const flagTokens = (name) => cleanFlagName(name)
  .toLowerCase()
  .replace(/[_\-./&+]+/g, ' ')
  .replace(/[^\p{L}\s]/gu, ' ')
  .split(/\s+/)
  .filter((word) => word && !NOISE_WORDS.has(word))
  .map(singular);

// Word order is kept: "Dormant to Active" and "Active to Dormant" differ.
export const flagKey = (name) => flagTokens(name).join(' ');

// Small typos / spelling variants ("Smurfng", "Dormant-Activ").
const editDistance = (a, b) => {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
};

const isSameFlag = (a, b) => {
  if (a.key === b.key) return true;
  const joinedA = a.key.replace(/ /g, '');
  const joinedB = b.key.replace(/ /g, '');
  if (joinedA === joinedB) return true; // "high degree hub" vs "highdegree hub"
  if (Math.min(joinedA.length, joinedB.length) >= 6 && editDistance(joinedA, joinedB) <= Math.min(2, Math.floor(Math.min(joinedA.length, joinedB.length) / 6))) return true;
  // One name is the other plus extra words, same order ("degree hub" /
  // "high degree hub"), never a reordering ("Active to Dormant").
  const [small, large] = a.key.length <= b.key.length ? [a.key, b.key] : [b.key, a.key];
  return small.replace(/ /g, '').length >= 4 && ` ${large} `.includes(` ${small} `);
};

// The name as written, minus ids/context and leading/trailing noise words
// ("smurfing_rule" -> "smurfing").
const displaySpelling = (name) => {
  const words = (cleanFlagName(name) || String(name)).replace(/_+/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length > 1 && NOISE_WORDS.has(words[0].toLowerCase())) words.shift();
  while (words.length > 1 && NOISE_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(' ');
};

const isMixedCase = (text) => text !== text.toUpperCase() && text !== text.toLowerCase();

// Readable label for a group: the most used spelling; then the one as
// specific as the group ("High-Degree Hub" over "Degree Hub"), properly
// cased, shortest ("Smurfing" over "Smurfings"). Unreadable casing becomes
// Title Case.
const prettyName = (spellings, groupTokens) => {
  const ranked = [...spellings.entries()].map(([text, uses]) => ({
    text,
    uses,
    specific: flagTokens(text).length >= groupTokens ? 1 : 0,
    mixed: isMixedCase(text) ? 1 : 0,
  })).sort((a, b) => b.uses - a.uses || b.specific - a.specific || b.mixed - a.mixed || a.text.length - b.text.length);
  const best = ranked[0].text;
  if (isMixedCase(best)) return best;
  // FUND_FLOW -> Fund Flow, DORMANT_TO_ACTIVE -> Dormant to Active.
  return best.toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, lead, letter) => lead + letter.toUpperCase())
    .replace(/(?!^)\b(And|Or|To|Of|The|In|On|For|By|With)\b/g, (word) => word.toLowerCase())
    .replace(/\b(Tx|Txn|Id|Atm|Pos|Kyc|Aml|Ctr|Str)\b/g, (word) => word.toUpperCase());
};

// -> { flags: [{ name, count }] (most frequent first), count, cleanSeen }
export const scanFlagLines = (lines = [], { backendOnly = true } = {}) => {
  const groups = []; // { key, tokens:Set, spellings:Map, count, order }
  let count = 0;
  let cleanSeen = false;

  const groupFor = (name) => {
    const key = flagKey(name);
    if (!key) return null;
    const candidate = { key, tokens: new Set(key.split(' ')) };
    let group = groups.find((item) => isSameFlag(item, candidate));
    if (!group) {
      group = { ...candidate, spellings: new Map(), count: 0, order: groups.length };
      groups.push(group);
    } else if (candidate.tokens.size > group.tokens.size) {
      // Keep the most specific wording as the group identity.
      group.key = candidate.key;
      group.tokens = candidate.tokens;
    }
    return group;
  };

  lines.slice(-MAX_LINES).forEach((line) => {
    if (backendOnly && line?.source !== 'backend') return;
    const text = String(line?.message ?? line ?? '');
    // Summary counts are running totals: keep the highest per flag (the
    // duplicate "Live analysis" line then changes nothing).
    const dictMatch = text.match(FLAG_DICT_RE);
    if (dictMatch) {
      const pairs = [...dictMatch[1].matchAll(FLAG_PAIR_RE)];
      if (!pairs.length || pairs.every(([, , value]) => Number(value) === 0)) cleanSeen = true;
      pairs.forEach(([, name, value]) => {
        const total = Number(value);
        if (!total) return;
        const group = groupFor(name);
        if (!group) return;
        const spelling = displaySpelling(name);
        group.spellings.set(spelling, (group.spellings.get(spelling) || 0) + 1);
        group.total = Math.max(group.total || 0, total);
      });
      return;
    }
    const countMatch = text.match(FLAG_COUNT_RE);
    if (countMatch) count = Math.max(count, Number(countMatch[1]) || 0);
    if (CLEAN_RE.test(text)) cleanSeen = true;
    const names = [];
    const listMatch = text.match(FLAG_LIST_RE);
    if (listMatch && !countMatch) {
      const value = listMatch[1].trim();
      if (EMPTY_VALUE_RE.test(value)) cleanSeen = true;
      else if (/^\d+$/.test(value)) count = Math.max(count, Number(value));
      else names.push(...splitNames(value));
    }
    const ruleMatch = text.match(RULE_HIT_RE);
    if (ruleMatch) names.push(ruleMatch[1].trim());
    // A flag counts once per line, however often the line names it.
    const counted = new Set();
    names.forEach((name) => {
      const group = groupFor(name);
      if (!group) return;
      const spelling = displaySpelling(name);
      group.spellings.set(spelling, (group.spellings.get(spelling) || 0) + 1);
      if (counted.has(group)) return;
      counted.add(group);
      group.count += 1;
    });
  });

  const flags = groups
    .map((group) => ({ ...group, count: Math.max(group.count, group.total || 0) }))
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map((group) => ({ name: prettyName(group.spellings, group.tokens.size), count: group.count }));
  return { flags, count, cleanSeen };
};

export const FLAG_STATES = Object.freeze({
  SUSPICIOUS: 'suspicious',
  CLEAN: 'clean',
  PENDING: 'pending',
  UNDETERMINED: 'undetermined',
});

// -> { state, flags, count, label, detail }
export const taskFlagVerdict = (task, lines = [], { backendOnly = true } = {}) => {
  const { flags, count, cleanSeen } = scanFlagLines(lines, { backendOnly });
  if (flags.length || count > 0) {
    return {
      state: FLAG_STATES.SUSPICIOUS,
      flags,
      count,
      label: 'Suspicious',
      detail: flags.length ? '' : `${count} flagged`,
    };
  }
  const isActive = task.status === TASK_STATUSES.STARTING || task.status === TASK_STATUSES.RUNNING;
  if (isActive) {
    return { state: FLAG_STATES.PENDING, flags, count, label: 'Analysing', detail: 'No flags so far' };
  }
  if (task.status === TASK_STATUSES.COMPLETED || cleanSeen) {
    return {
      state: FLAG_STATES.CLEAN,
      flags,
      count,
      label: 'Clean',
      detail: cleanSeen ? 'No flags raised' : 'No flags reported in the log',
    };
  }
  return {
    state: FLAG_STATES.UNDETERMINED,
    flags,
    count,
    label: 'Not determined',
    detail: task.status === TASK_STATUSES.FAILED ? 'The run failed before a verdict' : 'Stopped before a verdict',
  };
};
