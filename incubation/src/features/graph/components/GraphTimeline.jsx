import React, { useEffect, useMemo, useRef, useState } from 'react';

import { SLICE_OPTIONS, formatBucket, timelineBuckets, timelineItems, timelineKeys, unitFits } from '../lib/graphTimeline.js';

// Timeline filter strip under the canvas (i2 benchmark #1; not in
// production, analyst decision 2026-11-15): a histogram of the dated nodes
// and links of the view. Drag across it (or click a bar) to keep only that
// period; Play moves the period forward a bar at a time; Reset shows all.
//
// graph: the graphology graph; view: the view before the time filter;
// Always shown under a drawn graph, collapsed to its header by default.
// filter: { key, from, to, hideUndated, collapsed, speed, autoReset,
// autoplay }; onChange(next); onPlayStep(ids, { duration })
// after each Play step with the nodes of the new period (the window focuses
// them), and with every shown node when Play ends and resets.
//
// Play options: speed (0.5x-4x of a bar per 700 ms; 0.5x by default); Auto reset (on by
// default) shows all dates again once Play reaches the end; Autoplay starts
// Play from the first bar whenever the strip is expanded.
//
// Date fields: a value counts when it is a year-first date or date-time
// (2026-03-05, 2026-03-05 14:30[:00][Z|+03:00]); plain numbers only in
// fields named like dates (date, time, timestamp, created, _at…), read as
// epoch seconds or milliseconds; a field qualifies when at least 60 % of
// its values are dates. Production's TRANSACTIONDATE comes first.
const PLAY_MS = 700;
const SPEEDS = [0.5, 1, 2, 4];
const HEIGHT = 56;

const ClockIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
);

export default function GraphTimeline({ graph, view, version, filter, onChange, onPlayStep, onPeriod }) {
  // `version` changes with the data.
  const keys = useMemo(() => timelineKeys(graph, view), [graph, view, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = filter.key && keys.some((entry) => entry.key === filter.key) ? filter.key : keys[0]?.key || '';
  const items = useMemo(() => timelineItems(graph, view, key), [graph, view, key, version]); // eslint-disable-line react-hooks/exhaustive-deps
  // Slicing: Auto (from the span) or a chosen unit; a unit that would make
  // too many bars for the span is not offered.
  const span = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    [items.nodes, items.edges].forEach((map) => map.forEach((ms) => {
      if (ms < min) min = ms;
      if (ms > max) max = ms;
    }));
    return min <= max ? { min, max } : null;
  }, [items]);
  const fits = (unitName) => !span || unitFits(span.min, span.max, unitName);
  const slice = filter.slice && filter.slice !== 'auto' && fits(filter.slice) ? filter.slice : 'auto';
  const { unit, buckets } = useMemo(
    () => timelineBuckets([...items.nodes.values(), ...items.edges.values()], slice === 'auto' ? null : slice),
    [items, slice],
  );
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));

  // The chosen key follows the data (the first one found).
  useEffect(() => {
    if (key !== filter.key) onChange({ key, from: null, to: null });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const ranged = filter.from != null || filter.to != null;
  const selected = (bucket) => !ranged || ((filter.from == null || bucket.start >= filter.from) && (filter.to == null || bucket.end <= filter.to));

  // Drag across the bars to choose a period.
  const svgRef = useRef(null);
  const drag = useRef(null);
  const [preview, setPreview] = useState(null); // [first, last] bar while dragging
  const barAt = (event) => {
    const box = svgRef.current.getBoundingClientRect();
    const share = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    return Math.max(0, Math.min(buckets.length - 1, Math.floor(share * buckets.length)));
  };
  const choose = (a, b) => {
    const [first, last] = a <= b ? [a, b] : [b, a];
    onChange({ key, from: buckets[first].start, to: buckets[last].end });
  };
  const onPointerDown = (event) => {
    if (event.button !== 0 || !buckets.length) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const at = barAt(event);
    drag.current = at;
    setPreview([at, at]);
  };
  const onPointerMove = (event) => {
    if (drag.current == null) return;
    setPreview([drag.current, barAt(event)]);
  };
  const onPointerUp = (event) => {
    if (drag.current == null) return;
    const start = drag.current;
    drag.current = null;
    setPreview(null);
    choose(start, barAt(event));
  };

  // Play: the period (one bar if none) moves forward a bar at a time,
  // skipping bars with nothing dated in them.
  // Kept in the window state, so Play goes on across a remount (docked <->
  // floating). onChange takes partial patches (merged by the window).
  const playing = Boolean(filter.playing);
  const setPlaying = (value) => onChange({ playing: typeof value === 'function' ? value(playing) : value });
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const speed = SPEEDS.includes(Number(filter.speed)) ? Number(filter.speed) : 0.5;
  const autoReset = filter.autoReset !== false;
  const stepMs = PLAY_MS / speed;
  // Play from the first bar (`patch`: other changes made with it).
  const startPlay = (patch = {}) => {
    onChange({ ...patch, key, from: null, to: null, playing: true });
  };
  // The nodes of a period: those dated in it and the ends of its links.
  const periodNodes = (from, to) => {
    const ids = new Set();
    items.nodes.forEach((ms, id) => { if (ms >= from && ms < to) ids.add(id); });
    items.edges.forEach((ms, edgeKey) => {
      if (ms < from || ms >= to) return;
      ids.add(graph.source(edgeKey));
      ids.add(graph.target(edgeKey));
    });
    return [...ids];
  };
  // Autoplay: plays from the first bar whenever the strip is expanded (an
  // already expanded strip, remounted, is not "expanded" again).
  const autoStarted = useRef(!filter.collapsed);
  useEffect(() => {
    if (filter.collapsed) {
      autoStarted.current = false;
      return;
    }
    if (autoStarted.current || !filter.autoplay || buckets.length < 2) return;
    autoStarted.current = true;
    startPlay();
  }, [filter.collapsed, buckets.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const onPlayStepRef = useRef(onPlayStep);
  onPlayStepRef.current = onPlayStep;
  const periodNodesRef = useRef(periodNodes);
  periodNodesRef.current = periodNodes;
  const viewRef = useRef(view);
  viewRef.current = view;
  // The period one step forward (+1) or back (-1), keeping its width (one
  // bar when none is applied) and skipping bars with nothing dated in them:
  // { from, to }, or null at either end. Forward from no period is the first
  // bar; back from no period, the last.
  const neighbourPeriod = (direction, current = filterRef.current) => {
    if (!buckets.length) return null;
    const firstIndex = current.from == null ? -1 : buckets.findIndex((bucket) => bucket.start >= current.from);
    const lastIndex = current.to == null ? -1 : buckets.findLastIndex((bucket) => bucket.end <= current.to);
    const width = firstIndex >= 0 && lastIndex >= firstIndex ? lastIndex - firstIndex + 1 : 1;
    let first;
    if (direction > 0) {
      first = firstIndex < 0 ? 0 : firstIndex + 1;
      while (first < buckets.length && !buckets[first].count) first += 1;
    } else {
      first = firstIndex < 0 ? buckets.length - width : firstIndex - 1;
      while (first >= 0 && !buckets[first].count) first -= 1;
    }
    const last = first + width - 1;
    if (first < 0 || last >= buckets.length) return null;
    return { from: buckets[first].start, to: buckets[last].end };
  };
  // Shows a period and focuses its nodes (an empty one keeps the camera).
  const showPeriod = ({ from, to }, duration) => {
    onChange({ key, from, to });
    const ids = periodNodesRef.current(from, to);
    if (ids.length) onPlayStepRef.current?.(ids, { duration });
  };
  const playStepRef = useRef(null);
  playStepRef.current = () => {
    const duration = Math.min(400, stepMs * 0.6);
    const next = neighbourPeriod(1);
    if (next) {
      showPeriod(next, duration);
      return;
    }
    onChange({ playing: false });
    if (autoReset) {
      onChange({ key, from: null, to: null });
      onPlayStepRef.current?.(viewRef.current.nodeIds, { duration });
    }
  };
  useEffect(() => {
    if (!playing || buckets.length < 2) return undefined;
    const timer = setInterval(() => playStepRef.current(), stepMs);
    return () => clearInterval(timer);
  }, [playing, buckets.length, stepMs]);
  // Previous / Next: one step by hand, playing or paused.
  const previousPeriod = neighbourPeriod(-1, filter);
  const nextPeriod = neighbourPeriod(1, filter);

  const highlight = (index) => {
    if (preview) {
      const [a, b] = preview[0] <= preview[1] ? preview : [preview[1], preview[0]];
      return index >= a && index <= b;
    }
    return ranged && selected(buckets[index]);
  };
  const periodText = (() => {
    if (!ranged || !buckets.length) return '';
    const first = formatBucket(filter.from ?? buckets[0].start, unit);
    const last = formatBucket((filter.to ?? buckets[buckets.length - 1].end) - 1, unit);
    return first === last ? first : `${first} – ${last}`;
  })();
  // The applied period, for the title on the canvas ('' when none).
  useEffect(() => {
    onPeriod?.(periodText);
  }, [periodText]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onPeriod?.(''), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="graph_timeline" aria-label="Timeline">
      <header className="graph_timeline_header">
        <strong><ClockIcon /> <span className="graph_timeline_title_text">Timeline</span></strong>
        {/* The controls wrap among themselves; the title and the fold button
            keep their places on the first line at any width. */}
        <div className="graph_timeline_controls">
        {keys.length ? (
          <>
            <select
              aria-label="Date field"
              title={'Which date the timeline uses. Read as dates: year-first dates and date-times (2026-03-05, 2026-03-05 14:30); plain numbers only in fields named like dates (epoch seconds or milliseconds). A field is listed when at least 60 % of its values are dates; TRANSACTIONDATE comes first.'}
              value={key}
              onChange={(event) => onChange({ key: event.target.value, from: null, to: null })}>
              {keys.map((entry) => <option key={entry.key} value={entry.key}>{entry.key} ({entry.count})</option>)}
            </select>
            <select
              aria-label="Slice by"
              title="How the dates are sliced into bars (Auto picks from the span)"
              value={slice}
              onChange={(event) => onChange({ key, slice: event.target.value, from: null, to: null, playing: false })}
            >
              {SLICE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value} disabled={option.value !== 'auto' && !fits(option.value)}>
                  {option.label}{option.value === 'auto' && slice === 'auto' && buckets.length ? ` (${unit})` : ''}
                </option>
              ))}
            </select>
            <span className="graph_timeline_media" role="group" aria-label="Timeline player">
              <button
                type="button"
                className="graph_timeline_media_button"
                aria-label="Previous period"
                title="Previous period"
                disabled={!previousPeriod}
                onClick={() => previousPeriod && showPeriod(previousPeriod, 300)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 5v14" className="is-stroke" /><path d="M18 5 9 12l9 7Z" /></svg>
              </button>
              <button
                type="button"
                className="graph_timeline_media_button is-play"
                aria-label={playing ? 'Pause' : 'Play'}
                title={playing ? 'Pause' : 'Play'}
                aria-pressed={playing}
                disabled={buckets.length < 2}
                onClick={() => setPlaying((value) => !value)}
              >
                {playing ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7Z" /></svg>
                )}
              </button>
              <button
                type="button"
                className="graph_timeline_media_button"
                aria-label="Next period"
                title="Next period"
                disabled={!nextPeriod}
                onClick={() => nextPeriod && showPeriod(nextPeriod, 300)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18 5v14" className="is-stroke" /><path d="M6 5l9 7-9 7Z" /></svg>
              </button>
            </span>
            <select aria-label="Play speed" title="Play speed" value={speed} onChange={(event) => onChange({ key, speed: Number(event.target.value) })}>
              {SPEEDS.map((value) => <option key={value} value={value}>{value}×</option>)}
            </select>
          </>
        ) : (
          <span className="graph_timeline_summary" role="status">No dates found on the shown nodes or links.</span>
        )}
        </div>
        {/* Reset and the fold button stay at the end of the first line. */}
        {keys.length ? (
          <button type="button" className="graph_window_button is-compact graph_timeline_reset" disabled={!ranged && !filter.hideUndated} onClick={() => onChange({ key, from: null, to: null, hideUndated: false, playing: false })}>
            Reset
          </button>
        ) : null}
        <button
          type="button"
          className="graph_timeline_fold"
          aria-label={filter.collapsed ? 'Expand timeline' : 'Collapse timeline'}
          aria-expanded={!filter.collapsed}
          title={filter.collapsed ? 'Expand' : 'Collapse'}
          onClick={() => onChange({ collapsed: !filter.collapsed })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={filter.collapsed ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg>
        </button>
      </header>
      {/* The Play options, on their own line (shown expanded). */}
      {keys.length && !filter.collapsed ? (
        <div className="graph_timeline_options" role="group" aria-label="Timeline options">
          <label className="graph_timeline_check" title="Show all dates again when Play reaches the end">
            <input type="checkbox" checked={autoReset} onChange={(event) => onChange({ key, autoReset: event.target.checked })} />
            Auto reset
          </label>
          <label className="graph_timeline_check" title="Start Play from the first bar whenever the timeline is expanded">
            <input
              type="checkbox"
              checked={Boolean(filter.autoplay)}
              onChange={(event) => {
                if (event.target.checked && !playing && buckets.length >= 2) startPlay({ autoplay: true });
                else onChange({ key, autoplay: event.target.checked });
              }}
            />
            Autoplay
          </label>
          <label className="graph_timeline_check" title="Also hide nodes and links without this date">
            <input type="checkbox" checked={Boolean(filter.hideUndated)} onChange={(event) => onChange({ key, hideUndated: event.target.checked })} />
            Hide undated
          </label>
        </div>
      ) : null}
      {buckets.length && !filter.collapsed ? (
        <>
          <svg
            ref={svgRef}
            className="graph_timeline_bars"
            viewBox={`0 0 ${buckets.length} ${HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Histogram by ${unit}: drag across it to keep a period`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { drag.current = null; setPreview(null); }}
          >
            {buckets.map((bucket, index) => {
              const height = bucket.count ? Math.max(2, (bucket.count / max) * (HEIGHT - 2)) : 0;
              return (
                <rect key={bucket.start} x={index + 0.1} y={HEIGHT - height} width={0.8} height={height} className={highlight(index) ? 'is-selected' : ''}>
                  <title>{`${formatBucket(bucket.start, unit)}: ${bucket.count}`}</title>
                </rect>
              );
            })}
          </svg>
          <div className="graph_timeline_axis" aria-hidden="true">
            <span>{formatBucket(buckets[0].start, unit)}</span>
            <span>{formatBucket(buckets[buckets.length - 1].start, unit)}</span>
          </div>
        </>
      ) : null}
    </section>
  );
}
