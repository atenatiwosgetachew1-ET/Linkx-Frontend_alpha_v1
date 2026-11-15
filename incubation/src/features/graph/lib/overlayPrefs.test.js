// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_OVERLAY_PREFS, OVERLAY_PREFS_KEY, getOverlayPrefs, normalizeOverlayPrefs, resetOverlayPrefsCache,
  setOverlayPref, subscribeOverlayPrefs,
} from './overlayPrefs.js';

afterEach(() => {
  localStorage.clear();
  resetOverlayPrefsCache();
});

describe('on-graph component preferences', () => {
  it('shows everything by default and keeps only known keys', () => {
    expect(getOverlayPrefs()).toEqual(DEFAULT_OVERLAY_PREFS);
    expect(normalizeOverlayPrefs({ legend: false, other: false })).toEqual({ minimap: true, legend: false, glyphs: true, alerts: true, pinned: true, combined: true });
    expect(normalizeOverlayPrefs('junk')).toEqual(DEFAULT_OVERLAY_PREFS);
  });

  it('stores a change on the device and tells every subscriber', () => {
    const listener = vi.fn();
    const stop = subscribeOverlayPrefs(listener);
    setOverlayPref('minimap', false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getOverlayPrefs().minimap).toBe(false);
    expect(JSON.parse(localStorage.getItem(OVERLAY_PREFS_KEY)).minimap).toBe(false);
    setOverlayPref('minimap', false); // unchanged: no notice
    setOverlayPref('unknown', false);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reads what is stored, and follows other browser tabs', () => {
    localStorage.setItem(OVERLAY_PREFS_KEY, JSON.stringify({ pinned: false }));
    expect(getOverlayPrefs().pinned).toBe(false);
    const listener = vi.fn();
    const stop = subscribeOverlayPrefs(listener);
    localStorage.setItem(OVERLAY_PREFS_KEY, JSON.stringify({ pinned: true, legend: false }));
    window.dispatchEvent(new StorageEvent('storage', { key: OVERLAY_PREFS_KEY }));
    expect(listener).toHaveBeenCalled();
    expect(getOverlayPrefs()).toMatchObject({ pinned: true, legend: false });
    stop();
  });
});
