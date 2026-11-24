// G0 renderer benchmark (docs/graph-chart-plan.md §3.2 / §5 G0).
// Developer-only page: open the app with `?graph-bench` in a dev build (or a
// build made with VITE_GRAPH_BENCH=true). Needs no backend and no sign-in.
//
// Measures, for Cytoscape canvas (default) and Cytoscape WebGL (opt-in):
// first paint, pan/zoom smoothness, PNG export, mode switch; and layout time
// in workers (ForceAtlas2 via graphology, layered via ELK). Results are copied
// as JSON to paste back into the plan.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import cytoscape from 'cytoscape';
import ELK from 'elkjs/lib/elk-api.js';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';

import '../../styles/themes/index.css';
import '../../main.css';
import '../../styles/features/benchmark.css';
import { BenchmarkCard, BenchmarkFrame } from '../../features/graph/components/BenchmarkFrame.jsx';
import { ThemeProvider } from '../../shared/theme/ThemeContext.jsx';
import { getGpuCapability } from '../../shared/device/gpuCapability.js';
import { makeStyleSample, makeSyntheticGraph } from '../../features/graph/lib/syntheticGraph.js';

const SIZES = [300, 1000, 5000, 20000];
// Canvas "fast": Cytoscape's standard viewport optimisations for the CPU path
// (cached texture while panning/zooming, edges hidden while moving, pixel
// ratio capped at 1). Run 1 measured plain canvas only (v2 adds this).
const MODE_OPTIONS = {
  canvas: {},
  'canvas-fast': { textureOnViewport: true, hideEdgesOnViewport: true, pixelRatio: 1, motionBlur: false },
  webgl: { renderer: { name: 'canvas', webgl: true } },
};
// Realistic export: the longest side is capped (report snapshots and PNG
// downloads), unlike run 1's unbounded 2x full-graph export.
const PNG_MAX_SIDE = 4096;
const FPS_MS = 3000;
const raf = () => new Promise((resolve) => requestAnimationFrame(resolve));
const round = (value, digits = 1) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);
const heapMb = () => (performance.memory ? round(performance.memory.usedJSHeapSize / 1048576, 0) : null);

const buildStyle = ({ labels }) => [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)',
      shape: 'data(shape)',
      width: 'data(size)',
      height: 'data(size)',
      'border-width': 1.3,
      'border-color': '#555',
      label: labels ? 'data(label)' : '',
      'font-size': 9,
      color: '#334155',
      'min-zoomed-font-size': 8,
    },
  },
  { selector: 'node[icon != ""]', style: { 'background-image': 'data(icon)', 'background-fit': 'contain', 'background-color': '#e2e8f0' } },
  {
    selector: 'edge',
    style: {
      'line-color': 'data(color)',
      'line-style': 'data(style)',
      width: 'data(width)',
      'target-arrow-shape': 'data(arrow)',
      'target-arrow-color': 'data(color)',
      'arrow-scale': 0.8,
    },
  },
  { selector: ':selected', style: { 'border-color': '#f97316', 'border-width': 3, 'line-color': '#f97316', 'target-arrow-color': '#f97316' } },
];

const toElements = (graph, positions) => [
  ...graph.nodes.map((node, i) => ({
    group: 'nodes',
    data: node,
    position: positions instanceof Float32Array
      ? { x: positions[i * 2], y: positions[i * 2 + 1] }
      : positions[node.id],
  })),
  ...graph.edges.map((edge) => ({ group: 'edges', data: edge })),
];

// Cytoscape's destroy() does not release its WebGL context. Chrome allows
// only a limited number per page and, after repeated losses, blocks WebGL for
// the site until restart (seen in G0 run 2). Release it explicitly.
const destroyGraph = (cy) => {
  if (!cy) return;
  const canvases = cy.container() ? [...cy.container().querySelectorAll('canvas')] : [];
  cy.destroy();
  canvases.forEach((canvas) => {
    // getContext returns the context the canvas already has, or null.
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  });
};

// One reusable layout worker; requests are matched by id.
let layoutWorker = null;
let layoutSeq = 0;
const runWorkerLayout = (graph, layout, iterations) => new Promise((resolve, reject) => {
  if (!layoutWorker) layoutWorker = new Worker(new URL('./layout.worker.js', import.meta.url), { type: 'module' });
  const requestId = ++layoutSeq;
  const onMessage = (event) => {
    if (event.data.requestId !== requestId) return;
    layoutWorker.removeEventListener('message', onMessage);
    resolve(event.data);
  };
  layoutWorker.addEventListener('message', onMessage);
  layoutWorker.addEventListener('error', reject, { once: true });
  layoutWorker.postMessage({
    requestId,
    layout,
    iterations,
    nodeIds: graph.nodes.map((node) => node.id),
    edges: graph.edges.map((edge) => [edge.source, edge.target]),
  });
});

const elk = new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
const runElkLayered = async (graph, timeoutMs = 60000) => {
  const start = performance.now();
  const layout = elk.layout({
    id: 'root',
    layoutOptions: { 'elk.algorithm': 'layered', 'elk.direction': 'DOWN', 'elk.layered.spacing.nodeNodeBetweenLayers': '40' },
    children: graph.nodes.map((node) => ({ id: node.id, width: 20, height: 20 })),
    edges: graph.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  });
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), timeoutMs));
  const result = await Promise.race([layout, timeout]);
  return { ms: performance.now() - start, timedOut: result === 'timeout' };
};

// Main-thread blocking while something runs (Chromium only).
const watchLongTasks = () => {
  const entries = [];
  let observer = null;
  try {
    observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
    observer.observe({ type: 'longtask', buffered: false });
  } catch {
    return () => ({ supported: false });
  }
  return () => {
    observer.disconnect();
    return { supported: true, count: entries.length, maxMs: round(Math.max(0, ...entries.map((entry) => entry.duration)), 0) };
  };
};

function GraphBenchPage() {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const [gpu, setGpu] = useState(() => getGpuCapability({ force: true }));
  const [mode, setMode] = useState('canvas');
  const [labels, setLabels] = useState(false);
  const [size, setSize] = useState(1000);
  const [running, setRunning] = useState('');
  const [results, setResults] = useState([]);
  const [log, setLog] = useState([]);
  const [checks, setChecks] = useState({});
  const say = (line) => setLog((current) => [...current.slice(-200), `${new Date().toLocaleTimeString()}  ${line}`]);
  const add = (row) => setResults((current) => [...current, row]);

  useEffect(() => () => destroyGraph(cyRef.current), []);

  const mount = async ({ graph, positions, renderMode, withLabels = labels }) => {
    destroyGraph(cyRef.current);
    cyRef.current = null;
    await raf();
    const heapBefore = heapMb();
    const start = performance.now();
    const cy = cytoscape({
      container: containerRef.current,
      elements: toElements(graph, positions),
      style: buildStyle({ labels: withLabels }),
      layout: { name: 'preset' },
      wheelSensitivity: 0.3,
      boxSelectionEnabled: true,
      ...(MODE_OPTIONS[renderMode] || {}),
    });
    cy.on('tap', 'node', (event) => say(`Clicked ${event.target.id()} (${event.target.data('label')})`));
    cy.on('boxselect', 'node', () => {});
    cyRef.current = cy;
    cy.fit(undefined, 20);
    await raf();
    await raf();
    return { cy, firstPaintMs: performance.now() - start, heapDeltaMb: heapBefore !== null ? heapMb() - heapBefore : null };
  };

  const measureFps = async (cy) => {
    const baseZoom = cy.zoom();
    const basePan = { ...cy.pan() };
    const deltas = [];
    const start = performance.now();
    let last = start;
    while (performance.now() - start < FPS_MS) {
      const now = await raf();
      deltas.push(now - last);
      last = now;
      const t = (now - start) / FPS_MS;
      cy.viewport({
        zoom: baseZoom * (1 + 0.6 * Math.sin(t * Math.PI * 2)),
        pan: { x: basePan.x + 120 * Math.sin(t * Math.PI * 4), y: basePan.y + 80 * Math.cos(t * Math.PI * 4) },
      });
    }
    cy.viewport({ zoom: baseZoom, pan: basePan });
    const sorted = deltas.slice(1).sort((a, b) => a - b);
    return {
      fps: round((sorted.length / FPS_MS) * 1000, 0),
      p95FrameMs: round(sorted[Math.floor(sorted.length * 0.95)] || 0),
      maxFrameMs: round(sorted[sorted.length - 1] || 0),
    };
  };

  const measurePng = async (cy) => {
    const start = performance.now();
    try {
      const blob = await cy.png({ full: true, output: 'blob-promise', maxWidth: PNG_MAX_SIDE, maxHeight: PNG_MAX_SIDE });
      return { pngMs: round(performance.now() - start, 0), pngKb: round(blob.size / 1024, 0) };
    } catch (error) {
      return { pngError: String(error?.message || error) };
    }
  };

  const renderRun = async (nodes, renderMode) => {
    const graph = makeSyntheticGraph({ nodes });
    say(`${renderMode} · ${nodes} nodes / ${graph.edges.length} edges: layout…`);
    const { positions } = await runWorkerLayout(graph, 'concentric');
    try {
      const { cy, firstPaintMs, heapDeltaMb } = await mount({ graph, positions, renderMode });
      say(`${renderMode} · ${nodes}: first paint ${round(firstPaintMs, 0)} ms; measuring pan/zoom…`);
      const fps = await measureFps(cy);
      const png = await measurePng(cy);
      const row = { test: 'render', mode: renderMode, nodes, edges: graph.edges.length, labels, firstPaintMs: round(firstPaintMs, 0), ...fps, ...png, heapDeltaMb };
      add(row);
      say(`${renderMode} · ${nodes}: ${fps.fps} fps (p95 ${fps.p95FrameMs} ms)`);
      return row;
    } catch (error) {
      const row = { test: 'render', mode: renderMode, nodes, error: String(error?.message || error) };
      add(row);
      say(`${renderMode} · ${nodes}: FAILED ${row.error}`);
      return row;
    }
  };

  const layoutRun = async (nodes, layout) => {
    const graph = makeSyntheticGraph({ nodes });
    say(`Layout ${layout} · ${nodes} nodes…`);
    const stopWatch = watchLongTasks();
    const result = layout === 'elk-layered'
      ? await runElkLayered(graph)
      : await runWorkerLayout(graph, layout, 100);
    const longTasks = stopWatch();
    const row = { test: 'layout', layout, nodes, edges: graph.edges.length, ms: round(result.ms, 0), timedOut: Boolean(result.timedOut), mainThreadLongTasks: longTasks };
    add(row);
    say(`Layout ${layout} · ${nodes}: ${row.timedOut ? 'TIMED OUT (60 s)' : `${row.ms} ms`}`);
  };

  const switchRun = async (nodes) => {
    const graph = makeSyntheticGraph({ nodes });
    const { positions } = await runWorkerLayout(graph, 'concentric');
    const { cy } = await mount({ graph, positions, renderMode: 'canvas' });
    cy.$('#n1, #n2, #n3').select();
    cy.zoom(cy.zoom() * 1.7);
    const view = { zoom: cy.zoom(), pan: { ...cy.pan() }, selected: cy.$(':selected').map((element) => element.id()) };
    const nodePositions = Object.fromEntries(cy.nodes().map((node) => [node.id(), { ...node.position() }]));
    const start = performance.now();
    const { cy: next } = await mount({ graph, positions: nodePositions, renderMode: 'webgl' });
    next.viewport({ zoom: view.zoom, pan: view.pan });
    view.selected.forEach((id) => next.getElementById(id).select());
    await raf();
    const kept = next.$(':selected').length === view.selected.length && Math.abs(next.zoom() - view.zoom) < 1e-6;
    const row = { test: 'mode-switch', nodes, from: 'canvas', to: 'webgl', ms: round(performance.now() - start, 0), viewAndSelectionKept: kept };
    add(row);
    say(`Mode switch at ${nodes}: ${row.ms} ms, view kept: ${kept}`);
  };

  const guard = (label, task) => async () => {
    if (running) return;
    setRunning(label);
    try {
      await task();
    } catch (error) {
      say(`${label} failed: ${error?.message || error}`);
    } finally {
      setRunning('');
    }
  };

  const gpuOk = gpu.verdict !== 'not_capable';
  const runSuite = guard('Full suite', async () => {
    setResults([]);
    for (const nodes of SIZES) {
      // Plain canvas at 20k only repeats run 1 (1 fps); skipped to save time.
      if (nodes < 20000) await renderRun(nodes, 'canvas');
      await renderRun(nodes, 'canvas-fast');
      if (gpuOk) await renderRun(nodes, 'webgl');
    }
    for (const nodes of SIZES) await layoutRun(nodes, 'fa2');
    // ELK timed out at 5k in run 1: measure where it stops being usable.
    for (const nodes of [300, 1000]) await layoutRun(nodes, 'elk-layered');
    if (gpuOk) await switchRun(5000);
    say('Suite finished. Fill in the visual checklist, then Copy results.');
  });

  const showSample = guard('Style sample', async () => {
    const sample = makeStyleSample();
    await mount({ graph: sample, positions: sample.positions, renderMode: mode, withLabels: true });
    say(`Style sample drawn in ${mode} mode: compare with the checklist.`);
  });

  const showSize = guard('Draw', async () => {
    const graph = makeSyntheticGraph({ nodes: size });
    const { positions } = await runWorkerLayout(graph, 'concentric');
    const { firstPaintMs } = await mount({ graph, positions, renderMode: mode });
    say(`${mode} · ${size} nodes drawn in ${round(firstPaintMs, 0)} ms: pan, zoom, click and box-select (Shift+drag) by hand.`);
  });

  const CHECKS = useMemo(() => [
    ['solid', 'Solid edges with arrows'],
    ['dashed', 'Dashed edges look dashed'],
    ['dotted', 'Dotted (amber flag) edges look dotted'],
    ['arrowless', 'Grouping edges have no arrow'],
    ['shapes', 'Ellipse / round rectangle / diamond shapes'],
    ['icon', 'Icon node shows its icon'],
    ['parallel', 'Two parallel edges Hub → Target are both visible'],
    ['click', 'Clicking a node logs it'],
    ['boxselect', 'Shift+drag box-selects nodes'],
    ['labels', 'Labels readable when zoomed in'],
  ], []);

  const report = () => ({
    benchmark: 'linkx-graph-g0',
    version: 3,
    at: new Date().toISOString(),
    libraries: { cytoscape: cytoscape.version },
    device: {
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGb: navigator.deviceMemory ?? null,
      screen: `${screen.width}x${screen.height}`,
      devicePixelRatio: window.devicePixelRatio,
      gpu,
    },
    results,
    visualChecks: checks,
  });

  const copyReport = async () => {
    const text = JSON.stringify(report(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      say('Results copied to the clipboard.');
    } catch {
      const blob = new Blob([text], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `linkx-graph-g0-${Date.now()}.json`;
      link.click();
      say('Clipboard unavailable: results downloaded as a file.');
    }
  };

  const busy = Boolean(running);
  return (
    <BenchmarkFrame
      title="Graph benchmark (developer)"
      subtitle={`Cytoscape ${cytoscape.version}: canvas (default) and WebGL (opt-in)`}
      actions={(
        <button type="button" className="linkx_bench_button" onClick={copyReport} disabled={!results.length && !Object.keys(checks).length}>Copy results (JSON)</button>
      )}
      side={(
        <>
          <BenchmarkCard title={`GPU: ${gpu.verdict.replace('_', ' ')}`} aria-label="GPU capability">
            <ul>{[...gpu.reasons, ...(gpu.cautions || [])].map((reason) => <li key={reason}>{reason}</li>)}</ul>
            <div className="linkx_bench_row">
              <button type="button" className="linkx_bench_button" disabled={busy} onClick={() => setGpu(getGpuCapability({ force: true }))}>Check again</button>
            </div>
          </BenchmarkCard>
          <BenchmarkCard title="Full suite">
            <p>
              Sizes {SIZES.map((value) => value.toLocaleString()).join(' / ')} nodes (about 3 edges per node): canvas, canvas (fast){gpuOk ? ' and WebGL' : ' (WebGL cannot be used now)'}; PNG capped at {PNG_MAX_SIDE}px; ForceAtlas2 and ELK layouts in workers; canvas→WebGL switch.
            </p>
            <div className="linkx_bench_row">
              <button type="button" className="linkx_bench_button" disabled={busy} onClick={runSuite}>
                {running === 'Full suite' ? 'Running… (takes a few minutes)' : 'Run full suite'}
              </button>
            </div>
          </BenchmarkCard>
          <BenchmarkCard title="By hand">
            <div className="linkx_bench_row">
              <label>Mode <select className="linkx_bench_field" value={mode} onChange={(event) => setMode(event.target.value)}><option value="canvas">Canvas</option><option value="canvas-fast">Canvas (fast)</option><option value="webgl">WebGL</option></select></label>
              <label>Nodes <select className="linkx_bench_field" value={size} onChange={(event) => setSize(Number(event.target.value))}>{SIZES.map((value) => <option key={value} value={value}>{value.toLocaleString()}</option>)}</select></label>
              <label className="linkx_bench_check"><input type="checkbox" checked={labels} onChange={(event) => setLabels(event.target.checked)} /> Labels</label>
            </div>
            <div className="linkx_bench_row">
              <button type="button" className="linkx_bench_button" disabled={busy} onClick={showSize}>Draw graph</button>
              <button type="button" className="linkx_bench_button" disabled={busy} onClick={showSample}>Style sample</button>
            </div>
          </BenchmarkCard>
          <BenchmarkCard title="Visual checklist (Style sample, each mode)" aria-label="Visual checklist">
            {['canvas', 'webgl'].map((checkMode) => (
              <fieldset key={checkMode} className="linkx_bench_checks">
                <legend><strong>{checkMode === 'canvas' ? 'Canvas' : 'WebGL'}</strong></legend>
                {CHECKS.map(([key, label]) => (
                  <label key={key} className="linkx_bench_check">
                    <input
                      type="checkbox"
                      checked={Boolean(checks[`${checkMode}.${key}`])}
                      onChange={(event) => setChecks((current) => ({ ...current, [`${checkMode}.${key}`]: event.target.checked }))}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            ))}
          </BenchmarkCard>
          <BenchmarkCard title="Log" aria-label="Log">
            <div className="linkx_bench_log">
              {log.length ? log.map((line, index) => <div key={index}>{line}</div>) : 'Nothing yet.'}
            </div>
          </BenchmarkCard>
        </>
      )}
    >
      <div className="linkx_bench_stage"><div ref={containerRef} className="linkx_bench_canvas" /></div>
      <BenchmarkCard className="linkx_bench_results" aria-label="Results">
        <table className="linkx_bench_table">
          <thead>
            <tr>
              {['Test', 'Mode / layout', 'Nodes', 'Edges', 'First paint', 'FPS', 'p95 frame', 'Max frame', 'PNG', 'Time', 'Main thread', 'Note'].map((head) => <th key={head}>{head}</th>)}
            </tr>
          </thead>
          <tbody>
            {results.map((row, index) => (
              <tr key={index}>
                <td>{row.test}</td>
                <td>{row.mode || row.layout || `${row.from}→${row.to}`}</td>
                <td>{row.nodes}</td>
                <td>{row.edges ?? ''}</td>
                <td>{row.firstPaintMs != null ? `${row.firstPaintMs} ms` : ''}</td>
                <td>{row.fps ?? ''}</td>
                <td>{row.p95FrameMs != null ? `${row.p95FrameMs} ms` : ''}</td>
                <td>{row.maxFrameMs != null ? `${row.maxFrameMs} ms` : ''}</td>
                <td>{row.pngMs != null ? `${row.pngMs} ms` : row.pngError ? 'failed' : ''}</td>
                <td>{row.test !== 'render' && row.ms != null ? `${row.ms} ms` : ''}</td>
                <td>{row.mainThreadLongTasks?.supported ? `${row.mainThreadLongTasks.count} long (max ${row.mainThreadLongTasks.maxMs} ms)` : ''}</td>
                <td className={row.error || row.timedOut ? 'is-bad' : undefined}>
                  {row.error || (row.timedOut ? 'timed out' : '') || (row.viewAndSelectionKept === false ? 'view lost' : row.viewAndSelectionKept ? 'view kept' : '')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!results.length ? <p>No results yet. Run the full suite, or draw a graph to try it by hand.</p> : null}
      </BenchmarkCard>
    </BenchmarkFrame>
  );
}

// In the workspace's active theme, with the analyst's own overrides.
export default function GraphBench() {
  return (
    <ThemeProvider>
      <GraphBenchPage />
    </ThemeProvider>
  );
}
