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
