import React from 'react';

import { sanitizePermissionList } from '../../../utils/inputSecurity.js';
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from '../../../auth/permissions.js';


// Grouped permission checkboxes with "Select all · Clear" (production
// PermissionEditor + quick actions). Clicking a group title toggles the group.
export default function PermissionEditor({ value = [], onChange, idPrefix = 'permissions', disabled = false, disabledHint = '' }) {
  const selected = new Set(Array.isArray(value) ? value : []);
  const emit = (next) => onChange(sanitizePermissionList(Array.from(next).sort()));
  const toggle = (permission) => {
    if (disabled) return;
    const next = new Set(selected);
    if (next.has(permission)) next.delete(permission);
    else next.add(permission);
    emit(next);
  };
  const toggleGroup = (items) => {
    if (disabled) return;
    const next = new Set(selected);
    const all = items.every((item) => next.has(item));
    items.forEach((item) => (all ? next.delete(item) : next.add(item)));
    emit(next);
  };

  return (
    <div className="settings_permission_editor" title={disabled ? disabledHint : undefined}>
      <div className="settings_permission_editor_header">
        <span>Permissions ({selected.size} selected)</span>
        {disabled ? (
          <small>{disabledHint || 'Locked'}</small>
        ) : (
          <span className="settings_permission_quick_actions">
            <button type="button" className="settings_link_button" onClick={() => emit(new Set([...selected, ...ALL_PERMISSIONS]))}>Select all</button>
            <span aria-hidden="true">·</span>
            <button type="button" className="settings_link_button" onClick={() => emit(new Set([...selected].filter((permission) => !ALL_PERMISSIONS.includes(permission))))}>Clear</button>
          </span>
        )}
      </div>
      <div className="settings_permission_grid">
        {PERMISSION_GROUPS.map((group) => {
          const count = group.items.filter((item) => selected.has(item)).length;
          return (
            <fieldset className="settings_permission_group" key={group.label} disabled={disabled}>
              <legend>
                <button type="button" className="settings_link_button" onClick={() => toggleGroup(group.items)} title="Toggle every permission in this group">
                  {group.label} <small>{count}/{group.items.length}</small>
                </button>
              </legend>
              <div className="settings_permission_list">
                {group.items.map((permission) => {
                  const inputId = `${idPrefix}_${permission.replace(/[^a-z0-9]/gi, '_')}`;
                  return (
                    <label className="settings_permission_option" htmlFor={inputId} key={permission}>
                      <input id={inputId} type="checkbox" checked={selected.has(permission)} onChange={() => toggle(permission)} />
                      <span>{permission}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </div>
  );
}
