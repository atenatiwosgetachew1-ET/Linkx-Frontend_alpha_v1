import React, { Suspense, lazy, memo } from 'react';

import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';
import WindowLoadScreen from '../../shared/components/WindowLoadScreen.jsx';

const SourceWindowBody = lazy(() => import('../../features/source/components/SourceWindowBody.jsx'));
const SettingsWindowBody = lazy(() => import('../../features/settings/components/SettingsWindowBody.jsx'));
const ConfigurationWindowBody = lazy(() => import('../../features/configuration/components/ConfigurationWindowBody.jsx'));
const TasksWindowBody = lazy(() => import('../../features/tasks/components/TasksWindowBody.jsx'));

const bodyFallback = (
  <div className="workspace_window_body">
    <WindowLoadScreen />
  </div>
);

// Header-only fields: editing them must not re-render the (heavy) window body.
const HEADER_ONLY_KEYS = new Set(['customTitle', 'updatedAt']);

const areBodyPropsEqual = (prev, next) => {
  const a = prev.windowItem;
  const b = next.windowItem;
  if (a === b) return true;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!HEADER_ONLY_KEYS.has(key) && a[key] !== b[key]) return false;
  }
  return true;
};

function WorkspaceWindowBody({ windowItem }) {
  if (windowItem.type === WORKSPACE_WINDOW_TYPES.SOURCE) {
    return <Suspense fallback={bodyFallback}><SourceWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.CONFIGURATION) {
    return <Suspense fallback={bodyFallback}><ConfigurationWindowBody windowItem={windowItem} /></Suspense>;
  }

  if (windowItem.type === WORKSPACE_WINDOW_TYPES.TASKS) {
    return <Suspense fallback={bodyFallback}><TasksWindowBody windowItem={windowItem} /></Suspense>;
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
