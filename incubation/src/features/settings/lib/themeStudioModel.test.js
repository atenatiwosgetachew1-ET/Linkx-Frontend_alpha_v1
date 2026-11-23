import { describe, expect, it } from 'vitest';

import { THEME_COMPONENT_CATEGORIES } from '../../../shared/theme/themeCategories.js';
import { STUDIO_AREAS, categoryTitle, collectTokens, groupCategories, plainName, tokenGroups, tokenMatches } from './themeStudioModel.js';

describe('the Theme Studio layout', () => {
  it('places every category under exactly one area, none left in "Other"', () => {
    const areas = groupCategories(THEME_COMPONENT_CATEGORIES);
    expect(areas.map((area) => area.id)).toEqual(STUDIO_AREAS.map((area) => area.id));
    const placed = areas.flatMap((area) => area.categories.map((category) => category.id));
    expect(placed.slice().sort()).toEqual(THEME_COMPONENT_CATEGORIES.map((category) => category.id).sort());
  });

  it('keeps a category no area names, under "Other"', () => {
    const areas = groupCategories([{ id: 'brand_new', name: 'New', tokens: [] }]);
    expect(areas).toHaveLength(1);
    expect(areas[0].id).toBe('other');
  });

  it('shows names without their emoji, and Settings parts without the prefix', () => {
    expect(plainName('🏠 Background & Central Workspace')).toBe('Background & Central Workspace');
    expect(categoryTitle({ name: '⚙️ Settings — Window Frame' }, { id: 'settings' })).toBe('Window Frame');
    expect(categoryTitle({ name: '🗂️ Tasks Window' }, { id: 'windows' })).toBe('Tasks Window');
  });

  it('groups a category’s tokens without losing or repeating any', () => {
    THEME_COMPONENT_CATEGORIES.forEach((category) => {
      const groups = tokenGroups(category.tokens);
      const keys = groups.flatMap((group) => group.tokens.map((token) => token.key));
      expect(keys.slice().sort()).toEqual(category.tokens.map((token) => token.key).sort());
      expect(new Set(groups.map((group) => group.name)).size).toBe(groups.length);
      if (groups.length > 1) groups.forEach((group) => expect(group.name).not.toBe(''));
    });
  });

  it('leaves a short category as one list, uses `group` where given, else the labels', () => {
    const short = Array.from({ length: 5 }, (_, index) => ({ key: `--a-${index}`, label: `Thing — ${index}` }));
    expect(tokenGroups(short)).toEqual([{ name: '', tokens: short }]);

    const token = (key, label, group) => ({ key, label, group });
    const named = [...Array.from({ length: 10 }, (_, index) => token(`--b-${index}`, `B ${index}`, 'Frame')), ...Array.from({ length: 10 }, (_, index) => token(`--c-${index}`, `C ${index}`))];
    expect(tokenGroups(named).map((group) => [group.name, group.tokens.length])).toEqual([['General', 10], ['Frame', 10]]);

    const labelled = [
      ...Array.from({ length: 9 }, (_, index) => token(`--d-${index}`, `Footer button — part ${index}`)),
      token('--d-footer', 'Footer — text'),
      ...Array.from({ length: 9 }, (_, index) => token(`--e-${index}`, `Tab (hover) — part ${index}`)),
      token('--lonely', 'Header — text'),
    ];
    expect(tokenGroups(labelled).map((group) => [group.name, group.tokens.length])).toEqual([['General', 1], ['Footer', 10], ['Tab', 9]]);
  });

  it('searches labels, keys and group names across every category', () => {
    expect(tokenMatches({ key: '--app-bg', label: 'Page Background' }, 'app-bg')).toBe(true);
    expect(tokenMatches({ key: '--x', label: 'Fill', group: 'Window Footer' }, 'footer')).toBe(true);
    expect(tokenMatches({ key: '--x', label: 'Fill' }, 'footer')).toBe(false);
    const found = collectTokens(groupCategories(THEME_COMPONENT_CATEGORIES), (token) => tokenMatches(token, 'footer'));
    expect(found.length).toBeGreaterThan(1);
    found.forEach((entry) => expect(entry.tokens.length).toBeGreaterThan(0));
  });
});
