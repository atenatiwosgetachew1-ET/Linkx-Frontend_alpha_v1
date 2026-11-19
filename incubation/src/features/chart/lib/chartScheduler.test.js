import { afterEach, describe, expect, it, vi } from 'vitest';

import { cancelChartWork, scheduleChartWork } from './chartScheduler.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('chartScheduler', () => {
  it('runs in a later frame, the latest task per key only; a cancelled one never', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', undefined);
    const ran = [];
    scheduleChartWork('a', () => ran.push('a1'));
    scheduleChartWork('a', () => ran.push('a2'));
    scheduleChartWork('b', () => ran.push('b'));
    scheduleChartWork('c', () => ran.push('c'));
    cancelChartWork('c');
    expect(ran).toEqual([]);
    vi.advanceTimersByTime(20);
    expect(ran).toEqual(['a2', 'b']);
  });

  it('keeps to a frame budget: the rest goes to the next frames; one failure does not stop the others', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    let clock = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const ran = [];
    scheduleChartWork('slow', () => { clock += 10; ran.push('slow'); });
    scheduleChartWork('broken', () => { throw new Error('x'); });
    scheduleChartWork('next', () => ran.push('next'));
    vi.advanceTimersByTime(16);
    expect(ran).toEqual(['slow']);
    vi.advanceTimersByTime(16);
    expect(ran).toEqual(['slow', 'next']);
    expect(errors).toHaveBeenCalledTimes(1);
  });
});
