import { describe, expect, it } from 'vitest';

import { resolveSourceDefaults } from './sourceConfig.js';
import { SOURCE_MODES } from './sourceModel.js';
import { sourceNeeds } from './sourceNeeds.js';

const CONFIG = {
  domain: 'bank',
  active_storage_address: '10.9.8.7',
  domain_connections: { bank: { storage_port: 5000, storage_path: '/user/bank', storage_database: 'bank_db' } },
  storage_tables: ['a', 'b'],
  active_kafka_adress: 'kafka:9092',
  search_columns_fuzzy: ['x'],
  active_tool: 'neo4j',
  active_tool_url: 'bolt://tool',
  active_tool_password_ref: 'ref-1',
};
const needs = (connectionType, inputMode = SOURCE_MODES.BATCH, config = CONFIG) => sourceNeeds({ connectionType, inputMode, defaults: resolveSourceDefaults(config) });
const row = (result, id) => result.rows.find((item) => item.id === id);

describe('sourceNeeds', () => {
  it('says what is saved for storage, never its address', () => {
    const result = needs('storage');
    expect(row(result, 'address')).toMatchObject({ state: 'ok', value: 'Default saved' });
    expect(row(result, 'path').value).toBe('/user/bank');
    expect(row(result, 'tables')).toMatchObject({ state: 'info', value: '2 saved' });
    expect(result.missing).toBe(0);
    ['storage', 'search', 'broker', 'upload'].forEach((type) => expect(JSON.stringify(needs(type))).not.toMatch(/10\.9\.8\.7|5000|ref-1|\*\*\*/));
  });

  it('counts what is left to fill in, and names the next page', () => {
    const broker = needs('broker', SOURCE_MODES.REALTIME);
    expect(row(broker, 'topic').state).toBe('missing');
    expect(broker.missing).toBe(1);
    expect(broker.next).toBe('Connect broker or API');
    expect(needs('storage').next).toBe('Connect table or path');
    expect(row(needs('search'), 'strict').value).toBe('Not set up');
    const bare = needs('storage', SOURCE_MODES.BATCH, {});
    expect(bare.missing).toBe(4);
  });

  it('describes the files an upload takes', () => {
    const upload = needs('upload');
    expect(row(upload, 'types').value).toMatch(/CSV/);
    expect(row(upload, 'limit').value).toMatch(/each$/);
    expect(upload.missing).toBe(0);
  });
});
