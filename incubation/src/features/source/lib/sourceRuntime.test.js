import { describe, expect, it } from 'vitest';

import { disposeSourceRuntime, windowRef } from './sourceRuntime.js';

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
