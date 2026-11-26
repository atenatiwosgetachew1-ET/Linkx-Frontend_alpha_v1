// Domain settings changed by someone (socket `domain_config_changed`, B-47):
// { domain, section, version_id }, section thresholds | sensitivity | lineage
// | columns | mapping | profile (round 4). The open Domains page reads that part again; one's own
// saves are recognised so they are not announced back.

// A preset rewrites the thresholds: the two share their version.
const groupOf = (section) => (section === 'sensitivity' ? 'thresholds' : section);
const keyOf = (domain, section) => `${domain}|${groupOf(section)}`;

const seqs = new Map(); // "domain|group" -> changes seen
const saving = new Map(); // "domain|group" -> saves on their way
const own = new Map(); // "domain|group" -> the version this page last saved
const listeners = new Set();
let total = 0;

export const subscribeDomainChanges = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getDomainChanges = () => total;
export const getDomainChangeSeq = (domain, section) => seqs.get(keyOf(domain, section)) || 0;

const bump = (domain, section) => {
  total += 1;
  seqs.set(keyOf(domain, section), getDomainChangeSeq(domain, section) + 1);
  listeners.forEach((listener) => listener());
};

// Runs a save of this page's own; `versionOf` reads the new version from it.
export const asOwnChange = async (domain, section, save, versionOf = () => null) => {
  const key = keyOf(domain, section);
  saving.set(key, (saving.get(key) || 0) + 1);
  try {
    const result = await save();
    const version = versionOf(result);
    if (version !== null && version !== undefined) own.set(key, String(version));
    // The other part that shares this version is read again too.
    if (groupOf(section) === 'thresholds' && result?.ok !== false) bump(domain, section);
    return result;
  } finally {
    saving.set(key, saving.get(key) - 1);
  }
};

// -> { domain, section, own } | null (not a change this app knows)
export const noteDomainChange = (payload) => {
  const domain = String(payload?.domain || '').trim().toLowerCase();
  const section = String(payload?.section || '').trim();
  if (!domain || !['thresholds', 'sensitivity', 'lineage', 'columns', 'mapping', 'profile'].includes(section)) return null;
  const key = keyOf(domain, section);
  const mine = (saving.get(key) || 0) > 0 || (payload.version_id !== null && payload.version_id !== undefined && own.get(key) === String(payload.version_id));
  if (!mine) bump(domain, section);
  return { domain, section, own: mine };
};

export const resetDomainChanges = () => {
  seqs.clear();
  saving.clear();
  own.clear();
  total = 0;
};
