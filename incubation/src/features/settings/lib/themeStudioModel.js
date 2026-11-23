// How the Theme Studio (Preferences) lays out the theme tokens: the
// categories under a few areas of the app, and each category's tokens in
// named groups. The tokens themselves: src/shared/theme/themeCategories.js.

// The areas, in the order shown. A category no area names goes to "Other",
// so a new one is never hidden.
export const STUDIO_AREAS = [
  {
    id: 'workspace',
    name: 'Workspace',
    hint: 'The page behind the windows and the bars around it.',
    categories: ['background_central', 'left_launcher', 'right_workspace', 'right_context', 'bottom_dock'],
  },
  {
    id: 'windows',
    name: 'Windows',
    hint: 'The floating windows and what each one shows.',
    categories: ['floating_windows', 'source_window', 'tasks_window', 'reports_window', 'graph-window', 'configuration_frame', 'configuration_pages', 'configuration_system', 'configuration_forms', 'configuration_tables', 'configuration_window', 'libraries_frame', 'libraries_pages', 'libraries_forms', 'libraries_parts', 'window_load_screen'],
  },
  {
    id: 'settings',
    name: 'Settings window',
    hint: 'This window, part by part.',
    categories: ['settings_window', 'settings_frame', 'settings_pages', 'settings_profile', 'settings_vigilance', 'settings_popups', 'settings_forms', 'settings_storage', 'settings_studio', 'settings_status'],
  },
  {
    id: 'feedback',
    name: 'Notices & tooltips',
    hint: 'What appears over everything else.',
    categories: ['notifications', 'global_tooltips'],
  },
];

const OTHER_AREA = { id: 'other', name: 'Other', hint: '', categories: [] };

// A name without its leading emoji or symbols.
export const plainName = (name = '') => String(name).replace(/^[^\p{L}\p{N}"]+/u, '').trim();

// A category's name as shown under its area ("Settings — Pages" under
// Settings window is just "Pages").
export function categoryTitle(category, area) {
  const name = plainName(category.name);
  if (area?.id === 'settings') return name.replace(/^Settings\s+—\s+/, '').replace(/^Settings Window Content$/, 'Shared form parts');
  return name;
}

export function groupCategories(categories) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const placed = new Set();
  const areas = STUDIO_AREAS.map((area) => ({
    ...area,
    categories: area.categories.filter((id) => byId.has(id)).map((id) => {
      placed.add(id);
      return byId.get(id);
    }),
  }));
  const rest = categories.filter((category) => !placed.has(category.id));
  if (rest.length) areas.push({ ...OTHER_AREA, categories: rest });
  return areas.filter((area) => area.categories.length > 0);
}

const GENERAL = 'General';
// Below this, a category is short enough to read as one list.
const UNGROUPED_UP_TO = 16;

const labelPrefix = (label) => {
  const [prefix, rest] = plainName(label).split(' — ');
  return rest === undefined ? '' : prefix.replace(/\s*\([^)]*\)/g, '').trim();
};
const firstWordKey = (prefix) => prefix.split(/\s+/)[0].toLowerCase().replace(/s$/, '');
const sharedWords = (names) => {
  const [first, ...others] = names.map((name) => name.split(/\s+/));
  let count = first.length;
  others.forEach((words) => {
    let same = 0;
    while (same < count && same < words.length && words[same].toLowerCase() === first[same].toLowerCase()) same += 1;
    count = same;
  });
  return first.slice(0, Math.max(count, 1)).join(' ');
};

// A category's tokens in named groups, in their order: by each token's
// `group` where the category has them; otherwise by what its labels start
// with ("Footer button — border" and "Footer — text" both go to "Footer").
// One group with an empty name means: no grouping worth showing.
export function tokenGroups(tokens) {
  if (tokens.length <= UNGROUPED_UP_TO) return [{ name: '', tokens }];

  const groups = new Map();
  const add = (key, name, token) => {
    if (!groups.has(key)) groups.set(key, { names: new Set(), tokens: [] });
    const group = groups.get(key);
    group.names.add(name);
    group.tokens.push(token);
  };

  if (tokens.some((token) => token.group)) {
    tokens.forEach((token) => add(token.group || GENERAL, token.group || GENERAL, token));
  } else {
    tokens.forEach((token) => {
      const prefix = labelPrefix(token.label);
      if (prefix) add(firstWordKey(prefix), prefix, token);
      else add(GENERAL, GENERAL, token);
    });
    // A group of one says nothing: it joins General.
    [...groups.entries()].forEach(([key, group]) => {
      if (key === GENERAL || group.tokens.length > 1) return;
      groups.delete(key);
      add(GENERAL, GENERAL, group.tokens[0]);
    });
  }

  const result = [...groups.entries()].map(([key, group]) => ({
    name: key === GENERAL ? GENERAL : sharedWords([...group.names]),
    tokens: group.tokens,
  }));
  if (result.length <= 1) return [{ name: '', tokens }];
  // General first: it holds what the rest build on.
  return [...result.filter((group) => group.name === GENERAL), ...result.filter((group) => group.name !== GENERAL)];
}

export const normalizeQuery = (query = '') => query.trim().toLowerCase();

export function tokenMatches(token, query) {
  if (!query) return true;
  return [token.label, token.key, token.group].some((text) => text && text.toLowerCase().includes(query));
}

// Per category, the tokens that pass `keep`; categories with none left out.
export function collectTokens(areas, keep) {
  return areas.flatMap((area) => area.categories.map((category) => ({
    area,
    category,
    tokens: category.tokens.filter(keep),
  }))).filter((entry) => entry.tokens.length > 0);
}
