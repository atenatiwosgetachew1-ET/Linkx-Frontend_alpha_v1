import { colorForValue, valueRange } from './chartColors.js';

// A computed metric (chartMetrics.js) as an ECharts option, in production's
// card look (charts_adjuster.js updateChart): bars / line / dual bars over
// the entities, category labels hidden (the tooltip names them), a zoom
// slider and inside zoom; each value coloured by the card's schema (or grey
// by value), and the entities selected on the graph in their own colour.
// Entities are ordered by value, largest first (analyst-facing change: in
// production they kept the graph's order).
//
// -> { option, ids, empty } (ids[i]: the entity behind data index i, for
// clicks); members[i] for a bar or cell standing for several items (bins,
// heat matrix): a click selects them all.


// A pin over each entity selected on the graph (analyst decision
// 2026-11-18: one entity is hard to find among many bars): in its own
// colour, its tip on the bar's top or the point; a click on it zooms to it
// (ChartCard). At most PIN_MAX pins.
export const PIN_MAX = 30;
const PIN_SIZE = 26;
// Smaller on the heat matrix's cells.
const HEAT_PIN_SIZE = 18;
// calloutAt(index): the pin's label text (the entity and its values here).
const pinsOf = (ids, labels, valueAt, selectedColors, calloutAt = null) => {
  const data = [];
  for (let index = 0; index < ids.length && data.length < PIN_MAX; index += 1) {
    const id = ids[index];
    const value = valueAt(index);
    if (!selectedColors[id] || typeof value !== 'number' || !Number.isFinite(value)) continue;
    // Beside the pin, towards the middle of the chart (never off its edge).
    data.push({ name: labels[index], entity: id, coord: [index, value], value, itemStyle: { color: selectedColors[id] }, callout: calloutAt ? calloutAt(index) : labels[index], side: index < ids.length / 2 ? 'right' : 'left' });
  }
  return pinMarks(data);
};
// Pins carry a label (what the selected item measures here) while there are
// at most CALLOUT_MAX of them (analyst decision 2026-11-18: a chart says
// something about what is selected, not only about all of it).
export const CALLOUT_MAX = 3;
// A pin as ECharts takes it (the callout text and side are ours).
const plainPin = (item) => {
  const copy = { ...item };
  delete copy.callout;
  delete copy.side;
  return copy;
};
const withCallouts = (data) => (data.length > CALLOUT_MAX ? data : data.map((item) => (item.callout ? {
  ...item,
  label: {
    show: true,
    position: item.side || 'right',
    distance: 4,
    formatter: item.callout,
    color: '#ffffff',
    backgroundColor: 'rgba(19,29,41,0.92)',
    borderColor: item.itemStyle?.color || '#ffffff',
    borderWidth: 1,
    borderRadius: 3,
    padding: [3, 6],
    fontSize: 10,
    fontWeight: 600,
    lineHeight: 13,
  },
} : item)));
// Pins at given points: [{ name, entity?, coord, value, itemStyle }]. Always
// given (empty without a selection): a chart updated in place (ChartCard
// merges recolourings) drops its old pins.
const pinMarks = (data, size = PIN_SIZE) => ({
    markPoint: {
      symbol: 'pin',
      symbolSize: size,
      // The pin's tip (its bottom) on the coordinate.
      symbolOffset: [0, '-50%'],
      label: { show: false },
      itemStyle: { borderColor: '#ffffff', borderWidth: 1.2, shadowBlur: 4, shadowColor: 'rgba(0,0,0,0.35)' },
      emphasis: { scale: 1.15 },
      animation: false,
      data: withCallouts(data.slice(0, PIN_MAX)).map(plainPin),
    },
});
// A pin where there is no entity axis to zoom along (bins, cells, pairs).
const pinOnlyTooltip = (params) => `${params.marker}${params.name} <span style="opacity:.7">· selected</span>`;
// The first selected item among `members`, if any: its id and colour.
const selectedAmong = (members, selectedColors) => {
  const hit = members.find((id) => selectedColors[id]);
  return hit === undefined ? null : { id: hit, color: selectedColors[hit] };
};
// Room over the tallest bar for its pin, always kept: made only when a pin
// appeared, every chart re-laid itself out on each click (analyst report
// 2026-11-18: the charts seemed to redraw when a bar was clicked).
const withPinRoom = (grid) => ({ ...grid, top: grid.top + PIN_SIZE });
const pinTooltip = (params) => `${params.marker}${params.name} <span style="opacity:.7">· selected · click to zoom</span>`;

// Dense charts open zoomed in (analyst decision 2026-11-18): more than
// DENSE_BARS bars, and the first DENSE_BARS (the largest: entities are
// ordered largest first) fill the chart, the slider showing the rest.
export const DENSE_BARS = 60;
const openingZoom = (count) => (count > DENSE_BARS ? { start: 0, end: (DENSE_BARS / count) * 100 } : {});
const withOpeningZoom = (zooms, count) => {
  const window = openingZoom(count);
  return 'start' in window ? zooms.map((zoom) => ({ ...zoom, ...window })) : zooms;
};

// Zoom and slide inside a chart only with Ctrl held (analyst decision
// 2026-11-18): the wheel scrolls the board of cards otherwise.
export const INSIDE_ZOOM = Object.freeze({ type: 'inside', zoomOnMouseWheel: 'ctrl', moveOnMouseMove: 'ctrl', moveOnMouseWheel: false, preventDefaultMouseMove: false });

const timeOption = (result, { base, muted, colorful, schema }) => {
  const labels = (result.periods || []).map((period) => period.label);
  const lines = result.series.filter((entry) => entry.axis !== 1);
  const bars = result.series.filter((entry) => entry.axis === 1);
  const axis = { axisLabel: { color: muted }, splitLine: { lineStyle: { color: muted, opacity: 0.18 } } };
  return {
    ids: [],
    empty: !labels.length,
    option: {
      ...base,
      tooltip: { ...base.tooltip, trigger: 'axis', valueFormatter: (value) => formatValue(value) },
      legend: { top: 2, itemWidth: 14, itemHeight: 8, textStyle: { color: muted, fontSize: 10 } },
      grid: { top: 30, bottom: 30, left: 8, right: 8, containLabel: true },
      xAxis: { type: 'category', data: labels, axisLabel: { color: muted }, axisLine: { lineStyle: { color: muted } } },
      yAxis: [{ type: 'value', name: 'Measures', nameTextStyle: { color: muted }, ...axis }, { type: 'value', name: 'Links', nameTextStyle: { color: muted }, minInterval: 1, ...axis, splitLine: { show: false } }],
      series: [
        ...bars.map((entry) => ({ type: 'bar', name: entry.name, yAxisIndex: 1, data: entry.values, itemStyle: { color: muted, opacity: 0.22 }, barMaxWidth: 24 })),
        ...lines.map((entry, index) => ({
          type: 'line',
          name: entry.name,
          yAxisIndex: 0,
          data: entry.values,
          connectNulls: false,
          symbolSize: 6,
          ...(colorful ? { itemStyle: { color: colorForValue(index, [0, Math.max(1, lines.length - 1)], { colorful: true, schema }) } } : {}),
        })),
      ],
    },
  };
};

// "entities" -> "entity", "links" -> "link" (one of them).
const singular = (noun) => (noun.endsWith('ies') ? `${noun.slice(0, -3)}y` : noun.replace(/s$/, ''));

// Bins (Histogram, Degree Distribution, Community Sizes): a bar per bin,
// labelled; a bin holding something selected on the graph in its colour; a
// click selects the bin's members.
const binsOption = (result, { base, muted, colorful, schema, selectedColors, names = {} }) => {
  const bins = result.bins || [];
  const range = valueRange(bins.map((bin) => bin.value));
  const noun = (result.yName || 'items').toLowerCase();
  return {
    ids: [],
    members: bins.map((bin) => bin.members),
    empty: !bins.length,
    option: {
      ...base,
      dataZoom: bins.length > 30 ? withOpeningZoom(base.dataZoom, bins.length) : [INSIDE_ZOOM],
      tooltip: { ...base.tooltip, formatter: (params) => (params.componentType === 'markPoint' ? pinOnlyTooltip(params) : `${params.marker}${params.name} <b>${formatValue(params.value)}</b> ${noun} <span style="opacity:.7">· click to select</span>`) },
      // Room for the pins always kept (no re-layout on a selection).
      grid: { top: 18 + PIN_SIZE, bottom: bins.length > 30 ? 30 : 8, left: 8, right: 14, containLabel: true },
      xAxis: {
        type: 'category',
        data: bins.map((bin) => bin.label),
        name: result.xName || '',
        nameLocation: 'end',
        nameTextStyle: { color: muted, fontSize: 10 },
        axisLabel: { color: muted, fontSize: 10, hideOverlap: true, overflow: 'truncate', width: 80 },
        axisTick: { alignWithLabel: true },
        axisLine: { lineStyle: { color: muted } },
      },
      yAxis: {
        type: result.log ? 'log' : 'value',
        name: result.yName || '',
        nameTextStyle: { color: muted, fontSize: 10 },
        minInterval: 1,
        axisLabel: { color: muted },
        splitLine: { lineStyle: { color: muted, opacity: 0.18 } },
      },
      series: [{
        type: 'bar',
        name: result.yName || 'Count',
        barMaxWidth: 36,
        data: bins.map((bin) => {
          const hit = selectedAmong(bin.members, selectedColors);
          return { value: bin.value, name: bin.label, itemStyle: { color: hit ? hit.color : colorForValue(bin.value, range, { colorful, schema }) } };
        }),
        // A pin over each bin holding something selected.
        ...pinMarks(bins.flatMap((bin, index) => {
          const hit = selectedAmong(bin.members, selectedColors);
          return hit ? [{ name: bin.label, coord: [index, bin.value], value: bin.value, itemStyle: { color: hit.color }, callout: `${names[hit.id] ?? hit.id} \u00b7 ${bin.label} (${formatValue(bin.value)} ${bin.value === 1 ? singular(noun) : noun})`, side: index < bins.length / 2 ? 'right' : 'left' }] : [];
        })),
      }],
    },
  };
};

// Heat Matrix: weekdays down, hours across; a cell's shade by its links (the
// card's schema, else grey); a cell holding a selected link outlined in its
// colour; a click selects the cell's links.
const heatmapOption = (result, { base, muted, colorful, schema, selectedColors, theme }) => {
  const cells = result.cells || [];
  const top = Math.max(1, ...cells.map((cell) => cell.value));
  const ramp = [0, 0.25, 0.5, 0.75, 1].map((t) => colorForValue(t, [0, 1], { colorful, schema }));
  return {
    ids: [],
    members: cells.map((cell) => cell.members),
    empty: !cells.length,
    option: {
      ...base,
      dataZoom: [],
      tooltip: { ...base.tooltip, formatter: (params) => (params.componentType === 'markPoint' ? pinOnlyTooltip(params) : `${result.days[params.value[1]]} ${result.hours[params.value[0]]} <b>${formatValue(params.value[2])}</b> links <span style="opacity:.7">· click to select</span>`) },
      // Room above the first row for its pins.
      grid: { top: 8 + HEAT_PIN_SIZE, bottom: 34, left: 8, right: 10, containLabel: true },
      xAxis: { type: 'category', data: result.hours, splitArea: { show: true }, axisLabel: { color: muted, fontSize: 9, interval: result.hours.length > 12 ? 2 : 0 }, axisLine: { lineStyle: { color: muted } } },
      yAxis: { type: 'category', data: result.days, inverse: true, splitArea: { show: true }, axisLabel: { color: muted, fontSize: 10 }, axisLine: { lineStyle: { color: muted } } },
      visualMap: { type: 'continuous', min: 0, max: top, orient: 'horizontal', left: 'center', bottom: 2, itemWidth: 8, itemHeight: 90, calculable: false, textStyle: { color: muted, fontSize: 10 }, inRange: { color: ramp } },
      series: [{
        type: 'heatmap',
        name: 'Links',
        data: cells.map((cell) => {
          const hit = selectedAmong(cell.members, selectedColors);
          return { value: [cell.hour, cell.day, cell.value], ...(hit ? { itemStyle: { borderColor: hit.color, borderWidth: 2 } } : { itemStyle: { borderColor: theme.surface || 'transparent', borderWidth: 1 } }) };
        }),
        // A pin on each cell holding a selected link (its tip at the cell's middle).
        ...pinMarks(cells.flatMap((cell) => {
          const hit = selectedAmong(cell.members, selectedColors);
          return hit ? [{ name: `${result.days[cell.day]} ${result.hours[cell.hour]}`, coord: [cell.hour, cell.day], value: cell.value, itemStyle: { color: hit.color }, callout: `${result.days[cell.day]} ${result.hours[cell.hour]} \u00b7 ${formatValue(cell.value)} links`, side: cell.hour < result.hours.length / 2 ? 'right' : 'left' }] : [];
        }), HEAT_PIN_SIZE),
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: 'rgba(0,0,0,0.3)' } },
      }],
    },
  };
};

const formatValue = (value) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return Number.isInteger(value) ? value.toLocaleString('en-GB') : Number(value.toPrecision(4)).toLocaleString('en-GB', { maximumFractionDigits: 6 });
};

// The entities largest first (dual bars: by their sum; ties by id), worked
// out once per result: a recolouring (a selection, a schema) rebuilds the
// option without sorting again.
const sortedCache = new WeakMap();
const sortedIdsOf = (result) => {
  if (sortedCache.has(result)) return sortedCache.get(result);
  // The metric's own order (Flow: by in + out, not by the sum with net).
  if (Array.isArray(result.order)) {
    sortedCache.set(result, result.order);
    return result.order;
  }
  const series = result.series;
  const totals = new Map(Object.keys(series[0].values).map((id) => [id, series.reduce((sum, entry) => sum + (Number(entry.values[id]) || 0), 0)]));
  const collator = new Intl.Collator(undefined, { numeric: true });
  const ids = [...totals.keys()].sort((a, b) => totals.get(b) - totals.get(a) || collator.compare(a, b));
  sortedCache.set(result, ids);
  return ids;
};

// paper: drawn for a snap or a print (analyst decision 2026-11-18): the
// entities named along the axis (no tooltip on paper), angled, those that
// would overlap left out.
export const buildChartOption = (result, {
  names = {}, colorful = false, schema = 'Viridis', selectedColors = {}, theme = {}, paper = false,
} = {}) => {
  const text = theme.text || '#222222';
  const muted = theme.muted || '#777777';
  const line = theme.line || '#333333';
  const base = {
    animationDurationUpdate: 400,
    animationEasingUpdate: 'cubicOut',
    textStyle: { color: text },
    // Compact (analyst decision 2026-11-18): small type, tight padding, in
    // the window's colours.
    tooltip: {
      show: true,
      trigger: 'item',
      confine: true,
      padding: [3, 7],
      borderWidth: 1,
      borderColor: theme.border || 'rgba(0,0,0,0.12)',
      backgroundColor: theme.surface || 'rgba(255,255,255,0.96)',
      textStyle: { color: text, fontSize: 11, lineHeight: 15 },
      extraCssText: 'border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.14);max-width:260px;white-space:normal;',
    },
    dataZoom: [{ type: 'slider', show: true, bottom: 6, height: 14, textStyle: { color: muted, fontSize: 10 } }, INSIDE_ZOOM],
  };
  // Temporal Metrics: the measures as lines over the periods (gaps where a
  // period has nothing to measure), the period's links as bars behind them.
  if (result?.form === 'time') return timeOption(result, { base, text, muted, colorful, schema });
  if (result?.form === 'bins') return binsOption(result, { base, muted, colorful, schema, selectedColors, names });
  if (result?.form === 'heatmap') return heatmapOption(result, { base, muted, colorful, schema, selectedColors, theme });
  const series = result?.series || [];
  if (!series.length) return { option: base, ids: [], empty: true };
  const ids = sortedIdsOf(result);
  // Bars, lines and scatters along the entities open zoomed when dense.
  base.dataZoom = withOpeningZoom(base.dataZoom, ids.length);
  const empty = !ids.length;
  const labels = ids.map((id) => names[id] ?? id);
  const pointsOf = (entry) => {
    const range = valueRange(Object.values(entry.values));
    return ids.map((id, index) => {
      const value = entry.values[id];
      return {
        value,
        name: labels[index],
        itemStyle: { color: selectedColors[id] || colorForValue(value, range, { colorful, schema }) },
      };
    });
  };
  const tooltip = {
    ...base.tooltip,
    formatter: (params) => (params.componentType === 'markPoint' ? pinTooltip(params) : `${params.marker}${params.name} <span style="opacity:.7">${params.seriesName}</span> <b>${formatValue(params.value)}</b>`),
  };
  // Bars and lines: the pin on the first series on the main axis, at the
  // entity's highest value on that axis (two series side by side).
  const pinSeries = Math.max(0, series.findIndex((entry) => entry.axis !== 1));
  const pinAxis = series[pinSeries].axis === 1;
  const pins = pinsOf(ids, labels, (index) => {
    const values = series
      .filter((entry) => (entry.axis === 1) === pinAxis)
      .map((entry) => entry.values[ids[index]])
      .filter((value) => typeof value === 'number' && Number.isFinite(value));
    return values.length ? Math.max(...values) : null;
  }, selectedColors, (index) => {
    const id = ids[index];
    const parts = series.map((entry) => (series.length > 1 ? `${entry.name} ${formatValue(entry.values[id])}` : formatValue(entry.values[id])));
    return `${labels[index]} \u00b7 ${parts.join(' \u00b7 ')}`;
  });
  const axes = {
    grid: { top: result.form === 'dualbar' ? 30 : 14, bottom: 30, left: 8, right: 14, containLabel: true },
    xAxis: {
      type: 'category',
      data: labels,
      axisLabel: paper ? { show: true, rotate: 40, fontSize: 8, color: muted, hideOverlap: true, interval: 'auto', width: 64, overflow: 'truncate' } : { show: false },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: muted } },
    },
    yAxis: { type: 'value', axisLabel: { color: muted }, splitLine: { lineStyle: { color: muted, opacity: 0.18 } } },
  };
  // Assortativity: each link a point at its two ends' degrees.
  if (result.form === 'pairs') {
    const values = series[0].values;
    const keys = Object.keys(values);
    const range = valueRange(keys.map((key) => values[key][0] + values[key][1]));
    return {
      ids: keys,
      empty: !keys.length,
      option: {
        ...base,
        grid: { top: 14 + PIN_SIZE, bottom: 34, left: 8, right: 14, containLabel: true },
        xAxis: { type: 'value', name: 'Degree (one end)', nameLocation: 'middle', nameGap: 26, minInterval: 1, axisLabel: { color: muted }, nameTextStyle: { color: muted }, splitLine: { lineStyle: { color: muted, opacity: 0.18 } } },
        yAxis: { type: 'value', name: 'Degree (other end)', nameLocation: 'middle', nameGap: 30, minInterval: 1, axisLabel: { color: muted }, nameTextStyle: { color: muted }, splitLine: { lineStyle: { color: muted, opacity: 0.18 } } },
        dataZoom: [INSIDE_ZOOM],
        tooltip: { ...base.tooltip, formatter: (params) => (params.componentType === 'markPoint' ? pinOnlyTooltip(params) : `${params.marker}${params.name} <span style="opacity:.7">degrees</span> <b>${params.value[0]}</b> · <b>${params.value[1]}</b>`) },
        series: [{
          type: 'scatter',
          name: series[0].name,
          symbolSize: 9,
          data: keys.map((key) => ({
            name: names[key] ?? key,
            value: values[key],
            itemStyle: { color: selectedColors[key] || colorForValue(values[key][0] + values[key][1], range, { colorful, schema }) },
          })),
          // A pin on each selected link's point.
          ...pinMarks(keys.filter((key) => selectedColors[key]).map((key) => ({ name: names[key] ?? key, coord: values[key], value: values[key][1], itemStyle: { color: selectedColors[key] }, callout: `${names[key] ?? key} \u00b7 degrees ${values[key][0]} \u00b7 ${values[key][1]}` }))),
        }],
      },
    };
  }
  // Production's scatter (Clustering, Constraint): each entity a point, in
  // order along a hidden axis.
  if (result.form === 'scatter') {
    const points = pointsOf(series[0]).map((point, index) => ({ ...point, value: [index, point.value] }));
    return {
      ids,
      empty,
      option: {
        ...base,
        ...axes,
        xAxis: { type: 'value', show: false, min: -1, max: Math.max(1, ids.length) },
        grid: withPinRoom(axes.grid),
        tooltip: { ...tooltip, formatter: (params) => (params.componentType === 'markPoint' ? pinTooltip(params) : `${params.marker}${params.name} <span style="opacity:.7">${params.seriesName}</span> <b>${formatValue(params.value?.[1])}</b>`) },
        series: [{ type: 'scatter', name: series[0].name, symbolSize: 10, data: points, ...pins }],
      },
    };
  }
  if (result.form === 'line') {
    return {
      ids,
      empty,
      option: {
        ...base,
        ...axes,
        grid: withPinRoom(axes.grid),
        tooltip,
        series: [{
          ...pins,
          type: 'line',
          name: series[0].name,
          smooth: true,
          lineStyle: { color: line, width: 2 },
          symbolSize: 8,
          data: pointsOf(series[0]),
        }],
      },
    };
  }
  return {
    ids,
    empty,
    option: {
      ...base,
      ...axes,
      grid: withPinRoom(axes.grid),
      tooltip,
      ...(series.length > 1 ? { legend: { top: 2, itemWidth: 14, itemHeight: 8, textStyle: { color: muted, fontSize: 10 } } } : {}),
      // A series on its own scale (Ego density beside size) gets a second axis.
      ...(series.some((entry) => entry.axis === 1) ? { yAxis: [axes.yAxis, { ...axes.yAxis, splitLine: { show: false } }] } : {}),
      series: series.map((entry, index) => ({ type: 'bar', name: entry.name, yAxisIndex: entry.axis === 1 ? 1 : 0, data: pointsOf(entry), emphasis: { itemStyle: { opacity: 1 } }, ...(index === pinSeries ? pins : {}) })),
    },
  };
};
