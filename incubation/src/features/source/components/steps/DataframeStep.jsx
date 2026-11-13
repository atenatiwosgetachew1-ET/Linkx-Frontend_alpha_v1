import React, { useEffect } from 'react';

import { sanitizeRelationshipName } from '../../../../utils/inputSecurity.js';
import {
  DATAFRAME_ACTION_BACKEND_VALUES,
  DATAFRAME_STATUSES,
  modeLabels,
  SOURCE_MODES,
} from '../../lib/sourceModel.js';
import { DataframeField, SourceModeIcon } from '../sourceUi.jsx';

export function DataframeStep({ mode, state, defaults, validationMessage, onPatchModeState, onOpenConfiguration, onOpenLibrary }) {
  const info = state.dataframeInfo;
  const isReady = state.dataframeStatus === DATAFRAME_STATUSES.READY && Boolean(info);
  // Real dataframe columns/rules once create_DF answered; configuration
  // (fetch_columns / rule names) is the fallback for flows not wired yet.
  const columnOptions = info?.columns?.length ? info.columns : defaults.dataframe.fetchColumns;
  const ruleOptions = info?.rules?.length
    ? info.rules
    : (defaults.dataframe.rules.length ? defaults.dataframe.rules : defaults.dataframe.builtinRules);
  const backendActions = info?.actions || [];
  const isActionAvailable = (action) => (
    backendActions.length === 0 ||
    backendActions.includes(action) ||
    backendActions.includes(DATAFRAME_ACTION_BACKEND_VALUES[action])
  );
  const sampleActions = ['Store data', 'Source / Target Mapping', 'Link Analysis'];
  const actionIconTypes = {
    'Store data': 'batch',
    'Source / Target Mapping': 'broker',
    'Link Analysis': 'link',
  };
  const actionDescriptions = {
    'Store data': {
      text: 'Stores the prepared dataframe in the selected tool without creating relationships.',
      detail: 'Use this when the dataframe only needs to be persisted for later analysis.',
    },
    'Source / Target Mapping': {
      text: 'Maps columns from your source to target and selects the relationship label used to create graph relationships.',
      detail: 'This step uses the selected source and target columns along with the provided label.',
    },
    'Link Analysis': {
      text: 'Applies a saved rule to the dataframe so analysis flags can create relationships.',
      detail: 'Use this when rule results should become graph-ready links.',
    },
  };
  const selectedActionDescription = actionDescriptions[state.dataframeAction] || {
    text: 'Please select a dataframe action to continue.',
    detail: 'Required fields will appear below based on the selected action.',
  };
  // Keep the selections valid for this dataframe: an empty or unavailable
  // action falls back to the first offered one (Link Analysis preferred), and a
  // rule/column kept from an earlier dataframe or domain that is no longer
  // offered is cleared, so it can never be sent with the stream request.
  const preferredAction = ['Link Analysis', ...sampleActions].find(isActionAvailable) || '';
  const actionValid = Boolean(state.dataframeAction) && isActionAvailable(state.dataframeAction);
  const staleRule = Boolean(state.rule) && !ruleOptions.includes(state.rule);
  const staleSource = Boolean(state.sourceColumn) && !columnOptions.includes(state.sourceColumn);
  const staleTarget = Boolean(state.targetColumn) && !columnOptions.includes(state.targetColumn);
  useEffect(() => {
    const patch = {
      ...(!actionValid && preferredAction ? { dataframeAction: preferredAction } : {}),
      ...(isReady && staleRule ? { rule: '' } : {}),
      ...(isReady && staleSource ? { sourceColumn: '' } : {}),
      ...(isReady && staleTarget ? { targetColumn: '' } : {}),
    };
    if (Object.keys(patch).length) onPatchModeState(patch);
  }, [actionValid, preferredAction, isReady, staleRule, staleSource, staleTarget, onPatchModeState]);
  const sameColumns = Boolean(state.sourceColumn) && state.sourceColumn === state.targetColumn;

  const showsMappingFields = state.dataframeAction === 'Source / Target Mapping';
  const showsRuleField = state.dataframeAction === 'Link Analysis';
  // Config/library shortcuts: hidden for plain storage, shown but locked for
  // mapping (no rules involved), active otherwise.
  const showsQuickLinks = state.dataframeAction !== 'Store data';
  const quickLinksDisabled = showsMappingFields;

  return (
    <div className="source_window_step_body source_window_step_body_dataframe">
      <section className="source_window_dataframe_card source_window_dataframe_info">
        <header className="source_window_dataframe_card_header">
          <span className="source_window_panel_title">
            <SourceModeIcon type="table" />
            <h3>Actions and Dataframe information</h3>
          </span>
          <span className="source_window_panel_pill">
            <SourceModeIcon type={isReady ? 'table' : 'clock'} />
            {isReady ? 'Dataframe ready' + (info.storage || info.source ? ' · ' + (info.storage || info.source) : '') : 'Waiting for dataframe creation'}
          </span>
        </header>
        <dl className="source_window_dataframe_metrics">
          <div>
            <SourceModeIcon type={mode === SOURCE_MODES.REALTIME ? 'realtime' : 'batch'} />
            <dl><dt>Source mode</dt><dd>{modeLabels[mode]}</dd></dl>
          </div>
          <div>
            <SourceModeIcon type="table" />
            <dl><dt>Total rows</dt><dd>{isReady ? String(info.totalRows) : '—'}</dd></dl>
          </div>
          <div>
            <SourceModeIcon type="table" />
            <dl><dt>Total columns</dt><dd>{isReady ? String(info.totalColumns) : '—'}</dd></dl>
          </div>
          <div>
            <SourceModeIcon type={String(info?.tool || defaults.tool.name || '').toLowerCase() === 'neo4j' ? 'neo4j' : 'tool'} />
            <dl><dt>Tool</dt><dd>{info?.tool || (defaults.tool.name === 'neo4j' ? 'Neo4j' : defaults.tool.name)}</dd></dl>
          </div>
        </dl>
      </section>
      <section className="source_window_dataframe_card source_window_dataframe_actions_card">
        <div className="source_window_dataframe_form_grid">
          <div className="source_window_dataframe_action_description">
            <span className="source_window_dataframe_info_mark" aria-hidden="true">i</span>
            <div>
              <p>{selectedActionDescription.text}</p>
              <small>{selectedActionDescription.detail}</small>
            </div>
          </div>

          <div className="source_window_dataframe_action_area">
            <div className="source_window_dataframe_action_group" role="group" aria-label="Dataframe action">
              {sampleActions.map((action) => (
                <button
                  key={action}
                  type="button"
                  className={state.dataframeAction === action ? 'is-selected' : ''}
                  aria-pressed={state.dataframeAction === action}
                  disabled={!isActionAvailable(action)}
                  title={isActionAvailable(action) ? undefined : 'Not offered for this dataframe'}
                  onClick={() => onPatchModeState({ dataframeAction: action })}
                >
                  <SourceModeIcon type={actionIconTypes[action]} />
                  <span>{action}</span>
                </button>
              ))}
            </div>
          </div>

          {showsMappingFields && (
            <div className="source_window_dataframe_relation_grid">
              <DataframeField label="Source column" icon="batch" required filled={Boolean(state.sourceColumn)}>
                <select value={state.sourceColumn} onChange={(event) => onPatchModeState({ sourceColumn: event.target.value })}>
                  <option value="">Select source</option>
                  {columnOptions.map((column) => <option key={column} value={column} disabled={column === state.targetColumn}>{column}</option>)}
                </select>
              </DataframeField>
              <DataframeField label="Target column" icon="batch" required filled={Boolean(state.targetColumn) && !sameColumns}>
                <select value={state.targetColumn} onChange={(event) => onPatchModeState({ targetColumn: event.target.value })}>
                  <option value="">Select target</option>
                  {columnOptions.map((column) => <option key={column} value={column} disabled={column === state.sourceColumn}>{column}</option>)}
                </select>
              </DataframeField>
              <DataframeField label="Relationship label" icon="link">
                <input
                  type="text"
                  value={state.relationship}
                  placeholder={defaults.dataframe.relationship || 'HAS_RELATIONSHIP'}
                  maxLength={80}
                  // Same normalisation the stream request applies (A-Z, 0-9, _).
                  onChange={(event) => onPatchModeState({ relationship: sanitizeRelationshipName(event.target.value) })}
                />
              </DataframeField>
            </div>
          )}

          {showsRuleField && (
            <div className="source_window_dataframe_rule_area">
              <DataframeField label="Rule to apply" icon="table" required filled={Boolean(state.rule)}>
                <select value={state.rule} onChange={(event) => onPatchModeState({ rule: event.target.value })}>
                  <option value="">Select analysis rule</option>
                  {ruleOptions.map((rule) => <option key={rule} value={rule}>{rule}</option>)}
                </select>
              </DataframeField>
            </div>
          )}
          {showsQuickLinks && (
          <div
            className={`source_window_dataframe_quick_links${quickLinksDisabled ? ' is-disabled' : ''}`}
            role="group"
            aria-label="Review before analysis"
            title={quickLinksDisabled ? 'Not used by Source / Target Mapping' : undefined}
          >
            <button type="button" className="source_window_config_preview source_window_dataframe_config" onClick={onOpenConfiguration} disabled={quickLinksDisabled}>
              <SourceModeIcon type="configure" />
              <span>
                <strong>Open configuration</strong>
                <small>Last check before analysis. Review or change saved source and tool settings.</small>
              </span>
              <DataframeQuickLinkArrow />
            </button>
            <button type="button" className="source_window_config_preview source_window_dataframe_config" onClick={onOpenLibrary} disabled={quickLinksDisabled}>
              <SourceModeIcon type="library" />
              <span>
                <strong>Rules library</strong>
                <small>Browse, create or edit the analysis rules available to this dataframe.</small>
              </span>
              <DataframeQuickLinkArrow />
            </button>
          </div>
          )}
          {validationMessage ? <p className="source_window_validation" role="alert">{validationMessage}</p> : null}
        </div>
      </section>
    </div>
  );
}

export function DataframeQuickLinkArrow() {
  return (
    <span className="source_window_dataframe_config_hint" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </span>
  );
}
