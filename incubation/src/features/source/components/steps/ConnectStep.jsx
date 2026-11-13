import React from 'react';

import { sanitizeConnectionValue, sanitizeKafkaTopic } from '../../../../utils/inputSecurity.js';
import {
  displaySourceMessage,
  isSourceBusy,
  SOURCE_MODES,
  SOURCE_STATUSES,
  STREAM_STATUSES,
} from '../../lib/sourceModel.js';
import { Field, StatusPill } from '../sourceUi.jsx';
import { ToolConnectionPanel } from './ToolConnectionPanel.jsx';

export function ConnectStep({ mode, state, windowId, toolOptions, validationMessage, onPatchModeState, onSourceAction, onToolAction }) {
  const isRealtime = mode === SOURCE_MODES.REALTIME;
  const addressTypeName = 'source-address-type-' + windowId + '-' + mode;
  const sourceConnected = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  const sourceDisabled = isSourceBusy(state) || state.streamStatus === STREAM_STATUSES.RUNNING;

  return (
    <div className="source_window_step_body">
      <section className="source_window_section">
        <header>
          <h3>{isRealtime ? 'Broker/API connection' : 'Source connection'}</h3>
          <StatusPill label="Source" status={state.sourceStatus} />
        </header>
        <p className="source_window_status_text">{state.sourceMessage || displaySourceMessage(state.sourceStatus)}</p>
        <div className="source_window_radio_group" role="radiogroup" aria-label="Source address type">
          <label>
            <input
              type="radio"
              name={addressTypeName}
              checked={state.sourceAddressType === 'broker'}
              disabled={sourceConnected || sourceDisabled}
              onChange={() => onPatchModeState({ sourceAddressType: 'broker' })}
            />
            <span>Apache Kafka</span>
          </label>
          <label>
            <input
              type="radio"
              name={addressTypeName}
              checked={state.sourceAddressType === 'api'}
              disabled={sourceConnected || sourceDisabled}
              onChange={() => onPatchModeState({ sourceAddressType: 'api' })}
            />
            <span>REST API</span>
          </label>
          {!isRealtime && (
            <label>
              <input
                type="radio"
                name={addressTypeName}
                checked={state.sourceAddressType === 'storage'}
                disabled={sourceConnected || sourceDisabled}
                onChange={() => onPatchModeState({ sourceAddressType: 'storage' })}
              />
              <span>Apache Hadoop (HDFS)</span>
            </label>
          )}
        </div>
        <div className="source_window_form_grid">
          {state.sourceAddressType !== 'storage' && (
            <>
              <Field label="Broker/API address">
                <input
                  type="text"
                  value={state.brokerAddress}
                  placeholder="Enter Broker/API address"
                  disabled={sourceConnected || sourceDisabled}
                  onChange={(event) => onPatchModeState({ brokerAddress: sanitizeConnectionValue(event.target.value) })}
                />
              </Field>
              {state.sourceAddressType === 'broker' && (
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
            </>
          )}
          {!isRealtime && (
            <Field label="HDFS address">
              <input
                type="text"
                value={state.storageAddress}
                placeholder="Enter HDFS address"
                disabled={sourceConnected || sourceDisabled}
                onChange={(event) => onPatchModeState({ storageAddress: sanitizeConnectionValue(event.target.value) })}
              />
            </Field>
          )}
        </div>
        <div className="source_window_actions">
          <button type="button" disabled={sourceDisabled} onClick={onSourceAction}>
            {sourceConnected ? 'Disconnect source' : isSourceBusy(state) ? displaySourceMessage(state.sourceStatus) : 'Connect source'}
          </button>
        </div>
      </section>
      <ToolConnectionPanel
        state={state}
        windowId={windowId}
        mode={mode}
        toolOptions={toolOptions}
        validationMessage={validationMessage}
        onPatchModeState={onPatchModeState}
        onToolAction={onToolAction}
      />
    </div>
  );
}
