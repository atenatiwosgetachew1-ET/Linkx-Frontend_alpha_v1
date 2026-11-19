// Link aggregation (G3.5 i2 benchmark #2; after IBM i2 Analyst's Notebook,
// not in production; analyst decision 2026-11-16). A view-only setting, kept
// apart from production's edge bundling: links between the same two nodes
// are drawn as one, labelled with how many and (optionally) the total of a
// numeric property, per direction or combined. A pair can be expanded back
// into its links (double-click, or right-click ▸ Expand Links) and collapsed
// again. The graph data is never changed.
//
// Theme lines are never aggregated. With aggregation on, edge bundling is not
// applied (one merge at a time).

export const AGGREGATION_MODES = Object.freeze(['combined', 'direction']);

const isThemeLine = (edge) => String(edge?.edge_kind || '').toLowerCase() === 'theme_line';

// The pair a link belongs to: 'a<->b' (combined, ends sorted) or 'a->b'.
export const linkGroupOf = (edge, mode = 'combined') => {
  const from = String(edge?.from);
  const to = String(edge?.to);
  if (mode === 'direction') return `${from}->${to}`;
  return from <= to ? `${from}<->${to}` : `${to}<->${from}`;
};

const numberOf = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const totalFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
export const formatLinkTotal = (value) => totalFormat.format(value);

// entries: [[key, edge]] (the drawn links); expanded: group ids opened back
// into their links. -> {
//   groups: Map(group -> { key (the drawn one), members: [keys], count,
//           total (null without a numeric value), forward, backward }),
//   memberOf: Map(key -> group) for every link of a group of 2 or more,
//   primary: Map(key -> data for the drawn link), hidden: Set(keys) }
export const aggregateLinks = (entries, { mode = 'combined', totalKey = '', expanded = [] } = {}) => {
  const open = new Set(expanded);
  const byGroup = new Map();
  entries.forEach(([key, edge]) => {
    if (!edge || isThemeLine(edge)) return;
    const group = linkGroupOf(edge, mode);
    if (!byGroup.has(group)) byGroup.set(group, []);
    byGroup.get(group).push([key, edge]);
  });
  const groups = new Map();
  const memberOf = new Map();
  const primary = new Map();
  const hidden = new Set();
  byGroup.forEach((members, group) => {
    if (members.length < 2) return;
    members.sort(([ka, a], [kb, b]) => String(a.id ?? ka).localeCompare(String(b.id ?? kb), undefined, { numeric: true }));
    const [[firstKey, first]] = members;
    const values = totalKey ? members.map(([, edge]) => numberOf(edge[totalKey])).filter((value) => value !== null) : [];
    const total = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
    const forward = members.filter(([, edge]) => String(edge.from) === String(first.from)).length;
    const entry = {
      key: firstKey, members: members.map(([key]) => key), count: members.length, total, forward, backward: members.length - forward,
    };
    groups.set(group, entry);
    entry.members.forEach((key) => memberOf.set(key, group));
    if (open.has(group)) return;
    // The same label on every link is kept in front of the count.
    const labels = new Set(members.map(([, edge]) => String(edge.label ?? '').trim()));
    const shared = labels.size === 1 ? [...labels][0] : '';
    primary.set(firstKey, {
      label: `${shared ? `${shared} ` : ''}×${members.length}${total !== null ? ` · ${formatLinkTotal(total)}` : ''}`,
      width: Math.max(1.5, Math.min(6, 1 + Math.log2(members.length + 1))),
      aggregated: members.length,
      // Combined, with links both ways: an arrow at each end.
      ...(mode === 'combined' && entry.backward > 0 && entry.forward > 0 ? { bothWays: 1 } : {}),
    });
    members.slice(1).forEach(([key]) => hidden.add(key));
  });
  return { groups, memberOf, primary, hidden };
};

export const DEFAULT_LINK_AGGREGATION = Object.freeze({ on: false, mode: 'combined', totalKey: '' });

export const normalizeLinkAggregation = (input = {}) => ({
  on: input?.on === true || input?.on === 'true',
  mode: AGGREGATION_MODES.includes(input?.mode) ? input.mode : DEFAULT_LINK_AGGREGATION.mode,
  totalKey: typeof input?.totalKey === 'string' ? input.totalKey.trim().slice(0, 120) : '',
});
