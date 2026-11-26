// Rules library: the rule sets the session can use. Managed in the Libraries
// window (upload / remove); the Configuration window only picks the active
// rule. Same backend requests as production's Configuration panel
// (src/App.jsx: upload ~17491 multipart id=save + rule_file, remove ~17594
// id=remove_rule), so nothing changes on the backend.

import {
  buildConfigurationSavePayload,
  withoutColumnLists,
  checkIsBuiltinRule,
  getRuleItemName,
  getRuleNames,
  normalizeActiveRuleValue,
  normalizeLoadedConfiguration,
} from '../../configuration/lib/configModel.js';

// Configuration keys that describe the rule catalogue.
export const RULE_KEYS = ['rules', 'rule_names', 'active_rule', 'builtin_rules', 'custom_rules', 'uploaded_rules', 'default_rules', 'builtin_rule_names', 'system_rules', 'default_rule_names', 'user_rules'];

export const pickRuleKeys = (configuration) => RULE_KEYS.reduce(
  (acc, key) => (configuration?.[key] !== undefined ? { ...acc, [key]: configuration[key] } : acc),
  {},
);

export const hasRuleCatalogue = (configuration) => getRuleNames(configuration).length > 0;

// Rules the backend refused to remove because they are built in. Learned from
// its error messages (production knownBuiltinRules), shared by both windows.
// Cleared on sign-out with the rest of the workspace session data.
let knownBuiltin = new Set();
const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export const subscribeKnownBuiltinRules = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getKnownBuiltinRules = () => knownBuiltin;
export const rememberBuiltinRules = (names = []) => {
  const clean = names.map((name) => String(name || '').trim()).filter(Boolean);
  if (!clean.length) return;
  knownBuiltin = new Set([...knownBuiltin, ...clean, ...clean.map((name) => name.toLowerCase())]);
  emit();
};
export const clearKnownBuiltinRules = () => {
  knownBuiltin = new Set();
  emit();
};

// "rule 'X' is built-in…" → X (plus the rule the user tried to remove).
export const builtinNamesFromMessage = (message, ruleName) => {
  const match = String(message || '').match(/rule\s+'([^']+)'/i);
  return [match?.[1], ruleName].filter(Boolean);
};

// One entry per loaded rule, for the library list.
export const describeRules = (configuration, known = knownBuiltin) => {
  const active = normalizeActiveRuleValue(configuration?.active_rule);
  return getRuleNames(configuration)
    .map((item) => {
      const name = getRuleItemName(item).trim();
      return name ? { name, builtin: checkIsBuiltinRule(item, configuration, known), active: name === active } : null;
    })
    .filter(Boolean);
};

// The multipart upload carries the configuration form like production. From
// the Libraries window that is the session's confirmed configuration (never
// the Configuration window's unsaved draft), with its current domain.
export const buildRuleUploadFields = (sessionConfiguration) => {
  const config = normalizeLoadedConfiguration(sessionConfiguration || {});
  // Column lists sent here would become the user's own (round 3, C1 12).
  const fields = withoutColumnLists(buildConfigurationSavePayload(config));
  ['domain', 'active_domain'].forEach((key) => {
    if (config[key]) fields[key] = config[key];
  });
  return fields;
};

export const RULE_TEMPLATE_PATH = '/api/v1/rules/template';
export const RULE_TEMPLATE_FILE = 'Linkx_Rules_Template.zip';
