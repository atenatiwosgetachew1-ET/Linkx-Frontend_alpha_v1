// The Service's list of domains (GET /domains, round 4, B-49): display names,
// active or not, built-in or created by a superuser. One copy for the app;
// selectors hide inactive domains (configModel reads it), labels use the
// display names. Until the Service offers the route (`available: false`)
// nothing changes: the app keeps its own list.
import { useSyncExternalStore } from 'react';

import { fetchDomains } from '../../services/domainProfilesApi.js';
import { setDomainDirectory } from '../../features/configuration/lib/configModel.js';

const EMPTY = Object.freeze({ status: 'idle', domains: [] });
let state = EMPTY;
let loading = null;
const listeners = new Set();

const publish = (next) => {
  state = next;
  setDomainDirectory(next.status === 'ready' ? next.domains : null);
  listeners.forEach((listener) => listener());
};

export const subscribeDomainRegistry = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getDomainRegistry = () => state;
export const useDomainRegistry = () => useSyncExternalStore(subscribeDomainRegistry, getDomainRegistry);

// status: 'ready' | 'missing' (no such route) | 'error' (kept what it had).
export const loadDomainRegistry = (apiFetch) => {
  if (loading) return loading;
  loading = fetchDomains(apiFetch)
    .then((result) => publish(result.available ? { status: 'ready', domains: result.domains } : { status: 'missing', domains: [] }))
    .catch(() => { if (state.status !== 'ready') publish({ status: 'error', domains: [] }); })
    .finally(() => { loading = null; });
  return loading;
};

// One domain the Service changed (create, activate, deactivate, profile).
export const putDomain = (domain) => {
  if (!domain?.id || state.status !== 'ready') return;
  const rest = state.domains.filter((item) => item.id !== domain.id);
  publish({ status: 'ready', domains: [...rest, domain] });
};

export const resetDomainRegistry = () => {
  loading = null;
  publish(EMPTY);
};
