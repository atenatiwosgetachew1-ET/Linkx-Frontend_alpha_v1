// Graph search, ported from production's graph iframe (graphs_adjuster.js
// parseSearchExpression ~6819, valueMatchesSearchExpression ~6866,
// graphSearch ~6897, toFiniteNumber ~1032).
//
// Keyword forms: "10-20" range, ">= 100" / "<5" / "=3" comparisons, "42"
// exact number, anything else a case-insensitive "contains".

import { looksLikeId, parseAmount, sameValue } from '../../../shared/numbers/values.js';

// GA:1032, by the shared rules.
export const toFiniteNumber = parseAmount;

// A typed id ("0012345", a 16-digit account) is text, not an amount.
const parseNumericLiteral = (value) => (looksLikeId(value) ? null : parseAmount(value));
const LITERAL = '-?\\d[\\d,]*(?:\\.\\d+)?';
const RANGE = new RegExp(`^(${LITERAL})\\s*-\\s*(${LITERAL})$`);
const COMPARE = new RegExp(`^(>=|<=|>|<|=|==)\\s*(${LITERAL})$`);
const EXACT = new RegExp(`^${LITERAL}$`);

export const parseSearchExpression = (rawKeyword) => {
  const raw = rawKeyword == null ? '' : String(rawKeyword).trim();
  if (!raw) return { mode: 'text', textLower: '' };
  const range = raw.match(RANGE);
  if (range) {
    const left = parseNumericLiteral(range[1]);
    const right = parseNumericLiteral(range[2]);
    if (left != null && right != null) return { mode: 'range', min: Math.min(left, right), max: Math.max(left, right) };
  }
  const compare = raw.match(COMPARE);
  if (compare) {
    const target = parseNumericLiteral(compare[2]);
    if (target != null) return { mode: 'compare', op: compare[1] === '==' ? '=' : compare[1], target };
  }
  const exact = raw.match(EXACT);
  if (exact) {
    const target = parseNumericLiteral(exact[0]);
    if (target != null) return { mode: 'number_exact', target, text: raw };
  }
  return { mode: 'text', textLower: raw.toLowerCase() };
};

export const valueMatchesSearchExpression = (value, expression) => {
  if (value == null || !expression) return false;
  if (expression.mode === 'text') return String(value).toLowerCase().includes(expression.textLower);
  const numeric = toFiniteNumber(value);
  if (numeric == null) return false;
  if (expression.mode === 'range') return numeric >= expression.min && numeric <= expression.max;
  if (expression.mode === 'compare') {
    if (expression.op === '>') return numeric > expression.target;
    if (expression.op === '>=') return numeric >= expression.target;
    if (expression.op === '<') return numeric < expression.target;
    if (expression.op === '<=') return numeric <= expression.target;
    return sameValue(value, expression.target);
  }
  if (expression.mode === 'number_exact') return sameValue(value, expression.text ?? expression.target);
  return false;
};

const SKIPPED_KEYS = new Set(['x', 'y', 'vx', 'vy', 'index']);

// Production graphSearch: the matches (and, with "include linked", their
// neighbours; not for range / comparison searches) REPLACE the visible view,
// sliced by the current range. At most max(range max, 25) × 2 are kept
// (× 4 with linked expansion); all matches are counted. `neighbours(id)` returns an iterable of ids.
// -> { ids: the shown ones, matches: how many match in all }
export const searchNodes = ({ nodes, neighbours, keyword, includeLinked = false, keys = [], min = 0, max = 25 }) => {
  const expression = parseSearchExpression(keyword);
  const linked = Boolean(includeLinked) && expression.mode !== 'compare' && expression.mode !== 'range';
  const selectedKeys = [...new Set((keys || []).map((key) => String(key || '').trim()).filter(Boolean))];
  const cap = Math.max(max, 25) * (linked ? 4 : 2);
  const matched = [];
  let matches = 0;
  for (const [id, node] of nodes) {
    let isMatch = false;
    if (selectedKeys.length) {
      isMatch = selectedKeys.some((key) => valueMatchesSearchExpression(node[key], expression));
    } else {
      isMatch = Object.entries(node).some(([key, value]) => !key.startsWith('_') && !SKIPPED_KEYS.has(key) && valueMatchesSearchExpression(value, expression));
    }
    if (isMatch) {
      matches += 1;
      if (matched.length < cap) matched.push(id);
    }
  }
  let result = matched;
  if (linked && matched.length) {
    const expanded = new Set(matched);
    for (const id of matched) {
      for (const other of neighbours(id)) {
        expanded.add(other);
        if (expanded.size >= cap) break;
      }
      if (expanded.size >= cap) break;
    }
    result = [...expanded];
  }
  return { ids: result.slice(min, Math.min(max, result.length)), matches };
};
export const searchNodeIds = (options) => searchNodes(options).ids;
