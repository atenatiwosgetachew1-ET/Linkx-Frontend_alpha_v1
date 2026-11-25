// The Filter tab's range: from 0 to the largest number of the properties
// searched in. It writes the search's own range text ("10-20").
import { looksLikeId, parseAmount } from '../../../shared/numbers/values.js';

const STEPS = 1000;
const LARGEST = 1e15; // beyond it a written number reads as an id

// -> { max, steps, valueAt(step), stepOf(value), textOf(value) } or null when
// those properties hold no number above 0. Ids are not amounts.
export const searchRangeOf = (values) => {
  let max = 0;
  let whole = true;
  for (const value of values) {
    if (looksLikeId(value)) continue;
    const number = parseAmount(value);
    if (number === null || number <= 0) continue;
    if (number > max) max = number;
    if (whole && !Number.isInteger(number)) whole = false;
  }
  if (!max || max >= LARGEST) return null;
  const steps = whole && max <= STEPS ? max : STEPS;
  const decimals = whole ? 0 : Math.max(0, Math.min(6, Math.ceil(-Math.log10(max / steps))));
  const round = (number) => Number(number.toFixed(decimals));
  if (round(max) === 0) return null;
  return {
    max,
    steps,
    // The ends are exact, so the largest value is never left out.
    valueAt: (step) => (step >= steps ? max : step <= 0 ? 0 : Math.min(max, round((max * step) / steps))),
    stepOf: (value) => Math.max(0, Math.min(steps, Math.round((value / max) * steps))),
    textOf: (value) => (/e/i.test(String(value)) ? value.toFixed(6) : String(value)),
  };
};

// Every value of these properties.
export function* propertyValues(graph, keys) {
  for (const { attributes } of graph.nodeEntries()) {
    for (const key of keys) if (attributes[key] != null) yield attributes[key];
  }
}

// The part of 0..max a search expression covers (graphSearch.js); all of it
// when it is not about an amount.
export const rangeOfExpression = (expression, max) => {
  const within = (value) => Math.max(0, Math.min(max, value));
  if (expression.mode === 'range') return [within(expression.min), within(expression.max)];
  if (expression.mode === 'compare' && expression.op.startsWith('>')) return [within(expression.target), max];
  if (expression.mode === 'compare' && expression.op.startsWith('<')) return [0, within(expression.target)];
  if (expression.mode === 'number_exact' || expression.mode === 'compare') return [within(expression.target), within(expression.target)];
  return [0, max];
};
