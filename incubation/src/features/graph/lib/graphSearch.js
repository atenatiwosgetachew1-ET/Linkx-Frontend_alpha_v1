// Graph search, ported from production's graph iframe (graphs_adjuster.js
// parseSearchExpression ~6819, valueMatchesSearchExpression ~6866,
// graphSearch ~6897, toFiniteNumber ~1032).
//
// Keyword forms: "10-20" range, ">= 100" / "<5" / "=3" comparisons, "42"
// exact number, anything else a case-insensitive "contains".

// GA:1032
export const toFiniteNumber = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
};

const parseNumericLiteral = (value) => {
  const normalized = String(value).trim().replace(/,/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
};

export const parseSearchExpression = (rawKeyword) => {
  const raw = rawKeyword == null ? '' : String(rawKeyword).trim();
  if (!raw) return { mode: 'text', textLower: '' };
  const range = raw.match(/^(-?\d+(?:[.,]\d+)?)\s*-\s*(-?\d+(?:[.,]\d+)?)$/);
  if (range) {
    const left = parseNumericLiteral(range[1]);
    const right = parseNumericLiteral(range[2]);
    if (left != null && right != null) return { mode: 'range', min: Math.min(left, right), max: Math.max(left, right) };
  }
  const compare = raw.match(/^(>=|<=|>|<|=|==)\s*(-?\d+(?:[.,]\d+)?)$/);
  if (compare) {
    const target = parseNumericLiteral(compare[2]);
    if (target != null) return { mode: 'compare', op: compare[1] === '==' ? '=' : compare[1], target };
  }
  const exact = raw.match(/^-?\d+(?:[.,]\d+)?$/);
  if (exact) {
    const target = parseNumericLiteral(exact[0]);
    if (target != null) return { mode: 'number_exact', target };
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
    return numeric === expression.target;
  }
  if (expression.mode === 'number_exact') return numeric === expression.target;
  return false;
};

const SKIPPED_KEYS = new Set(['x', 'y', 'vx', 'vy', 'index']);

// Production graphSearch: the matches (and, with "include linked", their
// neighbours; not for range / comparison searches) REPLACE the visible view,
// sliced by the current range. Matching stops at max(range max, 25) × 2
// (× 4 with linked expansion). `neighbours(id)` returns an iterable of ids.
export const searchNodeIds = ({ nodes, neighbours, keyword, includeLinked = false, keys = [], min = 0, max = 25 }) => {
  const expression = parseSearchExpression(keyword);
  const linked = Boolean(includeLinked) && expression.mode !== 'compare' && expression.mode !== 'range';
  const selectedKeys = [...new Set((keys || []).map((key) => String(key || '').trim()).filter(Boolean))];
  const cap = Math.max(max, 25) * (linked ? 4 : 2);
  const matched = [];
  for (const [id, node] of nodes) {
    let isMatch = false;
    if (selectedKeys.length) {
      isMatch = selectedKeys.some((key) => valueMatchesSearchExpression(node[key], expression));
    } else {
      isMatch = Object.entries(node).some(([key, value]) => !key.startsWith('_') && !SKIPPED_KEYS.has(key) && valueMatchesSearchExpression(value, expression));
    }
    if (isMatch) {
      matched.push(id);
      if (matched.length >= cap) break;
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
  return result.slice(min, Math.min(max, result.length));
};
