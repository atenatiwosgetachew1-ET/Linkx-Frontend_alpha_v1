import React from 'react';

import { useBackgroundAnimations } from '../../../utils/backgroundAnimations.js';
import { SOURCE_FLOW_ALIGN } from '../lib/sourceFrame.js';
import { SOURCE_MODES } from '../lib/sourceModel.js';
import { SourceNeeds } from './SourceNeeds.jsx';
import { SourceModeIcon } from './sourceUi.jsx';

// The Source window's first page as one calm surface (analyst request
// 2026-11-23): the path the data will take, drawn from the choices made;
// the input mode as one sliding control; the connections as plain tiles;
// the configuration as a quiet last line. The choices and what they do are
// ModeChooser's; this only draws them. Styles: source-start-flow.css.

const MODES = [
  { id: SOURCE_MODES.BATCH, icon: 'batch', title: 'Batch / historical data', note: 'Import, search, or load data in batches.' },
  { id: SOURCE_MODES.REALTIME, icon: 'realtime', title: 'Live / streaming data', note: 'Ingest events as they happen.' },
];

// A stop on the path. Keyed by what it shows, so a change plays its entrance.
function Stop({ icon, value, label, end = false }) {
  return (
    <span className={'source_window_flow_stop' + (end ? ' is-end' : '')}>
      <span key={value} className="source_window_flow_stop_icon">
        {end ? (
          <svg viewBox="0 0 24 24" focusable="false"><path d="M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM10 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.4 6.5l7.2 1.1M7 8.3l2.2 7.4M16.4 9.9l-4.8 6.3" /></svg>
        ) : <SourceModeIcon type={icon} />}
      </span>
      <strong className="source_window_flow_stop_value">{value}</strong>
      <small className="source_window_flow_stop_label">{label}</small>
    </span>
  );
}

const Link = () => <span className="source_window_flow_link"><i /><i /><i /></span>;

// defaults: the resolved configuration (lib/sourceConfig.js); with it, what
// the connection needs is shown in a side panel. capacity: a line for its foot.
export function SourceStartFlow({ connections, inputMode, connectionType, defaults = null, capacity = null, onInputMode, onConnection, onOpenConfiguration, onSetUpConnection }) {
  // The dots on the path move only with Settings ▸ Preferences ▸ background
  // animations on; otherwise they stand still.
  const { areBackgroundAnimationsEnabled } = useBackgroundAnimations();
  const live = inputMode === SOURCE_MODES.REALTIME;
  const connection = connections.find((option) => option.id === connectionType) || connections[0];
  const arrival = live ? 'Live' : 'In batches';

  return (
    <div className={'source_window_flow' + (live ? ' is-live' : '') + (areBackgroundAnimationsEnabled ? '' : ' is-still') + (SOURCE_FLOW_ALIGN === 'left' ? ' is-left' : '')}>
      <div className="source_window_flow_inner">
        <div className="source_window_flow_path" role="img" aria-label={`${connection.label}, ${arrival.toLowerCase()}, into analysis`}>
          <Stop icon={connection.icon} value={connection.label} label="Source" />
          <Link />
          <Stop icon={live ? 'realtime' : 'batch'} value={arrival} label="Arrives" />
          <Link />
          <Stop value="Analysis" label="Linkx" end />
        </div>

        <section className="source_window_flow_section is-modes">
          <header className="source_window_flow_heading">
            <h4 className="source_window_flow_title">Input mode</h4>
            <p className="source_window_flow_note">How your data will arrive</p>
          </header>
          <div className="source_window_flow_modes" role="group" aria-label="Input mode">
            {MODES.map((mode) => {
              const on = inputMode === mode.id;
              return (
                <button key={mode.id} type="button" className={'source_window_flow_mode' + (on ? ' is-selected' : '')} aria-pressed={on} onClick={() => onInputMode(mode.id)}>
                  <SourceModeIcon type={mode.icon} />
                  <span className="source_window_flow_mode_text">
                    <strong className="source_window_flow_mode_title">{mode.title}</strong>
                    <small className="source_window_flow_mode_note">{mode.note}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="source_window_flow_section is-connections">
          <header className="source_window_flow_heading">
            <h4 className="source_window_flow_title">Connection</h4>
            <p className="source_window_flow_note">{live ? 'Live data comes through a message broker' : 'Where your data is'}</p>
          </header>
          <div className="source_window_flow_connections" role="group" aria-label="Connection type">
            {connections.map((option) => {
              const on = connectionType === option.id;
              return (
                <button key={option.id} type="button" className={'source_window_flow_connection' + (on ? ' is-selected' : '')} aria-pressed={on} disabled={option.disabled} onClick={() => onConnection(option.id)}>
                  <SourceModeIcon type={option.icon} />
                  <strong className="source_window_flow_connection_title">{option.label}</strong>
                  {option.badge && <small className="source_window_flow_connection_note">{option.badge}</small>}
                </button>
              );
            })}
          </div>
        </section>

        <button type="button" className="source_window_flow_configure" onClick={onOpenConfiguration}>
          <SourceModeIcon type="configure" />
          <strong className="source_window_flow_configure_title">Open configuration</strong>
          <small className="source_window_flow_configure_note">Optional. Saved settings prefill the connection fields.</small>
          <svg className="source_window_flow_arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </div>
      {defaults ? <SourceNeeds connection={connection} inputMode={inputMode} defaults={defaults} capacity={capacity} onSetUp={onSetUpConnection} /> : null}
    </div>
  );
}
