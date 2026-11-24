// Configuration model shared by the Configuration window and the session.
// Ported from the production app (src/App.jsx): parseConfigurationValue,
// normalizeLoadedConfiguration, buildConfigurationSavePayload,
// normalizeConfigurationStatePatch and their helpers, so both apps read and
// write the backend configuration identically.

import { sanitizeConnectionValue, sanitizeText } from '../../../utils/inputSecurity.js';
import { getApiProblemPayload, getApiProblemStatus, getSharedApiErrorMessage, sanitizeBackendUserMessage } from '../../../services/apiErrors.js';

export const CONFIG_SECRET_FIELD_KEYS = ['active_tool_password', 'tool_password', 'neo4j_password', 'postgres_password', 'api_secret', 'api_key'];
export const CONFIG_SECRET_REF_KEYS = {
  active_tool_password: ['active_tool_password_ref', 'tool_password_ref', 'password_ref'],
  tool_password: ['tool_password_ref', 'active_tool_password_ref', 'password_ref'],
  neo4j_password: ['neo4j_password_ref', 'password_ref'],
  postgres_password: ['postgres_password_ref', 'password_ref'],
  api_secret: ['api_secret_ref', 'secret_ref'],
  api_key: ['api_key_ref', 'key_ref'],
};
export const CONFIG_SECRET_MASK_PATTERN = /^\*+$/;

export const LIST_FIELDS = ['storage_tables', 'active_tool_tables', 'search_columns_fuzzy', 'search_columns_strict', 'fetch_columns'];

const LARGE_SEARCH_BACKENDS = new Set(['hive', 'elastic_scroll']);
const DEFAULT_LARGE_SEARCH_BACKEND = 'hive';
const DEFAULT_ELASTIC_SCROLL_LIMIT = 1000000;

const DOMAIN_PILLAR_LABELS = {
  bank: 'Banking',
  banking: 'Banking',
  microfinance: 'Microfinance',
  cdr: 'Call Data Records (CDR)',
  telecom: 'Telecommunications',
  insurance: 'Insurance',
  social_media: 'Social Media',
  fintech: 'Fintech & Digital Wallets',
  enterprise: 'Enterprise & Corporate Ledger',
};

export const DEFAULT_REGISTERED_DOMAINS = ['bank', 'microfinance', 'cdr', 'insurance', 'social_media'];

export const getActiveDomainKey = (config) => String(config?.active_domain || config?.domain || 'bank').trim().toLowerCase();

export const formatDomainPillarLabel = (domainKey) => {
  const cleanKey = String(domainKey || '').trim().toLowerCase();
  if (DOMAIN_PILLAR_LABELS[cleanKey]) return DOMAIN_PILLAR_LABELS[cleanKey];
  if (!cleanKey) return 'Banking';
  return cleanKey.charAt(0).toUpperCase() + cleanKey.slice(1).replace(/_/g, ' ');
};

// Every domain the Service names: its registry and the domains it sends
// connections for (either list can be the shorter one), plus the active one.
// Two keys with the same name ("bank", "banking") are one domain.
export const getRegisteredDomains = (config) => {
  const registered = Array.isArray(config?.registered_domains) ? config.registered_domains : [];
  const connections = config?.domain_connections && typeof config.domain_connections === 'object' ? Object.keys(config.domain_connections) : [];
  const named = [...registered, ...connections].filter((key) => typeof key === 'string' && key.trim());
  if (!named.length) return DEFAULT_REGISTERED_DOMAINS;
  const active = getActiveDomainKey(config);
  const byLabel = new Map();
  [...named, active].forEach((key) => {
    const label = formatDomainPillarLabel(key);
    if (!byLabel.has(label) || key === active) byLabel.set(label, key);
  });
  return [...byLabel.values()];
};

export const extractConfigurationPayload = (data) => (
  data?.results?.configuration ??
  data?.results?.configurations ??
  data?.results?.data ??
  data?.configuration ??
  data?.configurations ??
  data?.data ??
  null
);

export const parseConfigurationValue = (value) => {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value.replace(/'/g, '"'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  if (value.value) {
    if (typeof value.value === 'object') return value.value;
    if (typeof value.value === 'string') {
      try {
        const parsed = JSON.parse(String(value.value).replace(/'/g, '"'));
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch {
        return {};
      }
    }
  }
  return typeof value === 'object' ? value : {};
};

export const normalizeBooleanConfigValue = (value) => value === true || value === 'true';

export const normalizeElasticScrollLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_ELASTIC_SCROLL_LIMIT;
  return parsed;
};

export const normalizeLargeSearchBackend = (value) => (
  LARGE_SEARCH_BACKENDS.has(String(value || '')) ? String(value) : DEFAULT_LARGE_SEARCH_BACKEND
);

export const isConfigAutoFillEnabled = (configuration) => {
  const config = parseConfigurationValue(configuration);
  if (config?.auto_fill_fields === undefined || config?.auto_fill_fields === null || config?.auto_fill_fields === '') return true;
  return config.auto_fill_fields === true || config.auto_fill_fields === 'true';
};

const normalizeConfigAddressList = (value) => {
  const source = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.trim()
      ? value.split(',')
      : [];
  const seen = new Set();
  const items = [];
  source.forEach((item) => {
    const normalized = sanitizeConnectionValue(item, { maxLength: 300 });
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    items.push(normalized);
  });
  return items;
};

// A typed "custom" value becomes the active option and joins the list.
const mergeConfigAddressOptions = ({ list, activeValue, pendingValue }) => {
  const existing = normalizeConfigAddressList(list);
  const active = sanitizeConnectionValue(activeValue, { maxLength: 300 });
  const pending = sanitizeConnectionValue(pendingValue, { maxLength: 300 });
  const preferred = pending || active || existing[0] || '';
  const merged = normalizeConfigAddressList([
    ...(preferred ? [preferred] : []),
    ...(active ? [active] : []),
    ...existing,
  ]);
  return { list: merged, active: preferred, pending };
};

const ADDRESS_GROUPS = [
  { list: 'kafka_addresses', active: 'active_kafka_adress', custom: 'kafka_custom_address' },
  { list: 'kafka_topics', active: 'active_kafka_topic', custom: 'kafka_custom_topic' },
  { list: 'storage_addresses', active: 'active_storage_address', custom: 'storage_custom_address' },
];

const parseJsonArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const normalizeTrustedListEntries = (value, { preserveEmpty = false } = {}) => parseJsonArray(value).map((item) => {
  if (Array.isArray(item)) {
    return {
      key: sanitizeText(item[0] ?? '', { maxLength: 160 }),
      value: sanitizeText(item[1] ?? '', { maxLength: 500 }),
    };
  }
  if (!item || typeof item !== 'object') return { key: '', value: '', name: '' };
  if (['key', 'value', 'name', 'data'].some((field) => Object.prototype.hasOwnProperty.call(item, field))) {
    return {
      key: sanitizeText(item.key ?? item.name ?? '', { maxLength: 160 }),
      value: sanitizeText(item.value ?? item.data ?? '', { maxLength: 500 }),
      category: item.category,
      pass_through: item.pass_through,
      name: item.name || '',
    };
  }
  const validEntry = Object.entries(item).find(([entryKey, entryValue]) => (
    !['category', 'pass_through', 'name'].includes(entryKey) && ['string', 'number', 'boolean'].includes(typeof entryValue)
  ));
  if (!validEntry) return { key: '', value: '', category: item.category, pass_through: item.pass_through, name: item.name || '' };
  return {
    key: sanitizeText(validEntry[0] ?? '', { maxLength: 160 }),
    value: sanitizeText(validEntry[1] ?? '', { maxLength: 500 }),
    category: item.category,
    pass_through: item.pass_through,
    name: item.name || '',
  };
}).filter((item) => preserveEmpty || item.key !== '' || item.value !== '');

const isTrue = (value) => value === true || String(value) === 'true';

// Trusted + risk lists are edited as one "classified entities" table.
export const normalizeClassifiedEntityEntries = (trustedValue, riskValue, { value, preserveEmpty = false } = {}) => {
  if (value !== undefined) {
    return parseJsonArray(value).map((item) => ({
      key: sanitizeText(item?.key ?? item?.name ?? '', { maxLength: 160 }),
      value: sanitizeText(item?.value ?? item?.data ?? '', { maxLength: 500 }),
      category: item?.category ? String(item.category) : 'Trusted',
      pass_through: isTrue(item?.pass_through),
      name: item?.name ? String(item.name) : '',
    })).filter((item) => preserveEmpty || item.key !== '' || item.value !== '');
  }
  const tag = (entries, fallbackCategory) => entries.map((item) => ({
    ...item,
    category: item.category || fallbackCategory,
    pass_through: isTrue(item.pass_through),
    name: item.name || '',
  }));
  return [
    ...tag(normalizeTrustedListEntries(trustedValue, { preserveEmpty: true }), 'Trusted'),
    ...tag(normalizeTrustedListEntries(riskValue, { preserveEmpty: true }), 'Risk'),
  ].filter((item) => preserveEmpty || item.key !== '' || item.value !== '');
};

export const readClassifiedEntities = (config) => normalizeClassifiedEntityEntries(
  config?.trusted_entities ?? config?.trusted_catalog ?? config?.trusted_list ?? config?.trustedList ?? config?.active_tool_trusted_list,
  config?.risk_entities ?? config?.riskEntities ?? config?.active_risk_entities,
  { value: config?.classified_entities ?? config?.classifiedEntities, preserveEmpty: true },
);

const splitClassifiedEntityEntries = (entries) => normalizeClassifiedEntityEntries(null, null, { value: entries })
  .reduce((acc, item) => {
    if (!item.key) return acc;
    const out = { key: item.key, value: item.value, category: item.category || 'Trusted', pass_through: item.pass_through === true };
    if (item.name) out.name = item.name;
    acc[item.category === 'Risk' ? 'risk_entities' : 'trusted_entities'].push(out);
    return acc;
  }, { trusted_entities: [], risk_entities: [] });

export const normalizeColumnMappingEntries = (value, { preserveEmpty = false } = {}) => {
  if (Array.isArray(value)) {
    return value
      .map((entry) => ({ key: String(entry?.key || ''), value: String(entry?.value || '') }))
      .filter((item) => preserveEmpty || item.key !== '' || item.value !== '');
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value)
    .map(([key, val]) => ({ key: String(key || ''), value: String(val || '') }))
    .filter((item) => preserveEmpty || item.key !== '' || item.value !== '');
};

export const normalizeConfigurationFieldValue = (name, value) => {
  if (LIST_FIELDS.includes(name)) {
    return Array.isArray(value) ? value : String(value || '').split(',').map((item) => item.trimStart());
  }
  if (name === 'classified_entities') return normalizeClassifiedEntityEntries(null, null, { value, preserveEmpty: true });
  if (name === 'column_mapping') return normalizeColumnMappingEntries(value, { preserveEmpty: true });
  if (name === 'large_search_backend') return normalizeLargeSearchBackend(value);
  if (name === 'elastic_scroll_enabled') return normalizeBooleanConfigValue(value);
  if (name === 'elastic_scroll_limit') return normalizeElasticScrollLimit(value);
  return value;
};

// Applies one field edit to a configuration draft (production "change" action).
export const applyConfigurationChange = (previous, name, value) => {
  const normalizedValue = normalizeConfigurationFieldValue(name, value);
  const next = { ...parseConfigurationValue(previous), [name]: normalizedValue };
  if (name === 'active_tool_url') next.active_tool_protocol = normalizedValue;
  if (name === 'active_domain') next.domain = normalizedValue;
  if (name === 'domain') next.active_domain = normalizedValue;
  if (name === 'large_search_backend') next.elastic_scroll_enabled = normalizedValue === 'elastic_scroll';
  if (name === 'elastic_scroll_enabled') next.large_search_backend = normalizedValue ? 'elastic_scroll' : 'hive';
  return next;
};

// Masks secrets and folds pending "custom" values into their option lists.
export const normalizeLoadedConfiguration = (payload) => {
  if (!payload) return {};
  const parsed = { ...parseConfigurationValue(payload) };
  CONFIG_SECRET_FIELD_KEYS.forEach((key) => {
    const value = parsed[key];
    if (value && typeof value === 'object') {
      const refValue = value.password_ref || value.passwordRef || value.secret_ref || value.secretRef || value.ref;
      const refKey = CONFIG_SECRET_REF_KEYS[key]?.[0];
      if (refValue && refKey && !parsed[refKey]) parsed[refKey] = refValue;
      parsed[key] = String(value.value || value.masked || value.mask || '***');
    } else if (value !== undefined && value !== null) {
      parsed[key] = String(value);
    }
  });
  ADDRESS_GROUPS.forEach((group) => {
    const state = mergeConfigAddressOptions({
      list: parsed[group.list],
      activeValue: parsed[group.active],
      pendingValue: parsed[group.custom],
    });
    parsed[group.list] = state.list;
    if (state.active) parsed[group.active] = state.active;
    parsed[group.custom] = '';
  });
  if (parsed.auto_fill_fields === undefined || parsed.auto_fill_fields === null || parsed.auto_fill_fields === '') {
    parsed.auto_fill_fields = true;
  }
  if (parsed.domain && !parsed.active_domain) parsed.active_domain = parsed.domain;
  if (parsed.active_domain && !parsed.domain) parsed.domain = parsed.active_domain;
  return parsed;
};

// The backend owns the domain registry and does not echo it on save/switch;
// keep the previously known registry so the domain list doesn't collapse.
const DOMAIN_REGISTRY_KEYS = ['registered_domains', 'domain_connections', 'domains'];
const hasMeaningfulValue = (value) => {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return false;
};
export const preserveDomainRegistry = (prev, next) => {
  if (!next || typeof next !== 'object' || !prev || typeof prev !== 'object') return next;
  const merged = { ...next };
  DOMAIN_REGISTRY_KEYS.forEach((key) => {
    if (!hasMeaningfulValue(next[key]) && hasMeaningfulValue(prev[key])) merged[key] = prev[key];
  });
  return merged;
};

// Body for { id: 'save', configuration }: secrets that are still masked, secret
// refs and the backend-owned domain registry are stripped.
export const buildConfigurationSavePayload = (configuration) => {
  const { value: _value, active_tool_password_clear: clearToolPassword, ...rest } = parseConfigurationValue(configuration);
  CONFIG_SECRET_FIELD_KEYS.forEach((key) => {
    const textValue = String(rest[key] ?? '').trim();
    if (rest[key] === undefined || rest[key] === null || textValue === '' || CONFIG_SECRET_MASK_PATTERN.test(textValue)) delete rest[key];
  });
  Object.values(CONFIG_SECRET_REF_KEYS).flat().forEach((key) => { delete rest[key]; });
  delete rest.tool_credentials;
  // Explicit "Clear password" (backend request B-2: null clears).
  if (clearToolPassword) rest.active_tool_password = null;
  delete rest.domain_connections;
  delete rest.registered_domains;

  const largeSearchBackend = normalizeLargeSearchBackend(rest.large_search_backend);
  const classified = normalizeClassifiedEntityEntries(
    rest.trusted_entities ?? rest.trusted_catalog ?? rest.trusted_list ?? rest.trustedList ?? rest.active_tool_trusted_list,
    rest.risk_entities ?? rest.riskEntities ?? rest.active_risk_entities,
    { value: rest.classified_entities ?? rest.classifiedEntities },
  );
  const split = splitClassifiedEntityEntries(classified);
  rest.trusted_entities = split.trusted_entities;
  rest.risk_entities = split.risk_entities;
  ['trusted_catalog', 'trusted_list', 'trustedList', 'active_tool_trusted_list', 'classified_entities', 'classifiedEntities'].forEach((key) => { delete rest[key]; });

  if (rest.column_mapping) {
    rest.column_mapping = normalizeColumnMappingEntries(rest.column_mapping).reduce((acc, entry) => {
      if (entry.key) acc[entry.key] = entry.value;
      return acc;
    }, {});
  }

  ADDRESS_GROUPS.forEach((group) => {
    const state = mergeConfigAddressOptions({
      list: rest[group.list],
      activeValue: rest[group.active],
      pendingValue: rest[group.custom],
    });
    rest[group.list] = state.list;
    rest[group.active] = state.active;
    rest[group.custom] = '';
  });

  LIST_FIELDS.forEach((field) => {
    if (Array.isArray(rest[field])) rest[field] = rest[field].map((item) => String(item).trim()).filter(Boolean);
  });

  return {
    ...rest,
    large_search_backend: largeSearchBackend,
    elastic_scroll_enabled: largeSearchBackend === 'elastic_scroll',
    elastic_scroll_limit: normalizeElasticScrollLimit(rest.elastic_scroll_limit),
  };
};

export const getRuleNames = (config) => {
  if (Array.isArray(config?.rule_names) && config.rule_names.length > 0) return config.rule_names;
  if (Array.isArray(config?.rules) && config.rules.length > 0) return config.rules;
  if (config?.rules && typeof config.rules === 'object') return Object.keys(config.rules);
  return [];
};

export const getRuleItemName = (ruleItem) => (
  ruleItem && typeof ruleItem === 'object'
    ? String(ruleItem.name || ruleItem.rule_name || ruleItem.id || '')
    : String(ruleItem ?? '')
);

export const normalizeActiveRuleValue = (value) => {
  if (Array.isArray(value)) return String(value[0] || '');
  return typeof value === 'string' ? value : '';
};

const BUILTIN_TYPES = new Set(['builtin', 'built-in', 'default', 'system']);
const hasBuiltinFlag = (item) => Boolean(item) && typeof item === 'object' && (
  item.is_builtin === true || item.builtin === true || item.is_default === true || item.default === true ||
  BUILTIN_TYPES.has(String(item.type || item.origin || item.source || item.category || '').trim().toLowerCase())
);
const listItemName = (item) => (item && typeof item === 'object' ? String(item.name || item.rule_name || item.id || '') : String(item));

export const checkIsBuiltinRule = (ruleItem, config, knownBuiltinRules) => {
  const name = getRuleItemName(ruleItem).trim();
  if (!name) return false;
  const lowerName = name.toLowerCase();
  if (knownBuiltinRules?.has?.(name) || knownBuiltinRules?.has?.(lowerName)) return true;
  if (hasBuiltinFlag(ruleItem)) return true;
  if (!config || typeof config !== 'object') return false;

  const candidates = [config.builtin_rules, config.default_rules, config.builtin_rule_names, config.system_rules, config.default_rule_names];
  for (const list of candidates) {
    if (Array.isArray(list) && list.some((item) => listItemName(item).trim().toLowerCase() === lowerName)) return true;
    if (list && typeof list === 'object' && !Array.isArray(list) && Object.keys(list).some((key) => key.trim().toLowerCase() === lowerName)) return true;
    if (typeof list === 'string' && list.split(',').map((part) => part.trim().toLowerCase()).includes(lowerName)) return true;
  }
  if (config.rules && typeof config.rules === 'object' && !Array.isArray(config.rules) && hasBuiltinFlag(config.rules[name] || config.rules[lowerName])) return true;

  const customList = config.custom_rules || config.uploaded_rules || config.user_rules;
  if (Array.isArray(customList) && customList.length > 0) {
    return !customList.some((item) => listItemName(item).trim().toLowerCase() === lowerName);
  }
  return false;
};

export const getConfigurationErrorMessage = (input, fallback = 'Could not save configuration. Try again.') => {
  const payload = getApiProblemPayload(input);
  const status = getApiProblemStatus(input);
  const message = String(payload?.message || '').trim().toLowerCase();
  const detail = String(payload?.detail || '').trim();
  const field = String(payload?.field || '').trim();
  const resultsText = typeof payload?.results === 'string' ? payload.results.trim() : '';
  if (resultsText) return sanitizeBackendUserMessage(resultsText, resultsText);
  if (status === 400 && message === 'validation_error' && detail === 'json_object_required') return 'Configuration payload must be an object.';
  if (status === 400 && message === 'validation_error' && field === 'trusted_entities') return 'Trusted entities are invalid.';
  if (status === 400 && message === 'validation_error' && field === 'risk_entities') return 'Risk entities are invalid.';
  if (message === 'failed!' && String(payload?.error || '') === 'rule_upload_failed') return 'Rule upload failed.';
  if (status === 500 && message === 'failed!' && String(payload?.error || '') === 'configuration_load_failed') return 'Could not load configuration. Try again.';
  if (detail && !/^(json_object_required|internal_server_error)$/i.test(detail)) return detail;
  return getSharedApiErrorMessage(input, fallback);
};

/* ── Detection sensitivity defaults (production constants) ───────────── */

export const DEFAULT_BANK_TYPOLOGIES = {
  SANCTIONED_ENTITY_MATCH: 100, HIGH_RISK_LINK: 50, PEP_INVOLVED: 50, FRAUD_AGGREGATOR: 50,
  CIRCULAR_FLOW: 30, EFFECTIVE_FLOW: 25, RAPID_WITHDRAWAL: 25, DORMANT_TO_ACTIVE: 25,
  SMURFING: 20, SHARED_IDENTIFIER: 20, JUST_BELOW_THRESHOLD: 20, LATE_NIGHT_TX: 15,
  ACCOUNT_ACTIVITY_SPIKE: 15, HUB_AND_SPOKE: 10, RAPID_FAN_OUT: 10, ABNORMAL_BALANCE_CHANGE: 10, FUND_FLOW: 10,
};

export const DEFAULT_CDR_TYPOLOGIES = {
  HIGH_RISK_CONTACT: 50, SIM_BOX_DISTRIBUTION: 45, WANGIRI_FRAUD: 40, IMEI_SWAP_DETECTION: 35,
  STAR_PATTERN: 30, SHORT_DURATION_BURST: 25, LOCATION_JUMP: 25, CALL_RELAY: 25,
  SIMULTANEOUS_CALL: 20, NIGHT_ACTIVITY: 20, FREQUENT_CONTACT: 15, CALLBACK_PATTERN: 15,
  CALL_SEQUENCE: 10, FAN_OUT: 10, FAN_IN: 10, MISSED_CALL_SIGNAL: 10, LONG_DURATION_CALL: 10,
};

export const DEFAULT_BANK_NODE_THRESHOLDS = [
  { min_nodes: 10000, add_points: 30 }, { min_nodes: 5000, add_points: 20 },
  { min_nodes: 1000, add_points: 10 }, { min_nodes: 100, add_points: 5 },
];
export const DEFAULT_CDR_NODE_THRESHOLDS = [
  { min_nodes: 100, add_points: 30 }, { min_nodes: 50, add_points: 20 },
  { min_nodes: 20, add_points: 10 }, { min_nodes: 5, add_points: 5 },
];
export const DEFAULT_BANK_MONEY_THRESHOLDS = [
  { min_amount: 10000000, add_points: 40 }, { min_amount: 5000000, add_points: 30 },
  { min_amount: 1000000, add_points: 20 }, { min_amount: 500000, add_points: 10 },
];
export const DEFAULT_CDR_DURATION_THRESHOLDS = [
  { min_amount: 7200, add_points: 30 }, { min_amount: 3600, add_points: 20 },
  { min_amount: 900, add_points: 10 }, { min_amount: 300, add_points: 5 },
];

export const DEFAULT_BANK_THRESHOLDS = {
  hub_spoke_min_single_amount: 500.0, abnormal_balance_min_tx_amount: 1000.0, just_below_threshold_min_count: 2,
  just_below_threshold_ratio: 0.9, global_min_anomaly_amount: 100.0, late_night_min_amount: 500.0,
  circular_flow_min_amount: 200.0, rapid_withdrawal_min_amount: 250.0, hub_spoke_min_amount: 500.0,
  activity_spike_min_amount: 500.0, abnormal_balance_min_change: 500.0, fund_flow_min_amount: 200.0,
  circular_flow_amount_tolerance: 0.05, circular_flow_check_amounts: false, rapid_withdrawal_amount_tolerance: 0.1,
  hub_spoke_min_counterparties: 3, activity_spike_multiplier: 3.0, activity_spike_min_daily_count: 10,
  fund_flow_hub_threshold: 1000.0, fund_flow_max_downstream: 5, reporting_threshold: 300000.0,
  smurfing_single_tx_threshold: 300000.0, smurfing_cumulative_threshold: 900000.0, smurfing_min_tx_count: 3,
  late_night_start: 2300, late_night_end: 400,
};

export const DEFAULT_CDR_THRESHOLDS = {
  frequent_contact_min_calls: 5, call_sequence_max_gap_seconds: 300, callback_max_gap_seconds: 86400,
  call_relay_max_gap_seconds: 1800, simultaneous_call_window_seconds: 15, short_duration_burst_seconds: 15,
  short_duration_burst_min_calls: 3, long_duration_call_seconds: 1800, night_activity_start: 2300,
  night_activity_end: 500, star_pattern_min_contacts: 5, fan_out_min_targets: 15, fan_in_min_sources: 15,
  location_jump_max_hours: 2, sim_box_min_calls: 10, sim_box_max_avg_duration: 15, imei_swap_min_devices: 3,
  wangiri_max_duration_seconds: 3, wangiri_min_calls: 3,
};

// Field layout for the threshold form: [legend, [[key, label, {min,max,step,hint}]...]].
export const BANK_THRESHOLD_GROUPS = [
  ['Global baseline floor', [
    ['global_min_anomaly_amount', 'Universal minimum anomaly floor (amount)', { min: 0, max: 10000000, step: 0.1, hint: 'Transactions below this value will not trigger anomalies unless a rule-specific threshold overrides it.' }],
  ]],
  ['Per-rule amount floors (false positive suppression)', [
    ['late_night_min_amount', 'Late night min amount', { min: 0, max: 10000000, step: 0.1, hint: 'Late night transactions below this amount will not be flagged.' }],
    ['circular_flow_min_amount', 'Circular flow min amount', { min: 0, max: 10000000, step: 0.1, hint: 'Minimum leg amount required to participate in circular flow detection.' }],
    ['rapid_withdrawal_min_amount', 'Rapid withdrawal min amount', { min: 0, max: 10000000, step: 0.1, hint: 'Minimum transfer value before the rapid withdrawal ratio is evaluated.' }],
    ['hub_spoke_min_amount', 'Hub & spoke min amount', { min: 0, max: 10000000, step: 0.1, hint: 'Minimum total volume distributed across counterparties before an account is flagged as a hub.' }],
    ['activity_spike_min_amount', 'Activity spike min daily volume', { min: 0, max: 10000000, step: 0.1, hint: 'Daily transaction volume must exceed this value for activity spike alerts.' }],
    ['abnormal_balance_min_change', 'Abnormal balance min change', { min: 0, max: 10000000, step: 0.1, hint: 'Minimum balance fluctuation required to evaluate abnormal balance behaviour.' }],
    ['abnormal_balance_min_tx_amount', 'Min transaction amount for balance check', { min: 0, max: 10000000, step: 0.1, hint: 'Only transactions at or above this amount are evaluated against the historical balance baseline.' }],
    ['fund_flow_min_amount', 'Fund flow / layering min amount', { min: 0, max: 10000000, step: 0.1, hint: 'Minimum amount to trace multi-hop fund flow pass-throughs.' }],
  ]],
  ['Structural & ratio settings', [
    ['circular_flow_amount_tolerance', 'Circular flow amount tolerance (0.01 – 1.0)', { min: 0.01, max: 1, step: 0.01 }],
    ['circular_flow_check_amounts', 'Circular flow check amounts', { type: 'checkbox' }],
    ['rapid_withdrawal_amount_tolerance', 'Rapid withdrawal tolerance (0.01 – 0.5)', { min: 0.01, max: 0.5, step: 0.01 }],
    ['hub_spoke_min_counterparties', 'Hub & spoke min counterparties (2 – 50)', { min: 2, max: 50 }],
    ['hub_spoke_min_single_amount', 'Min spoke transaction amount', { min: 0, max: 10000000, step: 0.1, hint: 'Minimum individual transaction size to be considered a spoke.' }],
    ['activity_spike_multiplier', 'Activity spike multiplier (1.5 – 20.0)', { min: 1.5, max: 20, step: 0.1 }],
    ['activity_spike_min_daily_count', 'Activity spike min daily count (3 – 1000)', { min: 3, max: 1000 }],
    ['fund_flow_hub_threshold', 'Fund flow hub limit', { min: 0 }],
    ['fund_flow_max_downstream', 'Fund flow max downstream hops (1 – 50)', { min: 1, max: 50 }],
  ]],
  ['Regulatory limits & operating hours', [
    ['just_below_threshold_min_count', 'Min repeated structuring count', { min: 1, max: 50, hint: 'Transactions in the near-CTR band an account must perform before structuring is flagged.' }],
    ['just_below_threshold_ratio', 'Threshold proximity ratio', { min: 0.5, max: 0.99, step: 0.01, hint: 'Lower bound as a share of the reporting threshold (0.90 = 90% of the CTR limit).' }],
    ['reporting_threshold', 'Reporting threshold (CTR)', { min: 0 }],
    ['smurfing_single_tx_threshold', 'Smurfing single tx threshold', { min: 0 }],
    ['smurfing_cumulative_threshold', 'Smurfing cumulative threshold', { min: 0 }],
    ['smurfing_min_tx_count', 'Smurfing min tx count', { min: 2 }],
    ['late_night_start', 'Late night window start (HHmm)', { min: 0, max: 2359 }],
    ['late_night_end', 'Late night window end (HHmm)', { min: 0, max: 2359 }],
  ]],
];

export const CDR_THRESHOLD_GROUPS = [
  ['Call patterns & relays', [
    ['frequent_contact_min_calls', 'Min frequent call count (calls)', { min: 1, max: 1000, hint: 'Calls between two numbers before flagging a frequent contact cluster.' }],
    ['call_sequence_max_gap_seconds', 'Max gap between sequential calls (sec)', { min: 1, max: 86400 }],
    ['callback_max_gap_seconds', 'Max callback window (sec)', { min: 1, max: 604800 }],
    ['call_relay_max_gap_seconds', 'Max relay window (sec)', { min: 1, max: 86400 }],
    ['simultaneous_call_window_seconds', 'Max multi-call window (sec)', { min: 1, max: 300 }],
  ]],
  ['Durations & night activity', [
    ['short_duration_burst_seconds', 'Burst duration threshold (sec)', { min: 1, max: 300 }],
    ['short_duration_burst_min_calls', 'Min burst call count (calls)', { min: 1, max: 50 }],
    ['long_duration_call_seconds', 'Long call duration (sec)', { min: 60, max: 86400 }],
    ['night_activity_start', 'Night window start (HHmm)', { min: 0, max: 2359 }],
    ['night_activity_end', 'Night window end (HHmm)', { min: 0, max: 2359 }],
  ]],
  ['Network dispersion & towers', [
    ['star_pattern_min_contacts', 'Star hub min contacts', { min: 2, max: 100 }],
    ['fan_out_min_targets', 'Min fan-out outbound numbers', { min: 2, max: 500 }],
    ['fan_in_min_sources', 'Min fan-in inbound callers', { min: 2, max: 500 }],
    ['location_jump_max_hours', 'Max hours for cell tower jump', { min: 1, max: 72 }],
  ]],
  ['Telecom fraud & telephony exploits', [
    ['sim_box_min_calls', 'SIM box min outbound calls', { min: 1, max: 1000 }],
    ['sim_box_max_avg_duration', 'SIM box max avg duration (sec)', { min: 1, max: 120 }],
    ['imei_swap_min_devices', 'IMEI swap min distinct handsets', { min: 2, max: 20 }],
    ['wangiri_max_duration_seconds', 'Wangiri missed call max ring (sec)', { min: 1, max: 10 }],
    ['wangiri_min_calls', 'Wangiri min victim calls', { min: 1, max: 100 }],
  ]],
];
