// The graph and evidence reports' charts and tables (analyst decision
// 2026-11-19). From a Graph window: every linked Chart window's charts (its
// cards, colours and scope) and every linked Table window's table (its
// rows, filter, columns and sort); with no Chart window linked, the
// automatic chart set, and with no Table window linked, the default
// tables. From Reports (the evidence report): the automatic set and the
// default tables, over the whole evidence graph.

import { reportChartCells } from '../../chart/lib/chartReport.js';
import { normalizeChartState } from '../../chart/lib/chartState.js';
import { defaultTableAppendices, tableAppendix } from '../../table/lib/tableReport.js';

const count = (n) => Number(n || 0).toLocaleString('en-GB');
const SCOPE_NAME = { drawn: 'drawn', selected: 'selected', all: 'whole' };

// store: the graph's store; link: what the graph draws and selects (the
// link bus state: nodeIds, edgeIds, selection, weightKey, timeKey,
// timeSlice); chartWindows / tableWindows: the linked windows ({ title,
// metadata }); nameKey: Identify entities by.
// -> { measures: [{ title, source, cells, skipped }], tables: [appendix] }
export async function graphReportExtras({ store, link, chartWindows = [], tableWindows = [], nameKey = '' }) {
  const measures = [];
  const charted = chartWindows
    .map((item) => ({ item, state: normalizeChartState(item.metadata?.chartState) }))
    .filter(({ state }) => state.cards.length);
  for (const { item, state } of charted) {
    const drawn = await reportChartCells({ store, link, scope: state.scope, cards: state.cards, nameKey });
    measures.push({ ...drawn, title: item.title, source: `The charts of ${item.title} (the analyst's), over the ${SCOPE_NAME[state.scope] || 'drawn'} graph.` });
  }
  if (!charted.length) {
    const drawn = await reportChartCells({ store, link, scope: 'drawn', nameKey });
    measures.push({ ...drawn, title: 'Automatic set', source: `An automatic set of measures over the ${count(link.nodeIds?.length)} entities and ${count(link.edgeIds?.length)} relationships drawn (no Chart window is linked to this graph).` });
  }
  const tables = tableWindows.length
    ? tableWindows.map((item) => tableAppendix({ store, link, tableState: item.metadata?.tableState, title: item.title }))
    : defaultTableAppendices({ store, link, weightKey: link.weightKey || '', timeKey: link.timeKey || '' });
  return { measures, tables };
}

// The evidence report's: the automatic set and the default tables over
// every entity and relationship of the evidence graph.
export async function evidenceReportExtras({ store, nameKey = '' }) {
  const graph = store.graph();
  const link = { nodeIds: graph.nodes(), edgeIds: graph.edges(), selection: { nodes: [], edges: [] }, weightKey: '', timeKey: '', timeSlice: 'auto' };
  const drawn = await reportChartCells({ store, link, scope: 'all', nameKey });
  return {
    measures: [{ ...drawn, title: 'Automatic set', source: `An automatic set of measures over the evidence graph's ${count(graph.order)} entities and ${count(graph.size)} relationships.` }],
    tables: defaultTableAppendices({ store, link, scopeLabel: 'whole' }),
  };
}
