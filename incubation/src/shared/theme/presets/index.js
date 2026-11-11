// Auto-loads every committed theme preset in this folder.
//
// Drop a `*.json` file here (see README.md for the format) and it becomes a
// selectable, version-controlled preset in the Theme Studio. Because these live
// in the repo, they survive any browser, machine, or dev-server port — unlike
// localStorage-only overrides.

const presetModules = import.meta.glob('./*.json', { eager: true });

const normalizePreset = (path, raw = {}) => {
  const data = raw.default || raw;
  const fallbackId = path.split('/').pop().replace(/\.json$/i, '');
  return {
    id: String(data.id || fallbackId),
    name: String(data.name || data.id || fallbackId),
    description: String(data.description || ''),
    baseTheme: data.baseTheme || data.theme || null,
    overrides: data.overrides || data.customOverrides || {},
  };
};

export const THEME_PRESETS = Object.entries(presetModules)
  .map(([path, raw]) => normalizePreset(path, raw))
  .sort((a, b) => a.name.localeCompare(b.name));
