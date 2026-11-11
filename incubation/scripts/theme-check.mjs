#!/usr/bin/env node
/**
 * Theme integrity check: `npm run theme:check`
 *
 * Errors (exit 1):
 *  - registry theme without a CSS file / not imported in themes/index.css
 *  - theme missing any semantic token (semantic tier = tokens of nbe-daylight.css :root block)
 *  - custom-property reference cycles
 * Warnings:
 *  - var(--x) used without fallback and never defined
 *  - Theme Studio (themeCategories.js) keys that no CSS defines
 * Info:
 *  - component tokens still holding literal colors (candidates for semantic mapping)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const themesDir = join(root, 'src/styles/themes');
const read = (p) => readFileSync(p, 'utf8');
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const declsOf = (css) => {
  const out = new Map();
  for (const m of stripComments(css).matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
};

const { THEMES, DEFAULT_THEME_ID } = await import(join(root, 'src/shared/theme/themeRegistry.js'));
const { THEME_COMPONENT_CATEGORIES } = await import(join(root, 'src/shared/theme/themeCategories.js'));

const errors = [];
const warnings = [];

const indexCss = read(join(themesDir, 'index.css'));
const defaultCss = stripComments(read(join(themesDir, `${DEFAULT_THEME_ID}.css`)));
const semanticBlock = defaultCss.match(/:root[^{]*\{([\s\S]*?)\}/);
const semantic = [...declsOf(semanticBlock ? semanticBlock[1] : '').keys()];

for (const theme of THEMES) {
  const file = join(themesDir, `${theme.id}.css`);
  if (!existsSync(file)) { errors.push(`theme "${theme.id}": missing src/styles/themes/${theme.id}.css`); continue; }
  if (!indexCss.includes(`'./${theme.id}.css'`)) errors.push(`theme "${theme.id}": not imported in themes/index.css`);
  if (theme.id === DEFAULT_THEME_ID) continue;
  const defined = declsOf(read(file));
  const missing = semantic.filter((k) => !defined.has(k));
  if (missing.length) errors.push(`theme "${theme.id}": missing ${missing.length} semantic token(s): ${missing.join(', ')}`);
}

// Collect every definition and usage across theme files + stylesheets + JSX/JS.
const cssFiles = [
  ...readdirSync(themesDir).filter((f) => f.endsWith('.css')).map((f) => join(themesDir, f)),
  join(root, 'src/main.css'),
  join(root, 'src/index.css'),
];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (
  e.isDirectory() ? walk(join(dir, e.name)) : /\.(jsx?|css)$/.test(e.name) ? [join(dir, e.name)] : []
));
const sources = [...new Set([...cssFiles, ...walk(join(root, 'src'))])];

const defined = new Set();
const graph = new Map();
const unresolved = new Map();
const referenced = new Set();
for (const file of sources) {
  const text = stripComments(read(file));
  for (const [k, v] of declsOf(text)) {
    defined.add(k);
    const refs = graph.get(k) || new Set();
    for (const m of v.matchAll(/var\((--[\w-]+)/g)) refs.add(m[1]);
    graph.set(k, refs);
  }
  // JS may set variables via setProperty('--x') / style objects (the Studio catalog itself doesn't count).
  if (!file.endsWith('themeCategories.js')) for (const m of text.matchAll(/['"`](--[\w-]+)['"`]\s*[:,)]/g)) defined.add(m[1]);
  for (const m of text.matchAll(/var\((--[\w-]+)/g)) referenced.add(m[1]);
  for (const m of text.matchAll(/var\((--[\w-]+)\s*\)/g)) {
    if (!unresolved.has(m[1])) unresolved.set(m[1], file.replace(root + '/', ''));
  }
}
const undefinedVars = [...unresolved].filter(([k]) => !defined.has(k));
if (undefinedVars.length) {
  warnings.push(`${undefinedVars.length} var() reference(s) without fallback are never defined:\n` +
    undefinedVars.map(([k, f]) => `    ${k}  (${f})`).join('\n'));
}

// Cycle detection over custom-property references.
const state = new Map();
const cycles = [];
const visit = (node, path) => {
  state.set(node, 1);
  for (const next of graph.get(node) || []) {
    if (state.get(next) === 1) cycles.push([...path, next].join(' -> '));
    else if (!state.has(next)) visit(next, [...path, next]);
  }
  state.set(node, 2);
};
for (const node of graph.keys()) if (!state.has(node)) visit(node, [node]);
cycles.forEach((c) => errors.push(`custom property cycle: ${c}`));

const studioKeys = THEME_COMPONENT_CATEGORIES.flatMap((c) => (c.tokens || []).map((t) => t.key));
// Keys that are neither defined nor consumed by any var() are dead Studio controls.
const studioMissing = [...new Set(studioKeys)].filter((k) => !defined.has(k) && !referenced.has(k));
if (studioMissing.length) warnings.push(`${studioMissing.length} Theme Studio key(s) have no effect (never defined or used): ${studioMissing.join(', ')}`);

const componentTokens = declsOf(read(join(themesDir, 'tokens.css')));
const literal = [...componentTokens].filter(([, v]) => !v.includes('var(') && /#[0-9a-f]{3,8}\b|rgba?\(/i.test(v));

console.log(`Themes: ${THEMES.length} | semantic tokens: ${semantic.length} | component tokens: ${componentTokens.size} (${literal.length} literal colors)`);
warnings.forEach((w) => console.warn(`warn  ${w}`));
errors.forEach((e) => console.error(`error ${e}`));
console.log(errors.length ? `\n✖ ${errors.length} error(s), ${warnings.length} warning(s)` : `\n✔ themes OK (${warnings.length} warning(s))`);
process.exit(errors.length ? 1 : 0);
