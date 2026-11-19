import React from 'react';

import { useActiveGraph } from '../../../features/graph/lib/useActiveGraph.js';
import { CompanionPanelNote, GraphFilterPanel } from '../../../features/graph/components/panel/GraphPanels.jsx';

// Right panel → Filter: search the active Graph window (production graph
// search; graph-chart-plan §3.11).
export default function GraphFilterTab({ workspace }) {
  const graph = useActiveGraph(workspace);
  if (graph.windowItem) return <GraphFilterPanel graph={graph} />;
  return (
    <section className="workspace_context_section" aria-label="Graph filters">
      <h2>Filter</h2>
      {graph.companion ? <CompanionPanelNote kind={graph.companion} graphTitle={graph.companionGraph?.title || ''} /> : <p className="workspace_context_hint">Select a Graph window.</p>}
    </section>
  );
}
