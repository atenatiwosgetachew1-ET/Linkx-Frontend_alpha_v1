// Source window numbers that are never used twice in a main session. The
// Service builds a source session id from them (<number>_<main session>), and
// a page load keeps the main session: restarting at 1 gave a new window the
// id of an earlier run, and so its credentials and graph (backend-requests.md
// B-37). Shared by the tabs of this browser.

const KEY = 'linkx.source.window_numbers.v1';
const MAX_SESSIONS = 5;

const read = () => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
};

// The next number for this main session; at least `atLeast` (this page's own
// counter, for a browser that stores nothing).
export const nextSourceWindowNumber = (mainSessionId, atLeast = 1) => {
  const session = String(mainSessionId || '').trim();
  const used = read();
  const last = Number.isSafeInteger(used[session]) && used[session] > 0 ? used[session] : 0;
  const next = Math.max(last + 1, Number(atLeast) || 1);
  if (!session) return next;
  try {
    const others = Object.entries(used).filter(([key]) => key !== session).slice(-(MAX_SESSIONS - 1));
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries([...others, [session, next]])));
  } catch { /* stores nothing: this page's counter still applies */ }
  return next;
};
