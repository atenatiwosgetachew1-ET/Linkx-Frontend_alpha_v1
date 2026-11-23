// Selector helpers for the style picker (VisualElementPicker): which CSS
// rules apply to an element regardless of its current interaction state.

// State pseudo-classes are stripped so hover/active/focus variables are listed
// even when the element isn't currently in that state.
export const STATE_PSEUDO_RE = /:(?:hover|active|focus|focus-visible|focus-within|checked|disabled|enabled|visited)(?![\w-])/g;
// `:not(:disabled)`, `:not(:hover):not(:focus)`... hold only state pseudos;
// stripping those states inside them leaves an invalid `:not()`, which hid
// every `button:hover:not(:disabled)` rule from the inspector. Drop the whole
// group instead (it only narrows by state).
export const STATE_ONLY_NOT_RE = /:not\(\s*(?::(?:hover|active|focus|focus-visible|focus-within|checked|disabled|enabled|visited)\s*,?\s*)+\)/g;
export const PSEUDO_ELEMENT_RE = /::?(?:-webkit-scrollbar(?:-[\w-]+)?|before|after|placeholder|marker|selection|first-line|first-letter|-webkit-[\w-]+|-moz-[\w-]+)(?:\([^)]*\))?/g;
export const SCROLLBAR_PSEUDO_RE = /::-webkit-scrollbar/;

// Selector with state conditions removed, so it matches in any state.
export const stateFreeSelector = (part) => part
  .replace(PSEUDO_ELEMENT_RE, '')
  .replace(STATE_ONLY_NOT_RE, '')
  .replace(STATE_PSEUDO_RE, '')
  .trim() || '*';

// The root-level variables behind `name`. `scoped` maps each variable that is
// set closer than the root (by a window or a popup) to the value it is given
// there. Such a variable is followed through the `var(--…)` in its value; one
// that is given a fixed value has nothing behind it and yields no names.
export const expandScopedVariable = (name, scoped, seen = new Set()) => {
  if (!scoped.has(name)) return [name];
  if (seen.has(name)) return [];
  const next = new Set(seen).add(name);
  const references = [...String(scoped.get(name)).matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);
  return [...new Set(references.flatMap((reference) => expandScopedVariable(reference, scoped, next)))];
};
