/**
 * IconResolver — resolves node icon paths to renderable image URLs.
 *
 * Handles:
 * - Bundled icons (from iconManifest)
 * - External icon URLs (passthrough)
 * - Data URIs (passthrough)
 * - Custom iconBasePath resolution
 */
import ICONS from './iconManifest.js';

/**
 * Known icon path patterns from the graph engine.
 * e.g. "../graph_icons/Person.svg" → "Person"
 */
const ICON_PATH_RE = /(?:\.\.\/)?graph_icons\/(.+?)\.svg$/i;

/**
 * Resolves an icon path to a usable image URL.
 *
 * @param {string} iconPath - The icon path from the node data
 * @param {string} [iconBasePath] - Optional base URL for custom icon hosting
 * @returns {string} Resolved image URL (data URI, external URL, or bundled icon)
 */
export function resolveIcon(iconPath, iconBasePath) {
  if (!iconPath || typeof iconPath !== 'string') return '';

  const trimmed = iconPath.trim();

  // Already a data URI — passthrough
  if (trimmed.startsWith('data:')) return trimmed;

  // Already an absolute URL — passthrough
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  // Try to extract icon name from path pattern
  const match = trimmed.match(ICON_PATH_RE);
  if (match) {
    const iconName = match[1];

    // Check bundled icons first
    if (ICONS[iconName]) return ICONS[iconName];

    // Fall back to custom base path
    if (iconBasePath) {
      const base = iconBasePath.replace(/\/$/, '');
      return `${base}/${iconName}.svg`;
    }
  }

  // Try direct name match (e.g., just "Person" or "Person.svg")
  const directName = trimmed.replace(/\.svg$/i, '');
  if (ICONS[directName]) return ICONS[directName];

  // If custom base path is set, try constructing URL
  if (iconBasePath) {
    const base = iconBasePath.replace(/\/$/, '');
    return `${base}/${trimmed}`;
  }

  // Last resort — return as-is
  return trimmed;
}

/**
 * Checks if a given path points to a bundled icon.
 *
 * @param {string} iconPath
 * @returns {boolean}
 */
export function isBundledIcon(iconPath) {
  if (!iconPath) return false;
  const match = iconPath.trim().match(ICON_PATH_RE);
  if (match) return !!ICONS[match[1]];
  const directName = iconPath.trim().replace(/\.svg$/i, '');
  return !!ICONS[directName];
}

/**
 * Returns all available bundled icon names.
 *
 * @returns {string[]}
 */
export function getBundledIconNames() {
  return Object.keys(ICONS);
}

export default { resolveIcon, isBundledIcon, getBundledIconNames };
