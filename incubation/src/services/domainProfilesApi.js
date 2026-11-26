// Domains managed by a superuser (Service round 4, B-49). PROPOSED routes,
// not built on the Service yet: every reader is defensive, and a Service that
// does not have a route answers 404, which reads as "not offered" (the app
// then keeps its own list of domains).
//   GET   /domains                              (config:read)
//   GET   /rule-sets                            (config:read)
//   GET   /domains/<id>/profile                 (domains:manage)
//   POST  /domains { domain_id, display_name, description, rule_set, copy_from, dry_run? }
//   PATCH /domains/<id>/profile { …changed fields, version_id, dry_run? }
//   GET   /domains/<id>/profile/history?limit=50
//   POST  /domains/<id>/deactivate | /activate { reason }
// Refusals: 403 { permission: "domains:manage" }, 400 invalid_field
// { invalid_fields }, 409 domain_exists, 409 version_conflict { current },
// 400 field_not_editable.

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 200) => (typeof value === 'string' ? value.slice(0, max) : '');
const textList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
const groups = (value) => (Array.isArray(value) ? value.map((item) => (Array.isArray(item) ? textList(item) : textList([item]))).filter((item) => item.length) : []);
const listOf = (data, ...keys) => [data, data?.results, ...keys.flatMap((key) => [data?.[key], data?.results?.[key]])].find(Array.isArray) || null;
const bodyOf = (data, key) => [data?.state, data?.results?.state, data?.results, data].find((item) => isObject(item) && key in item) || null;

// The Service has no such route (an older deployment): 404 that is not a
// domain the Service knows.
export const isRouteMissing = (error) => error?.status === 404 && !['domain_not_found', 'not_found'].includes(error?.data?.code);

/* ── Readers ──────────────────────────────────────────────────────────── */

// -> { id, displayName, description, active, origin, ruleSet, profileVersionId } | null
export const readDomain = (item) => {
  if (!isObject(item)) return null;
  const id = text(item.domain_id ?? item.id, 40).trim().toLowerCase();
  if (!id) return null;
  return {
    id,
    displayName: text(item.display_name, 120).trim(),
    description: text(item.description, 1000),
    active: item.active !== false,
    origin: item.origin === 'created' ? 'created' : 'builtin',
    ruleSet: text(item.rule_set, 120),
    profileVersionId: item.profile_version_id ?? null,
  };
};

// -> { name, requiredFields: [[alternatives]], canonicalFields, relationships, domains }
export const readRuleSet = (item) => {
  if (!isObject(item) || !text(item.name)) return null;
  return {
    name: text(item.name, 120),
    requiredFields: groups(item.required_fields),
    canonicalFields: textList(item.canonical_fields),
    // Names, or { name | relationship } objects.
    relationships: (Array.isArray(item.relationships) ? item.relationships : [])
      .map((entry) => (typeof entry === 'string' ? entry : text(entry?.name || entry?.relationship || entry?.type, 120)))
      .filter(Boolean),
    domains: textList(item.domains).map((domain) => domain.toLowerCase()),
  };
};

const META_KEYS = new Set(['editable', 'not_editable', 'origins', 'version_id', 'versions', 'domain_id', 'id', 'active', 'origin', 'updated_by', 'updated_at', 'reason', 'message', 'success', 'changed', 'warnings', 'dry_run']);

// -> { domainId, active, origin, versionId, versioned, fields: { key: value },
//      editable: { key: { type, min, max, maxLength, pattern, allowed } },
//      origins: { key: 'file' | 'superuser' }, notEditable, updatedBy, updatedAt, reason } | null
export const readProfile = (data) => {
  const body = bodyOf(data, 'editable') || bodyOf(data, 'profile');
  if (!body) return null;
  const fields = isObject(body.profile)
    ? body.profile
    : Object.fromEntries(Object.entries(body).filter(([key]) => !META_KEYS.has(key)));
  const editable = Object.fromEntries(Object.entries(isObject(body.editable) ? body.editable : {})
    .filter(([, meta]) => isObject(meta) || meta === true)
    .map(([key, meta]) => {
      const info = isObject(meta) ? meta : {};
      const allowed = [info.allowed, info.allowed_values, info.values, info.enum].find(Array.isArray);
      return [key, {
        type: text(info.type, 40) || 'text',
        min: Number.isFinite(info.min) ? info.min : null,
        max: Number.isFinite(info.max) ? info.max : null,
        maxLength: Number.isFinite(info.max_length) ? info.max_length : (Number.isFinite(info.maxLength) ? info.maxLength : null),
        pattern: text(info.pattern, 200),
        allowed: allowed ? allowed.filter((value) => ['string', 'number'].includes(typeof value)).map(String) : null,
        maxItems: Number.isFinite(info.max_items) ? info.max_items : null,
        required: info.required === true,
      }];
    }));
  return {
    domainId: text(body.domain_id ?? fields.domain_id ?? body.id, 40).toLowerCase(),
    active: body.active !== false,
    origin: body.origin === 'created' ? 'created' : 'builtin',
    versionId: body.version_id,
    versioned: 'version_id' in body,
    fields,
    editable,
    origins: isObject(body.origins) ? Object.fromEntries(Object.entries(body.origins).filter(([, value]) => typeof value === 'string')) : {},
    notEditable: textList(body.not_editable),
    updatedBy: text(body.versions?.superuser?.updated_by || body.updated_by, 120),
    updatedAt: text(body.versions?.superuser?.updated_at || body.updated_at, 40),
    reason: text(body.reason, 500),
  };
};

// Warnings of a save or dry run: [{ code, detail }] (a rule-set change:
// `rule_set_changed`, the domain's settings were made for the old rules).
export const readWarnings = (data) => {
  const list = [data?.results?.warnings, data?.warnings, data?.results?.state?.warnings].find(Array.isArray) || [];
  return list.slice(0, 10).map((item) => (typeof item === 'string'
    ? { code: '', detail: item.slice(0, 300) }
    : { code: text(item?.code, 60), detail: text(item?.detail || item?.message, 300), from: text(item?.from, 120), to: text(item?.to, 120) }))
    .filter((item) => item.detail || item.code);
};
export const warningText = ({ code, detail, from, to }) => detail
  || (code === 'rule_set_changed' ? `The thresholds, scoring, columns and column mapping saved for this domain were made for ${from || 'the old rules'}, not ${to || 'the new ones'}.` : code);

// What a dry run would change: [{ key, from, to }] (changed: { key: [now, after] }).
export const readDryRun = (data) => {
  const changed = [data?.changed, data?.results?.changed, data?.state?.changed].find(isObject);
  if (!changed) return null;
  return Object.entries(changed).map(([key, pair]) => (Array.isArray(pair) ? { key, from: pair[0], to: pair[1] } : { key, from: undefined, to: pair }));
};

/* ── Routes ───────────────────────────────────────────────────────────── */

// -> { available: true, domains } | { available: false }
export const fetchDomains = async (apiFetch) => {
  try {
    const data = await apiFetch('/domains', { suppressForbiddenHandler: true });
    const list = listOf(data, 'domains', 'items');
    if (!list) return { available: false };
    return { available: true, domains: list.map(readDomain).filter(Boolean) };
  } catch (error) {
    if (isRouteMissing(error)) return { available: false };
    throw error;
  }
};

// -> [rule set]
export const fetchRuleSets = async (apiFetch) => {
  const data = await apiFetch('/rule-sets', { suppressForbiddenHandler: true });
  return (listOf(data, 'rule_sets', 'items') || []).map(readRuleSet).filter(Boolean);
};

const path = (id) => `/domains/${encodeURIComponent(id)}`;

export const fetchDomainProfile = async (apiFetch, id) => readProfile(await apiFetch(`${path(id)}/profile`, { suppressForbiddenHandler: true }));

const conflictOf = (error) => (error?.status === 409 && [error?.data?.code, error?.data?.message].includes('version_conflict')
  ? readProfile(error.data.current || {}) : null);

// changes: only the changed editable fields. versionId: as the GET gave it
// (undefined: the GET had none, so none is sent).
// -> { ok: true, profile | null, preview | null, warnings } | { ok: false, conflict }
export const patchDomainProfile = async (apiFetch, id, changes, versionId, { dryRun = false } = {}) => {
  const body = { ...changes, ...(versionId === undefined ? {} : { version_id: versionId }), ...(dryRun ? { dry_run: true } : {}) };
  try {
    const data = await apiFetch(`${path(id)}/profile`, { method: 'PATCH', body });
    return { ok: true, profile: dryRun ? null : readProfile(data), preview: dryRun ? readDryRun(data) || [] : null, warnings: readWarnings(data) };
  } catch (error) {
    const conflict = conflictOf(error);
    if (conflict) return { ok: false, conflict };
    throw error;
  }
};

// draft: { domain_id, display_name, description, rule_set, copy_from }
// -> { ok: true, domain | null, profile | null (the created profile, or the
//      one a dry run would create), copied: [setting], copiedFrom, data }
export const createDomain = async (apiFetch, draft, { dryRun = false } = {}) => {
  const data = await apiFetch('/domains', { method: 'POST', body: { ...draft, ...(dryRun ? { dry_run: true } : {}) } });
  const item = [data?.results?.domain, data?.domain, data?.results, data].find((entry) => isObject(entry) && ('domain_id' in entry));
  const results = isObject(data?.results) ? data.results : (data || {});
  return {
    ok: true,
    domain: readDomain(item),
    profile: readProfile(data),
    copied: textList(results.copied),
    copiedFrom: text(results.copied_from, 40),
    data,
  };
};

// [{ version_id, updated_by, created_at, changed?, … }], newest first as sent.
export const fetchProfileHistory = async (apiFetch, id) => {
  const data = await apiFetch(`${path(id)}/profile/history?limit=50`, { suppressForbiddenHandler: true });
  return (listOf(data, 'history', 'items') || []).filter(isObject);
};

export const setDomainActive = async (apiFetch, id, active, reason) => {
  const data = await apiFetch(`${path(id)}/${active ? 'activate' : 'deactivate'}`, { method: 'POST', body: { reason } });
  const item = [data?.domain, data?.results?.domain, data?.results, data].find((entry) => isObject(entry) && 'domain_id' in entry);
  return readDomain(item);
};
