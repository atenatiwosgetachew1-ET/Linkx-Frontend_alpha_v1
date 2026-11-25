// Runs that were going when the page went away (closed, reloaded, signed
// out), kept going or stopped, so their end is told at the next sign-in. Only the Service's task ids are kept,
// per user, in this browser, for a week.

import { getTasksSnapshot, isTaskActive } from '../../features/tasks/lib/taskRegistry.js';

const KEY = 'linkx.runs.away.v1';
const DAYS = 7;
const MAX_IDS = 50;
const MAX_USERS = 5;

const readAll = (now = Date.now()) => {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || '{}');
    return Object.fromEntries(Object.entries(value && typeof value === 'object' ? value : {})
      .filter(([, entry]) => Array.isArray(entry?.ids) && now - Number(entry.at) < DAYS * 864e5)
      .map(([owner, entry]) => [owner, { at: Number(entry.at), ids: entry.ids.filter((id) => typeof id === 'string').slice(0, MAX_IDS) }]));
  } catch {
    return {};
  }
};
const write = (owner, ids) => {
  try {
    const all = readAll();
    if (ids.length) all[owner] = { at: Date.now(), ids: ids.slice(0, MAX_IDS) };
    else delete all[owner];
    const kept = Object.entries(all).sort(([, a], [, b]) => b.at - a.at).slice(0, MAX_USERS);
    if (kept.length) localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
    else localStorage.removeItem(KEY);
  } catch { /* no storage: the runs are still in Tasks */ }
};

// This page's own; those an earlier page left are remembered already.
const isOwn = (task) => task.serverId && !task.remote && !task.foreign;

// Called as the page goes away.
export const rememberAwayRuns = (owner) => {
  const ids = getTasksSnapshot().tasks.filter((task) => isOwn(task) && isTaskActive(task)).map((task) => task.serverId);
  write(owner, [...new Set([...(readAll()[owner]?.ids || []), ...ids])]);
};

// The remembered runs that have ended, told once: -> tasks of the registry.
// Those still going stay remembered.
export const takeEndedAwayRuns = (owner) => {
  const ids = readAll()[owner]?.ids || [];
  if (!ids.length) return [];
  const { tasks } = getTasksSnapshot();
  // A run followed by this page tells its own end.
  const told = tasks.filter((task) => ids.includes(task.serverId) && !isTaskActive(task));
  if (!told.length) return [];
  const gone = new Set(told.map((task) => task.serverId));
  write(owner, ids.filter((id) => !gone.has(id)));
  return told.filter((task) => task.remote);
};
