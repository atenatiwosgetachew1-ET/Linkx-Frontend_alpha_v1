/**
 * Theme resolver.
 *
 * Reads `VITE_THEME` at build-time and exports the matching theme object.
 * Falls back to `nbe` (the original look) when the variable is absent or
 * doesn't match any registered theme.
 *
 * Usage:
 *   import theme from './themes';
 *   console.log(theme.name);   // "Linkx"
 *   console.log(theme.id);     // "nbe" | "cdr"
 */
import nbe from "./nbe.js";
import cdr from "./cdr.js";

const themes = { nbe, cdr };

const activeThemeId = (import.meta.env.VITE_THEME || "nbe").trim().toLowerCase();

/** The resolved theme object for this build. */
export const theme = themes[activeThemeId] || nbe;

export default theme;
