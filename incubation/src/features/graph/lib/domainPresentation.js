// The profile mapping and formatting rules of a domain, shared by everyone
// (Service `presentation`, B-23 / B-24). Read once per domain into the stores
// the Graph windows follow; the browser's own copy (kept while the Service did
// not) is then dropped. A copy the Service has no value for stays until it is
// saved, so nothing an analyst set is lost.

import { fetchPresentation } from '../../../services/domainConfigApi.js';
import { CONFIG_FORMATTING_KEY, adoptDomainFormatting } from './conditionalFormatting.js';
import { CONFIG_PROFILE_KEY, adoptProfileSettings, profileFromConfiguration } from './nodeProfile.js';

const loaded = new Map(); // domain -> { versionId, updatedBy }
const listeners = new Set();
export const subscribePresentation = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const isPresentationLoaded = (domain) => loaded.has(String(domain || ''));
// Changes with each reading or saving of any domain's.
let presentationSeq = 0;
export const getPresentationSeq = () => presentationSeq;
export const getPresentationVersion = (domain) => loaded.get(String(domain || ''))?.versionId ?? null;

export const adoptPresentation = (domain, presentation) => {
  if (!domain || !presentation) return false;
  presentationSeq += 1;
  loaded.set(String(domain), { versionId: presentation.versionId, updatedBy: presentation.updatedBy });
  if (presentation.actorProfile) adoptProfileSettings(domain, profileFromConfiguration(presentation.actorProfile));
  if (presentation.formattingRules) adoptDomainFormatting(domain, presentation.formattingRules);
  listeners.forEach((listener) => listener());
  return true;
};

// A Service without it (404) or a refusal: the browser's copy goes on.
export const loadPresentation = async (apiFetch, domain) => {
  if (!domain) return false;
  try {
    return adoptPresentation(domain, await fetchPresentation(apiFetch, domain));
  } catch {
    return false;
  }
};

// The session configuration's own (older) copies, where the Service's apply.
export const withoutPresentation = (configuration, domain) => {
  if (!configuration || !isPresentationLoaded(domain)) return configuration;
  const { [CONFIG_PROFILE_KEY]: _profile, [CONFIG_FORMATTING_KEY]: _rules, ...rest } = configuration;
  return rest;
};

export const resetPresentation = () => loaded.clear();
