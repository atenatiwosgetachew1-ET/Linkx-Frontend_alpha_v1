import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { THEME_COMPONENT_CATEGORIES } from './themeCategories.js';
import { SOURCE_THEME_CATEGORIES } from './sourceThemeTokens.js';
import { SOURCE_FRAME_CLASS, SOURCE_RESTYLED } from '../../features/source/lib/sourceFrame.js';

// The project root, from this file (src/shared/theme).
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const sheet = read('src/styles/themes/source-tokens.css');
const settingsSheet = read('src/styles/themes/settings-tokens.css');
const styles = read('src/styles/features/source-restyle.css');
const flowStyles = read('src/styles/features/source-start-flow.css') + read('src/styles/features/source-results.css') + read('src/styles/features/source-storage.css') + read('src/styles/features/source-broker.css') + read('src/styles/features/source-elastic.css');
const defined = Object.fromEntries([...sheet.matchAll(/(--source-(?:frame|start|flow|storage|table|broker|elastic)-[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
const listed = SOURCE_THEME_CATEGORIES.flatMap((category) => category.tokens.map((token) => token.key));
const tokensOf = (id) => SOURCE_THEME_CATEGORIES.find((category) => category.id === id).tokens.map((token) => token.key);

describe('the Source window frame restyle', () => {
  it('lists each frame token once, with a value, offered by the Theme Studio', () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.filter((key) => !(key in defined))).toEqual([]);
    expect(Object.keys(defined).filter((key) => !listed.includes(key))).toEqual([]);
    expect(THEME_COMPONENT_CATEGORIES.map((category) => category.id)).toContain('source_frame');
  });

  it('starts every frame token as a Settings frame token that exists, and scopes the frame to them', () => {
    tokensOf('source_frame').map((key) => defined[key]).forEach((value) => {
      expect(value).toMatch(/^var\(--settings-frame-[\w-]+\)$/);
      expect(settingsSheet).toMatch(new RegExp(`${value.slice(4, -1)}\\s*:`));
    });
    const scope = styles.match(/\.source_theme_scope\s*\{([^}]*)\}/)[1];
    const aliased = [...scope.matchAll(/(--[\w-]+)\s*:\s*var\((--source-frame-[\w-]+)\)/g)].map((match) => match[2]);
    expect(aliased.slice().sort()).toEqual(tokensOf('source_frame').slice().sort());
  });

  it('uses every first-page token, and no token without a value', () => {
    const used = new Set([...(styles + flowStyles).matchAll(/var\((--source-(?:frame|start|flow|storage|table|broker|elastic)-[\w-]+)/g)].map((match) => match[1]));
    expect([...used].filter((name) => !(name in defined))).toEqual([]);
    [...tokensOf('source_start'), ...tokensOf('source_flow'), ...tokensOf('source_storage'), ...tokensOf('source_table'), ...tokensOf('source_broker'), ...tokensOf('source_elastic')].forEach((key) => expect(used.has(key), key).toBe(true));
  });

  it('is one switch: every rule of it needs a class the switch adds', () => {
    expect(SOURCE_FRAME_CLASS).toBe(SOURCE_RESTYLED ? ' is-restyled source_theme_scope' : '');
    // Each selector in the sheet is under .is-restyled or .source_theme_scope,
    // so with the switch off nothing in it can match.
    const selectors = styles.replace(/@keyframes[^{]*\{[^{}]*\{[^{}]*\}\s*\}/g, '').replace(/@media[^{]*\{/g, '').split('}').map((block) => block.split('{')[0].trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(10);
    selectors.forEach((group) => group.split(',').forEach((selector) => {
      expect(selector, selector).toMatch(/\.is-restyled|\.source_theme_scope/);
    }));
    // The first page's own sheet reaches nothing but that page.
    const flow = flowStyles.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, '').replace(/@(?:media|container)[^{]*\{/g, '').split('}').map((block) => block.split('{')[0].trim()).filter(Boolean);
    expect(flow.length).toBeGreaterThan(30);
    flow.forEach((group) => group.split(',').forEach((selector) => expect(selector, selector).toMatch(/\.source_window_flow\b/)));
  });
});
