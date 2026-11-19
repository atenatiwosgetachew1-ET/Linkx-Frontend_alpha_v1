// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { WorkspaceProvider } from '../../../workspace/state/WorkspaceContext.jsx';
import { NotificationProvider } from '../../../shared/notifications/NotificationContext.jsx';
import { SessionContext } from '../../../shared/session/sessionContext.js';
import { WORKSPACE_WINDOW_TYPES } from '../../../workspace/state/workspaceTypes.js';
import { useWorkspace } from '../../../workspace/hooks/useWorkspace.js';
import { cacheEvidenceGraph } from '../../reports/lib/evidenceGraphs.js';
import { getGraphStore } from '../../graph/lib/graphStore.js';
import { getGraphState } from '../../graph/lib/graphLinkBus.js';

vi.mock('../../graph/components/GraphCanvas.jsx', () => ({
  default: React.forwardRef(function Probe(props, ref) {
    React.useImperativeHandle(ref, () => ({ select: () => {}, focusOn: () => {}, fit: () => {} }));
    return <div data-testid="canvas" />;
  }),
}));
vi.mock('../../../shared/device/gpuCapability.js', async (orig) => ({ ...(await orig()), getGpuCapability: vi.fn(() => ({ verdict: 'capable', reasons: [] })) }));
const charts = [];
vi.mock('../lib/echarts.js', () => ({ default: { init: () => { const h = {}; const c = { h, setOption() {}, on(n, f) { h[n] = f; }, resize() {}, dispose() {}, dispatchAction() {}, isDisposed: () => false }; charts.push(c); return c; } } }));
const metrics = await import('../../graph/lib/layoutClient.js');
const { default: GraphWindowBody } = await import('../../graph/components/GraphWindowBody.jsx');
const { default: ChartWindowBody } = await import('./ChartWindowBody.jsx');

function Both({ scope }) {
  const { windows, openWindow } = useWorkspace();
  React.useEffect(() => {
    openWindow(WORKSPACE_WINDOW_TYPES.GRAPH, { id: 'graph-1', title: 'Graph', metadata: { evidence: { traceId: 'tr-1', reportId: 5 } } });
    openWindow(WORKSPACE_WINDOW_TYPES.CHART, { id: 'chart-1', title: 'Chart', metadata: { chartGraph: 'graph-1', chartState: { mode: 'manual', scope } } });
  }, [openWindow, scope]);
  const g = windows.find((w) => w.id === 'graph-1');
  const c = windows.find((w) => w.id === 'chart-1');
  return <>{g ? <GraphWindowBody windowItem={g} /> : null}{c ? <ChartWindowBody windowItem={c} /> : null}</>;
}

// The real Graph window (its canvas a probe) beside the real Chart window: a
// click on a chart's bar selects on the graph, which reveals the entity when
// it is not drawn (analyst report 2026-11-18: that recomputed every chart,
// "Computing…" on each card). Showing a node is not a data change.
describe.each(['drawn', 'all'])('a chart click with the real Graph window (scope %s)', (scope) => {
  it('selects without recomputing any chart', async () => {
    charts.length = 0;
    cacheEvidenceGraph('tr-1', { data: {}, nodes: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, label: `N${i + 1}` })), edges: Array.from({ length: 39 }, (_, i) => ({ from: 1, to: i + 2 })) });
    const requests = vi.spyOn(metrics, 'requestChartMetric');
    const view = render(<NotificationProvider><SessionContext.Provider value={{ apiFetch: vi.fn(), configuration: { active_domain: 'bank' } }}><WorkspaceProvider><Both scope={scope} /></WorkspaceProvider></SessionContext.Provider></NotificationProvider>);
    await waitFor(() => expect(getGraphState('graph-1').nodeIds.length).toBeGreaterThan(0));
    await userEvent.click(await screen.findByRole('button', { name: 'New chart' }));
    await userEvent.click(within(screen.getByRole('menu', { name: 'New chart' })).getByRole('menuitem', { name: 'Degree Centrality' }));
    await waitFor(() => expect(charts.length).toBe(1));
    await new Promise((r) => setTimeout(r, 200));
    const store = getGraphStore('graph-1');
    const s0 = store.getSnapshot();
    const n0 = getGraphState('graph-1').nodeIds.length;
    const before = requests.mock.calls.length;
    const seen = [];
    const observer = new MutationObserver(() => { if (document.body.textContent.includes('Computing')) seen.push('computing'); });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    // The last bar (lowest degree; for All, likely an entity not drawn).
    act(() => charts[0].h.click({ dataIndex: 39, event: { event: {} } }));
    await new Promise((r) => setTimeout(r, 400));
    observer.disconnect();
    const s1 = store.getSnapshot();
    expect(requests.mock.calls.length - before).toBe(0);
    expect(seen).toEqual([]);
    expect(s1.dataVersion).toBe(s0.dataVersion);
    // All: the entity was not drawn, so the graph revealed it.
    if (scope === 'all') expect(getGraphState('graph-1').nodeIds.length).toBe(n0 + 1);
    requests.mockRestore();
    view.unmount();
    cleanup();
  });
});
