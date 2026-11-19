import { createGraphStore } from '../lib/graphStore.js';
import { systemRulesOf } from '../lib/graphAnalysis.js';
import { downloadBlob } from '../lib/graphFile.js';
import { SNAPSHOT_DEFAULTS } from '../lib/offscreenSnapshot.js';
import { profileOf as nodeProfileOf } from '../lib/nodeProfile.js';
import { buildGraphReport, describeReportDomain, draftFindings, reportDateTime, reportFacts, reportTimeline, DEFAULT_MARKING } from './graphReportModel.js';
import { loadPortrait, rasterizeSvg, renderGraphReportPdf, reportFileName, reportHasEthiopic, svgDataUrl } from './graphReportPdf.js';
import { loadEthiopicFonts } from './reportFonts.js';
import nbeLogoSvg from './nbe_logo.svg?raw';

// Drawing and downloading the graph report, shared by the Graph window
// (Export ▸ Generate report…) and Reports (Download report, from the
// evidence graph without opening a window; graph-chart-plan §3.6).

// input: the report input (graph, view, totals, markers, alerts, …);
// values: the form's values; domain: the cover's domain text; snapshot: a
// data URL or null. Resolves once the file is handed to the browser.
export const downloadGraphReport = async ({ input, values, domain = '', snapshot = null }) => {
  const report = buildGraphReport({
    ...input,
    hasSnapshot: Boolean(snapshot),
    cover: { ...values, domain },
    analyst: { findings: values.findings, assessment: values.assessment, actions: values.actions, includeLists: values.includeLists },
  });
  // The logo as it is: its own colours on a transparent background.
  const logo = await rasterizeSvg(svgDataUrl(nbeLogoSvg));
  // The profile portraits, loaded as images (one that cannot load shows
  // the placeholder).
  const portraitLinks = [...new Set(report.sections.flatMap((section) => section.blocks).filter((block) => block.type === 'profiles').flatMap((block) => block.items.map((item) => item.portrait)).filter(Boolean))];
  const portraits = Object.fromEntries((await Promise.all(portraitLinks.map(async (link) => [link, await loadPortrait(link)]))).filter(([, image]) => image));
  // Noto Sans Ethiopic, only when the report has Ethiopic text.
  const fonts = reportHasEthiopic(report) ? await loadEthiopicFonts() : null;
  const doc = await renderGraphReportPdf(report, { snapshot, logo, portraits, fonts });
  downloadBlob(reportFileName(values.reference, report.kind), doc.output('blob'));
};

// The System Flagged Rule: the evidence report's rules and the rules on the
// graph's own relationships (two layers of flags, analyst decision
// 2026-11-17).
export const systemRuleText = (evidenceRules, graph) => [...new Set([
  ...(Array.isArray(evidenceRules) ? evidenceRules : []),
  ...systemRulesOf(graph).map((entry) => entry.rule),
].map((rule) => String(rule).trim()).filter(Boolean))].slice(0, 20).join(', ');

const EVIDENCE_VIEW_KEY = 'evidence-report';

// An evidence report's title (analyst decision 2026-11-18).
export const evidenceReportTitle = (evidence = {}) => `Evidence Report · ${evidence.externalReferenceId || evidence.reportId || ''}`.replace(/ · $/, '');

// The report of an evidence graph, without a Graph window: every entity and
// relationship of the evidence; no window alerts, pinned items, rules or
// groups. graphData: { nodes, edges }; evidence: the Reports metadata
// ({ traceId, reportId, externalReferenceId, domain, domainDistribution,
// systemRules }); profileSettings: the domain's actor profile settings.
export const evidenceReportContext = ({ graphData, evidence = {}, profileSettings = null, isCdr = false, formatDomain = (key) => key }) => {
  const store = createGraphStore();
  store.replace({ nodes: graphData?.nodes || [], edges: graphData?.edges || [] });
  const graph = store.graph();
  const view = { nodeIds: graph.nodes(), edgeIds: graph.edges(), searched: false, viewKey: EVIDENCE_VIEW_KEY };
  const input = (nameKey = '') => ({
    graph,
    view,
    totals: { nodes: graph.order, edges: graph.size },
    markers: store.getMarkers(EVIDENCE_VIEW_KEY),
    weightKey: '',
    nameKey,
    alerts: [],
    pinned: [],
    rules: [],
    groups: [],
    profileOf: (id) => {
      if (!profileSettings?.enabled) return null;
      const node = store.getNode(id);
      if (!node) return null;
      const profile = nodeProfileOf(node, profileSettings, { isCdr });
      if (!profile.portrait && !profile.fields.some((entry) => entry.value)) return null;
      return { fields: profile.fields.map((entry) => [entry.label, entry.value]), portrait: profile.portrait };
    },
    kind: 'evidence',
    source: { kind: 'evidence', evidence },
    score: evidence.score || null,
    scope: { searched: false, period: null, filtersOff: [] },
  });
  const draft = (nameKey = '') => {
    const facts = reportFacts(graph, view, { markers: input(nameKey).markers });
    return draftFindings({ graph, facts, alerts: [], timeline: reportTimeline(graph, view), nameKey }).join('\n');
  };
  const initial = ({ analyst = '', title = '' } = {}) => ({
    title: title || evidenceReportTitle(evidence),
    caseId: '',
    nameKey: '',
    reference: String(evidence.externalReferenceId || evidence.reportId || ''),
    dateTime: reportDateTime(),
    analyst,
    systemRule: systemRuleText(evidence.systemRules, graph),
    // No Graph window, so no window alert configuration applies.
    graphAlert: 'Not applied (generated from Reports)',
    purpose: `Link analysis of ${graph.order.toLocaleString('en-GB')} entities and ${graph.size.toLocaleString('en-GB')} relationships.`,
    findings: draft(''),
    assessment: '',
    actions: '',
    marking: DEFAULT_MARKING,
    includeLists: false,
  });
  return {
    store,
    input,
    // The report form's Graph options (what the snapshot draws).
    snapshotDefaults: { ...SNAPSHOT_DEFAULTS },
    draft,
    initial,
    nameKeys: store.propertyKeys(),
    domain: describeReportDomain(evidence.domain, evidence.domainDistribution, formatDomain),
  };
};
