// Minimal i18n layer: t('key', vars) and plural-aware tn('key', count, vars).
// Only English ships today; add a catalog and call setLocale() to translate.
// Missing keys fall back to the key itself so gaps are visible, not fatal.
import en from './en.js';

const catalogs = { en };
let locale = 'en';
let pluralRules = new Intl.PluralRules(locale);

export const setLocale = (next) => {
  if (!catalogs[next]) return;
  locale = next;
  pluralRules = new Intl.PluralRules(next);
};

export const registerCatalog = (name, messages) => {
  catalogs[name] = { ...(catalogs[name] || {}), ...messages };
};

const format = (template, vars = {}) => String(template).replace(/\{(\w+)\}/g, (match, name) => (
  vars[name] === undefined ? match : String(vars[name])
));

const lookup = (key) => catalogs[locale]?.[key] ?? catalogs.en[key];

export const t = (key, vars) => {
  const entry = lookup(key);
  if (entry === undefined) return key;
  return format(typeof entry === 'object' ? (entry.other ?? '') : entry, vars);
};

export const tn = (key, count, vars = {}) => {
  const entry = lookup(key);
  if (entry === undefined) return key;
  if (typeof entry !== 'object') return format(entry, { count, ...vars });
  const category = pluralRules.select(Number(count) || 0);
  return format(entry[category] ?? entry.other ?? '', { count: Number(count || 0).toLocaleString(locale), ...vars });
};
