// Graph report (G4.2; analyst decisions 2026-11-17): a structured document
// built from a Graph window, laid out by a template (graphReportPdf.js, the
// built-in "LinkX Graph Report" after docs/report-templates/default/).
// Organised round the investigation rather than the graph's statistics:
// who is involved, how they connect, when, what is flagged, what it means,
// and how far the figures can be trusted.
//
// Pure: everything comes in as plain data, so tests build reports directly
// and the co-analyst can later draft or edit the same structure. Sections
// with nothing to show are left out. Text is plain (never markup): the
// renderer writes it as text.
//
// Blocks: { type: 'paragraph', text, tone? } | { type: 'figures', items:
// [{ value, label, icon? }] } | { type: 'bullets', items } | { type: 'table',
// title?, head, rows, widths?, note? } | { type: 'image', key, caption } |
// { type: 'profiles', items: [{ name, type, links, tags, fields: [[label, value]] }] } |
// { type: 'bars', title, items: [{ label, value }] } | { type: 'signature',
// name } | { type: 'subheading', text }.

import { findCutPoints, nodeTypeOf } from '../lib/graphAnalysis.js';
import { TIME_UNITS, formatBucket, timelineBuckets, timelineItems, timelineKeys } from '../lib/graphTimeline.js';

export const REPORT_TEMPLATE = Object.freeze({ id: 'linkx-graph-default', name: 'LinkX Graph Report', version: 1 });

// The two kinds of report, named apart everywhere (analyst decision
// 2026-11-18): an Evidence Report is drawn from the evidence record as the
// backend analysed it (organic, original); a Graph Report is drawn from a
// Graph window, whose graph the analyst may have changed.
export const REPORT_KINDS = Object.freeze({
  graph: Object.freeze({
    id: 'graph',
    name: 'Graph Report',
    header: 'GRAPH REPORT',
    file: 'LinkxGraph_Report',
    provenance: 'Provenance: a Graph Report, drawn from a Graph window as the analyst left it; its graph may have been edited, filtered, styled or extended by the analyst.',
  }),
  evidence: Object.freeze({
    id: 'evidence',
    name: 'Evidence Report',
    header: 'EVIDENCE REPORT',
    file: 'LinkxEvidence_Report',
    provenance: 'Provenance: an Evidence Report, drawn from the evidence record as the Service analysed it; nothing in its graph was changed by an analyst.',
  }),
});
export const reportKindOf = (kind) => REPORT_KINDS[kind] || REPORT_KINDS.graph;
export const REPORT_LIMITS = Object.freeze({
  text: 4000, line: 300, findings: 12, actions: 20, priority: 15, profiles: 4, strongest: 10, groups: 12, bridges: 10, alerts: 40, pinned: 30, rules: 20, listRows: 2000,
});
export const DEFAULT_MARKING = 'CONFIDENTIAL · For authorised investigation use only';

// Plain, bounded text (no control characters).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
export const plainText = (value, max = REPORT_LIMITS.line) => String(value ?? '').replace(CONTROL, '').trim().slice(0, max);
const lines = (value, max) => String(value ?? '').split(/\r?\n/).map((line) => plainText(line)).filter(Boolean).slice(0, max);

// How an entity is named in the report: the analyst's identifying column
// (Generate report ▸ Identify entities by), else its label, else its id.
export const entityName = (graph, id, nameKey = '') => {
  if (!graph.hasNode(id)) return String(id);
  const node = graph.getNodeAttributes(id);
  if (nameKey) {
    const actual = Object.keys(node).find((key) => key.toLowerCase() === String(nameKey).toLowerCase());
    const value = actual ? node[actual] : null;
    if (value != null && typeof value !== 'object' && String(value).trim()) return String(value).trim();
  }
  return node.label != null && String(node.label).trim() ? String(node.label).trim() : String(id);
};
const count = (value) => Number(value || 0).toLocaleString('en-GB');
const percent = (part, whole) => (whole ? `${Math.round((part / whole) * 1000) / 10}%` : '0%');
const numberOf = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};
const total = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

// dd/mm/yy HH:mm (the analyst's cover format).
// The cover's domain text: the domain, then its distribution when the data
// spans more than one domain (or the domain is "all"), e.g.
// "All (Banking 12 · Microfinance 3)". Shares given as fractions summing to
// about 1 are shown as percentages. labelOf(key) names a domain.
export const describeReportDomain = (domain, distribution = [], labelOf = (key) => key) => {
  const items = (Array.isArray(distribution) ? distribution : []).filter((item) => item?.domain);
  const key = String(domain || '').trim() || (items.length === 1 ? items[0].domain : items.length ? 'all' : '');
  if (!key) return '';
  const label = labelOf(key);
  if (!items.length || (items.length === 1 && key.toLowerCase() !== 'all')) return label;
  const counts = items.map((item) => item.count).filter((count) => count !== null && count !== undefined);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const fractions = counts.length === items.length && counts.every((count) => count <= 1) && Math.abs(total - 1) < 0.02;
  const amount = (count) => {
    if (count === null || count === undefined) return '';
    if (fractions) return ` ${Math.round(count * 100)}%`;
    return ` ${Number.isInteger(count) ? count.toLocaleString('en-US') : Number(count.toFixed(2))}`;
  };
  return `${label} (${items.map((item) => `${labelOf(item.domain)}${amount(item.count)}`).join(' · ')})`;
};

// The evidence's fraudulence score for the Summary (analyst decisions
// 2026-11-18): { value, band } or null. Without a band from the report,
// the Reports bands from the number (fatal 90+, critical 80-89, high
// 50-79, medium 20-49, low 0-19).
export const SCORE_BAND_IDS = Object.freeze(['fatal', 'critical', 'high', 'medium', 'low']);
export const reportScore = (score) => {
  const value = plainText(score?.value, 12);
  if (!value) return null;
  let band = String(score?.band || '').trim().toLowerCase();
  if (!SCORE_BAND_IDS.includes(band)) {
    const number = parseFloat(value);
    band = Number.isFinite(number)
      ? number >= 90 ? 'fatal' : number >= 80 ? 'critical' : number >= 50 ? 'high' : number >= 20 ? 'medium' : 'low'
      : '';
  }
  return { value, band };
};

export const reportDateTime = (date = new Date()) => {
  const two = (n) => String(n).padStart(2, '0');
  return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${String(date.getFullYear()).slice(-2)} ${two(date.getHours())}:${two(date.getMinutes())}`;
};

const typeOfLink = (attributes) => String(attributes.rel_type ?? attributes.relationship ?? attributes.type ?? attributes.label ?? '').trim() || 'Unspecified';
const isThemeLine = (attributes) => String(attributes?.edge_kind || '').toLowerCase() === 'theme_line';

/* ── Facts (shared by the sections and the findings draft) ─────────── */

// The drawn graph's facts. weightKey: a numeric link property to total.
export const reportFacts = (graph, view, { weightKey = '', markers = null, groups = [] } = {}) => {
  const nodeIds = view.nodeIds.filter((id) => graph.hasNode(id));
  const drawn = new Set(nodeIds);
  const edgeIds = view.edgeIds.filter((key) => graph.hasEdge(key) && !isThemeLine(graph.getEdgeAttributes(key)));
  const degree = new Map(nodeIds.map((id) => [id, 0]));
  const neighbours = new Map(nodeIds.map((id) => [id, new Set()]));
  edgeIds.forEach((key) => {
    const a = graph.source(key);
    const b = graph.target(key);
    if (a === b || !drawn.has(a) || !drawn.has(b)) return;
    neighbours.get(a).add(b);
    neighbours.get(b).add(a);
  });
  neighbours.forEach((set, id) => degree.set(id, set.size));
  // Connected groups (union-find over drawn links).
  const parent = new Map(nodeIds.map((id) => [id, id]));
  const find = (id) => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root);
    let step = id;
    while (parent.get(step) !== root) {
      const next = parent.get(step);
      parent.set(step, root);
      step = next;
    }
    return root;
  };
  neighbours.forEach((set, id) => set.forEach((other) => {
    const a = find(id);
    const b = find(other);
    if (a !== b) parent.set(a, b);
  }));
  const components = new Map();
  nodeIds.forEach((id) => {
    const root = find(id);
    components.set(root, (components.get(root) || 0) + 1);
  });
  const isolated = nodeIds.filter((id) => degree.get(id) === 0).length;
  // Types.
  const nodeTypes = new Map();
  nodeIds.forEach((id) => {
    const type = nodeTypeOf(graph.getNodeAttributes(id)) || 'Unspecified';
    nodeTypes.set(type, (nodeTypes.get(type) || 0) + 1);
  });
  const linkTypes = new Map();
  edgeIds.forEach((key) => {
    const type = typeOfLink(graph.getEdgeAttributes(key));
    linkTypes.set(type, (linkTypes.get(type) || 0) + 1);
  });
  // Pairs: how many links and their total, both directions together.
  const pairs = new Map();
  edgeIds.forEach((key) => {
    const a = graph.source(key);
    const b = graph.target(key);
    if (a === b) return;
    const [x, y] = String(a) <= String(b) ? [a, b] : [b, a];
    const id = `${x}\u0000${y}`;
    if (!pairs.has(id)) pairs.set(id, { a: x, b: y, count: 0, total: null, types: new Set() });
    const pair = pairs.get(id);
    pair.count += 1;
    pair.types.add(typeOfLink(graph.getEdgeAttributes(key)));
    const amount = weightKey ? numberOf(graph.getEdgeAttribute(key, weightKey)) : null;
    if (amount !== null) pair.total = (pair.total ?? 0) + amount;
  });
  const flags = (id) => {
    const out = [];
    if (markers?.alert?.nodes?.has(id)) out.push('Alerted');
    if (markers?.pinned?.nodes?.has(id)) out.push('Pinned');
    const node = graph.getNodeAttributes(id);
    if (node.isGroup) out.push('Group');
    if (Array.isArray(node.merged_from) && node.merged_from.length) out.push('Merged');
    return out;
  };
  const bridges = new Set(nodeIds.length <= 20000 ? findCutPoints(graph, nodeIds) : []);
  return {
    nodeIds, edgeIds, degree, components: [...components.values()].sort((a, b) => b - a), isolated, nodeTypes, linkTypes,
    pairs: [...pairs.values()], flags, bridges, groups,
  };
};

// The busiest dated periods, when the drawn graph has dates.
export const reportTimeline = (graph, view) => {
  const [first] = timelineKeys(graph, view);
  if (!first) return null;
  const { nodes, edges } = timelineItems(graph, view, first.key);
  const times = [...nodes.values(), ...edges.values()];
  if (!times.length) return null;
  const { unit, buckets } = timelineBuckets(times);
  // The chart: the finest unit from the chosen one up that gives 40 bars or fewer.
  let chart = { unit, buckets };
  for (const next of TIME_UNITS.slice(TIME_UNITS.indexOf(unit))) {
    chart = timelineBuckets(times, next);
    if (chart.buckets.length <= 40) break;
  }
  let min = Infinity;
  let max = -Infinity;
  times.forEach((ms) => { if (ms < min) min = ms; if (ms > max) max = ms; });
  return { key: first.key, unit, buckets, chart, first: min, last: max, dated: times.length, nodes: nodes.size, edges: edges.size };
};

// Facts -> plain sentences (the analyst's starting point for key findings).
export const draftFindings = ({ graph, facts, alerts = [], timeline = null, nameKey = '' }) => {
  const nameOf = (g, id) => entityName(g, id, nameKey);
  const out = [];
  const ranked = [...facts.degree.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length && ranked[0][1] > 0) {
    const [id, links] = ranked[0];
    out.push(`${nameOf(graph, id)} is the most connected entity, linked to ${count(links)} others.`);
  }
  const strongest = [...facts.pairs].sort((a, b) => b.count - a.count || (b.total ?? 0) - (a.total ?? 0))[0];
  if (strongest && strongest.count > 1) {
    out.push(`The strongest relationship is between ${nameOf(graph, strongest.a)} and ${nameOf(graph, strongest.b)}: ${count(strongest.count)} links${strongest.total !== null ? `, totalling ${total.format(strongest.total)}` : ''}.`);
  }
  if (facts.bridges.size) out.push(`${count(facts.bridges.size)} ${facts.bridges.size === 1 ? 'entity bridges' : 'entities bridge'} otherwise separate parts of the network.`);
  if (alerts.length) {
    const high = alerts.filter((alert) => alert.severity === 'high').length;
    out.push(`${count(alerts.length)} ${alerts.length === 1 ? 'alert was' : 'alerts were'} raised${high ? `, ${count(high)} of high severity` : ''}.`);
  }
  if (timeline?.buckets?.length) {
    const { unit, buckets } = timeline.chart || timeline;
    const peak = [...buckets].sort((a, b) => b.count - a.count || a.start - b.start)[0];
    out.push(`Dated activity runs from ${formatBucket(timeline.first, 'day')} to ${formatBucket(timeline.last, 'day')}, busiest in the ${unit === 'week' ? 'week of ' : ''}${formatBucket(peak.start, unit)} (${count(peak.count)} items).`);
  }
  return out;
};

/* ── The document ───────────────────────────────────────────────────── */

// input: {
//   graph, view, totals: { nodes, edges },
//   cover: { title, caseId, reference, dateTime, analyst, systemRule, graphAlert, purpose, marking, domain },
//   (systemRule: the backend link analysis rule(s) that flagged the evidence;
//   graphAlert: the window's graph alert configuration),
//   nameKey: the node property naming entities ('' = label, else id),
//   analyst: { findings (text, a line each), assessment, actions (text, a
//     line each: "action | owner | status") , includeLists },
//   source: { kind, evidence, sessionId, relationship, fileName },
//   scope: { limit, searched, period, filtersOff: [labels] },
//   alerts: [{ name, category, severity, short }], pinned: [{ name, kind, detail }],
//   rules: [{ name, target, description }], groups: [{ name, kind, count, detail }],
//   markers, weightKey, profileOf(nodeId) -> { fields: [[label, value]], portrait } | [[label, value]] | null
//   (the actor profile: its shown fields, "—" when unknown, and the portrait link),
//   hasSnapshot, generatedAt (Date),
//   score: { value, band } (the evidence's fraudulence score, shown on the Summary),
//   kind: 'graph' (default) | 'evidence' (REPORT_KINDS)
// }
export const buildGraphReport = (input) => {
  const { graph, view } = input;
  const nameOf = (g, id) => entityName(g, id, input.nameKey);
  const generatedAt = input.generatedAt || new Date();
  const cover = {
    header: 'NBE',
    title: plainText(input.cover?.title) || reportKindOf(input.kind).name,
    purpose: plainText(input.cover?.purpose, 400),
    fields: [
      ['Case ID', plainText(input.cover?.caseId) || '—'],
      ['Analysis Reference ID', plainText(input.cover?.reference) || '—'],
      ['Date & Time of Report', plainText(input.cover?.dateTime) || reportDateTime(generatedAt)],
      ['Analyst / Investigator Details', plainText(input.cover?.analyst) || '—'],
      ['System Flagged Rule', plainText(input.cover?.systemRule, 400) || '—'],
      ['Graph Alert', plainText(input.cover?.graphAlert, 400) || '—'],
    ],
    domain: plainText(input.cover?.domain),
    marking: plainText(input.cover?.marking) || DEFAULT_MARKING,
  };
  const facts = reportFacts(graph, view, { weightKey: input.weightKey, markers: input.markers, groups: input.groups });
  const timeline = reportTimeline(graph, view);
  const alerts = (input.alerts || []).slice(0, REPORT_LIMITS.alerts);
  const pinned = (input.pinned || []).slice(0, REPORT_LIMITS.pinned);
  const typed = lines(input.analyst?.findings, REPORT_LIMITS.findings);
  const findings = typed.length ? typed : draftFindings({ graph, facts, alerts: input.alerts || [], timeline, nameKey: input.nameKey });
  const sections = [];

  // 1 Summary
  sections.push({
    id: 'summary',
    eyebrow: 'Summary · Bottom line',
    title: 'Summary',
    blocks: [
      ...(cover.purpose ? [{ type: 'paragraph', text: cover.purpose }] : []),
      {
        type: 'figures',
        items: [
          { value: count(facts.nodeIds.length), label: 'Entities shown', icon: 'entities' },
          { value: count(facts.edgeIds.length), label: 'Relationships shown', icon: 'links' },
          { value: count((input.alerts || []).length), label: 'Alerts raised', icon: 'alert' },
          { value: count(pinned.length || facts.bridges.size), label: pinned.length ? 'Pinned evidence' : 'Bridging entities', icon: pinned.length ? 'pin' : 'bridge' },
        ],
      },
      { type: 'subheading', text: 'Key findings' },
      findings.length ? { type: 'bullets', items: findings } : { type: 'paragraph', text: 'No findings recorded.', tone: 'muted' },
      ...(typed.length ? [] : [{ type: 'paragraph', text: 'Drafted from the graph; to be confirmed by the analyst.', tone: 'muted' }]),
      { type: 'contents' },
    ],
  });

  // 2 The graph (not "chart": chart-window evidence will be its own part)
  const scopeRows = [
    ['Entities', `${count(facts.nodeIds.length)} shown of ${count(input.totals?.nodes ?? facts.nodeIds.length)}`],
    ['Relationships', `${count(facts.edgeIds.length)} shown of ${count(input.totals?.edges ?? facts.edgeIds.length)}`],
  ];
  if (input.scope?.searched) scopeRows.push(['Search', 'The graph shows search results only']);
  if (input.scope?.period) scopeRows.push(['Period', plainText(input.scope.period)]);
  if (input.scope?.filtersOff?.length) scopeRows.push(['Hidden element types', input.scope.filtersOff.map((entry) => plainText(entry)).join(', ')]);
  sections.push({
    id: 'graph',
    eyebrow: 'Graph · What is shown',
    title: 'The graph',
    blocks: [
      ...(input.hasSnapshot ? [{ type: 'image', key: 'snapshot', caption: input.kind === 'evidence' ? 'The evidence graph as analysed, drawn for this report.' : 'The graph as drawn when the report was generated.' }] : [{ type: 'paragraph', text: 'No picture of the graph was available.', tone: 'muted' }]),
      { type: 'subheading', text: 'Entity types' },
      {
        type: 'table', head: ['Type', 'Entities', 'Share'], widths: [0.5, 0.25, 0.25],
        rows: [...facts.nodeTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([type, n]) => [plainText(type), count(n), percent(n, facts.nodeIds.length)]),
      },
      { type: 'subheading', text: 'Scope' },
      { type: 'table', head: ['Item', 'Detail'], widths: [0.3, 0.7], rows: scopeRows },
    ],
  });

  // 3 Subjects of interest
  const pinnedIds = new Set(facts.nodeIds.filter((id) => input.markers?.pinned?.nodes?.has(id)));
  const priority = [...facts.nodeIds]
    .sort((a, b) => (Number(pinnedIds.has(b)) - Number(pinnedIds.has(a))) || (facts.degree.get(b) - facts.degree.get(a)) || String(a).localeCompare(String(b), undefined, { numeric: true }))
    .slice(0, REPORT_LIMITS.priority);
  if (priority.length) {
    const profiles = priority.slice(0, REPORT_LIMITS.profiles)
      .map((id) => {
        const profile = input.profileOf?.(id) || null;
        return Array.isArray(profile) ? { id, fields: profile, portrait: '' } : { id, fields: profile?.fields || null, portrait: profile?.portrait || '' };
      })
      // A card only for an entity its profile knows something about.
      .map((entry) => ({ ...entry, portrait: /^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);)/i.test(String(entry.portrait || '')) ? String(entry.portrait) : '' }))
      .filter((entry) => (entry.fields || []).some(([, value]) => plainText(value)) || entry.portrait)
      .map((entry) => ({
        name: plainText(nameOf(graph, entry.id)),
        type: plainText(nodeTypeOf(graph.getNodeAttributes(entry.id)) || ''),
        links: facts.degree.get(entry.id) || 0,
        tags: [...facts.flags(entry.id), ...(facts.bridges.has(entry.id) ? ['Bridge'] : [])],
        fields: (entry.fields || []).map(([label, value]) => [plainText(label), plainText(value) || '—']),
        portrait: entry.portrait, // a web link or an embedded image only (as the actor profile card)
      }));
    sections.push({
      id: 'subjects',
      eyebrow: 'Subjects · Who is involved',
      title: 'Subjects of interest',
      blocks: [
        { type: 'paragraph', text: 'Pinned evidence first, then the most connected entities shown.' },
        {
          // Notes drawn as flags, one colour per mark (analyst decision 2026-11-17).
          type: 'table', head: ['#', 'Entity', 'Type', 'Links', 'Notes'], widths: [0.06, 0.34, 0.18, 0.1, 0.32], flagColumn: 4,
          rows: priority.map((id, index) => {
            const notes = [...facts.flags(id), ...(facts.bridges.has(id) ? ['Bridge'] : [])];
            return [String(index + 1), plainText(nameOf(graph, id)), plainText(nodeTypeOf(graph.getNodeAttributes(id)) || '—'), count(facts.degree.get(id)), notes.join(', ') || '—'];
          }),
        },
        ...(profiles.length ? [{ type: 'subheading', text: 'Profiles' }, { type: 'profiles', items: profiles }] : []),
      ],
    });
  }

  // 4 Relationships and patterns
  const strongest = [...facts.pairs].sort((a, b) => b.count - a.count || (b.total ?? 0) - (a.total ?? 0)).slice(0, REPORT_LIMITS.strongest);
  const patternBlocks = [];
  if (strongest.length) {
    patternBlocks.push(
      { type: 'subheading', text: 'Strongest relationships' },
      {
        type: 'table',
        head: ['Between', 'And', 'Type', 'Links', ...(input.weightKey ? [`Total ${plainText(input.weightKey, 30)}`] : [])],
        widths: input.weightKey ? [0.28, 0.28, 0.2, 0.09, 0.15] : [0.32, 0.32, 0.24, 0.12],
        rows: strongest.map((pair) => [
          plainText(nameOf(graph, pair.a)), plainText(nameOf(graph, pair.b)), plainText([...pair.types].join(', ')), count(pair.count),
          ...(input.weightKey ? [pair.total === null ? '—' : total.format(pair.total)] : []),
        ]),
      },
    );
  }
  if (facts.bridges.size) {
    const bridges = [...facts.bridges].sort((a, b) => facts.degree.get(b) - facts.degree.get(a)).slice(0, REPORT_LIMITS.bridges);
    patternBlocks.push(
      { type: 'subheading', text: 'Bridging entities' },
      { type: 'paragraph', text: 'Removing one of these would split the network: they connect otherwise separate parts.' },
      { type: 'table', head: ['Entity', 'Type', 'Links'], widths: [0.5, 0.3, 0.2], rows: bridges.map((id) => [plainText(nameOf(graph, id)), plainText(nodeTypeOf(graph.getNodeAttributes(id)) || '—'), count(facts.degree.get(id))]) },
    );
  }
  const groups = (input.groups || []).slice(0, REPORT_LIMITS.groups);
  if (groups.length) {
    patternBlocks.push(
      { type: 'subheading', text: 'Groups and merged entities' },
      { type: 'table', head: ['Name', 'Kind', 'Size', 'Detail'], widths: [0.25, 0.15, 0.15, 0.45], rows: groups.map((group) => [plainText(group.name), group.kind === 'group' ? 'Group' : 'Merged', plainText(group.count), plainText(group.detail, 200)]) },
    );
  }
  if (facts.components.length > 1) {
    patternBlocks.push({ type: 'paragraph', text: `The graph falls into ${count(facts.components.length)} separate parts; the largest holds ${count(facts.components[0])} entities${facts.isolated ? `, and ${count(facts.isolated)} ${facts.isolated === 1 ? 'entity has' : 'entities have'} no link shown` : ''}.` });
  }
  if (input.markers?.path?.nodes?.size) {
    patternBlocks.push({ type: 'paragraph', text: `A path is highlighted through ${count(input.markers.path.nodes.size)} entities: ${[...input.markers.path.nodes].slice(0, 12).map((id) => plainText(nameOf(graph, id))).join(', ')}.` });
  }
  if (patternBlocks.length) {
    sections.push({ id: 'patterns', eyebrow: 'Network · How they connect', title: 'Relationships and patterns', blocks: [
      { type: 'table', head: ['Relationship type', 'Links', 'Share'], widths: [0.5, 0.25, 0.25], rows: [...facts.linkTypes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, n]) => [plainText(type), count(n), percent(n, facts.edgeIds.length)]) },
      ...patternBlocks,
    ] });
  }

  // 5 Timeline
  if (timeline) {
    // Busiest periods in the chart's unit, so the table reads with the chart.
    const busiest = [...timeline.chart.buckets].filter((bucket) => bucket.count).sort((a, b) => b.count - a.count || a.start - b.start).slice(0, 5);
    const bars = timeline.chart.buckets.length > 1 && timeline.chart.buckets.length <= 40 ? timeline.chart.buckets : null;
    sections.push({ id: 'timeline', eyebrow: 'Time · When it happened', title: 'Timeline', blocks: [
      { type: 'paragraph', text: `Dated by ${plainText(timeline.key, 40)}: ${count(timeline.dated)} dated items (${count(timeline.nodes)} entities, ${count(timeline.edges)} relationships), from ${formatBucket(timeline.first, 'day')} to ${formatBucket(timeline.last, 'day')}.` },
      ...(bars ? [{ type: 'bars', title: `Activity per ${timeline.chart.unit}`, items: bars.map((bucket) => ({ label: formatBucket(bucket.start, timeline.chart.unit), value: bucket.count })) }] : []),
      { type: 'subheading', text: 'Busiest periods' },
      { type: 'table', head: [timeline.chart.unit === 'week' ? 'Week of' : 'Period', 'Dated items'], widths: [0.6, 0.4], rows: busiest.map((bucket) => [formatBucket(bucket.start, timeline.chart.unit), count(bucket.count)]) },
    ] });
  }

  // 6 Alerts and indicators
  const indicatorBlocks = [];
  if (alerts.length) {
    indicatorBlocks.push({ type: 'subheading', text: 'Alerts' }, {
      type: 'table', head: ['Severity', 'Entity', 'Indicator', 'Detail'], widths: [0.12, 0.28, 0.2, 0.4],
      rows: alerts.map((alert) => [alert.severity === 'high' ? 'High' : 'Medium', plainText(alert.name), plainText(alert.category), plainText(alert.short, 200)]),
    });
  }
  if (pinned.length) {
    indicatorBlocks.push({ type: 'subheading', text: 'Pinned evidence' }, {
      type: 'table', head: ['Item', 'Kind', 'Detail'], widths: [0.45, 0.15, 0.4],
      rows: pinned.map((item) => [plainText(item.name), item.kind === 'edge' ? 'Link' : 'Entity', plainText(item.detail)]),
    });
  }
  const rules = (input.rules || []).slice(0, REPORT_LIMITS.rules);
  if (rules.length) {
    indicatorBlocks.push({ type: 'subheading', text: 'Indicator rules applied' }, {
      type: 'table', head: ['Rule', 'Applies to', 'Condition'], widths: [0.3, 0.15, 0.55],
      rows: rules.map((rule) => [plainText(rule.name) || '—', rule.target === 'edge' ? 'Links' : 'Entities', plainText(rule.description, 300)]),
    });
  }
  if (indicatorBlocks.length) sections.push({ id: 'indicators', eyebrow: 'Indicators · What is flagged', title: 'Alerts and indicators', blocks: indicatorBlocks });

  // 7 Assessment and next steps
  const assessment = plainText(input.analyst?.assessment, REPORT_LIMITS.text);
  const actions = lines(input.analyst?.actions, REPORT_LIMITS.actions).map((line, index) => {
    const [action, owner, status] = line.split('|').map((part) => part.trim());
    return [String(index + 1), action || '—', owner || '—', status || 'Open'];
  });
  sections.push({ id: 'assessment', eyebrow: 'Assessment · What it means', title: 'Assessment and next steps', blocks: [
    assessment ? { type: 'paragraph', text: assessment } : { type: 'paragraph', text: 'To be completed by the analyst.', tone: 'muted' },
    ...(actions.length ? [{ type: 'subheading', text: 'Follow-up actions' }, { type: 'table', head: ['#', 'Action', 'Owner', 'Status'], widths: [0.06, 0.56, 0.22, 0.16], rows: actions }] : []),
    { type: 'signature', name: plainText(input.cover?.analyst) },
  ] });

  // A Method, sources and limitations
  const source = input.source || {};
  const sourceLine = (() => {
    if (source.kind === 'evidence') return `Evidence graph of report ${plainText(source.evidence?.reportId) || '—'}${source.evidence?.externalReferenceId ? ` (reference ${plainText(source.evidence.externalReferenceId)})` : ''}.`;
    if (source.kind === 'session') return `Source session ${plainText(source.sessionId)}${source.relationship ? `, relationship ${plainText(source.relationship === '*' ? 'All' : source.relationship)}` : ''}.`;
    if (source.fileName) return `Imported graph file ${plainText(source.fileName)}.`;
    return 'A graph built by the analyst in this window.';
  })();
  const shownAll = facts.nodeIds.length >= (input.totals?.nodes ?? 0);
  sections.push({ id: 'method', appendix: 'A', eyebrow: 'Appendix · Method', title: 'Method, sources and limitations', blocks: [
    { type: 'bullets', items: [
      `Source: ${sourceLine}`,
      reportKindOf(input.kind).provenance,
      `Generated ${reportDateTime(generatedAt)} with the ${REPORT_TEMPLATE.name} template (version ${REPORT_TEMPLATE.version}).`,
      shownAll
        ? 'Scope: every entity of the graph was shown.'
        : `Scope: ${count(facts.nodeIds.length)} of ${count(input.totals?.nodes)} entities were shown (display limit, filters or search); figures describe what was shown, not the whole graph.`,
      'Links: the number of distinct entities an entity is directly connected to in the graph; parallel links are counted once.',
      'Bridging entity: an entity whose removal would split a connected part of the graph (a cut point).',
      ...(plainText(input.cover?.systemRule) ? [`System rule: the link analysis rule that flagged this evidence when it was ingested and analysed (${plainText(input.cover.systemRule, 400)}).`] : []),
      'Graph alerts: raised in the graph window by its alert rules (highly connected entities, unusually high-value links) at their configured thresholds, as given on the cover.',
    ] },
  ] });

  // B Entity and link lists (optional)
  if (input.analyst?.includeLists) {
    const nodeRows = facts.nodeIds.slice(0, REPORT_LIMITS.listRows).map((id) => [plainText(nameOf(graph, id)), plainText(id, 60), plainText(nodeTypeOf(graph.getNodeAttributes(id)) || '—'), count(facts.degree.get(id))]);
    const linkRows = facts.edgeIds.slice(0, REPORT_LIMITS.listRows).map((key) => {
      const attributes = graph.getEdgeAttributes(key);
      return [plainText(nameOf(graph, graph.source(key))), plainText(nameOf(graph, graph.target(key))), plainText(typeOfLink(attributes)), plainText(attributes.label ?? '')];
    });
    const cut = (shown, all) => (all > shown ? `The first ${count(shown)} of ${count(all)} are listed.` : undefined);
    sections.push({ id: 'lists', appendix: 'B', eyebrow: 'Appendix · Records', title: 'Entity and link lists', blocks: [
      { type: 'subheading', text: 'Entities' },
      { type: 'table', head: ['Entity', 'ID', 'Type', 'Links'], widths: [0.38, 0.27, 0.23, 0.12], rows: nodeRows, note: cut(nodeRows.length, facts.nodeIds.length) },
      { type: 'subheading', text: 'Links' },
      { type: 'table', head: ['From', 'To', 'Type', 'Label'], widths: [0.3, 0.3, 0.2, 0.2], rows: linkRows, note: cut(linkRows.length, facts.edgeIds.length) },
    ] });
  }

  // Numbering: 1..n for the body, letters for appendices.
  let number = 0;
  sections.forEach((section) => {
    if (section.appendix) section.number = section.appendix;
    else {
      number += 1;
      section.number = String(number);
    }
  });
  return { template: REPORT_TEMPLATE, kind: reportKindOf(input.kind).id, cover, score: reportScore(input.score), sections, generatedAt: generatedAt.toISOString() };
};
