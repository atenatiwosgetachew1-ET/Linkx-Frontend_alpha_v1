import { parseAmount } from '../../../shared/numbers/values.js';
import { isAnnotation } from '../../graph/lib/graphAnalysis.js';
import { DEFAULT_SCHEMA, SCHEMA_NAMES } from './chartColors.js';
import { CHART_METRICS, metricById } from './chartMetrics.js';
import { DEFAULT_HISTOGRAM } from './chartHistogram.js';
import { BUILTIN_CHART_DEFAULTS } from './chartDefaults.js';
import { detectCommunities } from '../../graph/lib/graphAnalysis.js';
import { timelineItems, timelineKeys } from '../../graph/lib/graphTimeline.js';

// The Chart window's state, kept in its window metadata (chartState):
// { scope: 'drawn' | 'selected' | 'all', cards: [{ id, metric, colorful,
// schema }], global: { colorful, schema }, mode: 'auto' | 'manual',
// seeded: the graph id the automatic mode last filled the board for,
// follow: zoom each chart to what is selected on the graph }. Bounded and
// cleaned on read.
//
// Generation (analyst decision 2026-11-18): Automatic (the default) brings
// the Global-level charts up by themselves once linked, as the Table window
// shows its rows; Manual leaves the board to the analyst (a whole category,
// or one chart at a time).

const SCOPES = ['drawn', 'selected', 'all'];
export const CHART_MODES = Object.freeze(['auto', 'manual']);
// Every chart at once (each metric is on the board once at most).
const MAX_CARDS = CHART_METRICS.length;
const schemaOf = (value) => (SCHEMA_NAMES.includes(value) ? value : DEFAULT_SCHEMA);

// The state's version: before 2, colour off was the default and was saved
// with every change, so a saved "off" did not mean the analyst turned it
// off; from 2, colour by the schema is on unless turned off (analyst
// decision 2026-11-18).
export const CHART_STATE_VERSION = 2;

// Each card's own place along the colour schema (0..1), given when it is
// created and kept (analyst decision 2026-11-18: a card keeps its colour
// when others are added or removed). The n-th card created takes the n-th
// step of the golden-ratio sequence, so cards made one after another stay
// well apart.
const GOLDEN = 0.6180339887498949;
export const toneStep = (n) => (0.5 + n * GOLDEN) % 1;
const isStep = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const paramOf = (value) => (value && (value.subject === 'node' || value.subject === 'edge') && typeof value.key === 'string' && value.key
  ? { subject: value.subject, key: value.key.slice(0, 120) }
  : { ...DEFAULT_HISTOGRAM });

// defaults: what a window without a state of its own starts from
// (Libraries ▸ Charts; chartDefaults.js).
export const normalizeChartState = (input = {}, defaults = BUILTIN_CHART_DEFAULTS) => {
  // Nothing saved yet: a new window.
  const blank = !input || Object.keys(input).length === 0;
  const seen = new Set();
  const kept = (Array.isArray(input?.cards) ? input.cards : []).filter((card) => card && metricById(card.metric));
  const count = Math.min(kept.length, MAX_CARDS);
  const current = input?.v === CHART_STATE_VERSION;
  const colourOf = (value) => (current ? value !== false : true);
  const cards = (Array.isArray(input?.cards) ? input.cards : [])
    .filter((card) => card && metricById(card.metric) && !seen.has(card.metric) && seen.add(card.metric))
    .slice(0, MAX_CARDS)
    .map((card, index) => ({
      id: typeof card.id === 'string' && card.id ? card.id.slice(0, 80) : `${card.metric}-${index}`,
      metric: card.metric,
      // Coloured by the schema unless turned off (analyst decision 2026-11-18).
      colorful: colourOf(card.colorful),
      schema: schemaOf(card.schema),
      // A card saved before it had one: its place on the board then, spread
      // from one end of the schema to the other (as it was drawn).
      tone: isStep(card.tone) ? card.tone : (count > 1 ? index / (count - 1) : 0.5),
      // The Histogram's property: { subject: 'node' | 'edge', key }.
      ...(metricById(card.metric)?.param ? { param: paramOf(card.param) } : {}),
    }));
  return {
    v: CHART_STATE_VERSION,
    scope: SCOPES.includes(input?.scope) ? input.scope : defaults.scope,
    cards,
    global: {
      colorful: blank ? defaults.colorful : colourOf(input?.global?.colorful),
      schema: SCHEMA_NAMES.includes(input?.global?.schema) ? input.global.schema : (blank ? defaults.schema : DEFAULT_SCHEMA),
    },
    mode: CHART_MODES.includes(input?.mode) ? input.mode : defaults.mode,
    seeded: typeof input?.seeded === 'string' ? input.seeded.slice(0, 80) : '',
    follow: input?.follow === undefined && blank ? defaults.follow : input?.follow !== false,
    // How many cards have been created: the next card's tone step.
    toneCount: Number.isInteger(input?.toneCount) && input.toneCount >= 0 ? input.toneCount : cards.length,
  };
};

// A number from a link property (the shared rules).
export const numericValue = parseAmount;
const propertyOf = (item, key) => {
  if (!item || !key) return undefined;
  const actual = Object.keys(item).find((candidate) => candidate.toLowerCase() === String(key).toLowerCase());
  return actual ? item[actual] : undefined;
};

const isThemeLine = (store, key) => String(store.getEdge(key)?.edge_kind || '').toLowerCase() === 'theme_line';

// The scope's entities and the links among them, as the metrics take them
// ({ nodeIds, edges: [{ key, source, target, weight? }], weightLabel }). Drawn: what the Graph
// window publishes; Selected: the selected entities and the drawn links among
// them; All: the whole graph. Theme lines are left out (as the Graph
// window's measures).
export const scopeInput = (store, link, scope, { communities = false, times = false } = {}) => {
  const graph = store.graph();
  // The analyst's text notes are not entities.
  const isEntity = (id) => !isAnnotation(graph.getNodeAttributes(id));
  let nodeIds;
  let edgeKeys;
  if (scope === 'all') {
    nodeIds = graph.nodes().filter(isEntity);
    edgeKeys = graph.edges();
  } else if (scope === 'selected') {
    nodeIds = link.selection.nodes.filter((id) => graph.hasNode(id) && isEntity(id));
    const chosen = new Set(nodeIds);
    // The drawn ones (a link out of sight is not part of what is selected).
    edgeKeys = link.edgeIds.filter((key) => graph.hasEdge(key) && chosen.has(graph.source(key)) && chosen.has(graph.target(key)));
  } else {
    nodeIds = link.nodeIds.filter((id) => graph.hasNode(id) && isEntity(id));
    edgeKeys = link.edgeIds.filter((key) => graph.hasEdge(key));
  }
  // Each link's weight (Edge Weight): the Graph window's weight key, else
  // the link's weight, else its value field.
  const weightKey = link.weightKey || '';
  const weightOf = (edge) => (weightKey
    ? numericValue(propertyOf(edge, weightKey))
    : numericValue(propertyOf(edge, 'weight')) ?? numericValue(propertyOf(edge, 'value')));
  const usedKeys = edgeKeys.filter((key) => !isThemeLine(store, key));
  // Temporal Metrics: each link's date from the Graph window's timeline
  // field (else the first date field found); a link without a date of its
  // own takes the later of its ends' dates.
  const timeKey = times ? (link.timeKey || timelineKeys(graph, { nodeIds, edgeIds: usedKeys })[0]?.key || '') : '';
  const dated = timeKey ? timelineItems(graph, { nodeIds, edgeIds: usedKeys }, timeKey) : null;
  let borrowed = 0;
  const timeOf = (key) => {
    if (!dated) return null;
    if (dated.edges.has(key)) return dated.edges.get(key);
    borrowed += 1;
    const ends = [dated.nodes.get(graph.source(key)), dated.nodes.get(graph.target(key))].filter((ms) => ms != null);
    if (!ends.length) borrowed -= 1;
    return ends.length ? Math.max(...ends) : null;
  };
  const edges = usedKeys.map((key) => {
    const weight = weightOf(store.getEdge(key));
    const time = timeOf(key);
    return { key, source: graph.source(key), target: graph.target(key), ...(weight === null ? {} : { weight }), ...(time === null ? {} : { time }) };
  });
  return {
    nodeIds,
    edges,
    weightLabel: weightKey || 'weight / value',
    ...(times ? { timeKey, timeUnit: link.timeSlice || 'auto', borrowedTimes: borrowed } : {}),
    // Cohesion: the communities Analyze ▸ Detect Communities finds over the
    // scope (on this side: it reads the graph's relationships).
    ...(communities ? { communities: detectCommunities(graph, nodeIds, edges.map((edge) => edge.key)) } : {}),
  };
};
