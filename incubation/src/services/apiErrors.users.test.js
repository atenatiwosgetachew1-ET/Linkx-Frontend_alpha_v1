import { describe, expect, it } from 'vitest';

import { getUserAdminErrorMessage } from './apiErrors.js';

const refused = (data, status = 400) => ({ status, data: { message: 'validation_error', ...data } });

describe('getUserAdminErrorMessage', () => {
  it('words known detail codes', () => {
    expect(getUserAdminErrorMessage(refused({ detail: 'username_taken' }))).toBe('That username is already taken.');
    expect(getUserAdminErrorMessage(refused({ detail: 'password_too_weak' }))).toMatch(/password rules/);
    expect(getUserAdminErrorMessage(refused({ detail: 'unknown_permissions' }))).toMatch(/permission is not accepted/);
    expect(getUserAdminErrorMessage(refused({ detail: 'invalid_roles' }))).toMatch(/role is not accepted/);
  });

  it('shows other codes, sentences and field lists instead of "validation_error"', () => {
    expect(getUserAdminErrorMessage(refused({ detail: 'email_required' }))).toBe('The Service refused it: Email required.');
    expect(getUserAdminErrorMessage(refused({ detail: 'Display name is too long.' }))).toBe('Display name is too long.');
    expect(getUserAdminErrorMessage(refused({ invalid_fields: ['permissions', 'is_active'] }))).toBe('The Service refused these fields: permissions, is active.');
    expect(getUserAdminErrorMessage(refused({ detail: [{ loc: ['body', 'roles'], msg: 'bad' }] }))).toBe('The Service refused these fields: roles.');
    expect(getUserAdminErrorMessage(refused({}), 'The user could not be created.')).toBe('The user could not be created. The Service said the request was invalid but gave no reason.');
  });

  it('handles conflicts and permission refusals', () => {
    expect(getUserAdminErrorMessage({ status: 409, data: { message: 'conflict' } })).toBe('That username is already taken.');
    expect(getUserAdminErrorMessage({ status: 403, data: { message: 'forbidden', permission: 'users:manage' } })).toMatch(/users:manage/);
  });

  it('words the Service’s codes, with its reason (B-33)', () => {
    expect(getUserAdminErrorMessage({ status: 409, data: { code: 'self_lockout', message: 'conflict' } })).toMatch(/lock you out/);
    expect(getUserAdminErrorMessage(refused({ code: 'permissions_not_assignable', detail: 'x y' }))).toMatch(/come from the role/);
    expect(getUserAdminErrorMessage(refused({ code: 'password_policy', detail: 'At least 8 characters.' }))).toMatch(/password rules\. At least 8 characters\./);
    expect(getUserAdminErrorMessage({ status: 403, data: { code: 'role_scope_exceeded', message: 'forbidden' } })).toBe('Your account cannot give that role.');
  });
});
