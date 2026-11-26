// The system panel (central workspace, second page): what the windows hold,
// at a glance, by what the signed-in user may see. Figures: workspace/lib/
// dashboardModel.js; styles: main.css, "System panel".
import React, { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';

import { useCan } from '../../auth/useCan.js';
import { SOURCE_PERMISSIONS } from '../../auth/permissions.js';
import { useSession } from '../../shared/session/useSession.js';
import { useDomainRegistry } from '../../shared/domains/domainRegistry.js';
import { formatDomainPillarLabel, getActiveDomainKey } from '../../features/configuration/lib/configModel.js';
import { getAlertsSnapshot, subscribeAlerts } from '../../features/alerts/lib/alertStore.js';
import { getAlertScope } from '../../features/alerts/lib/alertRuntime.js';
import { getTasksSnapshot, subscribeTasks } from '../../features/tasks/lib/taskRegistry.js';
import { getServerTaskScope } from '../../features/tasks/lib/serverTasks.js';
import { SEAT_STATES, getSeats, getUnattendedTask, loadSeats, subscribeSeats } from '../../features/tasks/lib/unattendedSeats.js';
import { formatDateTime, formatDuration, taskStatusLabel } from '../../features/tasks/lib/taskFormat.js';
import { getGpuBenchmark, getGpuLimits, subscribeGpuBenchmark } from '../../features/graph/lib/gpuBenchmark.js';
import { RENDERERS, resolveRenderer, subscribeRenderer } from '../../features/graph/lib/rendererPreference.js';
import { visibleCapFor } from '../../features/graph/lib/graphSettings.js';
import { WORKSPACE_WINDOW_TYPES } from '../state/workspaceTypes.js';
import { countAlerts, countTasks, countUsers, dashboardLevelOf, ownTasks, readFeedHealth, tasksByDay, teamTasks, weekMayBeShort } from '../lib/dashboardModel.js';
import { Line, Lollipops, RadialBars, Ring, SeatMap, SlotRing, Trend } from './DashboardCharts.jsx';
import { USABLE_FPS } from '../../features/graph/lib/gpuBenchmark.js';

const count = (value) => Number(value || 0).toLocaleString();

const ICONS = {
  sessions: 'M4 6h16M4 12h16M4 18h10',
  tasks: 'M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2m-6 9 2 2 4-4',
  alerts: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  seats: 'M12 8v4l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  session: 'M22 12h-4l-3 9L9 3l-3 9H2',
  drawing: 'M7 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm10 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm2.2-4.2 5.6-7.6M9.5 7.3l5 8.2',
  team: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm10-3v6m3-3h-6',
  feed: 'M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16M5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
};

// A tile holds a value when it is a count above zero, or words other than
// the ones that say there is nothing ("None", "Not set", "–", …).
const EMPTY_WORDS = /^(none|not set|not read yet|not run yet|–|-|)$/i;
const hasValue = (shown) => {
  const text = String(shown ?? '').trim();
  const number = Number(text.replace(/[,\s]/g, ''));
  if (Number.isFinite(number) && /^[\d,.\s]+$/.test(text)) return number > 0;
  if (/^0 of /.test(text)) return false;
  return !EMPTY_WORDS.test(text);
};

// "1 of 3" reads as a large figure and a quiet limit.
const FIGURE_OF = /^([\d,.]+) of ([\d,.]+)$/;
const FIGURE_PLAIN = /^[\d,.\s]+$/;

// `chart`: the card's chart, beside the figure. `rows`: [label, value, tone?]; a tone (1..4) marks the row as
// that colour of the chart ('rest': the open part of a bar), so the chart
// needs no legend of its own.
// `valueTone`: the same for the figure.
function Card({ icon, title, tone, value, valueNote, valueTone, rows = [], note, action, chart }) {
  const parts = FIGURE_OF.exec(String(value ?? ''));
  const numeric = Boolean(parts) || FIGURE_PLAIN.test(String(value ?? ''));
  return (
    <article className={`workspace_dash_card${tone ? ` is-${tone}` : ''}${chart ? ' has-chart' : ''}`} aria-label={title}>
      <header className="workspace_dash_card_head">
        <span className="workspace_dash_card_icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false"><path d={icon} /></svg>
        </span>
        <strong>{title}</strong>
        {tone ? <span className="workspace_dash_card_tone">{tone === 'danger' ? 'Check' : 'Attention'}</span> : null}
      </header>
      {value !== undefined || chart ? (
        <div className="workspace_dash_card_hero">
          <div className="workspace_dash_card_lead">
            {value !== undefined ? (
              <p className={`workspace_dash_figure${numeric ? '' : ' is-text'}`}>
                <strong>{parts ? <>{parts[1]}<em> of {parts[2]}</em></> : value}</strong>
                {valueNote ? <span>{valueTone ? <i className={`workspace_dash_dot is-tone-${valueTone}`} aria-hidden="true" /> : null}{valueNote}</span> : null}
              </p>
            ) : null}
          </div>
          {chart ? <div className="workspace_dash_card_chart">{chart}</div> : null}
        </div>
      ) : null}
      {rows.length ? (
        <dl className="workspace_dash_rows">
          {rows.map(([label, shown, rowTone]) => (
            <div key={label} className={hasValue(shown) ? 'is-filled' : undefined}>
              <dt>{rowTone ? <i className={`workspace_dash_dot is-tone-${rowTone}`} aria-hidden="true" /> : null}{label}</dt>
              <dd>{shown}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {note || action ? (
        <footer className="workspace_dash_card_foot">
          {note ? <p className="workspace_dash_note">{note}</p> : null}
          {action ? (
            <button type="button" className="workspace_dash_action" onClick={action.onClick}>
              <span>{action.label}</span>
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>
            </button>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

// One row of cards, two in view, scrolled sideways. The section's note sits
// above it, with `aside` and, when some cards are out of view, the two arrows.
// `onHeight`: told the cards' height (they are all as tall as the tallest),
// so other sections can take it. `onPast(1 | -1)`: sideways scrolling went on
// past the last (1) or the first (-1) card. `startAtEnd`: open showing the
// last cards (when come back to from the next section).
const PAST_DISTANCE = 90; // px of sideways scrolling beyond an end
const PAST_QUIET = 160; // ms without scrolling: a new gesture
function CardTrack({ label, note, aside, onHeight, onPast, startAtEnd = false, children }) {
  const trackRef = useRef(null);
  const [ends, setEnds] = useState({ start: true, end: true });
  const pastRef = useRef({ sum: 0, at: 0, done: false });

  useEffect(() => {
    const track = trackRef.current;
    if (track && startAtEnd) track.scrollLeft = track.scrollWidth;
  }, [startAtEnd]);

  // Sideways scrolling past an end turns to the next or previous section, once
  // per gesture. Vertical scrolling is left alone (it moves between the
  // central panels).
  useEffect(() => {
    const track = trackRef.current;
    if (!track || !onPast) return undefined;
    const atEnd = (direction) => (direction > 0
      ? track.scrollLeft + track.clientWidth >= track.scrollWidth - 1
      : track.scrollLeft <= 1);
    const push = (dx) => {
      const now = Date.now();
      const past = pastRef.current;
      if (now - past.at > PAST_QUIET) { past.sum = 0; past.done = false; }
      past.at = now;
      const direction = Math.sign(dx);
      if (!direction || past.done || !atEnd(direction)) { if (!atEnd(direction)) past.sum = 0; return; }
      if (Math.sign(past.sum) !== direction) past.sum = 0;
      past.sum += dx;
      if (Math.abs(past.sum) >= PAST_DISTANCE) {
        past.done = true;
        past.sum = 0;
        onPast(direction);
      }
    };
    const onWheel = (event) => {
      const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
      if (Math.abs(dx) > Math.abs(event.shiftKey ? 0 : event.deltaY)) push(dx);
    };
    let touch = null;
    const onTouchStart = (event) => { touch = { x: event.touches[0].clientX, y: event.touches[0].clientY }; };
    const onTouchMove = (event) => {
      if (!touch) return;
      const dx = touch.x - event.touches[0].clientX;
      const dy = touch.y - event.touches[0].clientY;
      touch = { x: event.touches[0].clientX, y: event.touches[0].clientY };
      if (Math.abs(dx) > Math.abs(dy)) push(dx * 2);
    };
    const onTouchEnd = () => { touch = null; };
    track.addEventListener('wheel', onWheel, { passive: true });
    track.addEventListener('touchstart', onTouchStart, { passive: true });
    track.addEventListener('touchmove', onTouchMove, { passive: true });
    track.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      track.removeEventListener('wheel', onWheel);
      track.removeEventListener('touchstart', onTouchStart);
      track.removeEventListener('touchmove', onTouchMove);
      track.removeEventListener('touchend', onTouchEnd);
    };
  }, [onPast]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const measure = () => {
      setEnds({
        start: track.scrollLeft <= 1,
        end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 1,
      });
      const card = track.firstElementChild;
      if (onHeight && card?.offsetHeight) onHeight(card.offsetHeight);
    };
    measure();
    track.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(track);
    if (track.firstElementChild) observer?.observe(track.firstElementChild);
    return () => {
      track.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [children, onHeight]);
  const step = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(track.clientWidth, 240), behavior: 'smooth' });
  };
  const allInView = ends.start && ends.end;
  return (
    <>
      {/* Dimmed and out of use while every card is in view (two or fewer). */}
      <div className={`workspace_dash_section_head${allInView ? ' is-idle' : ''}`} aria-disabled={allInView || undefined}>
        <p className="workspace_dash_section_note">{note}</p>
        {aside}
        <div className="workspace_dash_pager">
          <button type="button" className="workspace_dash_arrow" aria-label="Earlier cards" disabled={allInView || ends.start} onClick={() => step(-1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m15 18-6-6 6-6" /></svg>
          </button>
          <button type="button" className="workspace_dash_arrow" aria-label="Later cards" disabled={allInView || ends.end} onClick={() => step(1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 18 6-6-6-6" /></svg>
          </button>
        </div>
      </div>
      <div className={`workspace_dash_track_wrap${ends.start ? '' : ' has-before'}${ends.end ? '' : ' has-after'}`}>
        <div className="workspace_dash_track" ref={trackRef} role="group" aria-label={label}>{children}</div>
      </div>
    </>
  );
}

const seatText = (seats) => ({
  [SEAT_STATES.READY]: `${count(seats.available)} of ${count(seats.total)} free`,
  [SEAT_STATES.NONE]: 'Not offered to you',
  [SEAT_STATES.UNSUPPORTED]: 'Not offered by the Service',
  [SEAT_STATES.ERROR]: 'Could not be read',
}[seats.state] || 'Not read yet');

// `visible`: the page is on screen (the Service is asked only then);
// `refreshKey`: changes when the header's refresh button is pressed.
export default function SystemDashboard({ visible = false, refreshKey = 0, apiFetch, sessionUsage, openWindowsCount = 0, onOpenWindow, onOpenTask }) {
  const can = useCan();
  const level = dashboardLevelOf(can);
  const { configuration, isSocketConnected, mainSessionId } = useSession();
  const domains = useDomainRegistry();
  const { tasks } = useSyncExternalStore(subscribeTasks, getTasksSnapshot);
  const alertState = useSyncExternalStore(subscribeAlerts, getAlertsSnapshot);
  const seats = useSyncExternalStore(subscribeSeats, getSeats);
  const benchmark = useSyncExternalStore(subscribeGpuBenchmark, getGpuBenchmark);
  const renderer = useSyncExternalStore(subscribeRenderer, resolveRenderer);
  const gpuLimits = getGpuLimits();
  const [users, setUsers] = useState(null);
  const [feed, setFeed] = useState(null);
  const [tab, setTab] = useState('work');
  const [readAt, setReadAt] = useState(null);
  // The Your work cards' height: every other section's cards take it, so the
  // panel keeps one height across the tabs.
  const [workHeight, setWorkHeight] = useState(null);
  const baseId = useId();

  // Asked when the page is shown and on refresh; the rest is live already.
  useEffect(() => {
    if (!visible || !apiFetch) return undefined;
    let cancelled = false;
    setReadAt(Date.now());
    loadSeats(apiFetch);
    if (level.admin) {
      Promise.resolve(apiFetch('/auth/admin/users', { method: 'GET', suppressForbiddenHandler: true }))
        .then((data) => { if (!cancelled) setUsers(countUsers(data) || { error: true }); })
        .catch(() => { if (!cancelled) setUsers({ error: true }); });
      Promise.resolve(apiFetch('/api/v1/reports/xvigilance/health?limit=50', { suppressForbiddenHandler: true }))
        .then((data) => { if (!cancelled) setFeed(readFeedHealth(data) || { error: true }); })
        .catch(() => { if (!cancelled) setFeed({ error: true }); });
    }
    return () => { cancelled = true; };
  }, [visible, refreshKey, apiFetch, level.admin]);

  const mine = countTasks(ownTasks(tasks));
  const team = countTasks(teamTasks(tasks));
  const alertsOn = alertState.mode !== 'off';
  const myAlerts = countAlerts(alertState.alerts.filter((alert) => alert.mine));
  const allAlerts = countAlerts(alertState.alerts);
  const unattended = getUnattendedTask(tasks);
  const usage = sessionUsage || { used: 0, limit: 3, openWindows: 0, background: 0, quick: 0, held: 0 };
  const open = (type) => onOpenWindow?.(type);
  const domainCount = domains.status === 'ready' ? domains.domains.filter((domain) => domain.active !== false).length : null;
  const domainTotal = domains.status === 'ready' ? domains.domains.length : null;
  const gpu = renderer === RENDERERS.WEBGL;

  const openTasks = { label: 'Open Tasks', onClick: () => onOpenTask?.(null) };
  const openReports = { label: 'Open Reports', onClick: () => open(WORKSPACE_WINDOW_TYPES.REPORTS) };
  const usersRead = users && !users.error;
  const feedRead = feed && !feed.error;
  const shortNote = 'The app holds its last 50 tasks: earlier ones in these days are not counted.';
  const mineShort = weekMayBeShort(ownTasks(tasks), tasks);
  const teamShort = weekMayBeShort(teamTasks(tasks), tasks);

  const sections = [
    {
      id: 'work',
      title: 'Your work',
      icon: ICONS.tasks,
      note: 'Your own analyses and the STR alerts assigned to you.',
      cards: [
        {
          icon: ICONS.sessions,
          title: 'Analysis sessions',
          tone: usage.used >= usage.limit ? 'warning' : undefined,
          value: `${count(usage.used)} of ${count(usage.limit)}`,
          valueNote: 'in use',
          rows: [
            ['Source windows', count(usage.openWindows), 1],
            ['Background streams', count(usage.background), 2],
            ['Quick and alert runs', count(usage.quick), 3],
            ['Kept for graphs', count(usage.held), 5],
          ],
          chart: <SlotRing label="Analysis sessions" total={usage.limit} center="in use" segments={[
            { label: 'Source windows', value: usage.openWindows, tone: 1 },
            { label: 'Background', value: usage.background, tone: 2 },
            { label: 'Quick and alert', value: usage.quick, tone: 3 },
            { label: 'Kept', value: usage.held, tone: 5 },
          ]} />,
        },
        {
          icon: ICONS.tasks,
          title: 'Your tasks',
          tone: mine.suspicious ? 'warning' : undefined,
          value: count(mine.running),
          valueNote: 'running',
          rows: [
            ['Finished today', count(mine.finishedToday)],
            ['Stopped or failed today', count(mine.stopped)],
            ['Suspicious results', count(mine.suspicious)],
          ],
          note: mine.latest ? `Latest: ${mine.latest.title || 'Task'} · ${taskStatusLabel(mine.latest)}` : 'No tasks yet.',
          action: { label: 'Open Tasks', onClick: () => onOpenTask?.(mine.latest?.id || null) },
          chart: <Trend label="Your tasks ended, last 7 days" days={tasksByDay(ownTasks(tasks)).map((day) => ({ label: day.label, title: day.title, values: [day.finished, day.stopped] }))} series={[{ label: 'Finished', tone: 1 }, { label: 'Stopped or failed', tone: 4 }]} caption={mineShort ? shortNote : ''} />,
        },
        alertsOn ? {
          icon: ICONS.alerts,
          title: 'Your STR alerts',
          tone: myAlerts.failed ? 'danger' : myAlerts.awaiting ? 'warning' : undefined,
          value: count(myAlerts.awaiting),
          valueNote: 'awaiting analysis',
          valueTone: 1,
          rows: [
            ['Data arriving', count(myAlerts.arriving), 2],
            ['Feedback to send', count(myAlerts.toSend), 5],
            ['Feedback failed', count(myAlerts.failed), 4],
            ['Assigned to you', count(myAlerts.total)],
          ],
          chart: <RadialBars label="Your STR alerts" stages={[
            { label: 'Arriving', value: myAlerts.arriving, tone: 2 },
            { label: 'Awaiting', value: myAlerts.awaiting, tone: 1 },
            { label: 'To send', value: myAlerts.toSend, tone: 5 },
            { label: 'Failed', value: myAlerts.failed, tone: 4 },
          ]} />,
          note: alertState.mode === 'mock' ? 'Sample alerts: not from the Service.' : undefined,
          action: openReports,
        } : null,
        {
          icon: ICONS.seats,
          title: 'Unattended runs',
          value: seatText(seats),
          rows: [['Your run', unattended ? unattended.title || 'Task' : 'None']],
          chart: seats.state === SEAT_STATES.READY ? (
            <SeatMap label="Unattended seats" total={seats.total} taken={seats.total - seats.available} mine={unattended ? 1 : 0} mineLabel={unattended?.title || 'Your run'} />
          ) : null,
          note: 'A seat keeps one batch run going after you sign out.',
        },
      ],
    },
    {
      id: 'session',
      title: 'Session and this computer',
      icon: ICONS.session,
      note: 'The analysis session’s set-up and how graphs are drawn here.',
      cards: [
        {
          icon: ICONS.session,
          title: 'Session',
          tone: isSocketConnected ? undefined : 'danger',
          value: isSocketConnected ? 'Connected' : 'Offline',
          valueNote: mainSessionId ? 'to the Service' : 'no session yet',
          rows: [
            ['Domain', formatDomainPillarLabel(getActiveDomainKey(configuration))],
            ['Rule', [].concat(configuration?.active_rule || [])[0] || 'Not set'],
            ['Domains available', domainCount === null ? 'Not read yet' : count(domainCount), 1],
            ...(domainTotal !== null && domainTotal > domainCount ? [['Domains turned off', count(domainTotal - domainCount), 'rest']] : []),
          ],
          chart: domainTotal ? <Ring label="Domains" total={domainTotal} rest="Turned off" centerValue={count(domainCount)} center={`of ${count(domainTotal)}`} legend={false} segments={[{ label: 'Available', value: domainCount, tone: 1 }]} /> : null,
          note: 'The domain and rule the analyses here run with.',
          action: can(SOURCE_PERMISSIONS.CONFIG_READ) ? { label: 'Open Configuration', onClick: () => open(WORKSPACE_WINDOW_TYPES.CONFIGURATION) } : undefined,
        },
        {
          icon: ICONS.drawing,
          title: 'Graph drawing',
          value: gpu ? 'GPU' : 'Standard',
          valueNote: 'drawing',
          rows: [
            ['Nodes at once', count(visibleCapFor(renderer, gpuLimits))],
            ['GPU benchmark', benchmark ? (benchmark.outcome === 'ok' ? 'Measured' : 'Not suitable') : 'Not run yet'],
            ['Open windows', count(openWindowsCount)],
          ],
          note: benchmark ? undefined : 'Run the GPU benchmark in Libraries to see how this computer draws.',
          action: { label: 'Open Libraries', onClick: () => open(WORKSPACE_WINDOW_TYPES.LIBRARIES) },
          chart: (
            <Line
              label="GPU benchmark, frames per second by nodes"
              unit=" fps"
              xNoun=" nodes"
              mark={USABLE_FPS}
              markLabel={`${USABLE_FPS} fps, the least usable`}
              empty="Benchmark not run yet"
              points={(benchmark?.steps || []).filter((stepItem) => Number.isFinite(stepItem.fps)).map((stepItem) => ({ x: stepItem.nodes >= 1000 ? `${stepItem.nodes / 1000}k` : String(stepItem.nodes), y: stepItem.fps, low: stepItem.fps < USABLE_FPS }))}
            />
          ),
        },
      ],
    },
    level.team ? {
      id: 'team',
      title: 'Team',
      icon: ICONS.team,
      note: 'Everyone’s analyses and alerts, as loaded in the Tasks and Reports windows.',
      cards: [
        !can('tasks:read_all') ? null : getServerTaskScope() === 'all' ? {
          icon: ICONS.team,
          title: 'Team tasks',
          tone: team.suspicious ? 'warning' : undefined,
          value: count(team.running),
          valueNote: 'running',
          rows: [
            ['Finished today', count(team.finishedToday)],
            ['Stopped or failed today', count(team.stopped)],
            ['Suspicious results', count(team.suspicious)],
          ],
          note: team.latest ? `Latest: ${team.latest.title || 'Task'} · ${taskStatusLabel(team.latest)}` : 'No team tasks yet.',
          action: openTasks,
          chart: <Trend label="Team tasks ended, last 7 days" days={tasksByDay(teamTasks(tasks)).map((day) => ({ label: day.label, title: day.title, values: [day.finished, day.stopped] }))} series={[{ label: 'Finished', tone: 1 }, { label: 'Stopped or failed', tone: 4 }]} caption={teamShort ? shortNote : ''} />,
        } : { icon: ICONS.team, title: 'Team tasks', value: 'Not loaded', valueNote: 'yet', note: 'Shown once All tasks is opened in the Tasks window.', action: openTasks },
        !(can('alerts:read_all') && alertsOn) ? null : getAlertScope() === 'all' ? {
          icon: ICONS.alerts,
          title: 'Team STR alerts',
          tone: allAlerts.failed ? 'danger' : allAlerts.unassigned ? 'warning' : undefined,
          value: count(allAlerts.awaiting),
          valueNote: `awaiting analysis, of ${count(allAlerts.total)}`,
          valueTone: 1,
          rows: [
            ['Data arriving', count(allAlerts.arriving), 2],
            ['Feedback to send', count(allAlerts.toSend), 5],
            ['Feedback failed', count(allAlerts.failed), 4],
            ['Not assigned', count(allAlerts.unassigned)],
          ],
          chart: <RadialBars label="Team STR alerts" stages={[
            { label: 'Arriving', value: allAlerts.arriving, tone: 2 },
            { label: 'Awaiting', value: allAlerts.awaiting, tone: 1 },
            { label: 'To send', value: allAlerts.toSend, tone: 5 },
            { label: 'Failed', value: allAlerts.failed, tone: 4 },
          ]} />,
          note: alertState.mode === 'mock' ? 'Sample alerts: not from the Service.' : undefined,
          action: openReports,
        } : { icon: ICONS.alerts, title: 'Team STR alerts', value: 'Not loaded', valueNote: 'yet', note: 'Shown once All alerts is opened in the Reports window.', action: openReports },
      ],
    } : null,
    level.admin ? {
      id: 'admin',
      title: 'Administration',
      icon: ICONS.users,
      note: 'Read from the Service when this page is shown.',
      cards: [
        {
          icon: ICONS.users,
          title: 'Users',
          tone: users?.error ? 'danger' : undefined,
          value: usersRead ? count(users.total) : users?.error ? 'Could not be read' : 'Reading…',
          valueNote: usersRead ? 'accounts' : undefined,
          rows: usersRead ? [['Active', count(users.active), 1], ['Turned off', count(users.total - users.active), 'rest']] : [],
          chart: usersRead ? <Ring half label="Users" total={users.total} rest="Turned off" centerValue={users.total ? `${Math.round((users.active / users.total) * 100)}%` : '–'} center="active" legend={false} segments={[{ label: 'Active', value: users.active, tone: 1 }]} /> : null,
          action: { label: 'Open Settings', onClick: () => open(WORKSPACE_WINDOW_TYPES.SETTINGS) },
        },
        {
          icon: ICONS.feed,
          title: 'xVigilance feed',
          tone: feed?.error ? 'danger' : feedRead && (feed.paused || feed.failedRuns) ? 'warning' : undefined,
          value: feedRead ? (feed.paused ? 'Paused' : feed.status || 'Running') : feed?.error ? 'Could not be read' : 'Reading…',
          rows: feedRead ? [
            ['Graphs analysed', feed.analysed === null ? '–' : count(feed.analysed)],
            ['Last window end', feed.lastWindowEnd ? formatDateTime(new Date(feed.lastWindowEnd).getTime()) : '–'],
            ['Last run', feed.lastRun ? `${feed.lastRun.status || '–'}${feed.lastRun.durationMs ? ` · ${formatDuration(feed.lastRun.durationMs)}` : ''}` : '–'],
            ['Failed of recent runs', `${count(feed.failedRuns)} of ${count(feed.runs)}`, feed.failedRuns ? 4 : 1],
          ] : [],
          action: { label: 'Open Settings', onClick: () => open(WORKSPACE_WINDOW_TYPES.SETTINGS) },
          chart: feedRead ? <Lollipops label="Recent feed runs, time taken" items={feed.recent.map((run, index) => ({ label: `Run ${index + 1}`, value: run.durationMs, text: `${run.status || 'run'}, ${formatDuration(run.durationMs)}`, tone: run.failed ? 4 : 1 }))} legend={feed.failedRuns ? [{ label: 'Completed', tone: 1 }, { label: 'Failed', tone: 4 }] : []} /> : null,
        },
      ],
    } : null,
  ].filter(Boolean).map((section) => ({ ...section, cards: section.cards.filter(Boolean) }));

  const current = sections.find((section) => section.id === tab) || sections[0];
  const currentIndex = sections.indexOf(current);
  // Turned to by scrolling back past the first card: open at the last ones.
  const [enteredAtEnd, setEnteredAtEnd] = useState(false);
  const turnTo = (next, atEnd = false) => {
    setEnteredAtEnd(atEnd);
    setTab(next.id);
  };
  const onPast = (direction) => {
    const next = sections[currentIndex + direction];
    if (next) turnTo(next, direction < 0);
  };
  // The active tab slides into view in the tab bar when it is turned to. Only
  // the tab bar scrolls (scrollIntoView would move the central panels too).
  useEffect(() => {
    const button = document.getElementById(`${baseId}-tab-${current.id}`);
    const bar = button?.parentElement;
    if (!button || !bar || bar.scrollWidth <= bar.clientWidth) return;
    const left = button.offsetLeft - bar.offsetLeft;
    const right = left + button.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollTo({ left, behavior: 'smooth' });
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: right - bar.clientWidth, behavior: 'smooth' });
  }, [baseId, current.id]);
  const attention = (section) => section.cards.filter((card) => card.tone).length;
  const tabId = (id) => `${baseId}-tab-${id}`;
  const onTabKey = (event) => {
    const index = sections.indexOf(current);
    const next = event.key === 'ArrowRight' ? index + 1 : event.key === 'ArrowLeft' ? index - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    const target = sections[(next + sections.length) % sections.length];
    turnTo(target);
    document.getElementById(tabId(target.id))?.focus();
  };

  return (
    <div
      className="workspace_dash"
      data-level={level.label.toLowerCase()}
      style={current.id !== 'work' && workHeight ? { '--dash-card-height': `${workHeight}px` } : undefined}
    >
      <div className="workspace_dash_bar">
        <div className="workspace_dash_tabs" role="tablist" aria-label="System panel sections" onKeyDown={onTabKey}>
          {sections.map((section) => {
            const selected = section === current;
            const flagged = attention(section);
            return (
              <button
                key={section.id}
                id={tabId(section.id)}
                type="button"
                role="tab"
                className={`workspace_dash_tab${selected ? ' is-active' : ''}`}
                aria-selected={selected}
                aria-controls={`${baseId}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => turnTo(section)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d={section.icon} /></svg>
                <span>{section.title}</span>
                {flagged ? <small className="workspace_dash_tab_count" title={`${flagged} need attention`}>{flagged}</small> : null}
              </button>
            );
          })}
        </div>
        <div className="workspace_dash_status">
          <span className={`workspace_dash_live${isSocketConnected ? '' : ' is-off'}`}>
            <i aria-hidden="true" />
            {isSocketConnected ? 'Online' : 'Offline'}
          </span>
          <span className="workspace_dash_level">{level.label} view</span>
        </div>
      </div>

      <section id={`${baseId}-panel`} className="workspace_dash_section" role="tabpanel" aria-labelledby={tabId(current.id)}>
        <CardTrack
          key={current.id}
          label={`${current.title} cards`}
          note={current.note}
          onHeight={current.id === 'work' ? setWorkHeight : undefined}
          onPast={onPast}
          startAtEnd={enteredAtEnd}
          aside={readAt ? <p className="workspace_dash_asof">Service figures as of <time dateTime={new Date(readAt).toISOString()}>{new Date(readAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</time></p> : null}
        >
          {current.cards.map((card) => <Card key={card.title} {...card} />)}
        </CardTrack>
      </section>
    </div>
  );
}
