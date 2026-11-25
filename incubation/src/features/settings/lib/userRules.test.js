import { expect, it } from 'vitest';

import { normalizeUserRules } from './userRules.js';

it.each([
  [{ roles: { permissions: { analyst: ['a:b'] } } }],
  [{ results: { roles: { permissions: { analyst: ['a:b'] } } } }],
  [{ roles: [{ name: 'analyst', permissions: [{ key: 'a:b' }] }] }],
  [{ roles: { analyst: { permissions: ['a:b'] } } }],
])('reads a role’s permissions: %j', (data) => {
  expect(normalizeUserRules(data).permissions).toEqual({ analyst: ['a:b'] });
});

it('what cannot be read is null', () => {
  [null, {}, { roles: ['analyst'] }, { roles: 'x' }, []].forEach((data) => expect(normalizeUserRules(data).permissions).toBeNull());
});

it('reads which roles may be given', () => {
  expect(normalizeUserRules({ message: 'success', results: { roles: { assignable: ['analyst', 'viewer'], permissions: { analyst: ['a:b'] } } } }).assignable).toEqual(['analyst', 'viewer']);
  expect(normalizeUserRules({}).assignable).toBeNull();
});
