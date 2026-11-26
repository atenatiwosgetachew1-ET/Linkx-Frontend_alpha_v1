// The system panel's charts: plain SVG/HTML, drawn only from the figures a
// card already shows. One form per kind of figure:
//   SlotRing  places against a limit (sessions, seats) → a ring of one arc per
//             place, the taken ones in the colour of what took them
//   SeatMap   seats of a shared pool (unattended runs)   → one seat each, yours
//             marked, the others' taken ones, the free ones open
//   RadialBars stages of one flow (STR alerts)          → concentric arcs, one per
//             stage, as long as its count
//   Ring      a share of a whole (users)               → a dial with the share
//   Trend     counts by day                            → a sparkline of the day's total
//   Line      a measured curve                         → line, with a threshold
//   Lollipops one value per item, in order             → stems with a head
// Every mark answers the pointer and keyboard focus with a tooltip; the same
// figures are in each chart's aria-label. Colours:
// --central-dash-chart-1, 2, 3, 5 name categories; 4 (red) only says failed.
import React, { useState } from 'react';
import { createPortal } from 'react-dom';

const total = (items) => items.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
const shown = (value) => Number(value || 0).toLocaleString();
const said = (label, items) => `${label}: ${items.map((part) => `${part.label} ${shown(part.value)}`).join(', ')}`;

// One tooltip per chart, drawn on the page itself so no card or scrolling row
// cuts it. `tipOf({ title, rows: [{ label, value, tone? }] })` gives a mark its
// handlers; `tip` is the tooltip to render.
const TIP_HALF = 96;
function useTip() {
  const [at, setAt] = useState(null);
  const place = (x, y, content) => setAt({ x: Math.max(TIP_HALF, Math.min((typeof window === 'undefined' ? x : window.innerWidth) - TIP_HALF, x)), y, content });
  const hide = () => setAt(null);
  const tipOf = (content) => ({
    onPointerEnter: (event) => place(event.clientX, event.clientY, content),
    onPointerMove: (event) => place(event.clientX, event.clientY, content),
    onPointerLeave: hide,
    onFocus: (event) => {
      const box = event.currentTarget.getBoundingClientRect();
      place(box.left + box.width / 2, box.top, content);
    },
    onBlur: hide,
    tabIndex: 0,
    role: 'img',
    'aria-label': `${content.title}: ${content.rows.map((row) => `${row.value} ${row.label}`).join(', ')}`,
  });
  const tip = at && typeof document !== 'undefined' ? createPortal(
    <div className="workspace_dash_tip" role="tooltip" style={{ left: at.x, top: at.y }}>
      <strong>{at.content.title}</strong>
      {at.content.rows.map((row) => (
        <span key={row.label}>
          {row.tone ? <i className={`is-tone-${row.tone}`} aria-hidden="true" /> : null}
          <b>{row.value}</b>
          {row.label}
        </span>
      ))}
    </div>,
    document.body,
  ) : null;
  return { tipOf, place, hide, tip };
}

// A whole split into parts, as a ring: [{ label, value, tone: 1..5 }]. With
// `total`, the ring is that limit and what is left of it stays open, named
// `rest`. `half` draws it as a dial (for one figure against a limit).
// `centerValue` and `center` stand in the middle. `legend={false}` when the
// card's own rows already name the parts.
export function Ring({ label, segments = [], total: limit, rest = 'Free', half = false, centerValue, center = '', legend = true }) {
  const { tipOf, tip } = useTip();
  const used = total(segments);
  const whole = Math.max(Number(limit) || 0, used);
  const left = whole - used;
  const share = (value) => (whole > 0 ? `${Math.round((value / whole) * 100)}%` : '0%');
  const tipFor = (name, value, tone) => tipOf({ title: name, rows: [{ label: `of ${shown(whole)} (${share(value)})`, value: shown(value), tone }] });
  const parts = [
    ...segments.filter((part) => part.value > 0).map((part) => ({ ...part, tone: part.tone || 1 })),
    ...(left > 0 ? [{ label: rest, value: left, open: true }] : []),
  ];
  const gap = parts.length > 1 ? 1.4 : 0;
  // One path length of 100 for either shape, so a part's share is its length.
  const shape = half
    ? { d: 'M 12,56 A 38,38 0 0 1 88,56' }
    : { d: 'M 50,12 A 38,38 0 1 1 49.99,12' };
  let offset = half ? 0 : gap / 2;
  return (
    <figure className={`workspace_dash_chart is-ring${half ? ' is-half' : ''}${legend ? '' : ' is-bare'}`} aria-label={said(label, segments)}>
      <svg viewBox={half ? '0 0 100 62' : '0 0 100 100'} focusable="false">
        <path className="workspace_dash_chart_track" pathLength="100" {...shape} />
        {parts.map((part) => {
          const size = (part.value / whole) * 100;
          const drawn = Math.max(0.6, size - gap);
          const arc = (
            <path
              key={part.label}
              className={`workspace_dash_chart_arc${part.open ? ' is-rest' : ` is-tone-${part.tone}`}`}
              pathLength="100"
              strokeDasharray={`${drawn} ${100 - drawn}`}
              strokeDashoffset={-offset}
              {...shape}
              {...tipFor(part.label, part.value, part.open ? undefined : part.tone)}
            />
          );
          offset += size;
          return arc;
        })}
        <text className="workspace_dash_chart_total" x="50" y={half ? 50 : 53}>{centerValue ?? shown(used)}</text>
        {center ? <text className="workspace_dash_chart_center" x="50" y={half ? 61 : 66}>{center}</text> : null}
      </svg>
      {legend ? <Legend items={limit === undefined ? segments : [...segments, { label: rest, value: left, rest: true }]} /> : null}
      {tip}
    </figure>
  );
}

// Counts by day as one trend line: [{ label, title?, values: [a, b] }] by
// `series`; the line is the day's total, a day where the second series (the
// stopped or failed) has any is marked. The pointer picks the nearest day.
export function Trend({ label, days = [], series = [], caption = '' }) {
  const { tipOf, place, hide, tip } = useTip();
  const [picked, setPicked] = useState(null);
  const width = 196;
  const height = 34;
  const top = 10;
  const pad = 8;
  const sums = days.map((day) => day.values.reduce((sum, value) => sum + value, 0));
  const max = Math.max(1, ...sums);
  const step = days.length > 1 ? (width - pad * 2) / (days.length - 1) : 0;
  const at = (index) => [days.length > 1 ? pad + index * step : width / 2, top + height - (sums[index] / max) * height];
  const path = days.map((_, index) => `${index ? 'L' : 'M'}${at(index).map((value) => value.toFixed(1)).join(',')}`).join(' ');
  const content = (index) => ({ title: days[index].title || days[index].label, rows: days[index].values.map((value, part) => ({ label: series[part]?.label || '', value: shown(value), tone: series[part]?.tone || part + 1 })) });
  const empty = sums.every((sum) => !sum);
  const last = days.length - 1;
  const onMove = (event) => {
    if (!days.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / Math.max(1, box.width)) * width;
    const index = Math.max(0, Math.min(last, step ? Math.round((x - pad) / step) : 0));
    setPicked(index);
    const [px, py] = at(index);
    place(box.left + (px / width) * box.width, box.top + (py / (top + height + 15)) * box.height, content(index));
  };
  const onLeave = () => { setPicked(null); hide(); };
  return (
    <figure className="workspace_dash_chart is-trend" aria-label={`${label}: ${days.map((day) => `${day.label} ${day.values.map((value, index) => `${shown(value)} ${series[index]?.label || ''}`).join(', ')}`).join('; ')}`}>
      <svg viewBox={`0 0 ${width} ${top + height + 15}`} focusable="false" onPointerMove={onMove} onPointerLeave={onLeave}>
        <line className="workspace_dash_chart_axis" x1="0" x2={width} y1={top + height} y2={top + height} />
        {picked !== null ? <line className="workspace_dash_chart_cross" x1={at(picked)[0]} x2={at(picked)[0]} y1={top} y2={top + height} /> : null}
        {days.length > 1 && !empty ? <path className="workspace_dash_chart_area" d={`${path} L${at(last)[0].toFixed(1)},${top + height} L${at(0)[0].toFixed(1)},${top + height} Z`} /> : null}
        {days.length && !empty ? <path className="workspace_dash_chart_line" d={path} /> : null}
        {days.map((day, index) => {
          const [x, y] = at(index);
          const marked = day.values[1] > 0;
          const shownDot = marked || index === last || picked === index;
          const { onPointerEnter: _enter, onPointerMove: _move, onPointerLeave: _leave, ...focus } = tipOf(content(index));
          return (
            <circle
              key={`${day.label}-${index}`}
              className={`workspace_dash_chart_dot${marked ? ' is-low' : ''}${picked === index ? ' is-picked' : ''}${shownDot && !empty ? '' : ' is-quiet'}`}
              cx={x}
              cy={y}
              r="3.5"
              {...focus}
            />
          );
        })}
        {!empty && days.length ? <text className="workspace_dash_chart_value" x={Math.min(width - 6, at(last)[0])} y={Math.max(9, at(last)[1] - 6)}>{shown(sums[last])}</text> : null}
        {days.length ? <text className="workspace_dash_chart_tick is-start" x="0" y={top + height + 12}>{days[0].label}</text> : null}
        {days.length > 1 ? <text className="workspace_dash_chart_tick is-end" x={width} y={top + height + 12}>Today</text> : null}
        {empty ? <text className="workspace_dash_chart_empty" x={width / 2} y={top + height / 2}>None in these days</text> : null}
      </svg>
      {days.some((day) => day.values[1] > 0) ? <Legend items={[{ label: `Day with ${String(series[1]?.label || 'stopped').toLowerCase()}`, tone: series[1]?.tone || 4 }]} /> : null}
      {caption ? <figcaption className="workspace_dash_chart_caption">{caption}</figcaption> : null}
      {tip}
    </figure>
  );
}

// A measured line: [{ x, y, low? }] (x labels), with a dashed `mark` level.
// The pointer picks the nearest point; each point also takes keyboard focus.
export function Line({ label, points = [], mark, markLabel, unit = '', xNoun = '', empty = '' }) {
  const { tipOf, place, hide, tip } = useTip();
  const [picked, setPicked] = useState(null);
  const width = 196;
  const height = 40;
  const pad = 6;
  const max = Math.max(1, mark || 0, ...points.map((point) => point.y)) * 1.1;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const at = (point, index) => [points.length > 1 ? pad + index * step : width / 2, height - (point.y / max) * height];
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${at(point, index).map((value) => value.toFixed(1)).join(',')}`).join(' ');
  const content = (point) => ({ title: `${point.x}${xNoun}`, rows: [{ label: unit.trim(), value: shown(Math.round(point.y)), tone: point.low ? 4 : 1 }] });
  const onMove = (event) => {
    if (!points.length) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / Math.max(1, box.width)) * width;
    const index = Math.max(0, Math.min(points.length - 1, step ? Math.round((x - pad) / step) : 0));
    setPicked(index);
    const [px, py] = at(points[index], index);
    place(box.left + (px / width) * box.width, box.top + (py / (height + 16)) * box.height, content(points[index]));
  };
  const onLeave = () => { setPicked(null); hide(); };
  return (
    <figure className="workspace_dash_chart is-line" aria-label={`${label}: ${points.map((point) => `${point.x} ${shown(Math.round(point.y))}${unit}`).join(', ')}`}>
      <svg viewBox={`0 0 ${width} ${height + 16}`} focusable="false" onPointerMove={onMove} onPointerLeave={onLeave}>
        <line className="workspace_dash_chart_axis" x1="0" x2={width} y1={height} y2={height} />
        {mark ? <line className="workspace_dash_chart_mark" x1="0" x2={width} y1={height - (mark / max) * height} y2={height - (mark / max) * height} /> : null}
        {picked !== null && points[picked] ? <line className="workspace_dash_chart_cross" x1={at(points[picked], picked)[0]} x2={at(points[picked], picked)[0]} y1="0" y2={height} /> : null}
        {points.length > 1 ? <path className="workspace_dash_chart_area" d={`${path} L${at(points[points.length - 1], points.length - 1)[0].toFixed(1)},${height} L${at(points[0], 0)[0].toFixed(1)},${height} Z`} /> : null}
        {points.length ? <path className="workspace_dash_chart_line" d={path} /> : null}
        {!points.length && empty ? <text className="workspace_dash_chart_empty" x={width / 2} y={height / 2}>{empty}</text> : null}
        {points.map((point, index) => {
          const [x, y] = at(point, index);
          const { onPointerEnter: _enter, onPointerMove: _move, onPointerLeave: _leave, ...focus } = tipOf(content(point));
          return (
            <g key={point.x}>
              <circle className={`workspace_dash_chart_dot${point.low ? ' is-low' : ''}${picked === index ? ' is-picked' : ''}`} cx={x} cy={y} r="3.5" {...focus} />
              <text className="workspace_dash_chart_tick" x={Math.min(width - 12, Math.max(12, x))} y={height + 13}>{point.x}</text>
            </g>
          );
        })}
      </svg>
      {mark && points.length ? <figcaption className="workspace_dash_chart_caption">Dashed: {markLabel}</figcaption> : null}
      {tip}
    </figure>
  );
}

// Places against a limit, one arc each: `total` places, the taken ones
// coloured by what took them ([{ label, value, tone }]), the free ones left
// as track. Past 12 places the arcs would be slivers: it is a ring then.
const SLOT_MAX = 12;
export function SlotRing({ label, segments = [], total: places = 0, rest = 'Free', center = '' }) {
  const { tipOf, tip } = useTip();
  const used = total(segments);
  const count = Math.max(Math.round(Number(places) || 0), used);
  if (count > SLOT_MAX || count === 0) return <Ring label={label} segments={segments} total={places} rest={rest} centerValue={`${shown(used)}`} center={center} legend={false} />;
  const owners = segments.flatMap((part) => Array.from({ length: Math.max(0, Math.round(Number(part.value) || 0)) }, () => part));
  const gap = count > 1 ? 4 : 0;
  const each = 100 / count;
  const shape = { d: 'M 50,12 A 38,38 0 1 1 49.99,12' };
  return (
    <figure className="workspace_dash_chart is-ring is-bare" aria-label={said(label, segments)}>
      <svg viewBox="0 0 100 100" focusable="false">
        {Array.from({ length: count }, (_, index) => {
          const owner = owners[index];
          const drawn = Math.max(1, each - gap);
          return (
            <path
              key={index}
              className={`workspace_dash_chart_arc is-slot${owner ? ` is-tone-${owner.tone || 1}` : ' is-free'}`}
              pathLength="100"
              strokeDasharray={`${drawn} ${100 - drawn}`}
              strokeDashoffset={-(index * each + gap / 2)}
              {...shape}
              {...tipOf({ title: `Place ${index + 1} of ${count}`, rows: [{ label: owner ? owner.label : rest, value: owner ? 'Taken' : 'Open', tone: owner ? owner.tone || 1 : undefined }] })}
            />
          );
        })}
        <text className="workspace_dash_chart_total" x="50" y="53">{shown(used)}<tspan className="workspace_dash_chart_of" dx="1">/{shown(count)}</tspan></text>
        {center ? <text className="workspace_dash_chart_center" x="50" y="66">{center}</text> : null}
      </svg>
      {tip}
    </figure>
  );
}

// Seats of a shared pool, one each, in rows of up to 8: `total` seats, `taken`
// of them in use, `mine` (0 or 1) of those yours, shown first. Past 40 seats
// one mark stands for several and the caption says how many.
const SEATS_SHOWN = 40;
export function SeatMap({ label, total: seats = 0, taken = 0, mine = 0, mineLabel = 'Your run' }) {
  const { tipOf, tip } = useTip();
  const count = Math.max(0, Math.round(Number(seats) || 0));
  const inUse = Math.min(count, Math.max(0, Math.round(Number(taken) || 0)));
  const yours = Math.min(inUse, mine ? 1 : 0);
  const per = Math.max(1, Math.ceil(count / SEATS_SHOWN));
  const marks = Math.ceil(count / per);
  const kindOf = (index) => {
    const seat = index * per;
    if (seat < yours) return 'mine';
    if (seat < inUse) return 'taken';
    return 'free';
  };
  const names = { mine: `In use: ${mineLabel}`, taken: 'In use by someone else', free: 'Free' };
  const parts = [
    { label: 'Yours', value: yours, tone: 1 },
    { label: 'Others', value: inUse - yours, tone: 2 },
    { label: 'Free', value: count - inUse, rest: true },
  ];
  return (
    <figure className="workspace_dash_chart is-seats" aria-label={said(label, parts)}>
      <div className="workspace_dash_seats" style={{ '--dash-seat-columns': Math.min(8, Math.max(marks, 1)) }}>
        {Array.from({ length: marks }, (_, index) => {
          const kind = kindOf(index);
          const first = index * per + 1;
          const last = Math.min(count, first + per - 1);
          return (
            <i
              key={index}
              className={`workspace_dash_seat is-${kind}${kind === 'mine' ? ' is-tone-1' : kind === 'taken' ? ' is-tone-2' : ''}`}
              {...tipOf({ title: per > 1 ? `Seats ${first}–${last} of ${count}` : `Seat ${first} of ${count}`, rows: [{ label: names[kind], value: kind === 'free' ? 'Open' : 'Taken', tone: kind === 'mine' ? 1 : kind === 'taken' ? 2 : undefined }] })}
            />
          );
        })}
      </div>
      <Legend items={parts} />
      {per > 1 ? <figcaption className="workspace_dash_chart_caption">Each seat shown: {shown(per)} seats</figcaption> : null}
      {tip}
    </figure>
  );
}

// Stages of one flow as concentric arcs (three quarters round at most), the
// outermost first, each as long as its count against the largest; the
// card's tiles name them, with the same colours. [{ label, value, tone }]
export function RadialBars({ label, stages = [] }) {
  const { tipOf, tip } = useTip();
  const max = Math.max(1, ...stages.map((stage) => Number(stage.value) || 0));
  const sum = total(stages);
  const sweep = 75; // of 100: three quarters of a turn
  return (
    <figure className="workspace_dash_chart is-radial" aria-label={said(label, stages)}>
      <svg viewBox="0 0 100 100" focusable="false">
        {stages.map((stage, index) => {
          const radius = 43 - index * 9.5;
          const d = `M 50,${50 - radius} A ${radius},${radius} 0 1 1 ${50 - radius},50`;
          const value = Number(stage.value) || 0;
          const length = value ? Math.max(2, (value / max) * sweep) : 0;
          return (
            <g key={stage.label}>
              <path className="workspace_dash_chart_track is-radial" d={d} />
              {length ? (
                <path
                  className={`workspace_dash_chart_arc is-radial is-tone-${stage.tone || 1}`}
                  d={d}
                  pathLength={sweep}
                  strokeDasharray={`${length} ${sweep}`}
                  {...tipOf({ title: stage.label, rows: [{ label: sum ? `of ${shown(sum)} (${Math.round((value / sum) * 100)}%)` : '', value: shown(value), tone: stage.tone || 1 }] })}
                />
              ) : (
                <path className="workspace_dash_chart_arc is-radial is-rest" d={d} {...tipOf({ title: stage.label, rows: [{ label: '', value: 'None' }] })} />
              )}
            </g>
          );
        })}
        <text className="workspace_dash_chart_total is-small" x="50" y="54">{shown(sum)}</text>
      </svg>
      {tip}
    </figure>
  );
}

// One value per item, in order, as stems with a head: [{ label, value, text?,
// tone }]. `legend`: a key only when a second colour is in it.
export function Lollipops({ label, items = [], unit = '', legend = [] }) {
  const { tipOf, tip } = useTip();
  const width = 196;
  const height = 44;
  const top = 5;
  const max = Math.max(1, ...items.map((item) => item.value));
  const slot = width / Math.max(1, items.length);
  return (
    <figure className="workspace_dash_chart is-lollipops" aria-label={`${label}: ${items.map((item) => `${item.label} ${item.text || `${shown(item.value)}${unit}`}`).join(', ')}`}>
      <svg viewBox={`0 0 ${width} ${top + height + 2}`} focusable="false">
        <line className="workspace_dash_chart_axis" x1="0" x2={width} y1={top + height} y2={top + height} />
        {items.map((item, index) => {
          const x = index * slot + slot / 2;
          const y = top + height - Math.max(3, (item.value / max) * height);
          return (
            <g key={`${item.label}-${index}`} className={`workspace_dash_chart_hit is-tone-${item.tone || 1}`} {...tipOf({ title: item.label, rows: [{ label: '', value: item.text || `${shown(item.value)}${unit}`, tone: item.tone || 1 }] })}>
              <rect className="workspace_dash_chart_band" x={index * slot} y="0" width={slot} height={top + height} />
              <line className="workspace_dash_chart_stem" x1={x} x2={x} y1={top + height} y2={y} />
              <circle className="workspace_dash_chart_head" cx={x} cy={y} r="3" />
            </g>
          );
        })}
        {!items.length ? <text className="workspace_dash_chart_empty" x={width / 2} y={top + height / 2}>No runs yet</text> : null}
      </svg>
      <Legend items={legend} />
      {tip}
    </figure>
  );
}

function Legend({ items }) {
  if (!items.length) return null;
  return (
    <figcaption className="workspace_dash_legend">
      {items.map((item) => (
        <span key={item.label}>
          <i className={item.rest ? 'is-rest' : `is-tone-${item.tone || 1}`} aria-hidden="true" />
          {item.label}{item.value !== undefined ? <b>{shown(item.value)}</b> : null}
        </span>
      ))}
    </figcaption>
  );
}
