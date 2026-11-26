import { formatDomainPillarLabel } from '../../configuration/lib/configModel.js';

// The domains a user may work in (GET / PUT /auth/admin/users/<id>/domains, C10).
// -> { domains: [..] | null (all), unrestricted, enforced } | null
export const readUserDomains = (data) => {
  const body = [data?.state, data?.results, data].find((item) => item && typeof item === 'object' && 'domains' in item);
  if (!body) return null;
  return {
    domains: Array.isArray(body.domains) ? body.domains.filter((item) => typeof item === 'string') : null,
    unrestricted: body.unrestricted === true,
    enforced: body.enforced !== false,
  };
};
export const userDomainsText = (domains) => (Array.isArray(domains) ? domains.map(formatDomainPillarLabel).join(', ') || 'No domain' : 'All domains');
