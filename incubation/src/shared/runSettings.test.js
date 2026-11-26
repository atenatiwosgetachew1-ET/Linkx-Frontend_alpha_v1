import { describe, expect, it, vi } from 'vitest';

import { readGraphRuns, resolveGraphRuns } from '../services/runSettingsApi.js';
import { fetchGraph } from '../services/graphApi.js';
import { UNKNOWN_RUN, exportRunSettings, importRunSettings, mergeRunSettings, readSettingsUsed, runRemark, settingsRemark } from './runSettings.js';

export const RAW = {
  domain: 'microfinance',
  versions: { thresholds: 12, preset: 'baseline', mapping: 4, columns: null },
  overridden: true,
  overrides: { columns: { fetch_columns: { added: ['FEE'], removed: ['BRANCH'] } }, dataframe_mapping: { 'PAYER ACC': 'ACCOUNTNO' } },
  overridden_by: 'ana',
  missing_fields: ['TRANSACTIONTIME'],
};
const DOMAIN = { domain: 'bank', versions: {}, overridden: false, overrides: {}, missing_fields: [] };
const entry = (raw, id = 't') => ({ id, settings: readSettingsUsed(raw) });

describe('the remark of a run', () => {
  it('names every override and who made it', () => {
    const remark = settingsRemark(readSettingsUsed(RAW));
    expect(remark).toMatchObject({ kind: 'overridden', marked: true, label: 'Own columns and column mapping' });
    ['PAYER ACC → ACCOUNTNO', 'added FEE; removed BRANCH', 'by ana', 'Microfinance'].forEach((part) => expect(remark.text).toContain(part));
  });

  it('is unknown without a record, the domain’s without an override, none without a run', () => {
    expect(settingsRemark(null)).toMatchObject({ kind: 'unknown', marked: true, label: 'Settings not recorded' });
    expect(settingsRemark(readSettingsUsed(DOMAIN))).toMatchObject({ kind: 'domain', marked: false });
    expect(runRemark([])).toBeNull();
  });

  it('an override that is there is never taken for none', () => {
    expect(readSettingsUsed({ ...RAW, overridden: false }).overridden).toBe(true);
    expect(settingsRemark(readSettingsUsed({ domain: 'bank', overridden: true, overrides: {} })).kind).toBe('overridden');
  });

  it('mixed data says both', () => {
    const remark = runRemark([entry(RAW), entry(DOMAIN, 'd'), { id: 'x', settings: null }]);
    expect(remark.kind).toBe('overridden');
    expect(remark.text).toContain('not recorded');
    expect(runRemark([entry(DOMAIN), { id: 'x', settings: null }]).kind).toBe('unknown');
  });

  it('goes through a file and back, and is unknown where a file does not say', () => {
    const entries = [entry(RAW), entry(DOMAIN, 'd')];
    expect(importRunSettings(JSON.parse(JSON.stringify(exportRunSettings(entries))))).toEqual(entries);
    expect(importRunSettings(undefined)).toEqual(UNKNOWN_RUN);
    expect(importRunSettings([])).toEqual([]);
    expect(importRunSettings([{ id: {}, settings_used: 'x' }, 7, null])).toEqual([{ id: '', settings: null }]);
    expect(mergeRunSettings(entries, entries)).toEqual(entries);
    const many = mergeRunSettings([], Array.from({ length: 80 }, (_, index) => ({ id: String(index), settings: null })));
    expect(many).toHaveLength(50);
    expect(many[49].id).toBe('more');
  });
});

describe('the runs of a graph', () => {
  it('reads settings_used, else the session’s task_ids; nothing said is unknown', async () => {
    expect(readGraphRuns({ settings_used: RAW })).toEqual({ settings: RAW });
    expect(readGraphRuns({ status: 'queued', task_id: null, task_ids: ['1', '2'] }, { results: { status: 'success' } })).toEqual({ taskIds: ['1', '2'] });
    expect(readGraphRuns({ results: { nodes: [], edges: [] } })).toBeNull();
    expect(await resolveGraphRuns(vi.fn(), null)).toEqual(UNKNOWN_RUN);
    expect(await resolveGraphRuns(vi.fn(), { taskIds: [] })).toEqual(UNKNOWN_RUN);
    expect(await resolveGraphRuns(vi.fn(), { settings: null })).toEqual([{ id: '', settings: null }]);
  });

  it('looks at every task of a session’s graph; one that cannot be read is unknown', async () => {
    const apiFetch = vi.fn(async (url) => {
      if (url.endsWith('/1')) return { task: { task_id: '1', settings_used: RAW } };
      throw new Error('403');
    });
    const entries = await resolveGraphRuns(apiFetch, { taskIds: ['1', '2'] });
    expect(entries[0].settings.by).toBe('ana');
    expect(entries[1]).toEqual({ id: '2', settings: null });
    expect(runRemark(entries).kind).toBe('overridden');
  });

  it('a fetched graph brings them', async () => {
    const graph = await fetchGraph(async () => ({ message: 'success', results: { nodes: [{ id: 'a' }], edges: [], settings_used: RAW } }), { id: 'relationship', task_id: '9' });
    expect(graph.runSettings).toEqual([entry(RAW, '9')]);
  });
});
