// Service account model (ported from the production app): per-account
// multi-domain storage targets, schema templates and payload cleaning.

import { sanitizeConnectionValue, sanitizeSecret } from '../../../utils/inputSecurity.js';

const defaultPortFor = (domainKey) => (domainKey === 'microfinance' ? '5007' : '5000');

export const defaultDomainConfig = (domainKey) => ({
  storage_host: '',
  storage_port: defaultPortFor(domainKey),
  storage_endpoint: 'api/search/uii',
  auth_token: '',
  fetch_columns: [],
  column_mapping: {},
});

// A new account registers no domain: which ones exist (and their keys) is
// the Service's catalog to say, so none is assumed here.
export const defaultServiceConfig = () => ({
  registered_domains: [],
  domains: {},
});

export const STANDARD_FORENSIC_DOMAINS = ['banking', 'microfinance', 'cdr', 'insurance', 'social_media'];

const DOMAIN_META = {
  banking: { label: 'Banking', tag: 'Core banking' },
  bank: { label: 'Banking', tag: 'Core banking' },
  microfinance: { label: 'Microfinance', tag: 'MFI & wallets' },
  mfi: { label: 'Microfinance', tag: 'MFI & wallets' },
  cdr: { label: 'CDR / Telecom', tag: 'Call detail records' },
  telecom: { label: 'Telecom', tag: 'Call detail records' },
  insurance: { label: 'Insurance', tag: 'Claims & policies' },
  social_media: { label: 'Social media', tag: 'Network graph' },
  social: { label: 'Social media', tag: 'Network graph' },
  fintech: { label: 'Fintech', tag: 'Digital wallets' },
  enterprise: { label: 'Enterprise', tag: 'ERP / ledger' },
};

export const getDomainMeta = (domainKey) => {
  const key = String(domainKey || '').toLowerCase().trim();
  const meta = DOMAIN_META[key] || { label: key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '), tag: 'Custom domain' };
  return { ...meta, defaultPort: defaultPortFor(key) };
};

const BANK_CANONICAL = [
  ['ACCOUNTNO', 'ACCOUNTNO (source account / sender)'],
  ['BENACCOUNTNO', 'BENACCOUNTNO (destination account / receiver)'],
  ['AMOUNTINBIRR', 'AMOUNTINBIRR (transaction amount)'],
  ['TRANSACTIONDATE', 'TRANSACTIONDATE (timestamp / date)'],
  ['TRANSACTIONID', 'TRANSACTIONID (unique transaction ID)'],
  ['ACCOWNERNAME', 'ACCOWNERNAME (sender name)'],
  ['BENFULLNAME', 'BENFULLNAME (beneficiary name)'],
];
const CDR_CANONICAL = [
  ['ACCOUNTNO', 'CALLING_NO (calling number / MSISDN)'],
  ['BENACCOUNTNO', 'CALLED_NO (called number / destination)'],
  ['AMOUNTINBIRR', 'DURATION (call duration in seconds)'],
  ['TRANSACTIONDATE', 'START_TIME (call start time)'],
  ['TRANSACTIONID', 'RECORD_ID (unique call record ID)'],
  ['ACCOWNERNAME', 'CALLER_NAME (caller / subscriber name)'],
  ['BENFULLNAME', 'CALLEE_NAME (called party name)'],
];
export const getCanonicalColumns = (isCdr) => (isCdr ? CDR_CANONICAL : BANK_CANONICAL).map(([value, label]) => ({ value, label }));

const template = (fetch, mapping) => ({ fetch_columns: fetch, column_mapping: mapping });
const BANK_TEMPLATE = template(
  ['TRANSACTIONID', 'TRANSACTIONDATE', 'AMOUNTINBIRR', 'ACCOUNTNO', 'BENACCOUNTNO', 'ACCOWNERNAME', 'BENFULLNAME'],
  { TRANSACTIONID: 'TRANSACTIONID', TRANSACTIONDATE: 'TRANSACTIONDATE', AMOUNTINBIRR: 'AMOUNTINBIRR', ACCOUNTNO: 'ACCOUNTNO', BENACCOUNTNO: 'BENACCOUNTNO', ACCOWNERNAME: 'ACCOWNERNAME', BENFULLNAME: 'BENFULLNAME' },
);
const CDR_TEMPLATE = template(
  ['CALL_ID', 'CALL_DATE', 'DURATION_SEC', 'CALLER_MSISDN', 'CALLEE_MSISDN', 'CALLER_NAME', 'CALLEE_NAME'],
  { CALLER_MSISDN: 'ACCOUNTNO', CALLEE_MSISDN: 'BENACCOUNTNO', DURATION_SEC: 'AMOUNTINBIRR', CALL_DATE: 'TRANSACTIONDATE', CALL_ID: 'TRANSACTIONID', CALLER_NAME: 'ACCOWNERNAME', CALLEE_NAME: 'BENFULLNAME' },
);
export const DOMAIN_SCHEMA_TEMPLATES = {
  banking: BANK_TEMPLATE,
  bank: BANK_TEMPLATE,
  microfinance: template(
    ['TRANSFERID', 'CREATEDDATE', 'TRANSFERAMOUNT', 'SENDERACCOUNTID', 'RECEIVERACCOUNTID', 'SENDER_FULL_NAME', 'RECEIVER_FULL_NAME', 'NAME'],
    { SENDERACCOUNTID: 'ACCOUNTNO', RECEIVERACCOUNTID: 'BENACCOUNTNO', TRANSFERAMOUNT: 'AMOUNTINBIRR', CREATEDDATE: 'TRANSACTIONDATE', TRANSFERID: 'TRANSACTIONID', SENDER_FULL_NAME: 'ACCOWNERNAME', RECEIVER_FULL_NAME: 'BENFULLNAME' },
  ),
  insurance: template(
    ['CLAIM_ID', 'CLAIM_DATE', 'CLAIM_AMOUNT', 'POLICY_NO', 'CLAIMANT_ID', 'INSURED_NAME', 'CLAIMANT_NAME'],
    { POLICY_NO: 'ACCOUNTNO', CLAIMANT_ID: 'BENACCOUNTNO', CLAIM_AMOUNT: 'AMOUNTINBIRR', CLAIM_DATE: 'TRANSACTIONDATE', CLAIM_ID: 'TRANSACTIONID', INSURED_NAME: 'ACCOWNERNAME', CLAIMANT_NAME: 'BENFULLNAME' },
  ),
  cdr: CDR_TEMPLATE,
  telecom: CDR_TEMPLATE,
  fintech: template(
    ['TXN_REF', 'TIMESTAMP', 'AMOUNT', 'PAYER_WALLET', 'PAYEE_WALLET', 'PAYER_NAME', 'PAYEE_NAME'],
    { PAYER_WALLET: 'ACCOUNTNO', PAYEE_WALLET: 'BENACCOUNTNO', AMOUNT: 'AMOUNTINBIRR', TIMESTAMP: 'TRANSACTIONDATE', TXN_REF: 'TRANSACTIONID', PAYER_NAME: 'ACCOWNERNAME', PAYEE_NAME: 'BENFULLNAME' },
  ),
  enterprise: template(
    ['RECORD_ID', 'TIMESTAMP', 'VAL', 'DEBTOR_ID', 'CREDITOR_ID', 'DEBTOR_NAME', 'CREDITOR_NAME'],
    { DEBTOR_ID: 'ACCOUNTNO', CREDITOR_ID: 'BENACCOUNTNO', VAL: 'AMOUNTINBIRR', TIMESTAMP: 'TRANSACTIONDATE', RECORD_ID: 'TRANSACTIONID', DEBTOR_NAME: 'ACCOWNERNAME', CREDITOR_NAME: 'BENFULLNAME' },
  ),
  social_media: template(
    ['POST_ID', 'TIMESTAMP', 'AUTHOR_ID', 'MENTIONED_USER_ID', 'AUTHOR_HANDLE', 'RECIPIENT_HANDLE', 'ENGAGEMENT_SCORE'],
    { AUTHOR_ID: 'ACCOUNTNO', MENTIONED_USER_ID: 'BENACCOUNTNO', ENGAGEMENT_SCORE: 'AMOUNTINBIRR', TIMESTAMP: 'TRANSACTIONDATE', POST_ID: 'TRANSACTIONID', AUTHOR_HANDLE: 'ACCOWNERNAME', RECIPIENT_HANDLE: 'BENFULLNAME' },
  ),
};

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const normalizeServiceAccountList = (data) => {
  const raw = Array.isArray(data) ? data
    : Array.isArray(data?.results) ? data.results
      : Array.isArray(data?.service_accounts) ? data.service_accounts
        : Array.isArray(data?.data) ? data.data : [];
  return raw.map((account) => {
    const rawCfg = account.config || {};
    let registeredDomains = Array.isArray(account.registered_domains) ? account.registered_domains
      : Array.isArray(rawCfg.registered_domains) ? rawCfg.registered_domains : [];
    const rawDomains = isPlainObject(account.domains) ? account.domains : isPlainObject(rawCfg.domains) ? rawCfg.domains : {};
    const domains = {};
    Object.entries(rawDomains).forEach(([key, cfg]) => {
      if (!key || !isPlainObject(cfg)) return;
      domains[key] = {
        storage_host: cfg.storage_host || '',
        storage_port: cfg.storage_port ? String(cfg.storage_port) : defaultPortFor(key),
        storage_endpoint: cfg.storage_endpoint || 'api/search/uii',
        // Tokens are never kept in the browser: only whether one is saved.
        auth_token: '',
        auth_token_set: Boolean(cfg.auth_token || cfg.auth_token_set),
        fetch_columns: Array.isArray(cfg.fetch_columns) ? cfg.fetch_columns : [],
        column_mapping: isPlainObject(cfg.column_mapping) ? cfg.column_mapping : {},
      };
    });
    if (!registeredDomains.length) registeredDomains = Object.keys(domains);
    return {
      ...account,
      id: account.id ?? account.client_id,
      client_id: account.client_id || account.username || '',
      display_name: account.display_name || account.name || account.client_id || '',
      is_active: account.is_active !== false,
      is_system: Boolean(account.is_system),
      permissions: Array.isArray(account.permissions) ? account.permissions : [],
      config: { registered_domains: registeredDomains, domains },
    };
  });
};

export const cloneServiceConfig = (config) => {
  const domains = {};
  Object.entries(config?.domains || {}).forEach(([key, value]) => {
    domains[key] = { ...value, fetch_columns: [...(value.fetch_columns || [])], column_mapping: { ...(value.column_mapping || {}) } };
  });
  return { registered_domains: [...(config?.registered_domains || [])], domains };
};

const cleanDomain = (key, cfg = {}) => {
  const fetchColumns = Array.isArray(cfg.fetch_columns)
    ? Array.from(new Set(cfg.fetch_columns.map((column) => String(column).trim().toUpperCase()).filter(Boolean)))
    : [];
  const columnMapping = {};
  if (isPlainObject(cfg.column_mapping)) {
    Object.entries(cfg.column_mapping).forEach(([source, target]) => {
      const cleanSource = String(source).trim().toUpperCase();
      const cleanTarget = String(target).trim().toUpperCase();
      if (cleanSource && cleanTarget) columnMapping[cleanSource] = cleanTarget;
    });
  }
  return {
    storage_host: sanitizeConnectionValue(cfg.storage_host || ''),
    storage_port: String(sanitizeConnectionValue(cfg.storage_port || defaultPortFor(key))),
    storage_endpoint: sanitizeConnectionValue(cfg.storage_endpoint || 'api/search/uii'),
    // Token: sent only when typed (and not a mask); an explicit clear sends
    // null; otherwise omitted so the backend keeps the saved one (B-2).
    ...(cfg.auth_token_clear
      ? { auth_token: null }
      : String(cfg.auth_token || '').trim() && !/^\*+$/.test(String(cfg.auth_token).trim())
        ? { auth_token: sanitizeSecret(cfg.auth_token) }
        : {}),
    ...(fetchColumns.length ? { fetch_columns: fetchColumns } : {}),
    ...(Object.keys(columnMapping).length ? { column_mapping: columnMapping } : {}),
  };
};

// `existingDomains` keeps unregistered domain configs (non-destructive save).
export const buildServiceConfigPayload = (config, existingDomains = {}) => {
  const registered = Array.isArray(config?.registered_domains) ? config.registered_domains : [];
  const keys = Array.from(new Set([...registered, ...Object.keys(existingDomains)]));
  const domains = {};
  keys.forEach((key) => {
    domains[key] = cleanDomain(key, config?.domains?.[key] || existingDomains[key]);
  });
  return { registered_domains: registered, domains };
};

export const parseCatalogDomains = (data) => {
  const pick = (list) => list.map((item) => (typeof item === 'string' ? item : item?.domain || item?.name || item?.id || '')).filter(Boolean);
  let domains = [];
  if (Array.isArray(data)) domains = pick(data);
  else if (Array.isArray(data?.domains)) domains = pick(data.domains);
  else if (isPlainObject(data?.domains)) domains = Object.keys(data.domains);
  else if (Array.isArray(data?.data)) domains = pick(data.data);
  else if (Array.isArray(data?.results)) domains = pick(data.results);
  else if (isPlainObject(data)) domains = Object.keys(data).filter((key) => !['status', 'success', 'format', 'total', 'message'].includes(key));
  return Array.from(new Set(domains.map((domain) => String(domain).trim().toLowerCase()).filter(Boolean)));
};

export const extractServiceSecret = (data) => (
  data?.client_secret || data?.secret ||
  data?.result?.client_secret || data?.result?.secret ||
  data?.results?.client_secret || data?.results?.secret ||
  data?.service_account?.client_secret || data?.service_account?.secret || ''
);

// Fails closed: without a secure random source no secret is produced (the
// old code silently returned 48 zeros). Backend generation is preferred (B-3).
export const generateClientSecret = () => {
  if (!window.crypto?.getRandomValues) {
    throw new Error('Secure random generation is unavailable in this browser; a client secret cannot be generated.');
  }
  const bytes = new Uint8Array(24);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
};

// Same, but returns '' instead of throwing (for initial form state).
export const tryGenerateClientSecret = () => {
  try {
    return generateClientSecret();
  } catch {
    return '';
  }
};

export const formatServiceAccountError = (error, fallback = 'An error occurred.') => {
  const raw = String(error?.data?.error || error?.data?.detail || error?.data?.message || error?.message || '');
  if (raw.includes('cannot_modify_system_service_account_permissions')) return 'Protected system account permissions cannot be modified.';
  if (raw.includes('cannot_delete_system_service_account')) return 'Protected system accounts cannot be deleted.';
  if (raw.includes('cannot_deactivate_system_service_account')) return 'Protected system accounts cannot be deactivated.';
  if (raw.includes('cannot_modify_system_service_account_secret')) return 'Protected system account secret cannot be modified.';
  return error?.message || fallback;
};
