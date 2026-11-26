import { useContext } from 'react';

import { AuthContext } from './authContext.js';

// The domains the account may work in (GET /auth/me, C10): a list, or null for
// all of them. The Service enforces it either way.
export const useAllowedDomains = () => useContext(AuthContext)?.user?.allowed_domains ?? null;

// Those of `domains` that may be chosen; the one in use is always shown.
export const grantedDomains = (domains, allowed, current = '') => (
  Array.isArray(allowed) ? domains.filter((domain) => allowed.includes(domain) || domain === current) : domains
);
