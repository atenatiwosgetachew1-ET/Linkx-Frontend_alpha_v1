import { expect, it } from 'vitest';

import { resolveSourceDefaults } from './sourceConfig.js';

it('one’s own columns come before the domain’s; without an override the domain’s do', () => {
  const config = { domain: 'bank', domain_connections: { bank: { search_columns_strict: ['DOMAIN'] } }, search_columns_strict: ['MINE'] };
  expect(resolveSourceDefaults({ ...config, columns_origins: { search_columns_strict: 'override' } }).search.strictColumns).toEqual(['MINE']);
  expect(resolveSourceDefaults({ ...config, columns_origins: { search_columns_strict: 'admin' } }).search.strictColumns).toEqual(['DOMAIN']);
});
