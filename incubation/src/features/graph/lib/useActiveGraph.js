// Binds the right workspace panel to the active Graph window
// (graph-chart-plan §3.11). State lives in the window (metadata: settings and
// search) and in its graph store (data, selection, counts); the panel only
// reads and edits them, so switching windows or collapsing the panel never
// loses anything.
import { useCallback, useMemo, useSyncExternalStore } from 'react';

import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { normalizeGraphSettings } from './graphSettings.js';
import { getGraphDefaults, subscribeGraphDefaults } from './graphDefaults.js';
import { getGraphStore } from './graphStore.js';

const EMPTY_SNAPSHOT = { version: 0, nodes: 0, edges: 0, danglingEdges: 0, selection: [], status: { state: 'idle' }, viewStats: { nodes: 0, edges: 0, searched: false } };
const noopSubscribe = () => () => {};

export const DEFAULT_GRAPH_SEARCH = Object.freeze({ keyword: '', includeLinked: false, keys: [] });

export function useActiveGraph(workspace) {
  const active = workspace?.activeWindow
    || workspace?.windows?.find((item) => item.id === workspace?.activeWindowId)
    || null;
  const windowItem = active?.type === WORKSPACE_WINDOW_TYPES.GRAPH ? active : null;
  const windowId = windowItem?.id || null;
  const store = useMemo(() => (windowId ? getGraphStore(windowId) : null), [windowId]);
  const snapshot = useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.getSnapshot : () => EMPTY_SNAPSHOT);

  // As the Graph window reads them: its own, else Libraries ▸ Graph defaults.
  const graphDefaults = useSyncExternalStore(subscribeGraphDefaults, getGraphDefaults);
  const settings = useMemo(
    () => normalizeGraphSettings(windowItem?.metadata?.graphSettings || graphDefaults),
    [windowItem?.metadata?.graphSettings, graphDefaults],
  );
  const search = windowItem?.metadata?.graphSearch || DEFAULT_GRAPH_SEARCH;

  const { updateWindowMetadata } = workspace || {};
  const updateSettings = useCallback((next) => {
    if (!windowId) return;
    updateWindowMetadata?.(windowId, { metadata: { graphSettings: normalizeGraphSettings(next) } });
  }, [updateWindowMetadata, windowId]);
  const updateSearch = useCallback((next) => {
    if (!windowId) return;
    updateWindowMetadata?.(windowId, { metadata: { graphSearch: { ...DEFAULT_GRAPH_SEARCH, ...next } } });
  }, [updateWindowMetadata, windowId]);

  return {
    windowItem,
    // A Chart or Table window (twins; analyst decision 2026-11-18): its
    // kind, and the Graph window it follows.
    companion: active?.type === WORKSPACE_WINDOW_TYPES.CHART ? 'chart' : active?.type === WORKSPACE_WINDOW_TYPES.TABLE ? 'table' : null,
    companionGraph: active?.type === WORKSPACE_WINDOW_TYPES.CHART ? (workspace?.windows?.find((item) => item.id === active.metadata?.chartGraph) || null)
      : active?.type === WORKSPACE_WINDOW_TYPES.TABLE ? (workspace?.windows?.find((item) => item.id === active.metadata?.tableGraph) || null)
        : null,
    store,
    snapshot,
    settings,
    search,
    updateSettings,
    updateSearch,
  };
}

// "Graph 2 · Evidence R-1042": which window the panel is controlling.
export const graphWindowName = (windowItem) => {
  if (!windowItem) return '';
  const custom = String(windowItem.customTitle || '').trim();
  return custom && custom.toLowerCase() !== 'placeholder' ? `${windowItem.title} · ${custom}` : windowItem.title;
};
