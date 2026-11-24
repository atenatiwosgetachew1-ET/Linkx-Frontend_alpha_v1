import { describe, expect, it } from 'vitest';

import { createGraphStore } from '../lib/graphStore.js';
import { layoutRequestOf, normalizeSnapshotOptions, snapshotView, topNodesView } from '../lib/offscreenSnapshot.js';
import { evidenceReportContext, systemRuleText } from './graphReportExport.js';
import { buildGraphReport } from './graphReportModel.js';
import { renderGraphReportPdf } from './graphReportPdf.js';

const graphData = {
  nodes: [{ id: 'a', label: 'A', full_name: 'Abebe' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }],
  edges: [{ from: 'a', to: 'b', label: 'FUND_FLOW', edge_semantic: 'flow' }, { from: 'a', to: 'c' }, { from: 'c', to: 'd' }],
};

describe('evidenceReportContext', () => {
  it('prefills the report form from the evidence and its whole graph', () => {
    const context = evidenceReportContext({
      graphData,
      evidence: { traceId: 't', reportId: 31, externalReferenceId: 'EV-1', domain: 'all', domainDistribution: [{ domain: 'bank', count: 3 }, { domain: 'cdr', count: 1 }], systemRules: ['SMURFING'] },
      formatDomain: (key) => key.toUpperCase(),
    });
    const initial = context.initial({ analyst: 'Analyst One' });
    expect(initial).toMatchObject({
      reference: 'EV-1',
      analyst: 'Analyst One',
      title: 'Evidence Report · EV-1',
      purpose: 'Link analysis of 4 entities and 3 relationships.',
      graphAlert: 'Not applied (generated from Reports)',
    });
    expect(initial.systemRule.split(', ')[0]).toBe('SMURFING');
    expect(initial.findings).toMatch(/^2 entities share the most connections, 2 others each: A, C\./); // a tie is said as one
    expect(context.draft('full_name')).toMatch(/^2 entities share the most connections, 2 others each: Abebe, C\./);
    expect(context.nameKeys).toContain('full_name');
    expect(context.domain).toBe('ALL (BANK 3 · CDR 1)');
    const input = context.input('');
    expect(input.view.nodeIds).toHaveLength(4);
    expect(input.view.edgeIds).toHaveLength(3);
    expect(input.totals).toEqual({ nodes: 4, edges: 3 });
    expect(input.profileOf('a')).toBeNull(); // no profile settings
  });

  it('joins the evidence rules and the graph rules once', () => {
    const store = createGraphStore();
    store.replace(graphData);
    expect(systemRuleText(['FUND_FLOW', ' FUND_FLOW '], store.graph()).split(', ').filter((rule) => rule === 'FUND_FLOW')).toHaveLength(1);
    expect(systemRuleText(null, createGraphStore().graph())).toBe('');
  });
});

describe('renderGraphReportPdf', () => {
  it('a picture the PDF cannot read costs the picture, not the report', async () => {
    const context = evidenceReportContext({ graphData, evidence: { traceId: 't' } });
    const report = buildGraphReport({ ...context.input(''), hasSnapshot: true, cover: { ...context.initial({}), domain: '' }, analyst: { findings: '', assessment: '', actions: '' } });
    const doc = await renderGraphReportPdf(report, { snapshot: 'data:,' });
    expect(() => doc.getImageProperties('data:,')).toThrow();
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });
});

describe('topNodesView', () => {
  it('keeps the most connected nodes and the links among them', () => {
    const store = createGraphStore();
    store.replace(graphData);
    const view = topNodesView(store.graph(), 2);
    expect(view.nodeIds).toEqual(['a', 'c']);
    expect(view.edgeIds).toHaveLength(1);
    expect(topNodesView(store.graph()).nodeIds).toHaveLength(4);
  });
});

describe('snapshotView', () => {
  const store = createGraphStore();
  store.replace({
    nodes: [{ id: 'a', amount: 5 }, { id: 'b', amount: '1200' }, { id: 'c' }, { id: 'd', amount: 30 }],
    edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }, { from: 'b', to: 'd' }, { from: 'a', to: 'd' }],
  });
  it('orders by connections, arrival or a property (entities without it left out)', () => {
    expect(snapshotView(store.graph(), { order: '__degree', direction: 'desc', amount: 2 }).nodeIds).toEqual(['a', 'b']);
    expect(snapshotView(store.graph(), { order: '__degree', direction: 'asc', amount: 1 }).nodeIds).toEqual(['c']);
    expect(snapshotView(store.graph(), { order: '', amount: 3 }).nodeIds).toEqual(['a', 'b', 'c']);
    expect(snapshotView(store.graph(), { order: 'amount', direction: 'desc', amount: 10 }).nodeIds).toEqual(['b', 'd', 'a']);
    expect(snapshotView(store.graph(), { order: 'amount', direction: 'asc', amount: 2 })).toMatchObject({ nodeIds: ['a', 'd'], edgeIds: [expect.any(String)] });
  });
  it('bounds the options', () => {
    expect(normalizeSnapshotOptions({ amount: '0', layout: 'nope', direction: 'x', flow: 'x', sortMethod: 'x', layerMode: 'x' })).toEqual({
      order: '__degree', direction: 'desc', layout: 'concentric', flow: 'UD', sortMethod: 'directed', layerMode: 'hop_distance', layerKey: '', amount: 250,
    });
    expect(normalizeSnapshotOptions({ amount: 99999 }).amount).toBe(2000);
    // Grouped has no distance: by node type.
    expect(normalizeSnapshotOptions({ layout: 'grouped', layerMode: 'hop_distance' }).layerMode).toBe('node_identity');
  });
  it('lays out as the Graph window: grouped by a property or by type, layered by a property, flow and level order', () => {
    const view = snapshotView(store.graph(), { order: '', amount: 10 });
    const byProperty = layoutRequestOf(store, view, normalizeSnapshotOptions({ layout: 'grouped', layerMode: 'by_key', layerKey: 'amount' }));
    expect(byProperty.type).toBe('grouped');
    expect(byProperty.options.info.a).toEqual({ group: 5 });
    expect(byProperty.options.info.c).toEqual({ group: null });
    const byType = layoutRequestOf(store, view, normalizeSnapshotOptions({ layout: 'grouped', layerMode: 'node_identity', layerKey: 'amount' }));
    expect(byType.options.info.a.group).not.toBe(5);
    const layered = layoutRequestOf(store, view, normalizeSnapshotOptions({ layout: 'layered', flow: 'LR', layerMode: 'by_key', layerKey: 'amount' }));
    expect(layered.options).toMatchObject({ direction: 'LR', layerMode: 'by_key' });
    expect(layered.options.info.d.layerValue).toBe(30);
    const hierarchical = layoutRequestOf(store, view, normalizeSnapshotOptions({ layout: 'hierarchical', sortMethod: 'hubsize' }));
    expect(hierarchical).toMatchObject({ type: 'hierarchical', options: { sortMethod: 'hubsize' } });
    expect(hierarchical.edgePairs).toHaveLength(4);
  });
});
