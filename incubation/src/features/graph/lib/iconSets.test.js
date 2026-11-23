// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ICON_ALBUM } from './graphEditing.js';
import {
  BUILTIN_CATEGORIES,
  BUILTIN_SET,
  BUILTIN_SET_ID,
  ICON_LIMITS,
  ICON_SETS_KEY,
  addIcons,
  albumSets,
  createIconSet,
  exportIconSet,
  forgetIconSets,
  getIconSets,
  importIconSet,
  readIconFile,
  removeIcon,
  removeIconSet,
  renameIcon,
  sanitizeSvg,
  setIconSetEnabled,
  subscribeIconSets,
} from './iconSets.js';

afterEach(() => {
  localStorage.clear();
  forgetIconSets();
});

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const icon = (name) => ({ name, src: PNG });

describe('icon sets', () => {
  it('files every built-in icon under exactly one category', () => {
    const filed = BUILTIN_CATEGORIES.flatMap((category) => category.icons);
    expect(new Set(filed).size).toBe(filed.length);
    expect(filed.slice().sort()).toEqual([...ICON_ALBUM].sort());
    expect(BUILTIN_SET.icons).toHaveLength(ICON_ALBUM.length);
    BUILTIN_SET.icons.forEach((entry) => expect(entry.category).not.toBe('other'));
  });

  it('starts with the built-in set alone, offered in the album', () => {
    expect(getIconSets()).toEqual({ builtinEnabled: true, sets: [] });
    expect(albumSets().map((set) => set.id)).toEqual([BUILTIN_SET_ID]);
  });

  it('makes a set, fills it, renames and removes icons, and tells its listeners', () => {
    const listener = vi.fn();
    const stop = subscribeIconSets(listener);
    const made = createIconSet({ name: '  Telecom  ', icons: [icon('Tower'), icon('Tower')] });
    expect(made.ok).toBe(true);
    let set = getIconSets().sets[0];
    expect(set).toMatchObject({ name: 'Telecom', enabled: true });
    // Names are unique within a set.
    expect(set.icons.map((entry) => entry.name)).toEqual(['Tower', 'Tower 2']);
    expect(addIcons(made.id, [icon('Sim.png')]).ok).toBe(true);
    set = getIconSets().sets[0];
    expect(set.icons.map((entry) => entry.name)).toEqual(['Tower', 'Tower 2', 'Sim']);
    renameIcon(made.id, set.icons[2].id, 'SIM card');
    removeIcon(made.id, set.icons[1].id);
    expect(getIconSets().sets[0].icons.map((entry) => entry.name)).toEqual(['Tower', 'SIM card']);
    expect(listener).toHaveBeenCalled();
    // Kept in this browser.
    forgetIconSets();
    expect(getIconSets().sets[0].icons).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(ICON_SETS_KEY)).sets).toHaveLength(1);
    stop();
  });

  it('offers in the album only the sets turned on that hold icons', () => {
    const full = createIconSet({ name: 'Full', icons: [icon('A')] });
    createIconSet({ name: 'Empty' });
    expect(albumSets().map((set) => set.name)).toEqual(['LinkX Standard', 'Full']);
    setIconSetEnabled(full.id, false);
    setIconSetEnabled(BUILTIN_SET_ID, false);
    expect(albumSets()).toEqual([]);
    removeIconSet(full.id);
    expect(getIconSets().sets.map((set) => set.name)).toEqual(['Empty']);
  });

  it('refuses what does not fit, and says why', () => {
    const made = createIconSet({ name: 'Big' });
    const tooMany = Array.from({ length: ICON_LIMITS.SET_ICONS + 1 }, (_, index) => icon(`I${index}`));
    expect(addIcons(made.id, tooMany)).toMatchObject({ ok: false, reason: expect.stringMatching(/up to 200 icons/) });
    const heavy = { name: 'Heavy', src: `data:image/png;base64,${'A'.repeat(ICON_LIMITS.TOTAL_BYTES + 10)}` };
    expect(addIcons(made.id, [heavy])).toMatchObject({ ok: false, reason: expect.stringMatching(/library is full/) });
    expect(getIconSets().sets[0].icons).toHaveLength(0);
    expect(addIcons('gone', [icon('A')])).toMatchObject({ ok: false });
  });

  it('travels as a file: exported, then imported as a new set', () => {
    const made = createIconSet({ name: 'Customs', description: 'Border posts', icons: [icon('Gate'), icon('Scanner')] });
    const file = exportIconSet(made.id);
    expect(JSON.parse(file)).toMatchObject({ kind: 'linkx-icon-set', name: 'Customs', icons: [{ name: 'Gate', src: PNG }, { name: 'Scanner', src: PNG }] });
    const back = importIconSet(file);
    expect(back).toMatchObject({ ok: true, added: 2 });
    expect(getIconSets().sets).toHaveLength(2);
    expect(importIconSet('not json')).toMatchObject({ ok: false });
    expect(importIconSet(JSON.stringify({ kind: 'something-else', icons: [] }))).toMatchObject({ ok: false });
    // Anything that is not an image is dropped.
    expect(importIconSet(JSON.stringify({ kind: 'linkx-icon-set', icons: [{ name: 'x', src: 'https://example.com/a.png' }] }))).toMatchObject({ ok: false, reason: expect.stringMatching(/no usable icons/) });
  });

  it('cleans an uploaded SVG and refuses what is not an image or is too large', async () => {
    const dirty = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="x()"><script>alert(1)</script><a href="https://example.com"><circle r="4" onclick="y()"/></a><use href="#a"/></svg>';
    const clean = sanitizeSvg(dirty);
    expect(clean).not.toMatch(/script|onload|onclick|example\.com|\?xml/);
    expect(clean).toContain('<circle r="4"');
    expect(clean).toContain('href="#a"');
    expect(sanitizeSvg('<p>hello</p>')).toBe('');

    const svg = await readIconFile(new File([dirty], 'Mast Tower.svg', { type: 'image/svg+xml' }));
    expect(svg).toMatchObject({ ok: true, name: 'Mast Tower' });
    expect(svg.src).toMatch(/^data:image\/svg\+xml/);
    expect(decodeURIComponent(svg.src)).not.toMatch(/script|onload/);

    expect(await readIconFile(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/Not an SVG/) });
    const large = new File([new Uint8Array(ICON_LIMITS.FILE_BYTES + 1)], 'big.png', { type: 'image/png' });
    expect(await readIconFile(large)).toMatchObject({ ok: false, reason: expect.stringMatching(/Larger than 100 KB/) });
    expect(await readIconFile(new File([new Uint8Array([137, 80, 78, 71])], 'dot.png', { type: 'image/png' }))).toMatchObject({ ok: true, name: 'dot' });
  });
});
