import { describe, expect, it } from 'vitest';

import { getVisibleLauncherItems } from './launcherItems.js';

const ids = (can) => getVisibleLauncherItems(can).map((item) => item.id);

describe('launcher permissions (production canAccess)', () => {
  it('shows every item to a user with all permissions', () => {
    expect(ids(() => true)).toEqual(['source', 'graph', 'chart', 'table', 'reports', 'tasks', 'libraries', 'configuration', 'settings']);
  });

  it('hides Source, Graph, Reports and Configuration without their permissions', () => {
    expect(ids(() => false)).toEqual(['chart', 'table', 'tasks', 'libraries', 'settings']);
  });

  it('uses the production permission per item', () => {
    const granted = new Set(['source:create', 'config:read']);
    expect(ids((permission) => granted.has(permission))).toEqual(['source', 'chart', 'table', 'tasks', 'libraries', 'configuration', 'settings']);
  });
});
