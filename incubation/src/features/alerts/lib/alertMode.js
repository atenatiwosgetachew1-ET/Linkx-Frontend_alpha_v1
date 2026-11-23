// Which alert service runs: the Service's (live, the default since H-3 to
// H-5 are live, frontend alignment 2026-11-20), the mock, or none. The
// build's setting (appConfig.parentAlerts: 'live' | 'mock' | 'off'; unset =
// live), and in development the mock switch in Reports ▸ Alert reports
// (kept in this browser) over it.

import { appConfig } from '../../../app/config.js';

const KEY = 'linkx.mockParentAlerts';
const listeners = new Set();

const readSwitch = () => {
  try { return globalThis.localStorage?.getItem(KEY) === '1'; } catch { return false; }
};
let mockSwitch = readSwitch();

// The switch is offered in development builds only (a production build
// follows its setting).
export const mockSwitchAvailable = () => appConfig.isDev && appConfig.parentAlerts !== 'live' && appConfig.parentAlerts !== 'off';
export const isMockSwitchOn = () => mockSwitch;

// -> 'mock' | 'live' | 'off'
export const preferredAlertMode = () => {
  if (appConfig.parentAlerts === 'mock') return 'mock';
  if (appConfig.parentAlerts === 'live') return 'live';
  if (appConfig.parentAlerts === 'off') return 'off';
  return mockSwitchAvailable() && mockSwitch ? 'mock' : 'live';
};

export const setMockSwitch = (on) => {
  mockSwitch = Boolean(on);
  try { globalThis.localStorage?.setItem(KEY, mockSwitch ? '1' : '0'); } catch { /* private mode: for this visit only */ }
  listeners.forEach((listener) => listener());
};
export const subscribeAlertMode = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
