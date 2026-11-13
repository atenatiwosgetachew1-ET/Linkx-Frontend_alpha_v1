import React from 'react';

import { sanitizeConnectionValue, sanitizeKafkaTopic } from '../../../../utils/inputSecurity.js';
import {
  displaySourceMessage,
  isSourceBusy,
  SOURCE_STATUSES,
  STREAM_STATUSES,
} from '../../lib/sourceModel.js';
import { Field, SourceModeIcon, StatusPill } from '../sourceUi.jsx';
import { ToolConnectionPanel } from './ToolConnectionPanel.jsx';

export function BrokerStep({ mode, state, windowId, toolOptions, validationMessage, toolValidationMessage, onPatchModeState, onSourceAction, onToolAction }) {
  const addressTypeName = 'broker-source-address-type-' + windowId + '-' + mode;
  const sourceConnected = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  const sourceDisabled = isSourceBusy(state) || state.streamStatus === STREAM_STATUSES.RUNNING;
  const isBroker = state.sourceAddressType !== 'api';

  return (
    <div className="source_window_step_body source_window_step_body_broker has-tool">
      <section className="source_window_broker_panel">
        <header className="source_window_broker_header">
          <span className="source_window_panel_title">
            <SourceModeIcon type="broker" />
            <h3>Message broker</h3>
          </span>
          <StatusPill label="Source" status={state.sourceStatus} />
        </header>

        <div className="source_window_broker_summary">
          <p>{state.sourceMessage || displaySourceMessage(state.sourceStatus)}</p>
          <span>Connect an Apache Kafka broker or a REST API before creating the dataframe.</span>
        </div>

        <div className="source_window_broker_type_group" role="radiogroup" aria-label="Broker source type">
          <label className={isBroker ? 'is-selected' : ''}>
            <input
              type="radio"
              name={addressTypeName}
              checked={isBroker}
              disabled={sourceConnected || sourceDisabled}
              onChange={() => onPatchModeState({ sourceAddressType: 'broker' })}
            />
            <SourceModeIcon type="kafka" />
            <span>Apache Kafka</span>
          </label>
          <label className={!isBroker ? 'is-selected' : ''}>
            <input
              type="radio"
              name={addressTypeName}
              checked={!isBroker}
              disabled={sourceConnected || sourceDisabled}
              onChange={() => onPatchModeState({ sourceAddressType: 'api' })}
            />
            <SourceModeIcon type="source" />
            <span>REST API</span>
          </label>
        </div>

        <div className={'source_window_broker_fields' + (isBroker ? '' : ' is-api')}>
          <Field label={isBroker ? 'Kafka broker address' : 'REST API address'}>
            <input
              type="text"
              value={state.brokerAddress}
              placeholder={isBroker ? 'host:9092' : 'https://api.example.com'}
              disabled={sourceConnected || sourceDisabled}
              onChange={(event) => onPatchModeState({ brokerAddress: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          {isBroker && (
            <Field label="Kafka topic">
              <input
                type="text"
                value={state.topic}
                placeholder="Enter Kafka topic"
                disabled={sourceConnected || sourceDisabled}
                onChange={(event) => onPatchModeState({ topic: sanitizeKafkaTopic(event.target.value) })}
              />
            </Field>
          )}
          <button type="button" disabled={sourceDisabled} onClick={onSourceAction}>
            {sourceConnected ? 'Disconnect' : isSourceBusy(state) ? displaySourceMessage(state.sourceStatus) : 'Connect'}
          </button>
        </div>

        {validationMessage && <p className="source_window_validation" role="status">{validationMessage}</p>}

        <div className="source_window_broker_preview">
          <span />
          <p>No broker messages to show.</p>
        </div>
      </section>
      <ToolConnectionPanel
        state={state}
        windowId={windowId}
        mode={mode}
        toolOptions={toolOptions}
        validationMessage={toolValidationMessage}
        onPatchModeState={onPatchModeState}
        onToolAction={onToolAction}
      />
    </div>
  );
}
