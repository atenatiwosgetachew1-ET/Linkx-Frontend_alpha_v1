import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { RIGHT_PANEL_THEME_TOKENS } from './rightPanelThemeTokens.js';
import { THEME_COMPONENT_CATEGORIES } from './themeCategories.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const defined = new Map([...read('src/styles/themes/right-panel-tokens.css').matchAll(/(--right-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2]]));
const styles = read('src/styles/features/right-panel.css');

describe('the right panel page tokens', () => {
  it('are listed, defined alike and used', () => {
    expect([...defined.keys()].sort()).toEqual(RIGHT_PANEL_THEME_TOKENS.map((token) => token.key).sort());
    RIGHT_PANEL_THEME_TOKENS.forEach((token) => {
      expect(token.default).toBe(defined.get(token.key));
      expect(styles).toContain(`var(${token.key})`);
    });
    const category = THEME_COMPONENT_CATEGORIES.find((item) => item.id === 'right_workspace');
    const keys = category.tokens.map((token) => token.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(expect.arrayContaining([...defined.keys()]));
  });

  it('leave no colour written in the pages themselves', () => {
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
