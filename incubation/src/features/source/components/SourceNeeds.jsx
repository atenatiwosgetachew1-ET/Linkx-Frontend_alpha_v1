import React, { useSyncExternalStore } from 'react';

import { formatDomainPillarLabel } from '../../configuration/lib/configModel.js';
import { getSessionUsage, getTasksSnapshot, subscribeTasks } from '../../tasks/lib/taskRegistry.js';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { sourceNeeds } from '../lib/sourceNeeds.js';
import { SourceModeIcon } from './sourceUi.jsx';

// Glyphs for the rows (24px grid, stroked), by row id.
const ICONS = {
  address: 'M5 3h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 13h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM7 7h.01M7 17h.01',
  path: 'M21 19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2z',
  database: 'M12 8c4.4 0 8-1.3 8-3s-3.6-3-8-3-8 1.3-8 3 3.6 3 8 3zM20 12c0 1.7-3.6 3-8 3s-8-1.3-8-3M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5',
  tables: 'M4 4h16v16H4zM4 10h16M10 4v16',
  topic: 'M4 9h16M4 15h16M10 3L8 21M16 3l-2 18',
  tool: 'M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.4 6.5l7.2 1.1M7 8.3l2.2 7.4M16.4 9.9l-4.8 6.3',
  fuzzy: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35M7.5 12c1.2-1.6 2.3-1.6 3.5 0s2.3 1.6 3.5 0',
  strict: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 13.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM12 3v4M12 17v4M3 12h4M17 12h4',
  types: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  limit: 'M12 21a9 9 0 1 1 9-9M12 12l4.5-4.5',
};
export const PanelGlyph = ({ d, className }) => <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={d} /></svg>;

// A side panel's head (here and SourceSteps.jsx): the icon in a ring closed
// to `share` percent, then a small line, the name and a state. progress: the
// ring's ARIA values when it is a progress bar.
export function PanelHead({ icon, eyebrow, title, state, share, progress = null }) {
  return (
    <header className="source_window_flow_needs_head">
      <span className="source_window_flow_needs_ring" {...(progress ? { role: 'progressbar', ...progress } : { 'aria-hidden': true })}>
        <svg className="source_window_flow_needs_gauge" viewBox="0 0 52 52" aria-hidden="true" focusable="false">
          <circle className="source_window_flow_needs_track" cx="26" cy="26" r="24" />
          <circle className="source_window_flow_needs_arc" cx="26" cy="26" r="24" pathLength="100" strokeDasharray={`${share} 100`} />
        </svg>
        <span key={icon} className="source_window_flow_needs_icon"><SourceModeIcon type={icon} /></span>
      </span>
      <div className="source_window_flow_needs_names">
        <p className="source_window_flow_needs_domain">{eyebrow}</p>
        <h4 className="source_window_flow_needs_title">{title}</h4>
        <p className="source_window_flow_needs_state">{state}</p>
      </div>
    </header>
  );
}

// The first page's side panel (analyst request 2026-11-23): what the chosen
// connection needs, and what of it is already saved (lib/sourceNeeds.js). A
// ring round the connection's icon closes as more of it is saved.
export function SourceNeeds({ connection, inputMode, defaults, capacity = null, onSetUp }) {
  const { rows, missing, next } = sourceNeeds({ connectionType: connection.id, inputMode, defaults });
  const required = rows.filter((row) => row.state !== 'info').length;
  const share = required ? Math.round(((required - missing) / required) * 100) : 100;
  // The Configuration tab that holds what is missing.
  const tab = rows.some((row) => row.state === 'missing' && row.id !== 'tool') ? 'connections' : 'tools';
  return (
    <aside className={'source_window_flow_needs' + (missing ? ' is-missing' : '')} aria-label="What you need">
      <PanelHead
        icon={connection.icon}
        eyebrow={formatDomainPillarLabel(defaults.domain)}
        title={connection.label}
        state={missing ? `${missing} to fill in next` : 'All set to continue'}
        share={share}
      />

      {/* Keyed by the choice, so a change plays the rows' entrance. */}
      <div key={connection.id + inputMode} className="source_window_flow_needs_main">
        <ul className="source_window_flow_needs_list" aria-label="Saved settings">
          {rows.map((row, index) => (
            <li key={row.id} className={`source_window_flow_need is-${row.state}`} style={{ animationDelay: `${index * 45}ms` }}>
              <PanelGlyph className="source_window_flow_need_icon" d={ICONS[row.id]} />
              <span className="source_window_flow_need_label">{row.label}</span>
              <span className="source_window_flow_need_value" title={row.value}>{row.value}</span>
              {row.state === 'info' ? null : (
                <span className="source_window_flow_need_mark" role="img" aria-label={row.state === 'ok' ? 'Saved' : 'Not saved'}>
                  {row.state === 'ok' ? <PanelGlyph d="M6 12.5l4 4 8-9" /> : null}
                </span>
              )}
            </li>
          ))}
        </ul>
        {defaults.autoFill === false ? <p className="source_window_flow_needs_note">Auto fill is off, so saved values are not filled in for you.</p> : null}
        {missing && onSetUp ? (
          <button type="button" className="source_window_flow_needs_link" onClick={() => onSetUp(tab)}>
            Save in Configuration
            <PanelGlyph d="M5 12h14M13 6l6 6-6 6" />
          </button>
        ) : null}
      </div>

      <footer className="source_window_flow_needs_foot">
        <p className="source_window_flow_needs_next"><span className="source_window_flow_needs_next_label">Next</span>{next}</p>
        {capacity}
      </footer>
    </aside>
  );
}

// How many analysis sessions are in use (this window holds one).
export function SourceCapacity() {
  const { windows } = useWorkspace();
  const { tasks } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const usage = getSessionUsage(windows.filter((item) => item.type === WORKSPACE_WINDOW_TYPES.SOURCE).length, tasks);
  const used = Math.min(usage.used, usage.limit);
  return (
    <div className="source_window_flow_meter" role="meter" aria-label="Analysis sessions in use" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={used}>
      <p className="source_window_flow_meter_text">Analysis sessions <b>{used} of {usage.limit}</b></p>
      <span className="source_window_flow_meter_bar" aria-hidden="true">
        {Array.from({ length: usage.limit }, (_, index) => <i key={index} className={index < used ? 'is-on' : undefined} />)}
      </span>
    </div>
  );
}
