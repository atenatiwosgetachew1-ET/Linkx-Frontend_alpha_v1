import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { BENCHMARK_THEME_CATEGORIES } from './benchmarkThemeTokens.js';
import { THEME_COMPONENT_CATEGORIES } from './themeCategories.js';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const defined = [...read('src/styles/themes/benchmark-tokens.css').matchAll(/(--bench-[\w-]+)\s*:/g)].map((match) => match[1]);
const styles = read('src/styles/features/benchmark.css');
const listed = BENCHMARK_THEME_CATEGORIES.flatMap((category) => category.tokens.map((token) => token.key));

describe('the graph benchmark tokens', () => {
  it('are listed, defined and used, each once', () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(defined.slice().sort()).toEqual(listed.slice().sort());
    const used = new Set([...styles.matchAll(/var\((--[\w-]+)/g)].map((match) => match[1]));
    expect([...used].sort()).toEqual(listed.slice().sort());
    expect(THEME_COMPONENT_CATEGORIES.map((category) => category.id)).toContain('graph_benchmark');
  });

  it('leave no colour written in the page itself', () => {
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});
