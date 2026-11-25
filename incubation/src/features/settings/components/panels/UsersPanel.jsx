import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import WindowLoadScreen from '../../../../shared/components/WindowLoadScreen.jsx';

import { usePermissionCatalog } from '../../../../auth/permissions.js';
import { getUserAdminErrorMessage } from '../../../../services/apiErrors.js';
import {
  compactValidationErrors,
  sanitizeIdentifier,
  sanitizePermissionList,
  sanitizeSecret,
  sanitizeText,
  validateDisplayName,
  validateNewPassword,
  validateRequiredIdentifier,
} from '../../../../utils/inputSecurity.js';
import {
  isUserDraftModified,
  normalizeAdminUserList,
  userDraftFrom,
} from '../../lib/settingsModel.js';
import { normalizeUserRules } from '../../lib/userRules.js';
import { Masthead, PageHero, Pill, SettingsPage, SettingsPopup, Stat, Stats } from '../SettingsPage.jsx';

// The privileges matrix is hidden for now (analyst decision 2026-11-20:
// its presentation is to be redone); set to true to show it again.
const SHOW_PRIVILEGES = false;

// Access levels: the Service's roles. What each gives is the Service's to say
// (lib/userRules.js); privileges are never sent with a user (B-33).
const ACCESS_LEVELS = [
  { role: 'viewer', label: 'Viewer', note: 'Reads graphs and reports; changes nothing.' },
  { role: 'analyst', label: 'Analyst', note: 'Connects sources, runs analyses, builds graphs and evidence.' },
  { role: 'manager', label: 'Manager', note: 'Defined by the Service; its privileges show once chosen.' },
  { role: 'admin', label: 'Admin', note: 'Everything an analyst does, plus configuration and user management.' },
  { role: 'superuser', label: 'Superuser', note: 'Every privilege, including the service-level ones.' },
];
const LEVEL_ICONS = {
  manager: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17 11l2 2 4-4',
  viewer: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  analyst: 'M22 12h-4l-3 9L9 3l-3 9H2',
  admin: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  superuser: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
};
// A field's condition: nothing typed, fine, or wrong.
const FIELD_STATE_ICONS = {
  idle: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z',
  ok: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4L12 14.01l-3-3',
  bad: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v4M12 16h.01',
};
const LOCK_ICON = 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4';
export const LevelIcon = ({ d, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);
// Existing users is a plain list for now; the editor beside it (details,
// roles, status, password reset, delete) is kept but not shown.
const SHOW_USER_EDITOR = false;
const SEARCH_ICON = 'M21 21l-4.3-4.3M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z';
const USER_STATUS_FILTERS = [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive'], ['locked', 'Locked']];
// The mark beside each account field's name.
const FIELD_ICONS = {
  Username: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  'Display name': 'M3 5h18v14H3zM7 15h4M15 9h2M15 13h2M9 8.5a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5z',
  Password: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  'Confirm password': 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  Active: 'M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10',
};
// Create user, step by step.
const CREATE_STEPS = [
  { label: 'Account', hint: 'Who the account is for and how it signs in.', reset: 'Clear the account fields' },
  { label: 'Access level', hint: 'The level is the account’s role, and the role sets its privileges. Open Privileges to see them.', reset: 'Back to the level it started with' },
  { label: 'Privileges', hint: 'What the role gives. They cannot be given one by one.', reset: '' },
];
// The same steps when an existing account is being modified.
const MODIFY_HINTS = [
  'What the account is called and whether it may sign in.',
  'The account’s level: its role, which sets its privileges.',
  'What the account’s roles give it.',
];
const DEFAULT_LEVEL = 'analyst';

const AREA_LABELS = { config: 'Configuration', auth: 'Auth', users: 'Users', batch: 'Batch', analysis: 'Analysis' };
const splitPermission = (permission) => {
  const cut = permission.indexOf(':');
  return cut > 0 ? [permission.slice(0, cut), permission.slice(cut + 1)] : ['other', permission];
};
const titleCase = (text) => text.charAt(0).toUpperCase() + text.slice(1).replace(/_/g, ' ');

// Privileges as a matrix: an area (the permission's scope) per row, a
// privilege (read, write, …) per column, a checkbox where the area has it.
// An area's name toggles its row, a column's name its column. `locked` is a
// permission that cannot be removed (one's own users:manage).
function PrivilegeTable({ all, value = [], onChange, locked = '', label = 'Privileges' }) {
  const selected = new Set(value);
  const emit = (next) => onChange(sanitizePermissionList(Array.from(next)));
  const { areas, actions } = useMemo(() => {
    const byArea = new Map();
    const seen = new Map();
    all.forEach((permission) => {
      const [area, action] = splitPermission(permission);
      if (!byArea.has(area)) byArea.set(area, new Map());
      byArea.get(area).set(action, permission);
      seen.set(action, (seen.get(action) || 0) + 1);
    });
    return {
      areas: Array.from(byArea, ([area, cells]) => ({ area, cells, items: Array.from(cells.values()) })),
      // The privileges most areas share come first.
      actions: Array.from(seen.keys()).sort((left, right) => seen.get(right) - seen.get(left)),
    };
  }, [all]);
  const toggle = (permission) => {
    const next = new Set(selected);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    emit(next);
  };
  const toggleMany = (items) => {
    if (!items.length) return;
    const next = new Set(selected);
    const every = items.every((item) => next.has(item));
    items.forEach((item) => {
      if (every && item !== locked) next.delete(item);
      else next.add(item);
    });
    emit(next);
  };
  const grantedCount = all.filter((permission) => selected.has(permission)).length;
  return (
    <section className="users_section" aria-label={label}>
      <div className="users_section_bar">
        <h5 className="graph_customize_section_head">Privileges <small>{grantedCount} of {all.length}</small></h5>
        <span className="settings_permission_quick_actions">
          <button type="button" className="settings_link_button" onClick={() => emit(new Set([...selected, ...all]))}>Select all privileges</button>
          <span aria-hidden="true">·</span>
          <button type="button" className="settings_link_button" onClick={() => emit(new Set(locked && selected.has(locked) ? [locked] : []))}>Clear</button>
        </span>
      </div>
      <div className="users_table_wrap">
        <table className="users_table">
          <thead>
            <tr>
              <th scope="col" className="is-area">Area</th>
              {actions.map((action) => (
                <th scope="col" key={action} className="is-action">
                  <button
                    type="button"
                    title={`Toggle "${titleCase(action)}" for every area that has it`}
                    onClick={() => toggleMany(areas.map(({ cells }) => cells.get(action)).filter(Boolean))}
                  >
                    <span>{titleCase(action)}</span>
                  </button>
                </th>
              ))}
              <th scope="col" className="is-count">Granted</th>
            </tr>
          </thead>
          <tbody>
            {areas.map(({ area, cells, items }) => {
              const count = items.filter((item) => selected.has(item)).length;
              return (
                <tr key={area} className={count === items.length ? 'is-full' : count ? 'is-partial' : undefined}>
                  <th scope="row" className="is-area">
                    <button type="button" className="users_table_area" title="Toggle every privilege of this area" onClick={() => toggleMany(items)}>{AREA_LABELS[area] || titleCase(area)}</button>
                  </th>
                  {actions.map((action) => {
                    const permission = cells.get(action);
                    return (
                      <td key={action} className="is-cell">
                        {permission ? (
                          <input
                            type="checkbox"
                            aria-label={permission}
                            title={permission}
                            checked={selected.has(permission)}
                            disabled={permission === locked}
                            onChange={() => toggle(permission)}
                          />
                        ) : <span className="users_table_none" aria-hidden="true">·</span>}
                      </td>
                    );
                  })}
                  <td className="is-count">{count}/{items.length}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// A glyph for a privilege, by what it lets you do (first match wins).
const ACTION_ICONS = [
  ['disconnect', 'M18 6L6 18M6 6l12 12'],
  ['connect', 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  ['analysis', 'M22 12h-4l-3 9L9 3l-3 9H2'],
  ['link', 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
  ['read', 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  ['write', 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z'],
  ['create', 'M12 5v14M5 12h14'],
  ['upload', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12'],
  ['ingest', 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3'],
  ['query', 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35'],
  ['run', 'M5 3l14 9-14 9V3z'],
  ['feedback', 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
  ['manage', 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'],
  ['verify', 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4'],
];
const DEFAULT_ACTION_ICON = 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 8v8M8 12h8';
const actionIcon = (action) => (ACTION_ICONS.find(([word]) => action.includes(word)) || [null, DEFAULT_ACTION_ICON])[1];

// Privileges: each area with its privileges as on/off pills. An area's name
// toggles the whole area. readOnly: shown only, nothing toggles.
// canGrant(permission): the actor holds it, so may grant or remove it (the
// Service refuses escalation, B-1). Others are shown locked, as they are.
export function PrivilegePicker({ groups, all, value = [], onChange, canGrant = () => true, readOnly = false }) {
  const selected = new Set(value);
  const emit = (next) => onChange(sanitizePermissionList(Array.from(next)));
  const grouped = new Set(groups.flatMap((group) => group.items));
  const other = all.filter((permission) => !grouped.has(permission));
  const rows = other.length ? [...groups, { label: 'Other', items: other }] : groups;
  const toggle = (allItems) => {
    if (readOnly) return;
    const items = allItems.filter(canGrant);
    if (!items.length) return;
    const next = new Set(selected);
    const every = items.every((item) => next.has(item));
    items.forEach((item) => (every ? next.delete(item) : next.add(item)));
    emit(next);
  };
  return (
    <div className="users_picker">
      {rows.map((group) => {
        const scopes = new Set(group.items.map((item) => splitPermission(item)[0]));
        const count = group.items.filter((item) => selected.has(item)).length;
        return (
          <div className="users_picker_area" key={group.label}>
            <button type="button" className="users_picker_name" title={readOnly ? undefined : 'Toggle the whole area'} aria-disabled={readOnly || undefined} onClick={() => toggle(group.items)}>
              {group.label}
              <small>{count}/{group.items.length}</small>
            </button>
            <span className="users_picker_pills">
              {group.items.map((permission) => {
                const [scope, action] = splitPermission(permission);
                const on = selected.has(permission);
                const locked = readOnly || !canGrant(permission);
                return (
                  <button
                    key={permission}
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={permission}
                    title={readOnly ? permission : locked ? `${permission}: your account does not hold it, so it cannot grant or remove it.` : permission}
                    aria-disabled={locked || undefined}
                    className={'users_pill' + (on ? ' is-on' : '') + (locked && !readOnly ? ' is-locked' : '')}
                    onClick={() => toggle([permission])}
                  >
                    <LevelIcon d={actionIcon(action)} size={11} />
                    {(scopes.size > 1 ? `${scope} ${action}` : action).replace(/_/g, ' ')}
                  </button>
                );
              })}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// The Create user steps as a strip of pages, each at its own height. The
// window onto the strip is as tall as the current page and the strip is
// moved (not scrolled) to it, so nothing here can show a scroll bar; both
// the height and the move are animated by the style sheet. Under the second
// page the third's header shows too. This is its own component so it
// measures when it is really in the document (the popup mounts late).
export function StepStrip({ step, children }) {
  const windowRef = useRef(null);
  const stripRef = useRef(null);
  useLayoutEffect(() => {
    const frame = windowRef.current;
    const strip = stripRef.current;
    if (!frame || !strip) return undefined;
    const place = () => {
      const page = strip.children[step];
      if (!page) return;
      const next = step === 1 ? strip.children[2] : null;
      const head = next?.querySelector('.users_wizard_headrow');
      const height = head ? next.offsetTop + head.offsetTop + head.offsetHeight + 8 - page.offsetTop : page.offsetHeight;
      frame.style.height = `${height}px`;
      strip.style.transform = `translateY(${-page.offsetTop}px)`;
    };
    place();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(place);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [step]);
  return (
    <div className="users_make_options" ref={windowRef}>
      <ol className="users_wizard" aria-label="Steps" ref={stripRef}>{children}</ol>
    </div>
  );
}

export function UsersPanel({ apiFetch, canManageUsers, canManageSuperusers, currentActor, onNotice, requestConfirmation, refreshSignal, initialUiState = {}, onUiStateChange }) {
  // The Service's permission list once loaded (§4e), else the built-in one.
  const { all: allPermissions, displayGroups: userPermissionDisplayGroups } = usePermissionCatalog();
  const [users, setUsers] = useState([]);
  const [draft, setDraft] = useState(() => initialUiState.draft || { username: '', password: '', display_name: '', roles: ['analyst'], is_active: true });
  const [editDrafts, setEditDrafts] = useState(() => initialUiState.editDrafts || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // The two popups always start closed (never reopened from saved UI state).
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExistingOpen, setIsExistingOpen] = useState(false);
  // Create user runs in steps: 0 account, 1 access level, 2 privileges.
  const [createStep, setCreateStep] = useState(0);
  // Once Next / Create has been refused, empty required fields say so too.
  const [accountChecked, setAccountChecked] = useState(false);
  // The password typed a second time: it is masked, so a slip would lock
  // the new account out. Never sent, never kept.
  const [passwordConfirm, setPasswordConfirm] = useState('');
  // Modify User: the same form, filled from an existing account ({ user,
  // initialRole }). The Create user draft waits aside meanwhile.
  const [modifying, setModifying] = useState(null);
  // The privileges open in a popup of their own, over the form.
  const [privilegesOpen, setPrivilegesOpen] = useState(false);
  const createDraftStashRef = useRef(null);
  // A new account needs its password twice; a modified one only when a new
  // password is being set.
  const confirmProblem = modifying && !draft.password && !passwordConfirm
    ? ''
    : !passwordConfirm ? 'Type the password again.' : passwordConfirm === draft.password ? '' : 'The passwords do not match.';
  const [userSearchQuery, setUserSearchQuery] = useState(() => initialUiState.userSearchQuery || '');
  const [userStatusFilter, setUserStatusFilter] = useState(() => initialUiState.userStatusFilter || 'all');
  const [selectedUserId, setSelectedUserId] = useState(() => initialUiState.selectedUserId || '');
  const [expandedUserId, setExpandedUserId] = useState(() => initialUiState.expandedUserId || '');
  const lastPersistedUiRef = useRef('');
  // The Service's rules (GET /auth/admin/user-rules, B-33); until it answers,
  // only those who manage superusers may give more than analyst and viewer.
  const [assignableRoles, setAssignableRoles] = useState(null);
  const creatableRoles = useMemo(() => assignableRoles || (canManageSuperusers ? ['superuser', 'admin', 'manager', 'analyst', 'viewer'] : ['analyst', 'viewer']), [assignableRoles, canManageSuperusers]);
  const defaultRole = creatableRoles.includes(DEFAULT_LEVEL) ? DEFAULT_LEVEL : creatableRoles[0];
  // Roles this actor may assign (production availableRoles). Other roles a
  // user already holds are shown locked and kept as they are on save.
  const editableRoles = creatableRoles;
  // What each role gives, as the Service says it: null until it has.
  const [rolePermissions, setRolePermissions] = useState(null);
  useEffect(() => {
    if (!canManageUsers) return undefined;
    let current = true;
    Promise.resolve(apiFetch('/auth/admin/user-rules', { method: 'GET', suppressForbiddenHandler: true }))
      .then((data) => {
        if (!current) return;
        const rules = normalizeUserRules(data);
        setRolePermissions(rules.permissions);
        // Only levels this screen knows; empty: what it assumed stands.
        const known = (rules.assignable || []).filter((role) => ACCESS_LEVELS.some((item) => item.role === role));
        setAssignableRoles(known.length ? known : null);
      })
      .catch(() => {});
    return () => { current = false; };
  }, [apiFetch, canManageUsers, refreshSignal]);
  const permissionsOf = (roles = []) => {
    const known = roles.filter((role) => rolePermissions?.[role]);
    return known.length ? [...new Set(known.flatMap((role) => rolePermissions[role]))].sort() : null;
  };
  // An account holding a role this actor may not assign (admin, superuser
  // without superuser:manage) cannot be changed from here: saving it would
  // send that role back, which the Service refuses.
  const outranks = (user) => (user.roles || []).some((role) => ['superuser', 'admin', 'manager'].includes(role) && !editableRoles.includes(role));
  const currentActorUser = useMemo(() => {
    if (!currentActor?.username) return null;
    return {
      id: currentActor.id ?? currentActor.username,
      username: currentActor.username,
      display_name: currentActor.display_name || currentActor.name || '',
      roles: Array.isArray(currentActor.roles) ? currentActor.roles : [],
      permissions: Array.isArray(currentActor.permissions) ? currentActor.permissions : [],
      is_active: currentActor.is_active !== false,
      is_locked: !!currentActor.is_locked,
    };
  }, [currentActor]);

  // True while the list is being fetched (the first time: nothing to show yet).
  const [usersLoading, setUsersLoading] = useState(false);
  const loadUsers = useCallback(async () => {
    if (!canManageUsers) return;
    setError('');
    setUsersLoading(true);
    try {
      const data = await apiFetch('/auth/admin/users', { method: 'GET' });
      const normalized = normalizeAdminUserList(data);
      const mergedUsers = currentActorUser && !normalized.some((user) => String(user.username) === String(currentActorUser.username))
        ? [currentActorUser, ...normalized]
        : normalized;
      setUsers(mergedUsers);
      // Reloading always discards local edits: drafts mirror the server.
      setEditDrafts(Object.fromEntries(mergedUsers.map((user) => [String(user.id), userDraftFrom(user)])));
    } catch (err) {
      setError(err?.message || 'Failed to load users.');
    } finally {
      setUsersLoading(false);
    }
  }, [apiFetch, canManageUsers, currentActorUser]);

  useEffect(() => {
    if (canManageUsers) loadUsers();
  }, [canManageUsers, loadUsers, refreshSignal]);

  useEffect(() => {
    // (An account being modified keeps its level, assignable here or not.)
    if (modifying) return;
    setDraft((current) => ({
      ...current,
      roles: current.roles.filter((role) => creatableRoles.includes(role)).length ? current.roles.filter((role) => creatableRoles.includes(role)) : [defaultRole],
    }));
  }, [creatableRoles, defaultRole, modifying]);

  const openCreateCard = () => {
    setError('');
    setCreateStep(0);
    setAccountChecked(false);
    setPasswordConfirm('');
    setIsExistingOpen(false);
    setIsCreateOpen(true);
  };
  // Leaving Modify User, saved or not: the Create user draft comes back
  // and Existing users reopens as it was left (its search and filter).
  const leaveModify = () => {
    if (createDraftStashRef.current) setDraft(createDraftStashRef.current);
    createDraftStashRef.current = null;
    setModifying(null);
    setPasswordConfirm('');
    setExpandedUserId('');
    setIsExistingOpen(true);
  };
  const closeCreate = () => {
    setPrivilegesOpen(false);
    setIsCreateOpen(false);
    setCreateStep(0);
    setError('');
    if (modifying) leaveModify();
  };
  // Edit on an account's card: the Create user form, filled with the account.
  const openModify = (user) => {
    const roles = user.roles || [];
    const initialRole = [...ACCESS_LEVELS].reverse().find((item) => roles.includes(item.role))?.role || roles[0] || defaultRole;
    createDraftStashRef.current = draft;
    setDraft({ username: user.username || '', password: '', display_name: user.display_name || '', roles: [initialRole], is_active: user.is_active !== false });
    setModifying({ user, initialRole });
    setError('');
    setCreateStep(0);
    setAccountChecked(false);
    setPasswordConfirm('');
    setSelectedUserId(String(user.id));
    setIsExistingOpen(false);
    setIsCreateOpen(true);
  };
  // Step one's own checks (the same ones Create runs), so Next stops on them.
  const accountError = () => compactValidationErrors(
    // (A modified account keeps its username, and its password unless a new one is typed.)
    modifying ? '' : validateRequiredIdentifier(sanitizeIdentifier(draft.username, { maxLength: 120 }).trim(), 'Username', { minLength: 3, maxLength: 120 }),
    validateNewPassword(sanitizeSecret(draft.password, { maxLength: 256 }), { required: !modifying }),
    validateDisplayName(sanitizeText(draft.display_name, { maxLength: 120 }).trim()),
    confirmProblem,
  );
  const goToCreateStep = (step) => {
    if (step > 0) {
      // What is wrong shows on the fields themselves.
      if (accountError()) {
        setAccountChecked(true);
        setError('');
        setCreateStep(0);
        return;
      }
    }
    setError('');
    setCreateStep(step);
  };

  const openExistingCard = () => {
    setIsExistingOpen((current) => {
      const next = !current;
      if (next) setIsCreateOpen(false);
      // It opens on the list, never on an account's editor.
      if (next) setExpandedUserId('');
      return next;
    });
  };

  const updateEditDraft = (userId, patch) => {
    setEditDrafts((current) => ({ ...current, [String(userId)]: { ...(current[String(userId)] || {}), ...patch } }));
  };

  const toggleUserRole = (userId, role) => {
    setEditDrafts((current) => {
      const draftRoles = current[userId]?.roles || [];
      const roles = draftRoles.includes(role) ? draftRoles.filter((item) => item !== role) : [...draftRoles, role];
      return { ...current, [userId]: { ...(current[userId] || {}), roles } };
    });
  };

  const isSelf = (user) => Boolean(currentActor?.username) && String(user.username) === String(currentActor.username);

  // PATCH /auth/admin/users/:id (production saveUser).
  const saveUser = async (user) => {
    const userId = String(user.id);
    const edit = editDrafts[userId] || {};
    if (isSelf(user) && !edit.is_active) {
      setError('You cannot deactivate yourself.');
      return;
    }
    const patch = {
      display_name: sanitizeText(edit.display_name ?? user.display_name ?? '', { maxLength: 120 }).trim(),
      roles: Array.from(new Set([
        ...(user.roles || []).filter((role) => !editableRoles.includes(role)),
        ...(edit.roles || []).filter((role) => editableRoles.includes(role)),
      ])),
      is_active: !!edit.is_active,
    };
    if (edit.password) patch.password = sanitizeSecret(edit.password, { maxLength: 256 });
    const validationError = compactValidationErrors(
      validateDisplayName(patch.display_name),
      validateNewPassword(patch.password || '', { required: false }),
      patch.roles.length ? '' : 'At least one allowed role is required.',
    );
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/users/' + encodeURIComponent(user.id), { method: 'PATCH', body: patch });
      onNotice?.({ title: 'User updated', message: user.username + ' was updated.', source: 'Admin', level: 'success' });
      updateEditDraft(userId, { password: '' });
      setExpandedUserId('');
      await loadUsers();
    } catch (err) {
      setError(getUserAdminErrorMessage(err, 'The user could not be updated.'));
    } finally {
      setSaving(false);
    }
  };

  // The card's switch: active / inactive, saved at once. Everything else
  // is sent as it stands (the Service takes the whole account).
  // Trying to switch one's own account off: refused, with a notification.
  const refuseSelfDeactivation = () => {
    onNotice?.({ title: 'Not allowed', message: 'You cannot deactivate your own account. Ask another administrator to do it.', source: 'Admin', level: 'warning' });
  };
  const toggleUserActive = async (user) => {
    if (isSelf(user)) {
      refuseSelfDeactivation();
      return;
    }
    const next = user.is_active === false;
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/users/' + encodeURIComponent(user.id), {
        method: 'PATCH',
        body: { display_name: user.display_name || '', roles: user.roles || [], is_active: next },
      });
      onNotice?.({ title: next ? 'User activated' : 'User deactivated', message: user.username + (next ? ' can sign in again.' : ' can no longer sign in.'), source: 'Admin', level: next ? 'success' : 'warning' });
      // An open draft for this account follows the saved state.
      setEditDrafts((current) => (current[String(user.id)] ? { ...current, [String(user.id)]: { ...current[String(user.id)], is_active: next } } : current));
      await loadUsers();
    } catch (err) {
      onNotice?.({ title: 'User not updated', message: getUserAdminErrorMessage(err, 'The user could not be updated.'), source: 'Admin', level: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const deleteUser = async (user) => {
    if (isSelf(user)) {
      setError('You cannot delete your own account.');
      return;
    }
    const confirmed = await requestConfirmation({ title: 'Delete user', message: `Delete user "${user.username}"? This action cannot be undone.`, confirmText: 'Delete', icon: 'delete', cancelText: 'Cancel' });
    if (!confirmed) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/users/' + encodeURIComponent(user.id), { method: 'DELETE' });
      onNotice?.({ title: 'User deleted', message: user.username + ' was removed.', source: 'Admin', level: 'warning' });
      if (expandedUserId === String(user.id)) setExpandedUserId('');
      await loadUsers();
    } catch (err) {
      setError(getUserAdminErrorMessage(err, 'The user could not be deleted.'));
    } finally {
      setSaving(false);
    }
  };

  // The account's roles with its level as chosen: exactly as saved when the
  // level is the same, else the new level in place of the old one (roles that
  // are not levels are kept).
  const modifiedRoles = () => {
    const saved = modifying?.user.roles || [];
    const chosen = (draft.roles || [])[0];
    if (!chosen || chosen === modifying.initialRole) return [...saved];
    return [chosen, ...saved.filter((role) => !ACCESS_LEVELS.some((item) => item.role === role))];
  };
  // PATCH /auth/admin/users/:id from the Modify User form.
  const updateUser = async () => {
    if (!modifying) return;
    const { user } = modifying;
    const patch = {
      display_name: sanitizeText(draft.display_name, { maxLength: 120 }).trim(),
      roles: modifiedRoles(),
      is_active: !!draft.is_active,
    };
    if (draft.password) patch.password = sanitizeSecret(draft.password, { maxLength: 256 });
    if (accountError()) {
      setAccountChecked(true);
      setError('');
      setCreateStep(0);
      return;
    }
    if (isSelf(user) && !patch.is_active) {
      setError('You cannot deactivate yourself.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/users/' + encodeURIComponent(user.id), { method: 'PATCH', body: patch });
      onNotice?.({ title: 'User updated', message: user.username + ' was updated.', source: 'Admin', level: 'success' });
      setIsCreateOpen(false);
      setCreateStep(0);
      leaveModify();
      await loadUsers();
    } catch (err) {
      onNotice?.({ title: 'User not updated', message: getUserAdminErrorMessage(err, 'The user could not be updated.'), source: 'Admin', level: 'error' });
    } finally {
      setSaving(false);
    }
  };
  const createUser = async () => {
    const payload = {
      username: sanitizeIdentifier(draft.username, { maxLength: 120 }).trim(),
      password: sanitizeSecret(draft.password, { maxLength: 256 }),
      display_name: sanitizeText(draft.display_name, { maxLength: 120 }).trim(),
      roles: Array.from(new Set((draft.roles || []).filter((role) => creatableRoles.includes(role)))),
      // (Privileges come from the role; the Service refuses them here.)
      is_active: !!draft.is_active,
    };
    const validationError = compactValidationErrors(
      validateRequiredIdentifier(payload.username, 'Username', { minLength: 3, maxLength: 120 }),
      validateNewPassword(payload.password, { required: true }),
      validateDisplayName(payload.display_name),
      confirmProblem,
      payload.roles.length ? '' : 'At least one allowed role is required.',
    );
    if (validationError) {
      if (accountError()) {
        // The account's problems show on its fields; anything else, above.
        setAccountChecked(true);
        setCreateStep(0);
        setError(payload.roles.length ? '' : 'At least one allowed role is required.');
      } else {
        setError(validationError);
      }
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/users', { method: 'POST', body: payload });
      setDraft({ username: '', password: '', display_name: '', roles: [defaultRole], is_active: true });
      setPasswordConfirm('');
      onNotice?.({ title: 'User created', message: payload.username + ' was created.', source: 'Admin', level: 'success' });
      await loadUsers();
      setIsCreateOpen(false);
      setCreateStep(0);
    } catch (err) {
      onNotice?.({ title: 'User not created', message: getUserAdminErrorMessage(err, 'The user could not be created.'), source: 'Admin', level: 'error' });
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
    // Passwords never go into workspace window state.
    const nextUiState = {
      draft: { ...draft, password: '' },
      editDrafts: Object.fromEntries(Object.entries(editDrafts).map(([key, value]) => [key, { ...value, password: '' }])),
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
      <SettingsPage>
        <Masthead>
          <PageHero tone="locked" eyebrow="Users" title="Access restricted" meta="You need users:manage to open this tab." media={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>}>
            <Pill>Locked</Pill>
          </PageHero>
        </Masthead>
      </SettingsPage>
    );
  }

  const activeUsers = users.filter((user) => user.is_active !== false).length;
  const lockedUsers = users.filter((user) => user.is_locked).length;
  const superusers = users.filter((user) => (user.roles || []).includes('superuser')).length;

  return (
    <SettingsPage className="settings_section">
      <Masthead>
        <PageHero eyebrow="Users" title="Application users" meta="Manage application users and their permissions." media={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>} />
        <Stats label="User figures" columns={4}>
          <Stat lead icon="users" label="Users" value={users.length.toLocaleString()} note="accounts in total" />
          <Stat icon="userCheck" tone="success" label="Active" value={activeUsers.toLocaleString()} note="can sign in" />
          <Stat icon="userOff" label="Inactive" value={(users.length - activeUsers).toLocaleString()} note="switched off" />
          <Stat icon="lock" tone={lockedUsers ? 'danger' : ''} label="Locked" value={lockedUsers.toLocaleString()} note={`${superusers.toLocaleString()} superuser${superusers === 1 ? '' : 's'}`} />
        </Stats>
      </Masthead>
      {error && !isCreateOpen && !isExistingOpen ? <div className="settings_error">{error}</div> : null}
      {/* The two actions, side by side; each opens in a popup. */}
      <div className="settings_launch_cards">
        <button type="button" className="settings_launch_card" aria-haspopup="dialog" aria-expanded={isCreateOpen} onClick={openCreateCard}>
          <span className="settings_launch_icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM20 8v6M23 11h-6" /></svg>
          </span>
          <span className="settings_launch_text">
            <strong>Create user</strong>
            <small>Create a new analyst account and assign access.</small>
          </span>
        </button>
        <button type="button" className="settings_launch_card" aria-haspopup="dialog" aria-expanded={isExistingOpen} onClick={openExistingCard}>
          <span className="settings_launch_icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>
          </span>
          <span className="settings_launch_text">
            <strong>Existing users</strong>
            <small>Review, search, update, or remove current user accounts.</small>
          </span>
        </button>
      </div>

      {isCreateOpen ? (() => {
        const role = (draft.roles || [])[0];
        const modifyingSelf = Boolean(modifying) && isSelf(modifying.user);
        const level = ACCESS_LEVELS.find((item) => item.role === role);
        const given = permissionsOf(modifying ? modifiedRoles() : draft.roles);
        const username = draft.username.trim();
        // What each step holds, shown beside its name once it is behind you.
        const summaries = [
          [username, draft.display_name.trim(), draft.is_active ? 'active' : 'switched off'].filter(Boolean).join(' · '),
          level ? level.label : '',
          given ? `${given.length} of ${allPermissions.length}` : '',
        ];
        // Each step's reset: back to how the step starts.
        const resetCreateStep = [
          // (Modify User goes back to the account as it is saved.)
          () => {
            setError(''); setAccountChecked(false); setPasswordConfirm('');
            setDraft((current) => (modifying
              ? { ...current, display_name: modifying.user.display_name || '', password: '', is_active: modifying.user.is_active !== false }
              : { ...current, username: '', display_name: '', password: '', is_active: true }));
          },
          () => setDraft((current) => (modifying
            ? { ...current, roles: [modifying.initialRole] }
            : { ...current, roles: [defaultRole] })),
        ];
        const stepBodies = [
          <div className="users_wizard_fields" key="account">
            {/* The name above each input; inside it, at the end, a mark of
                the field's condition (empty, fine, or what is wrong). */}
            {[
              {
                label: 'Username',
                value: draft.username,
                locked: Boolean(modifying),
                problem: modifying ? '' : validateRequiredIdentifier(draft.username.trim(), 'Username', { minLength: 3, maxLength: 120 }),
                hint: modifying ? 'Usernames cannot be changed.' : 'At least 3 characters. It cannot be changed later.',
                input: { disabled: Boolean(modifying), autoComplete: 'off', maxLength: 120, placeholder: 'e.g. a.kebede', onChange: (event) => setDraft((current) => ({ ...current, username: sanitizeIdentifier(event.target.value, { maxLength: 120 }) })) },
              },
              {
                label: 'Display name',
                value: draft.display_name,
                optional: true,
                problem: validateDisplayName(draft.display_name.trim()),
                hint: 'Optional. Shown in the workspace instead of the username.',
                input: { maxLength: 120, placeholder: 'e.g. Abebe Kebede', onChange: (event) => setDraft((current) => ({ ...current, display_name: sanitizeText(event.target.value, { maxLength: 120 }) })) },
              },
              {
                label: modifying ? 'New password' : 'Password',
                icon: 'Password',
                value: draft.password,
                optional: Boolean(modifying),
                problem: validateNewPassword(draft.password, { required: !modifying }),
                hint: modifying ? 'Leave empty to keep the current password.' : 'At least 8 characters, without spaces.',
                input: { type: 'password', autoComplete: 'new-password', maxLength: 256, onChange: (event) => setDraft((current) => ({ ...current, password: sanitizeSecret(event.target.value, { maxLength: 256 }) })) },
              },
              {
                label: 'Confirm password',
                value: passwordConfirm,
                optional: Boolean(modifying),
                problem: confirmProblem,
                hint: modifying ? 'Only when setting a new password.' : 'The same password again, to catch a slip.',
                input: { type: 'password', autoComplete: 'new-password', maxLength: 256, onChange: (event) => setPasswordConfirm(sanitizeSecret(event.target.value, { maxLength: 256 })) },
              },
            ].map((field) => {
              // Empty: nothing to judge yet, until Next / Create has been refused.
              // A field that cannot be changed is marked with a lock instead.
              const state = field.locked ? 'idle' : field.problem && (field.value || accountChecked) ? 'bad' : !field.value ? 'idle' : 'ok';
              const note = field.locked ? 'Cannot be changed.' : state === 'bad' ? field.problem : state === 'ok' ? 'Looks good.' : field.optional ? 'Optional.' : 'Required.';
              return (
                <label className={`users_input_field is-${state}${field.locked ? ' is-locked' : ''}`} key={field.icon || field.label}>
                  {/* What is wrong sits in the label, beside the field's name. */}
                  <span className="users_input_label">
                    <span className="users_input_name"><LevelIcon d={FIELD_ICONS[field.icon || field.label]} size={13} />{field.label}</span>
                    {state === 'bad' ? <em className="users_input_error" role="alert">{field.problem}</em> : null}
                  </span>
                  <span className="users_input_wrap">
                    <input className="graph_customize_input" value={field.value} aria-invalid={state === 'bad' || undefined} {...field.input} />
                    <i className="users_input_state" title={note} aria-hidden="true">
                      <LevelIcon d={field.locked ? LOCK_ICON : FIELD_STATE_ICONS[state]} size={15} />
                    </i>
                  </span>
                  <small className="graph_customize_hint">{field.hint}</small>
                </label>
              );
            })}
            <label className={'users_input_field settings_switch users_wizard_switch' + (modifyingSelf ? ' is-restricted' : '')} title={modifyingSelf ? 'You cannot deactivate yourself.' : undefined}>
              <span className="users_input_label"><span className="users_input_name"><LevelIcon d={FIELD_ICONS.Active} size={13} />Active</span></span>
              <span className="users_wizard_switch_row">
                <input type="checkbox" role="switch" aria-disabled={modifyingSelf || undefined} checked={draft.is_active} onChange={(event) => (modifyingSelf ? refuseSelfDeactivation() : setDraft((current) => ({ ...current, is_active: event.target.checked })))} />
                <span className="graph_customize_hint">{modifying ? (draft.is_active ? 'Can sign in.' : 'Cannot sign in.') : draft.is_active ? 'Can sign in once created.' : 'Created switched off.'}</span>
              </span>
            </label>
          </div>,
          <div className="users_levels" role="radiogroup" aria-label="Access level" key="level">
            {/* Every level stays visible; the ones this account may not
                assign are locked and say why. */}
            {ACCESS_LEVELS.map((item) => {
              const preset = permissionsOf([item.role]);
              // One's own level is fixed: changing it could lock one out.
              const fixed = modifyingSelf;
              const isCurrent = modifying ? role === item.role : creatableRoles.includes(item.role) && role === item.role;
              const allowed = fixed ? isCurrent : creatableRoles.includes(item.role) || (Boolean(modifying) && item.role === modifying.initialRole);
              const why = fixed ? 'You cannot change your own access level.' : 'Assigning this level needs the superuser:manage permission.';
              return (
                <label
                  key={item.role}
                  className={'users_level' + (isCurrent ? ' is-current' : '') + (allowed ? '' : ' is-locked') + (fixed ? ' is-fixed' : '')}
                  title={fixed || !allowed ? why : undefined}
                >
                  <input type="radio" name="new_user_access_level" checked={isCurrent} disabled={fixed || !allowed} onChange={() => setDraft((current) => ({ ...current, roles: [item.role] }))} />
                  <span className="users_level_icon"><LevelIcon d={allowed ? LEVEL_ICONS[item.role] : LOCK_ICON} /></span>
                  <span className="users_level_text">
                    <strong>{item.label}</strong>
                    <small>{allowed ? item.note : fixed ? 'Not your level.' : 'Needs superuser:manage to assign.'}</small>
                  </span>
                  <span className="users_level_count" title={fixed || !preset ? undefined : preset.join(', ')}>{fixed ? (isCurrent ? 'Current' : 'Locked') : modifying && item.role === modifying.initialRole ? 'Current' : allowed ? (preset ? `${preset.length} privileges` : '') : 'Locked'}</span>
                  <span className="users_level_mark" aria-hidden="true"><LevelIcon d="M5 12l5 5L20 7" size={11} /></span>
                </label>
              );
            })}
          </div>,
          null,
        ];
        return (
          <>
          <SettingsPopup
            narrow
            title={modifying ? 'Modify User' : 'Create user'}
            subtitle={modifying ? `${modifying.user.username} · step ${createStep + 1} of 2` : `Step ${createStep + 1} of 2`}
            hint={saving ? (modifying ? 'Updating the account…' : 'Creating the account…') : modifying ? MODIFY_HINTS[createStep] : CREATE_STEPS[createStep].hint}
            busy={saving}
            onClose={closeCreate}
            footer={(
              <>
                {createStep > 0 ? <button type="button" className="graph_customize_button" disabled={saving} onClick={() => goToCreateStep(createStep - 1)}>Back</button> : null}
                {/* Once a level is chosen the account can be created. */}
                {/* A modified account can be saved from any step; Cancel goes
                    back to Existing users. */}
                {modifying ? <button type="button" className="graph_customize_button" disabled={saving} onClick={closeCreate}>Cancel</button> : null}
                {createStep === 0 ? (
                  <button type="button" className={'graph_customize_button' + (modifying ? '' : ' is-primary')} disabled={saving} onClick={() => goToCreateStep(1)}>Next</button>
                ) : null}
                {modifying ? (
                  <button type="button" className="graph_customize_button is-primary" disabled={saving} onClick={updateUser}>{saving ? 'Updating…' : 'Update user'}</button>
                ) : createStep === 0 ? null : (
                  <button type="button" className="graph_customize_button is-primary" disabled={saving} onClick={createUser}>{saving ? 'Creating…' : 'Create user'}</button>
                )}
              </>
            )}
          >
            <div className="users_make">
              {error ? <div className="settings_error users_popup_error">{error}</div> : null}
              {/* The steps, a page each, in one strip that slides to the
                  current one; under the access level the header of the
                  optional privileges step shows too. */}
              <StepStrip step={createStep}>
                  {CREATE_STEPS.map((step, index) => {
                    const state = index === createStep ? 'current' : index < createStep ? 'done' : 'todo';
                    // The privileges are not a page: their header, under the
                    // access level, opens them in a popup of their own.
                    const opensPopup = index === 2;
                    // Out of view, a page is out of reach too.
                    const inView = state === 'current' || (opensPopup && createStep === 1);
                    return (
                      <li key={step.label} className={`users_wizard_step is-${state}${opensPopup ? ' is-popup' : ''}`} data-step={index + 1} inert={!inView}>
                        <div className="users_wizard_headrow">
                          <button
                            type="button"
                            className="users_wizard_head"
                            aria-current={state === 'current' ? 'step' : undefined}
                            aria-expanded={opensPopup ? privilegesOpen : state === 'current'}
                            aria-haspopup={opensPopup ? 'dialog' : undefined}
                            disabled={saving}
                            onClick={() => (opensPopup ? setPrivilegesOpen(true) : goToCreateStep(index))}
                          >
                            <i aria-hidden="true">{state === 'done' ? '✓' : index + 1}</i>
                            <strong className="graph_customize_section_head">{step.label}</strong>
                            {state !== 'current' && (state === 'done' || index >= 1) && summaries[index] ? <small>{summaries[index]}</small> : null}
                            {opensPopup ? <span className="users_wizard_open" aria-hidden="true"><LevelIcon d="M9 6l6 6-6 6" size={13} /></span> : null}
                          </button>
                          {step.reset ? (
                            <button type="button" className="users_wizard_reset linkx_tooltip_anchor" data-tooltip={step.reset} aria-label={step.reset} disabled={saving || (modifyingSelf && index === 1)} onClick={resetCreateStep[index]}>
                              <LevelIcon d="M1 4v6h6M3.51 15a9 9 0 1 0 2.13-9.36L1 10" size={13} />
                            </button>
                          ) : null}
                        </div>
                        {opensPopup ? null : <div className="users_wizard_body" inert={state !== 'current'}>{stepBodies[index]}</div>}
                      </li>
                    );
                  })}
              </StepStrip>
            </div>
          </SettingsPopup>
          {privilegesOpen ? (
            <SettingsPopup
              title="Privileges"
              subtitle={[username, level ? level.label : ''].filter(Boolean).join(' · ')}
              hint={given ? `${given.length} of ${allPermissions.length}, given by the role. They cannot be given one by one.` : 'Set by the role.'}
              onClose={() => setPrivilegesOpen(false)}
              footer={(
                <button type="button" className="graph_customize_button is-primary" onClick={() => setPrivilegesOpen(false)}>Done</button>
              )}
            >
          <section className="users_wizard_privileges" aria-label="Privileges">
            {given ? (
              <PrivilegePicker readOnly groups={userPermissionDisplayGroups} all={allPermissions} value={given} />
            ) : (
              <p className="users_empty" role="status">The Service has not said which privileges this role gives.</p>
            )}
          </section>
            </SettingsPopup>
          ) : null}
          </>
        );
      })() : null}

      {isExistingOpen ? (() => {
        const activeUser = filteredUsers.find((user) => String(user.id) === selectedUserId) || null;
        const activeId = activeUser ? String(activeUser.id) : '';
        const activeDraft = activeUser ? (editDrafts[activeId] || userDraftFrom(activeUser)) : null;
        const activeModified = activeUser ? isUserDraftModified(activeUser, editDrafts[activeId]) : false;
        if (!SHOW_USER_EDITOR) {
          return (
            <SettingsPopup
              narrow
              title="Existing users"
              subtitle={`${users.length} ${users.length === 1 ? 'account' : 'accounts'}`}
              hint={filteredUsers.length === users.length ? 'Every account in this workspace.' : `Showing ${filteredUsers.length} of ${users.length}.`}
              busy={saving}
              onClose={() => setIsExistingOpen(false)}
            >
              {/* The list only, in the Create user popup's parts: a labelled
                  field, pills, and one card per account. */}
              <div className="users_existing">
                {error ? <div className="settings_error users_popup_error">{error}</div> : null}
                <label className="users_input_field">
                  <span className="users_input_label"><span className="users_input_name"><LevelIcon d={SEARCH_ICON} size={13} />Search</span></span>
                  <span className="users_input_wrap">
                    <input
                      type="search"
                      className="graph_customize_input"
                      aria-label="Search users"
                      value={userSearchQuery}
                      placeholder="Name, role or permission"
                      onChange={(event) => setUserSearchQuery(sanitizeText(event.target.value, { maxLength: 160 }))}
                    />
                    <i className="users_input_state" aria-hidden="true"><LevelIcon d={SEARCH_ICON} size={15} /></i>
                  </span>
                </label>
                <div className="users_filter" role="radiogroup" aria-label="Status filter">
                  {USER_STATUS_FILTERS.map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={userStatusFilter === value} className={'users_pill' + (userStatusFilter === value ? ' is-on' : '')} onClick={() => setUserStatusFilter(value)}>{label}</button>
                  ))}
                </div>
                {filteredUsers.length > 0 ? (
                  <ul className="users_people" aria-label="Users">
                    {filteredUsers.map((user) => {
                      const userId = String(user.id);
                      const modified = isUserDraftModified(user, editDrafts[userId]);
                      const permissionCount = (user.permissions || []).filter((permission) => allPermissions.includes(permission)).length;
                      const active = user.is_active !== false;
                      const self = isSelf(user);
                      const above = outranks(user);
                      return (
                        <li key={user.id} className={'users_person' + (active ? '' : ' is-off')}>
                          <span className="users_level_icon users_person_initial" aria-hidden="true">{String(user.username || '?').trim().charAt(0).toUpperCase() || '?'}</span>
                          <span className="users_level_text">
                            <strong>{user.username}</strong>
                            <small>{[user.display_name, (user.roles || []).join(', ') || 'no role'].filter(Boolean).join(' · ')}</small>
                          </span>
                          {modified ? <em className="users_row_modified" title="This user has unsaved changes">modified</em> : null}
                          {user.is_locked ? <span className="users_row_status"><i aria-hidden="true" />Locked</span> : null}
                          <span className="users_level_count" title="Privileges granted">{permissionCount} of {allPermissions.length}</span>
                          {/* The card's two actions: edit, and active / inactive. */}
                          <button type="button" className="users_person_edit linkx_tooltip_anchor" data-tooltip={above ? 'Changing an admin or superuser needs superuser:manage' : 'Edit'} aria-label={'Edit ' + user.username} disabled={saving || above} onClick={() => openModify(user)}>
                            <LevelIcon d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" size={14} />
                          </button>
                          <label className={'settings_switch users_person_toggle' + (self ? ' is-restricted' : '')} title={self ? 'You cannot deactivate yourself.' : above ? 'Changing an admin or superuser needs superuser:manage.' : active ? 'Active: switch off to deactivate' : 'Inactive: switch on to activate'}>
                            <input type="checkbox" role="switch" aria-label={(active ? 'Deactivate ' : 'Activate ') + user.username} aria-disabled={self || undefined} checked={active} disabled={saving || above} onChange={() => toggleUserActive(user)} />
                            <span aria-hidden="true">{active ? 'Active' : 'Inactive'}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : usersLoading && users.length === 0 ? (
                  <WindowLoadScreen className="is-block" label="Loading users…" />
                ) : (
                  <p className="users_empty" role="status" aria-live="polite">{users.length === 0 ? 'No users to show.' : 'No matching users.'}</p>
                )}
              </div>
            </SettingsPopup>
          );
        }
        return (
          <SettingsPopup
            wide
            title="Existing users"
            subtitle="Review, search, update, or remove accounts"
            hint={activeUser ? (activeModified ? `Unsaved changes to ${activeUser.username}.` : `Editing ${activeUser.username}.`) : 'Select a user to edit its roles, permissions or status.'}
            busy={saving}
            onClose={() => setIsExistingOpen(false)}
            footer={(
              <>
                {activeUser ? (
                  <>
                    <button type="button" className="graph_customize_button users_danger" disabled={saving || isSelf(activeUser)} title={isSelf(activeUser) ? 'You cannot delete your own account.' : undefined} onClick={() => deleteUser(activeUser)}>Delete user</button>
                    <button type="button" className="graph_customize_button" disabled={saving || !activeModified} title="Drop the unsaved changes" onClick={() => updateEditDraft(activeId, userDraftFrom(activeUser))}>Discard</button>
                    <button type="button" className="graph_customize_button is-primary" disabled={saving} onClick={() => saveUser(activeUser)}>{saving ? 'Saving…' : 'Save changes'}</button>
                  </>
                ) : null}
                <button type="button" className="graph_customize_button" disabled={saving} onClick={() => setIsExistingOpen(false)}>Close</button>
              </>
            )}
          >
            {error ? <div className="settings_error users_popup_error">{error}</div> : null}
            {/* The users on the left; the selected one's editor on the right. */}
            <div className="users_browser" aria-label="Existing users browser">
              <div className="users_list_pane">
                <div className="users_list_tools">
                  <input
                    type="search"
                    className="graph_customize_input"
                    aria-label="Search users"
                    value={userSearchQuery}
                    placeholder="Search name, role or permission"
                    onChange={(event) => setUserSearchQuery(sanitizeText(event.target.value, { maxLength: 160 }))}
                  />
                  <select className="graph_customize_input" aria-label="Status filter" value={userStatusFilter} onChange={(event) => setUserStatusFilter(event.target.value)}>
                    <option value="all">All users</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="locked">Locked</option>
                  </select>
                </div>
                <p className="users_list_count">{filteredUsers.length} Matching users</p>
                {filteredUsers.length > 0 ? (
                  <ul className="users_list" role="listbox" aria-label="Users">
                    {filteredUsers.map((user) => {
                      const userId = String(user.id);
                      const isModified = isUserDraftModified(user, editDrafts[userId]);
                      const isCurrent = userId === activeId;
                      const permissionCount = (user.permissions || []).filter((permission) => allPermissions.includes(permission)).length;
                      const pick = () => { setSelectedUserId(userId); setExpandedUserId(userId); };
                      return (
                        <li
                          key={user.id}
                          role="option"
                          aria-selected={isCurrent}
                          tabIndex={0}
                          className={'users_row' + (isCurrent ? ' is-current' : '')}
                          onClick={pick}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              pick();
                            }
                          }}
                        >
                          <span className="users_avatar" aria-hidden="true">{String(user.username || '?').trim().charAt(0).toUpperCase() || '?'}</span>
                          <span className="users_row_main">
                            <strong>{user.username}</strong>
                            <small>{(user.roles || []).join(', ') || 'no role'} · {permissionCount} of {allPermissions.length} privileges</small>
                          </span>
                          {isModified ? <em className="users_row_modified" title="This user has unsaved changes">modified</em> : null}
                          <span className={'users_row_status' + (user.is_active !== false ? ' is-active' : '')} title={user.is_locked ? 'Locked' : user.is_active !== false ? 'Active' : 'Inactive'}>
                            <i aria-hidden="true" />{user.is_active !== false ? 'Active' : 'Inactive'}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="users_empty" role="status" aria-live="polite">{users.length === 0 ? 'No users to show.' : 'No matching users.'}</p>
                )}
              </div>

              <div className="users_detail_pane">
                {activeUser ? (
                  <>
                    <header className="users_detail_header">
                      <span className="users_avatar is-large" aria-hidden="true">{String(activeUser.username || '?').trim().charAt(0).toUpperCase() || '?'}</span>
                      <span className="users_row_main">
                        <strong title="Usernames cannot be changed.">{activeUser.username}</strong>
                        <small>{activeUser.display_name || 'No display name'}</small>
                      </span>
                      {activeModified ? <em className="users_row_modified">modified</em> : null}
                    </header>

                    <section className="users_section" aria-label="User details">
                      <h5 className="graph_customize_section_head">User details</h5>
                      <label className="users_field is-inline">
                        <span>Display name</span>
                        <input
                          className="graph_customize_input"
                          value={activeDraft.display_name ?? activeUser.display_name ?? ''}
                          maxLength={120}
                          onChange={(event) => updateEditDraft(activeId, { display_name: sanitizeText(event.target.value, { maxLength: 120 }) })}
                        />
                      </label>
                      <div className="users_field is-inline">
                        <span>Roles</span>
                        <span className="users_chips" role="group" aria-label={'Roles for ' + activeUser.username}>
                          {Array.from(new Set([...editableRoles, ...(activeUser.roles || [])])).map((role) => {
                            const assignable = editableRoles.includes(role);
                            return (
                              <label key={role} className={'users_chip' + (assignable ? '' : ' is-locked')} title={assignable ? undefined : 'You cannot assign or remove this role.'}>
                                <input type="checkbox" checked={(activeDraft.roles || []).includes(role)} disabled={!assignable} onChange={() => toggleUserRole(activeId, role)} />
                                <span>{role}</span>
                              </label>
                            );
                          })}
                        </span>
                      </div>
                      <div className="users_field is-inline">
                        <span>Status</span>
                        <label className="settings_switch users_status_switch" title={isSelf(activeUser) ? 'You cannot deactivate yourself.' : undefined}>
                          <input type="checkbox" role="switch" checked={!!activeDraft.is_active} disabled={isSelf(activeUser)} onChange={(event) => updateEditDraft(activeId, { is_active: event.target.checked })} />
                          <span>{activeDraft.is_active ? 'Active' : 'Inactive'}</span>
                        </label>
                      </div>
                      <label className="users_field is-inline">
                        <span>Reset password</span>
                        <input
                          className="graph_customize_input"
                          type="password"
                          autoComplete="new-password"
                          placeholder="New password (optional)"
                          value={activeDraft.password || ''}
                          maxLength={256}
                          onChange={(event) => updateEditDraft(activeId, { password: sanitizeSecret(event.target.value, { maxLength: 256 }) })}
                        />
                      </label>
                    </section>

                    {SHOW_PRIVILEGES ? (
                      <PrivilegeTable
                        label="User privileges"
                        all={allPermissions}
                        value={activeDraft.permissions || []}
                        locked={isSelf(activeUser) ? 'users:manage' : ''}
                        onChange={(permissions) => updateEditDraft(activeId, { permissions })}
                      />
                    ) : null}
                  </>
                ) : (
                  <p className="users_empty">Select a user on the left to edit it.</p>
                )}
              </div>
            </div>
          </SettingsPopup>
        );
      })() : null}
    </SettingsPage>
  );
}
