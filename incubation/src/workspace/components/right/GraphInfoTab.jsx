import React from 'react';

import { useActiveGraph } from '../../../features/graph/lib/useActiveGraph.js';
import { GraphInfoPanel, NoGraphPanel } from '../../../features/graph/components/panel/GraphPanels.jsx';

// Right panel → Info: the active Graph window's source, size and selected
// node (graph-chart-plan §3.11).
export default function GraphInfoTab({ workspace }) {
  const graph = useActiveGraph(workspace);
  return graph.windowItem ? <GraphInfoPanel graph={graph} /> : <NoGraphPanel title="Info" icon="info" graph={graph} />;
}
