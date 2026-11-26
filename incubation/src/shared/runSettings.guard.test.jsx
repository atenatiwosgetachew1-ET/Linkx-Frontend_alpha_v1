// @vitest-environment jsdom
// Everything that leaves the app from a run made with own columns or an own
// column mapping says so (docs/phase6-plan.md, section 4). A new export must be
// added here: the first test fails for a file that exports and is not listed.
import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { createGraphStore } from '../features/graph/lib/graphStore.js';
import { buildGraphExport, parseGraphFile } from '../features/graph/lib/graphFile.js';
import { normalizeClipboard } from '../features/graph/lib/graphClipboard.js';
import { getPinnedEvidence, pinEvidence, resetPinnedEvidenceCache } from '../features/graph/lib/pinnedEvidence.js';
import { buildGraphReport } from '../features/graph/report/graphReportModel.js';
import { evidenceReportContext } from '../features/graph/report/graphReportExport.js';
import { renderTablePdf } from '../features/table/lib/tablePdf.js';
import { rowsToCsv, rowsToTsv } from '../features/table/lib/tableExport.js';
import { A4, framedPage } from '../features/chart/lib/chartSnaps.js';
import { toReportRecord } from '../features/reports/lib/reportModel.js';
import { buildReportRows } from '../features/reports/lib/reportsPdf.js';
import ReportDetail from '../features/reports/components/ReportDetail.jsx';
import TaskEvidenceDialog from '../features/tasks/components/TaskEvidenceDialog.jsx';
import { applyServerTask, getTask, resetTasks, taskRemark } from '../features/tasks/lib/taskRegistry.js';
import { matchesTaskFilter, taskLogHead } from '../features/tasks/lib/taskFormat.js';
import { taskFlagVerdict } from '../features/tasks/lib/taskFlags.js';
import RunRemarkFlag from './components/RunRemarkFlag.jsx';
import { readSettingsUsed, runRemark, runSettingsCell } from './runSettings.js';

const RAW = { domain: 'bank', versions: {}, overridden: true, overrides: { dataframe_mapping: { PAYER: 'ACCOUNTNO' } }, overridden_by: 'ana', missing_fields: [] };
const ENTRIES = [{ id: '7', settings: readSettingsUsed(RAW) }];
const remark = runRemark(ENTRIES);
const SAYS = /PAYER\s*(→|->)\s*ACCOUNTNO/;

const storeWith = () => {
  const store = createGraphStore();
  store.replace({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e', from: 'a', to: 'b' }] });
  store.setRunSettings(ENTRIES);
  return store;
};
const view = { nodeIds: ['a', 'b'], edgeIds: ['id:e'], searched: false, viewKey: '' };

beforeEach(() => {
  localStorage.clear();
  resetPinnedEvidenceCache();
  resetTasks();
});
afterEach(cleanup);

describe('every way out carries the remark', () => {
  it('no file exports without being known here', () => {
    // What each of them does about it.
    const KNOWN = new Set([
      'features/graph/components/GraphWindowBody.jsx', // snap, print, PDF, JSON
      'features/graph/lib/graphFile.js', // the helpers
      'features/graph/report/graphReportExport.js', // reports
      'features/table/components/TableWindowBody.jsx', // CSV, copy, PDF
      'features/chart/components/ChartWindowBody.jsx', // snaps, print, PDF
      'features/reports/components/ReportsWindowBody.jsx', // copied payload
      'features/reports/components/ReportDetail.jsx', // copies one id
      'features/reports/lib/reportsPdf.js', // list PDF
      'features/tasks/components/TasksWindowBody.jsx', // log, copied ids
      'features/source/components/steps/StreamStep.jsx', // log
      'features/source/components/SourceWindowBody.jsx', // copies a session id
      'features/graph/lib/graphAnnotations.js', // opens what an analyst attached to a note
      'features/settings/components/theme/ThemeStudio.jsx', // a theme: no data
      'features/libraries/components/IconSetsPanel.jsx', // icons: no data
      'features/libraries/components/RulesPanel.jsx', // rule template: no data
      'features/libraries/components/LibrariesWindowBody.jsx',
      'features/libraries/components/GraphRenderingPanel.jsx', // GPU details: no data
      'features/settings/components/VigilancePanel.jsx', // xVigilance: the domain's settings
      'features/settings/components/ServiceAccountsPanel.jsx', // a secret: no data
      'features/settings/components/panels/ProfilePanel.jsx', // account facts
      'services/configurationApi.js', // configuration export
      'workspace/components/right/WorkspaceAssistantTab.jsx', // the assistant's text (right panel)
    ]);
    const OUT = /downloadBlob\(|downloadDataUrl\(|printImage\(|clipboard\??\.writeText|\.download = |doc\.save\(/;
    const root = join(process.cwd(), 'src');
    const walk = (folder) => readdirSync(folder).flatMap((name) => {
      const path = join(folder, name);
      if (statSync(path).isDirectory()) return walk(path);
      return /\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name) ? [path] : [];
    });
    const found = walk(root).filter((path) => OUT.test(readFileSync(path, 'utf8'))).map((path) => relative(root, path));
    expect(found.filter((path) => !KNOWN.has(path) && !path.startsWith('dev/'))).toEqual([]);
  });

  it('a graph file, and the graph it is opened as', () => {
    const text = JSON.stringify(buildGraphExport(storeWith(), view));
    expect(text).toMatch(/"PAYER":"ACCOUNTNO"/);
    const parsed = parseGraphFile('g.json', text);
    expect(runRemark(parsed.runSettings).text).toMatch(SAYS);
    expect(runRemark(parseGraphFile('old.json', JSON.stringify({ nodes: [{ id: 'a' }], edges: [] })).runSettings).kind).toBe('unknown');
  });

  it('copied elements, and the graph they are pasted into', () => {
    const target = createGraphStore();
    target.replace({ nodes: [{ id: 'z' }], edges: [] });
    const clip = normalizeClipboard(JSON.parse(JSON.stringify(storeWith().copyNodes(['a']))));
    target.pasteNodes(clip, { visibleIds: [] });
    expect(runRemark(target.getSnapshot().runSettings).text).toMatch(SAYS);
    // New data starts without it.
    target.replace({ nodes: [{ id: 'n' }], edges: [] });
    expect(runRemark(target.getSnapshot().runSettings)).toBeNull();
  });

  it('pinned evidence', () => {
    pinEvidence([{ type: 'node', id: 'a', data: {} }], remark.text);
    expect(getPinnedEvidence()[0].runRemark).toMatch(SAYS);
  });

  it('CSV and copied tables, on every row of the last column', () => {
    const rows = [{ values: { x: '1' } }, { values: { x: '2' } }];
    const columns = [{ key: 'x', label: 'X' }];
    const csv = rowsToCsv(rows, columns, runSettingsCell(remark)).trim().split('\r\n');
    expect(csv[0]).toMatch(/X,Run settings$/);
    expect(csv.slice(1).every((line) => SAYS.test(line))).toBe(true);
    expect(rowsToTsv(rows, columns, runSettingsCell(remark)).split('\n').slice(1).every((line) => SAYS.test(line))).toBe(true);
    expect(rowsToTsv(rows, columns, '')).toBe('X\n1\n2');
  });

  it('the table PDF', async () => {
    const doc = await renderTablePdf({ rows: [{ values: { x: '1' } }], columns: [{ key: 'x', label: 'X' }], remark: remark.short });
    expect(JSON.stringify(doc.internal.pages)).toMatch(SAYS);
  });

  it('the frame of snaps, prints and their PDFs (graph, charts, tables)', () => {
    const written = [];
    const context = new Proxy({ measureText: (text) => ({ width: text.length * 5 }), fillText: (text) => written.push(text) }, { get: (target, key) => (key in target ? target[key] : () => {}), set: () => true });
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    framedPage(null, { title: 'T', source: 'S', details: 'D', remark: remark.short }, A4);
    spy.mockRestore();
    expect(written.join(' ')).toMatch(SAYS);
  });

  it('the graph report and the evidence report: cover and method', () => {
    const context = evidenceReportContext({ graphData: { nodes: [{ id: 'a' }], edges: [], runSettings: ENTRIES }, evidence: {} });
    const report = buildGraphReport({ ...context.input(''), cover: {}, analyst: {} });
    expect(report.cover.fields.find(([label]) => label === 'Run Settings')[1]).toMatch(SAYS);
    expect(JSON.stringify(report.sections.find((section) => section.id === 'method'))).toMatch(SAYS);
  });

  it('tasks: the list, the filter, the log file, the verdict and saving as evidence', () => {
    const id = applyServerTask({ task_id: '7', status: 'completed', verdict: 'clean', flags: {}, ended_reason: 'finished', settings_used: RAW });
    const task = getTask(id);
    expect(taskRemark(task).text).toMatch(SAYS);
    expect(taskLogHead(task)).toMatch(SAYS);
    expect(matchesTaskFilter(task, 'overridden')).toBe(true);
    expect(taskFlagVerdict(task, []).label).toBe('Clean (own mapping)');
    render(<TaskEvidenceDialog initial={{ title: '', summary: '', includeGraph: true }} taskLabel="T" remark={taskRemark(task)} onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent(SAYS);
  });

  it('reports: the record, its detail and the list PDF; a record that does not say is not shown as the domain’s', () => {
    const record = toReportRecord({ id: 1, requester_type: 'analyst', report_type: 'Evidence', settings_used: RAW, payload: {} }, 'evidence');
    expect(record.runRemark.text).toMatch(SAYS);
    expect(buildReportRows([record], 'evidence').body[0].join(' ')).toContain('Own column mapping');
    render(<ReportDetail record={record} graph={{ state: 'available' }} download={{ available: false }} onClose={vi.fn()} onCopyPayload={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Run settings' })).toHaveTextContent(SAYS);
    expect(toReportRecord({ id: 2, requester_type: 'analyst', payload: {} }, 'evidence').runRemark.kind).toBe('unknown');
    expect(toReportRecord({ id: 3, requester_type: 'service', payload: {} }, 'evidence').runRemark).toBeNull();
  });

  it('on screen, in the Graph, Table and Chart windows', () => {
    render(<RunRemarkFlag remark={remark} />);
    expect(screen.getByRole('note')).toHaveTextContent('Own column mapping');
    cleanup();
    render(<RunRemarkFlag remark={runRemark([{ id: '1', settings: readSettingsUsed({ domain: 'bank', overridden: false }) }])} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
