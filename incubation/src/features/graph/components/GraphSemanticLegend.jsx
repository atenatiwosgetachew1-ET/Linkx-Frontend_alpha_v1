import React from 'react';

import { semanticLegend } from '../lib/graphModel.js';
import { describeRule } from '../lib/conditionalFormatting.js';
import { RuleSample } from './GraphFormattingBox.jsx';

// Production's edge semantic legend (graphs_basic.html #semantic-legend):
// bottom-left of the canvas, "Relationship Types", one line sample per edge
// semantic, worded for CDR or NBE. It takes no clicks (pointer-events none,
// as production), so it never blocks the graph under it.
//
// rules: the conditional formatting rules that are on (i2 #4), listed under
// "Formatting" with their look, so a screenshot explains itself.
export default function GraphSemanticLegend({ isCdr, rules = [] }) {
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
      {rules.length ? (
        <>
          <strong className="graph_semantic_legend_sub">Formatting</strong>
          {rules.map((rule) => (
            <div key={rule.id} className="graph_semantic_legend_row is-rule">
              <RuleSample rule={rule} />
              <span>{rule.name || describeRule(rule)}</span>
            </div>
          ))}
        </>
      ) : null}
    </div>
  );
}
