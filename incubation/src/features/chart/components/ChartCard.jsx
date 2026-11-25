import { formatFigure } from '../../../shared/numbers/values.js';
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';

import { SCHEMA_NAMES } from '../lib/chartColors.js';
import { buildChartOption } from '../lib/chartOption.js';
import { ADVANCED_HINT } from '../lib/chartMetrics.js';
import { cardStats } from '../lib/chartStats.js';
import { cancelChartWork, scheduleChartWork } from '../lib/chartScheduler.js';
import StrokeIcon from '../../../shared/icons/StrokeIcon.jsx';
import { TOOL_ICONS } from '../../../shared/icons/windowIcons.js';

// ECharts on demand (its own chunk), loaded once for every card: a whole
// category of cards comes up at the same moment.
let enginePromise = null;
let loadedEngine = null;
const loadEngine = () => {
  enginePromise ||= import('../lib/echarts.js').then((module) => {
    loadedEngine = module.default;
    return module;
  }, (error) => {
    enginePromise = null;
    throw error;
  });
  return enginePromise;
};

// A pin's click: the zoom narrowed to about PIN_ZOOM entities around its
// entity (nothing to narrow when there are no more than that).
const PIN_ZOOM = 15;
// Where an entity sits along the zoomed axis, in percent (scatter: an axis
// from -1 to the count).
const placeOf = (index, count, form) => (form === 'scatter' ? ((index + 1) / (count + 1)) * 100 : ((index + 0.5) / count) * 100);
// index: the bar's place along the axis, of count bars.
const zoomTo = (chart, index, count, form) => {
  if (index < 0 || count <= PIN_ZOOM) return;
  const span = (PIN_ZOOM / count) * 100;
  const from = Math.min(Math.max(0, placeOf(index, count, form) - span / 2), 100 - span);
  chart.dispatchAction({ type: 'dataZoom', start: from, end: from + span });
};
// A zoom's settings without its window (start / end).
const withoutWindow = (zoom) => {
  const copy = { ...zoom };
  delete copy.start;
  delete copy.end;
  return copy;
};
// Forms whose pins sit on a zoomable axis of bars: entities, or bins.
const PIN_ZOOM_FORMS = new Set(['bar', 'dualbar', 'line', 'scatter', 'bins']);

// Charts whose zoom runs along the entities (Follow selection).
const FOLLOW_FORMS = new Set(['bar', 'dualbar', 'line', 'scatter']);
// The first zoom's window in percent, when narrowed (else none).
// Read from the zoom's own model: getOption() copies the whole option,
// every data point included, which is slow on large charts.
const zoomOf = (chart) => {
  const model = typeof chart.getModel === 'function' ? chart.getModel()?.getComponent?.('dataZoom', 0) : undefined;
  const zoom = model !== undefined ? model?.option : (typeof chart.getOption === 'function' ? chart.getOption()?.dataZoom?.[0] : null);
  if (!zoom || !Number.isFinite(zoom.start) || !Number.isFinite(zoom.end)) return null;
  return zoom.start > 0 || zoom.end < 100 ? { start: zoom.start, end: zoom.end } : null;
};

const GROUP_LABEL = { global: 'Network', node: 'Entities', edge: 'Links' };
const FORM_LABEL = { bar: 'Bars', line: 'Line', scatter: 'Scatter', dualbar: 'Series', pairs: 'Scatter', figures: 'Figures', time: 'Over time', bins: 'Distribution', heatmap: 'Heat matrix' };

// One chart card (production charts_adjuster.js createMetricChart): the
// metric's name, a colour toggle (off: grey by value) and schema, full
// screen / return and close; the chart with a tooltip and zoom. A click on a
// bar or point selects that entity on the graph (Ctrl / Cmd / Shift adds),
// a double click focuses it there (analyst decision 2026-11-18: selection
// both ways); a link metric's bars select links.
//
// selectedColors: the graph's selected items of the kind this card measures,
// in their own colours ({ id: colour }); card: { id, metric, colorful,
// schema }; state: { status: 'loading' |
// 'ready' | 'error', result, error }; onReady(id, chart | null) hands the
// ECharts instance up for snapshots and printing.

// tone: the card's colour (from the active schema, a different one per
// card), washing its header from the top-left corner.
function ChartCard({
  card, metric, state, names, selectedColors, theme, full, follow = false, histogramOptions, tone, onChange, onClose, onFull, onSelect, onFocus, onReady,
}) {
  // A wheel over the chart without Ctrl scrolls the board; a hint says
  // how to zoom (subtle, fading). ECharts' zoom controller cancels every
  // wheel over a chart (then checks for Ctrl), so a wheel without Ctrl is
  // stopped above the chart, before ECharts sees it: the board scrolls.
  const bodyRef = useRef(null);
  const [zoomHint, setZoomHint] = useState(false);
  const hintTimer = useRef(null);
  useEffect(() => () => clearTimeout(hintTimer.current), []);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return undefined;
    const onWheel = (event) => {
      if (event.ctrlKey) return;
      event.stopPropagation();
      if (!body.querySelector('.chart_card_box:not([hidden])')) return;
      setZoomHint(true);
      clearTimeout(hintTimer.current);
      hintTimer.current = setTimeout(() => setZoomHint(false), 1400);
    };
    // Capture, passive: first, and the scroll itself is left alone.
    body.addEventListener('wheel', onWheel, { capture: true, passive: true });
    body.addEventListener('mousewheel', onWheel, { capture: true, passive: true });
    return () => {
      body.removeEventListener('wheel', onWheel, { capture: true });
      body.removeEventListener('mousewheel', onWheel, { capture: true });
    };
  }, []);
  const boxRef = useRef(null);
  const chartRef = useRef(null);
  const idsRef = useRef([]);
  const membersRef = useRef(null);
  const formRef = useRef('');
  formRef.current = state?.result?.form || '';
  const handlersRef = useRef({ onSelect, onFocus });
  // Node or link metric: what a click selects, which names and colours apply.
  const kind = state?.result?.kind === 'edge' ? 'edge' : 'node';
  const kindRef = useRef(kind);
  kindRef.current = kind;
  handlersRef.current = { onSelect, onFocus };
  // Loaded already (another card, an earlier mount): drawn at once.
  const [engine, setEngine] = useState(() => loadedEngine);
  const [engineError, setEngineError] = useState('');

  // ECharts on demand (its own chunk).
  useEffect(() => {
    if (engine) return undefined;
    let alive = true;
    loadEngine()
      .then((module) => { if (alive) setEngine(() => module.default); })
      .catch((error) => { if (alive) setEngineError(error?.message || 'The chart library could not be loaded.'); });
    return () => { alive = false; };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = state?.status === 'ready' && state.result;
  // Global figures are a list, not a chart.
  const isFigures = Boolean(ready) && state.result.form === 'figures';
  const hasResult = Boolean(ready);
  useEffect(() => {
    if (!engine || !hasResult || isFigures || !boxRef.current) return undefined;
    const chart = engine.init(boxRef.current, null, { renderer: 'canvas' });
    chartRef.current = chart;
    chart.on('click', (params) => {
      // A pin: zoom to its entity (a few of its neighbours either side).
      if (params.componentType === 'markPoint') {
        if (!PIN_ZOOM_FORMS.has(formRef.current)) return;
        // Bins: the pin's bar by its place (no entity behind it).
        if (formRef.current === 'bins') zoomTo(chart, params.data?.coord?.[0] ?? -1, membersRef.current?.length || 0, 'bins');
        else zoomTo(chart, idsRef.current.indexOf(params.data?.entity), idsRef.current.length, formRef.current);
        return;
      }
      const event = params.event?.event || {};
      // A bin or a cell: all that it holds.
      const members = membersRef.current?.[params.dataIndex];
      if (members) {
        if (members.length) handlersRef.current.onSelect?.(members, Boolean(event.ctrlKey || event.metaKey || event.shiftKey), kindRef.current);
        return;
      }
      const id = idsRef.current[params.dataIndex];
      if (id === undefined) return;
      handlersRef.current.onSelect?.(id, Boolean(event.ctrlKey || event.metaKey || event.shiftKey), kindRef.current);
    });
    chart.on('dblclick', (params) => {
      const members = membersRef.current?.[params.dataIndex];
      if (members) {
        if (members.length) handlersRef.current.onFocus?.(members, kindRef.current);
        return;
      }
      const id = idsRef.current[params.dataIndex];
      if (id !== undefined) handlersRef.current.onFocus?.(id, kindRef.current);
    });
    onReady?.(card.id, chart);
    // Not while hidden (no size: a docked window kept mounted); on showing
    // again it fits its box.
    // Resizes go through the chart scheduler too: a board shown again
    // resizes every card at once.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      if (!boxRef.current?.offsetWidth) return;
      scheduleChartWork(`${card.id}:resize`, () => { if (!chart.isDisposed?.() && boxRef.current?.offsetWidth) chart.resize(); });
    });
    observer?.observe(boxRef.current);
    return () => {
      observer?.disconnect();
      onReady?.(card.id, null);
      chart.dispose();
      chartRef.current = null;
    };
    // One instance per card while it has a result (a new result updates it).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, hasResult, isFigures, card.id]);

  const built = useMemo(
    () => (ready && !isFigures ? buildChartOption(state.result, { names: names[kind] || {}, colorful: card.colorful, schema: card.schema, selectedColors: selectedColors || {}, theme }) : null),
    [card.colorful, card.schema, isFigures, kind, names, ready, selectedColors, state, theme],
  );
  // The chart's zoom is kept when only its colours change (a selection, a
  // schema): the option is replaced whole, which would reset it. With
  // Follow selection, a new selection on the graph out of the zoom's sight
  // is brought into it (the zoom's width kept), as the Table window scrolls
  // to it.
  const idsKeyRef = useRef('');
  const restoredRef = useRef(state?.status === 'ready');
  const selectionKeyRef = useRef('');
  useEffect(() => {
    if (!chartRef.current || !built) return undefined;
    // Drawn in the next frames with the other cards' updates, within a
    // frame budget (lib/chartScheduler.js); a newer update replaces it.
    scheduleChartWork(card.id, () => draw(built));
    return undefined;
    // The selection's colours are part of `built`; Follow acts on the next
    // selection after it is turned on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built, engine]);
  useEffect(() => () => {
    cancelChartWork(card.id);
    cancelChartWork(`${card.id}:resize`);
  }, [card.id]);
  const draw = (next) => {
    const chart = chartRef.current;
    if (!chart || chart.isDisposed?.()) return;
    const built = next;
    // Bins and cells: their labels and counts stand for the data.
    const idsKey = built.members ? `bins\u0001${JSON.stringify(built.option.xAxis?.data || [])}\u0001${built.members.map((list) => list.length).join(',')}` : built.ids.join('\u0001');
    const sameData = idsKey === idsKeyRef.current;
    const zoom = sameData ? zoomOf(chart) : null;
    idsRef.current = built.ids;
    membersRef.current = built.members || null;
    idsKeyRef.current = idsKey;
    // Shown again with a kept result (a docked tab switch): drawn as it
    // was, without the entry animation. The same entities recoloured (a
    // selection, a schema): merged into the chart, which updates in place
    // rather than drawing itself anew; new data replaces the option whole.
    const restoring = restoredRef.current;
    restoredRef.current = false;
    // A recolouring (a click selecting on the graph): no update animation,
    // the bars only change colour, without moving.
    // Merged, the zoom keeps where the analyst left it (the opening zoom of
    // a dense chart is for its first drawing only).
    const merged = () => ({ ...built.option, animationDurationUpdate: 0, ...(Array.isArray(built.option.dataZoom) ? { dataZoom: built.option.dataZoom.map(withoutWindow) } : {}) });
    chart.setOption(restoring ? { ...built.option, animation: false } : sameData ? merged() : built.option, !sameData);
    // The zoom put back only if the update moved it.
    const after = zoom ? zoomOf(chart) : null;
    if (zoom && (!after || after.start !== zoom.start || after.end !== zoom.end)) chart.dispatchAction({ type: 'dataZoom', start: zoom.start, end: zoom.end });
    const selected = Object.keys(selectedColors || {});
    const selectionKey = selected.join('\u0001');
    const newSelection = selectionKey !== selectionKeyRef.current;
    selectionKeyRef.current = selectionKey;
    if (!follow || !newSelection || !selected.length || !FOLLOW_FORMS.has(state.result.form)) return;
    const chosen = new Set(selected);
    const index = built.ids.findIndex((id) => chosen.has(id));
    if (index < 0) return;
    // The zoom as it is now: kept from before, else the chart's opening zoom.
    const opening = built.option.dataZoom?.[0];
    const { start, end } = zoom || (Number.isFinite(opening?.start) ? { start: opening.start, end: opening.end } : { start: 0, end: 100 });
    const at = placeOf(index, built.ids.length, state.result.form);
    if (at >= start && at <= end) return;
    const span = end - start;
    const from = Math.min(Math.max(0, at - span / 2), 100 - span);
    chart.dispatchAction({ type: 'dataZoom', start: from, end: from + span });
  };
  // Full screen and back: the box changes size.
  useEffect(() => { chartRef.current?.resize(); }, [full]);

  let status = '';
  if (engineError && !isFigures) status = engineError;
  else if (state?.status === 'error') status = state.error;
  else if (!ready) status = 'Computing…';
  else if (built?.empty) status = 'Nothing to chart in this scope.';

  // With what is selected on the graph first (its value, rank, name).
  const stats = useMemo(() => (ready ? cardStats(state.result, names[kind] || {}, Object.keys(selectedColors || {})) : []), [kind, names, ready, selectedColors, state]);
  const footnote = (ready && state.result.note) || metric.hint || '';

  return (
    <article className={`chart_card is-${metric.group}${full ? ' is-full' : ''}`} aria-label={metric.label} style={tone ? { '--card-tone': tone } : undefined}>
      <header className="chart_card_header">
        <div className="chart_card_heading">
          <span className="chart_card_eyebrow">
            {GROUP_LABEL[metric.group]} · {FORM_LABEL[metric.form] || 'Chart'}
            {metric.advanced ? <span className="chart_advanced_tag" title={ADVANCED_HINT}>Advanced</span> : null}
          </span>
          <h3 title={metric.hint || ''}>{metric.label}</h3>
        </div>
        <div className="chart_card_controls">
          {histogramOptions ? (
            <select
              className="chart_select chart_card_param"
              aria-label={`${metric.label}: count by`}
              title="Count by"
              value={`${card.param?.subject}:${card.param?.key}`}
              onChange={(event) => {
                const [subject, ...rest] = event.target.value.split(':');
                onChange(card.id, { param: { subject, key: rest.join(':') } });
              }}
            >
              {['edge', 'node'].map((subject) => (
                <optgroup key={subject} label={subject === 'edge' ? 'Links by' : 'Entities by'}>
                  {histogramOptions.filter((option) => option.subject === subject).map((option) => (
                    <option key={`${subject}:${option.key}`} value={`${subject}:${option.key}`}>{option.label}</option>
                  ))}
                </optgroup>
              ))}
              {/* A saved property not in this scope stays shown. */}
              {card.param && !histogramOptions.some((option) => option.subject === card.param.subject && option.key === card.param.key)
                ? <option value={`${card.param.subject}:${card.param.key}`}>{card.param.key}</option>
                : null}
            </select>
          ) : null}
          {isFigures ? null : (
            <div className="chart_card_colour">
              <label className="chart_switch linkx_tooltip_anchor" data-tooltip="Colour by the schema (off: grey by value)">
                <input type="checkbox" aria-label={`Colour ${metric.label}`} checked={card.colorful} onChange={(event) => onChange(card.id, { colorful: event.target.checked })} />
                <span aria-hidden="true" />
              </label>
              <select className="chart_select" aria-label={`Colour schema of ${metric.label}`} value={card.schema} onChange={(event) => onChange(card.id, { schema: event.target.value })}>
                {SCHEMA_NAMES.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          )}
          <div className="chart_card_actions">
            {full ? (
              <button type="button" className="chart_icon_button" aria-label="Return" title="Return (Esc)" onClick={() => onFull(null)}><StrokeIcon d={TOOL_ICONS.collapse} /></button>
            ) : (
              <>
                <button type="button" className="chart_icon_button" aria-label={`Full screen ${metric.label}`} title="Full screen" onClick={() => onFull(card.id)}><StrokeIcon d={TOOL_ICONS.expand} /></button>
                <button type="button" className="chart_icon_button is-close" aria-label={`Close ${metric.label}`} title="Close" onClick={() => onClose(card.id)}><StrokeIcon d={TOOL_ICONS.close} /></button>
              </>
            )}
          </div>
        </div>
      </header>
      {stats.length ? (
        <dl className="chart_card_stats" aria-label={`${metric.label} key figures`}>
          {stats.map((stat) => (
            <div key={stat.label} className={`chart_card_stat${stat.emphasis ? ' is-emphasis' : ''}${stat.selected ? ' is-selected' : ''}`}>
              <dt>{stat.label}</dt>
              <dd>
                {formatFigure(stat.value)}
                {stat.detail ? <span className="chart_card_stat_detail" title={stat.detail}>{stat.detail}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div ref={bodyRef} className="chart_card_body">
        {isFigures ? (
          <dl className="chart_figures">
            {state.result.items.map((item) => (
              <div key={item.label} className="chart_figure" title={item.hint || ''}>
                <dt>{item.label}</dt>
                <dd>{formatFigure(item.value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <div ref={boxRef} className="chart_card_box" hidden={Boolean(status) || isFigures} />
        {zoomHint && !status ? <span className="chart_card_zoom_hint" role="status">Hold Ctrl and scroll to zoom · Ctrl + drag to slide</span> : null}
        {status ? <p className={`chart_card_status${state?.status === 'error' || engineError ? ' is-error' : ''}`} role="status">{status}</p> : null}
      </div>
      {footnote ? <footer className="chart_card_footer" title={footnote}>{footnote}</footer> : null}
    </article>
  );
}

// Re-rendered only when its own props change (the window passes stable
// handlers): a board of cards is not redrawn for every window render.
export default memo(ChartCard);
