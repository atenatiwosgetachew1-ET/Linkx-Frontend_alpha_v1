import React from 'react';

import { SourceModeIcon } from './sourceUi.jsx';
import { t, tn } from '../../../shared/i18n/index.js';

// Shared result browser for the Storage (raw HDFS) and Elastic (hybrid)
// search steps: search row (keyword + optional date), selection tools, a
// three-column result list with Load more, and an empty/status placeholder.
//
// rows: [{ key, selected, title, cells: [primary, second, third] }]
// Optional: `showIcon={false}` drops the leading row icon; `dateRange`
// ({ from, to, onFromChange, onToChange, fromLabel, toLabel, disabled })
// replaces the single date with a start/end range.
export default function SearchResultBrowser({
  label,
  icon = 'search',
  showIcon = true,
  dateRange,
  query,
  queryLabel,
  queryPlaceholder,
  queryDisabled,
  canSearch,
  onQueryChange,
  onSearch,
  date,
  dateLabel,
  dateTitle,
  dateDisabled,
  onDateChange,
  selectedCount,
  selectedKey,
  onClearSelection,
  columns,
  rows,
  searching,
  hasMore,
  loadingMore,
  onToggle,
  onLoadMore,
  emptyMessage,
  validationMessage,
}) {
  const submit = () => { if (canSearch) onSearch(); };
  return (
    <div className="source_window_storage_file_panel">
      <div className="source_window_storage_file_browser" aria-label={label} aria-busy={searching || loadingMore}>
        <div className={'source_window_storage_parent_row' + (showIcon ? '' : ' has-no-icon')}>
          {showIcon ? (
            <span className="source_window_storage_file_icon" aria-hidden="true">
              <SourceModeIcon type={icon} />
            </span>
          ) : null}
          <div className="source_window_storage_search_input">
            <input
              type="text"
              aria-label={queryLabel}
              value={query || ''}
              placeholder={queryPlaceholder}
              disabled={queryDisabled}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <button type="button" aria-label={t('source.search.run')} title={t('source.search.run')} disabled={!canSearch} onClick={submit}>
              <SourceModeIcon type="search" />
            </button>
          </div>
          {dateRange ? (
            <div className="source_window_storage_date_range is-range" role="group" aria-label={dateRange.groupLabel || 'Date range'}>
              <input
                type="date"
                aria-label={dateRange.fromLabel || 'Start date'}
                title={dateRange.fromLabel || 'Start date'}
                value={dateRange.from || ''}
                max={dateRange.to || undefined}
                disabled={dateRange.disabled}
                onChange={(event) => dateRange.onFromChange(event.target.value)}
              />
              <b aria-hidden="true">→</b>
              <input
                type="date"
                aria-label={dateRange.toLabel || 'End date'}
                title={dateRange.toLabel || 'End date'}
                value={dateRange.to || ''}
                min={dateRange.from || undefined}
                disabled={dateRange.disabled}
                onChange={(event) => dateRange.onToChange(event.target.value)}
              />
            </div>
          ) : (
            <div className="source_window_storage_date_range is-single">
              <input
                type="date"
                aria-label={dateLabel}
                title={dateTitle}
                value={date || ''}
                disabled={dateDisabled}
                onChange={(event) => onDateChange(event.target.value)}
              />
            </div>
          )}
          <span className="source_window_storage_selection_tools">
            <span className="source_window_storage_selected_count">{tn(selectedKey, selectedCount)}</span>
            <button
              type="button"
              className="source_window_storage_discard_button linkx_tooltip_anchor"
              data-tooltip={t('source.search.discardSelection')}
              aria-label={t('source.search.discardSelection')}
              disabled={selectedCount === 0}
              onClick={onClearSelection}
            >
              <SourceModeIcon type="clear" />
            </button>
          </span>
        </div>
        <div className="source_window_storage_file_header" aria-hidden="true">
          <span />
          {columns.map((column) => <span key={column}>{column}</span>)}
        </div>
        {rows.length > 0 && !searching ? (
          <>
            {rows.map((row) => (
              <button
                key={row.key}
                type="button"
                className={'source_window_storage_file_row' + (row.selected ? ' is-selected' : '')}
                aria-pressed={row.selected}
                title={row.title}
                onClick={() => onToggle(row)}
              >
                <span className="source_window_storage_file_selector" aria-hidden="true" />
                <span>{row.cells[0]}</span>
                <small>{row.cells[1]}</small>
                <small>{row.cells[2]}</small>
              </button>
            ))}
            {hasMore ? (
              <button type="button" className="source_window_storage_file_row is-load-more" disabled={loadingMore} onClick={onLoadMore}>
                <span />
                <span>{loadingMore ? t('source.search.loadingMore') : t('source.search.loadMore')}</span>
                <small />
                <small />
              </button>
            ) : null}
          </>
        ) : (
          <div className="source_window_storage_placeholder_row" role="status" aria-live="polite">
            <span />
            <span>{emptyMessage}</span>
            <small />
            <small />
          </div>
        )}
      </div>
      {validationMessage ? <p className="source_window_validation" role="alert">{validationMessage}</p> : null}
    </div>
  );
}
