// A per-domain value kept on the device ({ [domain]: value } under one
// localStorage key), followed by every window at once and by other browser
// tabs. The interim home of domain settings the backend does not keep yet
// (see docs/backend-requests.md B-23, B-24).
export const createDomainStore = (storageKey, normalize) => {
  let cache = null;
  const normalized = new Map();
  const listeners = new Set();
  const read = () => {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  };
  const all = () => {
    if (!cache) cache = read();
    return cache;
  };
  return {
    // The domain's value (the same object until it changes).
    get: (domain) => {
      const key = String(domain || 'bank');
      const raw = all()[key];
      const kept = normalized.get(key);
      if (kept && kept.raw === raw) return kept.value;
      const value = normalize(raw);
      normalized.set(key, { raw, value });
      return value;
    },
    set: (domain, value) => {
      const key = String(domain || 'bank');
      cache = { ...all(), [key]: normalize(value) };
      try {
        localStorage.setItem(storageKey, JSON.stringify(cache));
      } catch {
        // Storage unavailable: this session only.
      }
      listeners.forEach((listener) => listener());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      const onStorage = (event) => {
        if (event.key !== storageKey) return;
        cache = read();
        listener();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    // Tests.
    reset: () => {
      cache = null;
      normalized.clear();
    },
  };
};
