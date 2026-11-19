import React from 'react';

import { useActiveGraph } from '../../../features/graph/lib/useActiveGraph.js';
import { CompanionPanelNote, GraphInfoPanel } from '../../../features/graph/components/panel/GraphPanels.jsx';

// Right panel → Info: the active Graph window's source, size and selected
// node (graph-chart-plan §3.11).
export default function GraphInfoTab({ workspace }) {
  const graph = useActiveGraph(workspace);
  if (graph.windowItem) return <GraphInfoPanel graph={graph} />;
  return (
    <section className="workspace_context_section" aria-label="Graph information">
      <h2>Info</h2>
      {graph.companion ? <CompanionPanelNote kind={graph.companion} graphTitle={graph.companionGraph?.title || ''} /> : <p className="workspace_context_hint">Select a Graph window.</p>}
    </section>
  );
}
