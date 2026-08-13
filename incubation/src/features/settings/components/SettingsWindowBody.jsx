import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '../../../auth/useAuth.js';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { appConfig } from '../../../app/config.js';
import { authRequest } from '../../../services/authApi.js';
import { useBackgroundAnimations } from '../../../utils/backgroundAnimations.js';
import {
  compactValidationErrors,
  sanitizeIdentifier,
  sanitizePermissionList,
  sanitizeSecret,
  sanitizeText,
  validateClientSecret,
  validateDisplayName,
  validateNewPassword,
  validateRequiredIdentifier,
} from '../../../utils/inputSecurity.js';
import { useNotifications } from '../../../shared/notifications/useNotifications.js';
import { useTheme } from '../../../shared/theme/ThemeContext.jsx';

/* ── Color ↔ RGBA helpers ────────────────────────────────── */
function parseColorToHexAlpha(value) {
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

function hexAlphaToOutput(hex, alpha) {
  if (alpha >= 1) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function ColorAlphaPicker({ value, onChange }) {
  const parsed = parseColorToHexAlpha(value);
  const [hex, setHex] = React.useState(parsed.hex);
  const [alpha, setAlpha] = React.useState(parsed.alpha);
  const [rawText, setRawText] = React.useState(value);

  // Sync from parent when value changes externally
  React.useEffect(() => {
    const p = parseColorToHexAlpha(value);
    setHex(p.hex);
    setAlpha(p.alpha);
    setRawText(value);
  }, [value]);

  const emitChange = (newHex, newAlpha) => {
    const out = hexAlphaToOutput(newHex, newAlpha);
    setRawText(out);
    onChange(out);
  };

  return (
    <div className="theme_studio_color_alpha">
      <div
        className="theme_studio_swatch_preview"
        style={{ background: (rawText && rawText.includes('gradient')) ? rawText : hexAlphaToOutput(hex, alpha) }}
      />
      <input
        type="color"
        className="theme_studio_color_swatch"
        value={hex}
        onChange={(e) => { setHex(e.target.value); emitChange(e.target.value, alpha); }}
      />
      <div className="theme_studio_alpha_wrap">
        <label className="theme_studio_alpha_label">α</label>
        <input
          type="range"
          className="theme_studio_range_slider"
          min="0"
          max="1"
          step="0.01"
          value={alpha}
          onChange={(e) => { const a = parseFloat(e.target.value); setAlpha(a); emitChange(hex, a); }}
        />
        <span className="theme_studio_alpha_value">{Math.round(alpha * 100)}%</span>
      </div>
      <input
        type="text"
        className="settings_input theme_studio_hex_input"
        value={rawText}
        onChange={(e) => { setRawText(e.target.value); onChange(e.target.value); }}
        placeholder="#hex, rgba(...), or linear-gradient(...)"
      />
    </div>
  );
}

const SESSION_STORAGE_KEY = 'session';
const SETTINGS_STORAGE_KEYS = {
  rememberLayout: 'linkx_settings_remember_layout',
  enableNotifications: 'linkx_settings_enable_notifications',
};

const permissionGroups = [
  { label: 'Session', items: ['session:create', 'session:read'] },
  { label: 'Configuration', items: ['config:read', 'config:write'] },
  { label: 'Source', items: ['source:create', 'source:connect', 'source:disconnect'] },
  { label: 'Graph', items: ['graph:create', 'graph:read', 'graph:link'] },
  { label: 'Batch', items: ['batch:upload', 'batch:query'] },
  { label: 'Analysis', items: ['analysis:run'] },
  { label: 'Reports', items: ['reports:read'] },
  { label: 'Admin', items: ['users:manage'] },
  { label: 'Auth', items: ['auth:verify'] },
];
const allPermissions = permissionGroups.flatMap((group) => group.items);
const userPermissionDisplayGroups = [
  { label: 'Session', items: ['session:create', 'session:read'] },
  { label: 'Configuration', items: ['config:read', 'config:write'] },
  { label: 'Source', items: ['source:create', 'source:connect', 'source:disconnect'] },
  { label: 'Data & Analysis', items: ['batch:upload', 'batch:query', 'analysis:run'] },
  { label: 'Graph', items: ['graph:create', 'graph:read', 'graph:link'] },
  { label: 'Reports', items: ['reports:read'] },
  { label: 'Users', items: ['users:manage', 'auth:verify'] },
];

const settingsTabs = [
  { id: 'profile', label: 'Profile' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'users', label: 'Users', permission: 'users:manage' },
  { id: 'service_accounts', label: 'Service Accounts', permission: 'users:manage' },
  { id: 'integration', label: 'Integration' },
];

const settingsTabDescriptions = {
  profile: 'Review identity, access, and current session details.',
  preferences: 'Adjust local workspace behavior and visual motion.',
  users: 'Manage analyst accounts, roles, and permissions.',
  service_accounts: 'Control service clients and generated secrets.',
  integration: 'Keep frontend and backend contract notes in view.',
};

const makeApiFetch = (token) => async (targetPath, options = {}) => authRequest(appConfig.apiUrl, targetPath, {
  method: options.method || 'GET',
  headers: {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    Authorization: 'Bearer ' + token,
    ...(options.headers || {}),
  },
  body: options.body ? JSON.stringify(options.body) : undefined,
});

const normalizeAdminUserList = (data) => {
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

const normalizeServiceAccountList = (data) => {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.results) ? data.results : Array.isArray(data?.service_accounts) ? data.service_accounts : Array.isArray(data?.data) ? data.data : [];
  return raw.map((account) => ({
    ...account,
    id: account.id ?? account.client_id,
    client_id: account.client_id || account.username || '',
    display_name: account.display_name || account.name || account.client_id || '',
    is_active: account.is_active !== false,
    permissions: Array.isArray(account.permissions) ? account.permissions : [],
  }));
};

const extractServiceSecret = (data) => (
  data?.client_secret ||
  data?.secret ||
  data?.results?.client_secret ||
  data?.results?.secret ||
  data?.service_account?.client_secret ||
  data?.service_account?.secret ||
  ''
);

const generateClientSecret = () => {
  const bytes = new Uint8Array(24);
  window.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

function PermissionEditor({ value = [], onChange, idPrefix = 'permissions' }) {
  const selected = new Set(Array.isArray(value) ? value : []);
  const togglePermission = (permission) => {
    const next = new Set(selected);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    onChange(sanitizePermissionList(Array.from(next).sort()));
  };

  return (
    <div className="settings_permission_grid">
      {permissionGroups.map((group) => (
        <fieldset className="settings_permission_group" key={group.label}>
          <legend>{group.label}</legend>
          <div className="settings_permission_list">
            {group.items.map((permission) => {
              const inputId = idPrefix + '_' + permission.replace(/[^a-z0-9]/gi, '_');
              return (
                <label className="settings_permission_option" htmlFor={inputId} key={permission}>
                  <input
                    id={inputId}
                    type="checkbox"
                    checked={selected.has(permission)}
                    onChange={() => togglePermission(permission)}
                  />
                  <span>{permission}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function ServiceSecretNotice({ secret, onClear }) {
  if (!secret) return null;

  return (
    <div className="settings_secret_notice">
      <div>
        <strong>New client secret</strong>
        <p>Copy it now. It will not be shown again.</p>
      </div>
      <code>{secret}</code>
      <button type="button" onClick={() => navigator.clipboard?.writeText(secret)}>Copy</button>
      <button type="button" onClick={onClear}>Dismiss</button>
    </div>
  );
}

function ProfilePanel({ actor, token, sessionId, roles = [], permissions = [] }) {
  const actorType = actor?.actor_type || (actor?.client_id ? 'service' : 'user');
  const actorName = actorType === 'service' ? actor?.client_id : actor?.username;
  const displayName = actor?.display_name || actorName || 'unknown';
  const currentSession = sessionId || localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY) || 'not initialized';
  const email = actor?.email || actor?.mail || '';
  const locale = actor?.locale || actor?.language || actor?.preferred_language || '';
  const timeZone = actor?.time_zone || actor?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const status = actor?.is_active === false ? 'Inactive' : actor?.is_locked ? 'Locked' : 'Active';
  const avatarSeed = String(displayName || actorName || 'A').trim();
  const avatarText = avatarSeed ? avatarSeed.charAt(0).toUpperCase() : 'A';
  const summaryPermissions = Array.isArray(permissions) ? permissions.slice(0, 6) : [];

  return (
    <section className="settings_section settings_profile_section">
      <div className="settings_section_header">
        <div>
          <h3>Current actor</h3>
          <p>Identity, access, and session details for the signed-in workspace.</p>
        </div>
      </div>
      <div className="settings_profile_overview">
        <div className="settings_profile_identity_card">
          <div className="settings_profile_avatar" aria-hidden="true">{avatarText}</div>
          <div className="settings_profile_identity_text">
            <strong>{displayName}</strong>
            <span>{actorName || 'unknown account'}</span>
            <div className="settings_profile_meta_chips">
              <i>{actorType || 'unknown'}</i>
              <i>{status}</i>
              <i>{token ? 'Authenticated' : 'No token'}</i>
            </div>
          </div>
        </div>
        <div className="settings_identity_grid settings_profile_identity_grid">
          <span>Display name</span><b>{displayName}</b>
          <span>Username / Client ID</span><b>{actorName || 'unknown'}</b>
          <span>Account type</span><b>{actorType || 'unknown'}</b>
          <span>Account status</span><b>{status}</b>
          <span>Email</span><b>{email || 'Not provided'}</b>
          <span>Locale</span><b>{locale || 'Not provided'}</b>
          <span>Time zone</span><b>{timeZone || 'Not provided'}</b>
          <span>Linkx session</span><b>{currentSession}</b>
        </div>
      </div>
      <div className="settings_profile_access_grid">
        <div className="settings_subsection settings_profile_panel">
          <h4>Roles</h4>
          <p className="settings_hint">Assigned access groups for this actor.</p>
          <div className="settings_token_list">
            {(roles.length ? roles : ['none']).map((role) => <span key={role}>{role}</span>)}
          </div>
        </div>
        <div className="settings_subsection settings_profile_panel">
          <h4>Permissions</h4>
          <p className="settings_hint">A compact summary of currently granted privileges.</p>
          <div className="settings_token_list">
            {(summaryPermissions.length ? summaryPermissions : ['none']).map((permission) => <span key={permission}>{permission}</span>)}
            {permissions.length > summaryPermissions.length ? <span>+{permissions.length - summaryPermissions.length} more</span> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function PreferencesPanel({ areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled }) {
  const [rememberLayout, setRememberLayout] = useState(() => localStorage.getItem(SETTINGS_STORAGE_KEYS.rememberLayout) !== 'false');
  const [enableNotifications, setEnableNotifications] = useState(() => localStorage.getItem(SETTINGS_STORAGE_KEYS.enableNotifications) !== 'false');

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.rememberLayout, String(rememberLayout));
  }, [rememberLayout]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEYS.enableNotifications, String(enableNotifications));
  }, [enableNotifications]);

  return (
    <section className="settings_section">
      <div className="settings_section_header">
        <div>
          <h3>Preferences</h3>
          <p>Local workspace behavior and visual preferences.</p>
        </div>
      </div>
      <div className="settings_toggle_list">
        <label className="settings_toggle_row">
          <input type="checkbox" checked={rememberLayout} onChange={(event) => setRememberLayout(event.target.checked)} />
          <span>Remember window layout</span>
        </label>
        <label className="settings_toggle_row">
          <input type="checkbox" checked={enableNotifications} onChange={(event) => setEnableNotifications(event.target.checked)} />
          <span>Enable notifications</span>
        </label>
        <label className="settings_toggle_row">
          <input type="checkbox" checked={areBackgroundAnimationsEnabled} onChange={(event) => setBackgroundAnimationsEnabled(event.target.checked)} />
          <span>Enable background animations</span>
        </label>
      </div>

      <LiveThemeCustomizerStudio />
    </section>
  );
}

function LiveThemeCustomizerStudio() {
  const { theme, setTheme, themes, categories, customOverrides, setCustomVariable, resetCustomOverrides, exportThemeConfig, importThemeConfig, inspectorActive, toggleInspector } = useTheme();
  const [selectedCategoryId, setSelectedCategoryId] = useState(categories[0]?.id || 'shell');
  const [searchQuery, setSearchQuery] = useState('');
  const [importJson, setImportJson] = useState('');
  const [copyNotice, setCopyNotice] = useState('');

  const selectedCategory = useMemo(
    () => categories.find((cat) => cat.id === selectedCategoryId) || categories[0],
    [categories, selectedCategoryId]
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();

  // Match counts per category when searching
  const categoryMatchCounts = useMemo(() => {
    if (!normalizedQuery) return {};
    const counts = {};
    categories.forEach((cat) => {
      const matchingTokens = cat.tokens.filter(
        (t) =>
          t.label.toLowerCase().includes(normalizedQuery) ||
          t.key.toLowerCase().includes(normalizedQuery)
      );
      counts[cat.id] = matchingTokens.length;
    });
    return counts;
  }, [categories, normalizedQuery]);

  // Auto-switch to first category with matching items if current category has 0 matches
  useEffect(() => {
    if (!normalizedQuery) return;
    const currentCount = categoryMatchCounts[selectedCategoryId] || 0;
    if (currentCount === 0) {
      const firstMatchingCat = categories.find((cat) => (categoryMatchCounts[cat.id] || 0) > 0);
      if (firstMatchingCat) {
        setSelectedCategoryId(firstMatchingCat.id);
      }
    }
  }, [normalizedQuery, categoryMatchCounts, selectedCategoryId, categories]);

  // Filter visible tokens within selected category
  const visibleTokens = useMemo(() => {
    if (!selectedCategory) return [];
    if (!normalizedQuery) return selectedCategory.tokens;
    return selectedCategory.tokens.filter(
      (t) =>
        t.label.toLowerCase().includes(normalizedQuery) ||
        t.key.toLowerCase().includes(normalizedQuery)
    );
  }, [selectedCategory, normalizedQuery]);

  const getEffectiveValue = (token) => {
    if (customOverrides[token.key]) return customOverrides[token.key];
    if (typeof window !== 'undefined') {
      const computed = getComputedStyle(document.documentElement).getPropertyValue(token.key).trim();
      if (computed && (computed.startsWith('#') || computed.startsWith('rgb'))) return computed;
    }
    return token.default || '#000000';
  };

  const handleColorChange = (key, hexColor) => {
    setCustomVariable(key, hexColor);
  };

  const handleExport = () => {
    const json = exportThemeConfig();
    navigator.clipboard?.writeText(json);
    setCopyNotice('Theme JSON configuration copied to clipboard!');
    setTimeout(() => setCopyNotice(''), 3500);
  };

  const handleImport = () => {
    if (!importJson.trim()) return;
    const success = importThemeConfig(importJson);
    if (success) {
      setImportJson('');
      setCopyNotice('Custom theme imported successfully!');
      setTimeout(() => setCopyNotice(''), 3500);
    } else {
      setCopyNotice('Failed to import JSON configuration.');
      setTimeout(() => setCopyNotice(''), 3500);
    }
  };

  return (
    <div className="theme_studio_container">
      <div className="theme_studio_header">
        <div>
          <h4>🎨 Live Theme Studio & Component Customizer</h4>
          <p>Select any component category below to adjust its live colors, backgrounds, and borders in real-time.</p>
        </div>
        <div className="theme_studio_actions">
          <button type="button" className={`workspace_button ${inspectorActive ? 'workspace_button_primary' : 'workspace_button_secondary'}`} onClick={toggleInspector}>
            🔍 {inspectorActive ? 'Picker Active' : 'Element Picker'}
          </button>
          <button type="button" className="workspace_button workspace_button_secondary" onClick={handleExport}>
            📥 Export Config
          </button>
          <button type="button" className="workspace_button workspace_button_secondary" onClick={resetCustomOverrides}>
            🔄 Reset Overrides
          </button>
        </div>
      </div>

      {copyNotice && <div className="theme_studio_notice">{copyNotice}</div>}

      {/* Base Theme Preset Selection */}
      <div className="theme_studio_base_row">
        <label className="settings_label">Active Theme Preset Base:</label>
        <div className="theme_studio_preset_pills">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`theme_studio_pill ${theme === t.id ? 'is-active' : ''}`}
              onClick={() => setTheme(t.id)}
            >
              <span className="theme_studio_pill_dot" style={{ backgroundColor: t.previewColor }} />
              <span>{t.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Customization Items Search Box */}
      <div className="theme_studio_search_row">
        <div className="theme_studio_search_input_wrapper">
          <span className="theme_studio_search_icon">🔍</span>
          <input
            type="text"
            className="settings_input theme_studio_search_input"
            placeholder="Search customization items (e.g. Session, Gradient, Opacity, Card, Text, Border)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="theme_studio_search_clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="theme_studio_category_tabs">
        {categories.map((cat) => {
          const matchCount = categoryMatchCounts[cat.id];
          return (
            <button
              key={cat.id}
              type="button"
              className={`theme_studio_cat_btn ${selectedCategoryId === cat.id ? 'is-active' : ''}`}
              onClick={() => setSelectedCategoryId(cat.id)}
            >
              <span>{cat.name}</span>
              {normalizedQuery && matchCount > 0 && (
                <span className="theme_studio_cat_badge">{matchCount}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected Category Token Editor */}
      {selectedCategory && (
        <div className="theme_studio_token_card">
          <div className="theme_studio_card_info">
            <h5>{selectedCategory.name}</h5>
            <p>{selectedCategory.description}</p>
          </div>

          {visibleTokens.length === 0 ? (
            <div className="theme_studio_empty_search">
              <p>No customization items matching "<strong>{searchQuery}</strong>" in <em>{selectedCategory.name}</em>.</p>
              {Object.values(categoryMatchCounts).some((count) => count > 0) && (
                <p className="theme_studio_search_hint">
                  💡 Try switching category tabs above to view matching results in other categories.
                </p>
              )}
            </div>
          ) : (
            <div className="theme_studio_token_grid">
              {visibleTokens.map((token) => {
                const currentValue = getEffectiveValue(token);
                const isOverridden = Boolean(customOverrides[token.key]);

                return (
                  <div key={token.key} className={`theme_studio_token_row ${isOverridden ? 'is-overridden' : ''}`}>
                    <div className="theme_studio_token_label">
                      <strong>{token.label}</strong>
                      <code>{token.key}</code>
                    </div>

                    <div className="theme_studio_token_controls">
                      {token.type === 'range' ? (
                        <>
                          <input
                            type="range"
                            className="theme_studio_range_slider"
                            min="0"
                            max="1"
                            step="0.01"
                            value={parseFloat(currentValue) || 0}
                            onChange={(e) => handleColorChange(token.key, e.target.value)}
                          />
                          <input
                            type="text"
                            className="settings_input theme_studio_hex_input"
                            value={currentValue}
                            onChange={(e) => handleColorChange(token.key, e.target.value)}
                            placeholder="0.0 — 1.0"
                            style={{ maxWidth: 64 }}
                          />
                        </>
                      ) : token.type === 'text' ? (
                        <input
                          type="text"
                          className="settings_input theme_studio_hex_input"
                          value={currentValue}
                          onChange={(e) => handleColorChange(token.key, e.target.value)}
                          placeholder={token.placeholder || 'e.g. 180deg, 45deg'}
                          style={{ minWidth: 120, flex: '1 1 120px' }}
                        />
                      ) : (
                        <ColorAlphaPicker
                          value={currentValue}
                          onChange={(val) => handleColorChange(token.key, val)}
                        />
                      )}
                      {isOverridden && (
                        <button
                          type="button"
                          className="theme_studio_reset_btn"
                          title="Reset token override"
                          onClick={() => handleColorChange(token.key, undefined)}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* JSON Import Section */}
      <div className="theme_studio_import_card">
        <h5>📥 Import Theme Configuration JSON</h5>
        <div className="theme_studio_import_row">
          <textarea
            className="settings_input theme_studio_json_area"
            rows={2}
            placeholder='Paste JSON configuration here... (e.g. {"theme": "nbe-daylight", "customOverrides": {"--app-bg": "#f6efea"}})'
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
          />
          <button type="button" className="workspace_button workspace_button_primary" onClick={handleImport}>
            Apply Import
          </button>
        </div>
      </div>
    </div>
  );
}

function UsersPanel({ apiFetch, canManageUsers, canManageSuperusers, currentActor, onNotice, refreshSignal, initialUiState = {}, onUiStateChange }) {
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState(() => initialUiState.draft || { username: '', password: '', display_name: '', roles: ['analyst'], is_active: true, permissions: [] });
  const [editDrafts, setEditDrafts] = useState(() => initialUiState.editDrafts || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(() => !!initialUiState.isCreateOpen);
  const [isExistingOpen, setIsExistingOpen] = useState(() => !!initialUiState.isExistingOpen);
  const [userSearchQuery, setUserSearchQuery] = useState(() => initialUiState.userSearchQuery || '');
  const [userStatusFilter, setUserStatusFilter] = useState(() => initialUiState.userStatusFilter || 'all');
  const [selectedUserId, setSelectedUserId] = useState(() => initialUiState.selectedUserId || '');
  const [expandedUserId, setExpandedUserId] = useState(() => initialUiState.expandedUserId || '');
  const lastPersistedUiRef = useRef('');
  const creatableRoles = useMemo(() => (canManageSuperusers ? ['superuser', 'analyst', 'viewer'] : ['analyst', 'viewer']), [canManageSuperusers]);
  const editableRoles = useMemo(() => {
    const discoveredRoles = users.flatMap((user) => (Array.isArray(user.roles) ? user.roles : []));
    return Array.from(new Set([...(canManageSuperusers ? ['superuser', 'admin', 'analyst', 'viewer'] : ['admin', 'analyst', 'viewer']), ...discoveredRoles])).filter(Boolean);
  }, [canManageSuperusers, users]);
  const currentActorUser = useMemo(() => {
    if (!currentActor?.username) return null;
    return {
      id: currentActor.id ?? currentActor.username,
      username: currentActor.username,
      display_name: currentActor.display_name || currentActor.name || currentActor.username,
      roles: Array.isArray(currentActor.roles) ? currentActor.roles : [],
      permissions: Array.isArray(currentActor.permissions) ? currentActor.permissions : [],
      is_active: currentActor.is_active !== false,
      is_locked: !!currentActor.is_locked,
    };
  }, [currentActor]);

  const loadUsers = useCallback(async () => {
    if (!canManageUsers) return;
    setError('');
    try {
      const data = await apiFetch('/auth/admin/users', { method: 'GET' });
      const normalized = normalizeAdminUserList(data);
      const mergedUsers = currentActorUser && !normalized.some((user) => String(user.username) === String(currentActorUser.username))
        ? [currentActorUser, ...normalized]
        : normalized;
      setUsers(mergedUsers);
      setEditDrafts((current) => Object.fromEntries(mergedUsers.map((user) => {
        const roles = Array.isArray(user.roles) && user.roles.length ? user.roles : [creatableRoles[0]];
        const currentDraft = current[String(user.id)] || {};
        return [String(user.id), {
          username: currentDraft.username || user.username || '',
          role: currentDraft.role || roles[0],
          permissions: Array.isArray(currentDraft.permissions) ? [...currentDraft.permissions] : (Array.isArray(user.permissions) ? [...user.permissions] : []),
          is_active: currentDraft.is_active ?? (user.is_active !== false),
        }];
      })));
    } catch (err) {
      setError(err?.message || 'Failed to load users.');
    }
  }, [apiFetch, canManageUsers, creatableRoles, currentActorUser]);

  useEffect(() => {
    if (canManageUsers) loadUsers();
  }, [canManageUsers, loadUsers, refreshSignal]);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      roles: current.roles.filter((role) => creatableRoles.includes(role)).length ? current.roles.filter((role) => creatableRoles.includes(role)) : [creatableRoles[0]],
    }));
  }, [creatableRoles]);

  const openCreateCard = () => {
    setIsCreateOpen((current) => {
      const next = !current;
      if (next) setIsExistingOpen(false);
      return next;
    });
  };

  const openExistingCard = () => {
    setIsExistingOpen((current) => {
      const next = !current;
      if (next) setIsCreateOpen(false);
      return next;
    });
  };

  const updateEditDraft = (userId, patch) => {
    setEditDrafts((current) => ({ ...current, [String(userId)]: { ...(current[String(userId)] || {}), ...patch } }));
  };

  const updateUserPermissions = (userId, updater) => {
    setEditDrafts((current) => {
      const key = String(userId);
      const currentPermissions = Array.isArray(current[key]?.permissions) ? current[key].permissions : [];
      return {
        ...current,
        [key]: {
          ...(current[key] || {}),
          permissions: sanitizePermissionList(updater(currentPermissions)),
        },
      };
    });
  };

  const toggleUserPermission = (userId, permission) => {
    updateUserPermissions(userId, (currentPermissions) => {
      const next = new Set(currentPermissions);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return Array.from(next);
    });
  };

  const toggleUserEditor = (user) => {
    const userId = String(user.id);
    const willExpand = expandedUserId !== userId;
    setSelectedUserId(userId);
    setExpandedUserId(willExpand ? userId : '');
  };

  const openResetPasswordMessage = (user) => {
    window.alert('Password reset for "' + user.username + '" is not connected yet.');
  };

  const createUser = async () => {
    const payload = {
      username: sanitizeIdentifier(draft.username, { maxLength: 120 }).trim(),
      password: sanitizeSecret(draft.password, { maxLength: 256 }),
      display_name: sanitizeText(draft.display_name, { maxLength: 120 }).trim(),
      roles: Array.from(new Set((draft.roles || []).filter((role) => creatableRoles.includes(role)))),
      permissions: sanitizePermissionList(draft.permissions),
      is_active: !!draft.is_active,
    };
    const validationError = compactValidationErrors(
      validateRequiredIdentifier(payload.username, 'Username', { minLength: 3, maxLength: 120 }),
      validateNewPassword(payload.password, { required: true }),
      validateDisplayName(payload.display_name),
      payload.roles.length ? '' : 'At least one allowed role is required.',
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/users', { method: 'POST', body: payload });
      setDraft({ username: '', password: '', display_name: '', roles: [creatableRoles[0]], is_active: true, permissions: [] });
      onNotice?.({ title: 'User created', message: payload.username + ' was created.', source: 'Admin', level: 'success' });
      await loadUsers();
    } catch (err) {
      setError(err?.message || 'Failed to create user.');
    } finally {
      setSaving(false);
    }
  };

  const filteredUsers = useMemo(() => {
    const query = userSearchQuery.trim().toLowerCase();
    return users.filter((user) => {
      const haystack = [
        user.username,
        user.display_name,
        ...(Array.isArray(user.roles) ? user.roles : []),
        ...(Array.isArray(user.permissions) ? user.permissions : []),
        user.is_active ? 'active' : 'inactive',
        user.is_locked ? 'locked' : '',
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesStatus = userStatusFilter === 'all'
        || (userStatusFilter === 'active' && user.is_active)
        || (userStatusFilter === 'inactive' && !user.is_active)
        || (userStatusFilter === 'locked' && !!user.is_locked);
      return matchesQuery && matchesStatus;
    });
  }, [userSearchQuery, userStatusFilter, users]);

  useEffect(() => {
    if (filteredUsers.length === 0) {
      setSelectedUserId('');
      setExpandedUserId('');
      return;
    }
    setSelectedUserId((current) => (filteredUsers.some((user) => String(user.id) === current) ? current : String(filteredUsers[0].id)));
    setExpandedUserId((current) => (filteredUsers.some((user) => String(user.id) === current) ? current : ''));
  }, [filteredUsers]);
  useEffect(() => {
    const nextUiState = {
      draft,
      editDrafts,
      isCreateOpen,
      isExistingOpen,
      userSearchQuery,
      userStatusFilter,
      selectedUserId,
      expandedUserId,
    };
    const serialized = JSON.stringify(nextUiState);
    if (!onUiStateChange || lastPersistedUiRef.current === serialized) return;
    lastPersistedUiRef.current = serialized;
    onUiStateChange(nextUiState);
  }, [draft, editDrafts, isCreateOpen, isExistingOpen, userSearchQuery, userStatusFilter, selectedUserId, expandedUserId, onUiStateChange]);


  if (!canManageUsers) {
    return (
      <section className="settings_section">
        <div className="settings_section_header">
          <div>
            <h3>Users</h3>
            <p>You need users:manage to open this tab.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="settings_section">
      <div className="settings_section_header">
        <div>
          <h3>Users</h3>
          <p>Manage application users and their permissions.</p>
        </div>
      </div>
      {error && <div className="settings_error">{error}</div>}
      <section className={'settings_subsection settings_collapsible_card' + (isCreateOpen ? ' is-open' : '')}>
        <button
          type="button"
          className="settings_collapsible_toggle"
          onClick={openCreateCard}
          aria-expanded={isCreateOpen}
        >
          <span className="settings_collapsible_heading">
            <strong>Create user</strong>
            <small>Create a new analyst account and assign access.</small>
          </span>
          <span className="settings_collapsible_indicator" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        {isCreateOpen ? (
          <div className="settings_collapsible_body">
            <div className="settings_form_grid">
              <label>
                Username
                <input className="settings_input" value={draft.username} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, username: sanitizeIdentifier(event.target.value, { maxLength: 120 }) }))} />
              </label>
              <label>
                Display name
                <input className="settings_input" value={draft.display_name} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, display_name: sanitizeText(event.target.value, { maxLength: 120 }) }))} />
              </label>
              <label>
                Password
                <input className="settings_input" type="password" value={draft.password} maxLength={256} onChange={(event) => setDraft((current) => ({ ...current, password: sanitizeSecret(event.target.value, { maxLength: 256 }) }))} />
              </label>
              <label className="settings_toggle_row">
                <input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} />
                <span>Active</span>
              </label>
            </div>
            <PermissionEditor value={draft.permissions} onChange={(permissions) => setDraft((current) => ({ ...current, permissions }))} idPrefix="new_user_permissions" />
            <div className="settings_action_row">
              <button type="button" className="settings_button" onClick={createUser} disabled={saving}>Create user</button>
            </div>
          </div>
        ) : null}
      </section>
      <section className={'settings_subsection settings_collapsible_card' + (isExistingOpen ? ' is-open' : '')}>
        <button
          type="button"
          className="settings_collapsible_toggle"
          onClick={openExistingCard}
          aria-expanded={isExistingOpen}
        >
          <span className="settings_collapsible_heading">
            <strong>Existing users</strong>
            <small>Review, search, update, or remove current user accounts.</small>
          </span>
          <span className="settings_collapsible_indicator" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false">
              <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        {isExistingOpen ? (
          <div className="settings_collapsible_body">
            <div className="source_window_storage_file_browser settings_user_browser" aria-label="Existing users browser">
              <div className="source_window_storage_parent_row settings_user_browser_toolbar">
                <button
                  type="button"
                  className="source_window_storage_parent_button settings_user_browser_anchor"
                  disabled
                  aria-hidden="true"
                  tabIndex={-1}
                >
                  @
                </button>
                <div className="source_window_storage_search_input">
                  <input
                    type="text"
                    value={userSearchQuery}
                    placeholder="Search by username, display name, role, or permission"
                    onChange={(event) => setUserSearchQuery(sanitizeText(event.target.value, { maxLength: 160 }))}
                  />
                  <button type="button" aria-label="Search users" disabled>
                    <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                      <path d="m16 16 4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
                <label className="settings_user_filter_select">
                  <select
                    className="settings_input"
                    value={userStatusFilter}
                    onChange={(event) => setUserStatusFilter(event.target.value)}
                  >
                    <option value="all">All users</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="locked">Locked</option>
                  </select>
                </label>
                <span className="source_window_storage_selection_tools">
                  <span className="source_window_storage_selected_count">
                    {filteredUsers.length} Matching users
                  </span>
                </span>
              </div>
              <div className="source_window_storage_file_header settings_user_browser_header" aria-hidden="true">
                <span />
                <span>Username</span>
                <span>Roles</span>
                <span>Privileges</span>
                <span>Status</span>
                <span>Edit</span>
              </div>
              {filteredUsers.length > 0 ? filteredUsers.map((user) => {
                const userId = String(user.id);
                const editDraft = editDrafts[userId] || {
                  username: user.username || '',
                  role: Array.isArray(user.roles) && user.roles.length ? user.roles[0] : (editableRoles[0] || 'analyst'),
                  permissions: Array.isArray(user.permissions) ? [...user.permissions] : [],
                  is_active: user.is_active !== false,
                };
                const isExpanded = expandedUserId === userId;
                const selectedPermissionCount = (editDraft.permissions || []).filter((permission) => allPermissions.includes(permission)).length;
                const rowStatusText = editDraft.is_active ? 'Active' : 'Inactive';
                const userInitial = String(editDraft.username || user.username || '?').trim().charAt(0).toUpperCase() || '?';

                return (
                  <div className={'settings_user_browser_record' + (isExpanded ? ' is-expanded' : '')} key={user.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      className={'source_window_storage_file_row settings_user_browser_row' + (userId === selectedUserId ? ' is-selected' : '')}
                      onClick={() => setSelectedUserId(userId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedUserId(userId);
                        }
                      }}
                    >
                      <span className="source_window_storage_file_selector" aria-hidden="true" />
                      <span>{editDraft.username || user.username}</span>
                      <small className="settings_user_browser_roles">{editDraft.role || (user.roles || []).join(', ') || 'no role'}</small>
                      <small className="settings_user_browser_privileges_summary">
                        <span className="settings_user_browser_privileges_meta">
                          <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M12 3 5 6v6c0 4.5 2.7 7.5 7 9 4.3-1.5 7-4.5 7-9V6l-7-3Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                            <path d="m9.3 12 1.9 1.9 3.7-4.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <b>{selectedPermissionCount} of {allPermissions.length}</b>
                        </span>
                        <button
                          type="button"
                          className="settings_user_browser_view_button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (!isExpanded) toggleUserEditor(user);
                          }}
                        >
                          View
                        </button>
                      </small>
                      <small className="settings_user_browser_status">
                        <span className={'settings_user_browser_status_dot' + (editDraft.is_active ? ' is-active' : '')} aria-hidden="true" />
                        {rowStatusText}
                      </small>
                      <span className="settings_user_browser_edit_cell">
                        <button
                          type="button"
                          className="settings_user_browser_edit_button linkx_tooltip_anchor"
                          data-tooltip={isExpanded ? 'Close editor' : 'Edit user'}
                          aria-label={'Edit user ' + user.username}
                          aria-expanded={isExpanded}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleUserEditor(user);
                          }}
                        >
                          <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                            <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0 0-3L16.5 4a2.1 2.1 0 0 0-3 0L3 14.5V20z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
                            <path d="M14 6l4 4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                          </svg>
                        </button>
                      </span>
                    </div>
                    {isExpanded ? (
                      <div className="settings_user_browser_editor" onClick={(event) => event.stopPropagation()}>
                        <div className="settings_user_browser_editor_titles" aria-hidden="true">
                          <span>User details</span>
                          <span>Privileges</span>
                        </div>
                        <div className="settings_user_browser_editor_body">
                          <section className="settings_user_browser_details_matrix" aria-label="User details">
                            <div className="settings_user_browser_avatar" aria-hidden="true">{userInitial}</div>
                            <div className="settings_user_browser_detail_rows">
                              <label className="settings_user_browser_detail_row">
                                <span>Username</span>
                                <input
                                  className="settings_input settings_user_browser_input settings_user_browser_table_input"
                                  value={editDraft.username || ''}
                                  maxLength={120}
                                  onChange={(event) => updateEditDraft(userId, { username: sanitizeIdentifier(event.target.value, { maxLength: 120 }) })}
                                />
                              </label>
                              <label className="settings_user_browser_detail_row">
                                <span>Role</span>
                                <select
                                  className="settings_input settings_user_browser_input settings_user_browser_select settings_user_browser_table_input"
                                  value={editDraft.role || editableRoles[0] || ''}
                                  onChange={(event) => updateEditDraft(userId, { role: event.target.value })}
                                >
                                  {editableRoles.map((role) => <option key={role} value={role}>{role}</option>)}
                                </select>
                              </label>
                              <label className="settings_user_browser_detail_row">
                                <span>Status</span>
                                <span className="settings_user_browser_status_toggle settings_user_browser_table_toggle">
                                  <input
                                    type="checkbox"
                                    checked={!!editDraft.is_active}
                                    onChange={(event) => updateEditDraft(userId, { is_active: event.target.checked })}
                                  />
                                  <small>{rowStatusText}</small>
                                </span>
                              </label>
                              <div className="settings_user_browser_detail_row">
                                <span>Reset password</span>
                                <button
                                  type="button"
                                  className="settings_button settings_user_browser_reset_button settings_user_browser_table_button"
                                  onClick={() => openResetPasswordMessage(user)}
                                >
                                  Reset
                                </button>
                              </div>
                            </div>
                          </section>
                          <section className="settings_user_browser_privileges_matrix" aria-label="User privileges">
                            {userPermissionDisplayGroups.map((group) => (
                              <div className="settings_user_browser_permission_matrix_row" key={group.label}>
                                <span className="settings_user_browser_permission_matrix_group">{group.label}</span>
                                <div className="settings_user_browser_permission_matrix_items">
                                  {group.items.map((permission) => (
                                    <label className="settings_user_browser_permission_option" key={permission}>
                                      <input
                                        type="checkbox"
                                        checked={(editDraft.permissions || []).includes(permission)}
                                        onChange={() => toggleUserPermission(userId, permission)}
                                      />
                                      <span>{permission}</span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </section>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              }) : (
                <div className="source_window_storage_placeholder_row" role="status" aria-live="polite">
                  <span />
                  <span>{users.length === 0 ? 'No users to show.' : 'No matching users.'}</span>
                  <small />
                  <small />
                  <small />
                  <small />
                </div>
              )}
            </div>
          </div>
        ) : null}
      </section>
    </section>
  );
}

function ServiceAccountsPanel({ apiFetch, canManageUsers, onNotice, refreshSignal, initialUiState = {}, onUiStateChange }) {
  const [accounts, setAccounts] = useState([]);
  const [draft, setDraft] = useState(() => initialUiState.draft || { client_id: '', client_secret: generateClientSecret(), display_name: '', is_active: true, permissions: [] });
  const [editDrafts, setEditDrafts] = useState(() => initialUiState.editDrafts || {});
  const [newSecret, setNewSecret] = useState(() => initialUiState.newSecret || '');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const lastPersistedUiRef = useRef('');

  const loadAccounts = useCallback(async () => {
    if (!canManageUsers) return;
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch('/auth/admin/service-accounts', { method: 'GET' });
      const normalized = normalizeServiceAccountList(data);
      setAccounts(normalized);
      setEditDrafts((current) => Object.fromEntries(normalized.map((account) => {
        const currentDraft = current[String(account.id)] || {};
        return [String(account.id), {
          display_name: currentDraft.display_name || account.display_name,
          is_active: currentDraft.is_active ?? account.is_active,
          permissions: Array.isArray(currentDraft.permissions) ? [...currentDraft.permissions] : account.permissions,
        }];
      })));
    } catch (err) {
      setError(err?.message || 'Failed to load service accounts.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, canManageUsers]);

  useEffect(() => {
    if (canManageUsers) loadAccounts();
  }, [canManageUsers, loadAccounts, refreshSignal]);

  const updateEditDraft = (id, patch) => setEditDrafts((current) => ({ ...current, [String(id)]: { ...(current[String(id)] || {}), ...patch } }));

  const createAccount = async () => {
    const clientSecret = sanitizeSecret(draft.client_secret || generateClientSecret(), { maxLength: 128 });
    const payload = {
      client_id: sanitizeIdentifier(draft.client_id, { maxLength: 80 }).trim(),
      client_secret: clientSecret,
      display_name: sanitizeText(draft.display_name, { maxLength: 120 }).trim(),
      is_active: !!draft.is_active,
      permissions: sanitizePermissionList(draft.permissions),
    };
    const validationError = compactValidationErrors(
      validateRequiredIdentifier(payload.client_id, 'Client ID', { minLength: 3, maxLength: 80 }),
      validateClientSecret(payload.client_secret),
      validateDisplayName(payload.display_name),
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      const data = await apiFetch('/auth/admin/service-accounts', { method: 'POST', body: payload });
      setNewSecret(extractServiceSecret(data) || clientSecret);
      setDraft({ client_id: '', client_secret: generateClientSecret(), display_name: '', is_active: true, permissions: [] });
      onNotice?.({ title: 'Service account created', message: 'Copy the generated secret before closing this panel.', source: 'Admin', level: 'success' });
      await loadAccounts();
    } catch (err) {
      setError(err?.message || 'Failed to create service account.');
    } finally {
      setSaving(false);
    }
  };

  const saveAccount = async (account) => {
    const draftPatch = editDrafts[String(account.id)] || {};
    const patch = {
      display_name: sanitizeText(draftPatch.display_name, { maxLength: 120 }).trim(),
      is_active: !!draftPatch.is_active,
      permissions: sanitizePermissionList(draftPatch.permissions),
    };
    const validationError = validateDisplayName(patch.display_name);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/service-accounts/' + encodeURIComponent(account.id), { method: 'PATCH', body: patch });
      onNotice?.({ title: 'Service account updated', message: account.client_id + ' was updated.', source: 'Admin', level: 'success' });
      await loadAccounts();
    } catch (err) {
      setError(err?.message || 'Failed to update service account.');
    } finally {
      setSaving(false);
    }
  };

  const rotateSecret = async (account) => {
    if (!window.confirm('Rotate secret for ' + account.client_id + '? The old secret should stop being used by sibling services.')) return;
    setSaving(true);
    setError('');
    try {
      const rotatedSecret = sanitizeSecret(generateClientSecret(), { maxLength: 128 });
      const data = await apiFetch('/auth/admin/service-accounts/' + encodeURIComponent(account.id), {
        method: 'PATCH',
        body: { rotate_secret: true, client_secret: rotatedSecret },
      });
      setNewSecret(extractServiceSecret(data) || rotatedSecret);
      onNotice?.({ title: 'Secret rotated', message: 'Copy the new secret now. It will not be shown again.', source: 'Admin', level: 'warning' });
      await loadAccounts();
    } catch (err) {
      setError(err?.message || 'Failed to rotate secret.');
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (account) => {
    if (!window.confirm('Delete service account ' + account.client_id + '?')) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/service-accounts/' + encodeURIComponent(account.id), { method: 'DELETE' });
      onNotice?.({ title: 'Service account deleted', message: account.client_id + ' was removed.', source: 'Admin', level: 'warning' });
      await loadAccounts();
    } catch (err) {
      setError(err?.message || 'Failed to delete service account.');
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const nextUiState = {
      draft,
      editDrafts,
      newSecret,
    };
    const serialized = JSON.stringify(nextUiState);
    if (!onUiStateChange || lastPersistedUiRef.current === serialized) return;
    lastPersistedUiRef.current = serialized;
    onUiStateChange(nextUiState);
  }, [draft, editDrafts, newSecret, onUiStateChange]);

  if (!canManageUsers) {
    return (
      <section className="settings_section">
        <div className="settings_section_header">
          <div>
            <h3>Service accounts</h3>
            <p>You need users:manage to open this tab.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="settings_section">
      <ServiceSecretNotice secret={newSecret} onClear={() => setNewSecret('')} />
      {error && <div className="settings_error">{error}</div>}
      <div className="settings_section_header">
        <div>
          <h3>Service accounts</h3>
          <p>Manage service clients and their permissions.</p>
        </div>
        <button type="button" className="settings_button" onClick={loadAccounts} disabled={loading}>
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      <div className="settings_subsection">
        <h4>Create service account</h4>
        <div className="settings_form_grid">
          <label>
            Client ID
            <input className="settings_input" value={draft.client_id} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, client_id: sanitizeIdentifier(event.target.value, { maxLength: 80 }) }))} />
          </label>
          <label>
            Display name
            <input className="settings_input" value={draft.display_name} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, display_name: sanitizeText(event.target.value, { maxLength: 120 }) }))} />
          </label>
          <label>
            Client secret
            <input className="settings_input" value={draft.client_secret} maxLength={128} onChange={(event) => setDraft((current) => ({ ...current, client_secret: sanitizeSecret(event.target.value, { maxLength: 128 }) }))} />
          </label>
          <label className="settings_toggle_row">
            <input type="checkbox" checked={draft.is_active} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.checked }))} />
            <span>Active</span>
          </label>
        </div>
        <PermissionEditor value={draft.permissions} onChange={(permissions) => setDraft((current) => ({ ...current, permissions }))} idPrefix="new_service_permissions" />
        <div className="settings_action_row">
          <button type="button" className="settings_button" onClick={createAccount} disabled={saving}>Create service account</button>
        </div>
      </div>
      <div className="settings_subsection">
        <h4>Existing service accounts</h4>
        {accounts.length === 0 ? <p className="settings_hint">No service accounts found.</p> : accounts.map((account) => {
          const editDraft = editDrafts[String(account.id)] || {
            display_name: account.display_name,
            is_active: account.is_active,
            permissions: account.permissions,
          };

          return (
            <div className="settings_record" key={account.id}>
              <div className="settings_record_header">
                <div>
                  <strong>{account.client_id}</strong>
                  <span>{account.is_active ? 'Active' : 'Inactive'}</span>
                </div>
                <div className="settings_record_actions">
                  <button type="button" className="settings_button" onClick={() => saveAccount(account)} disabled={saving}>Save</button>
                  <button type="button" className="settings_button" onClick={() => rotateSecret(account)} disabled={saving}>Rotate secret</button>
                  <button type="button" className="settings_button is-danger" onClick={() => deleteAccount(account)} disabled={saving}>Delete</button>
                </div>
              </div>
              <div className="settings_form_grid">
                <label>
                  Display name
                  <input className="settings_input" value={editDraft.display_name || ''} maxLength={120} onChange={(event) => updateEditDraft(account.id, { display_name: sanitizeText(event.target.value, { maxLength: 120 }) })} />
                </label>
                <label className="settings_toggle_row">
                  <input type="checkbox" checked={!!editDraft.is_active} onChange={(event) => updateEditDraft(account.id, { is_active: event.target.checked })} />
                  <span>Active</span>
                </label>
              </div>
              <PermissionEditor value={editDraft.permissions || []} onChange={(permissions) => updateEditDraft(account.id, { permissions })} idPrefix={'service_' + account.id + '_permissions'} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

function IntegrationPanel() {
  return (
    <section className="settings_section">
      <div className="settings_section_header">
        <div>
          <h3>Integration</h3>
          <p>Notes for service contract boundaries and frontend tokens.</p>
        </div>
      </div>
      <div className="settings_subsection">
        <h4>Contract notes</h4>
        <div className="settings_identity_grid">
          <span>Auth token</span><b>Stored separately as linkx_auth_token</b>
          <span>Linkx session</span><b>Stored separately as session</b>
          <span>Socket auth</span><b>io(API_URL, auth token)</b>
          <span>Forbidden handling</span><b>Central auth fetch handles 403 responses</b>
        </div>
      </div>
      <div className="settings_subsection">
        <h4>Reference</h4>
        <p className="settings_hint">Backend service account API details are documented for sibling-service developers.</p>
        <a className="settings_link" href="docs/integration_contract.md" target="_blank" rel="noreferrer">Open integration_contract.md</a>
      </div>
    </section>
  );
}

export default function SettingsWindowBody({ windowItem }) {
  const { user, token, logout, hasPermission } = useAuth();
  const { notify } = useNotifications();
  const { areBackgroundAnimationsEnabled, setBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const workspace = useWorkspace();
  const settingsUiState = windowItem?.metadata?.settingsUi || {};
  const [activeTab, setActiveTab] = useState(() => settingsUiState.activeTab || 'profile');
  const [sessionId, setSessionId] = useState('');
  const [refreshSignal, setRefreshSignal] = useState(0);
  const canManageUsers = hasPermission('users:manage');
  const canManageSuperusers = hasPermission('superuser:manage');
  const apiFetch = useMemo(() => makeApiFetch(token), [token]);
  const visibleTabs = settingsTabs.filter((tab) => !tab.permission || hasPermission(tab.permission));
  const activeTabMeta = visibleTabs.find((tab) => tab.id === activeTab) || visibleTabs[0] || settingsTabs[0];

  useEffect(() => {
    const storedSession = windowItem?.metadata?.sessionId || localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY) || '';
    setSessionId(String(storedSession || ''));
  }, [windowItem?.metadata?.sessionId]);

  const persistSettingsUi = useCallback((patch) => {
    workspace.updateWindowMetadata(windowItem.id, {
      metadata: {
        settingsUi: {
          ...settingsUiState,
          ...patch,
        },
      },
    });
  }, [settingsUiState, workspace, windowItem.id]);

  useEffect(() => {
    if ((activeTab === 'users' || activeTab === 'service_accounts') && !canManageUsers) {
      setActiveTab('profile');
      persistSettingsUi({ activeTab: 'profile' });
    }
  }, [activeTab, canManageUsers, persistSettingsUi]);


  const handleLogout = useCallback(() => {
    logout();
  }, [logout]);

  const handleRefresh = useCallback(() => {
    setSessionId(String(windowItem?.metadata?.sessionId || localStorage.getItem(SESSION_STORAGE_KEY) || sessionStorage.getItem(SESSION_STORAGE_KEY) || ''));
    setRefreshSignal((current) => current + 1);
  }, [windowItem?.metadata?.sessionId]);

  const tabContent = useMemo(() => {
    switch (activeTab) {
      case 'profile':
        return <ProfilePanel actor={user} token={token} sessionId={sessionId} roles={user?.roles || []} permissions={user?.permissions || []} />;
      case 'preferences':
        return <PreferencesPanel areBackgroundAnimationsEnabled={areBackgroundAnimationsEnabled} setBackgroundAnimationsEnabled={setBackgroundAnimationsEnabled} />;
      case 'users':
        return <UsersPanel apiFetch={apiFetch} canManageUsers={canManageUsers} canManageSuperusers={canManageSuperusers} currentActor={user} onNotice={notify} refreshSignal={refreshSignal} initialUiState={settingsUiState.users || {}} onUiStateChange={(uiState) => persistSettingsUi({ activeTab, users: uiState })} />;
      case 'service_accounts':
        return <ServiceAccountsPanel apiFetch={apiFetch} canManageUsers={canManageUsers} onNotice={notify} refreshSignal={refreshSignal} initialUiState={settingsUiState.service_accounts || {}} onUiStateChange={(uiState) => persistSettingsUi({ activeTab, service_accounts: uiState })} />;
      case 'integration':
        return <IntegrationPanel />;
      default:
        return null;
    }
  }, [activeTab, apiFetch, areBackgroundAnimationsEnabled, canManageSuperusers, canManageUsers, notify, persistSettingsUi, refreshSignal, sessionId, settingsUiState, setBackgroundAnimationsEnabled, token, user]);

  return (
    <div className="workspace_window_body settings_window_body">
      <div className="settings_window_workspace">
        <header className="settings_window_choose_header">
          <svg className="source_window_mode_icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M14.7 6.3a4 4 0 0 0-5 5L4.5 16.5a2.1 2.1 0 0 0 3 3l5.2-5.2a4 4 0 0 0 5-5l-2.6 2.6-3-3z" />
          </svg>
          <div>
            <h2>Settings</h2>
            <p>{settingsTabDescriptions[activeTabMeta.id] || 'Manage workspace settings.'}</p>
            <dl className="settings_window_session_chip">
              <div>
                <dt>Session</dt>
                <dd>{sessionId || 'not initialized'}</dd>
              </div>
            </dl>
          </div>
        </header>
        <div className="settings_window_workflow_shell">
          <nav className="settings_window_timeline" aria-label="Settings tabs">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'is-active' : ''}
                onClick={() => {
                  setActiveTab(tab.id);
                  persistSettingsUi({ activeTab: tab.id });
                }}
              >
                <span aria-hidden="true"></span>
                <strong>{tab.label}</strong>
                <small>{settingsTabDescriptions[tab.id]}</small>
              </button>
            ))}
          </nav>
          <div className="settings_window_surface">
            {tabContent}
          </div>
        </div>
        <footer className="settings_window_footer">
          <span>
            <svg className="window_footer_info_icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            {settingsTabDescriptions[activeTabMeta.id] || 'Manage workspace settings.'}
          </span>
          <div className="settings_window_footer_actions">
            <button type="button" className="settings_button" onClick={handleRefresh}>Refresh</button>
            <button type="button" className="settings_button is-danger" onClick={handleLogout}>Log out</button>
          </div>
        </footer>
      </div>
    </div>
  );
}
