// The last page each Reports window loaded, per tab. A window body unmounts
// while another window is active, so coming back shows it at once and
// refreshes quietly instead of flashing "Loading". Keyed by tab too, so a tab
// never shows another tab's rows. Cleared on sign-out: window ids are reused
// by the next workspace.

const cache = new Map(); // `${windowId}:${tabId}` -> { tabId, records, total }
const keyOf = (windowId, tabId) => `${windowId}:${tabId}`;

export const getCachedReportsPage = (windowId, tabId) => (windowId ? cache.get(keyOf(windowId, tabId)) || null : null);

export const cacheReportsPage = (windowId, page) => {
  if (windowId && page?.tabId) cache.set(keyOf(windowId, page.tabId), page);
};

export const clearReportsPages = () => cache.clear();
