import { describe, expect, it } from 'vitest';

import { createGraphStore } from '../lib/graphStore.js';
import { buildGraphReport, describeReportDomain, reportScore, draftFindings, entityName, plainText, reportDateTime, reportFacts, reportTimeline } from './graphReportModel.js';
import { pdfText, renderGraphReportPdf } from './graphReportPdf.js';

// A hub (a) paying b three times and c once; c - d - e a chain (c and d
// bridge); f alone. Dates on the payments.
const graphOf = () => {
  const store = createGraphStore();
  store.replace({
    nodes: [
      { id: 'a', label: 'Abebe', node_identity: 'Person', phone: '0911' },
      { id: 'b', label: 'Bekele', node_identity: 'Person' },
      { id: 'c', label: 'Chala', node_identity: 'Account' },
      { id: 'd', label: 'Dawit', node_identity: 'Account' },
      { id: 'e', label: 'Eyerus', node_identity: 'Person' },
      { id: 'f', label: 'Fikru', node_identity: 'Person' },
    ],
    edges: [
      { from: 'a', to: 'b', relationship: 'PAYMENT', AMOUNT: '1,000', TRANSACTIONDATE: '2026-01-05' },
      { from: 'a', to: 'b', relationship: 'PAYMENT', AMOUNT: 2500, TRANSACTIONDATE: '2026-01-06' },
      { from: 'b', to: 'a', relationship: 'PAYMENT', AMOUNT: 500, TRANSACTIONDATE: '2026-02-01' },
      { from: 'a', to: 'c', relationship: 'PAYMENT', AMOUNT: 100, TRANSACTIONDATE: '2026-01-07' },
      { from: 'c', to: 'd', relationship: 'CALL' },
      { from: 'd', to: 'e', relationship: 'CALL' },
    ],
  });
  return store;
};
const viewOf = (store) => ({ nodeIds: store.graph().nodes(), edgeIds: store.graph().edges(), searched: false });
const baseInput = (store, extra = {}) => ({
  graph: store.graph(),
  view: viewOf(store),
  totals: { nodes: 10, edges: 6 },
  weightKey: 'AMOUNT',
  cover: { title: 'Case 7', reference: '001', analyst: 'A. Analyst', systemRule: 'Smurfing', graphAlert: 'High-degree: 3+ links (high from 8)', purpose: 'Why.', marking: '' },
  analyst: {},
  source: { kind: 'evidence', evidence: { reportId: 42, externalReferenceId: 'R-42' } },
  generatedAt: new Date(2026, 10, 17, 9, 5),
  ...extra,
});

describe('graph report model (G4.2)', () => {
  it('facts: links, parts, bridges, pairs with totals', () => {
    const store = graphOf();
    const facts = reportFacts(store.graph(), viewOf(store), { weightKey: 'AMOUNT' });
    expect(facts.degree.get('a')).toBe(2);
    expect(facts.components).toEqual([5, 1]);
    expect(facts.isolated).toBe(1);
    expect([...facts.bridges].sort()).toEqual(['a', 'c', 'd']);
    const ab = facts.pairs.find((pair) => pair.count === 3);
    expect(ab.total).toBe(4000);
  });

  it('cover: Case ID and the analyst\'s four fields, NBE header, date and time dd/mm/yy HH:mm', () => {
    const report = buildGraphReport(baseInput(graphOf(), { cover: { title: 'T', caseId: 'CASE-14', reference: '001', analyst: 'A. Analyst', systemRule: 'Rapid Movement of Funds', graphAlert: 'Graph alerts off' } }));
    expect(report.cover.header).toBe('NBE');
    expect(report.cover.fields).toEqual([
      ['Case ID', 'CASE-14'],
      ['Analysis Reference ID', '001'],
      ['Date & Time of Report', '17/11/26 09:05'],
      ['Analyst / Investigator Details', 'A. Analyst'],
      ['System Flagged Rule', 'Rapid Movement of Funds'],
      ['Graph Alert', 'Graph alerts off'],
    ]);
    expect(reportDateTime(new Date(2026, 0, 2, 3, 4))).toBe('02/01/26 03:04');
  });

  it('sections round the investigation; those with nothing to show are left out', () => {
    const report = buildGraphReport(baseInput(graphOf()));
    expect(report.sections.map((section) => `${section.number} ${section.id}`)).toEqual([
      '1 summary', '2 graph', '3 subjects', '4 patterns', '5 timeline', '6 assessment', 'A method',
    ]);
    // No alerts, pinned items or rules: no indicators section.
    const withAlerts = buildGraphReport(baseInput(graphOf(), { alerts: [{ name: 'Abebe', category: 'Highly connected', severity: 'high', short: 'Hub.' }] }));
    expect(withAlerts.sections.map((section) => section.id)).toContain('indicators');
    expect(buildGraphReport(baseInput(graphOf(), { analyst: { includeLists: true } })).sections.at(-1)).toMatchObject({ id: 'lists', number: 'B' });
  });

  it('subjects: pinned first, then the most connected; profiles from the mapping', () => {
    const store = graphOf();
    const markers = { pinned: { nodes: new Set(['e']), edges: new Set() } };
    const report = buildGraphReport(baseInput(store, { markers, profileOf: (id) => (id === 'a' ? [['Tel', '0911']] : null) }));
    const subjects = report.sections.find((section) => section.id === 'subjects');
    const table = subjects.blocks.find((block) => block.type === 'table');
    expect(table.rows.map((row) => row[1]).slice(0, 3)).toEqual(['Eyerus', 'Abebe', 'Chala']);
    expect(table.rows[0][4]).toBe('Pinned');
    expect(subjects.blocks.find((block) => block.type === 'profiles').items).toEqual([expect.objectContaining({ name: 'Abebe', fields: [['Tel', '0911']], portrait: '' })]);
    // The actor profile: unknown fields read "—"; only image links are kept as the portrait.
    const withPortrait = buildGraphReport(baseInput(store, { markers, profileOf: (id) => (id === 'a' ? { fields: [['Tel', '0911'], ['Address', '']], portrait: 'https://img.example/a.jpg' } : { fields: [['Tel', '']], portrait: 'javascript:alert(1)' }) }));
    const items = withPortrait.sections.find((section) => section.id === 'subjects').blocks.find((block) => block.type === 'profiles').items;
    expect(items[0]).toMatchObject({ fields: [['Tel', '0911'], ['Address', '—']], portrait: 'https://img.example/a.jpg' });
    expect(items).toHaveLength(1); // the others know nothing (and a script link is no portrait)
  });

  it('findings: the analyst\'s lines win; else a factual draft, marked as such', () => {
    const store = graphOf();
    const facts = reportFacts(store.graph(), viewOf(store), { weightKey: 'AMOUNT' });
    const draft = draftFindings({ graph: store.graph(), facts, timeline: reportTimeline(store.graph(), viewOf(store)) });
    expect(draft[0]).toMatch(/is the most connected entity/);
    expect(draft[1]).toBe('The strongest relationship is between Abebe and Bekele: 3 links, totalling 4,000.');
    expect(draft.some((line) => line.startsWith('Dated activity runs from'))).toBe(true);
    const summary = (report) => report.sections[0].blocks;
    expect(summary(buildGraphReport(baseInput(store))).some((block) => block.text === 'Drafted from the graph; to be confirmed by the analyst.')).toBe(true);
    const typed = buildGraphReport(baseInput(store, { analyst: { findings: 'One\n\n Two ' } }));
    expect(summary(typed).find((block) => block.type === 'bullets').items).toEqual(['One', 'Two']);
  });

  it('assessment and actions: "action | owner | status"; an empty assessment is marked', () => {
    const report = buildGraphReport(baseInput(graphOf(), { analyst: { assessment: '', actions: 'Freeze account | Ops\nCall bank' } }));
    const assessment = report.sections.find((section) => section.id === 'assessment');
    expect(assessment.blocks[0]).toMatchObject({ text: 'To be completed by the analyst.', tone: 'muted' });
    expect(assessment.blocks.find((block) => block.type === 'table').rows).toEqual([['1', 'Freeze account', 'Ops', 'Open'], ['2', 'Call bank', '—', 'Open']]);
    expect(assessment.blocks.at(-1)).toEqual({ type: 'signature', name: 'A. Analyst' });
  });

  it('method states the scope honestly when not everything was shown', () => {
    const method = buildGraphReport(baseInput(graphOf())).sections.find((section) => section.id === 'method');
    expect(method.blocks[0].items[0]).toBe('Source: Evidence graph of report 42 (reference R-42).');
    expect(method.blocks[0].items[3]).toMatch(/6 of 10 entities were shown/);
    expect(method.blocks[0].items[1]).toMatch(/^Provenance: a Graph Report/);
  });

  it('text is plain and bounded', () => {
    expect(plainText('a\u0000b\u0007c  ')).toBe('abc');
    expect(plainText('x'.repeat(500))).toHaveLength(300);
  });
});

describe('graph report PDF (G4.2)', () => {
  it('maps text to what the standard fonts draw', () => {
    expect(pdfText('A — B · “q” ≥ 2 …')).toBe('A - B · "q" >= 2 ...');
    // Ethiopic is kept (drawn in Noto Sans Ethiopic); other scripts are not.
    expect(pdfText('ሰላም Abebe')).toBe('ሰላም Abebe');
    expect(pdfText('Ж 中')).toBe('? ?');
  });

  it('renders the cover and one page or more per section, with the contents filled in', async () => {
    const store = graphOf();
    const report = buildGraphReport(baseInput(store, {
      alerts: [{ name: 'Abebe', category: 'Highly connected', severity: 'high', short: 'Hub.' }],
      analyst: { includeLists: true, actions: 'Freeze | Ops | Open' },
    }));
    const doc = await renderGraphReportPdf(report, {});
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(report.sections.length + 1);
    expect(doc.output('blob').size).toBeGreaterThan(5000);
  });

  it('carries CONFIDENTIAL across every page, at 45 degrees and faint', async () => {
    const report = buildGraphReport(baseInput(graphOf(), {}));
    const doc = await renderGraphReportPdf(report, {});
    const pages = doc.getNumberOfPages();
    for (let page = 1; page <= pages; page += 1) {
      const content = doc.internal.pages[page].join('\n');
      // The text, rotated 45 degrees (cos = sin = 0.7071), in a faint state.
      expect(content).toMatch(/\(CONFIDENTIAL\) Tj/);
      expect(content).toMatch(/0\.7071\d* 0\.7071\d* -0\.7071\d* 0\.7071\d* [\d.]+ [\d.]+ Tm\n\(CONFIDENTIAL\) Tj/);
      expect(content).toMatch(/\/GS\d+ gs/);
    }
  });
});

describe('graph report naming (G4.2)', () => {
  it('names entities by the chosen column, else the label, else the id', () => {
    const store = graphOf();
    store.updateNodes([['b', { ACCOUNT_NO: '1000-22' }]]);
    expect(entityName(store.graph(), 'b', 'account_no')).toBe('1000-22');
    expect(entityName(store.graph(), 'a', 'ACCOUNT_NO')).toBe('Abebe');
    expect(entityName(store.graph(), 'gone')).toBe('gone');
    const report = buildGraphReport(baseInput(store, { nameKey: 'ACCOUNT_NO' }));
    const findings = report.sections[0].blocks.find((block) => block.type === 'bullets').items;
    expect(findings[1]).toBe('The strongest relationship is between Abebe and 1000-22: 3 links, totalling 4,000.');
    const subjects = report.sections.find((section) => section.id === 'subjects').blocks.find((block) => block.type === 'table');
    expect(subjects.rows.map((row) => row[1])).toContain('1000-22');
  });

});

describe('describeReportDomain', () => {
  const labelOf = (key) => ({ all: 'All', bank: 'Banking', microfinance: 'Microfinance', cdr: 'CDR' })[key] || key;
  it('adds the distribution when the evidence spans several domains', () => {
    expect(describeReportDomain('all', [{ domain: 'bank', count: 1200 }, { domain: 'microfinance', count: 3 }], labelOf)).toBe('All (Banking 1,200 · Microfinance 3)');
    expect(describeReportDomain('all', [{ domain: 'bank', count: 0.6 }, { domain: 'cdr', count: 0.4 }], labelOf)).toBe('All (Banking 60% · CDR 40%)');
    expect(describeReportDomain('all', [{ domain: 'bank', count: null }, { domain: 'cdr', count: null }], labelOf)).toBe('All (Banking · CDR)');
    expect(describeReportDomain('', [{ domain: 'bank', count: 2 }, { domain: 'cdr', count: 1 }], labelOf)).toBe('All (Banking 2 · CDR 1)');
  });
  it('shows the domain alone when there is one', () => {
    expect(describeReportDomain('bank', [{ domain: 'bank', count: 9 }], labelOf)).toBe('Banking');
    expect(describeReportDomain('microfinance', [], labelOf)).toBe('Microfinance');
    expect(describeReportDomain('', [{ domain: 'cdr', count: 4 }], labelOf)).toBe('CDR');
    expect(describeReportDomain('all', [], labelOf)).toBe('All');
    expect(describeReportDomain('', [], labelOf)).toBe('');
  });
});

describe('reportScore', () => {
  it('keeps the band, else derives it from the score', () => {
    expect(reportScore({ value: '92', band: 'FATAL' })).toEqual({ value: '92', band: 'fatal' });
    expect(reportScore({ value: '55' })).toEqual({ value: '55', band: 'high' });
    expect(reportScore({ value: '12' }).band).toBe('low');
    expect(reportScore({ value: '64%' })).toEqual({ value: '64%', band: 'high' });
    expect(reportScore({ value: 'n/a' })).toEqual({ value: 'n/a', band: '' });
    expect(reportScore({ value: '' })).toBeNull();
    expect(reportScore(null)).toBeNull();
  });
});

describe('report kinds', () => {
  it('names the Graph Report and the Evidence Report apart', async () => {
    const { reportFileName } = await import('./graphReportPdf.js');
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 'a' }], edges: [] });
    const graph = store.graph();
    const base = { graph, view: { nodeIds: ['a'], edgeIds: [], searched: false }, totals: { nodes: 1, edges: 0 }, source: { kind: 'evidence' } };
    const method = (report) => report.sections.find((section) => section.id === 'method').blocks[0].items.join(' ');
    const evidence = buildGraphReport({ ...base, kind: 'evidence', cover: {} });
    expect(evidence.kind).toBe('evidence');
    expect(evidence.cover.title).toBe('Evidence Report');
    expect(method(evidence)).toMatch(/Provenance: an Evidence Report, drawn from the evidence record as the Service analysed it/);
    const graphReport = buildGraphReport({ ...base, cover: {} });
    expect(graphReport.kind).toBe('graph');
    expect(graphReport.cover.title).toBe('Graph Report');
    expect(method(graphReport)).toMatch(/Provenance: a Graph Report, drawn from a Graph window/);
    expect(reportFileName('EV 1', 'evidence')).toMatch(/^LinkxEvidence_Report_EV_1_\d+\.pdf$/);
    expect(reportFileName('', 'graph')).toMatch(/^LinkxGraph_Report_\d+\.pdf$/);
  });
});

describe('Ethiopic text', () => {
  const ethiopicReport = () => {
    const store = createGraphStore();
    store.replace({ nodes: [{ id: 'a', label: 'አበበ ከበደ' }, { id: 'b', label: 'Bekele' }], edges: [{ from: 'a', to: 'b' }] });
    const graph = store.graph();
    return buildGraphReport({ graph, view: { nodeIds: ['a', 'b'], edgeIds: graph.edges(), searched: false }, totals: { nodes: 2, edges: 1 }, source: { kind: 'evidence' }, cover: { analyst: 'ሰላም' } });
  };
  it('embeds Noto Sans Ethiopic when the report has Ethiopic text and fonts are given', async () => {
    const { readFileSync } = await import('node:fs');
    const fontFile = (name) => readFileSync(new URL(`./fonts/${name}`, import.meta.url)).toString('base64');
    const fonts = { regular: fontFile('NotoSansEthiopic-Regular.ttf'), bold: fontFile('NotoSansEthiopic-Bold.ttf') };
    const { reportHasEthiopic } = await import('./graphReportPdf.js');
    const report = ethiopicReport();
    expect(reportHasEthiopic(report)).toBe(true);
    const withFont = (await renderGraphReportPdf(report, { fonts })).output();
    expect(withFont).toMatch(/\/BaseFont \/NotoSansEthiopic/);
    // Not embedded without Ethiopic text, even when the fonts are given.
    const latin = buildGraphReport({ graph: createGraphStore().graph(), view: { nodeIds: [], edgeIds: [], searched: false }, totals: { nodes: 0, edges: 0 }, source: { kind: 'evidence' }, cover: {} });
    expect(reportHasEthiopic(latin)).toBe(false);
    expect((await renderGraphReportPdf(latin, { fonts })).output()).not.toMatch(/NotoSansEthiopic/);
  });
  it('still draws the report without the fonts (Ethiopic then prints "?")', async () => {
    const doc = await renderGraphReportPdf(ethiopicReport());
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expect(doc.output()).not.toMatch(/NotoSansEthiopic/);
  });
});
