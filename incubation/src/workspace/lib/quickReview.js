// What a quick analysis would use, from the session configuration (the
// defaults the Source window uses, features/source/lib/sourceConfig.js).
// Read only: it says what is saved, not whether a server can be reached.
// Passwords are never shown.

const NOT_SET = 'Not set';

// input: 'upload', a protocol card's id, or null (none chosen yet).
export const quickReview = ({ defaults, input = null }) => {
  const { domain = '', broker = {}, tool = {}, dataframe = {} } = defaults || {};
  // The rule a quick run uses: the active one.
  const rule = dataframe.activeRule || '';
  const inputs = {
    upload: ['Input', 'File'],
    kafka: ['Kafka broker', [broker.address, broker.topic].filter(Boolean).join(' · ') || NOT_SET],
    batch_kafka: ['Kafka broker', [broker.address, broker.topic].filter(Boolean).join(' · ') || NOT_SET],
    rest_api: ['REST API', broker.apiAddress || NOT_SET],
  };
  const [label, value] = inputs[input] || ['Input', 'Not chosen'];
  return [
    { label, value },
    { label: 'Domain', value: domain || NOT_SET },
    { label: 'Active rule', value: rule || NOT_SET },
    { label: 'Graph tool', value: tool.url ? [tool.name, tool.database].filter(Boolean).join(' · ') || 'Saved' : NOT_SET },
  ];
};
