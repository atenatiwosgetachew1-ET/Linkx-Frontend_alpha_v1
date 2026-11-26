// Domain profiles (superuser, round 4, B-49): what may be typed, what changed.
// The Service checks everything again; this only says why before sending.

// Lower case letters, digits and `_`, 2 to 40 characters (round 4 §4).
export const DOMAIN_ID_PATTERN = /^[a-z0-9_]{2,40}$/;
// Names that go into graph queries and storage: letters, digits, `_` (§3).
export const PLAIN_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
export const DISPLAY_NAME_MAX = 120;
export const DESCRIPTION_MAX = 1000;
export const REASON_MAX = 500;

// Ids the Service already reads as a domain (R2-22).
export const DOMAIN_ALIASES = ['banking', 'mfi', 'mobile_banking', 'telecom', 'telecoms', 'call_data_records', 'insurances', 'social', 'tweeter'];

// Never editable from a screen (§3): refused as field_not_editable anyway.
export const NEVER_EDITABLE = new Set(['domain_id', 'relationships', 'rule_code']);

// The profile's fields, by the Service's names (round 4 answer §4: the
// names the configuration already uses), in the order shown.
export const PROFILE_FIELDS = [
  ['display_name', 'Display name', 'What every screen calls the domain. No two domains share one.'],
  ['description', 'Description', 'What the domain is for.'],
  ['rule_set', 'Rule set', 'The detection rules new runs use. Running runs keep theirs.'],
  ['default_source_col', 'Source column', 'The node a relationship starts from in the graph.'],
  ['default_target_col', 'Target column', 'The node a relationship ends at.'],
  ['default_relationship', 'Relationship name', 'The name of the link between them.'],
  ['neo4j_node_label', 'Node label', 'The label of the nodes in the graph.'],
  ['date_column', 'Date column', 'A field the column mapping fills or the data has.'],
  ['storage_databases', 'Storage databases', 'One per line. The address and login stay in the connection settings.'],
  ['active_storage_database', 'Storage database in use', 'One of the storage databases.'],
  ['storage_tables', 'Storage tables', 'One per line.'],
  ['active_storage_tables', 'Storage tables in use', 'Some of the storage tables.'],
  ['storage_path', 'Storage path', 'Where the domain’s files are kept.'],
];
const FIELD_LABELS = Object.fromEntries(PROFILE_FIELDS.map(([key, label]) => [key, label]));
export const fieldLabel = (key) => FIELD_LABELS[key] || String(key).replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

const PLAIN_NAME_FIELDS = ['default_source_col', 'default_target_col', 'default_relationship', 'neo4j_node_label', 'storage_databases', 'active_storage_database', 'storage_tables', 'active_storage_tables'];
const isPlainNameField = (key, meta) => meta?.type === 'name' || meta?.type === 'names' || PLAIN_NAME_FIELDS.includes(key);
export const isListField = (key, meta, value) => meta?.type === 'list' || meta?.type === 'names' || Array.isArray(value);

// A value as typed (lists: one per line) -> what is sent.
export const parseFieldInput = (key, meta, input, current) => {
  if (meta?.type === 'integer' || meta?.type === 'number') return input === '' ? null : Number(input);
  if (meta?.type === 'boolean') return Boolean(input);
  if (isListField(key, meta, current)) return String(input).split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  return String(input);
};
export const fieldInputText = (value) => (Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value));

// -> the reason a value is refused, or ''.
// null: back to the built-in value (a built-in domain's field, round 4 §4).
export const fieldProblem = (key, meta = {}, value) => {
  const label = fieldLabel(key);
  if (value === null && meta.type !== 'integer' && meta.type !== 'number') return '';
  if (meta.type === 'integer' || meta.type === 'number') {
    if (value === null || !Number.isFinite(value)) return `${label} must be a number.`;
    if (meta.type === 'integer' && !Number.isInteger(value)) return `${label} must be a whole number.`;
    if (meta.min != null && value < meta.min) return `${label} is at least ${meta.min}.`;
    if (meta.max != null && value > meta.max) return `${label} is at most ${meta.max}.`;
    return '';
  }
  if (meta.type === 'boolean') return '';
  const items = Array.isArray(value) ? value : [value];
  if (meta.required && (Array.isArray(value) ? !value.length : !String(value ?? '').trim())) return `${label} cannot be empty.`;
  if (meta.maxItems != null && Array.isArray(value) && value.length > meta.maxItems) return `${label}: at most ${meta.maxItems}.`;
  if (meta.allowed && items.some((item) => !meta.allowed.includes(String(item)))) return `${label}: choose one the Service offers.`;
  const max = meta.maxLength ?? (key === 'display_name' ? DISPLAY_NAME_MAX : key === 'description' ? DESCRIPTION_MAX : null);
  if (max != null && items.some((item) => String(item).length > max)) return `${label} is at most ${max} characters.`;
  if (key === 'display_name' && !String(value || '').trim()) return 'The display name cannot be empty.';
  if (isPlainNameField(key, meta) && items.some((item) => item !== '' && !PLAIN_NAME_PATTERN.test(String(item)))) return `${label}: letters, digits and _ only.`;
  if (meta.pattern) {
    try {
      const pattern = new RegExp(meta.pattern);
      if (items.some((item) => item !== '' && !pattern.test(String(item)))) return `${label} is not in the form the Service accepts.`;
    } catch {
      // A pattern this browser cannot read: the Service checks it.
    }
  }
  return '';
};

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// draft { key: value } against the profile's fields -> only what changed and
// may be changed.
export const changedFields = (draft, profile) => Object.fromEntries(Object.entries(draft || {})
  .filter(([key, value]) => profile?.editable?.[key] && !NEVER_EDITABLE.has(key) && !same(value, profile.fields?.[key])));

// A new domain's id -> the reason it is refused, or ''.
export const domainIdProblem = (id, existing = []) => {
  const clean = String(id || '');
  if (!clean) return 'Give the domain an id.';
  if (!DOMAIN_ID_PATTERN.test(clean)) return 'The id is 2 to 40 lower case letters, digits or _.';
  if (existing.includes(clean)) return 'A domain with this id exists.';
  if (DOMAIN_ALIASES.includes(clean)) return 'This id is another name of an existing domain.';
  return '';
};

// The domains a new one may start as a copy of: those on the chosen rule
// set (round 4, question 4: our answer; the list is all of them until the
// Service says which rule set each one uses).
export const copyCandidates = (domains, ruleSet) => {
  const known = domains.filter((domain) => domain.ruleSet);
  return known.length && ruleSet ? domains.filter((domain) => domain.ruleSet === ruleSet) : domains;
};

export const valueText = (value) => {
  if (value === undefined) return 'not set';
  if (value === null || value === '') return 'empty';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'none';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 200);
  return String(value).slice(0, 200);
};
