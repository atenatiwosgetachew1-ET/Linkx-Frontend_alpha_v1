// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CLIPBOARD_KEY, getClipboard, hasClipboard, normalizeClipboard, resetClipboardCache, setClipboard, subscribeClipboard,
} from './graphClipboard.js';

afterEach(() => {
  localStorage.clear();
  resetClipboardCache();
});

describe('graph clipboard (production linkx_graph_clipboard_v1)', () => {
  it('reads both of production\'s shapes', () => {
    const array = [{ id: 'a' }];
    array.__edges = [{ from: 'a', to: 'b' }];
    expect(normalizeClipboard(array)).toEqual({ nodes: [{ id: 'a' }], edges: [{ from: 'a', to: 'b' }] });
    expect(normalizeClipboard({ nodes: [{ id: 'a' }, null], edges: 'x' })).toEqual({ nodes: [{ id: 'a' }], edges: [] });
    expect(normalizeClipboard(null)).toEqual({ nodes: [], edges: [] });
  });

  it('is shared on the device: stored, announced, and read back', () => {
    expect(hasClipboard()).toBe(false);
    const listener = vi.fn();
    const stop = subscribeClipboard(listener);
    setClipboard({ nodes: [{ id: '1' }], edges: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasClipboard()).toBe(true);
    expect(JSON.parse(localStorage.getItem(CLIPBOARD_KEY))).toEqual({ nodes: [{ id: '1' }], edges: [] });
    resetClipboardCache();
    expect(getClipboard().nodes).toEqual([{ id: '1' }]);
    stop();
  });

  it('follows a copy made in another browser tab', () => {
    const listener = vi.fn();
    const stop = subscribeClipboard(listener);
    localStorage.setItem(CLIPBOARD_KEY, JSON.stringify({ nodes: [{ id: 'x' }], edges: [] }));
    window.dispatchEvent(new StorageEvent('storage', { key: CLIPBOARD_KEY }));
    expect(listener).toHaveBeenCalled();
    expect(getClipboard().nodes[0].id).toBe('x');
    stop();
  });
});
