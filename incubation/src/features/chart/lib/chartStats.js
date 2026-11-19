// A card's key figures, shown under its header (analyst decision
// 2026-11-18: cards with a defined structure): how many entities or links
// were measured, the highest (named), the mean and the lowest; a card's
// overall value (Reciprocity, Assortativity) first; for Temporal Metrics,
// the periods and dated links. -> [{ label, value, detail?, emphasis? }]

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

// selected: the ids selected on the graph that this card measures (its
// kind); first comes what the card says about them (analyst decision
// 2026-11-18): one, its value, rank and name; several, how many and their
// mean.
export const selectedStat = (result, selected = [], names = {}) => {
  if (!result || !selected.length || result.form === 'figures' || result.kind === 'time') return null;
  if (result.form === 'bins') {
    const chosen = new Set(selected);
    const bins = (result.bins || []).filter((bin) => bin.members.some((id) => chosen.has(id)));
    if (!bins.length) return null;
    if (selected.length === 1) return { label: 'Selected', value: bins[0].value, detail: `${names[selected[0]] ?? selected[0]} \u00b7 in ${bins[0].label}`, selected: true };
    return { label: `Selected (${selected.length})`, value: bins.length, detail: `in ${bins.length === 1 ? '1 bar' : `${bins.length} bars`}`, selected: true };
  }
  if (result.form === 'heatmap') {
    const chosen = new Set(selected);
    const cells = (result.cells || []).filter((cell) => cell.members.some((id) => chosen.has(id)));
    if (!cells.length) return null;
    const links = cells.reduce((sum, cell) => sum + cell.members.filter((id) => chosen.has(id)).length, 0);
    return { label: 'Selected', value: links, detail: cells.length === 1 ? `${result.days[cells[0].day]} ${result.hours[cells[0].hour]}` : `in ${cells.length} cells`, selected: true };
  }
  const first = result.series?.[0];
  if (!first) return null;
  if (result.form === 'pairs') {
    const present = selected.filter((id) => id in first.values);
    return present.length ? { label: 'Selected', value: present.length, detail: present.length === 1 ? names[present[0]] ?? present[0] : 'links', selected: true } : null;
  }
  const present = selected.filter((id) => finite(first.values[id]));
  if (!present.length) return null;
  const of = result.series.length > 1 ? ` (${first.name})` : '';
  if (present.length === 1) {
    const id = present[0];
    const value = first.values[id];
    const ranked = Object.values(first.values).filter(finite);
    const rank = 1 + ranked.filter((other) => other > value).length;
    return { label: `Selected${of}`, value, detail: `#${rank} of ${ranked.length} \u00b7 ${names[id] ?? id}`, selected: true };
  }
  const mean = present.reduce((sum, id) => sum + first.values[id], 0) / present.length;
  return { label: `Selected (${present.length})${of}`, value: mean, detail: 'mean', selected: true };
};

export const cardStats = (result, names = {}, selected = []) => {
  if (!result || result.form === 'figures') return [];
  const stats = [];
  const chosen = selectedStat(result, selected, names);
  if (chosen) stats.push(chosen);
  if (result.summary) stats.push({ label: result.summary.label, value: result.summary.value, emphasis: true });
  if (result.kind === 'time') {
    const links = result.series.find((entry) => entry.axis === 1);
    stats.push({ label: 'Periods', value: result.periods.length });
    stats.push({ label: 'Dated links', value: (links?.values || []).reduce((sum, value) => sum + (finite(value) ? value : 0), 0) });
    if (result.undated) stats.push({ label: 'Undated', value: result.undated });
    return stats;
  }
  // Bins: how many items, in how many bins, the largest bin.
  if (result.form === 'bins') {
    const bins = result.bins || [];
    const total = bins.reduce((sum, bin) => sum + bin.value, 0);
    stats.push({ label: result.yName || (result.kind === 'edge' ? 'Links' : 'Entities'), value: total });
    stats.push({ label: 'Bars', value: bins.length });
    const largest = bins.reduce((best, bin) => (!best || bin.value > best.value ? bin : best), null);
    if (largest) stats.push({ label: 'Largest', value: largest.value, detail: largest.label });
    return stats;
  }
  // Heat Matrix: dated links, the busiest cell, undated links.
  if (result.form === 'heatmap') {
    const cells = result.cells || [];
    stats.push({ label: 'Dated links', value: cells.reduce((sum, cell) => sum + cell.value, 0) });
    const busiest = cells.reduce((best, cell) => (!best || cell.value > best.value ? cell : best), null);
    if (busiest) stats.push({ label: 'Busiest', value: busiest.value, detail: `${result.days[busiest.day]} ${result.hours[busiest.hour]}` });
    if (result.undated) stats.push({ label: 'Undated', value: result.undated });
    return stats;
  }
  const first = result.series?.[0];
  if (!first) return stats;
  const subject = result.kind === 'edge' ? 'Links' : 'Entities';
  if (result.form === 'pairs') {
    stats.push({ label: subject, value: Object.keys(first.values).length });
    return stats;
  }
  const entries = Object.entries(first.values).filter(([, value]) => finite(value));
  stats.push({ label: subject, value: entries.length });
  if (!entries.length) return stats;
  let top = entries[0];
  let low = entries[0];
  let sum = 0;
  entries.forEach((entry) => {
    if (entry[1] > top[1]) top = entry;
    if (entry[1] < low[1]) low = entry;
    sum += entry[1];
  });
  const of = result.series.length > 1 ? ` (${first.name})` : '';
  stats.push({ label: `Highest${of}`, value: top[1], detail: names[top[0]] ?? top[0] });
  stats.push({ label: `Mean${of}`, value: sum / entries.length });
  stats.push({ label: `Lowest${of}`, value: low[1] });
  return stats;
};
