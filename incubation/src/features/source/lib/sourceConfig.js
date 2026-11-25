// Resolves Source window defaults from the session configuration returned by
// /init. Values are read from `domain_connections[active_domain]` first, then
// from the top-level keys, so every registered domain (bank, cdr, ...) prefills
// correctly. Key lists mirror the production app's getSourceWindowAutofillDefaults.

const isPresent = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const parseConfiguration = (configuration) => {
  if (!configuration) return {};
  if (typeof configuration === 'string') {
    try {
      return JSON.parse(configuration) || {};
    } catch {
      return {};
    }
  }
  if (configuration.value && typeof configuration.value === 'string') return parseConfiguration(configuration.value);
  return typeof configuration === 'object' ? configuration : {};
};

const firstScalar = (value) => {
  if (Array.isArray(value)) {
    const found = value.find(isPresent);
    return found === undefined ? '' : String(found).trim();
  }
  return isPresent(value) && typeof value !== 'object' ? String(value).trim() : '';
};

const toStringList = (value) => {
  if (Array.isArray(value)) return value.filter(isPresent).map((item) => String(item).trim());
  return isPresent(value) && typeof value !== 'object' ? [String(value).trim()] : [];
};

const uniq = (values) => Array.from(new Set(values.filter(Boolean)));

export const getActiveDomain = (configuration) => {
  const config = parseConfiguration(configuration);
  return firstScalar(config.active_domain) || firstScalar(config.domain) || '';
};

export const isAutoFillEnabled = (configuration) => {
  const value = parseConfiguration(configuration).auto_fill_fields;
  if (value === undefined || value === null || value === '') return true;
  return value === true || value === 'true';
};

export const resolveSourceDefaults = (configuration) => {
  const config = parseConfiguration(configuration);
  const domain = getActiveDomain(config);
  const domainConfig = (domain && config.domain_connections?.[domain]) || {};

  // Top-level "active_*" keys are what the analyst picked; domain values are
  // the per-domain fallbacks.
  const pick = (topKeys, domainKeys = []) => {
    for (const key of topKeys) {
      const value = firstScalar(config[key]);
      if (value) return value;
    }
    for (const key of domainKeys) {
      const value = firstScalar(domainConfig[key]);
      if (value) return value;
    }
    return '';
  };
  // Domain-specific lists win (they describe the active domain's schema).
  const pickList = (key) => {
    const domainList = toStringList(domainConfig[key]);
    return domainList.length ? domainList : toStringList(config[key]);
  };
  const pickDomainFirst = (key) => firstScalar(domainConfig[key]) || firstScalar(config[key]);

  const toolPasswordRef = pick(['active_tool_password_ref', 'tool_password_ref', 'password_ref']);

  const domains = Object.entries(config.domain_connections || {})
    .filter(([key, value]) => key && value && typeof value === 'object')
    .map(([key, value]) => ({ key, storagePath: firstScalar(value.storage_path) }));

  return {
    autoFill: isAutoFillEnabled(config),
    domain,
    domains,
    broker: {
      // `active_kafka_adress` (sic) is the real backend key.
      address: pick(
        ['active_kafka_adress', 'active_kafka_address', 'kafka_custom_address', 'kafka_addresses', 'kafka_bootstrap_servers', 'broker_address', 'kafka_address'],
        ['kafka_broker', 'kafka_addresses'],
      ),
      apiAddress: pick(['active_REST_API', 'REST APIs']),
      topic: pick(['active_kafka_topic', 'kafka_custom_topic', 'kafka_topics', 'kafka_risk_scoring_input_topic', 'topic'], ['kafka_topic', 'kafka_topics']),
    },
    storage: {
      address: pick(
        ['active_storage_address', 'storage_custom_address', 'storage_addresses', 'storage_address', 'storage_hdfs_uri', 'active_storage_host', 'hadoop_address', 'hdfs_address', 'active_hdfs_address'],
        ['storage_host'],
      ),
      port: pickDomainFirst('storage_port'),
      path: pickDomainFirst('storage_path'),
      database: pick(['active_storage_database'], ['active_storage_database', 'storage_database']) || pickDomainFirst('storage_database'),
      databases: pickList('storage_databases'),
      tables: pickList('active_storage_tables').length ? pickList('active_storage_tables') : pickList('storage_tables'),
    },
    tool: {
      name: pick(['active_tool']) || 'neo4j',
      options: uniq(toStringList(config.tools).length ? toStringList(config.tools) : ['neo4j']),
      url: pick(['active_tool_url', 'active_tool_protocol'], ['tool_protocol']),
      username: pick(['active_tool_username'], ['tool_username']),
      database: pick(['active_tool_database', 'custom_tool_database'], ['tool_database']),
      // Saved passwords come back masked; the ref lets the backend resolve it.
      // Only the saved-secret marker is ever prefilled; a raw password from
      // the configuration is never copied into the browser state.
      password: toolPasswordRef ? '***' : '',
      passwordRef: toolPasswordRef,
    },
    search: {
      strictColumns: pickList('search_columns_strict'),
      fuzzyColumns: pickList('search_columns_fuzzy'),
      dateColumn: pickDomainFirst('date_column'),
    },
    dataframe: {
      activeRule: toStringList(config.active_rule)[0] || '',
      rules: uniq([...toStringList(config.active_rule), ...toStringList(config.rule_names)]),
      builtinRules: toStringList(config.builtin_rules),
      sourceColumn: pickDomainFirst('default_source_col'),
      targetColumn: pickDomainFirst('default_target_col'),
      relationship: pickDomainFirst('default_relationship'),
      fetchColumns: pickList('fetch_columns'),
    },
  };
};

// Patch applied to a mode's state when a Source window opens (or when the
// configuration arrives later). Only fills fields the analyst left empty.
export const buildSourceAutofillPatch = (defaults, currentState = {}) => {
  if (!defaults?.autoFill) return {};
  const fill = (key, value) => (!isPresent(currentState[key]) && isPresent(value) ? { [key]: value } : {});
  const hasTypedPassword = isPresent(currentState.toolPassword);

  return {
    ...(currentState.brokerUseDefault === false ? {} : {
      ...fill('brokerAddress', defaults.broker.address),
      ...fill('topic', defaults.broker.topic),
    }),
    // Storage address/port are not prefilled: with "Use Default" the window
    // connects to the configured storage without exposing its address.
    ...fill('storagePath', defaults.storage.path),
    ...fill('storageDatabase', defaults.storage.database),
    ...fill('toolUrl', defaults.tool.url),
    ...fill('toolUsername', defaults.tool.username),
    ...fill('toolDatabase', defaults.tool.database),
    ...(!hasTypedPassword && defaults.tool.password
      ? { toolPassword: defaults.tool.password, toolPasswordRef: defaults.tool.passwordRef }
      : {}),
  };
};
