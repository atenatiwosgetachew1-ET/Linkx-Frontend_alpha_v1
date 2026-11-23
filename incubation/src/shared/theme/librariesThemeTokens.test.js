import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { THEME_COMPONENT_CATEGORIES } from './themeCategories.js';
import { LIBRARIES_THEME_CATEGORIES } from './librariesThemeTokens.js';

// The project root, from this file (src/shared/theme).
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheet = read('src/styles/themes/libraries-tokens.css');
const sources = read('src/styles/themes/settings-tokens.css') + read('src/styles/themes/configuration-tokens.css');
const defined = Object.fromEntries([...sheet.matchAll(/(--libraries-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const listed = LIBRARIES_THEME_CATEGORIES.flatMap((category) => category.tokens.map((token) => token.key));
const tokensOf = (id) => LIBRARIES_THEME_CATEGORIES.find((category) => category.id === id).tokens.map((token) => token.key);

describe('the Libraries window theme tokens', () => {
  it('lists each token once, and every listed token has a value in the token sheet', () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.filter((key) => !(key in defined))).toEqual([]);
    expect(Object.keys(defined).filter((key) => !listed.includes(key))).toEqual([]);
  });

  it('is offered by the Theme Studio, with a label for every token', () => {
    const ids = THEME_COMPONENT_CATEGORIES.map((category) => category.id);
    LIBRARIES_THEME_CATEGORIES.forEach((category) => {
      expect(ids).toContain(category.id);
      category.tokens.forEach((token) => expect(token.label.trim()).not.toBe(''));
    });
  });

  it('starts the frame, page and form tokens as a Settings or Configuration token that exists', () => {
    [...tokensOf('libraries_frame'), ...tokensOf('libraries_pages'), ...tokensOf('libraries_forms')].forEach((key) => {
      expect(defined[key]).toMatch(/^var\(--(?:settings|config)-[\w-]+\)$/);
      expect(sources).toMatch(new RegExp(`${defined[key].slice(4, -1)}\\s*:`));
    });
  });

  it('scopes the window to those tokens, and uses the rest where they are read', () => {
    const styles = read('src/styles/features/configuration.css');
    const scope = styles.match(/\.libraries_theme_scope\s*\{([^}]*)\}/)[1];
    const aliased = [...scope.matchAll(/(--[\w-]+)\s*:\s*var\((--libraries-[\w-]+)\)/g)].map((match) => match[2]);
    const scoped = [...tokensOf('libraries_frame'), ...tokensOf('libraries_pages'), ...tokensOf('libraries_forms')];
    expect(aliased.slice().sort()).toEqual(scoped.slice().sort());
    const used = new Set([...styles.matchAll(/var\((--libraries-[\w-]+)/g)].map((match) => match[1]));
    expect([...used].filter((name) => !(name in defined))).toEqual([]);
    tokensOf('libraries_parts').forEach((key) => expect(used.has(key), key).toBe(true));
  });
});
