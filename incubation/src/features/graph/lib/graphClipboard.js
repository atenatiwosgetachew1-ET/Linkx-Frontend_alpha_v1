// The graph clipboard (production copyNodes / pasteNodes clipboard, GA:5859
// and GB:1375): one per device under production's key, in its shape
// { nodes, edges }, so copying in one Graph window pastes in any other, in
// this tab (listeners) or another one (storage event). Production relayed it
// through the parent page to every graph iframe.

export const CLIPBOARD_KEY = 'linkx_graph_clipboard_v1';

const EMPTY = Object.freeze({ nodes: [], edges: [] });
let cache = null;
const listeners = new Set();

// Production normalizeClipboardPayload: an array of nodes with `__edges`,
// or { nodes, edges }.
export const normalizeClipboard = (payload) => {
  if (Array.isArray(payload)) {
    return {
      nodes: payload.filter((node) => node && typeof node === 'object').map((node) => ({ ...node })),
      edges: Array.isArray(payload.__edges) ? payload.__edges.map((edge) => ({ ...edge })) : [],
    };
  }
  return {
    nodes: Array.isArray(payload?.nodes) ? payload.nodes.filter((node) => node && typeof node === 'object').map((node) => ({ ...node })) : [],
    edges: Array.isArray(payload?.edges) ? payload.edges.filter((edge) => edge && typeof edge === 'object').map((edge) => ({ ...edge })) : [],
  };
};

const read = () => {
  try {
    const raw = localStorage.getItem(CLIPBOARD_KEY);
    return raw ? normalizeClipboard(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
};

export const getClipboard = () => {
  if (!cache) cache = read();
  return cache;
};

export const hasClipboard = () => getClipboard().nodes.length > 0;

export const setClipboard = (payload) => {
  cache = normalizeClipboard(payload);
  try {
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify(cache));
  } catch {
    // Storage full or unavailable: this tab keeps it.
  }
  listeners.forEach((listener) => listener());
};

export const subscribeClipboard = (listener) => {
  listeners.add(listener);
  const onStorage = (event) => {
    if (event.key !== CLIPBOARD_KEY) return;
    cache = read();
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
};

// Tests.
export const resetClipboardCache = () => {
  cache = null;
};
