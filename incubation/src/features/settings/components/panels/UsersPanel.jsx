import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';

import PermissionEditor from '../PermissionEditor.jsx';
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
  allPermissions,
  isUserDraftModified,
  normalizeAdminUserList,
  userDraftFrom,
  userPermissionDisplayGroups,
} from '../../lib/settingsModel.js';

export function UsersPanel({ apiFetch, canManageUsers, canManageSuperusers, currentActor, onNotice, requestConfirmation, refreshSignal, initialUiState = {}, onUiStateChange }) {
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
  // Roles this actor may assign (production availableRoles). Other roles a
  // user already holds are shown locked and kept as they are on save.
  const editableRoles = useMemo(() => (canManageSuperusers ? ['superuser', 'admin', 'analyst', 'viewer'] : ['analyst', 'viewer']), [canManageSuperusers]);
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
      // Reloading always discards local edits: drafts mirror the server.
      setEditDrafts(Object.fromEntries(mergedUsers.map((user) => [String(user.id), userDraftFrom(user)])));
    } catch (err) {
      setError(err?.message || 'Failed to load users.');
    }
  }, [apiFetch, canManageUsers, currentActorUser]);

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
    // Closing the editor (Cancel / pencil) drops unsaved edits.
    if (!willExpand) updateEditDraft(userId, userDraftFrom(user));
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
    if (isSelf(user) && (!edit.is_active || !(edit.permissions || []).includes('users:manage'))) {
      setError('You cannot deactivate yourself or remove your own users:manage permission.');
      return;
    }
    const patch = {
      display_name: sanitizeText(edit.display_name ?? user.display_name ?? '', { maxLength: 120 }).trim(),
      roles: Array.from(new Set([
        ...(user.roles || []).filter((role) => !editableRoles.includes(role)),
        ...(edit.roles || []).filter((role) => editableRoles.includes(role)),
      ])),
      permissions: sanitizePermissionList(edit.permissions || []),
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
      setError(err?.message || 'Failed to update user.');
    } finally {
      setSaving(false);
    }
  };

  const deleteUser = async (user) => {
    if (isSelf(user)) {
      setError('You cannot delete your own account.');
      return;
    }
    const confirmed = await requestConfirmation({ title: 'Delete user', message: `Delete user "${user.username}"? This action cannot be undone.`, confirmText: 'Delete', cancelText: 'Cancel' });
    if (!confirmed) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch('/auth/admin/users/' + encodeURIComponent(user.id), { method: 'DELETE' });
      onNotice?.({ title: 'User deleted', message: user.username + ' was removed.', source: 'Admin', level: 'warning' });
      if (expandedUserId === String(user.id)) setExpandedUserId('');
      await loadUsers();
    } catch (err) {
      setError(err?.message || 'Failed to delete user.');
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
                <input className="settings_input" autoComplete="off" value={draft.username} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, username: sanitizeIdentifier(event.target.value, { maxLength: 120 }) }))} />
              </label>
              <label>
                Display name
                <input className="settings_input" value={draft.display_name} maxLength={120} onChange={(event) => setDraft((current) => ({ ...current, display_name: sanitizeText(event.target.value, { maxLength: 120 }) }))} />
              </label>
              <label>
                Password
                <input className="settings_input" type="password" autoComplete="new-password" value={draft.password} maxLength={256} onChange={(event) => setDraft((current) => ({ ...current, password: sanitizeSecret(event.target.value, { maxLength: 256 }) }))} />
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
                const editDraft = editDrafts[userId] || userDraftFrom(user);
                const isModified = isUserDraftModified(user, editDrafts[userId]);
                const isExpanded = expandedUserId === userId;
                // The row shows saved values; the editor shows the draft.
                const selectedPermissionCount = (user.permissions || []).filter((permission) => allPermissions.includes(permission)).length;
                const rowStatusText = user.is_active !== false ? 'Active' : 'Inactive';
                const draftStatusText = editDraft.is_active ? 'Active' : 'Inactive';
                const userInitial = String(user.username || '?').trim().charAt(0).toUpperCase() || '?';

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
                      <span>
                        {user.username}
                        {isModified ? <em className="settings_user_modified" title="This user has unsaved changes"> · modified</em> : null}
                      </span>
                      <small className="settings_user_browser_roles">{(user.roles || []).join(', ') || 'no role'}</small>
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
                        <span className={'settings_user_browser_status_dot' + (user.is_active !== false ? ' is-active' : '')} aria-hidden="true" />
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
                                  value={user.username || ''}
                                  readOnly
                                  title="Usernames cannot be changed."
                                />
                              </label>
                              <label className="settings_user_browser_detail_row">
                                <span>Display name</span>
                                <input
                                  className="settings_input settings_user_browser_input settings_user_browser_table_input"
                                  value={editDraft.display_name ?? user.display_name ?? ''}
                                  maxLength={120}
                                  onChange={(event) => updateEditDraft(userId, { display_name: sanitizeText(event.target.value, { maxLength: 120 }) })}
                                />
                              </label>
                              <div className="settings_user_browser_detail_row">
                                <span>Roles</span>
                                <span className="settings_user_role_list" role="group" aria-label={'Roles for ' + user.username}>
                                  {Array.from(new Set([...editableRoles, ...(user.roles || [])])).map((role) => {
                                    const assignable = editableRoles.includes(role);
                                    return (
                                      <label key={role} className={'settings_user_role_option' + (assignable ? '' : ' is-locked')} title={assignable ? undefined : 'You cannot assign or remove this role.'}>
                                        <input
                                          type="checkbox"
                                          checked={(editDraft.roles || []).includes(role)}
                                          disabled={!assignable}
                                          onChange={() => toggleUserRole(userId, role)}
                                        />
                                        <span>{role}</span>
                                      </label>
                                    );
                                  })}
                                </span>
                              </div>
                              <label className="settings_user_browser_detail_row">
                                <span>Status</span>
                                <span className="settings_user_browser_status_toggle settings_user_browser_table_toggle">
                                  <input
                                    type="checkbox"
                                    checked={!!editDraft.is_active}
                                    disabled={isSelf(user)}
                                    title={isSelf(user) ? 'You cannot deactivate yourself.' : undefined}
                                    onChange={(event) => updateEditDraft(userId, { is_active: event.target.checked })}
                                  />
                                  <small>{draftStatusText}</small>
                                </span>
                              </label>
                              <label className="settings_user_browser_detail_row">
                                <span>Reset password</span>
                                <input
                                  className="settings_input settings_user_browser_input settings_user_browser_table_input"
                                  type="password"
                                  autoComplete="new-password"
                                  placeholder="New password (optional)"
                                  value={editDraft.password || ''}
                                  maxLength={256}
                                  onChange={(event) => updateEditDraft(userId, { password: sanitizeSecret(event.target.value, { maxLength: 256 }) })}
                                />
                              </label>
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
                                        disabled={isSelf(user) && permission === 'users:manage'}
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
                        <div className="settings_user_browser_editor_actions">
                          <span className="settings_permission_quick_actions">
                            <button type="button" className="settings_link_button" onClick={() => updateEditDraft(userId, { permissions: [...allPermissions] })}>Select all privileges</button>
                            <span aria-hidden="true">·</span>
                            <button type="button" className="settings_link_button" onClick={() => updateEditDraft(userId, { permissions: isSelf(user) ? ['users:manage'] : [] })}>Clear</button>
                          </span>
                          <button type="button" className="settings_button is-danger" disabled={saving || isSelf(user)} title={isSelf(user) ? 'You cannot delete your own account.' : undefined} onClick={() => deleteUser(user)}>Delete user</button>
                          <button type="button" className="settings_button" disabled={saving} onClick={() => toggleUserEditor(user)}>Cancel</button>
                          <button type="button" className="settings_button" disabled={saving} onClick={() => saveUser(user)}>{saving ? 'Saving…' : 'Save changes'}</button>
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
