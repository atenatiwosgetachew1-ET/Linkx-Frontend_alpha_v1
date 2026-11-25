import React from 'react';

import { useActiveGraph } from '../../../features/graph/lib/useActiveGraph.js';
import { GraphSettingsPanel, NoGraphPanel } from '../../../features/graph/components/panel/GraphPanels.jsx';
import { PanelPage } from './PanelParts.jsx';

// Right panel → Settings: the active Graph window's own settings
// (graph-chart-plan §3.11). Appearance and themes: Settings ▸ Preferences.
export default function WorkspaceSettingsTab({ workspace }) {
  const graph = useActiveGraph(workspace);
  if (!graph.windowItem) return <NoGraphPanel title="Settings" icon="settings" graph={graph} />;
  return (
    <PanelPage label="Settings">
      <GraphSettingsPanel graph={graph} />
    </PanelPage>
  );
}
