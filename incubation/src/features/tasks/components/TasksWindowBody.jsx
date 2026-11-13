import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { formatStreamLog } from '../../source/lib/sourceModel.js';
import LogLines from '../../../shared/logs/LogLines.jsx';
import { getStreamLogLines, subscribeStreamLog } from '../../source/lib/streamLogs.js';
import {
  TASK_ORIGINS,
  canTerminateTask,
  getSessionUsage,
  getTasksSnapshot,
  isTaskActive,
  removeFinishedTasks,
  subscribeTasks,
  terminateTask,
} from '../lib/taskRegistry.js';
import { FLAG_STATES, taskFlagVerdict } from '../lib/taskFlags.js';
import {
  TASK_FILTERS,
  formatClock,
  formatDateTime,
  matchesTaskFilter,
  taskDuration,
  taskLogFileName,
  taskOriginLabel,
  taskStatusLabel,
} from '../lib/taskFormat.js';

const EMPTY_LINES = Object.freeze([]);
const noopSubscribe = () => () => {};
const emptyLines = () => EMPTY_LINES;

function Icon({ d, className = 'tasks_window_icon' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {(Array.isArray(d) ? d : [d]).map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

const ICONS = {
  tasks: ['M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2', 'M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2Z', 'm9 14 2 2 4-4'],
  graph: 'M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm2.2-4.2 5.6-7.6M9.5 7.3l5 8.2',
  // Bar chart: three bars on a baseline.
  chart: ['M4 20h16', 'M6.5 19.5V13a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v6.5', 'M10.5 19.5V6a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v13.5', 'M14.5 19.5V10a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v9.5'],
  // Window with an arrow pointing out of it: jump to the Source window.
  source: ['M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5', 'M4 8.5h7', 'M14 4h6v6', 'M20 4l-8 8'],
  stop: 'M7 7h10v10H7z',
  download: ['M12 4v11', 'm7 10 5 5 5-5', 'M5 20h14'],
  clear: ['M4 7h16', 'M10 11v6M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  copy: ['M9 9h11v11H9z', 'M5 15H4V4h11v1'],
  check: 'm5 12.5 4.5 4.5L19 7',
  chevron: 'm9 6 6 6-6 6',
  timer: ['M12 8v5l3 2', 'M10 2h4', 'M12 22a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z'],
  calendar: ['M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12Z', 'M4 10h16M8 3v4M16 3v4'],
  realtime: 'M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z',
  batch: ['m12 3 9 4.5-9 4.5-9-4.5L12 3Z', 'm3 12 9 4.5 9-4.5', 'm3 16.5 9 4.5 9-4.5'],
  rows: ['M4 6h16', 'M4 12h16', 'M4 18h16'],
  columns: ['M4 4h16v16H4z', 'M9.3 4v16M14.7 4v16'],
  tool: ['M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm12 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M8.6 7.5l6.8 3M8.6 16.5l6.8-3'],
  search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z', 'm20 20-3.5-3.5'],
  arrowDown: ['M12 5v14', 'm6 13 6 6 6-6'],
  origin: ['M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-13Z', 'M4 9h16'],
  input: ['M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  session: ['M7 11V7a5 5 0 0 1 10 0v4', 'M5 11h14v10H5z'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z', 'M14 3v5h5', 'M9 13h6M9 17h4'],
};

function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);
  if (!value || typeof navigator === 'undefined' || !navigator.clipboard) return null;
  return (
    <button
      type="button"
      className={`tasks_meta_copy linkx_tooltip_anchor${copied ? ' is-copied' : ''}`}
      data-tooltip={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
      aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
      onClick={() => navigator.clipboard.writeText(String(value)).then(() => setCopied(true), () => {})}
    >
      <Icon d={copied ? ICONS.check : ICONS.copy} />
    </button>
  );
}

const FLAG_ICONS = {
  [FLAG_STATES.SUSPICIOUS]: ['M12 3 2 20h20L12 3Z', 'M12 10v4', 'M12 17v.01'],
  [FLAG_STATES.CLEAN]: ['M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3Z', 'm9 12 2 2 4-4'],
  [FLAG_STATES.PENDING]: ['M12 3a9 9 0 1 0 9 9', 'M12 7v5l3 2'],
  [FLAG_STATES.UNDETERMINED]: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.1', 'M12 17v.01'],
};

// Clean / Suspicious: <flags> / Analysing / Not determined, read from the log.
const flagChip = (flag, extra = {}) => (
  <span
    key={flag.name}
    className="tasks_verdict_flag"
    title={`${flag.name}: ${flag.count.toLocaleString()} flagged`}
    {...extra}
  >
    <span className="tasks_verdict_flag_name">{flag.name}</span>
    {flag.count > 1 ? <span className="tasks_verdict_flag_count">{flag.count.toLocaleString()}</span> : null}
  </span>
);

// How many chips fit on the one line, leaving room for the "+N" badge when
// some do not. Measured from an invisible copy of every chip.
function useFittingCount(flags, rowRef, measureRef) {
  const [fitting, setFitting] = useState(flags.length);
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return undefined;
    const compute = () => {
      const available = row.clientWidth;
      const chips = Array.from(measure.querySelectorAll('.tasks_verdict_flag'));
      const more = measure.querySelector('.tasks_verdict_more');
      if (!available || !chips.length) {
        setFitting(flags.length);
        return;
      }
      const gap = parseFloat(getComputedStyle(measure).columnGap) || 4;
      const widths = chips.map((chip) => chip.getBoundingClientRect().width);
      const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
      if (total <= available) {
        setFitting(widths.length);
        return;
      }
      const reserve = (more?.getBoundingClientRect().width || 32) + gap;
      let used = 0;
      let count = 0;
      for (const width of widths) {
        const next = used + (count ? gap : 0) + width;
        if (next + reserve > available) break;
        used = next;
        count += 1;
      }
      setFitting(count);
    };
    compute();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(compute);
    observer.observe(row);
    return () => observer.disconnect();
  }, [flags, rowRef, measureRef]);
  return Math.min(fitting, flags.length);
}

// Clean / Suspicious: <flags> / Analysing / Not determined, read from the
// log. One line: the badge, the chips that fit, then "+N" for the rest.
function FlagVerdict({ verdict }) {
  const rowRef = useRef(null);
  const measureRef = useRef(null);
  const fitting = useFittingCount(verdict.flags, rowRef, measureRef);
  const shown = verdict.flags.slice(0, fitting);
  const hiddenFlags = verdict.flags.slice(fitting);
  return (
    <div
      className={`tasks_verdict is-${verdict.state}`}
      role="status"
      aria-label={`Analysis verdict: ${verdict.label}${verdict.flags.length ? `: ${verdict.flags.map((flag) => (flag.count > 1 ? `${flag.name} (${flag.count.toLocaleString()})` : flag.name)).join(', ')}` : verdict.detail ? ` (${verdict.detail})` : ''}`}
    >
      <span className="tasks_verdict_badge">
        <Icon d={FLAG_ICONS[verdict.state]} />
        {verdict.label}
      </span>
      {verdict.flags.length ? (
        <span className="tasks_verdict_flags" ref={rowRef}>
          {shown.map((flag) => flagChip(flag))}
          {hiddenFlags.length > 0 && (
            <span
              className="tasks_verdict_more linkx_tooltip_anchor"
              data-tooltip={hiddenFlags.map((flag) => `${flag.name} (${flag.count.toLocaleString()})`).join(', ')}
            >
              +{hiddenFlags.length}
            </span>
          )}
          <span className="tasks_verdict_measure" ref={measureRef} aria-hidden="true">
            {verdict.flags.map((flag) => flagChip(flag))}
            <span className="tasks_verdict_more">+{verdict.flags.length}</span>
          </span>
        </span>
      ) : (
        <span className="tasks_verdict_detail">{verdict.detail}</span>
      )}
    </div>
  );
}

// Run details stay open or collapsed across task selections.
let detailsOpenPreference = true;
try {
  detailsOpenPreference = window.localStorage.getItem('linkx.tasks.detailsOpen') !== '0';
} catch { /* storage unavailable */ }

const formatCount = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && String(value ?? '').trim() !== '' ? number.toLocaleString() : String(value ?? '—');
};

function Figure({ icon, label, value, hint }) {
  return (
    <div className="tasks_figure">
      <dt>
        <Icon d={icon} className="tasks_figure_icon" />
        {label}
      </dt>
      <dd>
        <span className="tasks_figure_value" title={String(value)}>
          {value}
        </span>
        {hint ? <span className="tasks_figure_hint" title={String(hint)}>{hint}</span> : null}
      </dd>
    </div>
  );
}

const columnNames = (frame) => (frame.columns || [])
  .map((column) => (typeof column === 'string' ? column : column?.name))
  .filter(Boolean);

function PropTile({ icon, label, children, copyValue, mono = false }) {
  return (
    <div className="tasks_props_tile">
      <span className="tasks_props_tile_icon"><Icon d={icon} /></span>
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : ''}>
        <span className="tasks_props_value">{children}</span>
        {copyValue ? <CopyButton value={copyValue} label={label} /> : null}
      </dd>
    </div>
  );
}

// Key figures in one strip, then the run's parameters as a quiet list.
function TaskSummary({ task }) {
  const [detailsOpen, setDetailsOpen] = useState(detailsOpenPreference);
  const modeLabel = task.mode ? task.mode[0].toUpperCase() + task.mode.slice(1) : '—';
  const frame = task.dataframe;
  const toggleDetails = () => {
    const next = !detailsOpen;
    detailsOpenPreference = next;
    setDetailsOpen(next);
    try { window.localStorage.setItem('linkx.tasks.detailsOpen', next ? '1' : '0'); } catch { /* ignore */ }
  };

  return (
    <div className="tasks_summary">
      <div className={`tasks_figures${frame ? ' has-frame' : ''}`}>
        <section className="tasks_figures_group" aria-label="Run">
          <dl className="tasks_figures_row">
            <Figure icon={ICONS.calendar} label="Started" value={formatClock(task.startedAt)} hint={formatDateTime(task.startedAt).slice(0, 10)} />
            <Figure
              icon={task.mode === 'realtime' ? ICONS.realtime : ICONS.batch}
              label="Mode"
              value={modeLabel}
              hint={task.mode === 'realtime' ? 'Continuous stream' : task.mode ? 'One-off ingestion' : ''}
            />
          </dl>
        </section>
        {frame ? (
          <section className="tasks_figures_group" aria-label="Dataframe figures">
              <dl className="tasks_figures_row" aria-label="Dataframe">
              <Figure icon={ICONS.rows} label="Rows" value={formatCount(frame.totalRows)} />
              <Figure
                icon={ICONS.columns}
                label="Columns"
                value={formatCount(frame.totalColumns ?? columnNames(frame).length)}
                hint={columnNames(frame).join(', ') || 'Fields'}
              />
              <Figure icon={ICONS.tool} label="Tool" value={frame.tool || '—'} />
            </dl>
          </section>
        ) : null}
      </div>

      <section className={`tasks_props${detailsOpen ? ' is-open' : ''}`} aria-label="Run details">
        <h4 className="tasks_props_header">
          <button
            type="button"
            className="tasks_props_toggle"
            aria-expanded={detailsOpen}
            aria-controls={`tasks-props-${task.id}`}
            onClick={toggleDetails}
          >
            <Icon d={ICONS.chevron} className="tasks_props_chevron" />
            Run details
            {!detailsOpen && (
              <span className="tasks_props_peek">{[task.action, task.input].filter(Boolean).join(' · ')}</span>
            )}
          </button>
        </h4>
        {detailsOpen && (
          <div className="tasks_props_body" id={`tasks-props-${task.id}`}>
            <div className="tasks_props_hero">
              <div className="tasks_props_action">
                <dl>
                  <div>
                    <dt>Action</dt>
                    <dd className="tasks_props_action_name" title={task.action || ''}>{task.action || 'Not set'}</dd>
                  </div>
                  {task.rule ? (
                    <div className="tasks_props_rule">
                      <dt>Rule</dt>
                      <dd title={task.rule}>{task.rule}</dd>
                    </div>
                  ) : null}
                </dl>
              </div>
              {task.sourceColumn || task.targetColumn ? (
                <div
                  className="tasks_props_graph"
                  role="img"
                  aria-label={`Columns ${task.sourceColumn || '?'} to ${task.targetColumn || '?'}${task.relationship ? ` via ${task.relationship}` : ''}`}
                >
                  <span className="tasks_props_node" title={task.sourceColumn}>{task.sourceColumn || '?'}</span>
                  <span className="tasks_props_edge">
                    {task.relationship ? <span className="tasks_props_edge_label" title={task.relationship}>{task.relationship}</span> : null}
                  </span>
                  <span className="tasks_props_node" title={task.targetColumn}>{task.targetColumn || '?'}</span>
                </div>
              ) : (
                <span className="tasks_props_hero_note">
                  {task.relationship ? `Relationship ${task.relationship}` : 'No column mapping for this action'}
                </span>
              )}
            </div>
            <dl className="tasks_props_tiles">
              <PropTile icon={ICONS.origin} label="Origin">
                {task.origin === TASK_ORIGINS.QUICK ? 'Quick analysis panel' : (task.windowTitle || 'Source window')}
                {task.background ? <span className="tasks_props_note"> · closed</span> : null}
              </PropTile>
              <PropTile icon={ICONS.input} label="Input">{task.input || '—'}</PropTile>
              {task.sourceSessionId ? (
                <PropTile icon={ICONS.session} label="Session" mono copyValue={task.sourceSessionId}>{task.sourceSessionId}</PropTile>
              ) : null}
              {task.logFile ? (
                <PropTile icon={ICONS.file} label="Log file" mono copyValue={task.logFile}>{task.logFile}</PropTile>
              ) : null}
            </dl>
          </div>
        )}
      </section>
    </div>
  );
}

// The log stays open or collapsed across task selections and reloads.
let logOpenPreference = true;
try {
  logOpenPreference = window.localStorage.getItem('linkx.tasks.logOpen') !== '0';
} catch { /* storage unavailable */ }

function TaskLog({ task, lines, isActive }) {
  const bodyRef = useRef(null);
  const [isOpen, setIsOpen] = useState(logOpenPreference);
  const [query, setQuery] = useState('');
  const [following, setFollowing] = useState(true);
  const followingRef = useRef(true);

  const needle = query.trim().toLowerCase();
  const matching = useMemo(
    () => (needle ? lines.filter((entry) => String(entry.message ?? '').toLowerCase().includes(needle)) : lines),
    [lines, needle],
  );

  useEffect(() => {
    const box = bodyRef.current;
    if (box && followingRef.current) box.scrollTop = box.scrollHeight;
  }, [matching, isOpen]);

  const toggleOpen = () => {
    const next = !isOpen;
    logOpenPreference = next;
    if (next) {
      followingRef.current = true;
      setFollowing(true);
    }
    setIsOpen(next);
    try { window.localStorage.setItem('linkx.tasks.logOpen', next ? '1' : '0'); } catch { /* ignore */ }
  };

  const jumpToLatest = () => {
    const box = bodyRef.current;
    if (box) box.scrollTop = box.scrollHeight;
    followingRef.current = true;
    setFollowing(true);
  };

  const downloadLog = () => {
    const blob = new Blob([formatStreamLog(lines)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = taskLogFileName(task);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className={`tasks_log${isOpen ? ' is-open' : ' is-collapsed'}`}>
      <div className="tasks_log_header">
        <h4>
          <button
            type="button"
            className="tasks_log_toggle"
            aria-expanded={isOpen}
            aria-controls={`tasks-log-${task.id}`}
            onClick={toggleOpen}
          >
            <Icon d={ICONS.chevron} className="tasks_props_chevron" />
            Activity log
          </button>
        </h4>
        {isActive ? <span className="tasks_log_live"><span aria-hidden="true" />Live</span> : null}
        <span className="tasks_log_count">
          {needle ? `${matching.length.toLocaleString()} of ${lines.length.toLocaleString()}` : `${lines.length.toLocaleString()} line${lines.length === 1 ? '' : 's'}`}
        </span>
        {isOpen && (
        <label className="tasks_log_search">
          <Icon d={ICONS.search} />
          <input
            type="search"
            value={query}
            placeholder="Filter log"
            aria-label="Filter log"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        )}
        <button type="button" className="tasks_icon_button linkx_tooltip_anchor" data-tooltip="Download log" aria-label="Download log" disabled={!lines.length} onClick={downloadLog}>
          <Icon d={ICONS.download} />
        </button>
      </div>
      {isOpen && (
      <div className="tasks_log_frame" id={`tasks-log-${task.id}`}>
        <div
          ref={bodyRef}
          className="tasks_log_body"
          tabIndex={0}
          role="log"
          aria-label="Activity log"
          aria-live={isActive ? 'polite' : 'off'}
          onScroll={(event) => {
            const box = event.currentTarget;
            const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
            if (atBottom !== followingRef.current) {
              followingRef.current = atBottom;
              setFollowing(atBottom);
            }
          }}
        >
          <LogLines
            lines={matching}
            classPrefix="tasks_log"
            emptyText={needle ? 'No lines match this filter.' : isActive ? 'Waiting for the first log lines…' : 'No log lines were recorded.'}
          />
        </div>
        {!following && matching.length > 0 && (
          <button type="button" className="tasks_log_jump" onClick={jumpToLatest}>
            <Icon d={ICONS.arrowDown} /> Latest
          </button>
        )}
      </div>
      )}
    </div>
  );
}

// The task's log: its own lines (quick tasks), the copy taken when its
// window moved on, or the window's live stream log while the run is current.
function useTaskLog(task) {
  const liveWindowId = task && task.origin === TASK_ORIGINS.SOURCE && !task.frozenLog ? task.windowId : '';
  const subscribe = useCallback(
    (listener) => (liveWindowId ? subscribeStreamLog(liveWindowId, listener) : noopSubscribe()),
    [liveWindowId],
  );
  const getLines = useCallback(() => (liveWindowId ? getStreamLogLines(liveWindowId) : emptyLines()), [liveWindowId]);
  const liveLines = useSyncExternalStore(subscribe, getLines);
  if (!task) return EMPTY_LINES;
  if (task.origin === TASK_ORIGINS.QUICK) return task.log;
  return task.frozenLog || liveLines;
}

function StatusDot({ task }) {
  return <span className={`tasks_status_dot is-${task.status}`} aria-hidden="true" />;
}

function SessionMeter({ usage }) {
  const isFull = usage.available <= 0;
  const detail = [
    usage.openWindows ? `${usage.openWindows} Source window${usage.openWindows === 1 ? '' : 's'}` : '',
    usage.background ? `${usage.background} background` : '',
    usage.quick ? `${usage.quick} quick` : '',
  ].filter(Boolean).join(' · ') || 'All free';
  return (
    <div
      className={`tasks_session_meter linkx_tooltip_anchor${isFull ? ' is-full' : ''}`}
      role="meter"
      aria-label="Analysis sessions in use"
      aria-valuemin={0}
      aria-valuemax={usage.limit}
      aria-valuenow={Math.min(usage.used, usage.limit)}
      aria-valuetext={`${usage.used} of ${usage.limit} analysis sessions in use (${detail})`}
      data-tooltip={detail}
    >
      <span className="tasks_session_meter_slots" aria-hidden="true">
        {Array.from({ length: usage.limit }, (_, index) => (
          <span key={index} className={index < usage.used ? 'is-used' : ''} />
        ))}
      </span>
      <span className="tasks_session_meter_text">{Math.min(usage.used, usage.limit)} / {usage.limit} sessions</span>
    </div>
  );
}

function TaskRow({ task, now, isSelected, onSelect }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      data-task-id={task.id}
      tabIndex={isSelected ? 0 : -1}
      className={`tasks_row is-${task.status}${isSelected ? ' is-selected' : ''}`}
      onClick={() => onSelect(task.id)}
    >
      <StatusDot task={task} />
      <span className="tasks_row_main">
        <span className="tasks_row_title">
          <strong>{task.title}</strong>
          <small>#{task.number}</small>
        </span>
        <span className="tasks_row_sub">{task.input || taskOriginLabel(task)}</span>
        {isTaskActive(task) && typeof task.progress === 'number' && (
          <span className="tasks_progress" aria-hidden="true"><span style={{ width: `${task.progress}%` }} /></span>
        )}
      </span>
      <span className="tasks_row_side">
        <span className="tasks_row_time">{taskDuration(task, now)}</span>
        <span className="tasks_row_chips">
          {task.background && isTaskActive(task) && <span className="tasks_chip">Background</span>}
          <span className={`tasks_row_status is-${task.status}`}>{taskStatusLabel(task)}</span>
        </span>
      </span>
    </button>
  );
}

function TaskDetail({ task, now, windows, workspace }) {
  const lines = useTaskLog(task);
  // Remounted per task (key), so this state never leaks between tasks.
  const [isTerminating, setIsTerminating] = useState(false);

  const isActive = isTaskActive(task);
  const sourceWindow = task.origin === TASK_ORIGINS.SOURCE
    ? windows.find((windowItem) => windowItem.id === task.windowId)
    : null;
  const canTerminate = isActive && canTerminateTask(task.id);
  const resultsHint = task.hasResults ? '' : 'Available once the analysis has started on the backend.';
  // Streams: only backend lines carry a verdict; quick tasks: their own log.
  const verdict = useMemo(
    () => taskFlagVerdict(task, lines, { backendOnly: task.origin === TASK_ORIGINS.SOURCE }),
    [task, lines],
  );

  // One Graph / Chart window per task: focus it when it is already open.
  const openResultWindow = (type) => {
    const existing = windows.find((windowItem) => windowItem.type === type && windowItem.metadata?.taskId === task.id);
    if (existing) {
      workspace.focusWindow(existing.id);
      return;
    }
    workspace.openWindow(type, {
      title: type === WORKSPACE_WINDOW_TYPES.GRAPH ? 'Graph' : 'Chart',
      customTitle: `${task.title} #${task.number}`,
      metadata: {
        taskId: task.id,
        graphLinkSource: task.sourceSessionId,
        graphLinkAction: task.action,
      },
    });
  };

  const handleTerminate = async () => {
    setIsTerminating(true);
    try {
      await terminateTask(task.id);
    } finally {
      setIsTerminating(false);
    }
  };

  const subtitle = task.statusText || task.message
    || (isActive ? 'In progress' : `Finished ${formatDateTime(task.endedAt)}`);

  return (
    <section className="tasks_detail" aria-label={`Task ${task.title} #${task.number}`}>
      <header className="tasks_detail_header">
        <div className="tasks_detail_header_main">
          <p className="tasks_detail_eyebrow">
            Task #{task.number}
            <span aria-hidden="true">·</span>
            {taskOriginLabel(task)}
          </p>
          <div className="tasks_detail_title">
            <h3>{task.title}</h3>
            <span className={`tasks_status_badge is-${task.status}`}>
              <StatusDot task={task} />
              {taskStatusLabel(task)}
            </span>
            <span
              className={`tasks_detail_timer is-${task.status}`}
              role="timer"
              aria-label={`${isActive ? 'Elapsed' : 'Duration'} ${taskDuration(task, now)}`}
              title={isActive ? 'Elapsed time' : `Duration · ended ${formatClock(task.endedAt)}`}
            >
              <Icon d={ICONS.timer} />
              {taskDuration(task, now)}
            </span>
            {task.background && isActive && <span className="tasks_chip">Background</span>}
          </div>
          <p className="tasks_detail_subtitle" title={subtitle}>{subtitle}</p>
        </div>
        <div className="tasks_detail_header_actions" role="group" aria-label="Task actions">
          {sourceWindow && (
            <button
              type="button"
              className="tasks_action linkx_tooltip_anchor"
              data-tooltip={`Focus ${sourceWindow.title}`}
              onClick={() => workspace.focusWindow(sourceWindow.id)}
            >
              <Icon d={ICONS.source} /> Go to source
            </button>
          )}
          <button
            type="button"
            className="tasks_action is-primary linkx_tooltip_anchor"
            disabled={!task.hasResults}
            data-tooltip={resultsHint || 'Open the analysis graph'}
            onClick={() => openResultWindow(WORKSPACE_WINDOW_TYPES.GRAPH)}
          >
            <Icon d={ICONS.graph} /> Show graph
          </button>
          <button
            type="button"
            className="tasks_action linkx_tooltip_anchor"
            disabled={!task.hasResults}
            data-tooltip={resultsHint || 'Open the analysis chart'}
            onClick={() => openResultWindow(WORKSPACE_WINDOW_TYPES.CHART)}
          >
            <Icon d={ICONS.chart} /> Show chart
          </button>
          {isActive && (
            <button
              type="button"
              className="tasks_action is-danger"
              disabled={!canTerminate || isTerminating}
              onClick={handleTerminate}
            >
              <Icon d={ICONS.stop} /> {isTerminating ? 'Terminating…' : 'Terminate'}
            </button>
          )}
        </div>
      </header>

      {isActive && (
        <span
          className={`tasks_progress is-large${typeof task.progress === 'number' ? '' : ' is-indeterminate'}`}
          role="progressbar"
          aria-label="Progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={typeof task.progress === 'number' ? task.progress : undefined}
        >
          <span style={typeof task.progress === 'number' ? { width: `${task.progress}%` } : undefined} />
        </span>
      )}

      <FlagVerdict verdict={verdict} />

      <TaskSummary task={task} />

      <TaskLog task={task} lines={lines} isActive={isActive} />
    </section>
  );
}

export default function TasksWindowBody() {
  const workspace = useWorkspace();
  const { tasks, focus } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(() => focus.taskId || tasks.find(isTaskActive)?.id || tasks[0]?.id || null);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef(null);
  const hasActive = tasks.some(isTaskActive);

  // "Show results" / "View task" select a task, even when this window is
  // already open.
  const lastFocusSeq = useRef(focus.seq);
  useEffect(() => {
    if (focus.seq === lastFocusSeq.current) return;
    lastFocusSeq.current = focus.seq;
    if (focus.taskId) {
      setSelectedId(focus.taskId);
      setFilter('all');
    }
  }, [focus]);

  // Elapsed times tick while something runs.
  useEffect(() => {
    if (!hasActive) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasActive]);
  const clock = hasActive ? now : Date.now();

  const openSourceCount = workspace.windows.filter((windowItem) => windowItem.type === WORKSPACE_WINDOW_TYPES.SOURCE).length;
  const usage = getSessionUsage(openSourceCount, tasks);
  const counts = useMemo(() => Object.fromEntries(TASK_FILTERS.map((item) => [item.id, tasks.filter((task) => matchesTaskFilter(task, item.id)).length])), [tasks]);
  const visible = useMemo(() => tasks.filter((task) => matchesTaskFilter(task, filter)), [tasks, filter]);
  const activeTasks = visible.filter(isTaskActive);
  const historyTasks = visible.filter((task) => !isTaskActive(task));
  const ordered = [...activeTasks, ...historyTasks];
  const selected = tasks.find((task) => task.id === selectedId) || ordered[0] || null;
  const finishedCount = tasks.length - tasks.filter(isTaskActive).length;

  const handleListKeyDown = (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !ordered.length) return;
    event.preventDefault();
    const index = Math.max(0, ordered.findIndex((task) => task.id === selected?.id));
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? ordered.length - 1
        : Math.min(ordered.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
    const next = ordered[nextIndex];
    setSelectedId(next.id);
    requestAnimationFrame(() => listRef.current?.querySelector(`[data-task-id="${next.id}"]`)?.focus());
  };

  const renderSection = (title, items) => (items.length ? (
    <div className="tasks_list_section" role="group" aria-label={title}>
      <h4 className="tasks_list_section_title">{title} <span>{items.length}</span></h4>
      {items.map((task) => (
        <TaskRow key={task.id} task={task} now={clock} isSelected={selected?.id === task.id} onSelect={setSelectedId} />
      ))}
    </div>
  ) : null);

  return (
    <div className="workspace_window_body tasks_window_body">
      <div className="tasks_window">
        <header className="tasks_window_header">
          <div className="tasks_window_heading">
            <Icon d={ICONS.tasks} className="tasks_window_heading_icon" />
            <div>
              <h3>Analysis tasks</h3>
              <p>Streams from Source windows and quick analyses, live and finished.</p>
            </div>
          </div>
          <SessionMeter usage={usage} />
        </header>

        <div className="tasks_window_toolbar">
          <div className="tasks_filter" role="radiogroup" aria-label="Filter tasks">
            {TASK_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={filter === item.id}
                className={filter === item.id ? 'is-active' : ''}
                onClick={() => setFilter(item.id)}
              >
                {item.label}
                <span className="tasks_filter_count">{counts[item.id]}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="tasks_icon_button linkx_tooltip_anchor"
            data-tooltip="Clear finished tasks"
            aria-label="Clear finished tasks"
            disabled={!finishedCount}
            onClick={removeFinishedTasks}
          >
            <Icon d={ICONS.clear} />
          </button>
        </div>

        {tasks.length === 0 ? (
          <div className="tasks_empty">
            <Icon d={ICONS.tasks} className="tasks_empty_icon" />
            <h4>No analysis tasks yet</h4>
            <p>
              Runs started from a Source window or the quick analysis panel appear here, with their live log,
              graph and chart. Up to {usage.limit} analysis sessions can run at once.
            </p>
          </div>
        ) : (
          <div className="tasks_window_main">
            <div
              ref={listRef}
              className="tasks_list"
              role="listbox"
              aria-label="Analysis tasks"
              tabIndex={-1}
              onKeyDown={handleListKeyDown}
            >
              {renderSection('Active', activeTasks)}
              {renderSection('History', historyTasks)}
              {!ordered.length && <p className="tasks_list_empty">No tasks match this filter.</p>}
            </div>
            {selected ? (
              <TaskDetail key={selected.id} task={selected} now={clock} windows={workspace.windows} workspace={workspace} />
            ) : (
              <div className="tasks_detail is-empty"><p>Select a task to see its details.</p></div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
