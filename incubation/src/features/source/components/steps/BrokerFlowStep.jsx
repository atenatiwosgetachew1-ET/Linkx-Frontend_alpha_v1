import React from 'react';

import { sanitizeConnectionValue, sanitizeKafkaTopic } from '../../../../utils/inputSecurity.js';
import {
  brokerUsesDefault,
  displaySourceMessage,
  isSourceBusy,
  SOURCE_STATUSES,
  STREAM_STATUSES,
  typedBrokerValues,
} from '../../lib/sourceModel.js';
import { Field, SourceModeIcon, StatusPill, ToolbarToggle } from '../sourceUi.jsx';

// The Message broker page while the Source window's flow pages are on
// (sourceFrame.js): laid out like the Storage page, whose classes it uses
// (its colours are its own: source-broker.css), with the same "Use Default"
// and collapsible form. A configured default is never shown. The tool is connected on
// Continue; `toolPanel` is there only when that failed.
export function BrokerFlowStep({ state, defaults, windowId, validationMessage, toolPanel, onPatchModeState, onSourceAction }) {
  const connected = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  const busy = isSourceBusy(state);
  const disabled = busy || state.streamStatus === STREAM_STATUSES.RUNNING;
  const locked = connected || disabled;
  const usesDefault = brokerUsesDefault(state, defaults);
  const typed = typedBrokerValues(state, defaults);
  // A manual target shows what was typed, even when it equals the default.
  const address = usesDefault ? typed.brokerAddress : state.brokerAddress;
  const topic = usesDefault ? typed.topic : state.topic;
  const collapsed = state.brokerToolbarCollapsed !== false;
  const toolbarId = `source-broker-toolbar-${windowId}`;
  const unusedTitle = usesDefault ? 'Not used: "Use Default" connects to the configured broker.' : undefined;
  const isKafka = state.sourceAddressType !== 'api';
  const types = [
    { id: 'broker', icon: 'kafka', label: 'Apache Kafka', on: isKafka },
    { id: 'api', icon: 'source', label: 'REST API', on: !isKafka },
  ];
  const emptyMessage = busy
    ? displaySourceMessage(state.sourceStatus)
    : connected
      ? 'No broker messages to show.'
      : state.sourceStatus === SOURCE_STATUSES.FAILED
        ? state.sourceMessage || displaySourceMessage(state.sourceStatus)
        : 'Connect to the broker before creating the dataframe.';

  return (
    <div className="source_window_step_body source_window_step_body_storage source_window_flow_storage source_window_flow_broker">
      <section className={'source_window_storage_browser' + (collapsed ? ' is-toolbar-collapsed' : '')}>
        <header className="source_window_storage_browser_header">
          <div className="source_window_storage_title">
            <h3>Message broker</h3>
            <StatusPill label="Source" status={state.sourceStatus} />
          </div>
          <div className="source_window_storage_type_buttons" role="group" aria-label="Broker source type">
            {types.map((type) => (
              <button
                key={type.id}
                type="button"
                className={type.on ? 'is-selected' : undefined}
                aria-pressed={type.on}
                disabled={locked}
                onClick={() => onPatchModeState({ sourceAddressType: type.id })}
              >
                <SourceModeIcon type={type.icon} />
                <span>{type.label}</span>
              </button>
            ))}
          </div>
          <ToolbarToggle
            collapsed={collapsed}
            controlsId={toolbarId}
            onToggle={() => onPatchModeState({ brokerToolbarCollapsed: !collapsed })}
          />
        </header>

        <div className="source_window_storage_fields" id={toolbarId} hidden={collapsed}>
          <label className="source_window_storage_default_toggle">
            <input
              type="checkbox"
              checked={usesDefault}
              disabled={locked}
              title={connected ? 'Disconnect to change the broker target.' : undefined}
              // Hidden prefilled defaults are dropped, so a manual connection
              // only uses what the analyst types.
              onChange={(event) => onPatchModeState({ brokerUseDefault: event.target.checked, ...typed })}
            />
            <span>Use Default</span>
          </label>
          <Field label={isKafka ? 'Kafka broker address' : 'REST API address'} className={usesDefault ? 'is-discarded' : ''}>
            <input
              type="text"
              value={address}
              title={unusedTitle}
              placeholder={usesDefault ? 'Default' : isKafka ? 'host:9092' : 'https://api.example.com'}
              disabled={usesDefault || locked}
              onChange={(event) => onPatchModeState({ brokerAddress: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          {isKafka ? (
            <Field label="Kafka topic" className={usesDefault ? 'is-discarded' : ''}>
              <input
                type="text"
                value={topic}
                title={unusedTitle}
                placeholder={usesDefault ? 'Default' : 'Enter Kafka topic'}
                disabled={usesDefault || locked}
                onChange={(event) => onPatchModeState({ topic: sanitizeKafkaTopic(event.target.value) })}
              />
            </Field>
          ) : null}
          <button type="button" className="source_window_storage_connect_button" disabled={disabled} onClick={onSourceAction}>
            {connected ? 'Disconnect' : busy ? displaySourceMessage(state.sourceStatus) : 'Connect'}
          </button>
        </div>

        <div className="source_window_flow_results">
          <div className="source_window_flow_table_box">
            <div className="source_window_flow_table_scroll">
              <table className="source_window_flow_table" aria-label="Broker messages">
                <thead><tr><th className="is-index">#</th><th>Message</th></tr></thead>
              </table>
              <p className="source_window_flow_table_empty" role="status" aria-live="polite">{emptyMessage}</p>
            </div>
          </div>
          {validationMessage ? <p className="source_window_validation" role="alert">{validationMessage}</p> : null}
        </div>
      </section>
      {toolPanel}
    </div>
  );
}
