import { formatPropertyValue } from './graphFormat.js';
import { createDomainStore } from './domainStore.js';

// Actor profile (analyst decision 2026-11-16; not in production): clicking a
// node shows who it stands for, a portrait beside the person's details.
//
// Configured per domain in Configuration ▸ Rules ▸ Profile mapping fields
// (analyst decision 2026-11-16), saved with the domain's configuration as
// `actor_profile` (CONFIG_PROFILE_KEY; backend request B-23), so every graph
// of a domain shows the same card: whether a click shows it, which node
// property holds the portrait (an image link), and for each field whether it
// shows and which node property fills it.
//
// Until the backend keeps `actor_profile`, a successful save also keeps a
// copy on the device (PROFILE_PREFS_KEY, { [domain]: settings }); the
// configuration's own value wins whenever it has one. A field without a property, or a node
// without that property, shows "—"; without a portrait a placeholder shows
// (no picture is made up).
export const PROFILE_FIELDS = Object.freeze([
  { key: 'fullName', label: 'Full name' },
  { key: 'idNumber', label: 'ID' },
  { key: 'accountNumber', label: 'Acc No.' },
  { key: 'phone', label: 'Tel' },
  { key: 'address', label: 'Address' },
]);

export const DEFAULT_PROFILE_SETTINGS = Object.freeze({
  enabled: true,
  portraitKey: '',
  fields: Object.freeze(PROFILE_FIELDS.map((field) => Object.freeze({ key: field.key, source: '', shown: true }))),
});

const text = (value, maxLength = 120) => (typeof value === 'string' ? value.trim().slice(0, maxLength) : '');

// Any partial / untrusted value -> complete profile settings (the fields
// always the known ones, in their order).
export const normalizeProfileSettings = (input = {}) => {
  const given = Array.isArray(input?.fields) ? input.fields : [];
  return {
    enabled: input?.enabled === undefined ? DEFAULT_PROFILE_SETTINGS.enabled : input.enabled === true || input.enabled === 'true',
    portraitKey: text(input?.portraitKey),
    fields: PROFILE_FIELDS.map((field) => {
      // (idNumber was named faydaId before 2026-11-16; kept readable.)
      const found = given.find((entry) => entry?.key === field.key || (field.key === 'idNumber' && entry?.key === 'faydaId')) || {};
      return { key: field.key, source: text(found.source), shown: found.shown === undefined ? true : found.shown === true || found.shown === 'true' };
    }),
  };
};

const hasValue = (value) => value !== undefined && value !== null && String(value).trim() !== '';
// Only web links and embedded images are drawn as the portrait.
const imageSource = (value) => {
  const source = typeof value === 'string' ? value.trim() : '';
  return /^(https?:\/\/|data:image\/)/i.test(source) ? source : '';
};

// -> { portrait, fields: [{ key, label, value }] } for a node (value '' when
// unknown; portrait '' when there is none).
export const profileOf = (node, settings = DEFAULT_PROFILE_SETTINGS, { isCdr = false } = {}) => {
  const profile = normalizeProfileSettings(settings);
  return {
    portrait: profile.portraitKey ? imageSource(node?.[profile.portraitKey]) : '',
    fields: profile.fields
      .filter((field) => field.shown)
      .map((field) => {
        const value = field.source ? node?.[field.source] : undefined;
        return {
          key: field.key,
          label: PROFILE_FIELDS.find((entry) => entry.key === field.key).label,
          value: hasValue(value) ? formatPropertyValue(field.source, value, isCdr) : '',
        };
      }),
  };
};

/* ── In the configuration (snake_case, as the backend keeps it) ───────
   actor_profile: { enabled, portrait_property,
                    fields: [{ field, property, shown }] } */

export const CONFIG_PROFILE_KEY = 'actor_profile';

export const profileFromConfiguration = (value) => {
  if (!value || typeof value !== 'object') return normalizeProfileSettings(null);
  return normalizeProfileSettings({
    enabled: value.enabled,
    portraitKey: value.portrait_property,
    fields: Array.isArray(value.fields) ? value.fields.map((entry) => ({ key: entry?.field, source: entry?.property, shown: entry?.shown })) : [],
  });
};

export const profileToConfiguration = (settings) => {
  const profile = normalizeProfileSettings(settings);
  return {
    enabled: profile.enabled,
    portrait_property: profile.portraitKey,
    fields: profile.fields.map((field) => ({ field: field.key, property: field.source, shown: field.shown })),
  };
};

// The domain's profile settings: the configuration's, else the domain's own.
export const resolveProfileSettings = (configuration, domain) => (
  configuration?.[CONFIG_PROFILE_KEY] && typeof configuration[CONFIG_PROFILE_KEY] === 'object'
    ? profileFromConfiguration(configuration[CONFIG_PROFILE_KEY])
    : getProfileSettings(domain)
);

/* ── Per domain ─────────────────────────────────────────────────────── */

export const PROFILE_PREFS_KEY = 'linkx_actor_profile_v1';
const deviceProfiles = createDomainStore(PROFILE_PREFS_KEY, normalizeProfileSettings);
export const getProfileSettings = deviceProfiles.get;
export const setProfileSettings = deviceProfiles.set;
export const adoptProfileSettings = deviceProfiles.adopt;
export const subscribeProfileSettings = deviceProfiles.subscribe;
export const resetProfileSettingsCache = deviceProfiles.reset;
