// A domain's shared settings on the Service (B-23, B-24, Service answer
// 2026-11-25): one versioned copy per domain, for everyone.
//   GET  /domain-config?domain=D&section=presentation (config:read)
//   POST /domain-config { domain, section, actor_profile?, formatting_rules?, version_id? } (config:write)
//        a key left out is kept, null clears it; 409 version_conflict { current }

export const PRESENTATION_MAX_BYTES = 1000 * 1000;

const read = (data) => {
  const body = [data?.state, data?.results, data].find((item) => item && typeof item === 'object' && 'version_id' in item);
  if (!body) return null;
  return {
    versionId: body.version_id ?? null,
    actorProfile: body.actor_profile && typeof body.actor_profile === 'object' ? body.actor_profile : null,
    formattingRules: Array.isArray(body.formatting_rules) ? body.formatting_rules : null,
    updatedBy: typeof body.updated_by === 'string' ? body.updated_by.slice(0, 120) : '',
  };
};

// -> { versionId, actorProfile, formattingRules, updatedBy } | null (not an answer)
export const fetchPresentation = async (apiFetch, domain) => read(await apiFetch(
  `/domain-config?domain=${encodeURIComponent(domain)}&section=presentation`,
  { suppressForbiddenHandler: true },
));

// changes: { actor_profile?, formatting_rules? }
// -> { ok, presentation } | { ok: false, conflict: presentation } | { ok: false, message }
export const savePresentation = async (apiFetch, domain, changes, versionId) => {
  const body = { domain, section: 'presentation', ...changes, ...(versionId === null || versionId === undefined ? {} : { version_id: versionId }) };
  if (new Blob([JSON.stringify(changes)]).size > PRESENTATION_MAX_BYTES) {
    return { ok: false, message: 'The profile and formatting settings are over 1 MB together. Use smaller or fewer icons.' };
  }
  try {
    return { ok: true, presentation: read(await apiFetch('/domain-config', { method: 'POST', body })) };
  } catch (error) {
    const conflict = error?.status === 409 && error?.data?.code === 'version_conflict' ? read(error.data.current || {}) : null;
    if (conflict) return { ok: false, conflict };
    throw error;
  }
};

/* ── Sensitivity, columns and column mapping (Phase 6, B-44) ──────────── */
// GET  /domain-config?domain=D&section=S (config:read)
// POST /domain-config { domain, section, …, version_id? } (users:manage)
// POST /domain-config/reset { domain, section, keys? | sources?, version_id? }
// GET  /domain-config/history?domain=D&section=S&limit=50
// An old version_id is 409 version_conflict { current: the GET }.

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const bodyOf = (data, key) => [data?.state, data?.results?.state, data?.results, data].find((item) => isObject(item) && key in item) || null;
const textList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []);
const groups = (value) => (Array.isArray(value) ? value.map((item) => (Array.isArray(item) ? textList(item) : textList([item]))).filter((item) => item.length) : []);
const versionOf = (body) => body?.version_id;
const common = (body) => ({
  versionId: versionOf(body),
  versioned: 'version_id' in body, // B-44: versions and dry runs are known there
  enforced: body.enforced !== false,
  updatedBy: String(body.versions?.admin?.updated_by || body.updated_by || '').slice(0, 120),
  updatedAt: body.versions?.admin?.updated_at || body.updated_at || '',
});

export const COLUMN_KEYS = ['fetch_columns', 'search_columns_strict', 'search_columns_fuzzy'];

const READERS = {
  sensitivity: (data) => {
    const body = bodyOf(data, 'preset') || bodyOf(data, 'available_presets');
    return body && {
      ...common(body),
      preset: typeof body.preset === 'string' ? body.preset : '',
      presets: isObject(body.available_presets) ? body.available_presets : Object.fromEntries(textList(body.available_presets).map((name) => [name, null])),
      managedKeys: textList(body.managed_keys),
      thresholds: isObject(body.thresholds) ? body.thresholds : {},
      modified: Array.isArray(body.modified_since_applied) ? textList(body.modified_since_applied) : Object.keys(isObject(body.modified_since_applied) ? body.modified_since_applied : {}),
    };
  },
  columns: (data) => {
    const body = bodyOf(data, 'columns');
    const lists = (value) => Object.fromEntries(COLUMN_KEYS.flatMap((key) => (Array.isArray(value?.[key]) ? [[key, textList(value[key])]] : [])));
    return body && isObject(body.columns) ? { ...common(body), columns: lists(body.columns), origins: isObject(body.origins) ? body.origins : {}, admin: lists(body.admin), profile: lists(body.profile) } : null;
  },
  mapping: (data) => {
    const body = bodyOf(data, 'column_mapping');
    const map = (value) => Object.fromEntries(Object.entries(isObject(value) ? value : {}).filter(([, target]) => typeof target === 'string' || target === null));
    return body && isObject(body.column_mapping) ? {
      ...common(body),
      mapping: Object.fromEntries(Object.entries(map(body.column_mapping)).filter(([, target]) => target)),
      origins: isObject(body.origins) ? body.origins : {},
      adjustments: map(body.admin_adjustments),
      profile: map(body.profile),
      canonicalFields: textList(body.canonical_fields),
      requiredFields: groups(body.required_fields),
      unmappedRequired: groups(body.unmapped_required),
    } : null;
  },
};

const isCode = (error, code) => [error?.data?.code, error?.data?.message, error?.data?.detail, error?.data?.error].includes(code);
export const isFeatureDisabled = (error) => error?.status === 404 && isCode(error, 'feature_disabled');

// The newer state a refused save carries; null when it was refused for another
// reason, or carries none.
export const readVersionConflict = (error, reader) => {
  if (error?.status !== 409 || !isCode(error, 'version_conflict')) return null;
  return (error.data?.current && reader(error.data.current)) || null;
};

// -> the section's state | null (not an answer)
export const fetchDomainSection = async (apiFetch, domain, section) => READERS[section](await apiFetch(
  `/domain-config?domain=${encodeURIComponent(domain)}&section=${section}`,
  { suppressForbiddenHandler: true },
));

// null: only if nothing was saved yet; undefined (a GET without it): not sent.
const withVersion = (body, versionId) => (versionId === undefined ? body : { ...body, version_id: versionId });
// What the Service warns of after a save: sentences, or groups of required
// fields that lost their last source (C7, 5).
const readWarnings = (data) => {
  const list = [data?.warnings, data?.results?.warnings, data?.state?.warnings].find(Array.isArray) || [];
  return list.slice(0, 10).map((item) => {
    if (typeof item === 'string') return item.slice(0, 300);
    const fields = Array.isArray(item) ? textList(item) : textList(item?.fields).length ? textList(item.fields) : textList(item?.group);
    if (fields.length) return `Nothing is mapped to ${fields.join(' or ')} any more.`;
    return String(item?.message || '').slice(0, 300);
  }).filter(Boolean);
};

// -> { ok, state (null: read it again), warnings, data } | { ok: false, conflict: state }
const send = async (apiFetch, path, section, body) => {
  try {
    const data = await apiFetch(path, { method: 'POST', body });
    return { ok: true, state: READERS[section](data), warnings: readWarnings(data), data };
  } catch (error) {
    const conflict = readVersionConflict(error, READERS[section]);
    if (conflict) return { ok: false, conflict };
    throw error;
  }
};
export const saveDomainSection = (apiFetch, domain, section, changes, versionId) => send(apiFetch, '/domain-config', section, withVersion({ domain, section, ...changes }, versionId));
export const resetDomainSection = (apiFetch, domain, section, what, versionId) => send(apiFetch, '/domain-config/reset', section, withVersion({ domain, section, ...what }, versionId));

// What applying a preset would change: [{ key, from, to }], saving nothing.
// Only where `versioned` (B-44): an older Service would not know `dry_run` and
// apply the preset. null: not an answer.
export const previewPreset = async (apiFetch, domain, preset) => {
  const data = await apiFetch('/domain-config', { method: 'POST', body: { domain, section: 'sensitivity', preset, dry_run: true } });
  const changed = [data?.changed, data?.results?.changed, data?.state?.changed].find(isObject);
  if (!changed) return null;
  return Object.entries(changed).filter(([, pair]) => Array.isArray(pair)).map(([key, [from, to]]) => ({ key, from, to }));
};

// [{ version_id, updated_by, created_at, … }], newest first as sent.
export const fetchDomainHistory = async (apiFetch, domain, section) => {
  const data = await apiFetch(`/domain-config/history?domain=${encodeURIComponent(domain)}&section=${section}&limit=50`, { suppressForbiddenHandler: true });
  return [data?.results, data?.results?.items, data?.results?.history, data?.history, data?.items].find(Array.isArray)?.filter(isObject) || [];
};

/* ── Thresholds and score lineage (their own routes) ──────────────────── */

// -> { config, versionId, keys: { key: { type, min, max, default } } | null,
//      closed (no other key is accepted) | null, updatedBy, updatedAt } | null
export const readThresholdAnswer = (data) => {
  const body = bodyOf(data, 'config');
  if (!body || !isObject(body.config)) return null;
  const outside = (key) => body[key] ?? data?.[key] ?? data?.results?.[key];
  const keys = outside('keys');
  const closed = outside('closed');
  return {
    config: body.config,
    versionId: [body, data, data?.results].find((item) => isObject(item) && 'version_id' in item)?.version_id,
    keys: isObject(keys) ? Object.fromEntries(Object.entries(keys).filter(([, meta]) => isObject(meta))) : null,
    closed: typeof closed === 'boolean' ? closed : null,
    updatedBy: String(body.updated_by || '').slice(0, 120),
    updatedAt: body.updated_at || '',
  };
};
