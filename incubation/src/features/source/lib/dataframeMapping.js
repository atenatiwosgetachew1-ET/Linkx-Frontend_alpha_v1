// A column mapping for one dataframe (B-41): sent with its create_DF, never
// stored, and only for fields that would be missing (so it can reveal, never
// hide). Not the domain's column mapping, nor the profile mapping.

export const MAPPING_PERMISSION = 'mapping:override';
export const MAPPING_LIMITS = Object.freeze({ entries: 50, name: 128 });
// Refusals that depend on the data: the dataframe there was stays.
export const MAPPING_REFUSALS = new Set(['unknown_source', 'unknown_target', 'target_present', 'duplicate_target']);

const textList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : null);
const mapOf = (value) => (value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.entries(value).filter(([source, target]) => source && typeof target === 'string' && target))
  : {});

// A create_DF's results -> { missingFields, sourceColumns } (null: a Service
// that does not say, then no mapping is offered), ownMapping.
export const readMappingInfo = (results) => {
  const source = results && typeof results === 'object' && !Array.isArray(results) ? results : {};
  return { missingFields: textList(source.missing_fields), sourceColumns: textList(source.source_columns), ownMapping: mapOf(source.dataframe_mapping) };
};

// The refused job's own (results may be nested).
export const readMappingRefusal = (error) => {
  const job = error?.jobResponse || error?.data || {};
  const layers = [job, job.results, job.results?.result, job.result, error?.jobResult].filter((item) => item && typeof item === 'object');
  const code = layers.map((item) => item.code).find((item) => MAPPING_REFUSALS.has(item)) || '';
  const invalid = layers.some((item) => item.code === 'invalid_field' && Array.isArray(item.invalid_fields) && item.invalid_fields.includes('dataframe_mapping'));
  const denied = layers.some((item) => item.permission === MAPPING_PERMISSION);
  if (!code && !invalid && !denied) return null;
  const fields = (layers.map((item) => item.fields).find(Array.isArray) || []).flat().filter((item) => typeof item === 'string').slice(0, 10);
  return { code: code || (denied ? 'permission' : 'invalid_field'), fields };
};

// What each code means, with the names it is about.
export const mappingRefusalText = ({ code, fields }) => {
  const names = fields.length ? `: ${fields.join(', ')}` : '';
  return {
    unknown_source: `Not a column of this data${names}.`,
    unknown_target: `Not a field of the domain${names}.`,
    target_present: `The data has this field already${names}. A mapping may only fill a field that is missing.`,
    duplicate_target: `Two columns were given for the same field${names}.`,
    permission: 'Your account may not map columns for a dataframe (mapping:override).',
    invalid_field: 'The mapping was not accepted: at most 50 columns, names of at most 128 characters.',
  }[code];
};

// { target: source } as picked -> { source: target } as sent.
export const mappingPayload = (picked) => Object.fromEntries(Object.entries(picked).filter(([, source]) => source).map(([target, source]) => [source, target]));
export const pickedOf = (mapping = {}) => Object.fromEntries(Object.entries(mapping).map(([source, target]) => [target, source]));

// The fields that can be given a column: those missing, and those this
// dataframe's own mapping fills now.
export const mappableFields = ({ missingFields, ownMapping } = {}) => [...new Set([...Object.values(ownMapping || {}), ...(missingFields || [])])];

// Why a pick cannot be sent ('' when it can).
export const mappingProblem = (picked) => {
  const sources = Object.values(picked).filter(Boolean).map((name) => name.toUpperCase());
  const twice = sources.find((name, index) => sources.indexOf(name) !== index);
  if (twice) return `The column ${twice} is used for two fields. A column can fill one field only.`;
  return sources.length > MAPPING_LIMITS.entries ? `At most ${MAPPING_LIMITS.entries} columns.` : '';
};
