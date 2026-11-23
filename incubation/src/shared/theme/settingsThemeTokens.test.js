import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { THEME_COMPONENT_CATEGORIES } from './themeCategories.js';
import { SETTINGS_THEME_CATEGORIES } from './settingsThemeTokens.js';

// The project root, from this file (src/shared/theme).
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheet = read('src/styles/themes/settings-tokens.css');
const defined = Object.fromEntries([...sheet.matchAll(/(--settings-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const listed = SETTINGS_THEME_CATEGORIES.flatMap((category) => category.tokens.map((token) => token.key));
const references = (value) => [...value.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]);

describe('the Settings window theme tokens', () => {
  it('lists each token once, and every listed token has a value in the token sheet', () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.filter((key) => !(key in defined))).toEqual([]);
    expect(Object.keys(defined).filter((key) => !listed.includes(key))).toEqual([]);
  });

  it('is offered by the Theme Studio, with a label for every token', () => {
    const ids = THEME_COMPONENT_CATEGORIES.map((category) => category.id);
    SETTINGS_THEME_CATEGORIES.forEach((category) => {
      expect(ids).toContain(category.id);
      category.tokens.forEach((token) => expect(token.label.trim()).not.toBe(''));
    });
  });

  it('has no token that depends on itself', () => {
    const loops = (key, path = []) => {
      if (path.includes(key)) return true;
      return key in defined && references(defined[key]).some((next) => loops(next, [...path, key]));
    };
    expect(Object.keys(defined).filter((key) => loops(key))).toEqual([]);
  });

  it('gives a value to every Settings token the style sheets use', () => {
    // Set where they are used, per component or per page: not root tokens.
    const local = ['--settings-hairline', '--settings-state', '--settings-stats-columns'];
    const base = read('src/styles/themes/tokens.css');
    const used = new Set(['src/styles/features/settings.css', 'src/main.css'].flatMap((path) => references(read(path)).filter((name) => name.startsWith('--settings-'))));
    const missing = [...used].filter((name) => !(name in defined) && !local.includes(name) && !new RegExp(`${name}\\s*:`).test(base));
    expect(missing).toEqual([]);
  });

  it('keeps the Settings window from reading other windows’ variables for its frame and popups', () => {
    const styles = read('src/styles/features/settings.css');
    const scope = styles.match(/\.settings_theme_scope\s*\{([^}]*)\}/)[1];
    const popup = styles.match(/\.settings_popup_backdrop\s*\{([^}]*)\}/)[1];
    [...scope.matchAll(/(--[\w-]+)\s*:\s*var\((--[\w-]+)\)/g)].forEach(([, , target]) => expect(target in defined).toBe(true));
    ['--customize-accent', '--graph-text', '--graph-muted-text', '--graph-border', '--graph-toolbar-bg'].forEach((name) => {
      expect(popup).toMatch(new RegExp(`${name}\\s*:\\s*var\\(--settings-popup-`));
    });
  });
});
