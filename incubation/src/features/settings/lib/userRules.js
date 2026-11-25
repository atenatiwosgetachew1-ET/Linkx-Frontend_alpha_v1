// The Service's rules for users (GET /auth/admin/user-rules, B-33):
//   { results: { roles: { assignable: [...], permissions: { analyst: [...] } } } }
// Read tolerantly; what cannot be read is null (never guessed):
//   { roles: { permissions: { analyst: [...] } } }
//   { roles: [{ role | name, permissions: [...] }] } or { roles: { analyst: { permissions: [...] } } }
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const keysOf = (value) => (Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : item?.key)).filter((item) => typeof item === 'string' && item) : null);

// -> { permissions: { role: [permission] } | null, assignable: [role] | null }
export const normalizeUserRules = (data) => {
  const source = isObject(data?.results) ? data.results : data;
  const roles = source?.roles;
  let entries = [];
  if (isObject(roles?.permissions)) entries = Object.entries(roles.permissions).map(([role, list]) => [role, keysOf(list)]);
  else if (Array.isArray(roles)) entries = roles.map((item) => [item?.role ?? item?.name, keysOf(item?.permissions)]);
  else if (isObject(roles)) entries = Object.entries(roles).map(([role, item]) => [role, keysOf(item?.permissions ?? item)]);
  const known = entries.filter(([role, list]) => typeof role === 'string' && role && list);
  const assignable = keysOf(roles?.assignable);
  return { permissions: known.length ? Object.fromEntries(known) : null, assignable: assignable?.length ? assignable : null };
};
