import { describe, expect, it } from 'vitest';

import {
  EMPTY_FILTER, countFilters, describeFilter, filterIsActive, filterPayload, filterProblems, listValues, normalizeFilter, summarizeFilter,
} from './dataframeFilter.js';
import { buildStreamPayload } from '../../../services/sourceApi.js';

const columns = ['ACCOUNT', 'AMOUNT', 'CHANNEL', 'DATE', 'NOTE'];
const filter = {
  dropColumns: ['NOTE'],
  rows: {
    match: 'all',
    action: 'remove',
    conditions: [
      { column: 'CHANNEL', operator: 'in', value: 'ATM, test ,  ', value2: '' },
      { column: 'AMOUNT', operator: 'between', value: '100', value2: '5,000' },
      { column: 'DATE', operator: 'is_empty', value: 'ignored', value2: '' },
    ],
  },
  trimWhitespace: true,
  dropEmptyIn: ['ACCOUNT'],
  dropDuplicates: true,
};

describe('dataframe filter (analyst decision 2026-11-19)', () => {
  it('normalizes: unknown columns and operators dropped, bounded', () => {
    const normal = normalizeFilter({ ...filter, dropColumns: ['NOTE', 'GONE'], rows: { ...filter.rows, conditions: [{ column: 'GONE', operator: 'bad' }] } }, columns);
    expect(normal.dropColumns).toEqual(['NOTE']);
    expect(normal.rows.conditions).toEqual([{ column: '', operator: 'equals', value: '', value2: '' }]);
    expect(normalizeFilter(null)).toEqual({ ...EMPTY_FILTER, rows: { ...EMPTY_FILTER.rows, conditions: [] }, dropColumns: [], dropEmptyIn: [] });
    expect(filterIsActive(null)).toBe(false);
    expect(filterIsActive(filter)).toBe(true);
    expect(listValues('a, b,, a , c')).toEqual(['a', 'b', 'c']);
  });

  it('problems in plain words: every column stripped, a used column stripped, missing or wrong values', () => {
    expect(filterProblems(filter, { columns })).toEqual([]);
    expect(filterProblems({ dropColumns: columns }, { columns })).toContain('At least one column must be kept.');
    expect(filterProblems({ dropColumns: ['ACCOUNT'] }, { columns, used: ['ACCOUNT'] })).toEqual(['"ACCOUNT" is used by the chosen action and cannot be stripped.']);
    const bad = filterProblems({
      dropColumns: ['NOTE'],
      rows: { conditions: [
        { column: '', operator: 'equals' },
        { column: 'AMOUNT', operator: 'gt', value: 'lots' },
        { column: 'CHANNEL', operator: 'in', value: ' , ' },
        { column: 'NOTE', operator: 'contains', value: 'x' },
        { column: 'DATE', operator: 'between', value: '2026-01-01', value2: '' },
      ] },
    }, { columns });
    expect(bad).toEqual([
      'Condition 1: choose a column.',
      'Condition 2: "lots" is not a number or a date (YYYY-MM-DD).',
      'Condition 3: enter one or more values, separated by commas.',
      'Condition 4: "NOTE" is stripped; keep it or remove the condition.',
      'Condition 5: enter both values.',
    ]);
  });

  it('said in plain words, and summarized for the Dataframe page', () => {
    expect(describeFilter(filter)).toEqual([
      'Strip 1 column: NOTE.',
      'Remove the rows where CHANNEL is one of "ATM", "test" AND AMOUNT is between "100" and "5,000" AND DATE is empty.',
      'Remove the rows with an empty ACCOUNT.',
      'Trim spaces around every value.',
      'Remove duplicate rows (all kept columns alike).',
    ]);
    expect(summarizeFilter(filter)).toBe('1 column stripped · 3 row conditions (remove matching) · clean-up');
    expect(summarizeFilter(null)).toBe('');
    // Counted: 1 stripped column + 3 conditions + 1 empty-check + trim + duplicates.
    expect(countFilters(filter)).toBe(7);
    expect(countFilters(null)).toBe(0);
  });

  it('sent with the stream request as dataframe_filter (B-27); nothing when unfiltered', () => {
    const payload = filterPayload(filter);
    expect(payload).toEqual({
      version: 1,
      drop_columns: ['NOTE'],
      row_filter: {
        match: 'all',
        action: 'remove',
        conditions: [
          { column: 'CHANNEL', operator: 'in', values: ['ATM', 'test'] },
          { column: 'AMOUNT', operator: 'between', values: ['100', '5,000'] },
          { column: 'DATE', operator: 'is_empty' },
        ],
      },
      trim_whitespace: true,
      drop_empty: ['ACCOUNT'],
      drop_duplicates: true,
    });
    expect(filterPayload(null)).toBeNull();
    const stream = buildStreamPayload({ sourceSessionId: '12', mode: 'batch', tool: 'neo4j', action: 'Link Analysis', rule: 'R', dataframeFilter: payload });
    expect(stream.value.dataframe_filter).toBe(payload);
    expect(buildStreamPayload({ sourceSessionId: '12', mode: 'batch', tool: 'neo4j', action: 'Link Analysis', rule: 'R' }).value).not.toHaveProperty('dataframe_filter');
  });
});
