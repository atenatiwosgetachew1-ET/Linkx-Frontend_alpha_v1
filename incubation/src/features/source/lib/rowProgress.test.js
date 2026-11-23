import { describe, expect, it } from 'vitest';

import { createRowTally, formatRowProgress, rowProgress, tallyRowLine, tallyRowLines } from './rowProgress.js';

const line = (message) => ({ source: 'backend', message });

describe('row progress', () => {
  it('uses the filter count as the total and sums inserted batches once', () => {
    const tally = tallyRowLines([
      line('[Info] Dataframe filter: kept 9,800 of 12,500 rows, 11 of 20 columns'),
      line('Inserted Neo4j batch 1 (400 rows)'),
      line('Inserted Neo4j batch 2 (400 rows)'),
      line('Inserted Neo4j batch 2 (400 rows)'),
    ]);
    expect(rowProgress(tally, 12500)).toEqual({ done: 800, total: 9800 });
  });

  it('falls back to the dataframe row count, and never exceeds the total', () => {
    expect(rowProgress(tallyRowLines([line('Inserted Neo4j batch 1 (400 rows)')]), 10000)).toEqual({ done: 400, total: 10000 });
    expect(rowProgress(tallyRowLines([line('kept 2 of 10000 rows'), line('Inserted Neo4j batch 1 (5 rows)')]))).toEqual({ done: 2, total: 2 });
  });

  it('shows nothing until the log carries a count line', () => {
    expect(rowProgress(tallyRowLines([]), 10000)).toBeNull();
    expect(rowProgress(tallyRowLines([line('Live analysis batch 3 flags: {}')]), 10000)).toBeNull();
  });

  it('keeps counting line by line', () => {
    const tally = createRowTally();
    for (let batch = 1; batch <= 6000; batch += 1) tallyRowLine(tally, `Inserted Neo4j batch ${batch} (2 rows)`);
    expect(rowProgress(tally)).toEqual({ done: 12000, total: null });
  });

  it('formats with and without a total', () => {
    expect(formatRowProgress({ done: 400, total: 10000 })).toBe('400/10,000');
    expect(formatRowProgress({ done: 400, total: null })).toBe('400 rows');
    expect(formatRowProgress(null)).toBe('');
  });
});
