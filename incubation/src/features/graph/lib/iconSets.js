import { ICON_ALBUM, albumIconPath } from './graphEditing.js';

// Icon sets (Libraries ▸ Icon sets; analyst request 2026-11-23): the icons
// a node can be given in a Graph window. One built-in set (production's
// album, public/graph_icons), organised by category, plus the sets the
// analyst makes: uploaded images, kept in this browser (localStorage) and
// offered in the Graph window's icon album beside the built-in ones.
//
// A custom icon is put on a node as a data image (as "Upload an image"
// always did), so a graph that uses one stays whole when it is saved,
// exported or opened elsewhere: it does not depend on this library.
//
// Sharing sets between people or devices needs the Service (backend request
// B-34); until then a set travels as a file (exportIconSet / importIconSet).

export const ICON_SETS_KEY = 'linkx.graph.icon_sets.v1';
export const BUILTIN_SET_ID = 'builtin';
export const ICON_SET_FILE_KIND = 'linkx-icon-set';

export const ICON_LIMITS = Object.freeze({
  FILE_BYTES: 100 * 1024, // one image, as uploaded
  SET_ICONS: 200, // icons in one set
  SETS: 20, // custom sets
  TOTAL_BYTES: 3 * 1024 * 1024, // every custom icon together (the browser allows about 5 MB)
  NAME: 60,
});
export const ICON_FILE_TYPES = Object.freeze(['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp']);
export const ICON_FILE_ACCEPT = '.svg,.png,.jpg,.jpeg,.webp,image/svg+xml,image/png,image/jpeg,image/webp';

/* ── The built-in set, by category ──────────────────────────────────── */

export const BUILTIN_CATEGORIES = Object.freeze([
  { id: 'people', label: 'People', icons: ['Person', 'Person Male', 'Person Male 1', 'Person Female', 'Person Female 1', 'Agent', 'Support agent', 'Follower', 'Mask'] },
  { id: 'finance', label: 'Money & trade', icons: ['Bank', 'Bank Account', 'Money', 'Cart', 'Shopping', 'Tag'] },
  { id: 'communication', label: 'Communication', icons: ['Phone', 'Mobile', 'Mail', 'Message', 'Comment', 'Post', 'Mic', 'Volume', 'Music', 'Bell', 'Share', 'Forward', 'Signal', 'Signal 1', 'Bluetooth'] },
  { id: 'transport', label: 'Transport', icons: ['Car', 'Car 1', 'Motorcycle', 'Bicycle', 'Airplane', 'Flight', 'Flight 1', 'Drone', 'Boat', 'Boat 1', 'Traffic', 'Gas'] },
  { id: 'places', label: 'Places', icons: ['Home', 'Office', 'Hospital', 'Motel', 'Restaurant', 'Park', 'Location', 'Position Pin', 'Map', 'Map 1', 'Globe', 'Compass'] },
  { id: 'technology', label: 'Technology', icons: ['Computer', 'Server', 'Database', 'Satellite', 'Camera', 'Printer', 'Gear', 'Equalizer', 'Power', 'Lock', 'Bulb', 'Lamp', 'Lamp 1'] },
  { id: 'records', label: 'Documents & time', icons: ['Document', 'Document 1', 'Documents', 'Documents 1', 'Calendar', 'Clock', 'Alarm'] },
  { id: 'marks', label: 'Marks & symbols', icons: ['Flag', 'Flag 1', 'Flag 2', 'Flag 3', 'Flag 4', 'Flag 5', 'Star', 'Star 1', 'Star 2', 'Target', 'Target 1', 'Target 2', 'Warning', 'Warning 1', 'Help', 'Help 1', 'Cross', 'David star', 'Moon and Star', 'Heart', 'Heart 1', 'Thumbs up', 'Thumbs down'] },
  { id: 'weather', label: 'Weather', icons: ['Sun', 'Sun 1', 'Lightning', 'Lightning 1', 'Cloud lightning', 'Cloud lightning 1'] },
]);

const CATEGORY_OF = new Map(BUILTIN_CATEGORIES.flatMap((category) => category.icons.map((name) => [name, category.id])));
export const builtinCategoryOf = (name) => CATEGORY_OF.get(name) || 'other';

export const BUILTIN_SET = Object.freeze({
  id: BUILTIN_SET_ID,
  name: 'LinkX Standard',
  builtIn: true,
  description: 'The icons that come with LinkX. They follow the theme (white on dark graphs) and cannot be changed or removed.',
  icons: Object.freeze(ICON_ALBUM.map((name) => Object.freeze({ id: name, name, src: albumIconPath(name), category: builtinCategoryOf(name) }))),
});

/* ── Reading an uploaded image ──────────────────────────────────────── */

// Text without control characters or angle brackets.
const plainText = (value) => [...String(value || '')].filter((char) => char.charCodeAt(0) >= 32 && char !== '<' && char !== '>').join('');

const cleanName = (value, fallback = 'Icon') => {
  const text = plainText(String(value || '').replace(/\.[a-z0-9]+$/i, '')).replace(/\s+/g, ' ').trim().slice(0, ICON_LIMITS.NAME);
  return text || fallback;
};

// An SVG as an image: nothing that runs, loads or embeds. (An <img> never
// runs scripts; this keeps the file itself clean wherever it travels.)
export const sanitizeSvg = (text) => {
  const source = String(text || '');
  if (!/<svg[\s>]/i.test(source)) return '';
  return source
    .replace(/<\?xml[\s\S]*?\?>/gi, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|foreignObject|iframe|object|embed|audio|video)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed|audio|video)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/javascript:/gi, '')
    .trim();
};

const svgDataUrl = (svg) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
const DATA_IMAGE_RE = /^data:image\/(png|jpe?g|webp|svg\+xml)[;,]/i;
export const isIconSource = (value) => typeof value === 'string' && DATA_IMAGE_RE.test(value);
// A data URL's size as stored (its text).
export const iconBytes = (src) => String(src || '').length;

const readAs = (file, how) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = () => reject(new Error('The file could not be read.'));
  reader[how](file);
});

// One uploaded file -> { ok: true, name, src } or { ok: false, name, reason }.
export const readIconFile = async (file) => {
  const name = cleanName(file?.name);
  const isSvg = file?.type === 'image/svg+xml' || /\.svg$/i.test(file?.name || '');
  const type = isSvg ? 'image/svg+xml' : file?.type;
  if (!ICON_FILE_TYPES.includes(type)) return { ok: false, name, reason: 'Not an SVG, PNG, JPEG or WebP image.' };
  if (file.size > ICON_LIMITS.FILE_BYTES) return { ok: false, name, reason: `Larger than ${Math.round(ICON_LIMITS.FILE_BYTES / 1024)} KB.` };
  try {
    if (isSvg) {
      const svg = sanitizeSvg(await readAs(file, 'readAsText'));
      return svg ? { ok: true, name, src: svgDataUrl(svg) } : { ok: false, name, reason: 'Not a valid SVG image.' };
    }
    const src = await readAs(file, 'readAsDataURL');
    return isIconSource(src) ? { ok: true, name, src } : { ok: false, name, reason: 'The image could not be read.' };
  } catch (error) {
    return { ok: false, name, reason: error?.message || 'The file could not be read.' };
  }
};

/* ── The store ──────────────────────────────────────────────────────── */

const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const normalizeIcons = (icons) => {
  const names = new Set();
  return (Array.isArray(icons) ? icons : [])
    .filter((icon) => icon && isIconSource(icon.src))
    .slice(0, ICON_LIMITS.SET_ICONS)
    .map((icon, index) => {
      // Names are unique within a set ("Phone", "Phone 2", …).
      const base = cleanName(icon.name, `Icon ${index + 1}`);
      let name = base;
      for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${base} ${n}`.slice(0, ICON_LIMITS.NAME + 4);
      names.add(name.toLowerCase());
      return { id: typeof icon.id === 'string' && icon.id ? icon.id.slice(0, 80) : newId('icon'), name, src: icon.src };
    });
};

export const normalizeIconSets = (input) => {
  const source = input && typeof input === 'object' ? input : {};
  const ids = new Set([BUILTIN_SET_ID]);
  const sets = (Array.isArray(source.sets) ? source.sets : [])
    .filter((set) => set && typeof set === 'object')
    .slice(0, ICON_LIMITS.SETS)
    .map((set, index) => {
      let id = typeof set.id === 'string' && set.id ? set.id.slice(0, 80) : newId('set');
      if (ids.has(id)) id = newId('set');
      ids.add(id);
      return {
        id,
        name: cleanName(set.name, `Icon set ${index + 1}`),
        description: typeof set.description === 'string' ? plainText(set.description).trim().slice(0, 200) : '',
        enabled: set.enabled !== false,
        icons: normalizeIcons(set.icons),
      };
    });
  return { builtinEnabled: source.builtinEnabled !== false, sets };
};

export const customBytes = (state) => state.sets.reduce((sum, set) => sum + set.icons.reduce((inner, icon) => inner + iconBytes(icon.src), 0), 0);

const read = () => {
  try {
    const raw = localStorage.getItem(ICON_SETS_KEY);
    return normalizeIconSets(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeIconSets(null);
  }
};

// One snapshot object until something changes (useSyncExternalStore).
let snapshot = null;
const listeners = new Set();

export const getIconSets = () => {
  if (!snapshot) snapshot = read();
  return snapshot;
};

// Saves and publishes; -> { ok: true } or { ok: false, reason }.
const commit = (next) => {
  const state = normalizeIconSets(next);
  if (customBytes(state) > ICON_LIMITS.TOTAL_BYTES) {
    return { ok: false, reason: `The icon library is full (${Math.round(ICON_LIMITS.TOTAL_BYTES / 1024 / 1024)} MB in this browser). Remove some icons first.` };
  }
  try {
    localStorage.setItem(ICON_SETS_KEY, JSON.stringify(state));
  } catch {
    return { ok: false, reason: 'This browser has no room left to keep the icons.' };
  }
  snapshot = state;
  listeners.forEach((listener) => listener());
  return { ok: true };
};

export const subscribeIconSets = (listener) => {
  listeners.add(listener);
  // Another tab changed them.
  const onStorage = (event) => {
    if (event.key !== ICON_SETS_KEY) return;
    snapshot = read();
    listener();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
};

const withSet = (id, change) => {
  const state = getIconSets();
  if (!state.sets.some((set) => set.id === id)) return { ok: false, reason: 'That icon set no longer exists.' };
  return commit({ ...state, sets: state.sets.map((set) => (set.id === id ? change(set) : set)) });
};

// -> { ok, id } (the new set's) or { ok: false, reason }.
export const createIconSet = ({ name, description = '', icons = [] } = {}) => {
  const state = getIconSets();
  if (state.sets.length >= ICON_LIMITS.SETS) return { ok: false, reason: `No more than ${ICON_LIMITS.SETS} icon sets.` };
  const id = newId('set');
  const result = commit({ ...state, sets: [...state.sets, { id, name, description, enabled: true, icons }] });
  return result.ok ? { ok: true, id } : result;
};

export const updateIconSet = (id, patch) => withSet(id, (set) => ({ ...set, ...patch, id: set.id, icons: set.icons }));
export const removeIconSet = (id) => {
  const state = getIconSets();
  return commit({ ...state, sets: state.sets.filter((set) => set.id !== id) });
};
export const setIconSetEnabled = (id, enabled) => {
  if (id === BUILTIN_SET_ID) return commit({ ...getIconSets(), builtinEnabled: Boolean(enabled) });
  return updateIconSet(id, { enabled: Boolean(enabled) });
};

export const addIcons = (id, icons) => {
  const set = getIconSets().sets.find((item) => item.id === id);
  if (set && set.icons.length + icons.length > ICON_LIMITS.SET_ICONS) return { ok: false, reason: `A set holds up to ${ICON_LIMITS.SET_ICONS} icons.` };
  return withSet(id, (current) => ({ ...current, icons: [...current.icons, ...icons] }));
};
export const renameIcon = (id, iconId, name) => withSet(id, (set) => ({ ...set, icons: set.icons.map((icon) => (icon.id === iconId ? { ...icon, name } : icon)) }));
export const removeIcon = (id, iconId) => withSet(id, (set) => ({ ...set, icons: set.icons.filter((icon) => icon.id !== iconId) }));

/* ── A set as a file ────────────────────────────────────────────────── */

export const iconSetFileName = (set) => `${String(set?.name || 'icon-set').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'icon-set'}.lxicons.json`;

export const exportIconSet = (id) => {
  const set = getIconSets().sets.find((item) => item.id === id);
  if (!set) return '';
  return JSON.stringify({ kind: ICON_SET_FILE_KIND, version: 1, name: set.name, description: set.description, icons: set.icons.map(({ name, src }) => ({ name, src })) }, null, 2);
};

// -> { ok: true, id, added } or { ok: false, reason }.
export const importIconSet = (text) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'That is not an icon set file.' };
  }
  if (parsed?.kind !== ICON_SET_FILE_KIND || !Array.isArray(parsed.icons)) return { ok: false, reason: 'That is not an icon set file.' };
  const icons = normalizeIcons(parsed.icons.filter((icon) => iconBytes(icon?.src) <= ICON_LIMITS.FILE_BYTES * 1.5));
  if (!icons.length) return { ok: false, reason: 'The file holds no usable icons.' };
  const result = createIconSet({ name: parsed.name, description: parsed.description, icons });
  return result.ok ? { ...result, added: icons.length } : result;
};

// What the Graph window's icon album offers: the sets turned on, in order.
export const albumSets = (state = getIconSets()) => [
  ...(state.builtinEnabled ? [BUILTIN_SET] : []),
  ...state.sets.filter((set) => set.enabled && set.icons.length > 0),
];

// For tests: forget what was read.
export const forgetIconSets = () => { snapshot = null; };
