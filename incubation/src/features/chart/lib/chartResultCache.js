// Each Chart window's finished results and board scroll, kept while it is
// open: window id -> { key, results, scrollTop }. Cleared on sign-out: the
// next workspace reuses window ids.
export const resultCache = new Map();
export const clearChartResults = () => resultCache.clear();
