import { describe, expect, it } from 'vitest';

import { disposeAllSourceRuntimes, disposeSourceRuntime, getSecret, setSecret, windowRef } from './sourceRuntime.js';

describe('windowRef', () => {
  it('keeps one ref per window, shared across component instances', () => {
    const a1 = windowRef('win-a', 'sourceState');
    const a2 = windowRef('win-a', 'sourceState');
    const b = windowRef('win-b', 'sourceState');
    a1.current = { step: 'dataframe' };
    expect(a2.current).toEqual({ step: 'dataframe' });
    expect(b.current).toBeNull();
  });

  it('is forgotten when the window closes', () => {
    windowRef('win-c', 'sourceState').current = { step: 'stream' };
    disposeSourceRuntime('win-c');
    expect(windowRef('win-c', 'sourceState').current).toBeNull();
  });
});

describe('disposeAllSourceRuntimes', () => {
  it('forgets typed passwords of every window (sign-out; window ids are reused)', () => {
    setSecret('source-1', 'batch', 'hunter2');
    setSecret('source-2', 'realtime', 'pw');
    disposeAllSourceRuntimes();
    expect(getSecret('source-1', 'batch')).toBe('');
    expect(getSecret('source-2', 'realtime')).toBe('');
  });
});
