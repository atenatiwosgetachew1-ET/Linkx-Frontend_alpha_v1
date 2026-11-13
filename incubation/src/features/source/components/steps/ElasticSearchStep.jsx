import React from 'react';

import { sanitizeConnectionValue, sanitizeText } from '../../../../utils/inputSecurity.js';
import {
  displaySourceMessage,
  ELASTIC_SEARCH_RESET_PATCH,
  elasticResultKey,
  formatDomainLabel,
  formatRowCount,
  isSourceBusy,
  SOURCE_STATUSES,
  STALE_DATAFRAME_PATCH,
} from '../../lib/sourceModel.js';
import { Field, SourceModeIcon, StatusPill, ToolbarToggle } from '../sourceUi.jsx';
import SearchResultBrowser from '../SearchResultBrowser.jsx';

// Production batch "Search" page with the Hybrid (Elastic + Hive) radio:
// strict search needs one of the configured strict columns, fuzzy search may
// narrow to a fuzzy column or search all of them. Both lists come from the
// session configuration (search_columns_strict / search_columns_fuzzy) of the
// active domain.
export function ElasticSearchStep({ state, defaults, windowId, validationMessage, toolPanel, onPatchModeState, onSourceAction, onSearch }) {
  const strict = state.searchMode === 'strict';
  const columns = (strict ? defaults.search.strictColumns : defaults.search.fuzzyColumns) || [];
  const column = columns.includes(state.elasticColumn) ? state.elasticColumn : '';
  const selected = state.selectedSearchFiles || [];
  const selectedKeys = new Set(selected.map(elasticResultKey));
  const results = state.elasticSearchResults || [];
  const searchStatus = state.elasticSearchStatus || 'idle';
  const storageUsesDefault = state.storageUseDefault !== false;
  const toolbarCollapsed = Boolean(state.storageToolbarCollapsed);
  const toolbarId = `source-elastic-toolbar-${windowId}`;
  const visibleStorageAddress = storageUsesDefault && state.storageAddress === defaults.storage.address ? '' : (state.storageAddress || '');
  const connected = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  const busy = isSourceBusy(state);
  const searching = searchStatus === 'loading';
  const loadingMore = searchStatus === 'loading_more';
  const needsColumn = strict && !column;
  const canSearch = connected && !searching && !loadingMore && !needsColumn && Boolean(String(state.searchQuery || '').trim());

  const emptyMessage = !connected
    ? (busy ? displaySourceMessage(state.sourceStatus) : 'Connect to the storage to run an Elasticsearch search.')
    : searching
      ? 'Searching…'
      : columns.length === 0
        ? `No ${strict ? 'strict' : 'fuzzy'} search columns are configured for the ${formatDomainLabel(defaults.domain)} domain (Configuration → Connections → Search).`
        : needsColumn
          ? 'Strict search needs a column: pick one, then search.'
          : searchStatus === 'idle'
            ? 'Type a keyword (and optionally a date) and press Enter to search.'
            : state.elasticSearchMessage || 'No results found.';

  const toggleResult = (item) => {
    const key = elasticResultKey(item);
    const next = selectedKeys.has(key) ? selected.filter((entry) => elasticResultKey(entry) !== key) : [...selected, item];
    onPatchModeState({ selectedSearchFiles: next, ...STALE_DATAFRAME_PATCH });
  };

  // Changing strict/fuzzy or the column starts a new search context.
  const changeSearchSetup = (patch) => onPatchModeState({ ...patch, ...ELASTIC_SEARCH_RESET_PATCH, ...STALE_DATAFRAME_PATCH });

  return (
    <div className="source_window_step_body source_window_step_body_storage">
      <section className={'source_window_storage_browser' + (toolbarCollapsed ? ' is-toolbar-collapsed' : '')}>
        <header className="source_window_storage_browser_header">
          <div className="source_window_storage_title">
            <SourceModeIcon type="elastic" />
            <h3>Elasticsearch source</h3>
            <StatusPill label="Storage" status={state.sourceStatus} />
          </div>
          <div className="source_window_storage_type_buttons" role="group" aria-label="Elasticsearch source type">
            <button type="button" className="is-selected">
              <SourceModeIcon type="elastic" />
              <span>Hybrid (Elasticsearch + Apache Hive)</span>
            </button>
          </div>
          <ToolbarToggle
            collapsed={toolbarCollapsed}
            controlsId={toolbarId}
            onToggle={() => onPatchModeState({ storageToolbarCollapsed: !toolbarCollapsed })}
          />
        </header>

        {/* One row like the Storage page:
            Use Default | Storage address | Search mode | Column | Connect */}
        <div className="source_window_storage_fields source_window_search_fields" id={toolbarId} hidden={toolbarCollapsed}>
          <label className="source_window_storage_default_toggle">
            <input
              type="checkbox"
              checked={storageUsesDefault}
              disabled={busy || connected}
              onChange={(event) => onPatchModeState({
                storageUseDefault: event.target.checked,
                ...(state.storageAddress === defaults.storage.address ? { storageAddress: '' } : {}),
              })}
            />
            <span>Use Default</span>
          </label>
          <Field label="Storage address" className={storageUsesDefault ? 'is-discarded' : ''}>
            <input
              type="text"
              value={visibleStorageAddress}
              placeholder={storageUsesDefault ? 'Default' : 'HDFS / Apache Hive host address'}
              title={storageUsesDefault ? 'Not used: "Use Default" connects to the configured storage address.' : undefined}
              disabled={storageUsesDefault || busy || connected}
              onChange={(event) => onPatchModeState({ storageAddress: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          <div className="source_window_field source_window_search_mode_field">
            <span id={`elastic-mode-label-${windowId}`}>Search mode</span>
            <div className="source_window_search_mode_group" role="radiogroup" aria-labelledby={`elastic-mode-label-${windowId}`}>
              <label className={strict ? 'is-selected' : ''} title="Exact match on one strict column">
                <input type="radio" name={`elastic-mode-${windowId}`} checked={strict} onChange={() => changeSearchSetup({ searchMode: 'strict', elasticColumn: '' })} />
                <span>Strict</span>
              </label>
              <label className={!strict ? 'is-selected' : ''} title="Fuzzy match on one or all fuzzy columns">
                <input type="radio" name={`elastic-mode-${windowId}`} checked={!strict} onChange={() => changeSearchSetup({ searchMode: 'fuzzy', elasticColumn: '' })} />
                <span>Fuzzy</span>
              </label>
            </div>
          </div>
          <Field label={strict ? 'Strict column' : 'Fuzzy column'}>
            <select
              value={column}
              disabled={columns.length === 0}
              title={`Configured for the ${formatDomainLabel(defaults.domain)} domain`}
              onChange={(event) => changeSearchSetup({ elasticColumn: event.target.value })}
            >
              <option value="">{strict ? (columns.length ? 'Select strict column' : 'No strict columns configured') : 'All columns (auto)'}</option>
              {columns.map((item) => <option key={item} value={item}>{item.replace(/_/g, ' ')}</option>)}
            </select>
          </Field>
          <button type="button" className="source_window_storage_connect_button" disabled={busy || searching || loadingMore} onClick={onSourceAction}>
            {connected ? 'Disconnect' : busy ? displaySourceMessage(state.sourceStatus) : 'Connect'}
          </button>
        </div>

        <SearchResultBrowser
          label="Elasticsearch result browser"
          showIcon={false}
          query={state.searchQuery}
          queryLabel="Elasticsearch keyword"
          queryPlaceholder={connected ? (strict ? 'Exact value to match' : 'Keyword to search') : 'Connect to search'}
          queryDisabled={!connected}
          canSearch={canSearch}
          onQueryChange={(value) => onPatchModeState({ searchQuery: sanitizeText(value, { maxLength: 500 }) })}
          onSearch={onSearch}
          dateRange={{
            groupLabel: 'Record date range (optional)',
            fromLabel: 'Start date',
            toLabel: 'End date',
            from: state.elasticSearchDateFrom,
            to: state.elasticSearchDateTo,
            disabled: !connected,
            onFromChange: (value) => onPatchModeState({ elasticSearchDateFrom: value }),
            onToChange: (value) => onPatchModeState({ elasticSearchDateTo: value }),
          }}
          selectedCount={selected.length}
          selectedKey="source.search.selectedResults"
          onClearSelection={() => onPatchModeState({ selectedSearchFiles: [], ...STALE_DATAFRAME_PATCH })}
          columns={['Result', 'Column', 'Rows']}
          rows={results.map((item, index) => ({
            key: elasticResultKey(item) + index,
            item,
            selected: selectedKeys.has(elasticResultKey(item)),
            title: [item.name, item.keyword && `keyword: ${item.keyword}`, item.type && `type: ${item.type}`].filter(Boolean).join(' · '),
            cells: [item.name, item.column ? String(item.column).replace(/_/g, ' ') : (strict ? '—' : 'All columns'), formatRowCount(item.size)],
          }))}
          searching={searching}
          hasMore={state.elasticSearchHasMore}
          loadingMore={loadingMore}
          onToggle={(row) => toggleResult(row.item)}
          onLoadMore={() => onSearch({ more: true })}
          emptyMessage={emptyMessage}
          validationMessage={validationMessage}
        />
      </section>
      {toolPanel}
    </div>
  );
}
