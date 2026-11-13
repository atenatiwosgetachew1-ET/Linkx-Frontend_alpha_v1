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
