import React, { Suspense, lazy, memo } from 'react';

import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';
import WindowLoadScreen from '../../shared/components/WindowLoadScreen.jsx';

const SourceWindowBody = lazy(() => import('../../features/source/components/SourceWindowBody.jsx'));
const SettingsWindowBody = lazy(() => import('../../features/settings/components/SettingsWindowBody.jsx'));
const ConfigurationWindowBody = lazy(() => import('../../features/configuration/components/ConfigurationWindowBody.jsx'));
const TasksWindowBody = lazy(() => import('../../features/tasks/components/TasksWindowBody.jsx'));
const ReportsWindowBody = lazy(() => import('../../features/reports/components/ReportsWindowBody.jsx'));
const GraphWindowBody = lazy(() => import('../../features/graph/components/GraphWindowBody.jsx'));
const TableWindowBody = lazy(() => import('../../features/table/components/TableWindowBody.jsx'));
const ChartWindowBody = lazy(() => import('../../features/chart/components/ChartWindowBody.jsx'));
const LibrariesWindowBody = lazy(() => import('../../features/libraries/components/LibrariesWindowBody.jsx'));

const bodyFallback = (
  <div className="workspace_window_body">
    <WindowLoadScreen />
  </div>
);

// Header-only fields: editing them must not re-render the (heavy) window body.
const HEADER_ONLY_KEYS = new Set(['customTitle', 'updatedAt']);

const areBodyPropsEqual = (prev, next) => {
  if (Boolean(prev.hidden) !== Boolean(next.hidden)) return false;
  // Hidden (a docked Chart window kept mounted): nothing to draw, so no
  // re-render until it is shown again.
  if (prev.hidden && next.hidden) return true;
  const a = prev.windowItem;
  const b = next.windowItem;
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!HEADER_ONLY_KEYS.has(key) && a[key] !== b[key]) return false;
  }
  return true;
};

// hidden: kept mounted but not shown (docked mode; Chart windows only).
function WorkspaceWindowBody({ windowItem, hidden = false }) {
  if (windowItem.type === WORKSPACE_WINDOW_TYPES.SOURCE) {
    return <Suspense fallback={bodyFallback}><SourceWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.CONFIGURATION) {
    return <Suspense fallback={bodyFallback}><ConfigurationWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.TASKS) {
    return <Suspense fallback={bodyFallback}><TasksWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.REPORTS) {
    return <Suspense fallback={bodyFallback}><ReportsWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.GRAPH) {
    return <Suspense fallback={bodyFallback}><GraphWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.TABLE) {
    return <Suspense fallback={bodyFallback}><TableWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.CHART) {
    return <Suspense fallback={bodyFallback}><ChartWindowBody windowItem={windowItem} hidden={hidden} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.LIBRARIES) {
    return <Suspense fallback={bodyFallback}><LibrariesWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.SETTINGS) {
    return <Suspense fallback={bodyFallback}><SettingsWindowBody windowItem={windowItem} /></Suspense>;
  }

  return (
    <div className="workspace_window_body">
      <p>{windowItem.title} workspace placeholder</p>
    </div>
  );
}

export default memo(WorkspaceWindowBody, areBodyPropsEqual);
