// Device-level analysis preferences, under production's storage keys
// (graphs_adjuster.js PATH_OPTIONS_STORAGE_KEY, ELEMENT_FILTERS_STORAGE_KEY,
// ALERT_RULES_STORAGE_KEY).
import { normalizeElementFilters, normalizePathOptions } from './graphAnalysis.js';
import { ALERT_RULES_KEY, normalizeAlertRules } from './graphAlerts.js';

export const PATH_OPTIONS_KEY = 'linkx_path_options_v1';
export const ELEMENT_FILTERS_KEY = 'linkx_element_filters_v1';

const read = (key) => {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the choice applies to this session only.
  }
};

export const readPathOptions = () => normalizePathOptions(read(PATH_OPTIONS_KEY));
export const writePathOptions = (options) => write(PATH_OPTIONS_KEY, normalizePathOptions(options));
export const readElementFilters = () => normalizeElementFilters(read(ELEMENT_FILTERS_KEY));
export const writeElementFilters = (filters) => write(ELEMENT_FILTERS_KEY, normalizeElementFilters(filters));
export const readAlertRules = () => normalizeAlertRules(read(ALERT_RULES_KEY));
export const writeAlertRules = (rules) => write(ALERT_RULES_KEY, normalizeAlertRules(rules));
