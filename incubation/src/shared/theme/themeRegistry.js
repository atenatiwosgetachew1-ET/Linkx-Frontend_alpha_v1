/**
 * Theme registry — single source of truth for available themes.
 * Each entry must have a matching src/styles/themes/<id>.css that defines
 * every semantic token (verified by `npm run theme:check`).
 */
export const DEFAULT_THEME_ID = 'nbe-daylight';

export const THEMES = [
  { id: 'nbe-daylight', name: 'NBE Daylight', colorScheme: 'light', description: 'Official National Bank of Ethiopia palette (navy #131E2A / gold #AE874F / ice #E8EFF7)', previewColor: '#AE874F' },
  { id: 'dark', name: 'Deep Space', colorScheme: 'dark', description: 'Classic dark sci-fi HUD with cyan accents (#131e2a)', previewColor: '#1c98a5' },
  { id: 'emerald-dark', name: 'Emerald Dark', colorScheme: 'dark', description: 'Deep forest dark slate with emerald accents (#0a1c17)', previewColor: '#10b981' },
  { id: 'cyberpunk', name: 'Cyberpunk Neon', colorScheme: 'dark', description: 'Neon dark violet with magenta accents (#0b071a)', previewColor: '#ff007f' },
  { id: 'solarized-dark', name: 'Solarized Dark', colorScheme: 'dark', description: 'Deep solarized teal with amber accents (#002b36)', previewColor: '#b58900' },
  { id: 'light-clean', name: 'Daylight Clean', colorScheme: 'light', description: 'Bright slate layout with crisp teal accents (#f4f7fa)', previewColor: '#0d9488' },
  { id: 'solarized-light', name: 'Solarized Light', colorScheme: 'light', description: 'Warm solarized cream with blue & amber accents (#fdf6e3)', previewColor: '#268bd2' },
  { id: 'nbe-darknight', name: 'NBE Darknight', colorScheme: 'dark', description: 'Midnight enterprise dark layout with sky blue & gold accents (#0f172a)', previewColor: '#38bdf8' },
];

export const isKnownTheme = (id) => THEMES.some((t) => t.id === id);

export const THEME_STORAGE_KEY = 'linkx_theme_mode';
/** Per-theme overrides: { [themeId]: { '--var': 'value' } } */
export const OVERRIDES_STORAGE_KEY = 'linkx_theme_overrides_by_theme';
/** Legacy flat overrides (pre per-theme). Read once for migration, never written. */
export const LEGACY_OVERRIDES_STORAGE_KEY = 'linkx_theme_custom_overrides';

export function readStoredOverrides(fallbackThemeId) {
  try {
    const stored = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    if (stored) return JSON.parse(stored) || {};
    const legacy = JSON.parse(localStorage.getItem(LEGACY_OVERRIDES_STORAGE_KEY) || 'null');
    if (legacy && typeof legacy === 'object' && Object.keys(legacy).length > 0) {
      return { [fallbackThemeId]: legacy };
    }
  } catch {
    // Corrupt storage: start clean.
  }
  return {};
}
