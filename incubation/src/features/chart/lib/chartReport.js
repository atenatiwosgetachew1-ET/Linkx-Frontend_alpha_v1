// The graph and evidence reports' Measures section (analyst decision
// 2026-11-18): charts drawn without a Chart window, from the graph's data,
// as the chart snaps draw them (chartSnaps.js: a framed cell each, for a
// white page, entities named along the axis). Either the analyst's linked
// Chart window's cards (its charts, colours and scope) or an automatic set.

import { COLOR_SCHEMAS, DEFAULT_SCHEMA } from './chartColors.js';
import { DEFAULT_HISTOGRAM, histogramValues } from './chartHistogram.js';
import { metricById } from './chartMetrics.js';
import { buildChartOption } from './chartOption.js';
import { CELLS, SNAP_THEME, chartCell, figuresCell, loadImage } from './chartSnaps.js';
import { scopeInput, toneStep } from './chartState.js';
import { entityName } from '../../graph/report/graphReportModel.js';
import { requestChartMetric } from '../../graph/lib/layoutClient.js';

// The automatic set: the network as a whole, who matters, the money, how
// it is spread, its groups and when it happened. Charts the data cannot
// support (no amounts, no dates, too large) are left out, and said so.
export const AUTO_REPORT_CHARTS = Object.freeze(['globalMetrics', 'degree', 'betweenness', 'moneyFlow', 'degreeDistribution', 'communitySizes', 'heatMatrix']);

export const autoReportCards = () => AUTO_REPORT_CHARTS.map((metric, index) => ({ metric, colorful: true, schema: DEFAULT_SCHEMA, tone: toneStep(index) }));

const LEVEL_LABEL = { global: 'Global', node: 'Node', edge: 'Link' };

// The names by a column (Identify entities by); entities without a value
// keep their label. -> { node: { id: name }, edge: { key: "From → To" } }
const namesBy = (store, input, nameKey) => {
  const graph = store.graph();
  const nodeName = (id) => entityName(graph, id, nameKey);
  const node = Object.fromEntries(input.nodeIds.map((id) => [id, nodeName(id)]));
  const edge = Object.fromEntries(input.edges.map(({ key, source, target }) => {
    const label = store.getEdge(key)?.label;
    return [key, `${nodeName(source)} → ${nodeName(target)}${label != null && String(label).trim() ? ` (${String(label).trim()})` : ''}`];
  }));
  return { node, edge };
};

// A picture as a JPEG (a report keeps its size down; the cells are mostly
// flat colour). The picture as it was without a canvas.
const toJpeg = async (url, quality = 0.9) => {
  if (!url || typeof document === 'undefined') return url;
  // No canvas (nothing to convert with): as it is, at once.
  const canvas = document.createElement('canvas');
  const context = canvas.getContext?.('2d');
  if (!context) return url;
  const image = await loadImage(url);
  if (!image) return url;
  canvas.width = image.width;
  canvas.height = image.height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  try {
    return canvas.toDataURL('image/jpeg', quality);
  } catch {
    return url;
  }
};

// The cells for a report. store: the graph's store; link: what the graph
// draws and selects ({ nodeIds, edgeIds, selection: { nodes, edges },
// weightKey, timeKey, timeSlice }); scope: 'drawn' | 'selected' | 'all';
// cards: [{ metric, colorful, schema, tone }]; nameKey: Identify entities
// by; selectedColors: { node, edge } (pins; none by default); compute:
// (metric, input) -> Promise<result> (the worker).
// -> { cells: [{ title, level, image (data URL) }], skipped: [text] }
export async function reportChartCells({
  store, link, scope = 'drawn', cards = autoReportCards(), nameKey = '', selectedColors = { node: {}, edge: {} }, compute = requestChartMetric,
}) {
  const metrics = cards.map((card) => metricById(card.metric)).filter(Boolean);
  const input = scopeInput(store, link, scope, {
    communities: metrics.some((metric) => ['cohesion', 'temporal', 'communitySizes'].includes(metric.id)),
    times: metrics.some((metric) => metric.id === 'temporal' || metric.id === 'heatMatrix'),
  });
  const names = namesBy(store, input, nameKey);
  const engine = await import('./echarts.js').then((module) => module.default).catch(() => null);
  const cells = [];
  const skipped = [];
  // The Histogram is asked with its property's values (as its window does).
  const inputFor = (card) => {
    if (card.metric !== 'histogram') return input;
    const param = card.param || DEFAULT_HISTOGRAM;
    return {
      nodeIds: [],
      edges: [],
      values: histogramValues(store.graph(), input.nodeIds, input.edges.map((edge) => edge.key), param),
      subject: param.subject,
      paramLabel: param.key === '@type' ? 'Type' : param.key,
    };
  };
  // One after another (each picture is large).
  for (const card of cards) {
    const metric = metricById(card.metric);
    if (!metric) continue;
    let result;
    try {
      result = await compute(card.metric, inputFor(card));
    } catch (error) {
      skipped.push(`${metric.label}: ${error?.message || error}`);
      continue;
    }
    const level = LEVEL_LABEL[metric.group] || '';
    const theme = { ...SNAP_THEME, tone: (COLOR_SCHEMAS[card.schema] || COLOR_SCHEMAS[DEFAULT_SCHEMA])(card.tone ?? 0.5) };
    let url = null;
    if (result.form === 'figures') {
      if (!result.items?.length) {
        skipped.push(`${metric.label}: nothing to measure.`);
        continue;
      }
      url = figuresCell({ title: metric.label, level, items: result.items, theme, size: CELLS.group });
    } else {
      // A chart of nothing but zeros says nothing (every entity at 0 links,
      // say): named, not drawn.
      const series = result.series || [];
      if (series.length && series.every((entry) => Object.values(entry.values || {}).flat().every((value) => !Number(value)))) {
        skipped.push(`${metric.label}: ${result.note || 'every value is 0 in this scope.'}`);
        continue;
      }
      const kind = result.kind === 'edge' ? 'edge' : 'node';
      const built = buildChartOption(result, { names: names[kind] || {}, colorful: card.colorful !== false, schema: card.schema, selectedColors: selectedColors[kind] || {}, theme, paper: true });
      if (built.empty) {
        skipped.push(`${metric.label}: ${result.note || 'nothing to chart in this scope.'}`);
        continue;
      }
      url = await chartCell({ engine, option: built.option, title: metric.label, level, theme, size: CELLS.group });
    }
    if (!url) {
      skipped.push(`${metric.label}: could not be drawn.`);
      continue;
    }
    cells.push({ title: metric.label, level, image: await toJpeg(url) });
  }
  return { cells, skipped };
}
