import React from 'react';

import { useActiveGraph } from '../../../features/graph/lib/useActiveGraph.js';
import { GraphFilterPanel, NoGraphPanel } from '../../../features/graph/components/panel/GraphPanels.jsx';

// Right panel → Filter: search the active Graph window (production graph
// search; graph-chart-plan §3.11).
export default function GraphFilterTab({ workspace }) {
  const graph = useActiveGraph(workspace);
  return graph.windowItem ? <GraphFilterPanel graph={graph} /> : <NoGraphPanel title="Filter" icon="filter" graph={graph} />;
}
