import React from 'react';

import { storageFileKey } from '../../../../services/sourceApi.js';
import { sanitizeConnectionValue, sanitizeText } from '../../../../utils/inputSecurity.js';
import {
  displaySourceMessage,
  formatDomainOption,
  formatStorageSize,
  isSourceBusy,
  SOURCE_STATUSES,
  STALE_DATAFRAME_PATCH,
} from '../../lib/sourceModel.js';
import { Field, SourceModeIcon, StatusPill, ToolbarToggle } from '../sourceUi.jsx';
import SearchResultBrowser from '../SearchResultBrowser.jsx';

// Batch > Storage (HDFS). Mirrors production's batch input "Search" page with
// the Files radio on: connect the storage, raw-search files by keyword/date
// (paged, 50 at a time), pick files, then Continue runs create_DF kind 'hdfs'.
export function StorageStep({ state, defaults, windowId, validationMessage, toolPanel, onPatchModeState, onSourceAction, onSearch, onSwitchDomain }) {
  const domains = defaults.domains || [];
  const selectedFiles = state.selectedStorageFiles || [];
  const selectedKeys = new Set(selectedFiles.map(storageFileKey));
  const results = state.storageSearchResults || [];
  const searchStatus = state.storageSearchStatus || 'idle';
  const storageUsesDefault = state.storageUseDefault !== false;
  const toolbarCollapsed = Boolean(state.storageToolbarCollapsed);
  const toolbarId = `source-storage-toolbar-${windowId}`;
  // Never show the configured storage address/port behind "Use Default"
  // (older windows may still hold prefilled values). A custom target always
  // shows what the analyst typed, even when it equals the default.
  const visibleStorageAddress = storageUsesDefault && state.storageAddress === defaults.storage.address ? '' : (state.storageAddress || '');
  const visibleStoragePort = storageUsesDefault && state.storagePort === defaults.storage.port ? '' : (state.storagePort || '');
  const storageConnected = state.sourceStatus === SOURCE_STATUSES.CONNECTED;
  const storageBusy = isSourceBusy(state);
  const searching = searchStatus === 'loading';
  const loadingMore = searchStatus === 'loading_more';
  const canSearch = storageConnected && !searching && !loadingMore && Boolean(String(state.storageSearchQuery || '').trim());

  const emptyMessage = !storageConnected
    ? (storageBusy ? displaySourceMessage(state.sourceStatus) : 'Connect to the storage to search its files.')
    : searching
      ? 'Searching…'
      : searchStatus === 'idle'
        ? 'Type a keyword (and optionally a date) and press Enter to search the files.'
        : state.storageSearchMessage || 'No files found.';

  const toggleFile = (file) => {
    const key = storageFileKey(file);
    const next = selectedKeys.has(key)
      ? selectedFiles.filter((item) => storageFileKey(item) !== key)
      : [...selectedFiles, file];
    onPatchModeState({ selectedStorageFiles: next, ...STALE_DATAFRAME_PATCH });
  };

  return (
    <div className="source_window_step_body source_window_step_body_storage">
      <section className={'source_window_storage_browser' + (toolbarCollapsed ? ' is-toolbar-collapsed' : '')}>
        <header className="source_window_storage_browser_header">
          <div className="source_window_storage_title">
            <h3>Storage source</h3>
            <StatusPill label="Storage" status={state.sourceStatus} />
          </div>
          <div className="source_window_storage_type_buttons" role="group" aria-label="Storage source type">
            <button type="button" className="is-selected" aria-pressed="true">
              <SourceModeIcon type="hadoop" />
              <span>HDFS</span>
            </button>
            <button type="button" disabled aria-pressed="false" title="Apache Hive tables are not available yet">
              <SourceModeIcon type="hive" />
              <span>Apache Hive</span>
            </button>
            <button type="button" disabled aria-pressed="false" title="ClickHouse is not available yet">
              <SourceModeIcon type="clickhouse" />
              <span>ClickHouse</span>
            </button>
          </div>
          <ToolbarToggle
            collapsed={toolbarCollapsed}
            controlsId={toolbarId}
            onToggle={() => onPatchModeState({ storageToolbarCollapsed: !toolbarCollapsed })}
          />
        </header>

        <div className="source_window_storage_fields" id={toolbarId} hidden={toolbarCollapsed}>
          <label className="source_window_storage_default_toggle">
            <input
              type="checkbox"
              checked={storageUsesDefault}
              disabled={storageBusy || storageConnected}
              title={storageConnected ? 'Disconnect to change the storage target.' : undefined}
              onChange={(event) => onPatchModeState({
                storageUseDefault: event.target.checked,
                // Drop hidden prefilled defaults so a custom connection only
                // uses what the analyst types.
                ...(state.storageAddress === defaults.storage.address ? { storageAddress: '' } : {}),
                ...(state.storagePort === defaults.storage.port ? { storagePort: '' } : {}),
              })}
            />
            <span>Use Default</span>
          </label>
          <Field label="Storage address" className={storageUsesDefault ? 'is-discarded' : ''}>
            <input
              type="text"
              value={visibleStorageAddress}
              title={storageUsesDefault ? 'Not used: "Use Default" connects to the configured storage address.' : undefined}
              placeholder={storageUsesDefault ? 'Default' : 'HDFS host address'}
              disabled={storageUsesDefault || storageBusy || storageConnected}
              onChange={(event) => onPatchModeState({ storageAddress: sanitizeConnectionValue(event.target.value) })}
            />
          </Field>
          <Field label="RPC/Web port" className={storageUsesDefault ? 'is-discarded' : ''}>
            <input
              type="text"
              value={visibleStoragePort}
              inputMode="numeric"
              maxLength={5}
              title={storageUsesDefault ? 'Not used: "Use Default" takes the port from the session configuration.' : undefined}
              placeholder={storageUsesDefault ? 'Default' : 'Port'}
              disabled={storageUsesDefault || storageBusy || storageConnected}
              // Digits only (1-65535 is checked on Connect).
              onChange={(event) => onPatchModeState({ storagePort: String(event.target.value || '').replace(/\D/g, '').slice(0, 5) })}
            />
          </Field>
          {/* The backend only searches the session configuration's storage path,
              which follows the domain; switching the domain changes the path. */}
          <Field label="Domain / path" className={storageUsesDefault ? 'is-discarded' : ''}>
            <select
              value={defaults.domain}
              title={storageUsesDefault
                ? 'Not used: "Use Default" keeps the session domain. Untick it to pick another domain here.'
                : (defaults.storage.path ? `Searches ${defaults.storage.path}` : undefined)}
              disabled={storageUsesDefault || storageBusy || storageConnected || domains.length < 2}
              onChange={(event) => onSwitchDomain(event.target.value)}
            >
              {!domains.some((item) => item.key === defaults.domain) ? (
                <option value={defaults.domain}>{formatDomainOption(defaults.domain, defaults.storage.path)}</option>
              ) : null}
              {domains.map((item) => (
                <option key={item.key} value={item.key}>{formatDomainOption(item.key, item.storagePath)}</option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            className="source_window_storage_connect_button"
            disabled={storageBusy || searching || loadingMore}
            onClick={onSourceAction}
          >
            {storageConnected ? 'Disconnect' : storageBusy ? displaySourceMessage(state.sourceStatus) : 'Connect'}
          </button>
        </div>

        <SearchResultBrowser
          label="Storage file browser"
          icon="storage"
          query={state.storageSearchQuery}
          queryLabel="Search storage files by keyword"
          queryPlaceholder={storageConnected ? 'Search files by keyword' : 'Connect to search'}
          queryDisabled={!storageConnected}
          canSearch={canSearch}
          onQueryChange={(value) => onPatchModeState({ storageSearchQuery: sanitizeText(value, { maxLength: 500 }) })}
          onSearch={onSearch}
          date={state.storageSearchDate}
          dateLabel="File date"
          dateTitle="Only files from this date (optional)"
          dateDisabled={!storageConnected}
          onDateChange={(value) => onPatchModeState({ storageSearchDate: value })}
          selectedCount={selectedFiles.length}
          selectedKey="source.search.selectedFiles"
          onClearSelection={() => onPatchModeState({ selectedStorageFiles: [], ...STALE_DATAFRAME_PATCH })}
          columns={['File name', 'Last modified Date', 'Size']}
          rows={results.map((file, index) => ({
            key: storageFileKey(file) + index,
            file,
            selected: selectedKeys.has(storageFileKey(file)),
            title: file.path || file.name,
            cells: [file.name, file.date || '—', formatStorageSize(file.size)],
          }))}
          searching={searching}
          hasMore={state.storageSearchHasMore}
          loadingMore={loadingMore}
          onToggle={(row) => toggleFile(row.file)}
          onLoadMore={() => onSearch({ more: true })}
          emptyMessage={emptyMessage}
          validationMessage={validationMessage}
        />
      </section>
      {toolPanel}
    </div>
  );
}
