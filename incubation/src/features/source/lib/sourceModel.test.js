import { describe, expect, it } from 'vitest';

import {
  DATAFRAME_STATUSES,
  SOURCE_MODES,
  SOURCE_STATUSES,
  STREAM_STATUSES,
  canStream,
  connectionKindOf,
  defaultSourceState,
  configDefaultsPatch,
  domainDefaultsPatch,
  formatStreamLog,
  getAccessibleSteps,
  getContinueBlockers,
  isBatchInputReady,
  isSourceReady,
  mergeSourceState,
  brokerUsesDefault,
  resolveBrokerTarget
} from './sourceModel.js';

const batch = (patch = {}) => ({ ...defaultSourceState.batch, ...patch });

describe('connectionKindOf', () => {
  it('maps input types to backend connections', () => {
    expect(connectionKindOf({ selectedConnectionType: 'upload' })).toBe('upload');
    expect(connectionKindOf({ selectedConnectionType: 'storage' })).toBe('storage');
    expect(connectionKindOf({ selectedConnectionType: 'search' })).toBe('storage');
    expect(connectionKindOf({ selectedConnectionType: 'broker' })).toBe('broker');
    expect(connectionKindOf({ selectedConnectionType: '' })).toBe('broker');
  });
});

describe('isSourceReady', () => {
  it('accepts a storage connection for storage and Elastic search only', () => {
    const connected = { sourceStatus: SOURCE_STATUSES.CONNECTED, connectedKind: 'storage' };
    expect(isSourceReady(batch({ ...connected, selectedConnectionType: 'storage' }))).toBe(true);
    expect(isSourceReady(batch({ ...connected, selectedConnectionType: 'search' }))).toBe(true);
    expect(isSourceReady(batch({ ...connected, selectedConnectionType: 'upload' }))).toBe(false);
    expect(isSourceReady(batch({ ...connected, selectedConnectionType: 'broker' }))).toBe(false);
  });

  it('accepts an upload only for the upload input', () => {
    const uploaded = { sourceStatus: SOURCE_STATUSES.UPLOADED };
    expect(isSourceReady(batch({ ...uploaded, selectedConnectionType: 'upload' }))).toBe(true);
    expect(isSourceReady(batch({ ...uploaded, selectedConnectionType: 'broker' }))).toBe(false);
  });

  it('is false while not connected', () => {
    expect(isSourceReady(batch({ sourceStatus: SOURCE_STATUSES.CONNECTING, selectedConnectionType: 'storage' }))).toBe(false);
  });
});

describe('isBatchInputReady', () => {
  it('upload needs staged files (a lingering connection is not enough)', () => {
    expect(isBatchInputReady(batch({ selectedConnectionType: 'upload', sourceStatus: SOURCE_STATUSES.CONNECTED }))).toBe(false);
    expect(isBatchInputReady(batch({ selectedConnectionType: 'upload', selectedFiles: ['a.csv'] }))).toBe(true);
  });

  it('storage needs the connection and a selected file', () => {
    const base = { selectedConnectionType: 'storage', sourceStatus: SOURCE_STATUSES.CONNECTED, connectedKind: 'storage' };
    expect(isBatchInputReady(batch(base))).toBe(false);
    expect(isBatchInputReady(batch({ ...base, selectedStorageFiles: [{ name: 'f' }] }))).toBe(true);
  });

  it('search needs the connection and a selected result', () => {
    const base = { selectedConnectionType: 'search', sourceStatus: SOURCE_STATUSES.CONNECTED, connectedKind: 'storage' };
    expect(isBatchInputReady(batch({ ...base, selectedSearchFiles: [] }))).toBe(false);
    expect(isBatchInputReady(batch({ ...base, selectedSearchFiles: [{ name: 'r' }] }))).toBe(true);
  });

  it('broker needs the broker (the tool is connected on Continue)', () => {
    const base = { selectedConnectionType: 'broker', sourceStatus: SOURCE_STATUSES.CONNECTED, connectedKind: 'broker' };
    expect(isBatchInputReady(batch(base))).toBe(true);
    expect(isBatchInputReady(batch({ ...base, sourceStatus: SOURCE_STATUSES.IDLE, toolStatus: 'connected' }))).toBe(false);
    expect(getContinueBlockers(SOURCE_MODES.BATCH, batch({ selectedConnectionType: 'broker' }))).toEqual(['Connect the broker']);
    const live = { ...defaultSourceState.realtime, step: 'connect' };
    expect(getContinueBlockers(SOURCE_MODES.REALTIME, live)).toEqual(['Connect the source']);
    expect(getContinueBlockers(SOURCE_MODES.REALTIME, { ...live, sourceStatus: SOURCE_STATUSES.CONNECTED })).toEqual([]);
  });
});

describe('getContinueBlockers', () => {
  it('lists what is missing per input type', () => {
    expect(getContinueBlockers(SOURCE_MODES.BATCH, batch({ selectedConnectionType: 'storage' })))
      .toEqual(['Connect to the storage', 'Select at least one file']);
    expect(getContinueBlockers(SOURCE_MODES.BATCH, batch({ selectedConnectionType: 'search' })))
      .toEqual(['Connect to the storage', 'Select at least one search result']);
    expect(getContinueBlockers(SOURCE_MODES.BATCH, batch({ selectedConnectionType: 'upload' })))
      .toEqual(['Stage at least one file']);
  });
});

describe('getAccessibleSteps', () => {
  it('opens the dataframe step only once a dataframe is ready', () => {
    expect(getAccessibleSteps(SOURCE_MODES.BATCH, batch()).has('dataframe')).toBe(false);
    expect(getAccessibleSteps(SOURCE_MODES.BATCH, batch({ dataframeStatus: DATAFRAME_STATUSES.READY })).has('dataframe')).toBe(true);
  });

  it('locks every other step while a stream may still be running', () => {
    const ready = { dataframeStatus: DATAFRAME_STATUSES.READY, rule: 'r1' };
    [STREAM_STATUSES.STARTING, STREAM_STATUSES.RUNNING, STREAM_STATUSES.TERMINATING].forEach((streamStatus) => {
      expect([...getAccessibleSteps(SOURCE_MODES.BATCH, batch({ ...ready, streamStatus }))]).toEqual(['stream']);
      expect([...getAccessibleSteps(SOURCE_MODES.REALTIME, { ...defaultSourceState.realtime, ...ready, streamStatus })]).toEqual(['stream']);
    });
  });

  it('keeps a finished run reachable only while its dataframe exists', () => {
    const done = { streamStatus: STREAM_STATUSES.COMPLETED, rule: '' };
    expect(getAccessibleSteps(SOURCE_MODES.BATCH, batch({ ...done, dataframeStatus: DATAFRAME_STATUSES.READY })).has('stream')).toBe(true);
    expect(getAccessibleSteps(SOURCE_MODES.BATCH, batch(done)).has('stream')).toBe(false);
  });
});

describe('canStream', () => {
  it('needs two different columns for Source / Target Mapping', () => {
    const mapping = { dataframeAction: 'Source / Target Mapping' };
    expect(canStream({ ...mapping, sourceColumn: 'a', targetColumn: 'b' })).toBe(true);
    expect(canStream({ ...mapping, sourceColumn: 'a', targetColumn: 'a' })).toBe(false);
    expect(getContinueBlockers(SOURCE_MODES.BATCH, batch({ ...mapping, step: 'dataframe', sourceColumn: 'a', targetColumn: 'a' })))
      .toEqual(['Pick different source and target columns']);
  });
});

describe('domainDefaultsPatch', () => {
  const prev = { broker: { address: 'old:9092', topic: 'old' }, tool: { url: 'bolt://old', username: 'u', database: 'db1' } };
  const next = { broker: { address: 'new:9092', topic: 'new' }, tool: { url: 'bolt://new', username: 'u', database: 'db2' } };

  it('moves default-held fields to the new domain and keeps typed values', () => {
    const patch = domainDefaultsPatch({ brokerAddress: 'old:9092', topic: 'mytopic', toolUrl: '', toolDatabase: 'db1' }, prev, next);
    // Empty fields take the new defaults too (toolUsername was empty).
    expect(patch).toEqual({ brokerAddress: 'new:9092', toolUrl: 'bolt://new', toolUsername: 'u', toolDatabase: 'db2' });
  });

  it('never writes storage address/port', () => {
    const patch = domainDefaultsPatch({}, prev, next);
    expect(patch).not.toHaveProperty('storageAddress');
    expect(patch).not.toHaveProperty('storagePort');
  });
});

describe('mergeSourceState', () => {
  it('fills defaults for missing mode fields', () => {
    const merged = mergeSourceState({ mode: 'choose', batch: { step: 'upload' } });
    expect(merged.batch.selectedConnectionType).toBe(defaultSourceState.batch.selectedConnectionType);
    expect(merged.realtime).toEqual(defaultSourceState.realtime);
  });
});

describe('formatStreamLog', () => {
  it('keeps backend lines verbatim and timestamps local ones', () => {
    const text = formatStreamLog([
      { at: '2026-11-13 12:04:55', level: 'info', message: 'Analyze requested.' },
      { at: '2026-11-13 12:04:56', level: 'info', message: '[09:04:56] [Info] - Injection started', source: 'backend' },
      { at: '2026-11-13 12:05:00', level: 'warn', message: 'Terminating' },
    ]);
    expect(text).toBe('[2026-11-13 12:04:55] Analyze requested.\n[09:04:56] [Info] - Injection started\n[2026-11-13 12:05:00] WARN Terminating');
  });
});

describe('the broker target', () => {
  const defaults = { broker: { address: 'k:9092', apiAddress: 'https://api', topic: 't' } };

  it('is the configured one behind Use Default, the typed one otherwise', () => {
    const typed = { sourceAddressType: 'broker', brokerAddress: 'mine:1', topic: 'm' };
    expect(resolveBrokerTarget({ ...typed, brokerUseDefault: true }, defaults)).toEqual({ address: 'k:9092', topic: 't' });
    expect(resolveBrokerTarget({ ...typed, brokerUseDefault: false }, defaults)).toEqual({ address: 'mine:1', topic: 'm' });
    expect(resolveBrokerTarget({ ...typed, sourceAddressType: 'api', brokerUseDefault: true }, defaults)).toEqual({ address: 'https://api', topic: '' });
  });

  it('keeps the values a window already held before there was a choice', () => {
    expect(brokerUsesDefault({ brokerAddress: 'k:9092', topic: 't' }, defaults)).toBe(true);
    expect(brokerUsesDefault({ brokerAddress: '', topic: '' }, defaults)).toBe(true);
    expect(brokerUsesDefault({ brokerAddress: 'mine:1', topic: 't' }, defaults)).toBe(false);
  });

  it('is not refilled by a domain switch while entered manually', () => {
    const next = { broker: { address: 'new:9092', topic: 'n' }, tool: {} };
    const patch = domainDefaultsPatch({ brokerUseDefault: false, brokerAddress: '', topic: '' }, { ...defaults, tool: {} }, next);
    expect(patch).toEqual({});
  });
});

describe('configDefaultsPatch', () => {
  const prev = { autoFill: true, broker: { address: 'k:9092', topic: 't' }, tool: { url: 'bolt://a', username: 'neo', database: 'db', passwordRef: 'r1' } };
  const next = { autoFill: true, broker: { address: 'k:9092', topic: 't' }, tool: { url: 'bolt://b', username: 'neo', database: 'db', passwordRef: 'r2' } };
  const saved = { toolUrl: 'bolt://a', toolUsername: 'neo', toolDatabase: 'db', toolPassword: '***', toolPasswordRef: 'r1' };

  it('moves the tool URL and the saved password ref after a configuration save', () => {
    expect(configDefaultsPatch(saved, prev, next, { onlyChanged: true })).toEqual({ toolUrl: 'bolt://b', toolPasswordRef: 'r2', toolPassword: '***' });
  });

  it('drops the saved ref when the password was cleared', () => {
    const cleared = { ...next, tool: { ...next.tool, passwordRef: '' } };
    expect(configDefaultsPatch(saved, prev, cleared)).toMatchObject({ toolPasswordRef: '', toolPassword: '' });
  });

  it('keeps a typed password, a window-saved realtime ref and typed values', () => {
    expect(configDefaultsPatch(saved, prev, next, { hasTypedPassword: true })).not.toHaveProperty('toolPasswordRef');
    expect(configDefaultsPatch({ ...saved, toolPasswordRef: 'own' }, prev, next)).not.toHaveProperty('toolPasswordRef');
    expect(configDefaultsPatch({ ...saved, toolUrl: 'bolt://mine' }, prev, next)).not.toHaveProperty('toolUrl');
  });

  it('leaves empty fields empty when autofill is off', () => {
    const off = { ...next, autoFill: false };
    expect(configDefaultsPatch({ toolUrl: '' }, prev, off)).toEqual({});
  });

  it('changes nothing when the configuration is unchanged', () => {
    expect(configDefaultsPatch(saved, prev, prev, { onlyChanged: true })).toEqual({});
  });
});
