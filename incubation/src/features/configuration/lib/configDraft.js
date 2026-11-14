// Unsaved Configuration edits, kept outside React and outside workspace
// state. A docked window body unmounts while another tab is active; the
// draft (which can hold a typed raw password) must survive that, but must
// never reach workspace metadata. Cleared on sign-out: window ids are reused
// by the next workspace.

const drafts = new Map(); // windowId -> { draft, base, sessionId }

export const getConfigurationDraft = (windowId) => (windowId ? drafts.get(String(windowId)) || null : null);

export const keepConfigurationDraft = (windowId, entry) => {
  if (!windowId) return;
  if (entry) drafts.set(String(windowId), entry);
  else drafts.delete(String(windowId));
};

export const clearConfigurationDrafts = () => drafts.clear();

// Keys the backend owns for the session domain. Production edits one shared
// configuration object, so its save always carries the current domain; the
// draft mirrors that by always taking these from the session.
const SESSION_OWNED_KEYS = ['domain', 'active_domain'];

const same = (a, b) => {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

// The session configuration changed (domain switch elsewhere, reset, rule
// change) while the draft has unsaved edits. Keys the analyst did not touch
// (draft === base) follow the session; edited keys stay as typed; the
// session-owned domain keys always follow the session.
export const rebaseConfigurationDraft = (draft = {}, base = {}, next = {}) => {
  const result = { ...draft };
  const keys = new Set([...Object.keys(base), ...Object.keys(next)]);
  keys.forEach((key) => {
    if (SESSION_OWNED_KEYS.includes(key) || same(draft[key], base[key])) {
      if (next[key] === undefined) delete result[key];
      else result[key] = next[key];
    }
  });
  return result;
};
