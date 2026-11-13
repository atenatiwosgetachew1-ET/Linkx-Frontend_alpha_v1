import React, { useEffect, useState } from 'react';

import { isMaskedSecret } from '../../../../services/sourceApi.js';
import { sanitizeConnectionValue, sanitizeIdentifier, sanitizeSecret } from '../../../../utils/inputSecurity.js';
import {
  displayToolMessage,
  isSourceReady,
  isToolBusy,
  secretScopeOf,
  STREAM_STATUSES,
  TOOL_STATUSES,
} from '../../lib/sourceModel.js';
import { getSecret, setSecret } from '../../lib/sourceRuntime.js';
import { Field, SourceModeIcon, StatusPill } from '../sourceUi.jsx';

export function ToolConnectionPanel({ state, windowId, mode, toolOptions = ['neo4j'], validationMessage, onPatchModeState, onToolAction }) {
  const toolConnected = state.toolStatus === TOOL_STATUSES.CONNECTED;
  const toolDisabled = isToolBusy(state) || !isSourceReady(state) || state.streamStatus === STREAM_STATUSES.RUNNING;
  const fieldsLocked = toolConnected || toolDisabled;
  const usesSavedPassword = isMaskedSecret(state.toolPassword) && Boolean(state.toolPasswordRef);
  const scope = secretScopeOf(mode);
  // The typed password is kept in the window runtime, not in window state.
  const [typedPassword, setTypedPassword] = useState(() => getSecret(windowId, scope));
  useEffect(() => {
    // Cleared after a successful connect (runToolConnect drops the secret).
    if (!state.toolPasswordTyped) setTypedPassword(getSecret(windowId, scope));
  }, [state.toolPasswordTyped, windowId, scope]);

  return (
    <section className="source_window_section">
      <header>
        <span className="source_window_panel_title">
          <SourceModeIcon type={(toolOptions[0] || 'neo4j') === 'neo4j' ? 'neo4j' : 'tool'} />
          <h3>Tool integration · {(toolOptions[0] || 'neo4j') === 'neo4j' ? 'Neo4j' : toolOptions[0]}</h3>
        </span>
        <StatusPill label="Tool" status={state.toolStatus} />
      </header>
      <p className="source_window_status_text">{state.toolMessage || displayToolMessage(state.toolStatus)}</p>
      {!isSourceReady(state) && !toolConnected && (
        <p className="source_window_tool_hint">Connect the source first, then connect the tool.</p>
      )}
      <div className="source_window_form_grid">
        <Field label="Tool">
          <select value={toolOptions[0] || 'neo4j'} disabled>
            {toolOptions.map((tool) => <option key={tool} value={tool}>{tool === 'neo4j' ? 'Neo4j' : tool}</option>)}
          </select>
        </Field>
        <Field label="URL">
          <input
            type="text"
            value={state.toolUrl}
            placeholder="neo4j://host:7687"
            disabled={fieldsLocked}
            onChange={(event) => onPatchModeState({ toolUrl: sanitizeConnectionValue(event.target.value) })}
          />
        </Field>
        <Field label="Username">
          <input
            type="text"
            value={state.toolUsername}
            placeholder="Username"
            disabled={fieldsLocked}
            onChange={(event) => onPatchModeState({ toolUsername: sanitizeIdentifier(event.target.value) })}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            autoComplete="new-password"
            value={typedPassword}
            placeholder={usesSavedPassword ? 'Saved password (leave empty to use it)' : 'Password'}
            disabled={fieldsLocked}
            onChange={(event) => {
              const nextPassword = sanitizeSecret(event.target.value);
              setTypedPassword(nextPassword);
              setSecret(windowId, scope, nextPassword);
              // Only a flag reaches window state; typing a real password
              // replaces the saved-secret reference.
              if (Boolean(nextPassword) !== Boolean(state.toolPasswordTyped)) {
                onPatchModeState({ toolPasswordTyped: Boolean(nextPassword) });
              }
            }}
          />
        </Field>
        <Field label="Database">
          <input
            type="text"
            value={state.toolDatabase}
            placeholder="Database name"
            disabled={fieldsLocked}
            onChange={(event) => onPatchModeState({ toolDatabase: sanitizeIdentifier(event.target.value) })}
          />
        </Field>
      </div>
      <div className="source_window_actions">
        <button type="button" disabled={toolDisabled} onClick={onToolAction}>
          {toolConnected ? 'Disconnect tool' : isToolBusy(state) ? displayToolMessage(state.toolStatus) : 'Connect tool'}
        </button>
      </div>
      {validationMessage && <p className="source_window_validation" role="status">{validationMessage}</p>}
    </section>
  );
}
