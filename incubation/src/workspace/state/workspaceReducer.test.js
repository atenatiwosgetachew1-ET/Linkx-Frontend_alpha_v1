import { describe, expect, it } from 'vitest';

import { WORKSPACE_ACTIONS, WORKSPACE_WINDOW_TYPES } from './workspaceTypes.js';
import { initialWorkspaceState, workspaceReducer } from './workspaceReducer.js';

const open = (state, type, payload = {}) => workspaceReducer(state, { type: WORKSPACE_ACTIONS.OPEN_WINDOW, payload: { type, ...payload } });

describe('workspaceReducer: single windows', () => {
  it('focuses an open single window and merges the new request metadata', () => {
    let state = open(initialWorkspaceState, WORKSPACE_WINDOW_TYPES.REPORTS, { metadata: { reportsTab: 'parent', keep: 1 } });
    state = open(state, WORKSPACE_WINDOW_TYPES.SETTINGS);
    state = open(state, WORKSPACE_WINDOW_TYPES.REPORTS, { metadata: { reportsTab: 'xvigilance', openSeq: 2 } });
    const reports = state.windows.filter((windowItem) => windowItem.type === WORKSPACE_WINDOW_TYPES.REPORTS);
    expect(reports).toHaveLength(1);
    expect(state.activeWindowId).toBe(reports[0].id);
    expect(reports[0].metadata).toMatchObject({ reportsTab: 'xvigilance', openSeq: 2, keep: 1 });
  });

  it('leaves the window untouched when no metadata is passed', () => {
    const first = open(initialWorkspaceState, WORKSPACE_WINDOW_TYPES.REPORTS, { metadata: { reportsTab: 'parent' } });
    const again = open(first, WORKSPACE_WINDOW_TYPES.REPORTS);
    expect(again.windows).toBe(first.windows);
  });

  it('opens a window with an empty custom title unless one is given', () => {
    const state = open(open(initialWorkspaceState, WORKSPACE_WINDOW_TYPES.REPORTS), WORKSPACE_WINDOW_TYPES.SETTINGS, { customTitle: 'Mine' });
    expect(state.windows.map((windowItem) => windowItem.customTitle)).toEqual(['', 'Mine']);
  });
});

describe('workspaceReducer: minimize all (Ctrl+`)', () => {
  const toggle = (state) => workspaceReducer(state, { type: WORKSPACE_ACTIONS.TOGGLE_MINIMIZE_ALL });
  const focus = (state, id) => workspaceReducer(state, { type: WORKSPACE_ACTIONS.FOCUS_WINDOW, payload: { id } });
  const minimized = (state) => state.windows.map((windowItem) => Boolean(windowItem.minimized));

  it('minimizes every window, and brings them all back when pressed again', () => {
    let state = open(open(initialWorkspaceState, WORKSPACE_WINDOW_TYPES.REPORTS), WORKSPACE_WINDOW_TYPES.SETTINGS);
    state = toggle(state);
    expect(minimized(state)).toEqual([true, true]);
    state = toggle(state);
    expect(minimized(state)).toEqual([false, false]);
  });

  it('brings back only the window switched to, even the one that was active', () => {
    let state = open(open(initialWorkspaceState, WORKSPACE_WINDOW_TYPES.REPORTS), WORKSPACE_WINDOW_TYPES.SETTINGS);
    const [reports, settings] = state.windows.map((windowItem) => windowItem.id);
    state = toggle(state);
    state = focus(state, settings);
    expect(minimized(state)).toEqual([true, false]);
    // Not all minimized now: Ctrl+` minimizes again.
    expect(minimized(toggle(state))).toEqual([true, true]);
    state = open(state, WORKSPACE_WINDOW_TYPES.REPORTS);
    expect(state.activeWindowId).toBe(reports);
    expect(minimized(state)).toEqual([false, false]);
  });
});
