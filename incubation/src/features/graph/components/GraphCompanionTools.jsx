import React from 'react';

import StrokeIcon from '../../../shared/icons/StrokeIcon.jsx';
import { TOOL_ICONS } from '../../../shared/icons/windowIcons.js';
import GraphToolbarPopover from './GraphToolbarPopover.jsx';

// Toolbar dropdowns shared by a Graph window's companions (the Table and
// Chart windows): the linked graph, and the scope.

// The linked Graph window: the open ones to choose from, and Show graph.
// graphs: [{ id, title }]; graphId: the linked one.
export function LinkedGraphMenu({ icon, graphs, graphId, onLink, onShow }) {
  const current = graphs.find((item) => item.id === graphId);
  return (
    <GraphToolbarPopover label="Linked graph" tooltip={current ? `Linked to ${current.title}` : 'Linked graph'} icon={<StrokeIcon d={icon} />} text={current?.title || 'Graph'} align="left">
      {(close) => (
        <>
          <strong>Linked graph</strong>
          {graphs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === graphId}
              className="graph_overlay_menu_item"
              onClick={() => { close(); if (item.id !== graphId) onLink(item.id); }}
            >
              <span className="graph_overlay_menu_check" aria-hidden="true">{item.id === graphId ? '✓' : ''}</span>
              {item.title}
            </button>
          ))}
          <button type="button" role="menuitem" className="graph_overlay_menu_item is-separated" onClick={() => { close(); onShow(); }}>
            <StrokeIcon d={TOOL_ICONS.showGraph} className="graph_overlay_menu_icon" />
            Show graph
          </button>
        </>
      )}
    </GraphToolbarPopover>
  );
}

// Drawn / Selected / All. scopes: [{ id, label, hint }].
export function ScopeMenu({ scopes, scope, onScope }) {
  const current = scopes.find((entry) => entry.id === scope) || scopes[0];
  return (
    <GraphToolbarPopover label="Scope" tooltip={`Scope: ${current.hint}`} icon={<StrokeIcon d={TOOL_ICONS.scope} />} text={current.label}>
      {(close) => (
        <>
          <strong>Scope</strong>
          {scopes.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="menuitemradio"
              aria-checked={entry.id === scope}
              className="graph_overlay_menu_item is-described"
              onClick={() => { close(); onScope(entry.id); }}
            >
              <span className="graph_overlay_menu_check" aria-hidden="true">{entry.id === scope ? '✓' : ''}</span>
              <span>
                {entry.label}
                <small>{entry.hint}</small>
              </span>
            </button>
          ))}
        </>
      )}
    </GraphToolbarPopover>
  );
}
