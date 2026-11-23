// Rows analysed so far / rows to analyse, read from a stream's log lines.
//
// The Service has no structured progress field yet, so this reads the
// lines it does send (seen 2026-11-20):
//   "Dataframe filter: kept 2 of 10000 rows, 4 of 20 columns"  -> total 2
//   "Inserted Neo4j batch 1 (2 rows)"                           -> done += 2
// The tally is kept as lines arrive (streamLogs.js), so it survives the
// log buffer dropping old lines on a long run. A batch logged twice counts
// once. Nothing is shown until the log carries one of these lines: a task
// without a log in this browser (loaded from the Service) shows no count.

const KEPT_RE = /\bkept\s+([\d,]+)\s+of\s+([\d,]+)\s+rows\b/i;
const BATCH_RE = /\binsert\w*\b.*?\bbatch\s+([\w-]+)\s*\(\s*([\d,]+)\s+rows?\s*\)/i;

const toCount = (value) => {
  const number = Number(String(value).replace(/,/g, ''));
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export const createRowTally = () => ({ kept: null, batches: new Map(), done: 0, seen: false });

// Adds one line to the tally (mutates it); returns true when it changed.
export const tallyRowLine = (tally, text) => {
  const value = String(text ?? '');
  const kept = value.match(KEPT_RE);
  if (kept) {
    const count = toCount(kept[1]);
    if (count !== null) { tally.kept = count; tally.seen = true; return true; }
  }
  const batch = value.match(BATCH_RE);
  if (batch) {
    const rows = toCount(batch[2]);
    if (rows === null) return false;
    const previous = tally.batches.get(batch[1]) ?? 0;
    tally.batches.set(batch[1], rows);
    tally.done += rows - previous;
    tally.seen = true;
    return true;
  }
  return false;
};

// From a list of lines (a task's own or copied log).
export const tallyRowLines = (lines = []) => {
  const tally = createRowTally();
  lines.forEach((line) => tallyRowLine(tally, line?.message ?? line));
  return tally;
};

// -> { done, total } (total null when unknown), or null before any count.
// The total is the filter's kept rows, else the dataframe's row count.
export const rowProgress = (tally, dataframeTotal = null) => {
  if (!tally?.seen) return null;
  const fallback = dataframeTotal == null ? null : toCount(dataframeTotal);
  const total = tally.kept ?? fallback;
  return { done: total === null ? tally.done : Math.min(tally.done, total), total };
};

const fmt = (value) => value.toLocaleString('en-US');

// "400/10,000", or "400 rows" when the total is unknown; '' with no counts.
export const formatRowProgress = (progress) => {
  if (!progress) return '';
  return progress.total === null ? `${fmt(progress.done)} rows` : `${fmt(progress.done)}/${fmt(progress.total)}`;
};
