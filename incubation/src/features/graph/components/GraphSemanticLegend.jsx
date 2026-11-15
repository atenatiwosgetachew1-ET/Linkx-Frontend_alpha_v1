import React from 'react';

import { semanticLegend } from '../lib/graphModel.js';

// Production's edge semantic legend (graphs_basic.html #semantic-legend):
// bottom-left of the canvas, "Relationship Types", one line sample per edge
// semantic, worded for CDR or NBE. It takes no clicks (pointer-events none,
// as production), so it never blocks the graph under it.
export default function GraphSemanticLegend({ isCdr }) {
  return (
    <div className="graph_semantic_legend" role="note" aria-label="Relationship Types">
      <strong>Relationship Types</strong>
      {semanticLegend(isCdr).map((entry) => (
        <div key={entry.id} className={`graph_semantic_legend_row${entry.flag ? ' is-flag' : ''}`} style={{ opacity: entry.opacity }}>
          <svg width="32" height="8" viewBox="0 0 40 10" aria-hidden="true" focusable="false">
            <path d={entry.arrow ? 'M0,5 L34,5' : 'M0,5 L40,5'} strokeDasharray={entry.dash || undefined} />
            {entry.arrow ? <polygon points="34,2 40,5 34,8" /> : null}
          </svg>
          <span>{entry.text}</span>
        </div>
      ))}
    </div>
  );
}
