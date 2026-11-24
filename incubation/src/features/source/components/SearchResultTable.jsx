import React from 'react';

import { SourceModeIcon } from './sourceUi.jsx';
import { t, tn } from '../../../shared/i18n/index.js';

// The Storage and Elasticsearch pages' search row and results while the Source window's flow
// pages are on (sourceFrame.js). Same props as SearchResultBrowser, drawn as
// a tight search row over a table like Configuration ▸ Rules ▸ Column
// mapping. The selection sits beside the date; Load more is under the table.
//
// `dateRange` ({ from, to, onFromChange, onToChange, fromLabel, toLabel,
// disabled }) replaces the single date with a start / end range.
// rows: [{ key, selected, title, cells: [primary, second, third] }]
export default function SearchResultTable({
  label,
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
  const listed = rows.length > 0 && !searching;
  return (
    <div className="source_window_flow_results" role="group" aria-label={label} aria-busy={searching || loadingMore}>
      <div className="source_window_flow_search">
        <div className="source_window_flow_search_box">
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
          <div className="source_window_flow_search_range" role="group" aria-label={dateRange.groupLabel || 'Date range'}>
            <input
              type="date"
              className="source_window_flow_search_date"
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
              className="source_window_flow_search_date"
              aria-label={dateRange.toLabel || 'End date'}
              title={dateRange.toLabel || 'End date'}
              value={dateRange.to || ''}
              min={dateRange.from || undefined}
              disabled={dateRange.disabled}
              onChange={(event) => dateRange.onToChange(event.target.value)}
            />
          </div>
        ) : (
          <input
            type="date"
            className="source_window_flow_search_date"
            aria-label={dateLabel}
            title={dateTitle}
            value={date || ''}
            disabled={dateDisabled}
            onChange={(event) => onDateChange(event.target.value)}
          />
        )}
        {/* Quiet while nothing is picked; then a tinted pill with its ×. */}
        <span className={'source_window_flow_table_picked' + (selectedCount > 0 ? ' is-on' : '')}>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><polyline points="5 12.5 10 17 19 7" /></svg>
          <span className="source_window_flow_table_count" role="status">{tn(selectedKey, selectedCount)}</span>
          <button
            type="button"
            className="source_window_flow_table_clear"
            aria-label={t('source.search.discardSelection')}
            title={t('source.search.discardSelection')}
            disabled={selectedCount === 0}
            onClick={onClearSelection}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10M17 7L7 17" /></svg>
          </button>
        </span>
      </div>

      <div className="source_window_flow_table_box">
        <div className="source_window_flow_table_scroll">
          <table className="source_window_flow_table" aria-label={label}>
            <thead>
              <tr>
                <th className="is-check" aria-label="Selected" />
                <th className="is-index">#</th>
                {columns.map((column, index) => <th key={column} className={['is-name', 'is-date', 'is-number'][index]}>{column}</th>)}
              </tr>
            </thead>
            {listed ? (
              <tbody>
                {rows.map((row, index) => (
                  // The whole row picks it; the checkbox is for the keyboard.
                  <tr key={row.key} className={row.selected ? 'is-selected' : undefined} title={row.title} onClick={() => onToggle(row)}>
                    <td className="is-check">
                      <input
                        type="checkbox"
                        aria-label={row.cells[0]}
                        checked={row.selected}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => onToggle(row)}
                      />
                    </td>
                    <td className="is-index">{index + 1}</td>
                    <td className="is-name">{row.cells[0]}</td>
                    <td className="is-date">{row.cells[1]}</td>
                    <td className="is-number">{row.cells[2]}</td>
                  </tr>
                ))}
              </tbody>
            ) : null}
          </table>
          {listed ? null : <p className="source_window_flow_table_empty" role="status" aria-live="polite">{emptyMessage}</p>}
        </div>

        {listed && hasMore ? (
          <div className="source_window_flow_table_foot">
            <button type="button" className="source_window_flow_table_more" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? t('source.search.loadingMore') : t('source.search.loadMore')}
            </button>
          </div>
        ) : null}
      </div>
      {validationMessage ? <p className="source_window_validation" role="alert">{validationMessage}</p> : null}
    </div>
  );
}
