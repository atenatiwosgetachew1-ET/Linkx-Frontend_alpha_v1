import { describe, expect, it } from 'vitest';

import { createGraphStore } from '../lib/graphStore.js';
import { buildGraphReport, normalizeReportRange, reportRangeCounts, reportRangeOf, describeReportDomain, reportScore, draftFindings, entityName, plainText, reportDateTime, reportFacts, reportTimeline } from './graphReportModel.js';
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
    // Tables: B, C, … in order.
    const table = (title) => ({ title, source: title, columns: [{ label: 'Label', numeric: false }], rows: [['x']], total: 1, note: '' });
    expect(buildGraphReport(baseInput(graphOf(), { tables: [table('Entities'), table('Relationships')] })).sections.slice(-2)).toMatchObject([
      { id: 'table-b', number: 'B', title: 'Table: Entities' },
      { id: 'table-c', number: 'C', title: 'Table: Relationships' },
    ]);
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

  it('subjects: every contributor, no cap (pinned, alerted, bridging); a profile for each; else the most connected stand in', () => {
    // A star of 30 entities, all pinned: all 30 listed, each with its profile.
    const star = createGraphStore();
    star.replace({
      nodes: [{ id: 'hub', label: 'Hub' }, ...Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }))],
      edges: Array.from({ length: 30 }, (_, i) => ({ from: 'hub', to: `n${i}`, relationship: 'PAYMENT' })),
    });
    const pinned = { pinned: { nodes: new Set(Array.from({ length: 30 }, (_, i) => `n${i}`)), edges: new Set() } };
    const report = buildGraphReport(baseInput(star, { markers: pinned, profileOf: (id) => [['Tel', `09-${id}`]] }));
    const subjects = report.sections.find((section) => section.id === 'subjects');
    const rows = subjects.blocks.find((block) => block.type === 'table').rows;
    expect(rows).toHaveLength(31); // the 30 pinned and the hub (a bridge)
    expect(rows.at(-1)[1]).toBe('Hub'); // pinned first
    expect(subjects.blocks.find((block) => block.type === 'profiles').items).toHaveLength(31);
    // Strongest relationships: every pair touching a subject.
    const patterns = report.sections.find((section) => section.id === 'patterns').blocks;
    expect(patterns.find((block, index) => block.type === 'table' && patterns[index - 2]?.text === 'Strongest relationships').rows).toHaveLength(30);
    // Bridging entities: all of them.
    expect(buildGraphReport(baseInput(graphOf())).sections.find((section) => section.id === 'patterns').blocks
      .find((block, index, blocks) => blocks[index - 2]?.text === 'Bridging entities').rows.map((row) => row[0])).toEqual(['Abebe', 'Chala', 'Dawit']);
    // A ring has no bridge: with nothing flagged, the most connected stand in, and say so.
    const ring = createGraphStore();
    ring.replace({
      nodes: Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, label: `R${i}` })),
      edges: Array.from({ length: 20 }, (_, i) => ({ from: `r${i}`, to: `r${(i + 1) % 20}`, relationship: 'CALL' })),
    });
    const standIn = buildGraphReport(baseInput(ring)).sections.find((section) => section.id === 'subjects');
    expect(standIn.blocks[0].text).toBe('No entity is pinned, alerted or bridging; the 15 most connected entities shown stand in.');
    expect(standIn.blocks.find((block) => block.type === 'table').rows).toHaveLength(15);
    // Entities without a link never stand in as "most connected"; with no link at all, none stands out.
    const loose = createGraphStore();
    loose.replace({ nodes: Array.from({ length: 25 }, (_, i) => ({ id: `u${i}`, label: `U${i}` })), edges: [{ from: 'u0', to: 'u1', relationship: 'CALL' }] });
    const looseRows = buildGraphReport(baseInput(loose)).sections.find((section) => section.id === 'subjects').blocks.find((block) => block.type === 'table').rows;
    expect(looseRows.map((row) => row[3])).toEqual(['1', '1']);
    // Type shares add up: past the limit, the rest in one Other row.
    const typed = createGraphStore();
    typed.replace({ nodes: Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, label: `T${i}`, node_identity: `Kind ${i}` })), edges: [] });
    const typeRowsOut = buildGraphReport(baseInput(typed)).sections.find((section) => section.id === 'graph').blocks.find((block) => block.type === 'table').rows;
    expect(typeRowsOut).toHaveLength(12);
    expect(typeRowsOut.at(-1)).toEqual(['Other (3 types)', '3', expect.any(String)]);
    const none = createGraphStore();
    none.replace({ nodes: Array.from({ length: 25 }, (_, i) => ({ id: `z${i}`, label: `Z${i}` })), edges: [] });
    const noneReport = buildGraphReport(baseInput(none));
    const noneSubjects = noneReport.sections.find((section) => section.id === 'subjects');
    expect(noneSubjects.blocks).toEqual([{ type: 'paragraph', text: 'No entity is pinned, alerted or bridging, and none of the 25 entities shown has a link, so none stands out.' }]);
  });

  it('range: each part within its limit, the cut always said; none given: everything', () => {
    const star = createGraphStore();
    star.replace({
      nodes: [{ id: 'hub', label: 'Hub' }, ...Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `N${i}` }))],
      edges: Array.from({ length: 30 }, (_, i) => ({ from: 'hub', to: `n${i}`, relationship: 'PAYMENT' })),
    });
    const pinned = { pinned: { nodes: new Set(Array.from({ length: 30 }, (_, i) => `n${i}`)), edges: new Set() } };
    const table = { title: 'Entities', source: 'Every entity drawn', columns: [{ label: 'Label', numeric: false }], rows: Array.from({ length: 40 }, (_, i) => [`R${i}`]), total: 40, note: '' };
    const input = baseInput(star, { markers: pinned, profileOf: (id) => [['Tel', `09-${id}`]], tables: [table] });
    expect(reportRangeCounts(input)).toEqual({ subjects: 31, profiles: 31, strongest: 30 });
    const brief = buildGraphReport({ ...input, range: reportRangeOf('brief') });
    const subjects = brief.sections.find((section) => section.id === 'subjects').blocks;
    expect(subjects.find((block) => block.type === 'table').rows).toHaveLength(10);
    expect(subjects[0].text).toMatch(/The first 10 of 31 entities are listed \(pinned first, then alerted, then the most connected\)\.$/);
    expect(subjects.find((block) => block.type === 'profiles').items).toHaveLength(4);
    expect(subjects.find((block) => block.text?.startsWith('The first 4 of 31 profiles'))).toBeTruthy();
    const patterns = brief.sections.find((section) => section.id === 'patterns').blocks;
    const strongestAt = patterns.findIndex((block) => block.text === 'Strongest relationships');
    expect(patterns[strongestAt + 1].text).toMatch(/\(30\), the most links first\. The first 10 of 30 pairs are listed/);
    expect(patterns[strongestAt + 2].rows).toHaveLength(10);
    const appendix = brief.sections.find((section) => section.id === 'table-b').blocks.find((block) => block.type === 'wideTable');
    expect(appendix.rows).toHaveLength(25); // 25 rows a table in Brief
    expect(appendix.note).toBe("The first 25 of 40 rows are listed (in the table's order).");
    const custom = buildGraphReport({ ...input, range: { preset: 'custom', subjects: null, profiles: null, strongest: null, rows: 15 } });
    const cut = custom.sections.find((section) => section.id === 'table-b').blocks.find((block) => block.type === 'wideTable');
    expect(cut.rows).toHaveLength(15);
    expect(cut.note).toBe("The first 15 of 40 rows are listed (in the table's order).");
    // None given: everything, nothing said.
    const full = buildGraphReport(input);
    expect(full.sections.find((section) => section.id === 'subjects').blocks.find((block) => block.type === 'profiles').items).toHaveLength(31);
    expect(full.sections.find((section) => section.id === 'subjects').blocks[0].text).not.toMatch(/The first/);
    expect(normalizeReportRange({ subjects: '0', profiles: 'x', strongest: 7.6, rows: '' })).toEqual({ preset: 'full', subjects: null, profiles: null, strongest: 7, rows: null });
  });

  it('findings: the analyst\'s lines win; else a factual draft, marked as such', () => {
    const store = graphOf();
    const facts = reportFacts(store.graph(), viewOf(store), { weightKey: 'AMOUNT' });
    const draft = draftFindings({ graph: store.graph(), facts, timeline: reportTimeline(store.graph(), viewOf(store)) });
    expect(draft[0]).toBe('3 entities share the most connections, 2 others each: Abebe, Chala, Dawit.'); // a tie: none picked out
    // A single leader is named alone.
    const solo = graphOf();
    solo.addEdge('a', 'e', { relationship: 'CALL' });
    const soloFacts = reportFacts(solo.graph(), viewOf(solo), {});
    expect(draftFindings({ graph: solo.graph(), facts: soloFacts })[0]).toBe('Abebe is the most connected entity, linked to 3 others.');
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
      analyst: { actions: 'Freeze | Ops | Open' },
    }));
    const doc = await renderGraphReportPdf(report, {});
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(report.sections.length + 1);
    expect(doc.output('blob').size).toBeGreaterThan(5000);
  });

  it('Measures and the table appendix: the chart cells two across; a wide table continues its columns on the next pages, Label repeated', async () => {
    const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const labels = ['Label', ...Array.from({ length: 11 }, (_, index) => `Field ${index}`)];
    const report = buildGraphReport(baseInput(graphOf(), {
      measures: [{ title: 'Automatic set', source: 'An automatic set.', cells: [1, 2, 3].map((n) => ({ title: `Chart ${n}`, level: 'Node', image: pixel })), skipped: ['Heat Matrix: no dates.'] }],
      tables: [{ title: 'Nodes', source: 'Table 1 · Nodes · All scope', columns: labels.map((label) => ({ label, numeric: false })), rows: Array.from({ length: 4 }, (_, row) => labels.map((label) => `${label} value ${row}`)), total: 4, note: '' }],
    }));
    const measures = report.sections.find((section) => section.id === 'measures');
    expect(measures.number).toBeTruthy();
    expect(report.sections.find((section) => section.id === 'table-b').appendix).toBe('B');
    const doc = await renderGraphReportPdf(report, {});
    const pages = Array.from({ length: doc.getNumberOfPages() }, (_, index) => doc.internal.pages[index + 1].join('\n'));
    // The three chart pictures drawn (images on the Measures page).
    expect(pages.join('\n').match(/\/I\d+ Do/g).length).toBeGreaterThanOrEqual(3);
    expect(pages.join('\n')).toContain('(Not charted: Heat Matrix: no dates.) Tj');
    // The wide table: its last column on a later page than its first, Label on both.
    const first = pages.findIndex((page) => page.includes('(Field 0) Tj'));
    const last = pages.findIndex((page) => page.includes('(Field 10) Tj'));
    expect(last).toBeGreaterThan(first);
    expect(pages[first]).toContain('(Label) Tj');
    expect(pages[last]).toContain('(Label) Tj');
  });

  it('carries CONFIDENTIAL across every page but the cover, at 45 degrees and faint', async () => {
    const report = buildGraphReport(baseInput(graphOf(), {}));
    const doc = await renderGraphReportPdf(report, {});
    const pages = doc.getNumberOfPages();
    // The cover: no watermark.
    expect(doc.internal.pages[1].join('\n')).not.toMatch(/0\.7071\d* 0\.7071\d* -0\.7071\d* 0\.7071\d* [\d.]+ [\d.]+ Tm\n\(CONFIDENTIAL\) Tj/);
    for (let page = 2; page <= pages; page += 1) {
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
    const report = buildGraphReport(baseInput(store, { nameKey: 'ACCOUNT_NO', markers: { pinned: { nodes: new Set(['b']), edges: new Set() } } }));
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
