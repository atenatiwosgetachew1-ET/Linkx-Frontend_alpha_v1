// Window switcher helpers (WindowSwitcher.jsx).
import { useEffect, useMemo, useState } from 'react';

const PLACEHOLDER = 'placeholder';

// Most recently used first; new windows join at the front once focused,
// closed ones drop out. Kept for the session only. While `hold` is true (a
// ` walk), focus changes are not recorded; when it ends, only the window
// the walk stopped on moves to the front.
export function useWindowMru(windows, activeWindowId, { hold = false } = {}) {
  const [order, setOrder] = useState(() => {
    const ids = windows.map((windowItem) => windowItem.id).reverse();
    return activeWindowId ? [activeWindowId, ...ids.filter((id) => id !== activeWindowId)] : ids;
  });
  useEffect(() => {
    setOrder((current) => {
      const open = new Set(windows.map((windowItem) => windowItem.id));
      const kept = current.filter((id) => open.has(id));
      const added = windows.map((windowItem) => windowItem.id).filter((id) => !kept.includes(id)).reverse();
      let next = [...kept, ...added];
      if (!hold && activeWindowId && open.has(activeWindowId)) next = [activeWindowId, ...next.filter((id) => id !== activeWindowId)];
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [windows, activeWindowId, hold]);
  return useMemo(() => {
    const byId = new Map(windows.map((windowItem) => [windowItem.id, windowItem]));
    return order.map((id) => byId.get(id)).filter(Boolean);
  }, [order, windows]);
}

// The second line: the analyst's own title, else the window's status.
export const windowDetail = (windowItem) => {
  const custom = String(windowItem.customTitle || '').trim();
  if (custom && custom.toLowerCase() !== PLACEHOLDER) return custom;
  const status = String(windowItem.status || '').trim();
  return status && status.toLowerCase() !== PLACEHOLDER ? status : '';
};

export const matchesWindow = (windowItem, query) => {
  if (!query) return true;
  const haystack = [windowItem.title, windowDetail(windowItem), windowItem.type, windowItem.sourceSessionId].join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
};


// A key press while the analyst is typing (or inside a modal popup) is
// theirs, not the switcher's.
const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);
export const isTypingTarget = (target) => {
  if (!target || typeof target.closest !== 'function') return false;
  if (target.closest('[aria-modal="true"]')) return true;
  const field = target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"], [role="searchbox"]');
  if (!field) return false;
  return !(field.tagName === 'INPUT' && NON_TEXT_INPUTS.has(String(field.type).toLowerCase()));
};
