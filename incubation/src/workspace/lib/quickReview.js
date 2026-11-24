// What a quick analysis would use, from the session configuration (the
// defaults the Source window uses, features/source/lib/sourceConfig.js).
// Read only: it says what is saved, not whether a server can be reached.
// The storage address and passwords are never shown.

const NOT_SET = 'Not set';
const saved = (value) => (value ? 'Saved' : NOT_SET);

// input: 'upload', a protocol card's id, or null (none chosen yet).
export const quickReview = ({ defaults, input = null }) => {
  const { domain = '', broker = {}, storage = {}, tool = {}, dataframe = {} } = defaults || {};
  // The Source window preselects the first of these, unless the dataframe
  // brings its own list of rules.
  const rule = dataframe.rules?.[0] || dataframe.builtinRules?.[0] || '';
  const inputs = {
    upload: ['Input', 'File'],
    kafka: ['Kafka broker', [broker.address, broker.topic].filter(Boolean).join(' · ') || NOT_SET],
    batch_kafka: ['Kafka broker', [broker.address, broker.topic].filter(Boolean).join(' · ') || NOT_SET],
    rest_api: ['REST API', broker.apiAddress || NOT_SET],
    batch_rest_api: ['REST API', broker.apiAddress || NOT_SET],
    batch_hadoop: ['Storage', saved(storage.address)],
  };
  const [label, value] = inputs[input] || ['Input', 'Not chosen'];
  return [
    { label, value },
    { label: 'Domain', value: domain || NOT_SET },
    { label: 'Configured rule', value: rule || NOT_SET },
    { label: 'Graph tool', value: tool.url ? [tool.name, tool.database].filter(Boolean).join(' · ') || 'Saved' : NOT_SET },
  ];
};
