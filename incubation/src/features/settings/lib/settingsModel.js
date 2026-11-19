

/* ── Color ↔ RGBA helpers ────────────────────────────────── */
export function parseColorToHexAlpha(value) {
  const str = (value || '').trim();
  // rgba(r, g, b, a)
  const rgbaMatch = str.match(/^rgba?\(\s*([\d.]+)[,%\s]+([\d.]+)[,%\s]+([\d.]+)(?:[,/\s]+([\d.]+))?\s*\)$/i);
  if (rgbaMatch) {
    const r = Math.round(parseFloat(rgbaMatch[1]));
    const g = Math.round(parseFloat(rgbaMatch[2]));
    const b = Math.round(parseFloat(rgbaMatch[3]));
    const a = rgbaMatch[4] !== undefined ? parseFloat(rgbaMatch[4]) : 1;
    const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
    return { hex, alpha: Math.min(1, Math.max(0, a)) };
  }
  // #rrggbb or #rgb
  const hexMatch = str.match(/^#([0-9a-f]{3,8})$/i);
  if (hexMatch) {
    let h = hexMatch[1];
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    if (h.length === 8) {
      const a = parseInt(h.slice(6, 8), 16) / 255;
      return { hex: '#' + h.slice(0, 6), alpha: Math.round(a * 100) / 100 };
    }
    return { hex: '#' + h.slice(0, 6), alpha: 1 };
  }
  return { hex: '#000000', alpha: 1 };
}

export function hexAlphaToOutput(hex, alpha) {
  if (alpha >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const SESSION_STORAGE_KEY = 'session';

export const SETTINGS_STORAGE_KEYS = {
  rememberLayout: 'linkx_settings_remember_layout',
  enableNotifications: 'linkx_settings_enable_notifications',
};

// Permission catalog lives in auth/permissions.js (single source).
export { ALL_PERMISSIONS as allPermissions, USER_PERMISSION_DISPLAY_GROUPS as userPermissionDisplayGroups } from '../../../auth/permissions.js';

export const settingsTabs = [
  { id: 'profile', label: 'Profile' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'vigilance', label: 'Linkx Vigilance' },
  { id: 'users', label: 'Users', permission: 'users:manage' },
  { id: 'service_accounts', label: 'Service Accounts', permission: 'users:manage' },
  { id: 'integration', label: 'Integration' },
];

export const settingsTabDescriptions = {
  profile: 'Review identity, access, and current session details.',
  preferences: 'Adjust local workspace behavior and visual motion.',
  vigilance: 'xVigilance engine health, audit runs and findings.',
  users: 'Manage analyst accounts, roles, and permissions.',
  service_accounts: 'Control service clients and generated secrets.',
  integration: 'Keep the interface and Service contract notes in view.',
};

export const normalizeAdminUserList = (data) => {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.users) ? data.users : Array.isArray(data?.data) ? data.data : [];
  return raw.map((item) => ({
    ...item,
    id: item.id ?? item.username,
    username: item.username || '',
    display_name: item.display_name || item.name || item.username || '',
    roles: Array.isArray(item.roles) ? item.roles : [],
    permissions: Array.isArray(item.permissions) ? item.permissions : [],
    is_active: item.is_active !== false,
  }));
};

// Editable copy of a user, always built from the server record.
export const userDraftFrom = (user) => ({
  display_name: user.display_name || '',
  password: '',
  roles: Array.isArray(user.roles) ? [...user.roles] : [],
  permissions: Array.isArray(user.permissions) ? [...user.permissions] : [],
  is_active: user.is_active !== false,
});

export const sameList = (a = [], b = []) => a.length === b.length && [...a].sort().every((item, index) => item === [...b].sort()[index]);

export const isUserDraftModified = (user, draft) => Boolean(draft) && (
  (draft.display_name ?? '') !== (user.display_name || '') ||
  Boolean(draft.password) ||
  !sameList(draft.roles, user.roles || []) ||
  !sameList(draft.permissions, user.permissions || []) ||
  Boolean(draft.is_active) !== (user.is_active !== false)
);
