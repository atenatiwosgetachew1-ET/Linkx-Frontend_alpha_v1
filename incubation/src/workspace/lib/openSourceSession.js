import { getServiceRefusalCode } from '../../services/apiErrors.js';
import { initializeSourceWindow } from '../../services/sourceApi.js';
import { nextSourceWindowNumber } from './sourceWindowIds.js';

const ATTEMPTS = 5;

// Opens a source session at the Service. Never with a number this main session
// already used (an earlier page load or another tab): the Service names the
// session after it. One still in use there (being cleaned up, or with a run):
// the next one.
export const openSourceSession = async (apiFetch, mainSessionId, atLeast = 1) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await initializeSourceWindow(apiFetch, { sessionId: mainSessionId, windowId: nextSourceWindowNumber(mainSessionId, atLeast) });
    } catch (error) {
      if (getServiceRefusalCode(error) !== 'session_id_in_use' || attempt >= ATTEMPTS) throw error;
    }
  }
};
