import React from 'react';

import SourceWindowBody from '../../features/source/components/SourceWindowBody.jsx';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';

export default function WorkspaceWindowBody({ windowItem }) {
  if (windowItem.type === WORKSPACE_WINDOW_TYPES.SOURCE) {
    return <SourceWindowBody windowItem={windowItem} />;
  }

  return (
    <div className="workspace_window_body">
      <p>{windowItem.title} workspace placeholder</p>
    </div>
  );
}
