// The connections a Source window can use, as its pages name and draw them
// (icon: sourceUi.jsx SourceModeIcon).
export const SOURCE_CONNECTIONS = Object.freeze([
  { id: 'upload', label: 'Upload file', badge: 'Upload local files', icon: 'upload' },
  { id: 'storage', label: 'Storage', badge: 'HDFS · Apache Hive · ClickHouse', icon: 'hadoop' },
  { id: 'broker', label: 'Message broker', badge: 'Apache Kafka · REST API', icon: 'kafka' },
  { id: 'search', label: 'Elasticsearch', badge: 'Hybrid search (Elasticsearch + Hive)', icon: 'elastic' },
  { id: 'cloud', label: 'Cloud dataset', badge: 'Coming soon', icon: 'cloud', disabled: true },
]);

export const connectionById = (id) => SOURCE_CONNECTIONS.find((connection) => connection.id === id) || SOURCE_CONNECTIONS[0];
