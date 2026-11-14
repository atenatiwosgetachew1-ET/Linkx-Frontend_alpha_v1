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
});
