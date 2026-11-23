import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { THEME_COMPONENT_CATEGORIES } from './themeCategories.js';
import { CONFIGURATION_THEME_CATEGORIES } from './configurationThemeTokens.js';

// The project root, from this file (src/shared/theme).
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheet = read('src/styles/themes/configuration-tokens.css');
const settingsSheet = read('src/styles/themes/settings-tokens.css');
const defined = Object.fromEntries([...sheet.matchAll(/(--config-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const listed = CONFIGURATION_THEME_CATEGORIES.flatMap((category) => category.tokens.map((token) => token.key));

describe('the Configuration window theme tokens', () => {
  it('lists each token once, and every listed token has a value in the token sheet', () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.filter((key) => !(key in defined))).toEqual([]);
    expect(Object.keys(defined).filter((key) => !listed.includes(key))).toEqual([]);
  });

  it('is offered by the Theme Studio, with a label for every token', () => {
    const ids = THEME_COMPONENT_CATEGORIES.map((category) => category.id);
    CONFIGURATION_THEME_CATEGORIES.forEach((category) => {
      expect(ids).toContain(category.id);
      category.tokens.forEach((token) => expect(token.label.trim()).not.toBe(''));
    });
  });

  it('starts every frame and page token as a Settings token that exists', () => {
    Object.entries(defined).filter(([key]) => /^--config-(?:frame|page)-/.test(key)).forEach(([, value]) => {
      expect(value).toMatch(/^var\(--settings-[\w-]+\)$/);
      expect(settingsSheet).toMatch(new RegExp(`${value.slice(4, -1)}\\s*:`));
    });
  });

  it('gives a value to every Configuration token the style sheets use, and scopes the frame to them', () => {
    const styles = read('src/styles/features/configuration.css');
    const used = new Set([...styles.matchAll(/var\((--config-[\w-]+)/g)].map((match) => match[1]));
    expect([...used].filter((name) => !(name in defined))).toEqual([]);
    const scope = styles.match(/\.configuration_theme_scope\s*\{([^}]*)\}/)[1];
    const aliased = [...scope.matchAll(/(--[\w-]+)\s*:\s*var\((--config-(?:frame|page)-[\w-]+)\)/g)].map((match) => match[2]);
    const scoped = listed.filter((key) => /^--config-(?:frame|page)-/.test(key));
    expect(aliased.slice().sort()).toEqual(scoped.slice().sort());
    // The rest (a tab's own parts) are read where they are used.
    listed.filter((key) => !scoped.includes(key)).forEach((key) => expect(used.has(key), key).toBe(true));
  });
});
